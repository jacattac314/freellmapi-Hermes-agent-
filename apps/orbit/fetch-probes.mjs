// Fetches deep-space probe trajectories from NASA/JPL Horizons and writes
// public/probes.json: geocentric positions in the ICRF (J2000 equatorial) frame,
// sampled at a fixed step, about a year either side of today (less where
// Horizons has no ephemeris, e.g. after a mission ends).
//
//   node apps/orbit/fetch-probes.mjs
//
// Horizons is a free public service; this makes one request per probe, in sequence.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(dir, 'public', 'probes.json');
const DAY = 86400000;

// [Horizons id, name, step, note]
const PROBES = [
  ['-170', 'JWST', '1 d', 'James Webb Space Telescope, in a halo orbit around Sun–Earth L2'],
  ['-78', 'DSCOVR', '1 d', 'Watches the solar wind and Earth from Sun–Earth L1'],
  ['-21', 'SOHO', '1 d', 'Solar observatory at Sun–Earth L1 since 1996'],
  ['-96', 'Parker Solar Probe', '6 h', 'Closest any spacecraft has been to the Sun'],
  ['-144', 'Solar Orbiter', '1 d', 'ESA/NASA probe imaging the Sun’s poles'],
  ['-121', 'BepiColombo', '1 d', 'ESA/JAXA mission to Mercury'],
  ['-159', 'Europa Clipper', '1 d', 'On its way to Jupiter’s moon Europa (arrival 2030)'],
  ['-28', 'JUICE', '1 d', 'ESA’s Jupiter Icy Moons Explorer'],
  ['-255', 'Psyche', '1 d', 'Heading for the metal-rich asteroid 16 Psyche'],
  ['-49', 'Lucy', '1 d', 'Touring Jupiter’s Trojan asteroids'],
  ['-91', 'Hera', '1 d', 'ESA mission to the Didymos–Dimorphos asteroid pair'],
  ['-61', 'Juno', '1 d', 'Orbiting Jupiter'],
  ['-98', 'New Horizons', '5 d', 'Past Pluto, in the Kuiper Belt'],
  ['-31', 'Voyager 1', '10 d', 'Interstellar space; the most distant human-made object'],
  ['-32', 'Voyager 2', '10 d', 'Interstellar space since 2018'],
];

const iso = (t) => new Date(t).toISOString().slice(0, 10);

async function horizons(id, start, stop, step) {
  const q = new URLSearchParams({
    format: 'json', COMMAND: `'${id}'`, EPHEM_TYPE: "'VECTORS'", CENTER: "'500@399'",
    START_TIME: `'${iso(start)}'`, STOP_TIME: `'${iso(stop)}'`, STEP_SIZE: `'${step}'`,
    VEC_TABLE: "'1'", REF_PLANE: "'FRAME'", REF_SYSTEM: "'ICRF'", OUT_UNITS: "'KM-S'", CSV_FORMAT: "'YES'", OBJ_DATA: "'NO'",
  });
  const res = await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${q}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { result = '', error } = await res.json();
  if (error) throw new Error(error.split('\n')[0]);
  const a = result.indexOf('$$SOE'), b = result.indexOf('$$EOE');
  if (a < 0 || b < 0) throw new Error(result.split('\n').find((l) => /no ephemeris|error|not found/i.test(l)) || 'no data');
  const rows = result.slice(a + 5, b).trim().split('\n').map((l) => l.split(',').map((c) => c.trim()));
  // JDTDB → Unix ms (TDB ≈ UTC + 69 s; irrelevant at these scales)
  return rows.map((r) => ({ t: (Number(r[0]) - 2440587.5) * DAY, x: +r[2], y: +r[3], z: +r[4] }));
}

const now = Date.now();
const today = Math.floor(now / DAY) * DAY;
// Try the widest window first, then narrower ones (missions with no future ephemeris).
const WINDOWS = [[-365, 365], [-365, 120], [-365, 30], [-180, 7], [-60, 0]];
const out = { generated: new Date(now).toISOString(), source: 'NASA/JPL Horizons', frame: 'ICRF equatorial, geocentric, units of 1000 km', probes: [] };

for (const [id, name, step, note] of PROBES) {
  let rows = null, lastErr = '';
  for (const [a, b] of WINDOWS) {
    try { rows = await horizons(id, today + a * DAY, today + b * DAY, step); break; } catch (e) { lastErr = e.message; }
  }
  if (!rows || rows.length < 2) { console.warn(`${name}: skipped (${lastErr})`); continue; }
  const xyz = [];
  for (const r of rows) xyz.push(Math.round(r.x / 100) / 10, Math.round(r.y / 100) / 10, Math.round(r.z / 100) / 10);
  out.probes.push({ id, name, note, t0: Math.round(rows[0].t), dt: Math.round(rows[1].t - rows[0].t), xyz });
  const d = Math.hypot(rows.at(-1).x, rows.at(-1).y, rows.at(-1).z);
  console.log(`${name.padEnd(20)} ${rows.length} points ${iso(rows[0].t)} → ${iso(rows.at(-1).t)}  ${(d / 1.496e8).toFixed(3)} AU from Earth`);
}
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${out.probes.length} probes, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB → ${OUT}`);
