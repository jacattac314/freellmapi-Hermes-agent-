// Builds a Vercel deployment of the app with live data:
//   static page + worker (libraries from jsDelivr) → written to outDir
//   api/feed/[key].js (committed alongside) — fetches CelesTrak / NOAA and lets
//   Vercel's CDN cache each response (CelesTrak: 2 h, per its polling policy).
//
//   node apps/orbit/build-vercel.mjs [outDir]   → apps/orbit/dist/vercel/
//
// Vercel project settings: root directory apps/orbit, framework "Other",
// install command none, build command `node build-vercel.mjs`, output dist/vercel.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(dir, 'dist', 'vercel');
const read = (p) => fs.readFileSync(path.join(dir, p), 'utf8');

const CDN = 'https://cdn.jsdelivr.net/npm';
const SAT = `${CDN}/satellite.js@7.1.0/dist`;
const THREE = `${CDN}/three@0.187.0`;

function must(s, a, b) {
  if (!s.includes(a)) throw new Error(`build: pattern not found: ${a.slice(0, 60)}`);
  return s.replaceAll(a, b);
}

let html = read('public/index.html');
html = must(html, '"three": "/vendor/three/build/three.module.js"', `"three": "${THREE}/build/three.module.js"`);
html = must(html, '"three/addons/": "/vendor/three/examples/jsm/"', `"three/addons/": "${THREE}/examples/jsm/"`);
html = must(html, '/vendor/topojson-client/dist/topojson-client.min.js', `${CDN}/topojson-client@3.1.0/dist/topojson-client.min.js`);

let main = read('public/main.js');
main = must(main, "'/vendor/satellite.js/dist/", `'${SAT}/`);
main = must(main, "'/vendor/world-atlas/land-110m.json'", `'${CDN}/world-atlas@2.0.2/land-110m.json'`);
main = must(main, "'/vendor/lightstreamer-client-web/lightstreamer-core.esm.js'", `'${CDN}/lightstreamer-client-web@9.2.3/lightstreamer-core.esm.js'`);

let worker = read('public/sat-worker.js');
worker = must(worker, "'/vendor/satellite.js/dist/", `'${SAT}/`);


const files = {
  'index.html': html,
  'style.css': read('public/style.css'),
  'main.js': main,
  'sat-worker.js': worker,
  'stars.json': read('public/stars.json'),
  'probes.json': read('public/probes.json'),
  'smallbodies.json': read('public/smallbodies.json'),
};
fs.rmSync(out, { recursive: true, force: true });
for (const [name, body] of Object.entries(files)) {
  const p = path.join(out, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}
fs.mkdirSync(path.join(out, 'tex'), { recursive: true });
for (const f of fs.readdirSync(path.join(dir, 'public', 'tex'))) fs.copyFileSync(path.join(dir, 'public', 'tex', f), path.join(out, 'tex', f));
console.log(`wrote ${Object.keys(files).length} files + tex/ to ${out}`);
