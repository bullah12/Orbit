#!/usr/bin/env node
/**
 * Vendor the People map's basemap.
 *
 * Orbit draws its map as inline SVG from a vendored GeoJSON rather than
 * fetching raster tiles at runtime, for two reasons. The first is that
 * `.map-land` and `.map-line` in globals.css are `fill` and `stroke` — the
 * stylesheet is describing vector shapes, not image tiles. The second matters
 * more: a tile request tells whoever serves it roughly where this household
 * is, every time somebody opens the page. An app that refuses background
 * location on principle (decision 5) should not leak the same fact to a CDN.
 *
 * So the geography is fetched once, here, and committed. No runtime network,
 * no dependency, no third party.
 *
 * Usage:
 *   node scripts/fetch-basemap.mjs                     # the seed's bounding box
 *   node scripts/fetch-basemap.mjs 52.40,-1.98,52.58,-1.82
 *
 * Source: OpenStreetMap via Overpass, © OpenStreetMap contributors, ODbL.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Birmingham, which is where the seed lives. Generous enough to hold every
// seeded place with room around the edges.
const DEFAULT_BBOX = [52.39, -2.0, 52.6, -1.8];

const bbox = process.argv[2]
  ? process.argv[2].split(',').map(Number)
  : DEFAULT_BBOX;

if (bbox.length !== 4 || bbox.some(Number.isNaN)) {
  console.error('bbox must be south,west,north,east');
  process.exit(1);
}

const [south, west, north, east] = bbox;
const BB = `${south},${west},${north},${east}`;

/**
 * Three layers, which is all a legible city map needs at this zoom: water to
 * give the eye something to anchor on, green space for the same reason, and
 * the primary road skeleton so a pin lands somewhere recognisable.
 */
const query = `
[out:json][timeout:120];
(
  way["natural"="water"](${BB});
  relation["natural"="water"](${BB});
  way["waterway"="riverbank"](${BB});
  way["leisure"="park"](${BB});
  way["landuse"="forest"](${BB});
  way["leisure"="nature_reserve"](${BB});
  way["highway"~"^(motorway|trunk|primary)$"](${BB});
);
out geom;
`;

console.log(`Fetching OSM data for ${BB} …`);

// Overpass is a shared free service: it rate-limits (429) and drops slow
// queries (504). Both are worth waiting out rather than failing a one-off.
async function fetchOsm(attempt = 1) {
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // Overpass answers 406 to an anonymous client. Identify the script.
      'User-Agent': 'Orbit-basemap/1.0 (household organiser; one-off vendoring)',
    },
    body: new URLSearchParams({ data: query }),
  });

  if (res.ok) return res.json();
  if ((res.status === 429 || res.status === 504) && attempt <= 5) {
    const wait = 30 * attempt;
    console.log(`  Overpass ${res.status}; waiting ${wait}s (attempt ${attempt}/5)…`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return fetchOsm(attempt + 1);
  }
  console.error(`Overpass returned ${res.status}`);
  process.exit(1);
}

// Overpass is slow and rate-limited, and the simplification below is worth
// tuning. Cache the raw answer so re-tuning costs nothing.
const cachePath = fileURLToPath(new URL('../.basemap-cache.json', import.meta.url));
let osm;
if (existsSync(cachePath) && !process.env.BASEMAP_REFRESH) {
  console.log('  using cached Overpass response (BASEMAP_REFRESH=1 to refetch)');
  osm = JSON.parse(readFileSync(cachePath, 'utf8'));
} else {
  osm = await fetchOsm();
  writeFileSync(cachePath, JSON.stringify(osm));
}

const water = [];
const green = [];
const roads = [];

// Raw OSM is far finer than a ~900px SVG can resolve, and shipping it would
// mean a megabyte of JSON in the page for detail nobody can see. Everything is
// simplified to roughly what one screen pixel is worth at this zoom, and shapes
// smaller than a few pixels are dropped outright.
const TOLERANCE = 0.0006; // ~60m, about one pixel at the zoom this renders at
const MIN_EXTENT = 0.003; // ~300m across, or it is not worth a path

for (const el of osm.elements ?? []) {
  const pts = (el.geometry ?? []).filter((p) => p && p.lat != null && p.lon != null);
  if (pts.length < 2) continue;

  const ring = simplify(
    pts.map((p) => [p.lon, p.lat]),
    TOLERANCE,
  ).map(([x, y]) => [round(x), round(y)]);

  const t = el.tags ?? {};

  if (t.highway) {
    if (ring.length >= 2 && extent(ring) >= MIN_EXTENT) roads.push(ring);
  } else if (t.natural === 'water' || t.waterway === 'riverbank') {
    if (ring.length >= 4 && extent(ring) >= MIN_EXTENT) water.push(ring);
  } else {
    if (ring.length >= 4 && extent(ring) >= MIN_EXTENT) green.push(ring);
  }
}

/** Longest side of the bounding box, in degrees. */
function extent(ring) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return Math.max(maxX - minX, maxY - minY);
}

/** Ramer–Douglas–Peucker, iterative so a long river cannot blow the stack. */
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop();
    let index = -1;
    let maxDist = tolerance;
    for (let i = first + 1; i < last; i += 1) {
      const d = perpendicular(points[i], points[first], points[last]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index !== -1) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  return points.filter((_, i) => keep[i]);
}

function perpendicular([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const out = {
  // Recorded so the renderer never has to guess the projection window, and so
  // a regenerated file for a different city just works.
  bbox: { south, west, north, east },
  attribution: '© OpenStreetMap contributors',
  water,
  green,
  roads,
};

const target = fileURLToPath(new URL('../src/lib/basemap.json', import.meta.url));
writeFileSync(target, JSON.stringify(out));

const kb = (JSON.stringify(out).length / 1024).toFixed(1);
console.log(`Wrote ${target}`);
console.log(`  water ${water.length}  green ${green.length}  roads ${roads.length}  (${kb} kB)`);

function round(n) {
  return Math.round(n * 1e5) / 1e5;
}
