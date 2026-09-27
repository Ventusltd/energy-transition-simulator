// coords-readout HUD check: the HUD must name the conversion it actually used. Serves prototype/ on a local port and
// opens overlay.html at OS test point TP09 three times:
//   1. OSTN15 index served with CRLF line endings (built in memory from the real file, no file written): the pinned
//      hash no longer matches, the loader refuses it, so the HUD must say Helmert on BOTH lines and never claim OSTN15;
//   2. OSTN15 index answered with HTTP 500: same expectation;
//   3. the real LF data: the HUD must say OSTN15 on both lines, with E/N within 0.1 m of the OS published answer.
// Reference: OS OSTN15 test point TP09, ETRS89 51.48936564950 N, -0.11992557180 E -> E 530624.974, N 178388.464
// (OS pack OSTN15-NTv2.zip, Crown copyright, OGL; numbers only). The HUD prints E/N to 0.1 m.
// Run: node tests/coords-readout.cjs   (exit 1 on any FAIL). SHOTS=<dir> puts the screenshots there.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..', 'prototype');
const OUT = process.env.SHOTS || path.join(__dirname, '..', 'test-output');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const TP09 = { lat: 51.48936564950, lon: -0.11992557180, e: 530624.974, n: 178388.464 };
fs.mkdirSync(OUT, { recursive: true });

let mode = 'lf';
const server = http.createServer((q, s) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'overlay.html';
  const f = path.join(ROOT, rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
  if (/world\/data\/ostn15\/ostn15\.json$/.test(rel.replace(/\\/g, '/')) && mode !== 'lf') {
    if (mode === '500') { s.writeHead(500); return s.end('fault injected by test'); }
    const crlf = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'); // in memory only
    s.writeHead(200, { 'Content-Type': 'application/json' }); return s.end(crlf);
  }
  s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
});

const results = [];
const check = (name, ok, evidence) => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  | ${String(evidence).replace(/\n/g, ' / ').slice(0, 240)}`); };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/overlay.html?lat=${TP09.lat}&lon=${TP09.lon}`;
  const b = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome',
    args: process.env.CI ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const hudOf = async (m) => {
    mode = m;
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(url, { waitUntil: 'load' });
    // Wait until the BNG row has a number, then let the OSTN15 block request settle (success or refusal).
    await p.waitForFunction(() => /E \d/.test((document.getElementById('coords-hud') || {}).textContent || ''), null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(4000);
    await p.evaluate(() => window.SIM && SIM.coordsReadout && SIM.coordsReadout.render());
    await p.waitForTimeout(500);
    const text = await p.evaluate(() => (document.getElementById('coords-hud') || {}).innerText || '');
    await p.screenshot({ path: path.join(OUT, `TP09-ostn15-${m}.png`) });
    await p.close();
    return { text, errs };
  };
  const lines = t => t.split('\n');

  for (const m of ['crlf', '500']) {
    const { text, errs } = await hudOf(m);
    const L = lines(text), grid = L.find(l => /^Grid:/.test(l.trim())) || '', acc = L.find(l => /Helmert estimate|OSTN15 \(OS definitive/.test(l)) || '';
    check(`[${m}] HUD has a BNG reading`, /E \d+\.\d\s+N \d+\.\d/.test(text), text);
    check(`[${m}] accuracy line says Helmert, not loaded`, /Helmert estimate/.test(acc) && /OSTN15 not loaded/.test(acc), acc);
    check(`[${m}] Grid line says Helmert (OSTN15 not loaded)`, grid.trim() === 'Grid: OS National Grid, Helmert (OSTN15 not loaded)', grid);
    check(`[${m}] no HUD line claims OSTN15 is in use`, !L.some(l => /OSTN15/.test(l) && !/not loaded/.test(l)), L.filter(l => /OSTN15/.test(l)).join(' | '));
    check(`[${m}] no page errors`, errs.length === 0, errs.join(' | ') || 'none');
  }

  const { text, errs } = await hudOf('lf');
  const L = lines(text), grid = L.find(l => /^Grid:/.test(l.trim())) || '';
  const mm = text.match(/E (\d+\.\d)\s+N (\d+\.\d)/) || [];
  const dE = Math.abs(Number(mm[1]) - TP09.e), dN = Math.abs(Number(mm[2]) - TP09.n);
  check('[lf] accuracy line says OSTN15 (OS definitive)', /OSTN15 \(OS definitive/.test(text), L.find(l => /OSTN15/.test(l)) || text);
  check('[lf] Grid line says OSTN15', grid.trim() === 'Grid: OS National Grid, OSTN15', grid);
  check('[lf] no HUD line says Helmert', !/Helmert/.test(text), L.filter(l => /Helmert/.test(l)).join(' | ') || 'none');
  check('[lf] HUD E/N within 0.1 m of OS TP09', mm.length === 3 && dE <= 0.1 && dN <= 0.1, `E ${mm[1]} (d ${dE.toFixed(3)}) N ${mm[2]} (d ${dN.toFixed(3)})`);
  check('[lf] no page errors', errs.length === 0, errs.join(' | ') || 'none');

  await b.close(); server.close();
  const pass = results.filter(Boolean).length;
  console.log(`${pass}/${results.length} coords-readout checks pass`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
