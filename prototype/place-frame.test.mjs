// node --test place-frame.test.mjs
// Round trips to 1 mm at 20 points from 49 to 61 N and 5 overseas; MapLibre parity; the 100 m lattice;
// the world's bng.mjs and OSTN15 (read-only, from WORLD_DIR, else the copy in mod/engine). Consistency, not truth: the OSTN15
// gap is printed alongside every GB result.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as P from './place-frame.mjs';

const WORLD = process.env.WORLD_DIR || fileURLToPath(new URL('./mod/engine', import.meta.url));
const mm = 1e-3;
const gap = (a, b) => { const p = P.ecef(a.lat, a.lon, 0), q = P.ecef(b.lat, b.lon, 0); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

// 20 GB-latitude points, 49 to 61 N, spread -8 to +2 E; 5 overseas.
const GB = Array.from({ length: 20 }, (_, k) => [49 + 12 * k / 19, -8 + 10 * ((k * 7) % 20) / 19]);
const OVERSEAS = [[-33.92, 18.42], [40.42, -3.70], [35.68, 139.77], [-37.81, 144.96], [19.43, -99.13]];
const OFFSETS = [[0, 0], [100, -60], [-250, 180], [600, 600], [-1000, 400], [2000, -1500], [5000, 5000]];

function roundTrips(lat, lon) {
  const a = P.placeKey(lat, lon);
  let worst = { local: 0, latlon: 0, enu: 0, wire: 0, wirePlace: 0 };
  for (const [x, y] of OFFSETS) for (const z of [0, 2.5, 30]) {
    const g = P.fromLocal(a, x, y, z), b = P.toLocal(a, g.lat, g.lon, g.h);
    worst.local = Math.max(worst.local, Math.hypot(b.x - x, b.y - y, b.z - z));
    const q = P.fromEnu(a, x, y, z), r = P.enu(a, q.lat, q.lon, q.h);
    worst.enu = Math.max(worst.enu, Math.hypot(r.x - x, r.y - y, r.z - z));
    const m = P.wireToMap(a, x, y, z), w = P.mapToWire(a, m.x, m.y, m.z);
    worst.wire = Math.max(worst.wire, Math.hypot(w.x - x, w.y - y, w.z - z));
    // the map vertex must sit on the same ground point as the local one
    const back = P.fromMercator(m.x, m.y);
    worst.wirePlace = Math.max(worst.wirePlace, gap(back, g));
  }
  // lat/lon -> local -> lat/lon for a point 1.2 km away
  const pt = { lat: lat + 0.009, lon: lon - 0.012 }, l = P.toLocal(a, pt.lat, pt.lon), g2 = P.fromLocal(a, l.x, l.y);
  worst.latlon = gap(pt, g2);
  return worst;
}

for (const [name, pts] of [['GB latitudes 49-61 N (20 points)', GB], ['overseas (5 points)', OVERSEAS]]) {
  test(`round trips within 1 mm: ${name}`, () => {
    let all = { local: 0, latlon: 0, enu: 0, wire: 0, wirePlace: 0 };
    for (const [lat, lon] of pts) {
      const w = roundTrips(lat, lon);
      for (const k in all) all[k] = Math.max(all[k], w[k]);
    }
    console.log(`  ${name} worst (m): ` + Object.entries(all).map(([k, v]) => `${k} ${v.toExponential(2)}`).join(', '));
    for (const k in all) assert.ok(all[k] < mm, `${k} ${all[k]} m`);
  });
}

test('MapLibre 4.7.1 Mercator parity (known values)', () => {
  const c = P.toMercator(0, 0);
  assert.equal(c.x, 0.5); assert.ok(Math.abs(c.y - 0.5) < 1e-15);
  assert.ok(Math.abs(P.toMercator(P.LAT_LIMIT, 180).y) < 1e-12);
  assert.equal(P.toMercator(0, 180).x, 1);
  assert.ok(Math.abs(P.mercatorScale(60) - 2) < 1e-12);
  assert.ok(Math.abs(P.mercatorZ(1, 0) * 2 * Math.PI * 6371008.8 - 1) < 1e-12);
  for (const lat of [-60, -10, 0, 33.3, 51.215, 61]) {
    const m = P.toMercator(lat, -1.78, 12), b = P.fromMercator(m.x, m.y, m.z);
    assert.ok(Math.abs(b.lat - lat) < 1e-12 && Math.abs(b.lon + 1.78) < 1e-12 && Math.abs(b.alt - 12) < 1e-9);
  }
});

test('place keys: stable 100 m lattice, anchor computed from the key', () => {
  for (const [lat, lon] of [...GB, ...OVERSEAS]) {
    const a = P.placeKey(lat, lon);
    assert.deepEqual(P.anchorFromKey(a.key), a);
    const d = P.toLocal(a, lat, lon); // the point is inside its cell
    assert.ok(Math.abs(d.x) <= 50.001 && Math.abs(d.y) <= 50.6, `${a.key} ${d.x} ${d.y}`);
    const e = P.anchorFromKey({ j: a.j, i: a.i + 1 }), n = P.anchorFromKey({ j: a.j + 1, i: a.i });
    const de = gap(a, e), dn = gap(a, { lat: n.lat, lon: a.lon }); // row step along the meridian
    assert.ok(Math.abs(de - 100) < 1e-3, `east step ${de}`); // 100 m of parallel arc; chord differs < 1 um
    assert.ok(dn > 99.2 && dn < 100.2, `north step ${dn}`);
    // any point in the cell keys to the same anchor: identity never moves with the viewer
    const g = P.fromLocal(a, 30, -30); assert.equal(P.placeKey(g.lat, g.lon).key, a.key);
  }
});

test('the old overlay path against the exact one (information)', () => {
  // overlay.html: o = fromLngLat(anchor); vertex = o + metres * meterInMercatorCoordinateUnits (sphere, no ellipsoid)
  const a = P.placeKey(51.215, -1.78);
  let worst = 0;
  for (const [x, y] of [[100, 60], [-100, -60], [130, 10], [300, 300], [1000, 1000]]) {
    const o = P.toMercator(a.lat, a.lon), s = P.meterInMercator(a.lat), old = { x: o.x + x * s, y: o.y - y * s };
    const ex = P.fromMercator(old.x, old.y), l = P.toLocal(a, ex.lat, ex.lon);
    const err = Math.hypot(l.x - x, l.y - y); worst = Math.max(worst, err);
    console.log(`  old overlay vertex at (${x}, ${y}) m lands ${(err * 100).toFixed(1)} cm from the exact point`);
  }
  assert.ok(worst > 0.01); // the old path is measurably off; the fix is wireToMap
});

test('GB: world bng.mjs round trips; OSTN15 where the data is present; gap to OSTN15 stated', async () => {
  const bng = await import(pathToFileURL(`${WORLD}/bng.mjs`).href);
  const os = existsSync(`${WORLD}/ostn15.mjs`) ? await import(pathToFileURL(`${WORLD}/ostn15.mjs`).href) : null; // OSTN15 lives in the world, not in this copy
  const dir = `${WORLD}/data/ostn15`, blocks = new Map();
  if (os && existsSync(`${dir}/ostn15.json`)) {
    const raw = readFileSync(`${dir}/ostn15.json`);
    assert.equal(createHash('sha256').update(raw).digest('hex'), os.INDEX_SHA256);
    for (const r of JSON.parse(raw).blocks || []) {
      const buf = readFileSync(`${dir}/${r.file}`);
      assert.equal(createHash('sha256').update(buf).digest('hex'), r.sha256, r.file);
      blocks.set(`${r.lat0}_${r.lon0}`, os.decodeBlock(new Uint8Array(buf)));
    }
  }
  P.useWorld(bng, blocks.size ? { blocks, etrsToBng: os.etrsToBng, bngToEtrs: os.bngToEtrs } : null);
  let rt = 0, rtWire = 0, n15 = 0; const gaps = [];
  for (const [lat, lon] of GB.filter(([la, lo]) => la < 60.9 && lo > -7.9 && lo < 1.8)) {
    const b = P.toBng(lat, lon), g = P.fromBng(b.e, b.n);
    rt = Math.max(rt, gap({ lat, lon }, g));
    if (b.engine === 'OSTN15') { n15++; gaps.push(b.gapToOstn15); }
    const a = P.placeKey(lat, lon), w = P.wireToBng(a, 150, -80), back = P.bngToWire(a, w.e, w.n);
    rtWire = Math.max(rtWire, Math.hypot(back.x - 150, back.y + 80));
  }
  gaps.sort((x, y) => x - y);
  console.log(`  GB round trip worst ${rt.toExponential(2)} m, wire->BNG->wire ${rtWire.toExponential(2)} m; ` +
    `OSTN15 blocks ${blocks.size}, points on OSTN15 ${n15}; Helmert gap to OSTN15 median ${(gaps[gaps.length >> 1] ?? NaN).toFixed(2)} m, max ${(gaps.at(-1) ?? NaN).toFixed(2)} m`);
  assert.ok(rt < mm && rtWire < mm);
  P.useWorld(bng); // Helmert-only round trip too
  const h = P.toBng(52.5, -1.5), hg = P.fromBng(h.e, h.n);
  assert.equal(h.engine, 'Helmert'); assert.ok(gap({ lat: 52.5, lon: -1.5 }, hg) < mm);
});
