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
async function getNb(id) { return api('notebooks/' + encodeURIComponent(id)); }
async function putRoot(id, root) { return api('notebooks/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ root }) }); }

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
            const used = new Set(p.children.map(c => c.slot));
            let slot = a.slot;
            if (slot != null) {
                if (!(slot >= 1 && slot <= SLOT_COUNT)) throw new Error('slot 1-' + SLOT_COUNT + ' arasında olmalı');
                if (used.has(slot)) throw new Error('yuva dolu: ' + slot);
            } else {
                slot = 1; while (used.has(slot) && slot <= SLOT_COUNT) slot++;
                if (slot > SLOT_COUNT) throw new Error('tüm yuvalar dolu (54/54)');
            }
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
                serverInfo: { name: 'not-evreni', version: '1.0.0' } } });
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
