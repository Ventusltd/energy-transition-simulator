// Check for mod/lidar-stream.js (rule R5 in the browser). It NEVER calls the EA: every request to the EA WCS is
// answered by a SYNTHETIC GeoTIFF made here, in the service's own form, and any request that escapes is a FAIL.
// Part 1 (node): lattice, clipping, decoder round trip, zero-run rule, receipt hash, pacer.
// Part 2 (Chrome): arrive, stream DTM then DSM, draw ground + above-ground wire, receipt + licence on screen,
// no fetch on movement, and "no measured ground here" outside the envelope. Screenshots to test-output/ or $SHOTS.
const http = require('http'), fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const { webcrypto } = require('crypto');
const ROOT = path.join(__dirname, '..', 'prototype'), OUT = process.env.SHOTS || path.join(__dirname, '..', 'test-output');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (name, ok, evidence) => results.push({ name, ok: !!ok, evidence: String(evidence).slice(0, 240) });
const DTM = (e, n) => 100 + 0.01 * (e % 2048) + 5 * Math.sin((n % 2048) / 150);
const BUILDING = (e, n) => { const u = e % 2048, v = n % 2048; return u >= 1004 && u < 1044 && v >= 1004 && v < 1044 ? 10 : 0; };

(async () => {
  const R5 = await import(pathToFileURL(path.join(ROOT, 'mod', 'lidar-stream', 'r5.mjs')).href);
  // ---- Part 1: pure maths ----
  const t = R5.tileOf(463500.4, 262100.9);
  check('lattice tile corner on 2,048 m', t.e0 === 462848 && t.n0 === 260096 && t.e1 - t.e0 === 2048, JSON.stringify(t));
  check('negative-side cell stays in its tile', R5.tileOf(462848, 260096).key === '462848_260096' && R5.tileOf(462847.99, 260096).e0 === 460800, 'edges');
  check('clip to envelope', JSON.stringify(R5.clip(R5.tileOf(655900, 300000), R5.SOURCES.dtm.env)) === JSON.stringify({ e0: 655360, n0: 299008, e1: 656000, n1: 301056 }), 'east edge');
  check('outside envelope is null', R5.clip(R5.tileOf(330000, 700000), R5.SOURCES.dtm.env) === null, 'Scotland');
  check('DSM card is the catalogue URL (not the 404 guess)', /digital-surface-model-first-return-dsm-1m\/wcs$/.test(R5.SOURCES.dsm.url) && /FZ_DSM_1m$/.test(R5.SOURCES.dsm.coverage), R5.SOURCES.dsm.url);
  const tif = R5.synthTiff(1000, 2064, 64, 64, (i, j) => (i === 3 && j === 5 ? -3.4028234663852886e38 : 50 + i + 100 * j));
  const g = await R5.decodeGeoTiff(tif);
  check('decoder round trip', g.width === 64 && g.west === 1000 && g.north === 2064 && g.res === 1 && g.data[2 * 64 + 7] === 257 && g.hasNodata, `${g.width} ${g.west} ${g.north} ${g.data[2 * 64 + 7]}`);
  const m = R5.measuredMask(g);
  check('nodata cell is unmeasured', m.mask[5 * 64 + 3] === 0 && m.valid === 64 * 64 - 1, `valid ${m.valid}`);
  const z = await R5.decodeGeoTiff(R5.synthTiff(0, 64, 64, 64, () => 0, null));
  check('all-zero box without nodata tag = no measured ground', R5.measuredMask(z).valid === 0, 'valid 0');
  const zr = await R5.decodeGeoTiff(R5.synthTiff(0, 64, 64, 64, i => (i < 20 ? 0 : i === 30 ? 0 : 7), null));
  const zm = R5.measuredMask(zr);
  check('zero run >= 16 dropped, lone zero kept', zm.mask[0] === 0 && zm.mask[30] === 1 && zm.mask[25] === 1, `row0 ${zm.mask.slice(0, 32).join('')}`);
  const s1 = await R5.cellSha256(g.data, webcrypto.subtle), s2 = await R5.cellSha256(new Float32Array(g.data), webcrypto.subtle);
  check('receipt hash is over cells (stable, 64 hex)', s1 === s2 && /^[0-9a-f]{64}$/.test(s1), s1);
  let now = 0; const pc = R5.createPacer({ clock: () => now });
  const a1 = pc.take(); const a2 = pc.take(); pc.done(200); now += 39999; const a3 = pc.take(); now += 1; const a4 = pc.take();
  check('pacer: one at a time, 40 s gap', a1 && !a2 && !a3 && a4, `${a1} ${a2} ${a3} ${a4}`);
  pc.done(429); now += R5.GAP_MS; const b1 = pc.take(); now += R5.PAUSE_MS; const b2 = pc.take();
  check('pacer: refusal pauses 5 min', !b1 && b2, `${b1} ${b2}`);
  const cap = R5.createPacer({ clock: () => now, used: 16 });
  check('pacer: 16 a day', !cap.take() && /daily cap/.test(cap.why()), cap.why());

  // ---- Part 2: the browser, with the fixture ----
  const { chromium } = require('playwright');
  const server = http.createServer((q, s) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'overlay.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
    let body = fs.readFileSync(f);
    if (f.endsWith(path.join('mod', 'index.json'))) { const l = JSON.parse(body); if (!l.includes('lidar-stream')) l.push('lidar-stream'); body = JSON.stringify(l); } // scratch switch-on
    s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); s.end(body);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/overlay.html`;
  const b = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', args: process.env.CI ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [], ea = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route(/environment\.data\.gov\.uk/, async route => {
    const u = decodeURIComponent(route.request().url()); ea.push({ u, at: Date.now() });
    const E = u.match(/subset=E\((\d+),(\d+)\)/), N = u.match(/subset=N\((\d+),(\d+)\)/);
    if (!E || !N) return route.fulfill({ status: 400, body: 'fixture: bad request' });
    const e0 = +E[1], e1 = +E[2], n0 = +N[1], n1 = +N[2], dsm = /DSM/.test(u);
    const body = R5.synthTiff(e0, n1, e1 - e0, n1 - n0, (i, j) => { const e = e0 + i + 0.5, n = n1 - j - 0.5; return DTM(e, n) + (dsm ? BUILDING(e, n) : 0); });
    route.fulfill({ status: 200, headers: { 'content-type': 'image/tiff', 'access-control-allow-origin': '*' }, body: Buffer.from(body) });
  });
  await p.goto(`${base}?lat=52.2441634&lon=-1.0453368`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__lidarStream, null, { timeout: 30000 });
  check('module loads, adds its button', (await p.$$eval('#bar button', bs => bs.map(x => x.textContent))).includes('Stream ground'), 'button');
  check('no EA request before arrival', ea.length === 0, `${ea.length}`);
  await p.evaluate(() => window.__lidarStream.useFixture(null, 3000)); // fixture served by route; gap shortened for the test only
  await p.click('#wire'); await p.waitForTimeout(1500);
  await p.evaluate(() => window.SIM.map.jumpTo({ pitch: 60, zoom: 15.2, bearing: 30 }));
  await p.click('#drone'); // arrival
  await p.waitForFunction(() => window.__lidarStream.blocks().some(b => b.kind === 'above-ground'), null, { timeout: 30000 });
  await p.waitForTimeout(1500);
  const bl = await p.evaluate(() => window.__lidarStream.blocks()), rc = await p.evaluate(() => window.__lidarStream.receipt());
  check('two requests: DTM then DSM', ea.length === 2 && /DTM/.test(ea[0].u) && /DSM/.test(ea[1].u), ea.map(x => x.u.slice(0, 120)).join(' | '));
  check('DSM waited the gap after the DTM', ea.length === 2 && ea[1].at - ea[0].at >= 2900, ea.length === 2 ? `${ea[1].at - ea[0].at} ms` : '-');
  check('one 2,048 m box per product', ea.every(x => { const E = x.u.match(/E\((\d+),(\d+)\)/); return E && +E[2] - +E[1] === 2048 && +E[1] % 2048 === 0; }), ea.map(x => (x.u.match(/E\([^)]*\)/) || [''])[0]).join(' '));
  const gr = bl.find(x => x.kind === 'ground'), ab = bl.find(x => x.kind === 'above-ground');
  check('ground wire: 8 m grid over the tile, measured', gr && gr.n === 2 * 256 * 255 && gr.prov === 'measured', JSON.stringify(gr));
  check('above-ground posts: the 40 m block (derived)', ab && ab.prov === 'derived' && ab.n / 5 >= 25 && ab.n / 5 <= 36, JSON.stringify(ab));
  check('anchored near the tile centre (real lat/lon)', gr && Math.abs(gr.lat - 52.25) < 0.03 && Math.abs(gr.lon + 1.05) < 0.03, gr ? `${gr.lat} ${gr.lon}` : '-');
  check('receipt on screen with sha256 and licence', /sha256\(cells\) [0-9a-f]{64}/.test(rc) && /Open Government Licence v3\.0/.test(rc) && /Environment Agency/.test(rc), rc.slice(0, 200));
  check('survey year stated as not read (rule 9)', /pre-construction ground/.test(rc), 'rule 9 words');
  await p.screenshot({ path: path.join(OUT, 'stream-1-drone.png') });
  // Movement never fetches: walk and pan.
  const n0 = ea.length;
  await p.evaluate(() => window.SIM.map.jumpTo({ center: [-1.046, 52.2436], zoom: 17.5, pitch: 72 }));
  await p.keyboard.down('w'); await p.waitForTimeout(1500); await p.keyboard.up('w');
  await p.evaluate(() => window.SIM.map.panBy([300, 0], { duration: 0 })); await p.waitForTimeout(1500);
  check('walking and panning never fetch', ea.length === n0, `${ea.length - n0} new`);
  await p.screenshot({ path: path.join(OUT, 'stream-2-walk.png') });
  // Outside coverage: Scotland (outside the envelope), by the Stream ground button (an arrival).
  await p.evaluate(() => window.SIM.map.jumpTo({ center: [-3.19, 55.95], zoom: 14 })); await p.waitForTimeout(800);
  await p.$$eval('#bar button', bs => bs.find(x => x.textContent === 'Stream ground').click()); await p.waitForTimeout(1500);
  const rc2 = await p.evaluate(() => window.__lidarStream.receipt());
  check('outside coverage says "no measured ground here", no request', /no measured ground here/.test(rc2) && ea.length === n0, rc2.slice(0, 160));
  await p.screenshot({ path: path.join(OUT, 'stream-3-outside.png') });
  // The landing caption (#info) belongs to the overlay; arrival text goes only to this module's receipt panel.
  const inf0 = await p.evaluate(() => (document.getElementById('info') || {}).textContent);
  await p.evaluate(() => window.__lidarStream.arrive('check')); await p.waitForTimeout(300);
  const inf1 = await p.evaluate(() => (document.getElementById('info') || {}).textContent), rc3 = await p.evaluate(() => window.__lidarStream.receipt());
  check('#info unchanged by arrive(); arrival line is the receipt panel first line', inf0 != null && inf1 === inf0 && /^Arrived \(check\): measured ground for tile \d+ E \d+ N streams here; moving never fetches\./.test(rc3) && ea.length === n0, `info "${String(inf1).slice(0, 60)}" | receipt "${rc3.split('\n')[0].slice(0, 90)}"`);
  check('no page errors', errs.length === 0, errs.join(' | ') || 'none');
  await b.close(); server.close();
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  -- ${r.evidence}`);
  const failed = results.filter(r => !r.ok).length; console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
