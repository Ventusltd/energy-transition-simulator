// Trench-measure test: serves prototype/ with a scratch module list (the page's own index.json plus trench-measure),
// opens overlay.html, runs connect-here (straight route, so no road router is called), draws the trench with the
// cited section, and reads the drawn geometry back from the GPU buffers: width, depth, cover, phase and circuit
// spacing must equal the typed or cited values within 1 cm. Also: a typed section, a refused section that does
// not fit, and a negative control (a vertex moved 2 cm must FAIL the check). Screenshots to test-output/trench-measure
// (or SHOTS=dir). CHROME_LAUNCHER=path/to/launcher.cjs uses a shared launcher; otherwise playwright's Chrome.
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'prototype');
const OUT = process.env.SHOTS || path.join(__dirname, '..', 'test-output', 'trench-measure');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.bin': 'application/octet-stream' };
fs.mkdirSync(OUT, { recursive: true });
const server = http.createServer((q, s) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'overlay.html';
  if (rel === 'mod/index.json') {   // scratch overlay: the page's module list plus this lane's module
    const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'mod', 'index.json'), 'utf8'));
    if (!list.includes('trench-measure')) list.push('trench-measure');
    s.writeHead(200, { 'Content-Type': 'application/json' }); return s.end(JSON.stringify(list));
  }
  const f = path.join(ROOT, rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
});
const results = []; const check = (name, ok, evidence) => results.push({ name, ok: !!ok, evidence: String(evidence).slice(0, 400) });
const launch = () => process.env.CHROME_LAUNCHER ? require(process.env.CHROME_LAUNCHER).launch()
  : require('playwright').chromium.launch({ channel: process.env.CI ? undefined : 'chrome', args: process.env.CI ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const LAT = +(process.env.TLAT || 51.215), LON = +(process.env.TLON || -1.78);
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/overlay.html`;
  const b = await launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`${base}?lat=${LAT}&lon=${LON}&connect=1&croad=0&trench=1`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__trench && /Trench (check|:)/.test(window.__trench.lastText || ''), null, { timeout: 90000 }).catch(() => {});
  await p.waitForTimeout(2500);
  const first = await p.evaluate(() => ({ text: window.__trench && window.__trench.lastText, c: window.__connect && { kv: window.__connect.kv, n: window.__connect.n, route_m: window.__connect.route_m } }));
  check('connect-here route exists', first.c && first.c.route_m > 0, JSON.stringify(first.c));
  const auto = await p.evaluate(() => window.__trench.check());
  const FARM = { 33: { 1: '33kv-1-agri', 2: '33kv-2-agri' }, 132: { 1: '132kv-1-dno@farmland', 2: '132kv-2@farmland' } };
  check('trench auto: farmland section drawn (default land, labelled assumed)', auto.section === (FARM[first.c.kv] || {})[first.c.n] && auto.land === 'farmland' && auto.land_prov === 'assumed', `${auto.section} for ${first.c.kv} kV x ${first.c.n}, land ${auto.land} (${auto.land_prov})`);
  const cov = auto.rows.find(r => r.what === 'cover');
  check('trench auto on farmland: cover 0.91 m (S1 Table 5.4.1), cited', cov && cov.value_m === 0.91 && cov.prov === 'cited' && cov.pass, JSON.stringify(cov));
  check('the read-back check is named "consistency"', auto.name === 'consistency' && /^Trench consistency (PASS|FAIL)/.test(auto.text) && /not a site survey/.test(auto.text), auto.text.slice(0, 120));
  check('trench auto: drawn = cited within 1 cm at every rib', auto.ok && auto.ribs > 0, auto.text);
  for (const r of auto.rows) check(`  ${r.what} ${r.value_m} m (${r.prov})`, r.pass, `worst ${(r.worst_err_m * 1000).toFixed(3)} mm`);
  await p.screenshot({ path: path.join(OUT, '1-route-overview.png') });
  // Walk to the section nearest the route's middle ("trench go": zoom 22, looking along the trench, true scale).
  const rib = await p.evaluate(() => { const r = window.__trench.route(), i = Math.floor(r.length / 2); return r[i]; });
  await p.evaluate(([lon, lat]) => window.SIM.map.jumpTo({ center: [lon, lat] }), rib);
  const go = await p.evaluate(() => window.__trench.cmd('trench go'));
  check('trench go: walks to a section at zoom 22', /looking along the trench/.test(go) , go);
  await p.waitForTimeout(4000); await p.evaluate(() => window.SIM.map.fire('moveend')); await p.waitForTimeout(800);
  check('X-ray lifts the zoom limit to 22', await p.evaluate(() => window.SIM.map.getZoom() > 21.9), await p.evaluate(() => window.SIM.map.getZoom()));
  await p.screenshot({ path: path.join(OUT, '2-xray-walk-z22.png') });
  await p.evaluate(() => window.SIM.map.jumpTo({ pitch: 0, bearing: 0 }));
  await p.waitForTimeout(3000);
  await p.screenshot({ path: path.join(OUT, '3-xray-plan-z22.png') });
  // Other land (typed): the catalogue's 0.90 m (132 kV) or 0.75 m (33 kV) section, labelled typed.
  const oth = await p.evaluate(async () => { await window.__trench.cmd('trench auto other'); return window.__trench.consistency(); });
  const ocov = oth.rows.find(r => r.what === 'cover');
  check('trench auto other: other-land cover, land typed', oth.ok && oth.land === 'other' && oth.land_prov === 'typed' && ocov.value_m < 0.91 && !/@farmland/.test(oth.section), `${oth.section} cover ${ocov.value_m} (${ocov.prov})`);
  const fb = await p.evaluate(async () => { await window.__trench.cmd('trench auto farmland'); await window.__trench.cmd('trench go'); return window.__trench.consistency(); });
  check('trench auto farmland: back to 0.91 m, land typed', fb.ok && fb.rows.find(r => r.what === 'cover').value_m === 0.91 && fb.land_prov === 'typed', fb.section);
  await p.waitForTimeout(3000); await p.evaluate(() => window.SIM.map.fire('moveend')); await p.waitForTimeout(800);
  const foot = await p.evaluate(() => document.getElementById('trench-foot').textContent);
  check('panel shows the land class and "Consistency", no "typical"', /Land: farmland \[typed\]/.test(foot) && /Consistency PASS/.test(foot) && !/typical/i.test(foot), foot.slice(0, 300));
  await p.screenshot({ path: path.join(OUT, '2b-farmland-walk-z22.png') });
  // A typed section.
  const t = await p.evaluate(async () => { const txt = await window.__trench.cmd('trench w 0.6 d 1.2 cover 0.9 od 160mm'); return { txt, r: window.__trench.check(), s: window.__trench.spec() }; });
  check('typed section drawn and checked within 1 cm', t.r.ok && t.s.id === 'typed' && t.s.w === 0.6 && t.s.d === 1.2 && t.s.cover === 0.9 && Math.abs(t.s.od - 0.16) < 1e-12, t.r.text);
  await p.evaluate(() => window.SIM.map.fire('moveend')); await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(OUT, '4-typed-section.png') });
  // A typed section that does not fit is refused, and the drawn one stays.
  const bad = await p.evaluate(async () => ({ txt: await window.__trench.cmd('trench w 0.4 d 0.9 cover 0.9 od 160mm'), id: window.__trench.spec().id, w: window.__trench.spec().w }));
  check('section that does not fit is refused', /deeper than the trench/.test(bad.txt) && bad.w === 0.6, bad.txt);
  // Two circuits (cited 132kv-2).
  const two = await p.evaluate(async () => { await window.__trench.cmd('trench 132kv-2'); return window.__trench.check(); });
  check('cited 132kv-2 (two circuits) within 1 cm incl. circuit spacing', two.ok && two.rows.some(r => r.what === 'cs'), two.text);
  check('catalogue status "typical" is tagged "estimated"', two.rows.find(r => r.what === 'cover').prov === 'estimated' && !two.rows.some(r => /typical/.test(r.prov)), two.rows.map(r => r.what + ':' + r.prov).join(' '));
  await p.evaluate(() => window.SIM.map.fire('moveend')); await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(OUT, '5-two-circuits.png') });
  // X-ray off: the trench is depth-tested like the ground (buried), and the zoom limit is given back.
  await p.evaluate(() => window.__trench.cmd('trench go')); await p.waitForTimeout(3000);
  await p.screenshot({ path: path.join(OUT, '6-two-circuits-xray-walk.png') });
  const off = await p.evaluate(async () => { await window.__trench.cmd('xray off'); await new Promise(r => setTimeout(r, 2500)); return window.SIM.map.getMaxZoom(); });
  check('xray off gives the zoom limit back', off === 20, off);
  await p.screenshot({ path: path.join(OUT, '7-xray-off.png') });
  // Negative control: move one floor vertex of the first rib 2 cm outwards in the GPU buffer; the check must fail.
  const neg = await p.evaluate(() => {
    const PF = window.__pf.PF, blk = window.__trench.blocks()[0].groups.wall, B0 = window.__trench.blocks()[0], r0 = window.__trench.measureRib(0);
    const d = 0.02 * PF.meterInMercator(B0.anchor.lat), saved = blk.buf.slice();
    // every buffer vertex at the first rib's far floor corner is moved 2 cm outwards, across the trench
    const corner = r0.corners[1], c0 = r0.corners[0], ux = (corner.x - c0.x) / r0.width, uy = (corner.y - c0.y) / r0.width, idx = [];
    for (let v = 0; v < blk.lines.length * 2; v++) { const o = PF.toMercator(B0.anchor.lat, B0.anchor.lon, 0), q = PF.mapToWire(B0.anchor, o.x + blk.buf[3 * v], o.y + blk.buf[3 * v + 1], blk.buf[3 * v + 2]);
      if (Math.abs(q.x - corner.x) < 1e-4 && Math.abs(q.y - corner.y) < 1e-4 && Math.abs(q.z - corner.z) < 1e-4) idx.push(v); }
    for (const v of idx) { blk.buf[3 * v] += ux * d; blk.buf[3 * v + 1] -= uy * d; }   // Mercator y grows southwards
    const bad = window.__trench.check(); blk.buf.set(saved); const good = window.__trench.check();
    return { moved: idx.length, badOk: bad.ok, badWidth: bad.rows.find(r => r.what === 'width').worst_err_m, goodOk: good.ok, width: r0.width };
  });
  check('negative control: a 2 cm error is caught', neg.moved > 0 && !neg.badOk && neg.badWidth > 0.015 && neg.goodOk, JSON.stringify(neg));
  check('no page errors', errs.length === 0, errs.join(' | ') || 'none');
  await b.close(); server.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  -- ${r.evidence}`);
  const failed = results.filter(r => !r.ok).length; console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });
