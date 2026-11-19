import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { gstime } from '/vendor/satellite.js/dist/propagation.js';
import { eciToEcf } from '/vendor/satellite.js/dist/transforms.js';
import { sunPos } from '/vendor/satellite.js/dist/sun.js';
import { jday } from '/vendor/satellite.js/dist/ext.js';

// Units: 1 scene unit = 1 Earth radius. Frame: Earth-fixed (ECF), three.js
// Y-up, so x = ECF x, y = ECF z (north), z = -ECF y.
const RE_KM = 6378.137;
const OMEGA_EARTH = 7.2921159e-5; // rad/s
const CORR_MS = 5000; // how long an orbit-update correction takes to ease in
const $ = (id) => document.getElementById(id);
const toThree = (v) => new THREE.Vector3(v.x, v.z, -v.y);

// Simulation clock. Live = real time. Time-warp runs it `rate`× faster from
// wherever it is; Live jumps back to now. Satellites, Sun, Moon and day/night
// follow it; measured data (solar wind, aurora) always stays on real time.
let simClock = { anchorReal: Date.now(), anchorSim: Date.now(), rate: 1, epoch: 0 };
const simNow = () => simClock.anchorSim + (Date.now() - simClock.anchorReal) * simClock.rate;

// ------------------------------------------------------------------ scene
const container = $('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
container.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
Object.assign(labelRenderer.domElement.style, { position: 'absolute', top: '0', pointerEvents: 'none' });
container.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.001, 200000);
camera.position.set(2.2, 1.6, 2.6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.15;
controls.maxDistance = 1500;
controls.enablePan = false;

scene.add(new THREE.AmbientLight(0x334466, 0.35));
const sunLight = new THREE.DirectionalLight(0xffffff, 2.2);
scene.add(sunLight);

// Stars
{
  const n = 3000, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(80000);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8899bb, size: 1.2, sizeAttenuation: false })));
}

// Earth
const earth = new THREE.Mesh(
  new THREE.SphereGeometry(1, 96, 64),
  new THREE.MeshPhongMaterial({ color: 0x0e2f55, emissive: 0x020812, shininess: 12, specular: 0x223344 }),
);
scene.add(earth);

// Atmosphere rim glow
scene.add(new THREE.Mesh(
  new THREE.SphereGeometry(1.03, 64, 48),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 3.0); gl_FragColor = vec4(0.3,0.6,1.0,1.0)*f*0.9; }',
  }),
));

function lonLatToVec(lon, lat, r = 1) {
  const la = THREE.MathUtils.degToRad(lat), lo = THREE.MathUtils.degToRad(lon);
  // ECF: x = cos(lat)cos(lon), y = cos(lat)sin(lon), z = sin(lat) -> three (x, z, -y)
  return new THREE.Vector3(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
}

// Graticule
{
  const pts = [];
  for (let lat = -60; lat <= 60; lat += 30) for (let lon = 0; lon < 360; lon += 2) pts.push(lonLatToVec(lon, lat, 1.001), lonLatToVec(lon + 2, lat, 1.001));
  for (let lon = 0; lon < 360; lon += 30) for (let lat = -88; lat < 88; lat += 2) pts.push(lonLatToVec(lon, lat, 1.001), lonLatToVec(lon, lat + 2, 1.001));
  scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0x1d4a7a, transparent: true, opacity: 0.35 })));
}

// Coastlines (Natural Earth 110m via world-atlas)
fetch('/vendor/world-atlas/land-110m.json').then((r) => r.json()).then((topo) => {
  const mesh = window.topojson.mesh(topo, topo.objects.land);
  const pts = [];
  for (const line of mesh.coordinates) {
    for (let i = 0; i < line.length - 1; i++) pts.push(lonLatToVec(...line[i], 1.0015), lonLatToVec(...line[i + 1], 1.0015));
  }
  scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0x5fb3ea, transparent: true, opacity: 0.75 })));
}).catch((e) => console.warn('coastlines', e));

// GEO ring
const GEO_R = 42164 / RE_KM;
const geoRing = new THREE.LineLoop(
  new THREE.BufferGeometry().setFromPoints(Array.from({ length: 256 }, (_, i) => {
    const a = (i / 256) * Math.PI * 2; return new THREE.Vector3(GEO_R * Math.cos(a), 0, GEO_R * Math.sin(a));
  })),
  new THREE.LineBasicMaterial({ color: 0xff8a65, transparent: true, opacity: 0.25 }),
);
scene.add(geoRing);

function makeLabel(html) {
  const div = document.createElement('div');
  div.className = 'label3d';
  div.innerHTML = html;
  return new CSS2DObject(div);
}

// Moon
const moon = new THREE.Mesh(new THREE.SphereGeometry(1737.4 / RE_KM, 48, 32), new THREE.MeshPhongMaterial({ color: 0x9a9a9a }));
const moonLabel = makeLabel('Moon');
moon.add(moonLabel);
scene.add(moon);

// Sun marker (direction only — the real Sun is ~23,500 Earth radii away)
function glowTexture(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner); grd.addColorStop(0.25, inner); grd.addColorStop(1, outer);
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,244,214,1)', 'rgba(255,200,80,0)'), depthWrite: false, blending: THREE.AdditiveBlending }));
sunSprite.scale.setScalar(160);
const sunLabel = makeLabel('Sun <small>direction · not to scale</small>');
sunSprite.add(sunLabel);
scene.add(sunSprite);

// L1 — where ACE / DSCOVR measure the solar wind before it reaches Earth
const L1_R = 1.5e6 / RE_KM;
const l1 = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,213,79,1)', 'rgba(255,213,79,0)'), depthWrite: false }));
l1.scale.setScalar(6);
const l1Label = makeLabel('Sun–Earth L1');
l1.add(l1Label);
scene.add(l1);
const sunLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]),
  new THREE.LineDashedMaterial({ color: 0xffd54f, dashSize: 4, gapSize: 4, transparent: true, opacity: 0.35 }));
scene.add(sunLine);

// Low-precision lunar position (≈0.3°, plenty for a visual), ECI km.
function moonEci(date) {
  const d = (date.getTime() / 86400000 + 2440587.5) - 2451545.0;
  const rad = Math.PI / 180;
  const L = (218.316 + 13.176396 * d) * rad, M = (134.963 + 13.064993 * d) * rad, F = (93.272 + 13.22935 * d) * rad;
  const lon = L + 6.289 * rad * Math.sin(M), lat = 5.128 * rad * Math.sin(F), dist = 385001 - 20905 * Math.cos(M);
  const eps = 23.439 * rad;
  const x = dist * Math.cos(lat) * Math.cos(lon), y = dist * Math.cos(lat) * Math.sin(lon), z = dist * Math.sin(lat);
  return { x, y: y * Math.cos(eps) - z * Math.sin(eps), z: y * Math.sin(eps) + z * Math.cos(eps) };
}

const sunDir = new THREE.Vector3(1, 0, 0);
const earthLabel = makeLabel('Earth');
earth.add(earthLabel);
function updateBodies(now) {
  const date = new Date(now);
  const gmst = gstime(date);
  const s = sunPos(jday(date)).rsun;
  sunDir.copy(toThree(eciToEcf(s, gmst))).normalize();
  sunLight.position.copy(sunDir).multiplyScalar(50);
  sunSprite.position.copy(sunDir).multiplyScalar(3000);
  l1.position.copy(sunDir).multiplyScalar(L1_R);
  sunLine.geometry.setFromPoints([sunDir.clone().multiplyScalar(1.05), sunDir.clone().multiplyScalar(L1_R)]);
  sunLine.computeLineDistances();
  const m = eciToEcf(moonEci(date), gmst);
  moon.position.copy(toThree(m)).divideScalar(RE_KM);
}

// ------------------------------------------------------------- satellites
const REGIME_COLOR = { LEO: 0x4fc3f7, MEO: 0xffd54f, GEO: 0xff8a65, HEO: 0xce93d8 };
const dotTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.beginPath(); g.arc(16, 16, 14, 0, Math.PI * 2); g.fill();
  return new THREE.CanvasTexture(c);
})();

let catalog = null; // { ids, names, regimes, groups, periods, epochs, dead }
let N = 0;
let satGeom = null, satPoints = null, posAttr = null;
let visible = new Uint8Array(0);
const satMat = new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, map: dotTex, alphaTest: 0.5, transparent: true });

const selMarker = new THREE.Points(
  new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)),
  new THREE.PointsMaterial({ size: 14, sizeAttenuation: false, color: 0xffffff, map: glowTexture('rgba(255,255,255,0)', 'rgba(255,255,255,0)'), transparent: true }),
);
// ring texture for selection
selMarker.material.map = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); g.strokeStyle = '#fff'; g.lineWidth = 6; g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.stroke();
  return new THREE.CanvasTexture(c);
})();
selMarker.visible = false;
selMarker.frustumCulled = false;
scene.add(selMarker);

const issMarker = new THREE.Points(
  new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)),
  new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, color: 0xffffff, map: dotTex, alphaTest: 0.5, transparent: true }),
);
issMarker.frustumCulled = false;
issMarker.visible = false;
const issLabel = makeLabel('ISS');
issMarker.add(issLabel);
scene.add(issMarker);
let issIndex = -1;

const trackLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
trackLine.visible = false;
trackLine.frustumCulled = false;
scene.add(trackLine);

function buildSatGeometry() {
  if (satPoints) { scene.remove(satPoints); satGeom.dispose(); }
  satGeom = new THREE.BufferGeometry();
  posAttr = new THREE.BufferAttribute(new Float32Array(N * 3), 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  satGeom.setAttribute('position', posAttr);
  const col = new Float32Array(N * 3);
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    c.setHex(catalog.groups[i] === 'station' ? 0xffffff : REGIME_COLOR[catalog.regimes[i]] ?? 0xaaaaaa);
    col.set([c.r, c.g, c.b], i * 3);
  }
  satGeom.setAttribute('color', new THREE.BufferAttribute(col, 3));
  satGeom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  satPoints = new THREE.Points(satGeom, satMat);
  satPoints.frustumCulled = false;
  scene.add(satPoints);
  issIndex = catalog.ids.indexOf('25544');
  issMarker.visible = issIndex >= 0;
  applyFilters();
}

// --- snapshot buffer + correction easing
/** @type {{t:number,pos:Float32Array,corr:null|{C:Float32Array,tS:number}}[]} */
const snaps = [];
let activeCorr = null;

// 1 → 0 over CORR_MS with a smoothstep, so the satellite accelerates onto the
// corrected track and settles gently instead of lurching.
function corrWeight(snap) {
  if (!snap.corr) return 0;
  const u = (snap.t - snap.corr.tS) / CORR_MS;
  return u <= 0 ? 1 : u >= 1 ? 0 : 1 - u * u * (3 - 2 * u);
}
// Adjusted (eased) value of component k in a snapshot.
function adj(snap, k, w) {
  const v = k < snap.pos.length ? snap.pos[k] : NaN;
  return snap.corr && k < snap.corr.C.length ? v - snap.corr.C[k] * w : v;
}

function onSnapshot(msg) {
  if (msg.epoch !== simClock.epoch) return; // computed for a clock setting we've since changed
  const snap = { t: msg.t, pos: msg.pos, corr: null };
  if (msg.corrected && snaps.length >= 2) {
    // New orbital elements: measure how far each satellite would "jump", then
    // ease that jump out over a few seconds instead of teleporting.
    const p1 = snaps[snaps.length - 1], p2 = snaps[snaps.length - 2];
    const w1 = corrWeight(p1), w2 = corrWeight(p2);
    const C = new Float32Array(snap.pos.length);
    for (let k = 0; k < C.length; k++) {
      const a = adj(p1, k, w1), b = adj(p2, k, w2);
      const predicted = a + (a - b) * ((snap.t - p1.t) / (p1.t - p2.t));
      const d = snap.pos[k] - predicted;
      C[k] = Number.isFinite(d) && Math.abs(d) < 0.5 ? d : 0; // >3000 km: just snap
    }
    activeCorr = { C, tS: snap.t };
    correctionsApplied++;
  }
  if (activeCorr && snap.t - activeCorr.tS < CORR_MS) snap.corr = activeCorr;
  else activeCorr = null;
  snaps.push(snap);
  snaps.sort((a, b) => a.t - b.t);
  while (snaps.length > 6) snaps.shift();
}
let correctionsApplied = 0;

const satPos = (i, out) => out.set(posAttr.array[i * 3], posAttr.array[i * 3 + 1], posAttr.array[i * 3 + 2]);

function updateSatellites(now) {
  if (!posAttr || snaps.length === 0) return;
  let A, B;
  for (let i = 0; i < snaps.length - 1; i++) if (snaps[i].t <= now && now < snaps[i + 1].t) { A = snaps[i]; B = snaps[i + 1]; }
  if (!A) { // worker behind (throttled tab) or not started: extrapolate from the newest pair
    B = snaps[snaps.length - 1]; A = snaps.length > 1 ? snaps[snaps.length - 2] : B;
  }
  const span = B.t - A.t;
  const alpha = span > 0 ? Math.min((now - A.t) / span, 3) : 0;
  const wA = corrWeight(A), wB = corrWeight(B);
  const arr = posAttr.array;
  for (let i = 0; i < N; i++) {
    const k = i * 3;
    if (!visible[i]) { arr[k] = arr[k + 1] = arr[k + 2] = 0; continue; } // parked inside Earth = hidden
    for (let j = 0; j < 3; j++) {
      const a = adj(A, k + j, wA), b = adj(B, k + j, wB);
      arr[k + j] = a + (b - a) * alpha;
    }
    if (!Number.isFinite(arr[k]) || !Number.isFinite(arr[k + 1]) || !Number.isFinite(arr[k + 2])) arr[k] = arr[k + 1] = arr[k + 2] = 0;
  }
  posAttr.needsUpdate = true;
  if (issIndex >= 0) {
    // Move the object itself (its vertex stays at 0,0,0) so the attached label follows.
    issMarker.position.set(arr[issIndex * 3], arr[issIndex * 3 + 1], arr[issIndex * 3 + 2]);
    issMarker.visible = visible[issIndex] === 1;
  }
  if (selected >= 0) {
    const p = selMarker.geometry.attributes.position;
    p.array.set(arr.subarray(selected * 3, selected * 3 + 3)); p.needsUpdate = true;
    selMarker.visible = visible[selected] === 1;
    // velocity for the info card (Earth-fixed + Earth rotation = inertial)
    const k = selected * 3;
    const pa = new THREE.Vector3(adj(A, k, wA), adj(A, k + 1, wA), adj(A, k + 2, wA));
    const pb = new THREE.Vector3(adj(B, k, wB), adj(B, k + 1, wB), adj(B, k + 2, wB));
    selVel.copy(pb).sub(pa).multiplyScalar(RE_KM / (span / 1000 || 1));
    const r = new THREE.Vector3(arr[k], arr[k + 1], arr[k + 2]).multiplyScalar(RE_KM);
    selVel.add(new THREE.Vector3(OMEGA_EARTH * r.z, 0, -OMEGA_EARTH * r.x));
  }
}

// --- worker wiring
const worker = new Worker('/sat-worker.js', { type: 'module' });
window.__orbit = { worker, get positions() { return posAttr?.array; } }; // debug hook (used by the smoothness test)
const freshness = { gp: null, gpError: null, satsLoaded: 0 };
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'catalog') {
    const grew = !catalog || m.ids.length !== N;
    catalog = m; N = m.ids.length;
    buildTypeList();
    if (grew) buildSatGeometry(); else applyFilters();
  } else if (m.type === 'snapshot') onSnapshot(m);
  else if (m.type === 'loaded') freshness.satsLoaded = m.total;
  else if (m.type === 'track' && selected >= 0 && catalog.ids[selected] === m.id) {
    trackLine.geometry.dispose();
    trackLine.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(m.pts, 3));
    trackLine.visible = true;
  }
};

let lastGpFetchedAt = 0;
async function pollCatalog() {
  try {
    const res = await fetch('/api/data/gp');
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    noteDemo(res);
    const fetchedAt = Number(res.headers.get('X-Fetched-At'));
    freshness.gpError = res.headers.get('X-Upstream-Error') || null;
    if (fetchedAt !== lastGpFetchedAt) {
      lastGpFetchedAt = fetchedAt;
      freshness.gp = fetchedAt;
      worker.postMessage({ type: 'elements', csv: await res.text() });
    }
  } catch (err) {
    freshness.gpError = String(err.message || err);
  }
}

// ---------------------------------------------------------------- filters
const regimeOn = { LEO: true, MEO: true, GEO: true, HEO: true };
const GROUPS = [
  ['station', 'Crewed stations'], ['starlink', 'Starlink'], ['oneweb', 'OneWeb'], ['kuiper', 'Amazon Kuiper'],
  ['gnss', 'Navigation (GPS, Galileo…)'], ['weather', 'Weather'], ['imaging', 'Earth imaging'],
  ['science', 'Science & telescopes'], ['comms', 'Communications'], ['other', 'Everything else'],
];
const groupOn = Object.fromEntries(GROUPS.map(([g]) => [g, true]));
document.querySelectorAll('[data-regime]').forEach((el) => el.addEventListener('change', () => { regimeOn[el.dataset.regime] = el.checked; applyFilters(); }));

function buildTypeList() {
  const counts = {};
  for (let i = 0; i < N; i++) if (!catalog.dead[i]) counts[catalog.groups[i]] = (counts[catalog.groups[i]] || 0) + 1;
  $('type-list').innerHTML = GROUPS.filter(([g]) => counts[g]).map(([g, label]) =>
    `<label><input type="checkbox" data-group="${g}" ${groupOn[g] ? 'checked' : ''} /> ${label}<span class="n">${counts[g].toLocaleString()}</span></label>`).join('');
  $('type-list').querySelectorAll('[data-group]').forEach((el) => el.addEventListener('change', () => { groupOn[el.dataset.group] = el.checked; applyFilters(); }));
}
function setAllTypes(on) {
  for (const [g] of GROUPS) groupOn[g] = on;
  $('type-list').querySelectorAll('[data-group]').forEach((el) => { el.checked = on; });
  applyFilters();
}
$('types-all').onclick = () => setAllTypes(true);
$('types-none').onclick = () => setAllTypes(false);

// Altitude band on a stepped scale that gives LEO room without losing GEO.
const ALT_STOPS = [0, 300, 450, 600, 800, 1200, 2000, 5000, 15000, 25000, 34000, 38000, Infinity];
const fmtAlt = (km) => (km === Infinity ? 'any' : km >= 1000 ? `${(km / 1000).toLocaleString()}k` : String(km));
function altBand() {
  let lo = Number($('alt-min').value), hi = Number($('alt-max').value);
  if (lo > hi) [lo, hi] = [hi, lo];
  return [ALT_STOPS[lo], ALT_STOPS[hi]];
}
for (const id of ['alt-min', 'alt-max']) $(id).addEventListener('input', applyFilters);
$('only-matches').addEventListener('change', applyFilters);

function applyFilters() {
  const [lo, hi] = altBand();
  $('alt-label').textContent = lo === 0 && hi === Infinity ? 'All altitudes' : `${fmtAlt(lo)} – ${fmtAlt(hi)} km`;
  if (!catalog) return;
  const q = $('only-matches').checked ? $('search').value.trim().toUpperCase() : '';
  visible = new Uint8Array(N);
  let count = 0;
  for (let i = 0; i < N; i++) {
    const on = !catalog.dead[i] && regimeOn[catalog.regimes[i]] && groupOn[catalog.groups[i]]
      && catalog.apogees[i] >= lo && catalog.perigees[i] <= hi
      && (!q || catalog.names[i].toUpperCase().includes(q) || catalog.ids[i] === q);
    visible[i] = on ? 1 : 0; count += visible[i];
  }
  const text = `Showing ${count.toLocaleString()} of ${N.toLocaleString()}`;
  $('sat-count').textContent = text;
  $('filter-count').textContent = text;
}

// Phone layout: panels are sheets toggled from the top bar.
function showPanel(side) {
  const other = side === 'left' ? 'right' : 'left';
  document.body.classList.remove(`show-${other}`);
  $(`toggle-${other}`).classList.remove('active');
  const on = document.body.classList.toggle(`show-${side}`);
  $(`toggle-${side}`).classList.toggle('active', on);
}
$('toggle-left').onclick = () => showPanel('left');
$('toggle-right').onclick = () => showPanel('right');

$('layer-rings').addEventListener('change', (e) => { geoRing.visible = e.target.checked; });
$('layer-labels').addEventListener('change', () => updateLabelVisibility());

// ------------------------------------------------------------- selection
let selected = -1;
let following = false;
const selVel = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function pick(clientX, clientY) {
  if (!satPoints) return -1;
  pointer.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  // Threshold in world units ≈ 6 px at the satellite's distance
  raycaster.params.Points.threshold = camera.position.length() * 0.008;
  const hits = raycaster.intersectObject(satPoints);
  const earthHit = raycaster.intersectObject(earth)[0];
  for (const h of hits) {
    if (!visible[h.index]) continue;
    if (earthHit && earthHit.distance < h.distance) continue; // behind the Earth
    return h.index;
  }
  return -1;
}

function select(i) {
  selected = i;
  following = false;
  $('sel-follow').classList.remove('active');
  trackLine.visible = false;
  if (i < 0) { $('selection').hidden = true; selMarker.visible = false; return; }
  $('selection').hidden = false;
  $('sel-name').textContent = catalog.names[i];
  if (innerWidth <= 820 && !document.body.classList.contains('show-right')) showPanel('right');
  worker.postMessage({ type: 'track', id: catalog.ids[i], t: simNow() });
}
$('sel-clear').onclick = () => select(-1);
$('sel-follow').onclick = () => { following = !following; $('sel-follow').classList.toggle('active', following); };
setInterval(() => { if (selected >= 0) worker.postMessage({ type: 'track', id: catalog.ids[selected], t: simNow() }); }, 10000);

function setRate(rate) {
  const live = rate === 1;
  simClock = { anchorReal: Date.now(), anchorSim: live ? Date.now() : simNow(), rate, epoch: simClock.epoch + 1 };
  snaps.length = 0; // positions now come from the new timeline
  activeCorr = null;
  worker.postMessage({ type: 'clock', clock: simClock });
  if (selected >= 0) worker.postMessage({ type: 'track', id: catalog.ids[selected], t: simNow() });
  document.querySelectorAll('#time-rate button').forEach((b) => b.classList.toggle('active', Number(b.dataset.rate) === rate));
}
document.querySelectorAll('#time-rate button').forEach((b) => { b.onclick = () => setRate(Number(b.dataset.rate)); });

let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
  const i = pick(e.clientX, e.clientY);
  if (i >= 0) select(i);
});
const tooltip = $('tooltip');
let hoverRaf = 0;
renderer.domElement.addEventListener('pointermove', (e) => {
  if (hoverRaf) return;
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0;
    const i = pick(e.clientX, e.clientY);
    if (i < 0) { tooltip.hidden = true; return; }
    tooltip.hidden = false;
    tooltip.textContent = `${catalog.names[i]} · ${catalog.regimes[i]}`;
    tooltip.style.left = `${e.clientX + 12}px`; tooltip.style.top = `${e.clientY + 12}px`;
  });
});

function renderSelection() {
  if (selected < 0) return;
  const p = new THREE.Vector3(); satPos(selected, p);
  const alt = p.length() * RE_KM - RE_KM;
  // geodetic-ish lat/lon (spherical; fine for display)
  const lat = THREE.MathUtils.radToDeg(Math.asin(p.y / p.length()));
  const lon = THREE.MathUtils.radToDeg(Math.atan2(-p.z, p.x));
  const epoch = new Date(catalog.epochs[selected].endsWith('Z') ? catalog.epochs[selected] : catalog.epochs[selected] + 'Z');
  const ageH = (Date.now() - epoch.getTime()) / 3600000;
  $('sel-body').innerHTML = `
    <dt>NORAD ID</dt><dd>${catalog.ids[selected]}</dd>
    <dt>Regime</dt><dd>${catalog.regimes[selected]}</dd>
    <dt>Altitude</dt><dd>${Math.round(alt).toLocaleString()} km</dd>
    <dt>Speed</dt><dd>${selVel.length().toFixed(2)} km/s</dd>
    <dt>Period</dt><dd>${catalog.periods[selected].toFixed(1)} min</dd>
    <dt>Over</dt><dd>${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}</dd>
    <dt>Elements</dt><dd>${ageH < 48 ? ageH.toFixed(1) + ' h' : (ageH / 24).toFixed(1) + ' d'} old<small>position is an SGP4 prediction</small></dd>`;
}

// search
const searchEl = $('search'), resultsEl = $('search-results');
searchEl.addEventListener('input', () => {
  resultsEl.innerHTML = '';
  if ($('only-matches').checked) applyFilters();
  const q = searchEl.value.trim().toUpperCase();
  if (!q || !catalog) return;
  let shown = 0;
  for (let i = 0; i < N && shown < 8; i++) {
    if (catalog.dead[i] || !(catalog.names[i].toUpperCase().includes(q) || catalog.ids[i] === q)) continue;
    const li = document.createElement('li');
    li.textContent = catalog.names[i];
    li.onclick = () => { select(i); flyToSatellite(i); resultsEl.innerHTML = ''; if (!$('only-matches').checked) searchEl.value = ''; };
    resultsEl.appendChild(li); shown++;
  }
});
searchEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') resultsEl.firstChild?.click(); });

function flyToSatellite(i) {
  const p = new THREE.Vector3(); satPos(i, p);
  if (p.lengthSq() === 0) return;
  const r = p.length();
  setScaleValue(distToScale(Math.max(r * 1.8, 1.9)));
  camDir.copy(p).normalize();
  flyDir = true;
}

// ----------------------------------------------------------- scale slider
const STOPS = [
  { name: 'Surface & aurora', dist: 1.9, desc: 'Close in: the aurora oval (NOAA OVATION forecast, ~30–90 min ahead), the ISS and the dense low-orbit shell. Night side is unlit.' },
  { name: 'Low Earth orbit', dist: 3.4, desc: 'LEO (below ~2,000 km): Starlink, OneWeb, the ISS and most of the catalog. Objects lap the planet every ~90–120 minutes.' },
  { name: 'Navigation orbits', dist: 10, desc: 'Medium Earth orbit (~20,000 km): GPS, Galileo, GLONASS and BeiDou, each orbiting about twice a day.' },
  { name: 'Geostationary belt', dist: 19, desc: 'GEO ring at 35,786 km. The cyan shell is the magnetopause, where Earth\'s magnetic field holds off the solar wind; it shrinks when wind pressure rises.' },
  { name: 'Earth–Moon', dist: 150, desc: 'The Moon at ~384,000 km (60 Earth radii). Satellites collapse into a speck at this scale. Moon position: low-precision ephemeris.' },
  { name: 'Sun–Earth L1', dist: 800, desc: '1.5 million km sunward: ACE and DSCOVR measure the solar wind here. The stream shows the last hour of those measurements on its way to Earth, coloured by speed.' },
];
const slider = $('scale-slider');
$('scale-ticks').innerHTML = STOPS.map((s, i) => `<span data-i="${i}" style="left:${(i / (STOPS.length - 1)) * 100}%">${s.name}</span>`).join('');
$('scale-ticks').querySelectorAll('span').forEach((el) => { el.onclick = () => setScaleValue(Number(el.dataset.i)); });

function scaleToDist(v) {
  const i = Math.min(Math.floor(v), STOPS.length - 2), f = v - i;
  return Math.exp(Math.log(STOPS[i].dist) * (1 - f) + Math.log(STOPS[i + 1].dist) * f);
}
function distToScale(d) {
  if (d <= STOPS[0].dist) return 0;
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (d <= STOPS[i + 1].dist) return i + (Math.log(d) - Math.log(STOPS[i].dist)) / (Math.log(STOPS[i + 1].dist) - Math.log(STOPS[i].dist));
  }
  return STOPS.length - 1;
}

let targetDist = null; // when set, camera eases (in log space) toward it
const camDir = new THREE.Vector3();
let flyDir = false;
let sideView = false;
function setScaleValue(v) {
  slider.value = String(v); targetDist = scaleToDist(v); updateScaleText(v);
  // At Moon / L1 scale, swing round to look side-on at the Sun–Earth line so Earth, Moon and L1 are all in frame.
  if (v >= 3.5 && !sideView && !following) {
    sideView = true;
    camDir.crossVectors(sunDir, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(0.95).add(new THREE.Vector3(0, 0.3, 0)).normalize();
    flyDir = true;
  } else if (v < 3.5) sideView = false;
}
slider.addEventListener('input', () => setScaleValue(Number(slider.value)));

let lastStop = -1;
function updateScaleText(v) {
  const i = Math.round(v);
  if (i === lastStop) return;
  lastStop = i;
  $('scale-title').textContent = STOPS[i].name;
  $('scale-desc').textContent = STOPS[i].desc;
  $('scale-ticks').querySelectorAll('span').forEach((el, j) => el.classList.toggle('on', j === i));
}

function updateCamera(dt) {
  let dist = camera.position.length();
  if (targetDist !== null) {
    const k = 1 - Math.exp(-dt * 4);
    dist = Math.exp(Math.log(dist) + (Math.log(targetDist) - Math.log(dist)) * k);
    if (Math.abs(Math.log(dist / targetDist)) < 0.002) { dist = targetDist; targetDist = null; }
  }
  const dir = camera.position.clone().normalize();
  if (following && selected >= 0) {
    const p = new THREE.Vector3(); satPos(selected, p);
    if (p.lengthSq() > 0) dir.lerp(p.normalize(), 1 - Math.exp(-dt * 3)).normalize();
  } else if (flyDir) {
    dir.lerp(camDir, 1 - Math.exp(-dt * 3)).normalize();
    if (dir.angleTo(camDir) < 0.002) flyDir = false;
  }
  camera.position.copy(dir.multiplyScalar(dist));
  if (targetDist === null) { slider.value = String(distToScale(dist)); updateScaleText(Number(slider.value)); }

  // Point size grows a touch when zoomed in; selection/labels adapt to scale.
  satMat.size = dist < 4 ? 3.2 : dist < 25 ? 2.6 : 2;
  controls.rotateSpeed = dist > 50 ? 0.6 : 1;
  updateLabelVisibility(dist);
}

function updateLabelVisibility(dist = camera.position.length()) {
  const on = $('layer-labels').checked;
  issLabel.visible = on && dist < 30;
  moonLabel.visible = on && dist > 25;
  earthLabel.visible = on && dist > 60;
  l1Label.visible = on && dist > 80;
  sunLabel.visible = on && dist > 80;
  auroraPoints.visible = $('layer-aurora').checked && dist < 12;
  mpLabel.visible = on && dist > 8 && dist < 120;
}

// ------------------------------------------------------------ aurora layer
const auroraPoints = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({
  size: 0.03, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, map: dotTex,
}));
scene.add(auroraPoints);
$('layer-aurora').addEventListener('change', () => updateLabelVisibility());

// ----------------------------------------------------------- space weather
const wx = { wind: null, mag: null, xray: null, aurora: null };
const parseTime = (s) => new Date(String(s).replace(' ', 'T').replace(/(\.\d+)?Z?$/, 'Z'));

function latest(rows, field, filter = () => true) {
  if (!Array.isArray(rows)) return null;
  const ok = rows.filter((r) => r && r[field] != null && Number.isFinite(Number(r[field])) && filter(r));
  if (!ok.length) return null;
  const active = ok.filter((r) => r.active !== false);
  const pool = active.length ? active : ok;
  return pool.reduce((a, b) => (parseTime(a.time_tag) > parseTime(b.time_tag) ? a : b));
}

async function fetchJson(key) {
  const res = await fetch(`/api/data/${key}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  noteDemo(res);
  return res.json();
}

async function pollWeather() {
  await Promise.all(['wind', 'mag', 'xray'].map(async (k) => {
    try { wx[k] = { data: await fetchJson(k), error: null }; } catch (e) { wx[k] = { ...(wx[k] || {}), error: String(e.message || e) }; }
  }));
  rebuildWindSeries();
}

async function pollAurora() {
  try {
    const data = await fetchJson('aurora');
    wx.aurora = { data, error: null };
    const pts = [], cols = [], c = new THREE.Color();
    for (const [lon, lat, v] of data.coordinates || []) {
      // OVATION's grid carries a spurious non-zero row on the equator; real aurora
      // stays poleward of ~30° even in extreme storms.
      if (v < 4 || Math.abs(lat) < 30) continue;
      pts.push(lonLatToVec(lon, lat, 1.012));
      const t = Math.min(v / 30, 1); // OVATION values are % probability; >30 is a strong display
      c.setRGB(0.15 + 0.85 * Math.max(0, t - 0.5) * 2, 0.9 - 0.4 * t, 0.35); // green → red as intensity rises
      cols.push(c.r * (0.4 + t), c.g * (0.4 + t), c.b * (0.4 + t));
    }
    auroraPoints.geometry.dispose();
    auroraPoints.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    auroraPoints.geometry.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  } catch (e) { wx.aurora = { ...(wx.aurora || {}), error: String(e.message || e) }; }
}

function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (!Number.isFinite(s)) return '—';
  if (s < 90) return `${Math.max(0, Math.round(s))} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${(s / 3600).toFixed(1)} h ago`;
  return `${(s / 86400).toFixed(1)} d ago`;
}
function dot(ageMs, freshMs) {
  return `<span class="dot ${ageMs < freshMs ? 'ok' : ageMs < freshMs * 4 ? 'stale' : 'bad'}"></span>`;
}
function xrayClass(flux) {
  const classes = [['X', 1e-4], ['M', 1e-5], ['C', 1e-6], ['B', 1e-7], ['A', 1e-8]];
  for (const [k, base] of classes) if (flux >= base) return `${k}${(flux / base).toFixed(1)}`;
  return '<A';
}

function renderWeather() {
  const rows = [];
  const w = latest(wx.wind?.data, 'proton_speed');
  const d = latest(wx.wind?.data, 'proton_density');
  const b = latest(wx.mag?.data, 'bz_gsm');
  const x = latest(wx.xray?.data, 'flux', (r) => r.energy === '0.1-0.8nm');
  if (w) {
    const t = parseTime(w.time_tag);
    const v = Number(w.proton_speed);
    rows.push(`<dt>${dot(Date.now() - t, 5 * 60000)}Solar wind</dt><dd>${Math.round(v)} km/s<small>measured ${ago(t)} · reaches Earth in ~${Math.round(1.5e6 / v / 60)} min</small></dd>`);
    l1Label.element.innerHTML = `Sun–Earth L1 <small>solar wind ${Math.round(v)} km/s · ~${Math.round(1.5e6 / v / 60)} min to Earth</small>`;
  } else rows.push(`<dt>Solar wind</dt><dd class="muted">${wx.wind?.error ? 'unavailable' : 'loading…'}</dd>`);
  if (d) rows.push(`<dt>Density</dt><dd>${Number(d.proton_density).toFixed(1)} p/cm³</dd>`);
  if (b) {
    const bz = Number(b.bz_gsm), t = parseTime(b.time_tag);
    rows.push(`<dt>${dot(Date.now() - t, 5 * 60000)}IMF Bz</dt><dd class="${bz < 0 ? 'south' : 'north'}">${bz.toFixed(1)} nT<small>${bz < -5 ? 'strongly south — aurora likely to strengthen' : bz < 0 ? 'southward — energy coupling in' : 'northward — quiet coupling'}</small></dd>`);
  } else rows.push(`<dt>IMF Bz</dt><dd class="muted">${wx.mag?.error ? 'unavailable' : 'loading…'}</dd>`);
  if (x) {
    const t = parseTime(x.time_tag);
    rows.push(`<dt>${dot(Date.now() - t, 10 * 60000)}X-ray flux</dt><dd>${xrayClass(Number(x.flux))}<small>GOES · ${ago(t)}</small></dd>`);
  } else rows.push(`<dt>X-ray flux</dt><dd class="muted">${wx.xray?.error ? 'unavailable' : 'loading…'}</dd>`);
  const a = wx.aurora?.data;
  if (a) {
    const t = parseTime(a['Observation Time']);
    rows.push(`<dt>${dot(Date.now() - t, 20 * 60000)}Aurora</dt><dd>forecast<small>model run from ${ago(t)} data · not an observation</small></dd>`);
  }
  $('wx').innerHTML = rows.join('') + windRows().join('');
}

function renderFreshness() {
  const now = Date.now();
  const rows = [];
  if (freshness.gp) {
    rows.push(`<dt>${dot(now - freshness.gp, 3 * 3600000)}Orbits</dt><dd>${ago(freshness.gp)}<small>CelesTrak elements · refetched ≤ every 2 h</small></dd>`);
  } else rows.push(`<dt><span class="dot bad"></span>Orbits</dt><dd>${freshness.gpError ? 'unavailable' : 'loading…'}<small>${freshness.gpError ?? ''}</small></dd>`);
  if (freshness.gpError && freshness.gp) rows.push(`<dt></dt><dd><small>last refresh failed: serving cached copy</small></dd>`);
  const newest = snaps[snaps.length - 1];
  rows.push(`<dt>Positions</dt><dd>${newest ? 'SGP4 · 1 Hz' : '—'}<small>interpolated to frame rate${correctionsApplied ? ` · ${correctionsApplied} smooth correction${correctionsApplied > 1 ? 's' : ''}` : ''}</small></dd>`);
  rows.push(`<dt>ISS sensors</dt><dd>${iss.lastUpdate ? ago(iss.lastUpdate) : '—'}<small>${iss.status}</small></dd>`);
  $('freshness').innerHTML = rows.join('');
}

let demoShown = false;
function noteDemo(res) {
  const mode = res.headers.get('X-Demo');
  if (demoShown || (mode !== '1' && mode !== 'snapshot')) return;
  demoShown = true;
  if (mode === 'snapshot') {
    // Real data bundled into the page at publish time (no live fetching available).
    const at = new Date(Number(res.headers.get('X-Fetched-At'))).toISOString().replace('T', ' ').slice(0, 16);
    $('demo-banner').textContent = `REAL DATA SNAPSHOT · ${at} UTC · satellites move live from real orbits; space weather is frozen at this time`;
    $('demo-banner').classList.add('snapshot');
  }
  $('demo-banner').hidden = false;
  document.body.classList.add('demo');
}

// ------------------------------------------------------- ISS live telemetry
// NASA's public ISS telemetry via Lightstreamer (adapter set ISSLIVE).
// Channel meanings follow the community ISS Mimic dictionary — treat labels
// as best-effort. Values only change while the station has a ground link
// (TIME_000001 Status.Class === "24" means signal acquired).
const ISS_CHANNELS = {
  // ISSLive reports this in mmHg (~760 at sea-level pressure).
  USLAB000058: { label: 'Cabin pressure (Lab)', fmt: (v) => `${(Number(v) * 0.0193368).toFixed(2)} psi<small>${Math.round(Number(v))} mmHg</small>` },
  USLAB000059: { label: 'Cabin temp (Lab)', fmt: (v) => `${Number(v).toFixed(1)} °C` },
  NODE3000001: { label: 'O₂ partial pressure', fmt: (v) => `${Number(v).toFixed(1)} mmHg` },
  NODE3000003: { label: 'CO₂ partial pressure', fmt: (v) => `${Number(v).toFixed(2)} mmHg` },
};
const iss = { values: {}, lastUpdate: 0, signal: null, status: 'connecting' };

async function startIssTelemetry() {
  try {
    const { LightstreamerClient, Subscription } = await import('/vendor/lightstreamer-client-web/lightstreamer-core.esm.js');
    const client = new LightstreamerClient('https://push.lightstreamer.com', 'ISSLIVE');
    client.addListener({ onStatusChange: (s) => { iss.status = s.startsWith('CONNECTED') ? 'connected' : s.toLowerCase(); renderIss(); } });
    const sub = new Subscription('MERGE', Object.keys(ISS_CHANNELS), ['Value', 'TimeStamp']);
    sub.addListener({ onItemUpdate: (u) => { iss.values[u.getItemName()] = u.getValue('Value'); iss.lastUpdate = Date.now(); renderIss(); } });
    const time = new Subscription('MERGE', ['TIME_000001'], ['TimeStamp', 'Value', 'Status.Class']);
    time.addListener({ onItemUpdate: (u) => { iss.signal = u.getValue('Status.Class') === '24'; renderIss(); } });
    client.subscribe(sub);
    client.subscribe(time);
    client.connect();
  } catch (e) {
    iss.status = `unavailable (${e.message || e})`;
    renderIss();
  }
}
function renderIss() {
  $('iss-signal').innerHTML = iss.signal === null
    ? `<span class="muted">${iss.status}</span>`
    : iss.signal
      ? '<span class="dot ok"></span>Signal acquired — values are live'
      : '<span class="dot stale"></span>Loss of signal — values frozen at last downlink';
  $('iss-tm').innerHTML = Object.entries(ISS_CHANNELS).map(([id, ch]) => {
    const v = iss.values[id];
    return `<dt title="${id}">${ch.label}</dt><dd>${v == null || v === '' || Number.isNaN(Number(v)) ? '—' : ch.fmt(v)}</dd>`;
  }).join('');
}

// ------------------------------------------------------- solar wind stream
// Particles flow from L1 toward Earth. A particle is a parcel of plasma that
// passed L1 `age` seconds ago; it carries the measurement from that moment and
// sits where that measured speed has carried it. So the stream is the last
// ~hour of real L1 data laid out in space, fast wind overtaking slow wind piles
// up into a front, and arrival times follow each parcel's own speed. The
// animation can be sped up (the real trip takes ~40–90 min).
// Around Earth the flow is pushed aside by the bow shock / magnetopause, whose
// size comes from the Shue et al. (1998) model driven by the wind hitting now.
const L1_KM = 1.5e6;
const WIND_N = 3500;
const WIND_R = 28; // half-width of the drawn stream, Earth radii
const windA = new Float32Array(WIND_N), windU = new Float32Array(WIND_N), windV = new Float32Array(WIND_N), windK = new Float32Array(WIND_N);
for (let i = 0; i < WIND_N; i++) {
  windA[i] = -1; // seeded on first update
  const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * WIND_R;
  windU[i] = r * Math.cos(a); windV[i] = r * Math.sin(a); windK[i] = Math.random();
}
const windGeom = new THREE.BufferGeometry();
windGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(WIND_N * 3), 3).setUsage(THREE.DynamicDrawUsage));
windGeom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(WIND_N * 3), 3).setUsage(THREE.DynamicDrawUsage));
const windPoints = new THREE.Points(windGeom, new THREE.PointsMaterial({
  size: 2.4, sizeAttenuation: false, vertexColors: true, map: dotTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
}));
windPoints.frustumCulled = false;
scene.add(windPoints);

let windSeries = []; // [{t, v, n, bz}] ascending
function rebuildWindSeries() {
  const byMin = new Map();
  const put = (row, fields) => {
    const t = parseTime(row.time_tag).getTime();
    if (!Number.isFinite(t)) return;
    const k = Math.round(t / 60000);
    const e = byMin.get(k) || { t: k * 60000 };
    for (const [src, dst] of fields) {
      const v = Number(row[src]);
      if (row[src] == null || !Number.isFinite(v)) continue;
      if (e[dst] === undefined || row.active !== false) e[dst] = v; // prefer the active spacecraft
    }
    byMin.set(k, e);
  };
  for (const r of Array.isArray(wx.wind?.data) ? wx.wind.data : []) put(r, [['proton_speed', 'v'], ['proton_density', 'n']]);
  for (const r of Array.isArray(wx.mag?.data) ? wx.mag.data : []) put(r, [['bz_gsm', 'bz']]);
  const rows = [...byMin.values()].sort((a, b) => a.t - b.t);
  // carry values forward over gaps so every minute has a full record
  let last = { v: 400, n: 5, bz: 0 };
  windSeries = rows.map((r) => (last = { t: r.t, v: r.v ?? last.v, n: r.n ?? last.n, bz: r.bz ?? last.bz }))
    .filter((r) => r.v > 100);
}
function windAt(t) {
  const s = windSeries;
  if (!s.length) return null;
  if (t <= s[0].t) return s[0];
  let lo = 0, hi = s.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid].t <= t) lo = mid; else hi = mid - 1; }
  return s[lo];
}
const travelMs = (v) => (L1_KM / v) * 1000;

// Shue et al. 1998 magnetopause: standoff r0 (Earth radii) and flaring α.
function magnetopause(v, n, bz) {
  const pd = 1.6726e-6 * n * v * v; // dynamic pressure, nPa
  const r0 = (10.22 + 1.29 * Math.tanh(0.184 * (bz + 8.14))) * Math.pow(pd, -1 / 6.6);
  const alpha = (0.58 - 0.007 * bz) * (1 + 0.024 * Math.log(pd));
  return { pd, r0, alpha };
}
const shueR = (mp, cosT) => mp.r0 * Math.pow(2 / Math.max(1 + cosT, 0.04), mp.alpha);

let mp = { pd: 2, r0: 10, alpha: 0.58 }; // what the wind arriving now produces
let mpShown = null;
const mpGroup = new THREE.Group();
scene.add(mpGroup);
const mpLabel = makeLabel('Magnetopause');
mpGroup.add(mpLabel);
function rebuildMagnetopause() {
  if (mpShown && Math.abs(mpShown.r0 - mp.r0) < 0.05 && Math.abs(mpShown.alpha - mp.alpha) < 0.005) return;
  mpShown = { ...mp };
  for (const c of [...mpGroup.children]) if (c !== mpLabel) { mpGroup.remove(c); c.geometry.dispose(); }
  const shape = (scale) => {
    const pts = [];
    for (let deg = 0; deg <= 105; deg += 5) {
      const th = THREE.MathUtils.degToRad(deg), r = Math.min(shueR(mp, Math.cos(th)) * scale, 40);
      pts.push(new THREE.Vector2(r * Math.sin(th), r * Math.cos(th)));
    }
    return new THREE.LatheGeometry(pts, 36);
  };
  const mk = (geo, color, opacity, wire) => new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, wireframe: wire,
  }));
  const mpGeo = shape(1);
  mpGroup.add(mk(mpGeo, 0x4dd0e1, 0.06, false), mk(mpGeo.clone(), 0x4dd0e1, 0.05, true));
  mpGroup.add(mk(shape(1.3), 0xffcc80, 0.025, false)); // bow shock, roughly 1.3× standoff
  mpLabel.position.set(0, mp.r0, 0);
}
function orientMagnetopause() {
  mpGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sunDir);
}

let windTimeScale = 60;
const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), wp = new THREE.Vector3();
function speedColour(v, out) {
  // 300 km/s slow → cool blue, ~450 typical → white, 700+ fast stream / CME → orange-red
  const t = THREE.MathUtils.clamp((v - 300) / 400, 0, 1);
  if (t < 0.4) out.setRGB(0.35 + t * 1.6, 0.6 + t, 1);
  else out.setRGB(1, 1 - (t - 0.4) * 1.3, 1 - (t - 0.4) * 1.6);
  return out;
}
const wc = new THREE.Color();
function updateWind(dt, now) {
  const latest = windSeries[windSeries.length - 1];
  const on = $('layer-wind').checked && !!latest;
  windPoints.visible = on;
  mpGroup.visible = on;
  if (!on) return;
  windStatus = windTimeline(now);
  const arriving = windStatus.arriving;
  if (arriving) { mp = magnetopause(arriving.v, Math.max(arriving.n, 0.1), arriving.bz); rebuildMagnetopause(); }
  orientMagnetopause();

  e1.crossVectors(sunDir, new THREE.Vector3(0, 1, 0));
  if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0);
  e1.normalize(); e2.crossVectors(sunDir, e1).normalize();

  const L1 = L1_KM / RE_KM;
  const maxAge = (1.3 * L1_KM) / 300; // s: long enough for slow wind to pass Earth
  const pos = windGeom.attributes.position.array, col = windGeom.attributes.color.array;
  for (let i = 0; i < WIND_N; i++) {
    if (windA[i] < 0) windA[i] = Math.random() * 1.3 * (L1_KM / latest.v);
    let a = windA[i] + dt * windTimeScale;
    let m = windAt(now - a * 1000);
    let s = (a * m.v) / L1_KM; // fraction of the L1→Earth distance covered
    if (s > 1.3 || a > maxAge) { a = 0; m = latest; s = 0; }
    windA[i] = a;
    const k = i * 3;
    if (windK[i] > m.n / 14) { // denser wind → more of the stream is filled
      pos[k] = pos[k + 1] = pos[k + 2] = 0; continue;
    }
    const x = (1 - s) * L1;
    wp.copy(sunDir).multiplyScalar(x).addScaledVector(e1, windU[i]).addScaledVector(e2, windV[i]);
    const r = wp.length();
    const bs = Math.min(1.3 * shueR(mp, x / r), 60);
    if (r < bs) wp.multiplyScalar(bs / r); // deflected around the bow shock
    pos[k] = wp.x; pos[k + 1] = wp.y; pos[k + 2] = wp.z;
    speedColour(m.v, wc);
    const fade = s > 1 ? Math.max(0, 1 - (s - 1) / 0.3) : Math.min(1, s * 20 + 0.05);
    col[k] = wc.r * fade; col[k + 1] = wc.g * fade; col[k + 2] = wc.b * fade;
  }
  windGeom.attributes.position.needsUpdate = true;
  windGeom.attributes.color.needsUpdate = true;
}

// Who is where on the L1→Earth trip right now, using each parcel's own speed.
let windStatus = { arriving: null, nextFront: null, latest: null };
function windTimeline(now) {
  const s = windSeries;
  const latest = s[s.length - 1];
  let arriving = null, front = null;
  for (let i = s.length - 1; i >= 0; i--) { // newest → oldest
    const r = s[i], eta = r.t + travelMs(r.v);
    if (eta <= now) { arriving = r; break; }
  }
  arriving ??= s[0];
  const pA = 1.6726e-6 * arriving.n * arriving.v * arriving.v;
  let best = Infinity;
  for (const r of s) { // a notably faster or harder-pushing parcel still in transit
    const eta = r.t + travelMs(r.v);
    if (eta <= now || eta >= best) continue;
    const p = 1.6726e-6 * r.n * r.v * r.v;
    if (r.v >= arriving.v + 75 || p >= 2 * pA) { best = eta; front = { ...r, eta, p }; }
  }
  return { arriving, nextFront: front, latest };
}
$('wind-speed').addEventListener('change', (e) => { windTimeScale = Number(e.target.value); });

function hhmm(t) { return new Date(t).toISOString().slice(11, 16); }
function windRows() {
  const { arriving, nextFront, latest } = windStatus;
  if (!latest || !arriving) return [];
  const now = Date.now();
  const eta = latest.t + travelMs(latest.v);
  const mins = (t) => Math.max(0, Math.round((t - now) / 60000));
  const press = mp.pd < 1 ? 'low' : mp.pd < 3 ? 'normal' : mp.pd < 6 ? 'elevated' : 'high';
  const rows = [];
  rows.push(`<dt>Hitting Earth now</dt><dd>${Math.round(arriving.v)} km/s · ${arriving.n.toFixed(1)} p/cm³<small>passed L1 at ${hhmm(arriving.t)} UTC, ${Math.round((now - arriving.t) / 60000)} min ago</small></dd>`);
  if (nextFront) {
    rows.push(`<dt class="south">Faster wind incoming</dt><dd class="south">${hhmm(nextFront.eta)} UTC<small>${Math.round(nextFront.v)} km/s · ${nextFront.p.toFixed(1)} nPa · arrives in ${mins(nextFront.eta)} min</small></dd>`);
  }
  rows.push(`<dt>Wind measured now</dt><dd>arrives ${hhmm(eta)} UTC<small>${Math.round(latest.v)} km/s · in ${mins(eta)} min</small></dd>`);
  rows.push(`<dt>Wind pressure</dt><dd>${mp.pd.toFixed(1)} nPa<small>${press} · of the wind hitting now</small></dd>`);
  rows.push(`<dt>Magnetopause</dt><dd>${mp.r0.toFixed(1)} R⊕<small>${Math.round(mp.r0 * RE_KM).toLocaleString()} km sunward${mp.r0 < GEO_R ? ' · inside GEO: geostationary satellites exposed' : ''}</small></dd>`);
  rows.push(`<dt></dt><dd><span class="wind-legend"></span><small>slow 300 · 450 · 700+ km/s fast</small></dd>`);
  mpLabel.element.innerHTML = `Magnetopause <small>${mp.r0.toFixed(1)} R⊕ · ${mp.pd.toFixed(1)} nPa</small>`;
  return rows;
}

// ------------------------------------------------------------------- loop
const clock = $('clock');
let lastFrame = performance.now();
let lastBodies = 0;
function frame(tNow) {
  const dt = Math.min((tNow - lastFrame) / 1000, 0.1);
  lastFrame = tNow;
  const now = Date.now();
  const sim = simNow();
  if (simClock.rate > 1 || now - lastBodies > 1000) { updateBodies(sim); lastBodies = now; }
  updateSatellites(sim);
  updateCamera(dt);
  updateWind(dt, now);
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(frame);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
});

setInterval(() => {
  const t = new Date(simNow()).toISOString();
  clock.innerHTML = simClock.rate === 1
    ? `${t.slice(11, 19)} UTC`
    : `${t.slice(5, 10)} ${t.slice(11, 19)} UTC<span class="rate">${simClock.rate}× sim</span>`; renderSelection(); renderFreshness(); renderWeather(); }, 500);

updateBodies(Date.now());
setScaleValue(1);
renderIss();
pollCatalog(); setInterval(pollCatalog, 10 * 60000);
pollWeather(); setInterval(pollWeather, 60000);
pollAurora(); setInterval(pollAurora, 5 * 60000);
startIssTelemetry();
requestAnimationFrame(frame);
