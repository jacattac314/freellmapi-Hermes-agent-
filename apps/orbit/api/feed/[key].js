// Same-origin proxy for the public data sources, cached at Vercel's edge.
const MIN = 60;
const SOURCES = {
  gp: { url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=csv', ttl: 120 * MIN, type: 'text/csv' },
  debris: { urls: ['cosmos-1408-debris', 'fengyun-1c-debris', 'iridium-33-debris', 'cosmos-2251-debris'].map((g) => 'https://celestrak.org/NORAD/elements/gp.php?GROUP=' + g + '&FORMAT=csv'), ttl: 120 * MIN, type: 'text/csv' },
  wind: { url: 'https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json', ttl: 1 * MIN, type: 'application/json' },
  mag: { url: 'https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json', ttl: 1 * MIN, type: 'application/json' },
  xray: { url: 'https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json', ttl: 1 * MIN, type: 'application/json' },
  aurora: { url: 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json', ttl: 5 * MIN, type: 'application/json' },
};

export default async function handler(req, res) {
  const src = SOURCES[req.query.key];
  if (!src) { res.status(404).json({ error: 'unknown source' }); return; }
  try {
    const parts = [];
    for (const url of src.urls || [src.url]) {
      const upstream = await fetch(url, { headers: { 'User-Agent': 'orbit-globe/0.1 (edge-cached)' } });
      if (!upstream.ok) throw new Error('upstream HTTP ' + upstream.status);
      const text = await upstream.text();
      parts.push(parts.length ? text.slice(text.indexOf('\n') + 1) : text); // one CSV header
    }
    const body = Buffer.from(parts.join(''));
    if (!body.length) throw new Error('empty response');
    res.setHeader('Content-Type', src.type);
    // X-Fetched-At travels with the cached copy, so clients see the real fetch time.
    res.setHeader('X-Fetched-At', String(Date.now()));
    res.setHeader('X-Upstream-Error', '');
    res.setHeader('X-Demo', '0');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=' + src.ttl + ', stale-while-revalidate=' + src.ttl * 6);
    res.status(200).end(body);
  } catch (err) {
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30');
    res.status(502).json({ error: String(err.message || err) });
  }
}
