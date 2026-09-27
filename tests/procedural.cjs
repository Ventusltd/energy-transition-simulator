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
  const info = await p.textContent('#info');
  check('label says procedural estimate', /procedural estimate/.test(info) && /0 measured samples/.test(info), info);
  await shot('1-solar-top');
  await p.click('#wire'); await p.waitForTimeout(2500); await shot('2-solar-wire');
  await p.click('#walk'); await p.waitForTimeout(2500); await p.keyboard.down('w'); await p.waitForTimeout(1500); await p.keyboard.up('w'); await p.waitForTimeout(1500); await shot('3-solar-walk');
  await p.click('#drone'); await p.waitForTimeout(3000); await shot('4-solar-fly');
  // 2. A register battery site (REPD 16769, 400 MW): the assumed container yard.
  await p.goto(`${base}?lat=51.93835&lon=0.10570&zoom=16.5`, { waitUntil: 'load' }); await p.waitForTimeout(8000);
  await p.$eval('#procedural', x => x.click()); const s2 = await waitDrawn(30000);
  const bess = s2 && s2.shown.find(x => x.ref === 16769);
  // 400 MW x 2 h / 3.7 MWh = 216.2 -> 217 containers; 3 segments per edge x 4 edges = 12 per box, plus the fence box.
  check('battery yard sized from capacity (217 containers, assumed rule)', bess && bess.segments === 12 * 218, JSON.stringify(bess && { segments: bess.segments, text: bess.text }));
  await p.click('#wire'); await p.waitForTimeout(2500); await shot('5-bess-wire');
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
