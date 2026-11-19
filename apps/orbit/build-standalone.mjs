// Builds a single self-contained HTML file of the app running on synthetic
// demo data, so it can be opened anywhere without the local server (e.g. on a
// phone). Libraries load from jsDelivr; data comes from demo-data.js in-page.
//
//   node apps/orbit/build-standalone.mjs [out.html]
//
// Live feeds (CelesTrak, NOAA, ISSLive) need the local server: run `npm run orbit`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(dir, 'dist', 'orbit-demo.html');
const read = (p) => fs.readFileSync(path.join(dir, p), 'utf8');

const SAT = 'https://cdn.jsdelivr.net/npm/satellite.js@7.1.0/dist';
const THREE = 'https://cdn.jsdelivr.net/npm/three@0.187.0';
const TOPO = 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js';

function findPkg(name) {
  for (let d = dir; ; d = path.dirname(d)) {
    const c = path.join(d, 'node_modules', name);
    if (fs.existsSync(c)) return c;
    if (path.dirname(d) === d) throw new Error(`missing ${name}; run npm install`);
  }
}

function must(s, a, b) {
  if (!s.includes(a)) throw new Error(`build: pattern not found: ${a.slice(0, 60)}`);
  return s.replaceAll(a, b);
}

const land = fs.readFileSync(path.join(findPkg('world-atlas'), 'land-110m.json'), 'utf8');

let worker = read('public/sat-worker.js');
worker = must(worker, "'/vendor/satellite.js/dist/", `'${SAT}/`);

let main = read('public/main.js');
main = must(main, "'/vendor/satellite.js/dist/", `'${SAT}/`);
main = must(main, "new Worker('/sat-worker.js', { type: 'module' })",
  "new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })), { type: 'module' })");
main = must(main,
  "const { LightstreamerClient, Subscription } = await import('/vendor/lightstreamer-client-web/lightstreamer-core.esm.js');",
  "throw new Error('live feed needs the local app'); const { LightstreamerClient, Subscription } = {};");

const demo = read('demo-data.js').replaceAll('export function', 'function');

// SNAPSHOT_DIR=<dir with gp.csv, wind.json, mag.json, xray.json, aurora.json, fetched-at.txt>
// bundles real data beside the page instead of synthetic data. Files are
// written next to the output HTML and fetched by relative URL.
const SNAP = process.env.SNAPSHOT_DIR;
const SNAP_FILES = { gp: 'data-gp.csv', wind: 'data-wind.json', mag: 'data-mag.json', xray: 'data-xray.json', aurora: 'data-aurora.json' };
let snapAt = 0;
if (SNAP) {
  snapAt = Number(fs.readFileSync(path.join(SNAP, 'fetched-at.txt'), 'utf8'));
  const outDir = path.dirname(out);
  const src = { gp: 'gp.csv', wind: 'wind.json', mag: 'mag.json', xray: 'xray.json', aurora: 'aurora.json' };
  for (const [k, f] of Object.entries(src)) {
    let body = fs.readFileSync(path.join(SNAP, f), 'utf8');
    if (k === 'wind' || k === 'mag') { // keep the last 4 hours: enough for the L1→Earth stream
      const rows = JSON.parse(body);
      const newest = Math.max(...rows.map((r) => Date.parse(r.time_tag + 'Z')));
      body = JSON.stringify(rows.filter((r) => Date.parse(r.time_tag + 'Z') > newest - 4 * 3600e3));
    }
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, SNAP_FILES[k]), body);
  }
}

// In-page stand-in for the server's /api/data/* routes and the coastline file.
const shim = `
${demo}
const LAND_TOPO = ${land};
const WORKER_SRC = ${JSON.stringify(worker)};
const realFetch = window.fetch.bind(window);
const SNAPSHOT = ${SNAP ? JSON.stringify({ at: snapAt, files: SNAP_FILES }) : 'null'};
const demoCache = {};
window.fetch = async (url, opts) => {
  const u = String(url);
  if (u.endsWith('land-110m.json')) return new Response(JSON.stringify(LAND_TOPO), { headers: { 'Content-Type': 'application/json' } });
  const m = u.match(/\\/api\\/data\\/(\\w+)$/);
  if (!m) return realFetch(url, opts);
  const key = m[1];
  if (SNAPSHOT) {
    const r = await realFetch(SNAPSHOT.files[key]);
    return new Response(await r.text(), { status: r.status, headers: { 'X-Fetched-At': String(SNAPSHOT.at), 'X-Demo': 'snapshot', 'X-Upstream-Error': '' } });
  }
  const ttl = key === 'gp' ? 7200000 : key === 'aurora' ? 300000 : 60000;
  let c = demoCache[key];
  if (!c || Date.now() - c.at > ttl) {
    c = demoCache[key] = { at: Date.now(), body: key === 'gp' ? synthCatalogCsv() : JSON.stringify(synthNoaa(key)) };
  }
  return new Response(c.body, { headers: { 'X-Fetched-At': String(c.at), 'X-Demo': '1', 'X-Upstream-Error': '' } });
};
`;

let html = read('public/index.html');
const css = read('public/style.css');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module" src="/main.js"></script>'));

const page = `<title>Orbit</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${css}
html, body { height: 100%; }
</style>
<script type="importmap">
{ "imports": { "three": "${THREE}/build/three.module.js", "three/addons/": "${THREE}/examples/jsm/" } }
</script>
<script src="${TOPO}"></script>
${body.trim()}
<script type="module">
${shim}
${main}
</script>
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
