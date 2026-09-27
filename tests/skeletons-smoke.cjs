// Smoke test for mod/skeletons.js (not listed in mod/index.json, so it is injected here). Same server/launch pattern as
// tests/overlay-smoke.cjs: serves prototype/ on a local port, opens overlay.html headless, waits for window.SIM, adds
// the module by a script tag, presses "Skeletons" and checks that the drawn line count equals the exported JSON's.
// Every check is PASS or FAIL with evidence; the screenshot goes to test-output/skeletons.png.
// Offline use (sandbox without the CDN): PLAYWRIGHT_MODULE=/path/to/playwright and MAPLIBRE_DIR=/path/to/node_modules/
// maplibre-gl serve maplibre from npm instead of jsdelivr; other external requests are then aborted.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.join(__dirname, '..', 'prototype'), OUT = path.join(__dirname, '..', 'test-output');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'mod', 'skeletons.data.json'), 'utf8'));
fs.mkdirSync(OUT, { recursive: true });
const server = http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'overlay.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
});
const results = []; const check = (name, ok, evidence) => results.push({ name, ok: !!ok, evidence: String(evidence).slice(0, 200) });
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`, base = `${origin}/overlay.html`;
  const b = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', args: process.env.CI ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  if (process.env.MAPLIBRE_DIR) {
    const dist = path.join(process.env.MAPLIBRE_DIR, 'dist');
    await p.route(u => !u.href.startsWith(origin), r => {
      const m = r.request().url().match(/cdn\.jsdelivr\.net\/npm\/maplibre-gl@[^/]+\/dist\/([\w.-]+)$/);
      if (m && fs.existsSync(path.join(dist, m[1]))) return r.fulfill({ path: path.join(dist, m[1]), contentType: TYPES[path.extname(m[1])] });
      return r.abort();
    });
  }
  const errs = [], missing = []; p.on('pageerror', e => errs.push(e.message));
  p.on('response', r => { if (r.status() === 404 && r.url().startsWith(origin)) missing.push(r.url().slice(origin.length)); });
  await p.goto(`${base}?lat=52.2441634&lon=-1.0453368`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.SIM && window.__pf && window.__pf.PF, null, { timeout: 30000 }).catch(() => {});
  check('window.SIM exists (the app started)', await p.evaluate(() => !!(window.SIM && window.__pf)), 'window.SIM, window.__pf');
  // Inject the module the way the overlay's loader would (a script tag with a src under mod/).
  await p.addScriptTag({ url: `${origin}/mod/skeletons.js` });
  await p.waitForSelector('#skeletons', { timeout: 20000 }).catch(() => {});
  const btns = await p.$$eval('#bar button', bs => bs.map(x => x.textContent.trim()));
  check('button Skeletons', btns.includes('Skeletons'), btns.join(' | '));
  // The bar wraps under the Design box (mod/plant.js) at narrow widths; a real click is tried first, then a DOM click.
  const press = () => p.click('#skeletons', { timeout: 3000 }).catch(() => p.dispatchEvent('#skeletons', 'click'));
  await press();
  await p.waitForFunction(() => window.__skeletons, null, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(2000);
  const got = await p.evaluate(() => {
    const bl = window.SIM.blocks.filter(x => x.skeleton);
    return { blocks: bl.length, lines: bl.reduce((t, x) => t + x.lines.length, 0), verts: bl.reduce((t, x) => t + x.buf.length / 3, 0),
      ids: bl.map(x => x.skeleton), info: document.getElementById('info').textContent, label: document.getElementById('skeletons').textContent };
  });
  check('skeleton blocks drawn (tower, pylon, solar)', got.blocks === DATA.objects.length && got.ids.join() === DATA.objects.map(o => o.id).join(), `${got.blocks} blocks: ${got.ids.join(', ')}`);
  check('line count > 0 and equals the JSON', got.lines > 0 && got.lines === DATA.n_lines, `drawn ${got.lines}, JSON ${DATA.n_lines}`);
  check('wire buffers hold 2 vertices per line', got.verts === 2 * DATA.n_lines, `${got.verts} vertices`);
  check('info states the provenance', /illustrative example, dimensions assumed/.test(got.info), got.info);
  await p.screenshot({ path: path.join(OUT, 'skeletons.png') });
  // Pressing again removes them (toggle), leaving no skeleton blocks.
  await press(); await p.waitForTimeout(300);
  const left = await p.evaluate(() => window.SIM.blocks.filter(x => x.skeleton).length);
  check('second press removes them', left === 0, `${left} left`);
  const text = await p.evaluate(() => document.body.innerText);
  check('no project names on screen', !/solar farm|solar park/i.test(text), 'page text scanned');
  check('no missing local files (404)', missing.length === 0, missing.join(' | ') || 'none');
  check('no page errors', errs.length === 0, errs.join(' | ') || 'none');
  await b.close(); server.close();
  fs.writeFileSync(path.join(OUT, 'skeletons-results.json'), JSON.stringify(results, null, 1));
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  -- ${r.evidence}`);
  const failed = results.filter(r => !r.ok).length; console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });
