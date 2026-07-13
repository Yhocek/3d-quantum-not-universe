<p align="center">
  <img src="https://img.shields.io/badge/Node.js-16%2B-339933?logo=nodedotjs&logoColor=white" alt="Node.js 16+" />
  <img src="https://img.shields.io/badge/Three.js-r152-000000?logo=threedotjs&logoColor=white" alt="Three.js" />
  <img src="https://img.shields.io/badge/Dependencies-Zero-brightgreen" alt="Zero Dependencies" />
  <img src="https://img.shields.io/badge/License-MIT-blue" alt="MIT License" />
  <img src="https://img.shields.io/badge/Security-Hardened%20v7-critical" alt="Security Hardened" />
</p>

<h1 align="center">🌌 3D Quantum Note Universe</h1>
<h3 align="center"><em>3D Kuantum Not Evreni</em></h3>

<p align="center">
  A fractal-structured, interactive, high-performance <strong>3D note-taking system</strong> built with Three.js.<br/>
  Navigate your knowledge in an infinite universe — each atom has <strong>54 orbital slots</strong> for child notes,<br/>
  fly through space with WASD, zoom into clusters, and connect ideas with quantum wormholes.
</p>

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔮 **54-Slot Fractal Atoms** | Equatorial + latitude rings with precise angular distribution (8+8+8+8+8+7+7) |
| 🚀 **WASD Free Flight** | Speed auto-scales to fractal depth; `Shift` boost, `Space/C` vertical |
| 🎯 **Focus Mode** | Click any atom → smooth camera approach + orbit controls |
| 📝 **Rich Note Editor** | H1/H2/P formatting, image & document attachments rendered in 3D |
| 🔗 **Quantum Tunneling** | Wormhole links between distant notes — dashed purple bonds + portal teleport |
| 📚 **Multi-Notebook** | Create, rename, switch, delete independent notebooks |
| 💾 **Auto-Save** | Debounced sync to server (~1s); IndexedDB offline mirror for zero data loss |
| 🔍 **Global Search** | Matching atoms glow white in 3D space; click result → fly to node |
| ⏳ **Time Tunnel** | Version history with auto-snapshots (10min) + manual saves; session Ctrl+Z/Y |
| 🗺️ **2D Reduction** | Radial tree map via pure Canvas 2D — GPU-free overview |
| 📸 **PNG Export** | Top-down orthographic 3D capture + 2D map download |
| 🔄 **JSON Import/Export** | Portable standard schema (`id/label/type/size/children`) |
| 🌐 **Shareable Links** | Share subtrees via short `?s=<code>` URLs |
| 🎨 **Bloom + Shaders** | UnrealBloomPass + custom quantum ripple/fresnel shader injection |

---

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/Yhocek/3d-quantum-not-universe.git
cd 3d-quantum-not-universe

# Run (no npm install needed!)
node server.js
```

Open **http://localhost:3000** — that's it. **Zero dependencies.**

> 💡 Data is auto-saved to `./data/db.json`. The `public/index.html` also works standalone (open in browser) with JSON import/export only.

---

## 🔐 Security Architecture (v7)

All user data is locked to individual accounts — no cross-user access is possible. 14 attack scenarios have been verified through automated testing.

<details>
<summary><strong>Click to expand full security details</strong></summary>

### Identity & Session
- Passwords hashed with **scrypt** (N=16384, salted); verification via `timingSafeEqual`
- 32-byte random session tokens; server stores only **SHA-256 digest** — leaked DB ≠ valid tokens
- `HttpOnly; SameSite=Strict` cookies (+ `Secure`); 7-day sliding expiration
- Constant-time responses prevent user enumeration

### Authorization & Isolation
- Every notebook/version/asset is locked to `uid`; unauthorized requests get 404/403
- Assets served only to owner; sharing explicitly whitelists only that subtree's assets

### Attack Surface Mitigations
| Attack Vector | Protection |
|---|---|
| **CSRF** | Session-bound `X-CSRF` header required on all mutations |
| **XSS** | Whitelist HTML sanitizer (strips all attributes); paste reduced to plain text; `data:text/html` uploads rejected; strict CSP (`script-src 'self'` + auto-computed sha256 hash for the import map, `object-src 'none'`) |
| **Brute Force** | Per user+IP lockout (8 failures → 15min lock); separate IP rate limits for login/register/asset/share |
| **DoS** | Route-specific body limits (2/16/32 MB); tree validation (depth ≤12, nodes ≤50k, field lengths) |
| **Prototype Pollution** | JSON reviver strips `__proto__`/`constructor`/`prototype` keys |
| **Headers** | `nosniff`, `X-Frame-Options: DENY`, `COOP/CORP: same-origin`, `Referrer-Policy: no-referrer`, HSTS (with TLS) |
| **Audit Trail** | `data/audit.log` — register/login/failed login/lockout/CSRF rejection/share events |

### Production Checklist
- [ ] Set `COOKIE_SECURE=1` or use TLS (`TLS_KEY`/`TLS_CERT` env vars)
- [ ] Restrict `data/` directory permissions (`chmod 700`)
- [ ] Rotate audit logs; optionally feed `audit.log` to fail2ban

</details>

---

## 📡 API Reference

All endpoints under `/api/`. Mutations require `X-CSRF` header matching session token.

```
Authentication
──────────────────────────────────────────────────────
POST   /api/auth/register     { username, password }  → { user, csrf }
POST   /api/auth/login        { username, password }  → { user, csrf }
POST   /api/auth/logout       {}                      → { ok }
GET    /api/auth/me                                   → { user, csrf }

Notebooks
──────────────────────────────────────────────────────
GET    /api/notebooks                                 → [{ id, name, updatedAt }]
POST   /api/notebooks         { name, root? }         → { id, name, root }
GET    /api/notebooks/:id                             → { id, name, root, updatedAt }
PUT    /api/notebooks/:id     { name?, root? }        → { ok, updatedAt }
DELETE /api/notebooks/:id                             → { ok }

Versions (Time Tunnel)
──────────────────────────────────────────────────────
GET    /api/notebooks/:id/versions                    → [{ i, ts }]
GET    /api/notebooks/:id/versions/:i                 → { ts, root }
POST   /api/notebooks/:id/versions                    → { ok, count }

Sharing
──────────────────────────────────────────────────────
POST   /api/share             { name, root, focus? }  → { id, url }
GET    /api/share/:id                                 → { id, name, root, focus }

Assets
──────────────────────────────────────────────────────
POST   /api/assets            { id?, name, dataURL }  → { id }
GET    /api/assets/:id                                → { id, name, dataURL, ... }

Health
──────────────────────────────────────────────────────
GET    /api/health                                    → { ok, name, auth }
```

---

## 📁 Project Structure

```
├── server.js              # Zero-dependency Node.js backend + static file server
├── verify.mjs             # Cross-module import/export + HTML ID consistency checker
├── package.json
├── .gitignore
├── README.md
└── public/
    ├── index.html         # Single-page app markup
    ├── css/
    │   └── style.css      # Full application styling
    ├── js/
    │   ├── three.js       # Three.js re-export entry point (Vite migration point)
    │   ├── config.js      # Constants + pure helpers (XSS sanitizer, data URL validator)
    │   ├── DataManager.js # Schema, IndexedDB + server assets, API client, undo/redo, search
    │   ├── Engine3D.js    # Scene, instanced meshes, bloom, shaders, labels, raycast
    │   ├── Controls.js    # Dual camera mode (flight WASD / focus-orbit)
    │   ├── UIManager.js   # Panels, quick menu, search, 2D map, time tunnel, auth UI
    │   └── main.js        # Bootstrap + render loop
    └── vendor/
        └── three/         # Vendored Three.js (no CDN dependency)
```

---

## 🎮 Controls

| Input | Action |
|---|---|
| **Click atom** | Focus mode: smooth approach + orbit |
| **Click empty slot** | Spawn new note at that address |
| **WASD** | Free flight movement |
| **Shift** | Speed boost |
| **Space / C** | Ascend / Descend |
| **Mouse drag** | Orbit (focus mode) / Look (flight mode) |
| **Scroll** | Zoom |
| **Ctrl+Z / Ctrl+Y** | Undo / Redo |
| **Purple portal** | Quantum tunnel teleport |

---

## 🧬 Fractal Addressing

Every atom in the universe has a unique address:
- Root: `0`
- 12th slot of root: `0.12`
- 3rd slot of that: `0.12.3`
- And so on... infinitely deep

The 54 slots are distributed across 7 latitude rings:
| Ring | Elevation | Count | Offset |
|---|---|---|---|
| Equator | 0° | 8 | 0° |
| ±22.5° | ±22.5° | 8 each | 22.5° |
| ±45° | ±45° | 8 each | 0° |
| ±67.5° | ±67.5° | 7 each | 0° / 25.7° |

---

## 🔧 Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server listen port |
| `TLS_KEY` | — | Path to TLS private key (enables HTTPS) |
| `TLS_CERT` | — | Path to TLS certificate |
| `COOKIE_SECURE` | — | Set to `1` for Secure cookies behind reverse proxy |

---

## 🚚 Migration to Vite

The codebase is already ES Modules — it runs in the browser without a bundler. To migrate to Vite:

1. `npm create vite` → copy files to `src/`
2. `npm i three`
3. Change `js/three.js` import from vendor path to `'three'` package name
4. JSM imports become `three/examples/jsm/...`
5. No other modules need changes

---

## 📄 License

[MIT](LICENSE) — Use freely, build amazing things.

---

<p align="center">
  Made with 🌌 by <a href="https://github.com/Yhocek">Yhocek</a>
</p>
