// node place-frame.samples.mjs [out.json]  -> 10,000 sample conversions for the GPU (CuPy) parity proof.
// Deterministic (mulberry32, seed 20260927). 6,000 points at GB latitudes 49-61 N, 4,000 worldwide within +-80.
// Each point is a base place, its placeKey anchor, and a point up to about +-5 km from it with a height.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as P from './place-frame.mjs';

const out = process.argv[2] || 'js-samples.json';
let s = 20260927 >>> 0;
const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// WORLD_DIR points at the v12 world when the operator has it; otherwise the unchanged copy in mod/engine is used.
const bng = process.env.WORLD_DIR ? await import(pathToFileURL(process.env.WORLD_DIR + '/bng.mjs').href) : await import('./mod/engine/bng.mjs');

const COLS = ['lat', 'lon', 'h', 'key_j', 'key_i', 'anchor_lat', 'anchor_lon',
  'local_x', 'local_y', 'local_z', 'enu_x', 'enu_y', 'enu_z', 'back_lat', 'back_lon',
  'merc_x', 'merc_y', 'merc_z', 'wire_dx', 'wire_dy', 'mercator_scale', 'meter_in_mercator',
  'bng_helmert_e', 'bng_helmert_n'];
const rows = [];
for (let k = 0; k < 10000; k++) {
  const gb = k < 6000;
  const blat = gb ? 49 + 12 * rnd() : -80 + 160 * rnd(), blon = gb ? -8 + 10 * rnd() : -180 + 360 * rnd();
  const a = P.placeKey(blat, blon);
  const lat = blat + (rnd() - 0.5) * 0.09, lon = blon + (rnd() - 0.5) * 0.09 / Math.cos(blat * Math.PI / 180);
  const h = rnd() * 50;
  const l = P.toLocal(a, lat, lon, h), e = P.enu(a, lat, lon, h), b = P.fromLocal(a, l.x, l.y, l.z);
  const m = P.toMercator(lat, lon, h), w = P.wireToMap(a, l.x, l.y, l.z);
  const g = gb ? bng.wgs84ToBng(lat, lon) : { e: null, n: null };
  rows.push([lat, lon, h, a.j, a.i, a.lat, a.lon, l.x, l.y, l.z, e.x, e.y, e.z, b.lat, b.lon,
    m.x, m.y, m.z, w.dx, w.dy, P.mercatorScale(lat), P.meterInMercator(lat), g.e, g.n]);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({
  engine: 'JavaScript (node ' + process.version + '), float64, place-frame.mjs',
  wgs84: P.WGS84, maplibre_earth_radius: P.MAPLIBRE_EARTH_RADIUS, step_lat_deg: P.STEP_LAT,
  lattice: 'row lat = j*step_lat_deg; col lon = i * (100 / (N(lat_j) cos lat_j)) rad, N on WGS84',
  local: 'toLocal: (x,y) where the ellipsoid normal through (lat,lon) meets the anchor tangent plane; z = h',
  enu: 'pure ECEF east-north-up of (lat,lon,h) about the anchor at h=0',
  bng: 'Helmert via world bng.mjs (wgs84ToBng), GB rows only; not OSTN15 (median 1.8 m, max 4.7 m gap)',
  columns: COLS, rows,
}));
console.log(`wrote ${rows.length} samples to ${out}`);
