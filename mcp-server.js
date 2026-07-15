#!/usr/bin/env node
/* =============================================================================
   MCP SUNUCUSU — 3D Kuantum Not Evreni köprüsü (saf Node.js, sıfır bağımlılık)
   Claude (Code / Desktop) bu sunucu üzerinden not evrenine bağlanır:
   defterleri listeler, notları okur/arar, not ekler/günceller/siler,
   paylaşım linki üretir.

   Taşıma: MCP stdio (satır ayrılmış JSON-RPC 2.0).
   Kimlik: NOTE_USER + NOTE_PASS ile /api/auth/login (NOTE_REGISTER=1 ise
           hesap yoksa otomatik kayıt). Oturum çerezi + CSRF bellekte tutulur.

   Kurulum (Claude Code):
     claude mcp add not-evreni -e NOTE_USER=kullanici -e NOTE_PASS=parola \
       -- node /yol/mcp-server.js
   Ya da depodaki .mcp.json otomatik algılanır (env değişkenlerini ayarla).
   ============================================================================= */
'use strict';

const BASE = (process.env.NOTE_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const USER = process.env.NOTE_USER || '';
const PASS = process.env.NOTE_PASS || '';
const AUTO_REGISTER = process.env.NOTE_REGISTER === '1';
const SLOT_COUNT = 54;

/* ------------------------------------------------------------ API istemcisi */
let cookie = null, csrf = null;

function grabCookie(res) {
    const raw = typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    for (const c of raw) { const m = /sid=([a-f0-9]+)/.exec(c); if (m) cookie = 'sid=' + m[1]; }
}
async function authCall(path) {
    const res = await fetch(BASE + '/api/auth/' + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: USER, password: PASS })
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(j.error || 'auth ' + res.status); e.status = res.status; throw e; }
    grabCookie(res); csrf = j.csrf;
    return j.user;
}
async function ensureAuth() {
    if (csrf) return;
    if (!USER || !PASS) throw new Error('set the NOTE_USER and NOTE_PASS environment variables (server: ' + BASE + ')');
    try { await authCall('login'); }
    catch (e) {
        if (e.status === 401 && AUTO_REGISTER) await authCall('register');
        else throw new Error('login failed: ' + e.message + (e.status === 401 ? ' (set NOTE_REGISTER=1 to auto-create the account)' : ''));
    }
}
async function api(path, opts = {}) {
    await ensureAuth();
    const headers = { 'Content-Type': 'application/json', 'Cookie': cookie };
    if (opts.method && opts.method !== 'GET') headers['X-CSRF'] = csrf;
    const res = await fetch(BASE + '/api/' + path, Object.assign({}, opts, { headers }));
    if (res.status === 401) { csrf = cookie = null; throw new Error('session expired — try again'); }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || 'api ' + res.status);
    return j;
}

/* ------------------------------------------- standart şema ağaç yardımcıları
   Sunucu ağacı: {id,label,slot(1-54|null),html,children:[...],links,images,docs}
   Adres: kökten yuva numaraları — "0", "0.12", "0.12.3" ...                  */
function nodeAt(root, addr) {
    if (!addr || addr === '0') return root;
    let n = root;
    for (const p of String(addr).split('.').slice(1)) {
        n = (n.children || []).find(c => c.slot === +p);
        if (!n) return null;
    }
    return n;
}
function parentAddr(addr) { const p = String(addr).split('.'); return p.length > 1 ? p.slice(0, -1).join('.') : null; }
function stripTags(h) { return String(h || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
/* satır yapısını koruyarak HTML → metin (strateji gövdeleri koşul satırlarıdır) */
function htmlToText(h) {
    return String(h || '')
        .replace(/<(?:br|\/p|\/h[1-6]|\/li|\/div|\/blockquote)[^>]*>/gi, '\n')
        .replace(/<li[^>]*>/gi, '• ')
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
        .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
/* sunucuya yazılan gövde: istemci sanitizer'ıyla aynı beyaz liste, öznitelik yok */
const ALLOWED = 'h1|h2|h3|p|br|b|strong|i|em|u|s|ul|ol|li|div|span|blockquote|code|pre';
function cleanHtml(h) {
    return String(h || '')
        .replace(/<(?![a-zA-Z/])/g, '&lt;') // "< -1%" gibi karşılaştırmalar metindir, etiket değil
        .replace(new RegExp('<(?!\\/?(?:' + ALLOWED + ')\\b)[^>]*>', 'gi'), '')
        .replace(new RegExp('<(\\/?)(' + ALLOWED + ')\\b[^>]*>', 'gi'), '<$1$2>');
}
function outline(n, addr = '0', depth = 0, maxDepth = 4, lines = []) {
    lines.push('  '.repeat(depth) + addr + '  ' + (n.label || 'untitled') +
        ((n.children || []).length ? '  [' + n.children.length + ' children]' : ''));
    if (depth < maxDepth)
        for (const c of (n.children || [])) outline(c, addr + '.' + c.slot, depth + 1, maxDepth, lines);
    else if ((n.children || []).length) lines.push('  '.repeat(depth + 1) + '… +' + n.children.length);
    return lines;
}
function newNode(label, slot, html) {
    return { id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
             label: label || 'untitled', type: 'micro_habit', size: 1, slot,
             html: cleanHtml(html), images: [], docs: [], links: [], children: [] };
}
function firstFreeSlot(n) {
    const used = new Set((n.children || []).map(c => c.slot));
    let s = 1; while (used.has(s) && s <= SLOT_COUNT) s++;
    if (s > SLOT_COUNT) throw new Error('all slots full (54/54)');
    return s;
}
async function getNb(id) { return api('notebooks/' + encodeURIComponent(id)); }
async function putRoot(id, root) { return api('notebooks/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ root }) }); }

/* ================================================== PİYASA VERİSİ (DexScreener)
   Halka açık, anahtarsız, SALT-OKUNUR veri API'si. Bu köprü hiçbir platformda
   emir GÖNDERMEZ — strateji değerlendirmesi ve öneri üretimi içindir;
   işlemi kullanıcı kendi platformunda (TradingView/Robinhood/DEX) yapar.   */
const DEX_BASE = (process.env.DEX_API_BASE || 'https://api.dexscreener.com').replace(/\/+$/, '');
async function dexFetch(path) {
    const res = await fetch(DEX_BASE + path, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('DexScreener ' + res.status);
    return res.json();
}
function fmtPair(p) {
    return {
        pair: (p.baseToken && p.baseToken.symbol) + '/' + (p.quoteToken && p.quoteToken.symbol),
        chain: p.chainId, dex: p.dexId,
        priceUsd: p.priceUsd != null ? +p.priceUsd : null,
        priceChangePct: p.priceChange || {},          // {m5,h1,h6,h24}
        volumeUsd: p.volume || {},                    // {m5,h1,h6,h24}
        liquidityUsd: p.liquidity ? p.liquidity.usd : null,
        txns24h: p.txns ? p.txns.h24 : null,          // {buys,sells}
        fdvUsd: p.fdv != null ? p.fdv : null,
        pairAddress: p.pairAddress, url: p.url
    };
}

/* strateji ağacı → "iç içe fonksiyon" görünümü: her düğüm bir fonksiyon,
   gövdesi koşul/eylem satırları, çocukları alt fonksiyonlardır */
function strategyView(n, addr, depth, lines) {
    const pad = '  '.repeat(depth);
    lines.push(pad + addr + '  ' + (n.label || 'untitled') + '()' +
        ((n.links || []).length ? '  [🕳 ' + n.links.length + ' link(s)]' : ''));
    const body = htmlToText(n.html);
    if (body) body.split('\n').forEach(l => { if (l.trim()) lines.push(pad + '   | ' + l.trim()); });
    for (const c of (n.children || [])) strategyView(c, addr + '.' + c.slot, depth + 1, lines);
    return lines;
}
/* kategori zincirini bul/oluştur (file_note ve trade günlüğü paylaşır) */
function ensureCategory(root, segs) {
    let node = root, addr = '0';
    for (const seg of segs) {
        node.children = node.children || [];
        let child = node.children.find(c => (c.label || '').trim().toLowerCase() === seg.toLowerCase());
        if (!child) { child = newNode(seg, firstFreeSlot(node)); node.children.push(child); }
        node = child; addr += '.' + node.slot;
    }
    return { node, addr };
}

/* ---------------------------------------- paylaşım erişimi (herkese açık) */
async function getShare(ref) {
    const m = /[?&]s=([a-f0-9]+)/.exec(String(ref)) || /^([a-f0-9]{8,})$/.exec(String(ref).trim());
    if (!m) throw new Error('invalid share reference — pass an id or a ?s=... URL');
    const res = await fetch(BASE + '/api/share/' + m[1]); // link = yetki, oturum gerekmez
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || 'share ' + res.status);
    return j;
}

/* ================================================= CONTRACTION HIERARCHIES ==
   Paylaşılan haritada rota bulma: düğümler = notlar, kenarlar = ağaç
   (ebeveyn-çocuk) bağları + solucan delikleri (hepsi 1 sıçrama).
   Ön işlem: düğümler önem sırasıyla (kenar farkı, gevşek yeniden
   değerlendirme) daraltılır; tanık araması daha kısa yol bulamazsa kısayol
   eklenir. Sorgu: yalnız rütbesi artan kenarlarda iki yönlü Dijkstra;
   buluşma düğümünden kısayollar orijinal kenarlara açılır.                */
function buildCH(n, edges) {
    const g = Array.from({ length: n }, () => new Map()); // u → Map(v → {w, via})
    const addEdge = (u, v, w, via) => { const e = g[u].get(v); if (!e || e.w > w) g[u].set(v, { w, via }); };
    for (const [u, v] of edges) { addEdge(u, v, 1, -1); addEdge(v, u, 1, -1); }
    const rank = new Array(n).fill(-1);

    function limitedDijkstra(src, skip, limit) { // tanık araması: skip hariç
        const dist = new Map([[src, 0]]), pq = [[0, src]];
        let guard = 0;
        while (pq.length && guard++ < 4000) {
            let bi = 0; for (let i = 1; i < pq.length; i++) if (pq[i][0] < pq[bi][0]) bi = i;
            const [d, x] = pq.splice(bi, 1)[0];
            if (d > (dist.get(x) ?? Infinity) || d >= limit) continue;
            for (const [y, e] of g[x]) {
                if (y === skip || rank[y] >= 0) continue;
                const nd = d + e.w;
                if (nd < (dist.get(y) ?? Infinity)) { dist.set(y, nd); pq.push([nd, y]); }
            }
        }
        return dist;
    }
    function contract(c, dry) { // dönüş: gereken kısayol sayısı
        const nb = [...g[c]].filter(([v]) => rank[v] < 0);
        let added = 0;
        const maxW = nb.length ? Math.max(...nb.map(([, e]) => e.w)) : 0;
        for (let i = 0; i < nb.length; i++) {
            const [u, eu] = nb[i];
            const dist = limitedDijkstra(u, c, eu.w + maxW + 1);
            for (let j = i + 1; j < nb.length; j++) {
                const [v, ev] = nb[j];
                const w = eu.w + ev.w;
                if ((dist.get(v) ?? Infinity) > w) { // tanık yok → kısayol şart
                    added++;
                    if (!dry) { addEdge(u, v, w, c); addEdge(v, u, w, c); }
                }
            }
        }
        return added;
    }
    /* önem kuyruğu: kenar farkı (eklenen kısayol − silinen kenar) */
    const prio = v => contract(v, true) - [...g[v]].filter(([x]) => rank[x] < 0).length;
    const pq = []; for (let v = 0; v < n; v++) pq.push([prio(v), v]);
    pq.sort((a, b) => a[0] - b[0]);
    let r = 0;
    while (pq.length) {
        const v = pq.shift()[1];
        const np = prio(v); // gevşek güncelleme: bayatladıysa geri koy
        if (pq.length && np > pq[0][0]) {
            let lo = 0, hi = pq.length;
            while (lo < hi) { const m = (lo + hi) >> 1; if (pq[m][0] < np) lo = m + 1; else hi = m; }
            pq.splice(lo, 0, [np, v]);
            continue;
        }
        contract(v, false); rank[v] = r++;
    }

    function unpack(u, v, out) { // kısayol → orijinal kenar dizisi
        const e = g[u].get(v);
        if (!e || e.via < 0) { out.push(v); return; }
        unpack(u, e.via, out); unpack(e.via, v, out);
    }
    function query(s, t) {
        if (s === t) return [s];
        const D = [new Map([[s, 0]]), new Map([[t, 0]])], P = [new Map(), new Map()];
        const Q = [[[0, s]], [[0, t]]];
        let best = Infinity, meet = -1;
        while (Q[0].length || Q[1].length) {
            for (const side of [0, 1]) {
                const q = Q[side]; if (!q.length) continue;
                let bi = 0; for (let i = 1; i < q.length; i++) if (q[i][0] < q[bi][0]) bi = i;
                const [d, u] = q.splice(bi, 1)[0];
                if (d > (D[side].get(u) ?? Infinity) || d >= best) continue;
                const o = D[1 - side].get(u);
                if (o != null && d + o < best) { best = d + o; meet = u; }
                for (const [v, e] of g[u]) {
                    if (rank[v] <= rank[u]) continue; // yalnız yukarı
                    const nd = d + e.w;
                    if (nd < (D[side].get(v) ?? Infinity)) { D[side].set(v, nd); P[side].set(v, u); q.push([nd, v]); }
                }
            }
            const low = Math.min(...[0, 1].map(s2 => Q[s2].length ? Math.min(...Q[s2].map(x => x[0])) : Infinity));
            if (low >= best) break;
        }
        if (meet < 0) return null;
        const up = []; for (let u = meet; u !== undefined; u = P[0].get(u)) up.push(u);
        up.reverse();
        const down = []; for (let u = P[1].get(meet); u !== undefined; u = P[1].get(u)) down.push(u);
        const coarse = up.concat(down);
        const path = [coarse[0]];
        for (let i = 1; i < coarse.length; i++) unpack(coarse[i - 1], coarse[i], path);
        return path;
    }
    return { query };
}

/* paylaşım ağacı → grafik (adresler, ağaç kenarları, solucan delikleri) + CH */
const shareCache = new Map(); // sid → {share, addrs, meta, worm, ch}
async function shareIndex(ref) {
    const share = await getShare(ref);
    if (shareCache.has(share.id)) return shareCache.get(share.id);
    const addrs = [], meta = [], idOf = new Map(), edges = [], worm = new Set();
    (function walk(node, addr, parentIdx) {
        const idx = addrs.length;
        addrs.push(addr); meta.push(node);
        if (node.id) idOf.set(node.id, idx);
        if (parentIdx >= 0) edges.push([parentIdx, idx]);
        for (const c of (node.children || [])) walk(c, addr + '.' + c.slot, idx);
    })(share.root, '0', -1);
    for (let i = 0; i < meta.length; i++)
        for (const id of (meta[i].links || [])) {
            const j = idOf.get(String(id).includes(':') ? String(id).split(':').pop() : id);
            if (j != null && j > i) { edges.push([i, j]); worm.add(i + ':' + j); worm.add(j + ':' + i); }
        }
    if (addrs.length > 20000) throw new Error('share too large (' + addrs.length + ' nodes)');
    const entry = { share, addrs, meta, worm, ch: buildCH(addrs.length, edges) };
    shareCache.set(share.id, entry);
    return entry;
}
function fmtRoute(path, meta, addrs, worm) {
    const hops = path.length - 1;
    let worms = 0, s = addrs[path[0]] + ' (' + (meta[path[0]].label || 'untitled') + ')';
    for (let i = 1; i < path.length; i++) {
        const isWorm = worm.has(path[i - 1] + ':' + path[i]);
        if (isWorm) worms++;
        s += (isWorm ? ' 🕳→ ' : ' → ') + addrs[path[i]] + ' (' + (meta[path[i]].label || 'untitled') + ')';
    }
    return { hops, wormholes: worms, route: s };
}

/* ------------------------------------------------------------------ araçlar */
const TOOLS = [
    {
        name: 'list_notebooks',
        description: 'Lists the user\'s notebooks (id, name, last update).',
        inputSchema: { type: 'object', properties: {}, required: [] },
        run: async () => api('notebooks')
    },
    {
        name: 'get_outline',
        description: 'Returns the structure of a notebook (or subtree) as an addressed text outline. Addresses look like "0.12.3" and are used by the other tools.',
        inputSchema: { type: 'object', properties: {
            notebook_id: { type: 'string', description: 'id from list_notebooks output' },
            address: { type: 'string', description: 'Starting node address (default "0" = root)' },
            depth: { type: 'number', description: 'Depth to show (default 4)' }
        }, required: ['notebook_id'] },
        run: async a => {
            const nb = await getNb(a.notebook_id);
            const n = nodeAt(nb.root, a.address || '0');
            if (!n) throw new Error('address not found: ' + a.address);
            return nb.name + '\n' + outline(n, a.address || '0', 0, a.depth != null ? a.depth : 4).join('\n');
        }
    },
    {
        name: 'read_note',
        description: 'Returns the title, body text, attachments and children of the note at an address.',
        inputSchema: { type: 'object', properties: {
            notebook_id: { type: 'string' },
            address: { type: 'string', description: 'Note address, e.g. "0.12"' }
        }, required: ['notebook_id', 'address'] },
        run: async a => {
            const nb = await getNb(a.notebook_id);
            const n = nodeAt(nb.root, a.address);
            if (!n) throw new Error('address not found: ' + a.address);
            /* bağlantılar: aynı defterdekiler adres/başlıkla çözülür,
               defterler arası olanlar "defterId:düğümId" olarak listelenir */
            const byId = new Map();
            (function idx(x, ad) { if (x.id) byId.set(x.id, { address: ad, title: x.label });
                for (const c of (x.children || [])) idx(c, ad + '.' + c.slot); })(nb.root, '0');
            const links = (n.links || []).map(l => {
                const cross = l.includes(':');
                const hit = byId.get(cross ? l.split(':').pop() : l);
                return hit ? Object.assign({ raw: l }, hit)
                           : { raw: l, cross_notebook: cross ? l.split(':')[0] : undefined };
            });
            return { address: a.address, title: n.label, text: stripTags(n.html), html: n.html,
                     children: (n.children || []).map(c => ({ address: a.address + '.' + c.slot, title: c.label })),
                     images: (n.images || []).map(x => x.name), docs: (n.docs || []).map(x => x.name),
                     links };
        }
    },
    {
        name: 'add_note',
        description: 'Adds a new note under the given parent address. If slot (1-54) is omitted, the first free slot is used. Returns the new note\'s address.',
        inputSchema: { type: 'object', properties: {
            notebook_id: { type: 'string' },
            parent_address: { type: 'string', description: 'Parent note address, "0" for root' },
            title: { type: 'string' },
            html: { type: 'string', description: 'Optional body (allowed tags: h1,h2,p,b,i,ul,li…)' },
            slot: { type: 'number', description: 'İsteğe bağlı yuva numarası 1-54' }
        }, required: ['notebook_id', 'parent_address', 'title'] },
        run: async a => {
            const nb = await getNb(a.notebook_id);
            const p = nodeAt(nb.root, a.parent_address);
            if (!p) throw new Error('ebeveyn adresi bulunamadı: ' + a.parent_address);
            p.children = p.children || [];
            let slot = a.slot;
            if (slot != null) {
                if (!(slot >= 1 && slot <= SLOT_COUNT)) throw new Error('slot must be between 1 and ' + SLOT_COUNT);
                if (p.children.some(c => c.slot === slot)) throw new Error('slot occupied: ' + slot);
            } else slot = firstFreeSlot(p);
            p.children.push(newNode(a.title, slot, a.html));
            await putRoot(a.notebook_id, nb.root);
            return { ok: true, address: a.parent_address + '.' + slot, title: a.title };
        }
    },
    {
        name: 'update_note',
        description: 'Updates the title and/or body of the note at an address.',
        inputSchema: { type: 'object', properties: {
            notebook_id: { type: 'string' },
            address: { type: 'string' },
            title: { type: 'string' },
            html: { type: 'string' }
        }, required: ['notebook_id', 'address'] },
        run: async a => {
            const nb = await getNb(a.notebook_id);
            const n = nodeAt(nb.root, a.address);
            if (!n) throw new Error('address not found: ' + a.address);
            if (a.title != null) n.label = String(a.title).slice(0, 200);
            if (a.html != null) n.html = cleanHtml(a.html);
            await putRoot(a.notebook_id, nb.root);
            return { ok: true, address: a.address, title: n.label };
        }
    },
    {
        name: 'delete_note',
        description: 'Deletes the note at an address (with its subtree). Root ("0") cannot be deleted.',
        inputSchema: { type: 'object', properties: {
            notebook_id: { type: 'string' },
            address: { type: 'string' }
        }, required: ['notebook_id', 'address'] },
        run: async a => {
            const pa = parentAddr(a.address);
            if (!pa) throw new Error('root cannot be deleted');
            const nb = await getNb(a.notebook_id);
            const p = nodeAt(nb.root, pa);
            const slot = +String(a.address).split('.').pop();
            if (!p || !(p.children || []).some(c => c.slot === slot)) throw new Error('address not found: ' + a.address);
            p.children = p.children.filter(c => c.slot !== slot);
            await putRoot(a.notebook_id, nb.root);
            return { ok: true, deleted: a.address };
        }
    },
    {
        name: 'search_notes',
        description: 'Searches titles and body text in a notebook; returns matching notes\' addresses.',
        inputSchema: { type: 'object', properties: {
            notebook_id: { type: 'string' },
            query: { type: 'string' }
        }, required: ['notebook_id', 'query'] },
        run: async a => {
            const nb = await getNb(a.notebook_id);
            const q = String(a.query).toLowerCase(), out = [];
            (function walk(n, addr) {
                const body = stripTags(n.html).toLowerCase();
                const title = (n.label || '').toLowerCase();
                if (title.includes(q) || body.includes(q)) {
                    const i = body.indexOf(q);
                    out.push({ address: addr, title: n.label,
                               snippet: i >= 0 ? '…' + stripTags(n.html).slice(Math.max(0, i - 14), i + q.length + 26) + '…' : '' });
                }
                if (out.length < 40) for (const c of (n.children || [])) walk(c, addr + '.' + c.slot);
            })(nb.root, '0');
            return out.length ? out : 'no results: "' + a.query + '"';
        }
    },
    {
        name: 'create_notebook',
        description: 'Creates a new empty notebook.',
        inputSchema: { type: 'object', properties: {
            name: { type: 'string' }
        }, required: ['name'] },
        run: async a => {
            const r = await api('notebooks', { method: 'POST', body: JSON.stringify({
                name: a.name, root: { id: 'root', label: 'Main Hub', type: 'macro_goal', size: 5,
                                      slot: null, html: '', images: [], docs: [], links: [], children: [] } }) });
            return { ok: true, id: r.id, name: r.name };
        }
    },
    {
        name: 'link_notes',
        description: 'Links two notes with a bidirectional wormhole — Obsidian-style. With target_notebook_id, notes in DIFFERENT notebooks are linked (cross-notebook bridge), turning notebooks into one multi-dimensional neural network/brain. Linking related concepts (e.g. "Calculus" ↔ "Physics/Motion") strengthens the knowledge graph.',
        inputSchema: { type: 'object', properties: {
            notebook_id: { type: 'string' },
            address: { type: 'string', description: 'Source note address' },
            target_address: { type: 'string', description: 'Target note address' },
            target_notebook_id: { type: 'string', description: 'Target notebook id if the target lives in another notebook' }
        }, required: ['notebook_id', 'address', 'target_address'] },
        run: async a => {
            const tid = a.target_notebook_id || a.notebook_id;
            const same = tid === a.notebook_id;
            const nbA = await getNb(a.notebook_id);
            const nbB = same ? nbA : await getNb(tid);
            const A = nodeAt(nbA.root, a.address), B = nodeAt(nbB.root, a.target_address);
            if (!A) throw new Error('source address not found: ' + a.address);
            if (!B) throw new Error('target address not found: ' + a.target_address);
            if (A === B) throw new Error('a note cannot link to itself');
            if (!A.id || !B.id) throw new Error('node ids are missing');
            A.links = A.links || []; B.links = B.links || [];
            const refB = same ? B.id : tid + ':' + B.id;
            const refA = same ? A.id : a.notebook_id + ':' + A.id;
            if (!A.links.includes(refB)) A.links.push(refB);
            if (!B.links.includes(refA)) B.links.push(refA);
            await putRoot(a.notebook_id, nbA.root);
            if (!same) await putRoot(tid, nbB.root);
            return { ok: true, linked: (A.label || a.address) + ' ⇄ ' + (B.label || a.target_address),
                     cross_notebook: !same };
        }
    },
    {
        name: 'file_note',
        description: 'Files conversations, code solutions and learned facts into a HIERARCHICAL CATEGORY — the primary recording tool for language models. category_path is a "/"-separated chain (e.g. "Courses/Math/Calculus/Calculus1 Notes" or "Coding/Python/Web Scraping"); missing category nodes are created automatically, existing ones are reused. Without a notebook, the "Claude Universe" notebook is used (created if absent). Returns the new note\'s address.',
        inputSchema: { type: 'object', properties: {
            category_path: { type: 'string', description: 'Category chain, "/"-separated — e.g. "Courses/Math/Calculus/Calculus1 Notes"' },
            title: { type: 'string', description: 'Note title' },
            html: { type: 'string', description: 'Optional body (allowed tags: h1,h2,p,b,i,ul,li…)' },
            notebook: { type: 'string', description: 'Notebook name (default "Claude Universe"; created if absent)' }
        }, required: ['category_path', 'title'] },
        run: async a => {
            const name = (a.notebook || 'Claude Universe').trim();
            const list = await api('notebooks');
            let nbMeta = list.find(x => (x.name || '').trim().toLowerCase() === name.toLowerCase());
            if (!nbMeta) nbMeta = await api('notebooks', { method: 'POST', body: JSON.stringify({
                name, root: { id: 'root', label: 'Main Hub', type: 'macro_goal', size: 5,
                              slot: null, html: '', images: [], docs: [], links: [], children: [] } }) });
            const nb = await getNb(nbMeta.id);
            const segs = String(a.category_path || '').split('/').map(s => s.trim()).filter(Boolean);
            if (!segs.length) throw new Error('category_path is empty — e.g. "Courses/Math"');
            const { node, addr } = ensureCategory(nb.root, segs);
            node.children = node.children || [];
            const slot = firstFreeSlot(node);
            node.children.push(newNode(a.title, slot, a.html));
            await putRoot(nbMeta.id, nb.root);
            return { ok: true, notebook: name, notebook_id: nbMeta.id,
                     category: segs.join('/'), address: addr + '.' + slot, title: a.title };
        }
    },
    {
        name: 'get_market',
        description: 'Fetches LIVE market data from the public DexScreener API (read-only, no key). query can be a token symbol, pair ("SOL/USDC") or token address; returns the top pairs by liquidity with price, 5m/1h/6h/24h change %, volume, liquidity, buy/sell counts. Use this to evaluate the user\'s strategy notes against real market movement. This tool NEVER places orders.',
        inputSchema: { type: 'object', properties: {
            query: { type: 'string', description: 'Symbol, pair or token address, e.g. "SOL/USDC", "PEPE", "0x..."' },
            pair: { type: 'string', description: 'Exact pair as "chainId/pairAddress" (from a previous result) for a precise refresh' },
            limit: { type: 'number', description: 'Max pairs to return (default 5)' }
        }, required: [] },
        run: async a => {
            if (a.pair) {
                const [chain, addr] = String(a.pair).split('/');
                const j = await dexFetch('/latest/dex/pairs/' + encodeURIComponent(chain) + '/' + encodeURIComponent(addr));
                const list = (j.pairs || (j.pair ? [j.pair] : [])).map(fmtPair);
                if (!list.length) throw new Error('pair not found: ' + a.pair);
                return { asOf: new Date().toISOString(), pairs: list };
            }
            if (!a.query) throw new Error('pass query or pair');
            const j = await dexFetch('/latest/dex/search?q=' + encodeURIComponent(a.query));
            const list = (j.pairs || [])
                .sort((x, y) => ((y.liquidity && y.liquidity.usd) || 0) - ((x.liquidity && x.liquidity.usd) || 0))
                .slice(0, a.limit || 5).map(fmtPair);
            return list.length ? { asOf: new Date().toISOString(), pairs: list }
                               : 'no pairs found for "' + a.query + '"';
        }
    },
    {
        name: 'read_strategy',
        description: 'Reads the user\'s trading strategy notebook as a NESTED-FUNCTION view: every note is a function, its body lines are conditions/actions, children are sub-functions. Interpret it top-down — descend ONLY into branches whose conditions match current market data (from get_market), like a call stack. Default notebook: the one named "Strategy"/"Strateji" (or whose root is). Returns the full tree with bodies.',
        inputSchema: { type: 'object', properties: {
            notebook: { type: 'string', description: 'Notebook name or id (default: auto-detect "Strategy")' },
            address: { type: 'string', description: 'Start from this subtree (default "0")' }
        }, required: [] },
        run: async a => {
            const list = await api('notebooks');
            let meta = null;
            if (a.notebook)
                meta = list.find(x => x.id === a.notebook) ||
                       list.find(x => (x.name || '').trim().toLowerCase() === String(a.notebook).trim().toLowerCase());
            else meta = list.find(x => /strateji|strategy/i.test(x.name || ''));
            let nb = meta ? await getNb(meta.id) : null;
            if (!nb && !a.notebook) { // kök etiketi "Strategy" olan defteri ara
                for (const m of list) {
                    const cand = await getNb(m.id);
                    if (/strateji|strategy/i.test(cand.root.label || '')) { nb = cand; meta = m; break; }
                }
            }
            if (!nb) throw new Error('strategy notebook not found — notebooks: ' +
                (list.map(x => x.name).join(', ') || 'none') + '. Pass notebook, or name one "Strategy".');
            const start = nodeAt(nb.root, a.address || '0');
            if (!start) throw new Error('address not found: ' + a.address);
            return 'STRATEGY: ' + meta.name + ' (notebook_id: ' + meta.id + ')\n' +
                'Read as nested functions — descend only into branches whose conditions match the market:\n\n' +
                strategyView(start, a.address || '0', 0, []).join('\n');
        }
    },
    {
        name: 'log_trade_decision',
        description: 'Files a trade RECOMMENDATION into the "Trade Journal/<SYMBOL>" category and (optionally) wormhole-links it to the strategy node that fired, so every decision is traceable on the brain graph. This is a paper record — the user executes manually on their platform (TradingView/Robinhood/DEX). Call it after evaluating the strategy with read_strategy + get_market.',
        inputSchema: { type: 'object', properties: {
            symbol: { type: 'string', description: 'e.g. "SOL/USDC"' },
            action: { type: 'string', description: 'RECOMMENDATION: buy / sell / hold / watch / reduce…' },
            reasoning: { type: 'string', description: 'Why — which conditions matched' },
            route: { type: 'string', description: 'Path of fired strategy functions, e.g. "Strategy → Trend → Breakout"' },
            market_snapshot: { type: 'string', description: 'Short market data summary used for the decision' },
            fired_address: { type: 'string', description: 'Address of the strategy node that fired (gets a wormhole link)' },
            notebook: { type: 'string', description: 'Notebook name/id (default: the strategy notebook)' }
        }, required: ['symbol', 'action', 'reasoning'] },
        run: async a => {
            const list = await api('notebooks');
            const meta = (a.notebook
                ? (list.find(x => x.id === a.notebook) ||
                   list.find(x => (x.name || '').trim().toLowerCase() === String(a.notebook).trim().toLowerCase()))
                : list.find(x => /strateji|strategy/i.test(x.name || ''))) || list[0];
            if (!meta) throw new Error('no notebook found');
            const nb = await getNb(meta.id);
            const { node } = ensureCategory(nb.root, ['Trade Journal', String(a.symbol).toUpperCase()]);
            node.children = node.children || [];
            const slot = firstFreeSlot(node);
            const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
            const html = '<h2>' + cleanHtml(String(a.action).toUpperCase() + ' — ' + a.symbol) + '</h2>' +
                '<p>' + cleanHtml(a.reasoning) + '</p>' +
                (a.route ? '<p>Route: ' + cleanHtml(a.route) + '</p>' : '') +
                (a.market_snapshot ? '<p>Market: ' + cleanHtml(a.market_snapshot) + '</p>' : '') +
                '<p>' + stamp + ' UTC · recommendation only — not executed</p>';
            const note = newNode(String(a.action).toUpperCase() + ' ' + a.symbol + ' · ' + stamp, slot, html);
            node.children.push(note);
            let linked = false;
            if (a.fired_address) { // ateşlenen strateji düğümüne solucan deliği
                const fired = nodeAt(nb.root, a.fired_address);
                if (fired && fired.id) {
                    fired.links = fired.links || []; note.links = note.links || [];
                    if (!fired.links.includes(note.id)) fired.links.push(note.id);
                    if (!note.links.includes(fired.id)) note.links.push(fired.id);
                    linked = true;
                }
            }
            await putRoot(meta.id, nb.root);
            const jaddr = (function find(n, ad) { for (const c of (n.children || [])) {
                if (c === note) return ad + '.' + c.slot;
                const r = find(c, ad + '.' + c.slot); if (r) return r; } return null; })(nb.root, '0');
            return { ok: true, notebook: meta.name, address: jaddr,
                     linked_to_strategy_node: linked ? a.fired_address : null,
                     note: 'recommendation logged — user executes manually' };
        }
    },
    {
        name: 'read_share',
        description: 'Reads the map behind a public share link (?s=... URL or share id): name, focus and addressed outline. No login needed — maps shared by others are readable too.',
        inputSchema: { type: 'object', properties: {
            share: { type: 'string', description: 'Share URL or id' },
            depth: { type: 'number', description: 'Outline depth (default 4)' }
        }, required: ['share'] },
        run: async a => {
            const s = await getShare(a.share);
            return s.name + ' (focus: ' + (s.focus || '0') + ')\n' +
                outline(s.root, '0', 0, a.depth != null ? a.depth : 4).join('\n');
        }
    },
    {
        name: 'search_share',
        description: 'Searches a shared map and, for every hit, computes the SHORTEST ROUTE from the start to the target with Contraction Hierarchies (bidirectional Dijkstra with shortcut preprocessing over tree bonds + wormholes). Steps marked "🕳→" pass through a wormhole. No login needed.',
        inputSchema: { type: 'object', properties: {
            share: { type: 'string', description: 'Share URL or id' },
            query: { type: 'string', description: 'Text to search (title + body)' },
            from_address: { type: 'string', description: 'Route start (default: the share\'s focus)' }
        }, required: ['share', 'query'] },
        run: async a => {
            const { share, addrs, meta, worm, ch } = await shareIndex(a.share);
            const q = String(a.query).toLowerCase();
            const fromAddr = a.from_address || share.focus || '0';
            const src = addrs.indexOf(fromAddr);
            if (src < 0) throw new Error('start address not in the share: ' + fromAddr);
            const hits = [];
            for (let i = 0; i < meta.length && hits.length < 15; i++) {
                const body = stripTags(meta[i].html).toLowerCase();
                const title = (meta[i].label || '').toLowerCase();
                if (!title.includes(q) && !body.includes(q)) continue;
                const path = ch.query(src, i);
                const bi = body.indexOf(q);
                hits.push(Object.assign(
                    { address: addrs[i], title: meta[i].label,
                      snippet: bi >= 0 ? '…' + stripTags(meta[i].html).slice(Math.max(0, bi - 14), bi + q.length + 26) + '…' : '' },
                    path ? fmtRoute(path, meta, addrs, worm) : { route: 'no route' }));
            }
            return hits.length ? hits : 'no results: "' + a.query + '"';
        }
    },
    {
        name: 'create_share_link',
        description: 'Creates a public share link for the subtree at an address.',
        inputSchema: { type: 'object', properties: {
            notebook_id: { type: 'string' },
            address: { type: 'string', description: 'Address of the subtree to share (default "0")' }
        }, required: ['notebook_id'] },
        run: async a => {
            const nb = await getNb(a.notebook_id);
            const n = nodeAt(nb.root, a.address || '0');
            if (!n) throw new Error('address not found: ' + a.address);
            const r = await api('share', { method: 'POST', body: JSON.stringify({ name: n.label || nb.name, root: n, focus: '0' }) });
            return { ok: true, url: BASE + r.url };
        }
    }
];

/* --------------------------------------- MCP stdio: satır ayrılmış JSON-RPC */
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
async function handle(line) {
    let m; try { m = JSON.parse(line); } catch (e) { return; }
    const { id, method, params } = m;
    try {
        if (method === 'initialize')
            return send({ jsonrpc: '2.0', id, result: {
                protocolVersion: (params && params.protocolVersion) || '2024-11-05',
                capabilities: { tools: {} },
                serverInfo: { name: 'not-evreni', version: '1.1.0' },
                instructions: 'This server connects to the user\'s 3D Quantum Note Universe. ' +
                    'File every noteworthy conversation, code solution and learned fact with file_note ' +
                    'into a HIERARCHICAL category — e.g. "Courses/Math/Calculus/Calculus1 Notes", ' +
                    '"Coding/Python/Web Scraping". First explore existing categories with get_outline and ' +
                    'REUSE a category that means the same thing; do not duplicate categories. ' +
                    'Link related concepts with link_notes (Obsidian-style; cross-notebook with ' +
                    'target_notebook_id) — notes then weave into a multi-dimensional neural network. ' +
                    'The user also edits the universe by hand — respect the existing structure. ' +
                    'Browse shared maps (?s=... links) with read_share and search them with search_share; ' +
                    'routes are computed with Contraction Hierarchies and 🕳→ steps are wormholes. ' +
                    'TRADING WORKFLOW (note-driven, Obsidian+Claude style): the user keeps a strategy ' +
                    'notebook whose notes are nested functions — read it with read_strategy, fetch live ' +
                    'market data with get_market, then walk the tree top-down like a call stack: descend ' +
                    'only into branches whose written conditions match the data, and report WHICH ' +
                    'sub-function fired and what it prescribes. Record every conclusion with ' +
                    'log_trade_decision (pass fired_address so the journal entry is wormhole-linked to ' +
                    'the strategy node). These are RECOMMENDATIONS: never claim to have executed a trade, ' +
                    'never promise profits, and remind the user they execute manually on their platform.' } });
        if (method && method.startsWith('notifications/')) return;
        if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
        if (method === 'tools/list')
            return send({ jsonrpc: '2.0', id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
        if (method === 'tools/call') {
            const t = TOOLS.find(x => x.name === params.name);
            if (!t) throw new Error('unknown tool: ' + params.name);
            const out = await t.run(params.arguments || {});
            return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 1) }] } });
        }
        if (id != null) send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'no such method: ' + method } });
    } catch (e) {
        if (method === 'tools/call')
            send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'ERROR: ' + e.message }], isError: true } });
        else if (id != null)
            send({ jsonrpc: '2.0', id, error: { code: -32000, message: e.message } });
    }
}
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) handle(line); }
});
process.stdin.on('end', () => process.exit(0));
