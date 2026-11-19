// Orbit — tiny zero-dependency server.
//
// Why a server at all:
//  1. CelesTrak asks clients not to fetch GP data more than once per update
//     cycle (~2 h) and blocks IPs that do. Every browser tab hitting it directly
//     would violate that; this caches one copy for everyone.
//  2. Same-origin proxy for NOAA SWPC so CORS is never a problem.
//  3. Serves the vendored browser libraries straight out of node_modules.
//
// Run:  node apps/orbit/server.js        (live data)
//       DEMO=1 node apps/orbit/server.js (synthetic data, clearly labelled in the UI)

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthCatalogCsv, synthNoaa } from './demo-data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4300);
const DEMO = process.env.DEMO === '1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const CACHE_DIR = path.join(__dirname, '.cache');

const MIN = 60_000;
const SOURCES = {
  // CelesTrak recommends CSV and no more than one fetch per 2 h update cycle.
  gp: { url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=csv', ttl: 120 * MIN, type: 'text/csv' },
  wind: { url: 'https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json', ttl: 1 * MIN, type: 'application/json' },
  mag: { url: 'https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json', ttl: 1 * MIN, type: 'application/json' },
  xray: { url: 'https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json', ttl: 1 * MIN, type: 'application/json' },
  aurora: { url: 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json', ttl: 5 * MIN, type: 'application/json' },
};

// key -> { body: Buffer, fetchedAt: number, error?: string }
const cache = new Map();
const inflight = new Map();

async function loadDiskCache() {
  await fsp.mkdir(CACHE_DIR, { recursive: true });
  for (const key of Object.keys(SOURCES)) {
    try {
      const meta = JSON.parse(await fsp.readFile(path.join(CACHE_DIR, `${key}.meta.json`), 'utf8'));
      const body = await fsp.readFile(path.join(CACHE_DIR, `${key}.data`));
      cache.set(key, { body, fetchedAt: meta.fetchedAt });
    } catch { /* no cache yet */ }
  }
}

async function refresh(key) {
  const src = SOURCES[key];
  if (DEMO) {
    const body = Buffer.from(key === 'gp' ? synthCatalogCsv() : JSON.stringify(synthNoaa(key)));
    const entry = { body, fetchedAt: Date.now() };
    cache.set(key, entry);
    return entry;
  }
  const res = await fetch(src.url, { headers: { 'User-Agent': 'orbit-globe/0.1 (local cache)' } });
  if (!res.ok) throw new Error(`${key}: upstream HTTP ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length === 0) throw new Error(`${key}: empty response`);
  const entry = { body, fetchedAt: Date.now() };
  cache.set(key, entry);
  fsp.writeFile(path.join(CACHE_DIR, `${key}.data`), body)
    .then(() => fsp.writeFile(path.join(CACHE_DIR, `${key}.meta.json`), JSON.stringify({ fetchedAt: entry.fetchedAt })))
    .catch(() => {});
  return entry;
}

// Returns cached data if fresh; otherwise refreshes once (deduplicated across
// concurrent requests). On upstream failure, serves stale data if we have any.
async function get(key) {
  const src = SOURCES[key];
  const cur = cache.get(key);
  const lastAttempt = cur?.lastAttempt ?? 0;
  const fresh = cur && Date.now() - cur.fetchedAt < src.ttl;
  // After a failure, back off: up to 10 min while a cached copy can be served
  // (CelesTrak is strict about polling), but only 30 s when there is nothing to show.
  const backoff = cur?.body ? Math.min(src.ttl, 10 * MIN) : 30_000;
  const backingOff = cur?.error && Date.now() - lastAttempt < backoff;
  if (fresh || backingOff) return cur;
  if (!inflight.has(key)) {
    inflight.set(key, refresh(key)
      .catch((err) => {
        const stale = cache.get(key);
        const entry = { ...(stale ?? { body: null, fetchedAt: 0 }), error: String(err.message || err), lastAttempt: Date.now() };
        cache.set(key, entry);
        console.warn(`[orbit] ${err.message || err}${stale?.body ? ' — serving stale copy' : ''}`);
        return entry;
      })
      .finally(() => inflight.delete(key)));
  }
  return inflight.get(key);
}

// ---------- static files ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
};

function findPackageDir(name) {
  let dir = __dirname;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// /vendor/<pkg>/... -> node_modules/<pkg>/... (only these packages are exposed)
const VENDOR = Object.fromEntries(
  ['three', 'satellite.js', 'topojson-client', 'world-atlas', 'lightstreamer-client-web']
    .map((p) => [p, findPackageDir(p)]),
);

function safeJoin(root, rel) {
  const full = path.normalize(path.join(root, rel));
  return full.startsWith(root + path.sep) || full === root ? full : null;
}

async function serveFile(res, file) {
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = decodeURIComponent(url.pathname);

  if (p === '/api/status') {
    const status = { demo: DEMO, now: Date.now(), sources: {} };
    for (const key of Object.keys(SOURCES)) {
      const c = cache.get(key);
      status.sources[key] = { fetchedAt: c?.fetchedAt || null, error: c?.error || null, ttlMs: SOURCES[key].ttl };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(status));
    return;
  }

  const m = p.match(/^\/api\/data\/(\w+)$/);
  if (m && SOURCES[m[1]]) {
    const entry = await get(m[1]);
    if (!entry?.body) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: entry?.error || 'unavailable' }));
      return;
    }
    res.writeHead(200, {
      'Content-Type': SOURCES[m[1]].type,
      'X-Fetched-At': String(entry.fetchedAt),
      'X-Upstream-Error': entry.error || '',
      'X-Demo': DEMO ? '1' : '0',
      'Cache-Control': 'no-store',
    });
    res.end(entry.body);
    return;
  }

  if (p.startsWith('/vendor/')) {
    const rest = p.slice('/vendor/'.length);
    const pkg = Object.keys(VENDOR).find((k) => rest.startsWith(k + '/'));
    const root = pkg && VENDOR[pkg];
    const file = root && safeJoin(root, rest.slice(pkg.length + 1));
    if (!file) { res.writeHead(404).end(); return; }
    await serveFile(res, file);
    return;
  }

  const file = safeJoin(PUBLIC_DIR, p === '/' ? 'index.html' : p.slice(1));
  if (!file) { res.writeHead(404).end(); return; }
  await serveFile(res, file);
});

await loadDiskCache();
server.listen(PORT, () => {
  console.log(`[orbit] http://localhost:${PORT}${DEMO ? '  (DEMO data — synthetic, not real)' : ''}`);
  for (const [k, v] of Object.entries(VENDOR)) if (!v) console.warn(`[orbit] missing package ${k} — run npm install`);
});
