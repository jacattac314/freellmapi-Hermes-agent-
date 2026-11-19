// Synthetic data for DEMO=1 (offline development / screenshots).
// Shaped exactly like the real CelesTrak CSV and NOAA SWPC JSON so the client
// code path is identical. The UI shows a DEMO banner whenever this is in use.

const MU = 398600.4418; // km^3/s^2
const RE = 6378.137;

function meanMotion(altKm) {
  const a = RE + altKm;
  return (Math.sqrt(MU / a ** 3) * 86400) / (2 * Math.PI); // rev/day
}

const DEMO_SHOCK_AT = Date.now() - 25 * 60000;

let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

export function synthCatalogCsv() {
  seed = 42;
  const epoch = new Date().toISOString().replace('Z', '');
  const header = 'OBJECT_NAME,OBJECT_ID,EPOCH,MEAN_MOTION,ECCENTRICITY,INCLINATION,RA_OF_ASC_NODE,ARG_OF_PERICENTER,MEAN_ANOMALY,EPHEMERIS_TYPE,CLASSIFICATION_TYPE,NORAD_CAT_ID,ELEMENT_SET_NO,REV_AT_EPOCH,BSTAR,MEAN_MOTION_DOT,MEAN_MOTION_DDOT';
  const rows = [header];
  let id = 90000;
  const add = (name, alt, inc, raan, ma, ecc = 0.0001, n = null, norad = null) => {
    rows.push([name, '2026-001A', epoch, (n ?? meanMotion(alt)).toFixed(8), ecc.toFixed(7), inc.toFixed(4),
      raan.toFixed(4), '0.0000', ma.toFixed(4), 0, 'U', norad ?? id++, 999, 1, '0.0001', '0.00001', 0].join(','));
  };
  add('ISS (ZARYA)', 418, 51.64, 120, 0, 0.0001, null, 25544);
  add('CSS (TIANHE)', 385, 41.47, 300, 90, 0.0001, null, 48274);
  for (let p = 0; p < 72; p++) for (let s = 0; s < 22; s++) add(`STARLINK-${p * 22 + s}`, 550, 53, p * 5, s * (360 / 22) + p * 2);
  for (let p = 0; p < 36; p++) for (let s = 0; s < 20; s++) add(`STARLINK-P${p * 20 + s}`, 540, 43, p * 10, s * 18 + p);
  for (let p = 0; p < 18; p++) for (let s = 0; s < 36; s++) add(`ONEWEB-${p * 36 + s}`, 1200, 87.9, p * 10, s * 10);
  for (let p = 0; p < 6; p++) for (let s = 0; s < 5; s++) add(`GPS BIIF-${p * 5 + s} (PRN ${p * 5 + s})`, 20180, 55, p * 60, s * 72);
  for (let p = 0; p < 3; p++) for (let s = 0; s < 8; s++) add(`GALILEO ${p * 8 + s}`, 23222, 56, p * 120, s * 45);
  for (let i = 0; i < 420; i++) add(`GEO SAT ${i}`, 35786, rand() * 2, rand() * 360, rand() * 360, 0.0002, 1.0027);
  for (let i = 0; i < 2500; i++) add(`LEO OBJECT ${i}`, 400 + rand() * 1100, 20 + rand() * 80, rand() * 360, rand() * 360, rand() * 0.01);
  for (let i = 0; i < 60; i++) add(`MOLNIYA ${i}`, 0, 63.4, rand() * 360, rand() * 360, 0.72, 2.006);
  return rows.join('\n') + '\n';
}

export function synthNoaa(key) {
  const now = Date.now();
  const tag = (minsAgo) => new Date(now - minsAgo * 60000).toISOString().slice(0, 19);
  // A shock (CME-like jump to fast, dense, south-pointing wind) passed L1 25 min
  // before this module loaded, so it reaches Earth ~20 min after the page opens.
  const sinceShock = (minsAgo) => (now - minsAgo * 60000 - DEMO_SHOCK_AT) / 60000;
  if (key === 'wind') {
    return Array.from({ length: 240 }, (_, i) => {
      const m = sinceShock(i + 1), after = m >= 0;
      return {
        time_tag: tag(i + 1), active: true, source: 'DEMO',
        proton_speed: after ? 610 + 25 * Math.sin(m / 6) : 370 + 15 * Math.sin(i / 9),
        proton_density: after ? 6 + 16 * Math.exp(-m / 12) : 4 + Math.sin(i / 11),
        proton_temperature: after ? 300000 : 70000,
      };
    });
  }
  if (key === 'mag') {
    return Array.from({ length: 240 }, (_, i) => {
      const m = sinceShock(i + 1);
      return { time_tag: tag(i + 1), active: true, source: 'DEMO', bt: m >= 0 ? 18 : 5, bx_gsm: 2.1, by_gsm: -3.2, bz_gsm: m >= 0 ? -12 + 3 * Math.sin(m / 4) : 2 + Math.sin(i / 5) };
    });
  }
  if (key === 'xray') {
    return Array.from({ length: 60 }, (_, i) => ({ time_tag: tag(i + 1), satellite: 19, energy: '0.1-0.8nm', flux: 2.4e-6, observed_flux: 2.4e-6 }));
  }
  if (key === 'aurora') {
    const coordinates = [];
    for (let lon = 0; lon < 360; lon++) {
      for (let lat = -90; lat <= 90; lat++) {
        const ovalLat = 67 - 5 * Math.cos(((lon - 0) * Math.PI) / 180);
        const d = Math.abs(Math.abs(lat) - ovalLat);
        const v = Math.max(0, Math.round(40 * Math.exp(-(d * d) / 8) * (0.6 + 0.4 * Math.sin(lon / 20))));
        coordinates.push([lon, lat, v]);
      }
    }
    return { 'Observation Time': new Date(now - 10 * 60000).toISOString(), 'Forecast Time': new Date(now + 30 * 60000).toISOString(), 'Data Format': '[Longitude, Latitude, Aurora]', coordinates };
  }
  return [];
}
