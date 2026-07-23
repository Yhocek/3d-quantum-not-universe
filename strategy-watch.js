#!/usr/bin/env node
/* =============================================================================
   STRATEGY WATCH — "sleeping analyst"
   Periodically evaluates your Strategy notebook against live market data and
   logs a recommendation to Trade Journal ONLY when a strategy branch newly
   fires (edge-triggered) — even while no LLM is connected. Drives the MCP
   server's deterministic evaluate_strategy + log_trade_decision tools over
   stdio, reusing its auth, QGPR and journalling.

   Recommendations only — it never places an order. You execute manually.

   Run:
     NOTE_USER=you NOTE_PASS=... \
     WATCH_SYMBOLS="SOL/USDC,ETH/USDC" WATCH_INTERVAL=60 WATCH_HORIZON=30 \
     node strategy-watch.js

   Env:
     WATCH_SYMBOLS   comma-separated symbols/pairs         (default "SOL/USDC")
     WATCH_INTERVAL  seconds between sweeps, min 15         (default 60)
     WATCH_HORIZON   QGPR horizon 10-60s, empty = disabled  (default "")
     NOTE_BASE_URL / NOTE_USER / NOTE_PASS / NOTE_REGISTER / DEX_API_BASE
   ============================================================================= */
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const SYMBOLS = (process.env.WATCH_SYMBOLS || 'SOL/USDC').split(',').map(s => s.trim()).filter(Boolean);
const INTERVAL = Math.max(+process.env.WATCH_INTERVAL || 60, 15) * 1000;
const HORIZON = process.env.WATCH_HORIZON ? +process.env.WATCH_HORIZON : null;

/* ---- MCP stdio client (line-delimited JSON-RPC) ---- */
const srv = spawn('node', [path.join(__dirname, 'mcp-server.js')], {
    env: process.env, stdio: ['pipe', 'pipe', 'inherit']
});
let buf = ''; const pending = new Map(); let nid = 0;
srv.stdout.on('data', d => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let m; try { m = JSON.parse(line); } catch (e) { continue; }
        if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    }
});
srv.on('exit', c => { log('mcp-server exited (' + c + ')'); process.exit(c || 0); });
const rpc = (method, params) => new Promise((res, rej) => {
    const id = ++nid; pending.set(id, m => m.error ? rej(new Error(m.error.message)) : res(m.result));
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
async function call(name, args) {
    const r = await rpc('tools/call', { name, arguments: args });
    const text = r && r.content && r.content[0] && r.content[0].text;
    if (r && r.isError) throw new Error(text || 'tool error');
    try { return JSON.parse(text); } catch (e) { return text; }
}
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* fired düğüm adresi başına son durum — kenar tetikleme (spam yok) */
const firedState = new Map(); // "symbol|address" → true

async function sweep() {
    for (const symbol of SYMBOLS) {
        let res;
        try {
            const args = { query: symbol };
            if (HORIZON != null) args.horizon_seconds = HORIZON;
            res = await call('evaluate_strategy', args);
        } catch (e) { log('⚠️', symbol, e.message); continue; }
        if (typeof res === 'string') { log(symbol, res); continue; }

        const fired = res.fired || [];
        const nowKeys = new Set(fired.map(f => symbol + '|' + f.address));
        /* düşen dallar: sıfırla ki tekrar ateşlenebilsin */
        for (const k of [...firedState.keys()])
            if (k.startsWith(symbol + '|') && !nowKeys.has(k)) firedState.delete(k);

        const leaves = fired.filter(f => !fired.some(g => g !== f && g.route.startsWith(f.route + ' → ')));
        let logged = 0;
        for (const f of leaves) {
            const key = symbol + '|' + f.address;
            if (firedState.get(key)) continue;      // zaten günlüklendi (kenar tetikleme)
            firedState.set(key, true);
            const action = deriveAction(f.actions);
            const snap = marketSnap(res.market, res.prediction);
            try {
                const out = await call('log_trade_decision', {
                    symbol, action,
                    reasoning: f.title + ' fired — ' + f.matched.join('; ') +
                               '. Prescribes: ' + f.actions.join(' | '),
                    route: f.route,
                    market_snapshot: snap,
                    fired_address: f.address
                });
                logged++;
                log('🔔', symbol, '→', f.route, '::', action, '· journal', out.address);
            } catch (e) { log('⚠️ log', symbol, e.message); }
        }
        if (!logged) log('·', symbol, fired.length ? '(no new leaf fired)' : '(nothing fired)');
    }
}
/* eylem metninden öneri fiili çıkar (buy/sell/hold/watch/reduce) */
function deriveAction(actions) {
    const t = (actions || []).join(' ').toLowerCase();
    for (const a of ['buy', 'sell', 'reduce', 'hold', 'watch']) if (t.includes(a)) return a;
    return 'watch';
}
function marketSnap(M, P) {
    const parts = [];
    if (M.price != null) parts.push('$' + M.price);
    if (M['change 1h'] != null) parts.push('1h ' + M['change 1h'] + '%');
    if (M['change 24h'] != null) parts.push('24h ' + M['change 24h'] + '%');
    if (M['volume 24h'] != null) parts.push('vol ' + M['volume 24h']);
    if (P) parts.push('QGPR(' + P.horizonSeconds + 's) ' + P.predictedChangePct + '% CI[' + P.ci95.join(', ') + ']');
    return parts.join(' · ');
}

(async function main() {
    await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'strategy-watch', version: '1.0.0' } });
    log('👁  Sleeping analyst watching', SYMBOLS.join(', '),
        '· every', INTERVAL / 1000 + 's', HORIZON != null ? '· QGPR ' + HORIZON + 's' : '· no forecast');
    await sweep();
    setInterval(sweep, INTERVAL);
})().catch(e => { console.error('fatal:', e.message); process.exit(1); });
