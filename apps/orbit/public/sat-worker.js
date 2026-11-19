// SGP4 propagation worker.
//
// Strategy for smooth motion: we propagate every satellite at evenly spaced
// moments of *simulation* time, a couple of steps ahead of the clock, and post
// each "snapshot" to the main thread, which interpolates between the two that
// bracket the current simulation time. Rendering runs at full frame rate while
// SGP4 runs a few times a second at most.
//
// Simulation time = real time when live; with time-warp it runs `rate` times
// faster. The step between snapshots is at most 60 s of simulation time, which
// keeps straight-line interpolation within ~4 km of the true LEO arc (well
// under a pixel at globe scale).
//
// When new orbital elements arrive, the next snapshot is flagged `corrected`
// and the main thread eases each satellite onto its new track.
//
// Coordinates sent: Earth-fixed (ECF), in Earth radii, mapped to three.js axes
// (x = ECF x, y = ECF z/north, z = -ECF y).

import { json2satrec } from '/vendor/satellite.js/dist/io.js';
import { propagate, gstime } from '/vendor/satellite.js/dist/propagation.js';
import { eciToEcf } from '/vendor/satellite.js/dist/transforms.js';

const RE = 6378.137;
const MU = 398600.4418;
const MAX_SIM_STEP_MS = 60000;

let sats = [];
const indexById = new Map();
let pendingCorrection = false;

// Simulation clock (mirrors the main thread's).
let clock = { anchorReal: Date.now(), anchorSim: Date.now(), rate: 1, epoch: 0 };
const simNow = () => clock.anchorSim + (Date.now() - clock.anchorReal) * clock.rate;
const simStep = () => Math.min(1000 * clock.rate, MAX_SIM_STEP_MS);
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

// Purpose from well-known names. Heuristic: CelesTrak's "active" list has no
// purpose field, so anything unrecognised in GEO is assumed to be comms.
const GROUP_PATTERNS = [
  ['starlink', /^STARLINK/],
  ['oneweb', /^ONEWEB/],
  ['kuiper', /^KUIPER/],
  ['gnss', /NAVSTAR|\bGPS\b|GLONASS|COSMOS 2[45]\d\d|GALILEO|GSAT0|BEIDOU|\bQZS|IRNSS|NAVIC/],
  ['weather', /\bNOAA \d|\bGOES\b|METEOSAT|METOP|HIMAWARI|FENGYUN|\bFY-|DMSP|ELEKTRO|INSAT-3D|GK-?2A|JPSS|SUOMI|METEOR-M|\bMTG-/],
  ['imaging', /LANDSAT|SENTINEL|WORLDVIEW|\bFLOCK|SKYSAT|PLEIADES|\bSPOT\b|RADARSAT|\bTERRA\b|\bAQUA\b|ICEYE|CAPELLA|LEMUR|\bDOVE|GAOFEN|JILIN|PELICAN|UMBRA|\bSWOT\b|KOMPSAT|CARTOSAT|RESOURCESAT/],
  ['science', /^HST$|HUBBLE|\bTESS\b|\bSWIFT\b|FERMI|CHANDRA|NUSTAR|\bXMM|INTEGRAL|\bAGILE\b|\bNICER\b|\bIXPE\b|\bCHEOPS\b|\bHXMT\b|EINSTEIN PROBE|\bSVOM\b/],
  ['comms', /IRIDIUM|GLOBALSTAR|ORBCOMM|INTELSAT|\bSES\b|SES-|EUTELSAT|ASTRA|INMARSAT|VIASAT|ECHOSTAR|TELESAT|\bO3B|AMAZONAS|HISPASAT|ARABSAT|TURKSAT|CHINASAT|TIANLIAN|SIRIUS|\bXM-|\bTDRS|\bANIK|NILESAT|YAMAL|EXPRESS-|\bBADR|THURAYA|SKYNET|\bWGS\b|MUOS|DIRECTV|GALAXY|JCSAT|SUPERBIRD|APSTAR|ASIASAT|MEASAT|THAICOM|KOREASAT|OPTUS|NBN|YAHSAT|HYLAS|KA-SAT|SPACEWAY|TIANTONG|LUCH/],
];

function classify(rec) {
  const n = Number(rec.MEAN_MOTION); // rev/day
  const e = Number(rec.ECCENTRICITY);
  const name = (rec.OBJECT_NAME || '').toUpperCase();
  const periodMin = 1440 / n;
  const nRad = (n * 2 * Math.PI) / 86400;
  const a = Math.cbrt(MU / (nRad * nRad));
  const perigee = a * (1 - e) - RE, apogee = a * (1 + e) - RE;
  let regime;
  if (e > 0.25) regime = 'HEO';
  else if (periodMin < 128) regime = 'LEO';
  else if (periodMin > 1380 && periodMin < 1500) regime = 'GEO';
  else regime = 'MEO';
  let group = 'other';
  if (rec.NORAD_CAT_ID === '25544' || rec.NORAD_CAT_ID === '48274' || /\b(ISS|CSS|TIANHE)\b/.test(name)) group = 'station';
  else {
    for (const [g, re] of GROUP_PATTERNS) if (re.test(name)) { group = g; break; }
    if (group === 'other' && regime === 'GEO') group = 'comms';
  }
  return { regime, group, periodMin, perigee, apogee };
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
  postMessage({ type: 'snapshot', t, pos, corrected, epoch: clock.epoch }, [pos.buffer]);
}

function sendCatalog() {
  postMessage({
    type: 'catalog',
    ids: sats.map((s) => s.id),
    names: sats.map((s) => s.name),
    regimes: sats.map((s) => s.regime),
    groups: sats.map((s) => s.group),
    periods: sats.map((s) => s.periodMin),
    perigees: sats.map((s) => s.perigee),
    apogees: sats.map((s) => s.apogee),
    epochs: sats.map((s) => s.epoch),
    dead: sats.map((s) => s.dead),
  });
}

function restart() {
  if (timer) clearInterval(timer);
  if (!sats.length) { timer = null; return; }
  const step = simStep();
  nextT = Math.floor(simNow() / step) * step;
  snapshot(nextT);
  snapshot(nextT + step);
  snapshot(nextT + 2 * step);
  nextT += 2 * step;
  const realStep = step / clock.rate;
  timer = setInterval(() => {
    // Stay ~2 steps ahead of simulation time; resync if the tab was throttled.
    const st = simStep();
    const target = simNow() + 2 * st;
    if (target - nextT > 10 * st) nextT = Math.floor(simNow() / st) * st;
    while (nextT < target) { nextT += st; snapshot(nextT); }
  }, Math.max(50, realStep / 2));
}

// Full orbit ring for a selected satellite: one period sampled in the inertial
// frame, drawn at the Earth's orientation at time `t` so it reads as a closed loop.
function track(id, t, samples = 240) {
  const i = indexById.get(id);
  if (i === undefined) return;
  const s = sats[i];
  const start = new Date(t);
  const gmst = gstime(start);
  const pts = new Float32Array(samples * 3);
  const periodMs = Math.min(s.periodMin, 1600) * 60000;
  for (let k = 0; k < samples; k++) {
    const p = positionAt(s.satrec, new Date(t + (k / (samples - 1)) * periodMs), gmst);
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
    else restart();
  } else if (msg.type === 'clock') {
    clock = msg.clock;
    restart();
  } else if (msg.type === 'track') {
    track(msg.id, msg.t ?? simNow());
  }
};
