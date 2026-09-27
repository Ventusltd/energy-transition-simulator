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
  // 1. A register solar farm (REPD 6502, 373 MW at its published point).
  await p.goto(`${base}?lat=51.33877&lon=0.91388&zoom=15`, { waitUntil: 'load' }); await p.waitForTimeout(8000);
  check('Procedural button present', await p.$('#procedural'), 'button #procedural');
  await p.$eval('#procedural', x => x.click()); const s1 = await waitDrawn(60000);
  const farm = s1 && s1.shown.find(x => x.ref === 6502);
  check('solar farm at REPD 6502 drawn', farm && farm.segments > 1000, JSON.stringify(farm && { mw: farm.mw, segments: farm.segments, text: farm.text }));
  check('anchored at the register point', farm && farm.lat === 51.33877 && farm.lon === 0.91388, farm && `${farm.lat}, ${farm.lon}`);
  // Wait for pylons-real's lines to reach the layout (it loads them async; procedural redoes the site when they arrive).
  let s1b = s1; for (let t = 0; t < 60 && !(s1b && s1b.shown.some(x => x.ref === 6502 && x.geom.ohl.length)); t++) { await p.waitForTimeout(1000);
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
  const info = await p.textContent('#info');
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
  await shot('1-solar-top');
  await p.click('#wire'); await p.waitForTimeout(2500); await shot('2-solar-wire');
  await p.click('#walk'); await p.waitForTimeout(2500); await p.keyboard.down('w'); await p.waitForTimeout(1500); await p.keyboard.up('w'); await p.waitForTimeout(1500); await shot('3-solar-walk');
  await p.click('#drone'); await p.waitForTimeout(3000); await shot('4-solar-fly');
  // 2. A register battery site (REPD 16769, 400 MW): the assumed container yard.
  await p.goto(`${base}?lat=51.93835&lon=0.10570&zoom=16.5`, { waitUntil: 'load' }); await p.waitForTimeout(8000);
  await p.$eval('#procedural', x => x.click()); const s2 = await waitDrawn(30000);
  const bess = s2 && s2.shown.find(x => x.ref === 16769);
  // 400 MW x 2 h / 3.7 MWh = 216.2 -> 217 containers; 3 segments per edge x 4 edges = 12 per box, plus the fence box.
  check('battery yard sized from capacity (217 containers less any kept out of line zones, assumed rule)', bess && bess.segments === 12 * (218 - bess.geom.skipped), JSON.stringify(bess && { segments: bess.segments, skipped: bess.geom.skipped, text: bess.text }));
  await p.click('#wire'); await p.waitForTimeout(2500); await shot('5-bess-wire');
  const cb = await p.evaluate(() => { const f = window.__procedural.shown.find(x => x.ref === 16769); return f && { spans: f.geom.ohl.length, skipped: f.geom.skipped, text: f.text }; });
  check('storage: clearance stated', cb && (cb.spans ? /container positions kept out/.test(cb.text) : /no overhead line data in view: clearance not applied/.test(cb.text)), JSON.stringify(cb));
  await p.click('#walk'); await p.waitForTimeout(2500); await p.keyboard.down('w'); await p.waitForTimeout(1500); await p.keyboard.up('w'); await p.waitForTimeout(1500); await shot('6a-bess-walk');
  await p.click('#drone'); await p.waitForTimeout(3000); await shot('6-bess-fly');
  // 3. Switching off removes every procedural block.
  await p.$eval('#procedural', x => x.click()); await p.waitForTimeout(500);
  check('off removes the blocks', await p.evaluate(() => !window.SIM.blocks.some(x => x.procedural)), 'no procedural blocks left');
  check('no page errors', errs.length === 0, errs.join(' | ') || 'none');
  await b.close(); server.close();
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  -- ${r.evidence}`);
  const failed = results.filter(r => !r.ok).length; console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });
