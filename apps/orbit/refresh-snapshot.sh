#!/usr/bin/env bash
# Rebuilds the standalone page with a fresh real-data snapshot.
#
#   apps/orbit/refresh-snapshot.sh <out-dir>
#
# Needs the local server running on :4300 (it owns the caching: CelesTrak at
# most every 2 h, NOAA every 1–5 min). Probe trajectories are refetched from
# JPL Horizons when public/probes.json is more than a day old.
set -euo pipefail
cd "$(dirname "$0")"
OUT="${1:?usage: refresh-snapshot.sh <out-dir>}"
BASE="${ORBIT_URL:-http://localhost:4300}"

curl -sf "$BASE/api/status" >/dev/null || { echo "server not running on $BASE (start: NODE_USE_ENV_PROXY=1 PORT=4300 node apps/orbit/server.js)" >&2; exit 1; }

SNAP="$(mktemp -d)"
for pair in gp:gp.csv wind:wind.json mag:mag.json xray:xray.json aurora:aurora.json; do
  curl -sf -m 120 -o "$SNAP/${pair#*:}" "$BASE/api/data/${pair%%:*}"
done
# Debris is optional; when CelesTrak refuses, reuse the last good copy.
mkdir -p .cache
if curl -sf -m 120 -o "$SNAP/debris.csv" "$BASE/api/data/debris"; then cp "$SNAP/debris.csv" .cache/debris-last.csv
elif [ -f .cache/debris-last.csv ]; then cp .cache/debris-last.csv "$SNAP/debris.csv"
else rm -f "$SNAP/debris.csv"; fi
date +%s%3N > "$SNAP/fetched-at.txt"

if [ -z "$(find public/probes.json -mmin -1440 2>/dev/null)" ]; then
  NODE_USE_ENV_PROXY=1 node fetch-probes.mjs || echo "probe refresh failed; keeping the previous trajectories" >&2
fi

rm -rf "$OUT"
SNAPSHOT_DIR="$SNAP" node build-standalone.mjs "$OUT/orbit.html"
ls "$OUT"
