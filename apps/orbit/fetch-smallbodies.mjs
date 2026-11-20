// Fetches heliocentric osculating orbital elements (ecliptic J2000) for the
// dwarf planets and a few famous distant bodies from NASA/JPL Horizons, and
// writes public/smallbodies.json. Positions are then propagated as two-body
// Kepler orbits, which is accurate for these slow, distant objects over years.
//
//   node apps/orbit/fetch-smallbodies.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(dir, 'public', 'smallbodies.json');
const BODIES = [
  ['999', 'Pluto', 'Dwarf planet; visited by New Horizons in 2015'],
  ['136199;', 'Eris', 'Dwarf planet, about as massive as Pluto'],
  ['136472;', 'Makemake', 'Dwarf planet in the Kuiper Belt'],
  ['136108;', 'Haumea', 'Fast-spinning, egg-shaped dwarf planet'],
  ['225088;', 'Gonggong', 'Distant dwarf planet candidate'],
  ['50000;', 'Quaoar', 'Kuiper Belt object with a ring'],
  ['90377;', 'Sedna', 'Its orbit reaches about 1,000 AU from the Sun'],
  ['486958;', 'Arrokoth', 'Most distant object ever visited (New Horizons, 2019)'],
  ['DES=1P;CAP;NOFRAG', "Halley's Comet", 'Returns every ~76 years; next perihelion 2061'],
];
const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const out = { generated: new Date().toISOString(), source: 'NASA/JPL Horizons osculating elements, heliocentric ecliptic J2000', bodies: [] };

for (const [cmd, name, note] of BODIES) {
  const q = new URLSearchParams({
    format: 'json', COMMAND: `'${cmd}'`, EPHEM_TYPE: "'ELEMENTS'", CENTER: "'500@10'",
    START_TIME: `'${today}'`, STOP_TIME: `'${tomorrow}'`, STEP_SIZE: "'1 d'",
    REF_PLANE: "'ECLIPTIC'", REF_SYSTEM: "'ICRF'", OUT_UNITS: "'AU-D'", CSV_FORMAT: "'YES'", OBJ_DATA: "'NO'",
  });
  try {
    const res = await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${q}`);
    const { result = '', error } = await res.json();
    if (error) throw new Error(error.split('\n')[0]);
    const a = result.indexOf('$$SOE');
    if (a < 0) throw new Error(result.split('\n').find((l) => /no matches|error|ambiguous/i.test(l)) || 'no data');
    const c = result.slice(a + 5).trim().split('\n')[0].split(',').map((x) => x.trim());
    // JDTDB, date, EC, QR, IN, OM, W, Tp, N, MA, TA, A, AD, PR
    const body = { name, note, epoch: Math.round((Number(c[0]) - 2440587.5) * 86400000), e: +c[2], i: +c[4], om: +c[5], w: +c[6], n: +c[8], ma: +c[9], a: +c[11] };
    out.bodies.push(body);
    console.log(`${name.padEnd(15)} a=${body.a.toFixed(2)} AU  e=${body.e.toFixed(3)}  i=${body.i.toFixed(1)}°  aphelion ${(body.a * (1 + body.e)).toFixed(0)} AU`);
  } catch (e) {
    console.warn(`${name}: skipped (${e.message})`);
  }
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`wrote ${out.bodies.length} bodies → ${OUT}`);
