// Grid assets check: pylons and substations are MAPPED POSITIONS, drawn through the ONE wire layer, labelled honestly.
// Serves prototype/ locally, opens overlay.html in Chrome, and checks against the raw GridAtlas files (fetched here in
// Node, once, independently of the page):
//   1. every tower not flagged "estimated" equals a vertex of the GridAtlas line files EXACTLY (===, no tolerance);
//   2. every substation compound sits EXACTLY on its GridAtlas point;
//   3. the towers are blocks in SIM.blocks (the one wire layer) and the old 'pylons-real' custom layer is gone;
//   4. place-frame round trip: each tower's local base point maps back to its lat/lon within 1 mm (consistency only);
//   5. the labels on screen say "mapped positions", name GridAtlas and OpenStreetMap, and say what is estimated.
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
  const S = (await (await fetch(`${GA}/grid_substations.geojson`)).json()).features.map(f => f.geometry.coordinates);

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
  const mapped = P.towers.filter(t => !t.est), miss = mapped.filter(t => !V.has(t.kv + '|' + t.lon + '|' + t.lat));
  check('towers drawn at the start (zoom 15)', P.towers.length > 0, `${P.towers.length} tower blocks, ${mapped.length} mapped, ${P.towers.length - mapped.length} estimated`);
  check('every mapped tower === a GridAtlas vertex (raw file, fetched in Node)', mapped.length > 0 && miss.length === 0, miss.length ? 'miss: ' + miss.slice(0, 5).map(t => t.id).join(' ') : `${mapped.length}/${mapped.length} exact`);
  check('module self-check agrees', P.self.bad.length === 0 && P.self.exact === mapped.length, JSON.stringify({ exact: P.self.exact, est: P.self.est, bad: P.self.bad.length }));
  check('every tower carries provenance', P.towers.every(t => /^(mapped position|estimated)/.test(t.prov || '')), 'prov tag on each block');
  check('towers are blocks of the ONE wire layer', P.wire && !P.layer && P.live === P.towers.length, `wire layer ${P.wire}, own layer ${P.layer}, live ${P.live} = blocks ${P.towers.length}`);
  check('place-frame round trip < 1 mm (consistency, not truth)', P.worst < 0.001, `worst ${(P.worst * 1000).toFixed(4)} mm`);
  check('pylon label: mapped positions, GridAtlas, OpenStreetMap, estimates', /mapped positions/.test(P.info) && /GridAtlas/.test(P.info) && /OpenStreetMap/.test(P.info) && /estimat/.test(P.info), P.info);
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

  // 2 and 5: substations. Fly to the nearest 400 kV compound.
  const go = await p.evaluate(() => window.SUBS.go(400));
  await p.waitForTimeout(9000);
  const Q = await p.evaluate(() => ({ c: window.SUBS.check(), blocks: SIM.blocks.filter(b => b.substation !== undefined).map(b => ({ i: b.substation, lon: b.lon, lat: b.lat })), info: document.getElementById('info').textContent }));
  const sbad = Q.blocks.filter(x => !(S[x.i] && S[x.i][0] === x.lon && S[x.i][1] === x.lat));
  check('substation compounds === GridAtlas points (raw file)', Q.blocks.length > 0 && sbad.length === 0, `${Q.blocks.length - sbad.length}/${Q.blocks.length} exact; footprint fences ${Q.c.footprint}, estimated ${Q.c.estimated}`);
  const cr = Q.c.credit; check('substation label: mapped positions, GridAtlas, OpenStreetMap, estimates', /mapped positions/.test(cr) && /GridAtlas/.test(cr) && /OpenStreetMap/.test(cr) && /estimate/.test(cr), cr);
  await p.screenshot({ path: path.join(OUT, '4-substation-400.png') });
  await p.evaluate(() => SIM.map.jumpTo({ zoom: 18, pitch: 75 })); await p.waitForTimeout(5000);
  await p.screenshot({ path: path.join(OUT, '5-substation-walk.png') });

  check('no page errors', errs.length === 0, errs.join(' | ') || 'none');
  await b.close(); server.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ go, results }, null, 1));
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  -- ${r.evidence}`);
  const failed = results.filter(r => !r.ok).length; console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });
