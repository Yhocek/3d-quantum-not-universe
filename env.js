'use strict';
/* =============================================================================
   Zero-dependency .env loader.
   Reads <repo>/.env (if it exists) and fills any process.env keys that are not
   already set — the real environment always wins over the file. Copy
   `.env.example` to `.env`, fill in your values, done. No npm package needed.
   Required at the top of server.js, mcp-server.js and strategy-watch.js.
   ============================================================================= */
const fs = require('fs');
const path = require('path');

try {
    const txt = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (let line of txt.split('\n')) {
        line = line.trim();
        if (!line || line[0] === '#') continue;
        if (line.startsWith('export ')) line = line.slice(7).trim();
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        if (val.length >= 2 && ((val[0] === '"' && val.endsWith('"')) || (val[0] === "'" && val.endsWith("'"))))
            val = val.slice(1, -1);
        if (key && !(key in process.env)) process.env[key] = val; // don't override real env
    }
} catch (e) { /* no .env file — that's fine, defaults apply */ }

module.exports = process.env;
