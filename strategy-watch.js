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

   Two modes:
     • JOURNAL (default) — logs a recommendation to Trade Journal, no execution.
     • LIVE (WATCH_LIVE=1) — additionally POSTs the decision to YOUR OWN
       execution webhook (WATCH_WEBHOOK), which holds your broker/exchange keys
       and decides what to do. This bridge ships NO credentials and integrates
       NO exchange directly — execution stays entirely on your endpoint. Live is
       dry-run unless you also set WATCH_CONFIRM=I-UNDERSTAND, is capped per
       trade, and only dispatches actions you allow. Autonomous trading is risky
       and entirely your responsibility; nothing here is financial advice.

   Env:
     WATCH_SYMBOLS   comma-separated symbols/pairs         (default "SOL/USDC")
     WATCH_INTERVAL  seconds between sweeps, min 15         (default 60)
     WATCH_HORIZON   QGPR horizon 10-60s, empty = disabled  (default "")
     WATCH_LIVE      "1" to enable webhook dispatch          (default off)
     WATCH_WEBHOOK   your execution endpoint URL (https)     (required if LIVE)
     WATCH_CONFIRM   must equal "I-UNDERSTAND" to arm live    (else dry-run)
     WATCH_MAX_USD   per-trade notional cap in USD           (default 25)
     WATCH_ACTIONS   actions that dispatch live               (default buy,sell,reduce)
     WATCH_SECRET    optional bearer token sent to webhook
     NOTE_BASE_URL / NOTE_USER / NOTE_PASS / NOTE_REGISTER / DEX_API_BASE
   ============================================================================= */
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const SYMBOLS = (process.env.WATCH_SYMBOLS || 'SOL/USDC').split(',').map(s => s.trim()).filter(Boolean);
const INTERVAL = Math.max(+process.env.WATCH_INTERVAL || 60, 15) * 1000;
const HORIZON = process.env.WATCH_HORIZON ? +process.env.WATCH_HORIZON : null;

/* ---- live-trade dispatch (bring your own execution endpoint) ---- */
const LIVE = process.env.WATCH_LIVE === '1';
const WEBHOOK = process.env.WATCH_WEBHOOK || '';
const ARMED = LIVE && process.env.WATCH_CONFIRM === 'I-UNDERSTAND' && /^https:\/\//i.test(WEBHOOK);
const MAX_USD = Math.max(+process.env.WATCH_MAX_USD || 25, 0);
const LIVE_ACTIONS = new Set((process.env.WATCH_ACTIONS || 'buy,sell,reduce').split(',').map(s => s.trim().toLowerCase()));
const SECRET = process.env.WATCH_SECRET || '';

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
                if (LIVE) await dispatchLive(symbol, action, f, res);   // canlı: kendi endpoint'ine gönder
            } catch (e) { log('⚠️ log', symbol, e.message); }
        }
        if (!logged) log('·', symbol, fired.length ? '(no new leaf fired)' : '(nothing fired)');
    }
}
/* LIVE modu: kararı kullanıcının KENDİ execution endpoint'ine POST'lar.
   Bu köprü hiçbir borsaya bağlanmaz, kimlik bilgisi taşımaz — endpoint
   kullanıcıya aittir ve gerçek emri o verir. Silahlanmadıysa dry-run. */
async function dispatchLive(symbol, action, f, res) {
    if (!LIVE_ACTIONS.has(action)) { log('   ↳ live skip (action not allowed):', action); return; }
    const payload = {
        source: '3d-quantum-note-universe/strategy-watch',
        ts: new Date().toISOString(),
        symbol, action,
        sizeUsd: MAX_USD,                 // endpoint bunu üst sınır sayar
        route: f.route,
        reasoning: f.title + ' — ' + f.matched.join('; '),
        prescribes: f.actions,
        market: res.market,
        prediction: res.prediction || null,
        dryRun: !ARMED,                   // ARMED değilse endpoint uygulamamalı
        disclaimer: 'recommendation from user strategy; execution is the endpoint owner\'s responsibility'
    };
    if (!ARMED) { log('   ↳ live DRY-RUN (not armed): would POST', action, '$' + MAX_USD, symbol); return; }
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (SECRET) headers['Authorization'] = 'Bearer ' + SECRET;
        const r = await fetch(WEBHOOK, { method: 'POST', headers, body: JSON.stringify(payload) });
        log('   ↳ 🟢 LIVE POST', action, '$' + MAX_USD, symbol, '→', r.status, r.ok ? 'ok' : 'FAILED');
    } catch (e) { log('   ↳ ⚠️ live POST error:', e.message); }
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
    if (!LIVE) log('   mode: JOURNAL only (no execution)');
    else if (!ARMED) log('   mode: LIVE DRY-RUN — set WATCH_CONFIRM=I-UNDERSTAND + https WATCH_WEBHOOK to arm; nothing is sent');
    else log('   mode: 🟢 LIVE ARMED → ' + WEBHOOK + ' · cap $' + MAX_USD + '/trade · actions [' +
        [...LIVE_ACTIONS].join(',') + '] · YOUR endpoint executes, YOUR responsibility');
    await sweep();
    setInterval(sweep, INTERVAL);
})().catch(e => { console.error('fatal:', e.message); process.exit(1); });
