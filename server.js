/* =============================================================================
   3D NOT EVRENİ — Sertleştirilmiş Backend (saf Node.js, sıfır bağımlılık)
   Çalıştır: node server.js  →  http://localhost:3000
   HTTPS:    TLS_KEY=key.pem TLS_CERT=cert.pem node server.js
             (üretimde reverse proxy arkasında COOKIE_SECURE=1 kullan)
   -----------------------------------------------------------------------------
   GÜVENLİK KATMANLARI
   • Kimlik: scrypt (tuzlu) parola özeti, timingSafeEqual, sayım-korumalı hatalar
   • Oturum: 32B rastgele token; depoda SHA-256 özeti tutulur (db sızarsa token yok)
             HttpOnly + SameSite=Strict (+ Secure) çerez, 7 gün kayan süre
   • CSRF:   mutasyonlarda oturuma bağlı X-CSRF başlığı zorunlu
   • Kaba kuvvet: kullanıcı+IP başına kilit (8 hata / 15 dk), IP hız sınırları
   • İzolasyon: defter/varlık/versiyon kayıtları kullanıcıya (uid) kilitli
   • Girdi:  derinlik/adet/alan sınırlı ağaç doğrulama, __proto__ temizleyen
             JSON reviver, gövde boyut sınırları (rota bazlı)
   • Başlıklar: CSP (script-src 'self'), nosniff, frame DENY, COOP/CORP, HSTS
   • İz:     data/audit.log — giriş/başarısız giriş/kilit olayları
   ============================================================================= */
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.log');
const SECURE = !!(process.env.COOKIE_SECURE || (process.env.TLS_KEY && process.env.TLS_CERT));

/* rota bazlı gövde sınırları */
const LIMIT_DEFAULT = 2 * 1024 * 1024;      // 2 MB — auth, share meta, versiyon
const LIMIT_TREE    = 16 * 1024 * 1024;     // 16 MB — defter ağacı (varlıksız)
const LIMIT_ASSET   = 32 * 1024 * 1024;     // 32 MB — tek varlık (görsel/belge)

/* ---------------------------------------------------------------- kalıcılık */
let db = { users: [], sessions: {}, notebooks: [], shares: {}, publicAssets: {} };
function loadDB() {
    try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch (e) {}
    for (const k of ['users', 'notebooks']) if (!Array.isArray(db[k])) db[k] = [];
    for (const k of ['sessions', 'shares', 'publicAssets']) if (!db[k] || typeof db[k] !== 'object') db[k] = {};
}
let saveTimer = null;
function saveDB() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const tmp = DB_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(db));
        fs.renameSync(tmp, DB_FILE); // atomik yazım
    }, 250);
}
function audit(ev, detail) {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.appendFileSync(AUDIT_FILE, JSON.stringify({ ts: new Date().toISOString(), ev, ...detail }) + '\n');
    } catch (e) {}
}
const rnd = n => crypto.randomBytes(n).toString('hex');
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

/* -------------------------------------------------------------- parola/oturum */
function hashPassword(pw) {
    const salt = rnd(16);
    const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
    return { salt, hash };
}
function verifyPassword(pw, rec) {
    if (!rec) { crypto.scryptSync(pw, 'dummy-salt', 64, { N: 16384, r: 8, p: 1 }); return false; } // sayım koruması: sabit maliyet
    const h = crypto.scryptSync(pw, rec.salt, 64, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(h, Buffer.from(rec.hash, 'hex'));
}
const SESSION_TTL = 7 * 24 * 3600 * 1000;
function createSession(uid) {
    const token = rnd(32);
    db.sessions[sha256(token)] = { uid, exp: Date.now() + SESSION_TTL, csrf: rnd(24) };
    saveDB();
    return token;
}
function getSession(req) {
    const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
    if (!m) return null;
    const key = sha256(m[1]);
    const s = db.sessions[key];
    if (!s) return null;
    if (s.exp < Date.now()) { delete db.sessions[key]; saveDB(); return null; }
    s.exp = Date.now() + SESSION_TTL; // kayan süre
    return { key, uid: s.uid, csrf: s.csrf };
}
function sessionCookie(token, kill) {
    return 'sid=' + (kill ? '' : token) +
        '; Path=/; HttpOnly; SameSite=Strict' +
        (SECURE ? '; Secure' : '') +
        '; Max-Age=' + (kill ? 0 : SESSION_TTL / 1000);
}

/* ------------------------------------------------------ hız sınırı / kilit */
const buckets = new Map(); // key → {n, reset}
function rateLimit(key, max, windowMs) {
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
    b.n++;
    return b.n <= max;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 60000).unref();
const fails = new Map(); // user@ip → {n, until}
function locked(key) { const f = fails.get(key); return !!(f && f.until > Date.now()); }
function recordFail(key, ip) {
    const f = fails.get(key) || { n: 0, until: 0 };
    f.n++;
    if (f.n >= 8) { f.until = Date.now() + 15 * 60000; f.n = 0; audit('lockout', { key, ip }); }
    fails.set(key, f);
}

/* ------------------------------------------------------------------ girdi */
function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        let size = 0; const chunks = [];
        req.on('data', c => {
            size += c.length;
            if (size > limit) { reject(new Error('payload too large')); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => {
            try {
                resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8'),
                    (k, v) => (k === '__proto__' || k === 'constructor' || k === 'prototype') ? undefined : v) : {});
            } catch (e) { reject(new Error('invalid json')); }
        });
        req.on('error', reject);
    });
}
const isStr = (v, max) => typeof v === 'string' && v.length <= max;
/* ağaç doğrulama: derinlik/düğüm/alan sınırları — DoS ve şişkin kayıt engeli */
function validateRoot(root) {
    let count = 0;
    (function walk(n, depth) {
        if (depth > 12) throw new Error('ağaç çok derin');
        if (++count > 50000) throw new Error('çok fazla düğüm');
        if (!n || typeof n !== 'object' || Array.isArray(n)) throw new Error('geçersiz düğüm');
        if (n.label != null && !isStr(n.label, 200)) throw new Error('label çok uzun');
        if (n.html != null && !isStr(n.html, 200000)) throw new Error('html çok uzun');
        for (const key of ['images', 'docs', 'links', 'children'])
            if (n[key] != null && (!Array.isArray(n[key]) || n[key].length > 500)) throw new Error(key + ' geçersiz');
        for (const a of (n.images || []).concat(n.docs || [])) {
            if (a && a.dataURL != null) throw new Error('varlıklar gömülemez; /api/assets kullan');
            if (a && a.assetId != null && !isStr(a.assetId, 40)) throw new Error('assetId geçersiz');
            if (a && a.name != null && !isStr(a.name, 200)) throw new Error('dosya adı çok uzun');
        }
        for (const l of (n.links || [])) if (!isStr(l, 64)) throw new Error('link id geçersiz');
        (n.children || []).forEach(c => walk(c, depth + 1));
    })(root, 0);
}
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const ASSET_MIME_RE = /^data:(image\/(png|jpe?g|gif|webp|avif|svg\+xml)|application\/(pdf|zip|json|vnd\.[\w.+-]{1,80}|msword|octet-stream)|text\/(plain|csv|markdown));?[a-zA-Z0-9=;,+\/-]*base64,/;

function emptyRoot() {
    return { id: 'root', label: 'Ana Merkez', type: 'macro_goal', size: 5,
             slot: null, html: '', images: [], docs: [], links: [], children: [] };
}
function walkAssetIds(root, out) {
    for (const a of (root.images || []).concat(root.docs || [])) if (a && a.assetId) out.add(a.assetId);
    (root.children || []).forEach(c => walkAssetIds(c, out));
    return out;
}
function assetPath(id) { return path.join(DATA_DIR, 'assets', id + '.json'); }

/* ------------------------------------------------------------------ yanıt */
function sendJSON(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
}
/* index.html'deki satır içi <script> blokları (import map) CSP tarafından
   engellenmesin diye sha256 hash'leri script-src'e eklenir. mtime önbellekli. */
let cspInline = { mtime: 0, hashes: '' };
function inlineScriptHashes() {
    try {
        const file = path.join(PUBLIC_DIR, 'index.html');
        const mtime = fs.statSync(file).mtimeMs;
        if (mtime !== cspInline.mtime) {
            const html = fs.readFileSync(file, 'utf8');
            const hashes = [];
            for (const m of html.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi))
                hashes.push(" 'sha256-" + crypto.createHash('sha256').update(m[1]).digest('base64') + "'");
            cspInline = { mtime, hashes: hashes.join('') };
        }
    } catch (e) { cspInline = { mtime: 0, hashes: '' }; }
    return cspInline.hashes;
}
function secHeaders(res, isHtml) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (SECURE) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (isHtml) res.setHeader('Content-Security-Policy',
        "default-src 'self'; script-src 'self'" + inlineScriptHashes() + "; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; " +
        "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
}

/* =============================================================== API ======= */
async function handleAPI(req, res, parts) {
    const [, , resource, id, sub, subId] = parts;
    const ip = (req.socket.remoteAddress || '?').replace(/^::ffff:/, '');
    const mutating = req.method !== 'GET' && req.method !== 'HEAD';

    /* genel IP hız sınırı */
    if (!rateLimit('api:' + ip, 300, 60000)) return sendJSON(res, 429, { error: 'çok fazla istek' });

    if (resource === 'health') return sendJSON(res, 200, { ok: true, name: '3D Not Evreni API', auth: true });

    /* ---------------------------- KİMLİK ---------------------------- */
    if (resource === 'auth') {
        if (id === 'register' && req.method === 'POST') {
            if (!rateLimit('reg:' + ip, 5, 3600000)) return sendJSON(res, 429, { error: 'kayıt sınırı — sonra dene' });
            const b = await readBody(req, LIMIT_DEFAULT);
            if (!isStr(b.username, 32) || !USERNAME_RE.test(b.username))
                return sendJSON(res, 400, { error: 'kullanıcı adı: 3-32 karakter, harf/rakam/._-' });
            if (!isStr(b.password, 256) || b.password.length < 10)
                return sendJSON(res, 400, { error: 'parola en az 10 karakter olmalı' });
            const uname = b.username.toLowerCase();
            if (db.users.some(u => u.username === uname))
                return sendJSON(res, 409, { error: 'bu kullanıcı adı alınmış' });
            const user = { id: 'u' + rnd(6), username: uname, pass: hashPassword(b.password), createdAt: Date.now() };
            db.users.push(user);
            /* eski sürümlerden kalan sahipsiz defterleri İLK kullanıcı devralır */
            if (db.users.length === 1) db.notebooks.forEach(n => { if (!n.uid) n.uid = user.id; });
            const token = createSession(user.id);
            audit('register', { uid: user.id, username: uname, ip });
            res.setHeader('Set-Cookie', sessionCookie(token));
            return sendJSON(res, 201, { user: { id: user.id, username: uname }, csrf: db.sessions[sha256(token)].csrf });
        }
        if (id === 'login' && req.method === 'POST') {
            if (!rateLimit('login:' + ip, 20, 600000)) return sendJSON(res, 429, { error: 'çok fazla deneme — sonra dene' });
            const b = await readBody(req, LIMIT_DEFAULT);
            const uname = String(b.username || '').toLowerCase();
            const lockKey = uname + '@' + ip;
            if (locked(lockKey)) { audit('login_locked', { username: uname, ip }); return sendJSON(res, 429, { error: 'hesap geçici kilitli — 15 dk sonra dene' }); }
            const user = db.users.find(u => u.username === uname);
            const ok = verifyPassword(String(b.password || ''), user && user.pass);
            if (!ok || !user) {
                recordFail(lockKey, ip);
                audit('login_fail', { username: uname, ip });
                return sendJSON(res, 401, { error: 'kullanıcı adı veya parola hatalı' }); // sayım koruması: tek mesaj
            }
            fails.delete(lockKey);
            const token = createSession(user.id);
            audit('login', { uid: user.id, ip });
            res.setHeader('Set-Cookie', sessionCookie(token));
            return sendJSON(res, 200, { user: { id: user.id, username: user.username }, csrf: db.sessions[sha256(token)].csrf });
        }
        if (id === 'logout' && req.method === 'POST') {
            const s = getSession(req);
            if (s) { delete db.sessions[s.key]; saveDB(); }
            res.setHeader('Set-Cookie', sessionCookie('', true));
            return sendJSON(res, 200, { ok: true });
        }
        if (id === 'me' && req.method === 'GET') {
            const s = getSession(req);
            if (!s) return sendJSON(res, 401, { error: 'oturum yok' });
            const u = db.users.find(x => x.id === s.uid);
            if (!u) return sendJSON(res, 401, { error: 'oturum geçersiz' });
            return sendJSON(res, 200, { user: { id: u.id, username: u.username }, csrf: s.csrf });
        }
        return sendJSON(res, 404, { error: 'bilinmeyen auth ucu' });
    }

    /* ---------------- paylaşım GET herkese açık (link = yetki) -------------- */
    if (resource === 'share' && req.method === 'GET' && id) {
        const s = db.shares[String(id).replace(/[^a-f0-9]/g, '')];
        return s ? sendJSON(res, 200, s) : sendJSON(res, 404, { error: 'paylaşım bulunamadı' });
    }

    /* ---------------- buradan sonrası OTURUM ister ---------------- */
    const session = getSession(req);
    if (!session) return sendJSON(res, 401, { error: 'giriş gerekli' });
    const uid = session.uid;
    /* CSRF: tüm mutasyonlarda oturuma bağlı başlık zorunlu */
    if (mutating && req.headers['x-csrf'] !== session.csrf) {
        audit('csrf_reject', { uid, ip, path: req.url });
        return sendJSON(res, 403, { error: 'csrf doğrulaması başarısız' });
    }

    if (resource === 'notebooks') {
        const mine = db.notebooks.filter(n => n.uid === uid);
        if (req.method === 'GET' && !id)
            return sendJSON(res, 200, mine.map(n => ({ id: n.id, name: n.name, updatedAt: n.updatedAt })));
        if (req.method === 'POST' && !id) {
            if (mine.length >= 100) return sendJSON(res, 400, { error: 'defter sınırı (100)' });
            const b = await readBody(req, LIMIT_TREE);
            const root = b.root || emptyRoot();
            try { validateRoot(root); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
            const nb = { id: rnd(5), uid, name: isStr(b.name, 80) ? b.name : 'Defter',
                         root, versions: [], updatedAt: Date.now() };
            db.notebooks.push(nb); saveDB();
            return sendJSON(res, 201, { id: nb.id, name: nb.name, root: nb.root });
        }
        const nb = db.notebooks.find(n => n.id === id && n.uid === uid); // izolasyon: yalnız sahibi
        if (!nb) return sendJSON(res, 404, { error: 'defter bulunamadı' });

        if (sub === 'versions') {
            nb.versions = nb.versions || [];
            if (req.method === 'GET' && subId == null)
                return sendJSON(res, 200, nb.versions.map((v, i) => ({ i, ts: v.ts })));
            if (req.method === 'GET')
                return nb.versions[+subId] ? sendJSON(res, 200, nb.versions[+subId])
                                           : sendJSON(res, 404, { error: 'versiyon yok' });
            if (req.method === 'POST') {
                nb.versions.push({ ts: Date.now(), root: nb.root });
                if (nb.versions.length > 25) nb.versions.shift();
                saveDB();
                return sendJSON(res, 201, { ok: true, count: nb.versions.length });
            }
        }
        if (req.method === 'GET')
            return sendJSON(res, 200, { id: nb.id, name: nb.name, root: nb.root, updatedAt: nb.updatedAt });
        if (req.method === 'PUT') {
            const b = await readBody(req, LIMIT_TREE);
            if (b.root != null) { try { validateRoot(b.root); } catch (e) { return sendJSON(res, 400, { error: e.message }); } }
            nb.versions = nb.versions || [];
            const last = nb.versions[nb.versions.length - 1];
            if (!last || Date.now() - last.ts > 10 * 60 * 1000) {
                nb.versions.push({ ts: Date.now(), root: nb.root });
                if (nb.versions.length > 25) nb.versions.shift();
            }
            if (b.name != null && isStr(b.name, 80)) nb.name = b.name;
            if (b.root != null) nb.root = b.root;
            nb.updatedAt = Date.now(); saveDB();
            return sendJSON(res, 200, { ok: true, updatedAt: nb.updatedAt });
        }
        if (req.method === 'DELETE') {
            db.notebooks = db.notebooks.filter(n => !(n.id === id && n.uid === uid)); saveDB();
            return sendJSON(res, 200, { ok: true });
        }
    }

    if (resource === 'share') {
        if (req.method === 'POST' && !id) {
            if (!rateLimit('share:' + ip, 30, 3600000)) return sendJSON(res, 429, { error: 'paylaşım sınırı' });
            const b = await readBody(req, LIMIT_TREE);
            if (!b.root) return sendJSON(res, 400, { error: 'root gerekli' });
            try { validateRoot(b.root); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
            const sid = rnd(8); // 16 karakter — tahmin edilemez link
            /* paylaşılan ağaçtaki YALNIZ sahibi olduğun varlıklar herkese açılır */
            for (const raw of walkAssetIds(b.root, new Set())) {
                const aid = String(raw).replace(/[^a-zA-Z0-9_-]/g, '');
                try {
                    const rec = JSON.parse(fs.readFileSync(assetPath(aid), 'utf8'));
                    if (rec.uid === uid) db.publicAssets[rec.id] = true;
                } catch (e) {}
            }
            db.shares[sid] = { id: sid, uid, name: isStr(b.name, 80) ? b.name : 'Paylaşılan Küme',
                               root: b.root, focus: isStr(b.focus, 100) ? b.focus : '0', createdAt: Date.now() };
            saveDB();
            audit('share_create', { uid, sid, ip });
            return sendJSON(res, 201, { id: sid, url: '/?s=' + sid + '&focus=' + encodeURIComponent(db.shares[sid].focus) });
        }
    }

    if (resource === 'assets') {
        if (req.method === 'POST' && !id) {
            if (!rateLimit('asset:' + uid, 60, 600000)) return sendJSON(res, 429, { error: 'yükleme sınırı' });
            const b = await readBody(req, LIMIT_ASSET);
            if (!isStr(b.dataURL, LIMIT_ASSET) || !ASSET_MIME_RE.test(b.dataURL))
                return sendJSON(res, 400, { error: 'desteklenmeyen veya güvensiz dosya türü' });
            const aid = String(b.id || 'a' + rnd(6)).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || ('a' + rnd(6));
            if (fs.existsSync(assetPath(aid))) { // id çakışması: yalnız sahibi üstüne yazabilir
                try { if (JSON.parse(fs.readFileSync(assetPath(aid), 'utf8')).uid !== uid) return sendJSON(res, 403, { error: 'bu id kullanımda' }); } catch (e) {}
            }
            fs.mkdirSync(path.join(DATA_DIR, 'assets'), { recursive: true });
            fs.writeFileSync(assetPath(aid), JSON.stringify({
                id: aid, uid, name: isStr(b.name, 120) ? b.name : 'dosya',
                aspect: typeof b.aspect === 'number' ? b.aspect : null,
                size: typeof b.size === 'number' ? b.size : null, dataURL: b.dataURL }));
            return sendJSON(res, 201, { id: aid });
        }
        if (req.method === 'GET' && id) {
            const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
            try {
                const rec = JSON.parse(fs.readFileSync(assetPath(safe), 'utf8'));
                if (rec.uid !== uid && !db.publicAssets[rec.id]) // izolasyon: sahibi ya da paylaşımla açılmış
                    return sendJSON(res, 403, { error: 'bu varlığa erişimin yok' });
                return sendJSON(res, 200, rec);
            } catch (e) { return sendJSON(res, 404, { error: 'varlık bulunamadı' }); }
        }
    }

    sendJSON(res, 404, { error: 'bilinmeyen uç nokta' });
}

/* ---------------------- statik: ETag + Cache-Control + gzip ---------------- */
const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};
const GZIP_EXT = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt']);
function serveStatic(req, res, pathname) {
    let rel = pathname === '/' ? '/index.html' : pathname;
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('403'); }
    fs.stat(file, (err, st) => {
        if (err || !st.isFile()) {
            if (!path.extname(rel)) return serveStatic(req, res, '/index.html');
            res.writeHead(404); return res.end('404');
        }
        const ext = path.extname(file).toLowerCase();
        secHeaders(res, ext === '.html');
        const etag = 'W/"' + st.size.toString(36) + '-' + Math.round(st.mtimeMs).toString(36) + '"';
        if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
        fs.readFile(file, (e2, buf) => {
            if (e2) { res.writeHead(500); return res.end('500'); }
            const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'ETag': etag,
                'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' };
            if (GZIP_EXT.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
                headers['Content-Encoding'] = 'gzip'; headers['Vary'] = 'Accept-Encoding';
                buf = zlib.gzipSync(buf);
            }
            res.writeHead(200, headers);
            res.end(buf);
        });
    });
}

/* ------------------------------------------------------------------ sunucu */
loadDB();
setInterval(() => { // süresi geçen oturumları süpür
    const now = Date.now(); let dirty = false;
    for (const k in db.sessions) if (db.sessions[k].exp < now) { delete db.sessions[k]; dirty = true; }
    if (dirty) saveDB();
}, 3600000).unref();

const handler = async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const parts = u.pathname.split('/');
    try {
        if (parts[1] === 'api') { secHeaders(res, false); await handleAPI(req, res, parts); }
        else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, u.pathname);
        else { res.writeHead(405); res.end(); }
    } catch (e) {
        sendJSON(res, e.message === 'payload too large' ? 413 : 400, { error: e.message });
    }
};
const server = (process.env.TLS_KEY && process.env.TLS_CERT)
    ? https.createServer({ key: fs.readFileSync(process.env.TLS_KEY), cert: fs.readFileSync(process.env.TLS_CERT) }, handler)
    : http.createServer(handler);
server.listen(PORT, () => {
    console.log('🌌 3D Not Evreni → ' + (process.env.TLS_KEY ? 'https' : 'http') + '://localhost:' + PORT);
    console.log('   Güvenlik: auth+CSRF+rate-limit aktif · Secure çerez: ' + (SECURE ? 'AÇIK' : 'kapalı — üretimde COOKIE_SECURE=1'));
});
