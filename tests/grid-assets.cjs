// Grid assets check: pylons and substations are MAPPED POSITIONS, drawn through the ONE wire layer, labelled honestly.
// Serves prototype/ locally, opens overlay.html in Chrome, and checks against the raw GridAtlas files (fetched here in
// Node, once, independently of the page):
//   1. every tower not flagged "estimated" equals a vertex of the GridAtlas line files EXACTLY (===, no tolerance);
//   2. every substation compound sits EXACTLY on its GridAtlas point;
//   3. the towers are blocks in SIM.blocks (the one wire layer) and the old 'pylons-real' custom layer is gone;
//   4. place-frame round trip: each tower's local base point maps back to its lat/lon within 1 mm (consistency only);
//   5. no drawn tower falls inside a substation footprint (footprints read in Node, own point-in-polygon);
//   6. estimated infill towers lie on the straight segment between two line vertices (a place with a long span);
//   8. substation fences: every mapped fence === its ring in substations-footprints.odbl.json (raw file, no tolerance),
//      estimated fences flagged and counted apart, the label shows the counts, and every drawn fence point lies on its raw
//      ring (converted back by the overlay's own place frame, measured in Node), at the 400 kV and a 132 kV compound;
//   7. the labels on screen say "assumed at mapped line vertices", name GridAtlas and OpenStreetMap, and say what is estimated.
// Screenshots go to $OUT (default test-output/grid-assets). Exit 1 on any FAIL.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..', 'prototype');
const OUT = process.env.OUT || path.join(__dirname, '..', 'test-output', 'grid-assets');
const GA = 'https://ventusltd.github.io/gridatlas/atlas/releases/202608300453-atlas-v9/data';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
fs.mkdirSync(OUT, { recursive: true });
const server = http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'overlay.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
});
const results = []; const check = (name, ok, evidence) => results.push({ name, ok: !!ok, evidence: String(evidence).slice(0, 300) });
const wait = ms => new Promise(r => setTimeout(r, ms));
// A 400 kV line in the English Midlands (a GridAtlas vertex; no site is named).
const START = { lat: 52.2441634, lon: -1.0453368 };

(async () => {
  // Reference: the raw GridAtlas line files, one polite request per second.
  const V = new Set();
  for (const kv of ['400', '275', '132']) {
    const j = await (await fetch(`${GA}/grid_${kv}kv.geojson`)).json();
    for (const f of j.features) { const g = f.geometry; if (!g) continue;
      for (const c of g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []) for (const p of c) V.add(kv + '|' + p[0] + '|' + p[1]); }
    await wait(1000);
  }
  const FPRAW = JSON.parse(fs.readFileSync(path.join(ROOT, 'mod', 'substations-footprints.odbl.json'), 'utf8')).f;
  const FPS = FPRAW.map(r => r[2]), FPR = new Map(FPRAW.map(r => [r[0], r[2]]));
  // Distance in metres from a lon/lat point to a lon/lat ring polyline (local equirectangular about the point; sub-mm at < 1 km).
  const offRing = (q, R) => { const kx = 111320 * Math.cos(q[1] * Math.PI / 180), ky = 110574; let best = Infinity;
    for (let i = 0; i + 1 < R.length; i++) { const ax = (R[i][0] - q[0]) * kx, ay = (R[i][1] - q[1]) * ky, bx = (R[i + 1][0] - q[0]) * kx, by = (R[i + 1][1] - q[1]) * ky;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy)); } return best; };
  // Fence checks on one compound view: exact ring, estimated apart, label counts, placement on the raw ring.
  const fenceChecks = async (pg, tag) => {
    const Z = await pg.evaluate(() => { const c = window.SUBS.check(), PF = window.__pf.PF;
      c.fences.forEach(f => { f.ll = f.pts.map(q => { const g = PF.fromLocal(f.anchor, q[0], q[1], 0); return [g.lon, g.lat]; }); delete f.pts; });
      const el = document.getElementById('subs-label'); return { c, info: el ? el.textContent : '' }; });
    const F = Z.c.fences, M = F.filter(f => f.fence === 'mapped'), E = F.filter(f => f.fence === 'estimated');
    const notExact = M.filter(f => { const R = FPR.get(f.i); return !R || R.length !== f.fenceLL.length || R.some((p, k) => p[0] !== f.fenceLL[k][0] || p[1] !== f.fenceLL[k][1]); });
    check(`${tag}: every mapped fence === its ring in the raw footprint file (no tolerance)`, M.length > 0 && notExact.length === 0 && Z.c.fenceBad.length === 0,
      `${M.length - notExact.length}/${M.length} rings exact (${M.reduce((a, f) => a + f.fenceLL.length, 0)} vertices); module self-check bad ${Z.c.fenceBad.length}`);
    const tagged = F.every(f => f.fence === 'mapped' || f.fence === 'estimated'), estHasRing = E.filter(f => FPR.has(f.i));
    check(`${tag}: estimated fences flagged 'estimated' and counted apart`, tagged && Z.c.footprint === M.length && Z.c.estimated === E.length && M.length + E.length === Z.c.live && estHasRing.length === 0,
      `${M.length} mapped + ${E.length} estimated = ${Z.c.live} live; ${estHasRing.length} estimated fences that had a ring in the file`);
    const want = `${M.length} fences mapped (OSM footprint), ${E.length} estimated`;
    check(`${tag}: on-screen label shows "${want}"`, Z.info.includes(want), Z.info);
    let worst = 0, n = 0, corner = 0;
    for (const f of M) { const R = FPR.get(f.i); if (!R) continue;
      for (const q of f.ll) { worst = Math.max(worst, offRing(q, R)); n++; }
      for (const v of R) corner = Math.max(corner, Math.min(...f.ll.map(q => Math.hypot((q[0] - v[0]) * 111320 * Math.cos(v[1] * Math.PI / 180), (q[1] - v[1]) * 110574)))); }
    check(`${tag}: every drawn fence point on its raw ring, 0 m off (Node, raw file; float floor 1 mm)`, n > 0 && worst < 0.001 && corner < 0.001,
      `${n} fence points: worst ${worst.toFixed(6)} m off the ring; every ring vertex has a post within ${corner.toFixed(6)} m`);
    return { mapped: M.length, estimated: E.length, worst, info: Z.info };
  };
  const inRing = (x, y, R) => { let c = false; for (let i = 0, j = R.length - 1; i < R.length; j = i++) { const [xi, yi] = R[i], [xj, yj] = R[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const inSub = (lon, lat) => FPS.some(R => inRing(lon, lat, R));
  // A place with a long 400 kV span (> 1.6 x the 360 m typical span), so the estimated path is drawn.
  let LONG = null;
  { const j = await (await fetch(`${GA}/grid_400kv.geojson`)).json(), kx = l => 111320 * Math.cos(l * Math.PI / 180);
    outer: for (const f of j.features) { const g = f.geometry; if (!g) continue;
      for (const c of g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []) for (let i = 1; i < c.length; i++) {
        const a = c[i - 1], b = c[i], d = Math.hypot((b[0] - a[0]) * kx(a[1]), (b[1] - a[1]) * 111320);
        if (d > 1.6 * 360 && d < 2000 && a[1] > 51.5 && a[1] < 53.5) { LONG = { lon: (a[0] + b[0]) / 2, lat: (a[1] + b[1]) / 2, d }; break outer; } } } }
  const SF = (await (await fetch(`${GA}/grid_substations.geojson`)).json()).features, S = SF.map(f => f.geometry.coordinates);
  // A 132 kV compound (top voltage 132 kV) with an OSM footprint, nearest the start: a second, smaller compound to look at.
  const top = f => Math.max(...String((f.properties || {}).voltage || '').split(/[;:,]/).map(v => Math.round(Number(v) / 1000)).filter(k => k >= 1), 0);
  const C132 = SF.map((f, i) => ({ i, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], kv: top(f) }))
    .filter(s => s.kv === 132 && FPR.has(s.i))
    .map(s => ({ ...s, d: Math.hypot((s.lon - START.lon) * 68000, (s.lat - START.lat) * 111000) })).sort((a, b) => a.d - b.d)[0];

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/overlay.html`;
  const b = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', args: process.env.CI ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`${base}?lat=${START.lat}&lon=${START.lon}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__pylonsReal && window.__pylonsReal.count() > 0, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(4000);                       // terrain tiles and the re-grade

  // 1-4: pylons.
  const P = await p.evaluate(() => {
    const R = window.__pylonsReal, PF = window.__pf.PF, bl = SIM.blocks.filter(b => b.pylonsReal);
    let worst = 0;
    for (const b of bl) { const o = PF.toLocal(b.anchor, b.lat, b.lon, 0), g = PF.fromLocal(b.anchor, o.x, o.y, 0);
      const d = Math.hypot((g.lon - b.lon) * 111320 * Math.cos(b.lat * Math.PI / 180), (g.lat - b.lat) * 111320); if (d > worst) worst = d; }
    return { towers: bl.map(b => ({ id: b.id, kv: b.kv, lon: b.lon, lat: b.lat, est: b.est, prov: b.prov })), live: R.count(),
      layer: !!SIM.map.getLayer('pylons-real'), wire: !!SIM.map.getLayer('wire'), worst, self: R.check(),
      btn: [...document.querySelectorAll('#bar button')].map(x => x.textContent), info: document.getElementById('info').textContent };
  });
  const inside = P.towers.filter(t => inSub(t.lon, t.lat));
  check('no tower inside a substation footprint (start)', inside.length === 0 && P.self.inSub.length === 0, `${inside.length} inside of ${P.towers.length}; module dropped ${P.self.dropped} so far`);
  const mapped = P.towers.filter(t => !t.est), miss = mapped.filter(t => !V.has(t.kv + '|' + t.lon + '|' + t.lat));
  check('towers drawn at the start (zoom 15)', P.towers.length > 0, `${P.towers.length} tower blocks, ${mapped.length} mapped, ${P.towers.length - mapped.length} estimated`);
  check('every mapped tower === a GridAtlas vertex (raw file, fetched in Node)', mapped.length > 0 && miss.length === 0, miss.length ? 'miss: ' + miss.slice(0, 5).map(t => t.id).join(' ') : `${mapped.length}/${mapped.length} exact`);
  check('module self-check agrees', P.self.bad.length === 0 && P.self.exact === mapped.length, JSON.stringify({ exact: P.self.exact, est: P.self.est, bad: P.self.bad.length }));
  check('every tower carries provenance', P.towers.every(t => /^(assumed: tower at a mapped line vertex|estimated)/.test(t.prov || '')), 'prov tag on each block');
  check('towers are blocks of the ONE wire layer', P.wire && !P.layer && P.live === P.towers.length, `wire layer ${P.wire}, own layer ${P.layer}, live ${P.live} = blocks ${P.towers.length}`);
  check('place-frame round trip < 1 mm (consistency, not truth)', P.worst < 0.001, `worst ${(P.worst * 1000).toFixed(4)} mm`);
  check('pylon label: assumed at mapped line vertices, GridAtlas, OpenStreetMap, estimates', /assumed at mapped line vertices/.test(P.info) && /GridAtlas/.test(P.info) && /OpenStreetMap/.test(P.info) && /estimat/.test(P.info), P.info);
  check('button "Pylons (mapped)"', P.btn.includes('Pylons (mapped)'), P.btn.join(' | '));
  await p.screenshot({ path: path.join(OUT, '1-map-towers.png') });

  // Walk to a mapped tower: stand 120 m south of it, look north.
  const t0 = mapped[0];
  await p.evaluate(t => SIM.map.jumpTo({ center: [t.lon, t.lat - 120 / 111320], zoom: 18, pitch: 78, bearing: 0 }), t0);
  await p.waitForTimeout(5000); await p.screenshot({ path: path.join(OUT, '2-walk-at-tower.png') });
  await p.evaluate(t => SIM.map.jumpTo({ center: [t.lon, t.lat], zoom: 16.5, pitch: 60, bearing: 30 }), t0);
  await p.waitForTimeout(5000); await p.screenshot({ path: path.join(OUT, '3-drone-line.png') });
  const P2 = await p.evaluate(() => { const bl = SIM.blocks.filter(b => b.pylonsReal); return bl.filter(b => !b.est).map(b => b.kv + '|' + b.lon + '|' + b.lat); });
  const miss2 = P2.filter(k => !V.has(k));
  check('after moving: every mapped tower still === a vertex', P2.length > 0 && miss2.length === 0, `${P2.length - miss2.length}/${P2.length} exact`);

  // 6: estimated infill towers, at a long span.
  if (LONG) {
    await p.evaluate(t => SIM.map.jumpTo({ center: [t.lon, t.lat], zoom: 16, pitch: 65, bearing: 20 }), LONG);
    await p.waitForTimeout(6000);
    const E = await p.evaluate(() => window.__pylonsReal.check());
    check('consistency: estimated tower on its own mapped segment', E.est > 0 && E.estBad.length === 0 && E.bad.length === 0,
      `span ${LONG.d.toFixed(0)} m; ${E.est} estimated, ${E.estBad.length} off-segment; ${E.exact} assumed-at-vertex`);
    await p.screenshot({ path: path.join(OUT, '6-estimated-span.png') });
  } else check('consistency: estimated tower on its own mapped segment', false, 'no long span found');

  // 2 and 5: substations. Fly to the nearest 400 kV compound.
  const go = await p.evaluate(() => window.SUBS.go(400));
  await p.waitForTimeout(9000);
  const Q = await p.evaluate(() => ({ c: window.SUBS.check(), blocks: SIM.blocks.filter(b => b.substation !== undefined).map(b => ({ i: b.substation, lon: b.lon, lat: b.lat })), info: document.getElementById('info').textContent }));
  const T4 = await p.evaluate(() => ({ t: SIM.blocks.filter(b => b.pylonsReal).map(b => [b.lon, b.lat]), c: window.__pylonsReal.check() }));
  const in4 = T4.t.filter(q => inSub(q[0], q[1]));
  check('no tower inside a substation footprint (at the 400 kV compound; Node point-in-polygon, independent of the module)', T4.t.length > 0 && in4.length === 0 && T4.c.inSub.length === 0, `${in4.length} inside of ${T4.t.length}; module dropped ${T4.c.dropped}`);
  check('footprints loaded and towers dropped inside them (normal load)', T4.c.fpState === 'loaded' && T4.c.fps > 0 && T4.c.dropped > 0 && /none drawn inside a mapped substation footprint/.test(T4.c.label),
    `fpState ${T4.c.fpState}, ${T4.c.fps} footprints, ${T4.c.dropped} dropped`);
  const sbad = Q.blocks.filter(x => !(S[x.i] && S[x.i][0] === x.lon && S[x.i][1] === x.lat));
  check('substation compounds === GridAtlas points (raw file)', Q.blocks.length > 0 && sbad.length === 0, `${Q.blocks.length - sbad.length}/${Q.blocks.length} exact; footprint fences ${Q.c.footprint}, estimated ${Q.c.estimated}`);
  const cr = Q.c.credit; check('substation label: mapped positions, GridAtlas, OpenStreetMap, estimates', /mapped positions/.test(cr) && /GridAtlas/.test(cr) && /OpenStreetMap/.test(cr) && /estimate/.test(cr), cr);
  const fc400 = await fenceChecks(p, '400 kV compound');
  await p.screenshot({ path: path.join(OUT, '4-substation-400.png') });
  await p.evaluate(() => SIM.map.jumpTo({ zoom: 18, pitch: 75 })); await p.waitForTimeout(5000);
  await p.screenshot({ path: path.join(OUT, '5-substation-walk.png') });
  const go132 = C132;
  await p.evaluate(s => SIM.map.jumpTo({ center: [s.lon, s.lat], zoom: 17.4, pitch: 62, bearing: 40 }), C132);
  await p.waitForTimeout(3000); await p.evaluate(() => window.SUBS.show(true)); await p.waitForTimeout(5000);
  const fc132 = await fenceChecks(p, '132 kV compound');
  await p.screenshot({ path: path.join(OUT, '8-substation-132.png') });
  await p.evaluate(() => SIM.map.jumpTo({ zoom: 18, pitch: 68 })); await p.waitForTimeout(5000);
  await p.screenshot({ path: path.join(OUT, '9-substation-132-walk.png') });

  check('no page errors', errs.length === 0, errs.join(' | ') || 'none');

  // Failure path: the footprint file is blocked. The module must not claim substations are cleared.
  const p2 = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs2 = []; p2.on('pageerror', e => errs2.push(e.message));
  let aborted = 0;
  await p2.route(/substations-footprints\.odbl\.json/, r => { aborted++; return r.abort(); });
  await p2.goto(`${base}?lat=${START.lat}&lon=${START.lon}`, { waitUntil: 'load' });
  await p2.waitForFunction(() => window.__pylonsReal && window.__pylonsReal.count() > 0, null, { timeout: 30000 }).catch(() => {});
  await p2.waitForTimeout(4000);
  const F = await p2.evaluate(() => ({ c: window.__pylonsReal.check(), info: document.getElementById('info').textContent }));
  check('footprints blocked: fpState failed, 0 footprints, nothing claimed dropped', aborted > 0 && F.c.fpState === 'failed' && F.c.fps === 0 && F.c.dropped === 0,
    `aborted ${aborted}, fpState ${F.c.fpState}, ${F.c.fps} footprints, dropped ${F.c.dropped}, ${F.c.live} towers`);
  check('footprints blocked: on-screen label says "not loaded" and makes no substation claim', /not loaded/.test(F.info) && !/none drawn inside/.test(F.info), F.info);
  check('footprints blocked: no page errors', errs2.length === 0, errs2.join(' | ') || 'none');
  await p2.screenshot({ path: path.join(OUT, '7-footprints-blocked.png') });
  await p2.evaluate(() => window.SUBS.go(400)); await p2.waitForTimeout(9000);
  const B = await p2.evaluate(() => ({ c: window.SUBS.check(), info: (document.getElementById('subs-label') || {}).textContent || '' }));
  check('footprints blocked: substation label claims no mapped fence, says not loaded, all fences estimated',
    B.c.fpState === 'failed' && B.c.live > 0 && B.c.footprint === 0 && B.c.estimated === B.c.live && B.info.includes(`0 fences mapped (OSM footprint), ${B.c.live} estimated`) && /not loaded/.test(B.info) && !/[1-9]\d* fences mapped/.test(B.info),
    `fpState ${B.c.fpState}; ${B.c.footprint} mapped, ${B.c.estimated} estimated; ${B.info}`);
  await p2.screenshot({ path: path.join(OUT, '10-substation-fp-blocked.png') });
  await b.close(); server.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ go, go132, fc400, fc132, results }, null, 1));
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  -- ${r.evidence}`);
  const failed = results.filter(r => !r.ok).length; console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });
