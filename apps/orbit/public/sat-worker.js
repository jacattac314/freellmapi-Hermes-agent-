// SGP4 propagation worker.
//
// Strategy for smooth motion: once per second we propagate every satellite to
// a time ~1 s in the future and post that "snapshot" to the main thread. The
// main thread interpolates between the two snapshots that bracket "now", so
// rendering runs at full frame rate while SGP4 runs at 1 Hz. When new orbital
// elements arrive, the next snapshot is flagged `corrected` and the main thread
// eases the satellite from its old predicted path onto the new one.
//
// Coordinates sent: Earth-fixed (ECF), in Earth radii, already mapped to
// three.js axes (x = ECF x, y = ECF z/north, z = -ECF y).

import { json2satrec } from '/vendor/satellite.js/dist/io.js';
import { propagate, gstime } from '/vendor/satellite.js/dist/propagation.js';
import { eciToEcf } from '/vendor/satellite.js/dist/transforms.js';

const RE = 6378.137;
const STEP_MS = 1000;

/** @type {{id:string, name:string, satrec:any}[]} */
let sats = [];
const indexById = new Map();
let pendingCorrection = false;
let nextT = 0;
let timer = null;

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines.shift().split(',');
  return lines.map((line) => {
    // CelesTrak names can contain commas inside quotes.
    const cells = [];
    let cur = '', q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    const o = {};
    header.forEach((h, i) => { o[h.trim()] = cells[i]?.trim(); });
    return o;
  });
}

function classify(rec) {
  const n = Number(rec.MEAN_MOTION); // rev/day
  const e = Number(rec.ECCENTRICITY);
  const name = (rec.OBJECT_NAME || '').toUpperCase();
  const periodMin = 1440 / n;
  let regime;
  if (e > 0.25) regime = 'HEO';
  else if (periodMin < 128) regime = 'LEO';
  else if (periodMin > 1380 && periodMin < 1500) regime = 'GEO';
  else regime = 'MEO';
  let group = 'other';
  if (rec.NORAD_CAT_ID === '25544' || rec.NORAD_CAT_ID === '48274' || /\b(ISS|CSS|TIANHE)\b/.test(name)) group = 'station';
  else if (name.startsWith('STARLINK')) group = 'starlink';
  else if (name.startsWith('ONEWEB')) group = 'oneweb';
  else if (/NAVSTAR|GPS|GLONASS|COSMOS 2[45]\d\d|GALILEO|GSAT0|BEIDOU|QZS|IRNSS/.test(name)) group = 'gnss';
  return { regime, group, periodMin };
}

function loadElements(csvText) {
  const records = parseCsv(csvText);
  const seen = new Set();
  let added = 0, updated = 0, failed = 0;
  for (const rec of records) {
    if (!rec.NORAD_CAT_ID || !rec.MEAN_MOTION) continue;
    let satrec;
    try { satrec = json2satrec(rec); } catch { failed++; continue; }
    if (satrec.error) { failed++; continue; }
    const id = rec.NORAD_CAT_ID;
    seen.add(id);
    const meta = classify(rec);
    const existing = indexById.get(id);
    if (existing !== undefined) {
      Object.assign(sats[existing], { satrec, name: rec.OBJECT_NAME, epoch: rec.EPOCH, ...meta, dead: false });
      updated++;
    } else {
      indexById.set(id, sats.length);
      sats.push({ id, satrec, name: rec.OBJECT_NAME, epoch: rec.EPOCH, ...meta, dead: false });
      added++;
    }
  }
  // Objects that dropped out of the catalog (decayed / reclassified) are hidden, indices kept stable.
  for (const s of sats) if (!seen.has(s.id)) s.dead = true;
  return { added, updated, failed };
}

const tmp = new Float32Array(3);
function positionAt(satrec, date, gmst) {
  const pv = propagate(satrec, date);
  if (!pv || !pv.position || Number.isNaN(pv.position.x)) return null;
  const ecf = eciToEcf(pv.position, gmst);
  tmp[0] = ecf.x / RE; tmp[1] = ecf.z / RE; tmp[2] = -ecf.y / RE;
  return tmp;
}

function snapshot(t) {
  const date = new Date(t);
  const gmst = gstime(date);
  const pos = new Float32Array(sats.length * 3);
  for (let i = 0; i < sats.length; i++) {
    const s = sats[i];
    const p = s.dead ? null : positionAt(s.satrec, date, gmst);
    if (p) pos.set(p, i * 3);
    else { pos[i * 3] = NaN; pos[i * 3 + 1] = NaN; pos[i * 3 + 2] = NaN; }
  }
  const corrected = pendingCorrection;
  pendingCorrection = false;
  postMessage({ type: 'snapshot', t, pos, corrected }, [pos.buffer]);
}

function sendCatalog() {
  postMessage({
    type: 'catalog',
    ids: sats.map((s) => s.id),
    names: sats.map((s) => s.name),
    regimes: sats.map((s) => s.regime),
    groups: sats.map((s) => s.group),
    periods: sats.map((s) => s.periodMin),
    epochs: sats.map((s) => s.epoch),
    dead: sats.map((s) => s.dead),
  });
}

function start() {
  if (timer) return;
  const now = Date.now();
  nextT = Math.floor(now / STEP_MS) * STEP_MS;
  snapshot(nextT);
  snapshot(nextT + STEP_MS);
  snapshot(nextT + 2 * STEP_MS);
  nextT += 2 * STEP_MS;
  timer = setInterval(() => {
    // Stay ~2 steps ahead of wall-clock time; resync if the tab was throttled.
    const target = Date.now() + 2 * STEP_MS;
    if (target - nextT > 10 * STEP_MS) nextT = Math.floor(Date.now() / STEP_MS) * STEP_MS;
    while (nextT < target) { nextT += STEP_MS; snapshot(nextT); }
  }, STEP_MS / 2);
}

// Full orbit ring for a selected satellite: one period sampled in the inertial
// frame, drawn at the current Earth orientation so it reads as a closed loop.
function track(id, samples = 240) {
  const i = indexById.get(id);
  if (i === undefined) return;
  const s = sats[i];
  const now = new Date();
  const gmst = gstime(now);
  const pts = new Float32Array(samples * 3);
  const periodMs = Math.min(s.periodMin, 1600) * 60000;
  for (let k = 0; k < samples; k++) {
    const p = positionAt(s.satrec, new Date(now.getTime() + (k / (samples - 1)) * periodMs), gmst);
    if (p) pts.set(p, k * 3);
  }
  postMessage({ type: 'track', id, pts }, [pts.buffer]);
}

onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'elements') {
    const hadSats = sats.length > 0;
    const stats = loadElements(msg.csv);
    sendCatalog();
    postMessage({ type: 'loaded', ...stats, total: sats.length });
    if (hadSats) pendingCorrection = true;
    start();
  } else if (msg.type === 'track') {
    track(msg.id);
  }
};
