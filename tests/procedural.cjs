// Check for mod/procedural.js: serves prototype/ with the module switched on (mod/index.json answered with procedural
// added, the file on disk untouched), opens a register solar farm and a register battery site, switches Procedural on,
// walks and flies, and checks what was drawn. PASS or FAIL with evidence; screenshots to SHOTS (default test-output/procedural).
// Local runs use the GPU launcher when CHROME_GPU_LAUNCHER names it; CI uses software WebGL. No network beyond the map tiles.
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'prototype'), OUT = process.env.SHOTS || path.join(__dirname, '..', 'test-output', 'procedural');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
fs.mkdirSync(OUT, { recursive: true });
const server = http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '');
  if (u === 'mod/index.json') { const l = JSON.parse(fs.readFileSync(path.join(ROOT, u), 'utf8')); if (!l.includes('procedural')) l.push('procedural');
    s.writeHead(200, { 'Content-Type': 'application/json' }); return s.end(JSON.stringify(l)); }
  const f = path.join(ROOT, u || 'overlay.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
});
const results = []; const check = (name, ok, ev) => results.push({ name, ok: !!ok, evidence: String(ev).slice(0, 300) });
async function browser() {
  if (process.env.CHROME_GPU_LAUNCHER) return require(process.env.CHROME_GPU_LAUNCHER).launch();
  const { chromium } = require('playwright');
  return chromium.launch({ channel: process.env.CI ? undefined : 'chrome', args: process.env.CI ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
}
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/overlay.html`;
  const b = await browser(), p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const shot = n => p.screenshot({ path: path.join(OUT, n + '.png') });
  const state = () => p.evaluate(() => window.__procedural || null);
  const waitDrawn = async ms => { const t = Date.now(); let s; while (Date.now() - t < ms) { s = await state(); if (s && s.shown.length) return s; await p.waitForTimeout(500); } return s; };
  // 0. Round r5: a kV line file that fails to load is UNKNOWN, never "no mapped overhead line within reach". One page with the
  // 400 kV file answered 404; 6502 and 5394 must say not loaded / partial, and __proceduralOhl must report loaded:false.
  { const q = await b.newPage({ viewport: { width: 1280, height: 800 } }); let hit = 0;
    await q.route('**/grid_400kv.geojson', r => { hit++; return r.fulfill({ status: 404, body: 'not found' }); });
    await q.goto(`${base}?lat=51.33877&lon=0.91388&zoom=15`, { waitUntil: 'load' }); await q.waitForTimeout(8000);
    const rd = await q.evaluate(() => ({ SIM: !!window.SIM, canvas: !!document.querySelector('canvas.maplibregl-canvas') }));
    check('404 run: window.SIM and the map canvas present before any shot', rd.SIM && rd.canvas, JSON.stringify(rd));
    await q.$eval('#procedural', x => x.click());
    let f = null; for (let t = 0; t < 60 && !(f && f.a && f.b && f.a.ohlMissing); t++) { await q.waitForTimeout(1000);
      f = await q.evaluate(() => { const S = window.__procedural; if (!S) return null; const g = ref => { const x = S.shown.find(z => z.ref === ref); return x && { ohlMissing: x.geom.ohlMissing, loaded: x.geom.ohlLoaded, clr: x.text.split('; ').find(z => /overhead line/.test(z)) }; };
        return { a: g(6502), b: g(5394), oa: window.__proceduralOhl(6502), ob: window.__proceduralOhl(5394) }; }); }
    console.log('KV404', hit, JSON.stringify(f && { a: f.a, b: f.b, oa: f.oa && { loaded: f.oa.loaded, missing: f.oa.missing, http: f.oa.http, spans: f.oa.spans }, ob: f.ob && { loaded: f.ob.loaded, missing: f.ob.missing } }));
    const say = /overhead line data for 400 kV not loaded: clearance (not applied|partial)/;
    check('404 on the 400 kV line file: 6502 and 5394 say not loaded or partial, never "nothing kept out"', hit > 0 && f && f.a && f.b && say.test(f.a.clr) && say.test(f.b.clr) && !/nothing kept out/.test(f.a.clr + f.b.clr) && !f.a.loaded && !f.b.loaded,
      JSON.stringify(f && { hit, a: f.a, b: f.b }));
    check('404: __proceduralOhl reports loaded:false with 400 kV missing, for 6502 and 5394', f && f.oa && f.ob && f.oa.loaded === false && f.ob.loaded === false && f.oa.missing.includes('400') && f.ob.missing.includes('400'),
      JSON.stringify(f && f.oa && { a: { loaded: f.oa.loaded, missing: f.oa.missing, http: f.oa.http }, b: f.ob && { loaded: f.ob.loaded, missing: f.ob.missing } }));
    await q.evaluate(() => { window.SIM.removeWhere(b => b.scannerRows); window.SIM.map.jumpTo({ center: [0.91388, 51.33877], zoom: 15, pitch: 0, bearing: 0 }); }); await q.waitForTimeout(4000);
    await q.screenshot({ path: path.join(OUT, '0-kv404-solar-top.png') }); await q.close(); }
  // 1. A register solar farm (REPD 6502, 373 MW at its published point).
  await p.goto(`${base}?lat=51.33877&lon=0.91388&zoom=15`, { waitUntil: 'load' }); await p.waitForTimeout(8000);
  const ready = await p.evaluate(() => ({ SIM: !!window.SIM, canvas: !!document.querySelector('canvas.maplibregl-canvas'), gl: (() => { const g = document.querySelector('canvas.maplibregl-canvas').getContext('webgl2') || document.querySelector('canvas.maplibregl-canvas').getContext('webgl'); const e = g && g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; })() }));
  console.log('READY', JSON.stringify(ready));
  check('window.SIM and the map canvas present before any shot', ready.SIM && ready.canvas, JSON.stringify(ready));
  check('Procedural button present', await p.$('#procedural'), 'button #procedural');
  await p.$eval('#procedural', x => x.click()); const s1 = await waitDrawn(60000);
  const farm = s1 && s1.shown.find(x => x.ref === 6502);
  check('solar farm at REPD 6502 drawn', farm && farm.segments > 1000, JSON.stringify(farm && { mw: farm.mw, segments: farm.segments, text: farm.text }));
  check('anchored at the register point', farm && farm.lat === 51.33877 && farm.lon === 0.91388, farm && `${farm.lat}, ${farm.lon}`);
  check('6502 before any rows are loaded: south formula, tagged not calibrated', farm && farm.geom.formula.fitN === 0 && farm.geom.formula.rowAzDeg === 90 && /south formula, not calibrated/.test(farm.text),
    farm && `${farm.geom.formula.layout}, az ${farm.geom.formula.rowAzDeg}: ${farm.text.slice(0, 160)}`);
  // Load the measured rows the page offers (Scanner rows: the lab's row file), so the formula can fit to them.
  await p.evaluate(() => window.SIM.scannerRows.run()); await p.waitForTimeout(1500);
  // Wait for pylons-real's lines and the row fit to reach the layout (both load async; procedural redoes the site when they arrive).
  let s1b = s1; for (let t = 0; t < 90 && !(s1b && s1b.shown.some(x => x.ref === 6502 && x.geom.ohl.length && x.geom.formula.fitN > 0)); t++) { await p.waitForTimeout(1000);
    await p.evaluate(() => window.__proceduralRefresh && window.__proceduralRefresh()); s1b = await state(); }
  // Clearance: no table corner within reachM + the engine's margin of any real line span (distances in the site's local metres).
  const clr = await p.evaluate(() => { const f = window.__procedural.shown.find(x => x.ref === 6502); if (!f) return null; const g = f.geom;
    const sd = (px, py, [ax, ay], [bx, by]) => { const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0; return Math.hypot(px - ax - t * dx, py - ay - t * dy); };
    let worst = Infinity, bad = 0, containers = 0; for (const h of window.__procedural.shown) { const G = h.geom; containers += G.containers.length;
    for (const c of [...G.tables, ...G.containers]) for (const z of G.ohl) { const m = Math.min(...c.map(q => sd(q[0], q[1], ...z.pts))) - (z.reachM + G.marginM);
      if (m < worst) worst = m; if (m < 0) bad++; } }
    return { spans: g.ohl.length, reach: [...new Set(g.ohl.map(z => z.kv + ' kV ' + z.reachM + ' m'))], tables: g.tables.length, containers, others: window.__procedural.shown.map(h => h.ref + ': ' + h.geom.ohl.length + ' spans, ' + h.geom.skipped + ' kept out'), skipped: g.skipped, bad, worstSlackM: +worst.toFixed(2), text: f.text }; });
  check('6502: real overhead line spans passed to the layout', clr && clr.spans > 0, JSON.stringify(clr && { spans: clr.spans, reach: clr.reach }));
  check('6502 view: no table and no container within reachM + margin of any line span', clr && clr.bad === 0 && clr.tables > 1000, JSON.stringify(clr && { tables: clr.tables, containers: clr.containers, bad: clr.bad, worstSlackM: clr.worstSlackM, others: clr.others }));
  check('6502: table positions kept out reported', clr && clr.skipped > 0 && /table positions kept out of overhead line zones \(illustrative\)/.test(clr.text) && /square site box at register point, not the real field/.test(clr.text), clr && `skipped ${clr.skipped}: ${clr.text}`);
  console.log('CLEARANCE 6502', JSON.stringify(clr));
  const info = await p.textContent('#procedural-caption');
  const gs = await p.evaluate(() => ({ style: window.__procedural.style, ghost: window.__proceduralGhost(), layer: !!window.SIM.map.getLayer('procedural-ghost'),
    solid: window.SIM.blocks.filter(x => x.procedural).length, info: document.getElementById('info').textContent.includes('procedural estimate') }));
  check('drawn in the GHOST style by its own layer, none in the solid (measured) wire, #info left alone', gs.style === 'ghost' && gs.ghost > 0 && gs.layer && gs.solid === 0 && !gs.info, JSON.stringify(gs));
  const N = await p.evaluate(() => window.__procedural.calibN);
  check('label says procedural estimate with the real calibration N', Number.isInteger(N) && info.includes(`procedural estimate (formula calibrated on ${N} measured samples`), `N=${N}: ${info.slice(0, 200)}`);
  // The formula readout, checked against what was drawn (not against itself).
  const fm = await p.evaluate(() => { const f = window.__procedural.shown.find(x => x.ref === 6502); return f && { ...f.geom.formula, mw: f.mw }; });
  const gaps = fm ? fm.rowsV.slice(1).map((v, i) => v - fm.rowsV[i]).filter(d => d > 0.5 * fm.pitchM && d < 1.5 * fm.pitchM).sort((a, b) => a - b) : [];
  const drawnPitch = gaps.length ? gaps[Math.floor(gaps.length / 2)] : NaN;
  check('drawn row pitch equals the published pitch within 1 cm', fm && gaps.length > 20 && Math.abs(drawnPitch - fm.pitchM) < 0.01,
    fm && `drawn median ${drawnPitch.toFixed(4)} m over ${gaps.length} row gaps; published ${fm.pitchM.toFixed(4)} m (${fm.pitchTag})`);
  const shoe = fm ? Math.abs(fm.boundary.reduce((a, q, i) => { const r = fm.boundary[(i + 1) % fm.boundary.length]; return a + q[0] * r[1] - r[0] * q[1]; }, 0)) / 2 / 1e4 : NaN;
  check('site box area equals MW divided by the published MW/ha within 1%', fm && Math.abs(shoe - fm.mw / fm.mwPerHa) / shoe < 0.01,
    fm && `boundary ${shoe.toFixed(2)} ha; ${fm.mw} MW / ${fm.mwPerHa.toFixed(3)} MW/ha = ${(fm.mw / fm.mwPerHa).toFixed(2)} ha (${fm.mwPerHaTag})`);
  console.log('FORMULA 6502', JSON.stringify(fm && { pitchM: fm.pitchM, areaHa: fm.areaHa, mwPerHa: fm.mwPerHa, N: fm.N, rows: fm.rowsV.length, drawnPitch }));
  // Row azimuth: drawn (from the table corners the layout placed) against the median of the measured rows INSIDE the site's own
  // box (half side fitBoxHalfM about the register point), each read here on its own from the row file's lon/lat with a plain
  // equirectangular metre scale (not PF.toLocal, not the module's fit), and independent of the camera.
  const inBox = () => window.__inBox = (f) => { const ax = d => ((d % 180) + 180) % 180, med = a => a.sort((p, q) => p - q)[a.length >> 1];
    const h = f.geom.formula.fitBoxHalfM, k = Math.cos(f.lat * Math.PI / 180), M = 111320, m = [];
    for (const doc of Object.values(window.SIM.scannerRows.state.docs)) for (const [[lo0, la0], [lo1, la1]] of doc.rows) {
      const x = ((lo0 + lo1) / 2 - f.lon) * M * k, y = ((la0 + la1) / 2 - f.lat) * M; if (Math.abs(x) > h || Math.abs(y) > h) continue;
      m.push(ax(Math.atan2((lo1 - lo0) * k, la1 - la0) * 180 / Math.PI)); }
    return { n: m.length, measured: m.length ? med(m) : null }; };
  await p.evaluate(inBox);
  const az = await p.evaluate(() => { const f = window.__procedural.shown.find(x => x.ref === 6502); if (!f) return null;
    const ax = d => ((d % 180) + 180) % 180, med = a => a.sort((p, q) => p - q)[a.length >> 1];
    const drawn = med(f.geom.tables.map(([a, b]) => ax(Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI))), ib = window.__inBox(f);
    const diff = Math.abs(((drawn - ib.measured) % 180 + 270) % 180 - 90);
    return { drawn: +drawn.toFixed(2), measured: +ib.measured.toFixed(2), nInBoxTest: ib.n, nFit: f.geom.formula.fitN, boxHalfM: +f.geom.formula.fitBoxHalfM.toFixed(1), diff: +diff.toFixed(2), rowTag: f.geom.formula.rowTag, layout: f.geom.formula.layout }; });
  check('6502: drawn row azimuth within 5 deg of the median measured row azimuth inside its own site box', az && az.nFit > 0 && Math.abs(az.nFit - az.nInBoxTest) <= 0.02 * az.nInBoxTest && az.diff <= 5 && new RegExp(`fitted to [\\d,]+ measured rows inside a ${Math.round(2 * az.boxHalfM).toLocaleString('en-GB')} m square around the register point`).test(az.rowTag), JSON.stringify(az));
  console.log('AZIMUTH 6502', JSON.stringify(az));
  // A neighbouring solar site in the same view with no runs inside ITS OWN box is not credited with 6502's rows.
  const nb = await p.evaluate(() => window.__procedural.shown.filter(x => x.tech !== 'bess' && x.ref !== 6502).map(x => ({ ref: x.ref, mw: x.mw, fitN: x.geom.formula.fitN, inBoxTest: window.__inBox(x).n, boxHalfM: +x.geom.formula.fitBoxHalfM.toFixed(1), tag: x.geom.formula.rowTag })));
  check('neighbouring small solar site with no runs in its own box: south formula, not calibrated', nb.some(x => x.fitN === 0 && x.inBoxTest === 0 && /^south formula, not calibrated/.test(x.tag)), JSON.stringify(nb));
  // Anchored, not camera-bound: pan far away (6502 out of view) and back at the same zoom; the fit read away from the site and
  // the drawn azimuth, pitch and table count must be identical.
  const snap = () => p.evaluate(() => { const f = window.__procedural.shown.find(x => x.ref === 6502); const fit = window.__proceduralFit(6502);
    if (!f) return null; const g = f.geom, sd = (px, py, [ax, ay], [bx, by]) => { const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0; return Math.hypot(px - ax - t * dx, py - ay - t * dy); };
    let worst = Infinity; for (const c of g.tables) for (const z of g.ohl) worst = Math.min(worst, Math.min(...c.map(q => sd(q[0], q[1], ...z.pts))) - (z.reachM + g.marginM));
    const nb = window.__procedural.shown.find(x => x.ref === 5394);
    return { rowAz: g.formula.rowAzDeg, pitch: g.formula.pitchM, tables: g.tables.length, fit: JSON.stringify(fit), spans: g.ohl.length, kept: g.skipped, worstSlackM: +worst.toFixed(3),
      ohlFresh: JSON.stringify(window.__proceduralOhl(6502)), nb: nb && { loaded: nb.geom.ohlLoaded, spans: nb.geom.ohl.length, kept: nb.geom.skipped, clr: nb.text.split('; ').find(z => /overhead line/.test(z)), fresh: JSON.stringify(window.__proceduralOhl(5394)) } }; });
  const before = await snap();
  await p.evaluate(() => window.SIM.map.jumpTo({ center: [1.05, 51.40], zoom: 15 })); await p.waitForTimeout(3000);
  const awayFit = await p.evaluate(() => ({ fit: JSON.stringify(window.__proceduralFit(6502)), shown6502: window.__procedural.shown.some(x => x.ref === 6502),
    ohl6502: JSON.stringify(window.__proceduralOhl(6502)), ohl5394: JSON.stringify(window.__proceduralOhl(5394)) }));
  await p.evaluate(() => window.SIM.map.jumpTo({ center: [0.91388, 51.33877], zoom: 15 })); await p.waitForTimeout(3000);
  await p.evaluate(() => window.__proceduralRefresh()); await p.waitForTimeout(3000);
  const after = await snap();
  check('pan away and back: identical azimuth, pitch, table count; fit read with 6502 out of view is identical', before && after && !awayFit.shown6502 && before.rowAz === after.rowAz && before.pitch === after.pitch && before.tables === after.tables && before.fit === after.fit && awayFit.fit === before.fit,
    JSON.stringify({ before: before && { ...before, fit: before.fit.slice(0, 90) }, awayShown: awayFit.shown6502, awayFitSame: before && awayFit.fit === before.fit, after: after && { rowAz: after.rowAz, pitch: after.pitch, tables: after.tables } }));
  check('clearance anchored: pan away and back at zoom 15, identical span count, tables kept out, worst slack; spans read with 6502 out of view identical', before && after && before.spans > 0 && before.spans === after.spans && before.kept === after.kept && before.worstSlackM === after.worstSlackM && before.ohlFresh === after.ohlFresh && awayFit.ohl6502 === before.ohlFresh,
    JSON.stringify({ before: before && { spans: before.spans, kept: before.kept, worst: before.worstSlackM }, after: after && { spans: after.spans, kept: after.kept, worst: after.worstSlackM }, awayOhlSame: before && awayFit.ohl6502 === before.ohlFresh }));
  check('neighbour 5394: clearance status identical at both cameras and when read away, never "in view"', before && after && before.nb && after.nb && JSON.stringify(before.nb) === JSON.stringify(after.nb) && awayFit.ohl5394 === before.nb.fresh && before.nb.loaded && !/in view/.test(before.nb.clr),
    JSON.stringify({ before: before && before.nb, afterSame: before && after && JSON.stringify(before.nb) === JSON.stringify(after.nb), awaySame: before && before.nb && awayFit.ohl5394 === before.nb.fresh }));
  console.log('CLEARANCE PAN', JSON.stringify({ before: before && { spans: before.spans, kept: before.kept, worst: before.worstSlackM, nb: before.nb }, after: after && { spans: after.spans, kept: after.kept, worst: after.worstSlackM } }));
  await p.evaluate(() => { window.SIM.removeWhere(b => b.scannerRows); window.SIM.map.jumpTo({ center: [0.91388, 51.33877], zoom: 15, pitch: 0, bearing: 0 }); });
  await p.waitForTimeout(4000);
  await shot('1-solar-top');
  await p.$eval('#wire', x => x.click()); await p.waitForTimeout(2500); await shot('2-solar-wire');
  const wt = await p.evaluate(() => { const f = window.__procedural.shown.find(x => x.ref === 6502); const c = f.geom.tables.map(t => t[0]).sort((a, b) => Math.abs(Math.hypot(...a) - 500) - Math.abs(Math.hypot(...b) - 500))[0];
    const k = Math.cos(f.lat * Math.PI / 180); return [f.lon + c[0] / (111320 * k), f.lat + c[1] / 111320, c]; });
  console.log('WALK AT TABLE (local m)', JSON.stringify(wt[2]));
  await p.evaluate(([lo, la]) => window.SIM.map.jumpTo({ center: [lo, la], zoom: 18, pitch: 0, bearing: 0 }), wt); await p.waitForTimeout(3000);
  const surveyOn = await p.$eval('#survey', x => x.classList.contains('on')).catch(() => false); if (surveyOn) await p.$eval('#survey', x => x.click());   // the survey grid hides the faint ghost rows at eye level
  await p.$eval('#walk', x => x.click()); await p.waitForTimeout(2500); await p.keyboard.down('w'); await p.waitForTimeout(600); await p.keyboard.up('w'); await p.waitForTimeout(1500); await shot('3-solar-walk');
  await p.$eval('#drone', x => x.click()); await p.waitForTimeout(3000); await shot('4-solar-fly');
  // 2. A register battery site (REPD 16769, 400 MW): the assumed container yard.
  await p.goto(`${base}?lat=51.93835&lon=0.10570&zoom=16.5`, { waitUntil: 'load' }); await p.waitForTimeout(8000);
  await p.$eval('#procedural', x => x.click()); const s2 = await waitDrawn(30000);
  const bess = s2 && s2.shown.find(x => x.ref === 16769);
  // 400 MW x 2 h / 3.7 MWh = 216.2 -> 217 containers; 3 segments per edge x 4 edges = 12 per box, plus the fence box.
  check('battery yard sized from capacity (217 containers less any kept out of line zones, assumed rule)', bess && bess.segments === 12 * (218 - bess.geom.skipped), JSON.stringify(bess && { segments: bess.segments, skipped: bess.geom.skipped, text: bess.text }));
  await p.$eval('#wire', x => x.click()); await p.waitForTimeout(2500); await shot('5-bess-wire');
  const cb = await p.evaluate(() => { const f = window.__procedural.shown.find(x => x.ref === 16769); return f && { spans: f.geom.ohl.length, skipped: f.geom.skipped, text: f.text }; });
  check('storage: clearance stated', cb && (cb.spans ? /container positions kept out/.test(cb.text) : /no mapped overhead line within reach of this site box: nothing kept out|no overhead line data loaded for this site box: clearance not applied|overhead line data for [\d ,and]+ kV not loaded/.test(cb.text)), JSON.stringify(cb));
  await p.$eval('#walk', x => x.click()); await p.waitForTimeout(2500); await p.keyboard.down('w'); await p.waitForTimeout(1500); await p.keyboard.up('w'); await p.waitForTimeout(1500); await shot('6a-bess-walk');
  await p.$eval('#drone', x => x.click()); await p.waitForTimeout(3000); await shot('6-bess-fly');
  // 3. A register solar site with no measured rows loaded (REPD 1335, 49.6 MW): the south formula, said so.
  await p.goto(`${base}?lat=51.37343&lon=-2.08967&zoom=15`, { waitUntil: 'load' }); await p.waitForTimeout(8000);
  await p.$eval('#procedural', x => x.click()); const s3 = await waitDrawn(60000);
  const nr = s3 && s3.shown.find(x => x.ref === 1335);
  check('solar site with no measured rows: south formula, row azimuth 90, tagged not calibrated', nr && nr.geom.formula.fitN === 0 && nr.geom.formula.layout === 'south' && nr.geom.formula.rowAzDeg === 90 && /south formula, not calibrated/.test(nr.text),
    JSON.stringify(nr && { layout: nr.geom.formula.layout, az: nr.geom.formula.rowAzDeg, text: nr.text.slice(0, 160) }));
  // 4. Switching off removes every procedural block.
  await p.$eval('#procedural', x => x.click()); await p.waitForTimeout(500);
  check('off removes the blocks', await p.evaluate(() => !window.SIM.blocks.some(x => x.procedural) && window.__proceduralGhost() === 0 && document.getElementById('procedural-caption').style.display === 'none'), 'no procedural blocks left, caption hidden');
  check('no page errors', errs.length === 0, errs.join(' | ') || 'none');
  await b.close(); server.close();
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  -- ${r.evidence}`);
  const failed = results.filter(r => !r.ok).length; console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });
