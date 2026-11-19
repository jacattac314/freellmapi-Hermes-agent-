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
    const p = issMarker.geometry.attributes.position;
    p.array.set(arr.subarray(issIndex * 3, issIndex * 3 + 3)); p.needsUpdate = true;
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
const groupOn = { starlink: true, oneweb: true, gnss: true, station: true, other: true };
document.querySelectorAll('[data-regime]').forEach((el) => el.addEventListener('change', () => { regimeOn[el.dataset.regime] = el.checked; applyFilters(); }));
document.querySelectorAll('[data-group]').forEach((el) => el.addEventListener('change', () => { groupOn[el.dataset.group] = el.checked; applyFilters(); }));

function applyFilters() {
  if (!catalog) return;
  visible = new Uint8Array(N);
  let count = 0;
  for (let i = 0; i < N; i++) {
    const on = !catalog.dead[i] && regimeOn[catalog.regimes[i]] && groupOn[catalog.groups[i]];
    visible[i] = on ? 1 : 0; count += visible[i];
  }
  $('sat-count').textContent = `${count.toLocaleString()} of ${N.toLocaleString()} objects`;
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
  worker.postMessage({ type: 'track', id: catalog.ids[i] });
}
$('sel-clear').onclick = () => select(-1);
$('sel-follow').onclick = () => { following = !following; $('sel-follow').classList.toggle('active', following); };
setInterval(() => { if (selected >= 0) worker.postMessage({ type: 'track', id: catalog.ids[selected] }); }, 30000);

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
  const q = searchEl.value.trim().toUpperCase();
  if (!q || !catalog) return;
  let shown = 0;
  for (let i = 0; i < N && shown < 8; i++) {
    if (catalog.dead[i] || !(catalog.names[i].toUpperCase().includes(q) || catalog.ids[i] === q)) continue;
    const li = document.createElement('li');
    li.textContent = catalog.names[i];
    li.onclick = () => { select(i); flyToSatellite(i); resultsEl.innerHTML = ''; searchEl.value = ''; };
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
  { name: 'Geostationary belt', dist: 19, desc: 'GEO ring at 35,786 km: communications and weather satellites that orbit once per day, so they hover over one longitude.' },
  { name: 'Earth–Moon', dist: 150, desc: 'The Moon at ~384,000 km (60 Earth radii). Satellites collapse into a speck at this scale. Moon position: low-precision ephemeris.' },
  { name: 'Sun–Earth L1', dist: 800, desc: '1.5 million km sunward: ACE and DSCOVR measure the solar wind here, giving 15–60 minutes of warning before it reaches Earth.' },
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
}

async function pollAurora() {
  try {
    const data = await fetchJson('aurora');
    wx.aurora = { data, error: null };
    const pts = [], cols = [], c = new THREE.Color();
    for (const [lon, lat, v] of data.coordinates || []) {
      if (v < 4) continue;
      pts.push(lonLatToVec(lon, lat, 1.012));
      const t = Math.min(v / 50, 1);
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
  $('wx').innerHTML = rows.join('');
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
  if (!demoShown && res.headers.get('X-Demo') === '1') { demoShown = true; $('demo-banner').hidden = false; document.body.classList.add('demo'); }
}

// ------------------------------------------------------- ISS live telemetry
// NASA's public ISS telemetry via Lightstreamer (adapter set ISSLIVE).
// Channel meanings follow the community ISS Mimic dictionary — treat labels
// as best-effort. Values only change while the station has a ground link
// (TIME_000001 Status.Class === "24" means signal acquired).
const ISS_CHANNELS = {
  USLAB000058: { label: 'Cabin pressure (Lab)', fmt: (v) => `${Number(v).toFixed(2)} psi` },
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

// ------------------------------------------------------------------- loop
const clock = $('clock');
let lastFrame = performance.now();
let lastBodies = 0;
function frame(tNow) {
  const dt = Math.min((tNow - lastFrame) / 1000, 0.1);
  lastFrame = tNow;
  const now = Date.now();
  if (now - lastBodies > 1000) { updateBodies(now); lastBodies = now; }
  updateSatellites(now);
  updateCamera(dt);
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

setInterval(() => { clock.textContent = new Date().toISOString().slice(11, 19) + ' UTC'; renderSelection(); renderFreshness(); renderWeather(); }, 500);

updateBodies(Date.now());
setScaleValue(1);
renderIss();
pollCatalog(); setInterval(pollCatalog, 10 * 60000);
pollWeather(); setInterval(pollWeather, 60000);
pollAurora(); setInterval(pollAurora, 5 * 60000);
startIssTelemetry();
requestAnimationFrame(frame);
