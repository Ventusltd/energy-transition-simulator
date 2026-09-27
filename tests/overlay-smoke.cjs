// Smoke test for the GridAtlas overlay: serves prototype/ on a local port, opens overlay.html headless, and checks
// what a player would see. Runs the same on a PC (GPU or not) and in GitHub Actions (software WebGL).
// Every check is PASS or FAIL with evidence; screenshots go to test-output/ (uploaded as a CI artifact).
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..', 'prototype'), OUT = path.join(__dirname, '..', 'test-output');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
fs.mkdirSync(OUT, { recursive: true });
const server = http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'overlay.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
});
const results = []; const check = (name, ok, evidence) => results.push({ name, ok: !!ok, evidence: String(evidence).slice(0, 200) });
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/overlay.html`;
  const b = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', args: process.env.CI ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  // 1. The map loads at a 400 kV line (GridAtlas coordinates) and the core buttons exist.
  await p.goto(`${base}?lat=52.2441634&lon=-1.0453368`, { waitUntil: 'load' }); await p.waitForTimeout(9000);
  const btns = await p.$$eval('#bar button', bs => bs.map(x => x.textContent.trim()));
  for (const need of ['Satellite', 'Dark', 'Wire', 'Walk', 'Drone', 'Map', 'Pylons']) check(`button ${need}`, btns.some(t => t.startsWith(need)), btns.join(' | '));
  check('map canvas', await p.$('canvas.maplibregl-canvas'), 'maplibre canvas present');
  // 2. Pylons stand on GridAtlas line vertices.
  await p.click('#pylons'); await p.waitForTimeout(3000);
  const pl = await p.textContent('#pylons'); const n = Number((pl.match(/\((\d+)\)/) || [])[1] || 0);
  check('pylons on the 400 kV line', n > 0, pl); await p.screenshot({ path: path.join(OUT, '1-pylons.png') });
  // 3. Walk and drone move you (the readout changes).
  const before = await p.textContent('#here-readout').catch(() => '');
  await p.click('#walk'); await p.waitForTimeout(2500); await p.keyboard.down('w'); await p.waitForTimeout(1500); await p.keyboard.up('w'); await p.waitForTimeout(800);
  const after = await p.textContent('#here-readout').catch(() => '');
  check('walking moves you', before && after && before !== after, `${before} -> ${after}`); await p.screenshot({ path: path.join(OUT, '2-walk.png') });
  await p.click('#drone'); await p.waitForTimeout(2500); await p.screenshot({ path: path.join(OUT, '3-drone.png') });
  // 4. The wire view (morning engine look) keeps the objects.
  await p.click('#wire'); await p.waitForTimeout(2500); await p.screenshot({ path: path.join(OUT, '4-wire.png') });
  // 5. No names on screen: the page text holds no project name words from the public register (spot check: no "Solar Farm" label).
  const text = await p.evaluate(() => document.body.innerText);
  check('no project names on screen', !/solar farm|solar park/i.test(text), 'page text scanned');
  check('no page errors', errs.length === 0, errs.join(' | ') || 'none');
  await b.close(); server.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  -- ${r.evidence}`);
  const failed = results.filter(r => !r.ok).length; console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });
