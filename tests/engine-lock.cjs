// Check for mod/engine-lock.js: the site-world block imported BY URL from its release, locked to real coordinates
// (BNG through the overlay's own OSTN15 path, measured ground from the R5 stream), then built in sequence and pulsed.
// The EA is NEVER called: the stream is answered by a synthetic fixture (as tests/lidar-stream.cjs). The engine itself
// is fetched from the site-world release (network needed; a failed import is a FAIL that says so).
// Serves prototype/ on a local port with engine-lock added before menu-bar in a scratch module list (index.json untouched).
//   node tests/engine-lock.cjs [outDir]
// Every check prints PASS or FAIL with evidence; exit code 1 on any FAIL.
const http = require('http'), fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..', 'prototype');
const OUT = process.argv[2] || path.join(__dirname, '..', 'test-output', 'engine-lock');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const LINE = { lat: 52.2441634, lon: -1.0453368 };     // on a mapped 400 kV line (the UI check's default): open land
const DTM = (e, n) => 100 + 0.01 * (e % 2048) + 5 * Math.sin((n % 2048) / 150);
fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (name, ok, evidence) => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${String(evidence).slice(0, 400)}`); };
function modList() {
  const l = JSON.parse(fs.readFileSync(path.join(ROOT, 'mod', 'index.json'), 'utf8')).filter(n => n !== 'engine-lock');
  if (!l.includes('lidar-stream')) l.push('lidar-stream');
  const i = l.indexOf('menu-bar'); if (i >= 0) l.splice(i, 0, 'engine-lock'); else l.push('engine-lock');
  return l;
}
(async () => {
  const R5 = await import(pathToFileURL(path.join(ROOT, 'mod', 'lidar-stream', 'r5.mjs')).href);
  const server = http.createServer((q, s) => {
    const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'overlay.html';
    if (u === 'mod/index.json') { s.writeHead(200, { 'Content-Type': 'application/json' }); return s.end(JSON.stringify(modList())); }
    const f = path.join(ROOT, u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/overlay.html`;
  const { chromium } = require('playwright');
  const b = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', args: process.env.CI ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [], ea = []; let delayMs = 0; p.on('pageerror', e => errs.push(e.message));
  await p.route(/environment\.data\.gov\.uk/, async route => {
    const u = decodeURIComponent(route.request().url()); ea.push(u);
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));   // the "clicked before the ground lands" fixture
    const E = u.match(/subset=E\((\d+),(\d+)\)/), N = u.match(/subset=N\((\d+),(\d+)\)/);
    if (!E || !N) return route.fulfill({ status: 400, body: 'fixture: bad request' });
    const e0 = +E[1], e1 = +E[2], n0 = +N[1], n1 = +N[2];
    const body = R5.synthTiff(e0, n1, e1 - e0, n1 - n0, (i, j) => DTM(e0 + i + 0.5, n1 - j - 0.5));
    route.fulfill({ status: 200, headers: { 'content-type': 'image/tiff', 'access-control-allow-origin': '*' }, body: Buffer.from(body) });
  });
  await p.goto(`${base}?lat=${LINE.lat}&lon=${LINE.lon}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.SIM && window.SIM.engineLock && window.__lidarStream, null, { timeout: 40000 });
  // 1. Menu items, in File and View (not Scope > More).
  const items = await p.evaluate(() => ({ file: [...document.querySelectorAll('.gm-panel[data-menu="File"] button')].map(x => x.textContent.trim()), view: [...document.querySelectorAll('.gm-panel[data-menu="View"] button')].map(x => x.textContent.trim()) }));
  check('File > Build here (animated)', items.file.includes('Build here (animated)'), items.file.join(' | '));
  check('View > Walk a cable', items.view.includes('Walk a cable'), items.view.join(' | '));
  // 2. The engine imports by URL from the site-world release (never copied into this repo).
  const src = await p.evaluate(async () => { try { await window.SIM.engineLock.load(); } catch (e) { return 'ERR ' + e.message; } return window.SIM.engineLock.state().source; });
  check('engine imported by URL from the site-world release', /^https:\/\/globalgrid2050\.com\/solar-design-studio\/2026092\d{5}-site-world\/world\/block-build\.mjs$/.test(src), src);
  check('no engine file copied by this lane (mod/block-build.mjs, engine-lock.js)', !fs.existsSync(path.join(ROOT, 'mod', 'block-build.mjs')) && !/buildBlock\s*=|function buildBlock/.test(fs.readFileSync(path.join(ROOT, 'mod', 'engine-lock.js'), 'utf8')), 'mod/ has no block-build.mjs and engine-lock.js defines no buildBlock (the base carries its own v12 copy under mod/engine/, used by plant.js; not this lane\'s)');
  // 3. Measured ground streams (fixture), then the build at the view centre uses it: every sample measured, ground contact solid.
  await p.evaluate(() => window.__lidarStream.useFixture(null, 1500));
  await p.evaluate(() => document.getElementById('drone').click());
  await p.waitForFunction(() => window.__lidarStream.blocks().some(b => b.kind === 'ground'), null, { timeout: 30000 });
  const centre = await p.evaluate(() => { const P = window.SIM.PF || window.__pf.PF, c = window.SIM.map.getCenter(), g = P.toBng(c.lat, c.lng); return { e: g.e, n: g.n, lat: c.lat, lon: c.lng }; });
  // keep the block inside the streamed tile: anchor 300 m inside its south-west corner
  const tile = R5.tileOf(centre.e, centre.n), E0 = tile.e0 + 300, N0 = tile.n0 + 300;
  const st = await p.evaluate(async ([e, n]) => { const s = await window.SIM.engineLock.build({ e, n, bearingDeg: 0, animate: false }); return s; }, [E0, N0]);
  check('block built: 23 tables, 1,344 DC and 84 AC cables, 28 inverters', st.built && st.routes.dc === 1344 && st.routes.ac === 84 && st.counts.inverters === 364 && st.counts.tables > 5000, JSON.stringify({ routes: st.routes, counts: st.counts }));
  check('every ground sample measured from the stream (none estimated)', st.unmeasured === 0 && st.used.measured > 20000, JSON.stringify(st.used));
  check('provenance styles: ground contact solid, equipment ghost, cables dashed', st.styles.outline === 'solid' && st.styles.tables === 'ghost' && st.styles.dc === 'dashed' && st.styles.ac === 'dashed', JSON.stringify(st.styles));
  check('own layer on the map, static buffers', st.layer, 'engine-lock-wire');
  // 4. LOCK: the pad centre lands where asked (BNG in, OSTN15 out, BNG back), and its level is the fixture's own DTM.
  const fp = await p.evaluate(() => window.SIM.engineLock.footprints());
  const back = await p.evaluate(([lat, lon]) => { const P = window.SIM.PF || window.__pf.PF; return P.toBng(lat, lon); }, [fp.pad.lat, fp.pad.lon]);
  check('pad centre round trip BNG -> OSTN15 lon/lat -> BNG within 0.01 m', Math.hypot(back.e - fp.pad.e, back.n - fp.pad.n) < 0.01, `${(Math.hypot(back.e - fp.pad.e, back.n - fp.pad.n) * 1000).toFixed(2)} mm (${back.engine || 'engine?'})`);
  const truth = DTM(Math.floor(fp.pad.e) + 0.5, Math.floor(fp.pad.n) + 0.5);
  check('pad level = measured DTM at the pad within 0.5 m (the fixture formula is the truth)', fp.pad.measured != null && Math.abs(fp.pad.levelEngine - truth) < 0.5 && Math.abs(fp.pad.measured - truth) < 0.01, `engine ${fp.pad.levelEngine.toFixed(3)} m, stream ${fp.pad.measured && fp.pad.measured.toFixed(3)} m, formula ${truth.toFixed(3)} m, receipt ${fp.pad.receipt}`);
  const st2 = await p.evaluate(async ([e, n]) => window.SIM.engineLock.build({ e, n, bearingDeg: 30, at: 'pad', animate: false }), [E0 + 200, N0 + 200]);
  const fp2 = await p.evaluate(() => window.SIM.engineLock.footprints());
  check('at: pad places the pad centre on the asked point; bearing turns the tables', Math.hypot(fp2.pad.e - (E0 + 200), fp2.pad.n - (N0 + 200)) < 0.01 && Math.abs(fp2.bearingDeg - 30) < 1e-9 && Math.abs(Math.atan2(fp2.tables[0].corners[3].e - fp2.tables[0].corners[0].e, fp2.tables[0].corners[3].n - fp2.tables[0].corners[0].n) * 180 / Math.PI - 30) < 0.01, `pad d ${Math.hypot(fp2.pad.e - (E0 + 200), fp2.pad.n - (N0 + 200)).toFixed(4)} m, table axis ${(Math.atan2(fp2.tables[0].corners[3].e - fp2.tables[0].corners[0].e, fp2.tables[0].corners[3].n - fp2.tables[0].corners[0].n) * 180 / Math.PI).toFixed(3)} deg`);
  // 4b. LOCK BEFORE ANIMATING: Build here clicked before the ground lands (the fixture answers 4 s late). The block is built
  //     at once on estimated ground, the caption says it is waiting, and within 10 s of the tile arriving the block is
  //     re-grounded at the same E, N, bearing: estimated 0, outline solid, MEASURED caption, the sequence not replayed.
  await p.evaluate(() => window.SIM.engineLock.stop());
  const far = R5.tileOf(centre.e + 3 * 2048, centre.n + 2 * 2048);   // a tile nothing has streamed yet
  const farLL = await p.evaluate(([e, n]) => { const P = window.SIM.PF || window.__pf.PF; return P.fromBng(e, n); }, [far.e0 + 1024, far.n0 + 1024]);
  await p.evaluate(([lon, lat]) => window.SIM.map.jumpTo({ center: [lon, lat], zoom: 16.8, pitch: 60 }), [farLL.lon, farLL.lat]);
  await p.waitForTimeout(500); delayMs = 4000; const eaBefore = ea.length;
  await p.evaluate(() => { window.SIM.menu.open('File'); [...document.querySelectorAll('.gm-panel[data-menu="File"] button')].find(x => x.textContent.trim() === 'Build here (animated)').click(); window.SIM.menu.close(); });
  await p.waitForFunction(() => window.SIM.engineLock.state().built, null, { timeout: 15000 });
  const early = await p.evaluate(() => ({ s: window.SIM.engineLock.state(), cap: document.getElementById('engine-lock-caption').textContent }));
  check('delayed fixture: built at once on estimated ground, caption says waiting (R5 gap), outline ghost', early.s.unmeasured > 0 && early.s.styles.outline === 'ghost' && early.s.regrounding && /waiting for measured ground \(R5 gap\)|estimated/.test(early.cap) && !/no measured LiDAR here yet/.test(early.cap), `estimated ${early.s.used.estimated} of ${early.s.used.estimated + early.s.used.measured}, tiles ${JSON.stringify(early.s.tiles)}, "${early.cap.slice(0, 160)}"`);
  await p.waitForFunction(k => { const t = window.__lidarStream.tiles.get(k); return t && t.dtm && !t.dtm.pending && !t.dtm.none; }, far.key, { timeout: 30000 });
  const tArrived = Date.now();
  await p.waitForFunction(() => { const s = window.SIM.engineLock.state(); return s.built && s.unmeasured === 0; }, null, { timeout: 10000 }).catch(() => null);
  const late = await p.evaluate(() => ({ s: window.SIM.engineLock.state(), cap: document.getElementById('engine-lock-caption').textContent }));
  const regroundMs = Date.now() - tArrived;
  check('delayed fixture: re-grounded within 10 s of the tile arriving: estimated 0, outline solid, MEASURED caption, sequence kept its place', late.s.unmeasured === 0 && late.s.styles.outline === 'solid' && late.s.rebuilt >= 1 && regroundMs < 10000 && late.s.seq && late.s.seq.t > 0.05 && Math.abs(late.s.E - early.s.E) < 1e-6 && Math.abs(late.s.N - early.s.N) < 1e-6 && (late.s.seq.done ? /MEASURED/.test(late.cap) : /building:/.test(late.cap)), `${regroundMs} ms after arrival, rebuilt ${late.s.rebuilt}, seq t ${late.s.seq && late.s.seq.t.toFixed(2)}, estimated ${late.s.used.estimated}, EA calls ${ea.length - eaBefore}, "${late.cap.slice(0, 120)}"`);
  delayMs = 0;
  await p.waitForFunction(() => { const s = window.SIM.engineLock.state(); return s.seq && s.seq.done; }, null, { timeout: 30000 });
  const capDone = await p.evaluate(() => document.getElementById('engine-lock-caption').textContent);
  check('delayed fixture: at the end of the sequence the caption says MEASURED and re-grounded', /MEASURED/.test(capDone) && /re-grounded/.test(capDone) && !/no measured LiDAR here yet/.test(capDone), capDone.slice(0, 200));
  await p.screenshot({ path: path.join(OUT, '0-regrounded.png') });
  // 4c. A block straddling a tile edge: both tiles fetched (the neighbour by a stepped arrival), estimated 0.
  await p.evaluate(() => window.SIM.engineLock.stop());
  const eaStraddle = ea.length;
  const st3 = await p.evaluate(async ([e, n]) => window.SIM.engineLock.build({ e, n, bearingDeg: 0, animate: false }), [far.e0 - 100, far.n0 + 300]);
  check('straddle: the block touches two R5 tiles and the far one is estimated at first', st3.tiles.length === 2 && st3.unmeasured > 0 && st3.regrounding, `tiles ${JSON.stringify(st3.tiles)}, estimated ${st3.used.estimated} of ${st3.used.estimated + st3.used.measured}`);
  await p.waitForFunction(() => { const s = window.SIM.engineLock.state(); return s.built && s.unmeasured === 0; }, null, { timeout: 40000 }).catch(() => null);
  const st4 = await p.evaluate(() => ({ s: window.SIM.engineLock.state(), cap: document.getElementById('engine-lock-caption').textContent, centre: window.SIM.map.getCenter() }));
  const west = R5.tileOf(far.e0 - 100, far.n0 + 300);
  const fetched = ea.slice(eaStraddle).map(u => (u.match(/subset=E\((\d+),/) || [])[1]);
  check('straddle: both tiles fetched, estimated 0, both tiles measured, the view never moved', st4.s.unmeasured === 0 && st4.s.tiles.every(t => t.state === 'measured') && fetched.includes(String(west.e0)) && Math.abs(st4.centre.lng - farLL.lon) < 1e-9 && Math.abs(st4.centre.lat - farLL.lat) < 1e-9, `tiles ${JSON.stringify(st4.s.tiles)}, fetched E ${fetched.join(',')}, estimated ${st4.s.used.estimated}, "${st4.cap.slice(0, 120)}"`);
  await p.evaluate(() => window.SIM.engineLock.stop());
  await p.evaluate(([lon, lat]) => window.SIM.map.jumpTo({ center: [lon, lat] }), [centre.lon, centre.lat]);
  await p.waitForTimeout(300);
  // 5. The animated build: File > Build here (animated) plays the sequence (marks prefixes) and then pulses.
  await p.evaluate(() => { window.SIM.map.jumpTo({ pitch: 60, zoom: 16.8 }); window.SIM.menu.open('File'); [...document.querySelectorAll('.gm-panel[data-menu="File"] button')].find(x => x.textContent.trim() === 'Build here (animated)').click(); window.SIM.menu.close(); });
  await p.waitForFunction(() => { const s = window.SIM.engineLock.state(); return s.built && s.seq && s.seq.t > 0.05; }, null, { timeout: 15000 });
  const mid = await p.evaluate(() => window.SIM.engineLock.state()); const midCap = await p.evaluate(() => document.getElementById('engine-lock-caption').textContent);
  check('sequence running from the menu, caption names the item being built', mid.seq && mid.seq.t > 0 && mid.seq.t < 1 && /building: \w+ \d+ of \d+/.test(midCap), `t ${mid.seq && mid.seq.t.toFixed(2)}: "${midCap}"`);
  await p.screenshot({ path: path.join(OUT, '1-building.png') });
  await p.waitForFunction(() => { const s = window.SIM.engineLock.state(); return s.seq && s.seq.done; }, null, { timeout: 30000 });
  await p.waitForTimeout(800);
  const done = await p.evaluate(() => window.SIM.engineLock.state());
  check('sequence complete in about 20 s, then the cable-flow pulses (one dash per route)', done.seq.done && done.pulse === 1344 + 84 + done.routes.mv, `pulse ${done.pulse}, routes ${JSON.stringify(done.routes)}`);
  await p.screenshot({ path: path.join(OUT, '2-pulses.png') });
  // 6. Walk a cable: View item rides an AC cable at eye height; the walker moves along it.
  await p.evaluate(() => { window.SIM.menu.open('View'); [...document.querySelectorAll('.gm-panel[data-menu="View"] button')].find(x => x.textContent.trim() === 'Walk a cable').click(); window.SIM.menu.close(); });
  await p.waitForTimeout(1500); const r1 = await p.evaluate(() => window.SIM.engineLock.state().ride);
  await p.waitForTimeout(2000); const r2 = await p.evaluate(() => window.SIM.engineLock.state().ride);
  const walkOn = await p.evaluate(() => !!(window.walkFps && window.walkFps.state().on));
  check('walk a cable: an AC cable selected, the rider moves along it, first person on', r1 && r2 && /^ST-INV/.test(r1.id) && r2.d - r1.d > 3 && walkOn, `${r1 && r1.id}: ${r1 && r1.d.toFixed(1)} -> ${r2 && r2.d.toFixed(1)} m, walk-fps ${walkOn}`);
  await p.screenshot({ path: path.join(OUT, '3-walk-cable.png') });
  await p.evaluate(() => window.SIM.engineLock.stop());
  // 7. Hygiene: the EA was never called; no page errors; nothing edited outside the two files.
  check('EA never called (fixture answered every request)', ea.every(u => /environment\.data\.gov\.uk/.test(u)) && ea.length >= 1, `${ea.length} routed`);
  check('no page errors', errs.length === 0, errs.join(' | ') || 'none');
  await b.close(); server.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL harness', e); process.exit(1); });
