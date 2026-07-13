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
| 🗺️ **2D Reduction** | Nested cluster–subcluster map via pure Canvas 2D — each note is a circle, children live inside it |
| 🤖 **MCP Server** | Zero-dependency MCP bridge (`mcp-server.js`) — Claude (or any LLM) connects to your universe: read, search, add, update notes |
| 🗂️ **Auto-Categorization** | Connected LLMs file conversations & code into a hierarchy (`Dersler/Matematik/Calculus/Calculus1 Notları`) via `file_note` — the universe grows itself |
| 🛣️ **CH Route Search** | Shared maps are searchable by LLMs with real **Contraction Hierarchies** — shortest routes over tree bonds + wormholes |
| 🧠 **Brain Network** | Obsidian-style: cross-notebook wormholes, `[[wikilinks]]`, and a force-directed **brain graph** of all notebooks as one neural network |
| 📐 **Screen Sync** | Adaptive FOV for ultrawide/curved monitors, DPR re-sync across monitors, dynamic viewport + safe-area + pinch-zoom on mobile |
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
├── mcp-server.js          # MCP bridge (stdio) — lets Claude read & write your notes
├── .mcp.json              # Auto-discovered MCP config for Claude Code
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
| **One-finger drag** 📱 | Look (flight) / Orbit (focus) |
| **Tap** 📱 | Select atom / spawn note on empty slot |
| **Two-finger pinch** 📱 | Zoom in/out (focus mode) |

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

## 📐 Screen Sync — Mobile & Curved/Ultrawide Monitors

The renderer keeps itself synchronized with whatever screen it lands on:

- **Adaptive FOV** — vertical FOV is derived from the screen's aspect ratio so the *horizontal* field of view stays in the 60–105° comfort band: no fisheye edge distortion on 21:9 / 32:9 curved monitors, no tunnel vision on portrait phones. Standard 16:9 screens keep the classic 70°.
- **DPR re-sync** — dragging the window to a monitor with a different pixel density (external curved display, Retina laptop) re-applies `setPixelRatio` automatically via a self-re-arming `resolution` media query.
- **Unified resize pipeline** — `resize`, `orientationchange`, and `visualViewport` (mobile URL-bar show/hide) all funnel into one handler that updates camera, renderer, and bloom composer together.
- **Mobile viewport** — `100dvh` panel heights track the dynamic browser chrome; `viewport-fit=cover` + `env(safe-area-inset-*)` keep panels clear of notches and curved screen edges; touch targets grow on small screens.
- **Touch controls** — one-finger drag to look/orbit, tap to select or spawn a note, two-finger pinch to zoom in focus mode.

---

## 🔧 Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server listen port |
| `TLS_KEY` | — | Path to TLS private key (enables HTTPS) |
| `TLS_CERT` | — | Path to TLS certificate |
| `COOKIE_SECURE` | — | Set to `1` for Secure cookies behind reverse proxy |
| `NOTE_BASE_URL` | `http://localhost:3000` | *(MCP)* Site URL the MCP bridge connects to |
| `NOTE_USER` / `NOTE_PASS` | — | *(MCP)* Account credentials for the MCP bridge |
| `NOTE_REGISTER` | — | *(MCP)* Set to `1` to auto-register the account on first run |

---

## 🤖 MCP — Connect Claude to Your Universe

`mcp-server.js` is a zero-dependency [MCP](https://modelcontextprotocol.io) server (stdio transport) that bridges Claude to the running site. Claude can list notebooks, read the tree outline, read/search notes, add/update/delete notes, create notebooks, and mint share links — all through your account, with the same auth + CSRF protections as the browser.

```bash
# 1. Start the site
node server.js

# 2. Register the MCP server with Claude Code
claude mcp add not-evreni \
  -e NOTE_BASE_URL=http://localhost:3000 \
  -e NOTE_USER=your-username \
  -e NOTE_PASS=your-password \
  -- node /path/to/3d-quantum-not-universe/mcp-server.js
```

Working inside this repo? Claude Code auto-discovers `.mcp.json` — just export `NOTE_USER` / `NOTE_PASS` in your environment. Set `NOTE_REGISTER=1` to auto-create the account on first run.

| Tool | Description |
|---|---|
| `list_notebooks` | Notebooks with id, name, last update |
| `get_outline` | Addressed text outline of a (sub)tree — addresses like `0.12.3` |
| `read_note` | Title, body text/html, attachments, children of a note |
| `add_note` | New note under a parent (first free slot, or explicit `slot` 1-54) |
| `update_note` | Change title and/or body (whitelist-sanitized HTML) |
| `delete_note` | Remove a note and its subtree (root is protected) |
| `search_notes` | Full-text search over titles + bodies with snippets |
| `create_notebook` | New empty notebook |
| `create_share_link` | Public share URL for a subtree |
| `file_note` | **Auto-categorization**: files a note under a category path, creating missing levels |
| `link_notes` | Bidirectional wormhole between two notes — **cross-notebook** with `target_notebook_id` |
| `read_share` | Read any public shared map (`?s=...` URL or id) — no login needed |
| `search_share` | Search a shared map; routes computed with **Contraction Hierarchies** |

### 🗂️ Auto-Categorization — the universe grows itself

The MCP server ships `instructions` that tell any connected LLM to file every noteworthy conversation, code solution, or learned fact with `file_note` under a hierarchical category path:

```
file_note(category_path: "Dersler/Matematik/Calculus/Calculus1 Notları",
          title: "Limit tanımı", html: "<p>epsilon-delta…</p>")
```

Missing category nodes are created on the fly; existing ones are matched case-insensitively and reused, so repeated sessions keep building the *same* tree instead of duplicating branches. Everything lands in the **"Claude Evreni"** notebook by default (override with `notebook`). The result: over time your conversations self-organize into a giant navigable 3D universe — `Dersler → Matematik → Calculus → Calculus1 Notları` — while manual editing in the browser keeps working exactly as before; the LLM is told to respect the structure you shape by hand.

### 🛣️ Contraction Hierarchies — finding things in shared maps

When someone shares a map with you (`?s=...` link), a connected LLM can search it without any account via `search_share`. Under the hood the note graph — tree bonds **plus quantum wormholes** — is preprocessed with a real Contraction Hierarchies implementation (importance-ordered node contraction with witness searches, shortcut edges, bidirectional upward Dijkstra, shortcut unpacking). Each search hit comes back with the shortest route from the map's focus (or any `from_address`) to the target, with wormhole hops marked:

```
0 (Kök) → 0.1 (Kestirme Rafı) 🕳→ 0.2.1.1.1 (Calculus1 Notları)   · 2 hops, 1 wormhole
```

— two hops through a wormhole instead of four down the tree. The CH index is built once per share and cached.

### 🧠 Obsidian-Style Brain Network

Notebooks are no longer isolated universes — they weave into one multi-dimensional neural network, the way an [Obsidian](https://obsidian.md) vault does:

- **Cross-notebook wormholes** — the note panel's *"🧠 Defterler Arası Bağla"* button opens a picker that searches every notebook; one click creates a bidirectional link. In 3D, cross-notebook links appear as **magenta portals**: click one and you teleport into the other notebook, straight to the target note. Link format is `notebookId:nodeId` (≤64 chars), so the server schema is untouched.
- **`[[Wikilinks]]`** — type `[[Projeler]]` anywhere in a note body; on blur, every `[[title]]` that matches an existing note (in *any* notebook) automatically becomes a wormhole. The body text stays as you wrote it — the graph grows underneath.
- **🧠 Brain graph view** — the BEYİN button renders every notebook in a single force-directed graph (pure Canvas 2D): node color = notebook, node size = degree, faint edges = tree bonds, purple = wormholes, dashed magenta = cross-notebook bridges. Wheel to zoom, drag to pan, click a node to jump there in 3D — across notebooks if needed.
- **Links panel** — each note lists its connections with a notebook badge on foreign ones; *ışınlan ⇄* teleports across notebooks.
- **LLMs weave too** — the MCP `link_notes` tool (with `target_notebook_id`) lets Claude connect related concepts across notebooks ("Calculus" ⇄ "Fizik/Hareket"), and the server instructions tell it to do so — your knowledge self-organizes into a brain.

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
