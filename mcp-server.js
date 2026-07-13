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
    if (!USER || !PASS) throw new Error('NOTE_USER ve NOTE_PASS ortam değişkenlerini ayarla (sunucu: ' + BASE + ')');
    try { await authCall('login'); }
    catch (e) {
        if (e.status === 401 && AUTO_REGISTER) await authCall('register');
        else throw new Error('giriş başarısız: ' + e.message + (e.status === 401 ? ' (yeni hesap için NOTE_REGISTER=1)' : ''));
    }
}
async function api(path, opts = {}) {
    await ensureAuth();
    const headers = { 'Content-Type': 'application/json', 'Cookie': cookie };
    if (opts.method && opts.method !== 'GET') headers['X-CSRF'] = csrf;
    const res = await fetch(BASE + '/api/' + path, Object.assign({}, opts, { headers }));
    if (res.status === 401) { csrf = cookie = null; throw new Error('oturum düştü — tekrar dene'); }
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
/* sunucuya yazılan gövde: istemci sanitizer'ıyla aynı beyaz liste, öznitelik yok */
const ALLOWED = 'h1|h2|h3|p|br|b|strong|i|em|u|s|ul|ol|li|div|span|blockquote|code|pre';
function cleanHtml(h) {
    return String(h || '')
        .replace(new RegExp('<(?!\\/?(?:' + ALLOWED + ')\\b)[^>]*>', 'gi'), '')
        .replace(new RegExp('<(\\/?)(' + ALLOWED + ')\\b[^>]*>', 'gi'), '<$1$2>');
}
function outline(n, addr = '0', depth = 0, maxDepth = 4, lines = []) {
    lines.push('  '.repeat(depth) + addr + '  ' + (n.label || 'isimsiz') +
        ((n.children || []).length ? '  [' + n.children.length + ' alt]' : ''));
    if (depth < maxDepth)
        for (const c of (n.children || [])) outline(c, addr + '.' + c.slot, depth + 1, maxDepth, lines);
    else if ((n.children || []).length) lines.push('  '.repeat(depth + 1) + '… +' + n.children.length);
    return lines;
}
function newNode(label, slot, html) {
    return { id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
             label: label || 'isimsiz', type: 'micro_habit', size: 1, slot,
             html: cleanHtml(html), images: [], docs: [], links: [], children: [] };
}
function firstFreeSlot(n) {
    const used = new Set((n.children || []).map(c => c.slot));
    let s = 1; while (used.has(s) && s <= SLOT_COUNT) s++;
    if (s > SLOT_COUNT) throw new Error('tüm yuvalar dolu (54/54)');
    return s;
}
async function getNb(id) { return api('notebooks/' + encodeURIComponent(id)); }
async function putRoot(id, root) { return api('notebooks/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ root }) }); }

/* ---------------------------------------- paylaşım erişimi (herkese açık) */
async function getShare(ref) {
    const m = /[?&]s=([a-f0-9]+)/.exec(String(ref)) || /^([a-f0-9]{8,})$/.exec(String(ref).trim());
    if (!m) throw new Error('geçersiz paylaşım referansı — id ya da ?s=... URL ver');
    const res = await fetch(BASE + '/api/share/' + m[1]); // link = yetki, oturum gerekmez
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || 'paylaşım ' + res.status);
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
            const j = idOf.get(id);
            if (j != null && j > i) { edges.push([i, j]); worm.add(i + ':' + j); worm.add(j + ':' + i); }
        }
    if (addrs.length > 20000) throw new Error('paylaşım çok büyük (' + addrs.length + ' düğüm)');
    const entry = { share, addrs, meta, worm, ch: buildCH(addrs.length, edges) };
    shareCache.set(share.id, entry);
    return entry;
}
function fmtRoute(path, meta, addrs, worm) {
    const hops = path.length - 1;
    let worms = 0, s = addrs[path[0]] + ' (' + (meta[path[0]].label || 'isimsiz') + ')';
    for (let i = 1; i < path.length; i++) {
        const isWorm = worm.has(path[i - 1] + ':' + path[i]);
        if (isWorm) worms++;
        s += (isWorm ? ' 🕳→ ' : ' → ') + addrs[path[i]] + ' (' + (meta[path[i]].label || 'isimsiz') + ')';
    }
    return { hops, wormholes: worms, route: s };
}

/* ------------------------------------------------------------------ araçlar */
const TOOLS = [
    {
        name: 'list_notebooks',
        description: 'Kullanıcının not defterlerini listeler (id, ad, son güncelleme).',
        inputSchema: { type: 'object', properties: {}, required: [] },
        run: async () => api('notebooks')
    },
    {
        name: 'get_outline',
        description: 'Bir defterin (veya alt ağacın) yapısını adresli metin taslağı olarak döndürür. Adresler "0.12.3" biçimindedir ve diğer araçlarda kullanılır.',
        inputSchema: { type: 'object', properties: {
            notebook_id: { type: 'string', description: 'list_notebooks çıktısındaki id' },
            address: { type: 'string', description: 'Başlangıç düğümü adresi (varsayılan "0" = kök)' },
            depth: { type: 'number', description: 'Gösterilecek derinlik (varsayılan 4)' }
        }, required: ['notebook_id'] },
        run: async a => {
            const nb = await getNb(a.notebook_id);
            const n = nodeAt(nb.root, a.address || '0');
            if (!n) throw new Error('adres bulunamadı: ' + a.address);
            return nb.name + '\n' + outline(n, a.address || '0', 0, a.depth != null ? a.depth : 4).join('\n');
        }
    },
    {
        name: 'read_note',
        description: 'Adresteki notun başlığını, gövde metnini, eklerini ve alt notlarını döndürür.',
        inputSchema: { type: 'object', properties: {
            notebook_id: { type: 'string' },
            address: { type: 'string', description: 'Not adresi, örn. "0.12"' }
        }, required: ['notebook_id', 'address'] },
        run: async a => {
            const nb = await getNb(a.notebook_id);
            const n = nodeAt(nb.root, a.address);
            if (!n) throw new Error('adres bulunamadı: ' + a.address);
            return { address: a.address, title: n.label, text: stripTags(n.html), html: n.html,
                     children: (n.children || []).map(c => ({ address: a.address + '.' + c.slot, title: c.label })),
                     images: (n.images || []).map(x => x.name), docs: (n.docs || []).map(x => x.name),
                     wormholes: (n.links || []).length };
        }
    },
    {
        name: 'add_note',
        description: 'Verilen ebeveyn adresinin altına yeni not ekler. Yuva (slot 1-54) verilmezse ilk boş yuva kullanılır. Yeni notun adresini döndürür.',
        inputSchema: { type: 'object', properties: {
            notebook_id: { type: 'string' },
            parent_address: { type: 'string', description: 'Ebeveyn not adresi, kök için "0"' },
            title: { type: 'string' },
            html: { type: 'string', description: 'İsteğe bağlı gövde (izinli etiketler: h1,h2,p,b,i,ul,li…)' },
            slot: { type: 'number', description: 'İsteğe bağlı yuva numarası 1-54' }
        }, required: ['notebook_id', 'parent_address', 'title'] },
        run: async a => {
            const nb = await getNb(a.notebook_id);
            const p = nodeAt(nb.root, a.parent_address);
            if (!p) throw new Error('ebeveyn adresi bulunamadı: ' + a.parent_address);
            p.children = p.children || [];
            let slot = a.slot;
            if (slot != null) {
                if (!(slot >= 1 && slot <= SLOT_COUNT)) throw new Error('slot 1-' + SLOT_COUNT + ' arasında olmalı');
                if (p.children.some(c => c.slot === slot)) throw new Error('yuva dolu: ' + slot);
            } else slot = firstFreeSlot(p);
            p.children.push(newNode(a.title, slot, a.html));
            await putRoot(a.notebook_id, nb.root);
            return { ok: true, address: a.parent_address + '.' + slot, title: a.title };
        }
    },
    {
        name: 'update_note',
        description: 'Adresteki notun başlığını ve/veya gövdesini günceller.',
        inputSchema: { type: 'object', properties: {
            notebook_id: { type: 'string' },
            address: { type: 'string' },
            title: { type: 'string' },
            html: { type: 'string' }
        }, required: ['notebook_id', 'address'] },
        run: async a => {
            const nb = await getNb(a.notebook_id);
            const n = nodeAt(nb.root, a.address);
            if (!n) throw new Error('adres bulunamadı: ' + a.address);
            if (a.title != null) n.label = String(a.title).slice(0, 200);
            if (a.html != null) n.html = cleanHtml(a.html);
            await putRoot(a.notebook_id, nb.root);
            return { ok: true, address: a.address, title: n.label };
        }
    },
    {
        name: 'delete_note',
        description: 'Adresteki notu (alt ağacıyla birlikte) siler. Kök ("0") silinemez.',
        inputSchema: { type: 'object', properties: {
            notebook_id: { type: 'string' },
            address: { type: 'string' }
        }, required: ['notebook_id', 'address'] },
        run: async a => {
            const pa = parentAddr(a.address);
            if (!pa) throw new Error('kök silinemez');
            const nb = await getNb(a.notebook_id);
            const p = nodeAt(nb.root, pa);
            const slot = +String(a.address).split('.').pop();
            if (!p || !(p.children || []).some(c => c.slot === slot)) throw new Error('adres bulunamadı: ' + a.address);
            p.children = p.children.filter(c => c.slot !== slot);
            await putRoot(a.notebook_id, nb.root);
            return { ok: true, deleted: a.address };
        }
    },
    {
        name: 'search_notes',
        description: 'Defterde başlık ve gövde metninde arama yapar; eşleşen notların adreslerini döndürür.',
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
            return out.length ? out : 'sonuç yok: "' + a.query + '"';
        }
    },
    {
        name: 'create_notebook',
        description: 'Yeni boş not defteri oluşturur.',
        inputSchema: { type: 'object', properties: {
            name: { type: 'string' }
        }, required: ['name'] },
        run: async a => {
            const r = await api('notebooks', { method: 'POST', body: JSON.stringify({
                name: a.name, root: { id: 'root', label: 'Ana Merkez', type: 'macro_goal', size: 5,
                                      slot: null, html: '', images: [], docs: [], links: [], children: [] } }) });
            return { ok: true, id: r.id, name: r.name };
        }
    },
    {
        name: 'file_note',
        description: 'Konuşmaları, kod çözümlerini ve öğrenilen bilgileri HİYERARŞİK KATEGORİYE dosyalar — dil modelleri için birincil kayıt aracı. category_path "/" ile ayrılmış kategori zinciridir (örn. "Dersler/Matematik/Calculus/Calculus1 Notları" veya "Kodlama/Python/Web Scraping"); eksik kategori düğümleri otomatik oluşturulur, var olanlar yeniden kullanılır. Defter verilmezse "Claude Evreni" defteri kullanılır (yoksa yaratılır). Yeni notun adresini döndürür.',
        inputSchema: { type: 'object', properties: {
            category_path: { type: 'string', description: 'Kategori zinciri, "/" ayraçlı — örn. "Dersler/Matematik/Calculus/Calculus1 Notları"' },
            title: { type: 'string', description: 'Not başlığı' },
            html: { type: 'string', description: 'İsteğe bağlı gövde (izinli etiketler: h1,h2,p,b,i,ul,li…)' },
            notebook: { type: 'string', description: 'Defter adı (varsayılan "Claude Evreni"; yoksa oluşturulur)' }
        }, required: ['category_path', 'title'] },
        run: async a => {
            const name = (a.notebook || 'Claude Evreni').trim();
            const list = await api('notebooks');
            let nbMeta = list.find(x => (x.name || '').trim().toLowerCase() === name.toLowerCase());
            if (!nbMeta) nbMeta = await api('notebooks', { method: 'POST', body: JSON.stringify({
                name, root: { id: 'root', label: 'Ana Merkez', type: 'macro_goal', size: 5,
                              slot: null, html: '', images: [], docs: [], links: [], children: [] } }) });
            const nb = await getNb(nbMeta.id);
            const segs = String(a.category_path || '').split('/').map(s => s.trim()).filter(Boolean);
            if (!segs.length) throw new Error('category_path boş — örn. "Dersler/Matematik"');
            let node = nb.root, addr = '0';
            for (const seg of segs) { // kategori zinciri: bul ya da oluştur
                node.children = node.children || [];
                let child = node.children.find(c => (c.label || '').trim().toLowerCase() === seg.toLowerCase());
                if (!child) { child = newNode(seg, firstFreeSlot(node)); node.children.push(child); }
                node = child; addr += '.' + node.slot;
            }
            node.children = node.children || [];
            const slot = firstFreeSlot(node);
            node.children.push(newNode(a.title, slot, a.html));
            await putRoot(nbMeta.id, nb.root);
            return { ok: true, notebook: name, notebook_id: nbMeta.id,
                     category: segs.join('/'), address: addr + '.' + slot, title: a.title };
        }
    },
    {
        name: 'read_share',
        description: 'Herkese açık bir paylaşım linkindeki (?s=... URL ya da paylaşım id) haritayı okur: ad, odak ve adresli taslak. Oturum gerektirmez — başkasının paylaştığı haritalar da okunabilir.',
        inputSchema: { type: 'object', properties: {
            share: { type: 'string', description: 'Paylaşım URL\'i ya da id\'si' },
            depth: { type: 'number', description: 'Taslak derinliği (varsayılan 4)' }
        }, required: ['share'] },
        run: async a => {
            const s = await getShare(a.share);
            return s.name + ' (odak: ' + (s.focus || '0') + ')\n' +
                outline(s.root, '0', 0, a.depth != null ? a.depth : 4).join('\n');
        }
    },
    {
        name: 'search_share',
        description: 'Paylaşılan haritada metin arar ve her sonuç için başlangıç noktasından hedefe EN KISA ROTAYI Contraction Hierarchies ile hesaplar (ağaç bağları + solucan delikleri üzerinde, kısayol ön işlemli iki yönlü Dijkstra). Rota "🕳→" işaretli adımlarda solucan deliğinden geçer. Oturum gerektirmez.',
        inputSchema: { type: 'object', properties: {
            share: { type: 'string', description: 'Paylaşım URL\'i ya da id\'si' },
            query: { type: 'string', description: 'Aranacak metin (başlık + gövde)' },
            from_address: { type: 'string', description: 'Rota başlangıcı (varsayılan: paylaşımın odağı)' }
        }, required: ['share', 'query'] },
        run: async a => {
            const { share, addrs, meta, worm, ch } = await shareIndex(a.share);
            const q = String(a.query).toLowerCase();
            const fromAddr = a.from_address || share.focus || '0';
            const src = addrs.indexOf(fromAddr);
            if (src < 0) throw new Error('başlangıç adresi paylaşımda yok: ' + fromAddr);
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
                    path ? fmtRoute(path, meta, addrs, worm) : { route: 'rota yok' }));
            }
            return hits.length ? hits : 'sonuç yok: "' + a.query + '"';
        }
    },
    {
        name: 'create_share_link',
        description: 'Adresteki alt ağaç için herkese açık paylaşım linki üretir.',
        inputSchema: { type: 'object', properties: {
            notebook_id: { type: 'string' },
            address: { type: 'string', description: 'Paylaşılacak alt ağacın adresi (varsayılan "0")' }
        }, required: ['notebook_id'] },
        run: async a => {
            const nb = await getNb(a.notebook_id);
            const n = nodeAt(nb.root, a.address || '0');
            if (!n) throw new Error('adres bulunamadı: ' + a.address);
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
                instructions: 'Bu sunucu kullanıcının 3D Kuantum Not Evreni\'ne bağlanır. ' +
                    'Kayda değer her konuşmayı, kod çözümünü ve öğrenilen bilgiyi file_note ile ' +
                    'HİYERARŞİK kategoriye dosyala — örn. "Dersler/Matematik/Calculus/Calculus1 Notları", ' +
                    '"Kodlama/Python/Web Scraping". Önce get_outline ile mevcut kategorileri keşfet ve ' +
                    'aynı anlama gelen kategori zaten varsa ONU kullan; gereksiz kategori çoğaltma. ' +
                    'Kullanıcı evreni elle de düzenler — var olan yapıya saygı göster. ' +
                    'Paylaşılan haritalarda (?s=... linki) read_share ile gezin, search_share ile ara; ' +
                    'rotalar Contraction Hierarchies ile hesaplanır ve 🕳→ adımları solucan deliğidir.' } });
        if (method && method.startsWith('notifications/')) return;
        if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
        if (method === 'tools/list')
            return send({ jsonrpc: '2.0', id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
        if (method === 'tools/call') {
            const t = TOOLS.find(x => x.name === params.name);
            if (!t) throw new Error('bilinmeyen araç: ' + params.name);
            const out = await t.run(params.arguments || {});
            return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 1) }] } });
        }
        if (id != null) send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'yöntem yok: ' + method } });
    } catch (e) {
        if (method === 'tools/call')
            send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'HATA: ' + e.message }], isError: true } });
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
