# Orbit — live satellites & space weather

A real-time 3D globe: every active satellite in the public catalog moving smoothly,
plus space-weather layers, with a scale slider that walks from the aurora up to the
Sun–Earth L1 point 1.5 million km away.

```bash
npm install                      # from the repo root
npm run orbit                    # live data  → http://localhost:4300
npm run orbit:demo               # synthetic data (offline), red DEMO banner shown
```

To try it without the server (e.g. on a phone), build a single self-contained page
that runs on demo data and loads its libraries from jsDelivr:

```bash
node apps/orbit/build-standalone.mjs     # → apps/orbit/dist/orbit-demo.html
```

To host it with live data (e.g. to open on a phone), deploy `apps/orbit` to Vercel:
`vercel.json` builds the static page with `build-vercel.mjs`, and `api/feed/[key].js`
proxies the data sources with edge caching (CelesTrak cached 2 h, per its policy).

No API keys needed. Data is fetched by the local server and cached in `apps/orbit/.cache/`.

## What you're looking at

| Layer | Source | Real measurement? | Refresh |
|---|---|---|---|
| Satellite positions | CelesTrak GP elements → SGP4 | Prediction from elements (accurate to ~km) | Elements ≤ every 2 h, positions 1 Hz, drawn every frame |
| Solar wind speed / density | NOAA SWPC real-time solar wind (ACE/DSCOVR at L1) | Yes | 60 s |
| Interplanetary magnetic field (Bz) | NOAA SWPC | Yes | 60 s |
| Solar X-ray flux / flare class | NOAA GOES | Yes | 60 s |
| Aurora oval | NOAA OVATION | **Forecast model**, not an observation | 5 min |
| ISS cabin telemetry | NASA ISSLive via Lightstreamer | Yes, only while the ISS has a ground link | Push |
| Moon position | Built-in low-precision ephemeris | Computed | 1 s |

The "Data freshness" panel shows how old each measurement actually is, so smooth
animation is never mistaken for fresh data.

## How the smooth motion works

1. A Web Worker (`public/sat-worker.js`) runs SGP4 for every satellite once per second,
   about 2 seconds ahead of the clock, and posts position snapshots.
2. The main thread interpolates between the two snapshots around "now" every frame,
   so ~10k objects move at full frame rate while SGP4 only runs at 1 Hz.
3. When CelesTrak publishes new elements, the worker flags the next snapshot. The main
   thread measures how far each satellite would jump (new prediction vs. old path)
   and eases it onto the new track over 5 s with an S-curve. There is no teleporting.
   Typical real corrections are a few km and invisible; tested with an artificial
   ~240 km shift, which glides over ~5 s.

## Scale slider

| Stop | Camera distance | What it shows |
|---|---|---|
| Surface & aurora | 1.9 R⊕ | Aurora oval, ISS, dense LEO shell |
| Low Earth orbit | 3.4 R⊕ | Starlink, OneWeb, most of the catalog |
| Navigation orbits | 10 R⊕ | GPS / Galileo / GLONASS / BeiDou |
| Geostationary belt | 19 R⊕ | GEO ring at 35,786 km |
| Earth–Moon | 150 R⊕ | Moon at ~60 R⊕, true scale |
| Sun–Earth L1 | 800 R⊕ | Where the solar wind is measured, with live travel time to Earth |

Scroll-zoom moves the slider too; the two far stops swing the camera side-on to the
Sun–Earth line so Earth, Moon and L1 are all in frame.

## Caveats

- **ISS channel labels** follow the community ISS Mimic dictionary and are best-effort.
  During loss of signal, values freeze; the panel says so.
- **CelesTrak** blocks clients that poll too often. The server enforces at most one
  fetch per 2 h (and backs off after errors), shared by every browser tab.
- Positions are predictions from elements published every few hours; a satellite that
  manoeuvres won't show it until the next element set.

## Files

```
server.js          static server + caching proxy (CelesTrak, NOAA), zero deps
demo-data.js       synthetic catalog + NOAA payloads for DEMO=1
public/index.html  layout
public/main.js     three.js scene, interpolation/correction, slider, panels
public/sat-worker.js  SGP4 propagation worker
```
