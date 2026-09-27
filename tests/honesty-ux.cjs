// Test for mod/honesty-ux.js: the one typed grammar (SIM.command) and the credits strip.
// Serves prototype/ locally and switches the module on in a scratch way: mod/index.json is answered with the
// shipped list plus "honesty-ux" (the file on disk is not changed). PASS or FAIL per check, with evidence.
// Screenshots go to $SHOTS or test-output/honesty-ux/.
const http = require('http'), fs = require('fs'), path = require('path');
// CHROME_GPU_LAUNCHER: path to a shared launcher module exposing launch() (GPU Chrome); plain Playwright without it.
let gpu = null; try { if (process.env.CHROME_GPU_LAUNCHER) gpu = require(process.env.CHROME_GPU_LAUNCHER); } catch (e) { gpu = null; }
const { chromium } = gpu || require('playwright');
// EXTRA_MODS: comma-separated module files from other lanes to switch on in the scratch overlay (served as mod/<name>.js,
// appended to the scratch module list). Used for the grid-reference check, which needs the addresses lane's module.
const EXTRA = (process.env.EXTRA_MODS || '').split(',').filter(Boolean).map(f => ({ f, name: path.basename(f, '.js') }));
const ROOT = path.join(__dirname, '..', 'prototype');
const OUT = process.env.SHOTS || path.join(__dirname, '..', 'test-output', 'honesty-ux');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
fs.mkdirSync(OUT, { recursive: true });
const server = http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '');
  if (u === 'mod/index.json') {
    const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'mod', 'index.json'), 'utf8'));
    for (const m of EXTRA) if (!list.includes(m.name)) list.push(m.name);
    if (!list.includes('honesty-ux')) list.push('honesty-ux');
    s.writeHead(200, { 'Content-Type': 'application/json' }); return s.end(JSON.stringify(list));
  }
  const ex = EXTRA.find(m => u === `mod/${m.name}.js`);
  if (ex) { s.writeHead(200, { 'Content-Type': 'text/javascript' }); return s.end(fs.readFileSync(ex.f)); }
  const f = path.join(ROOT, u || 'overlay.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
});
const results = []; const check = (name, ok, evidence) => results.push({ name, ok: !!ok, evidence: String(evidence).slice(0, 240) });
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/overlay.html`;
  const b = gpu ? await gpu.launch() : await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', args: process.env.CI ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`${base}?lat=52.2441634&lon=-1.0453368`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.SIM && window.SIM.command && document.getElementById('credits'), null, { timeout: 20000 });
  await p.waitForTimeout(6000);
  // 1. The grammar exists and help lists the module verbs and the bar buttons.
  const help = await p.evaluate(() => SIM.command('help'));
  check('help lists commands and buttons', /Commands: .*help.*credits/.test(help) && /Buttons: .*walk/.test(help), help);
  // 2. A bar button is a verb: "pylons" presses it (the button count appears).
  const pr = await p.evaluate(() => SIM.command('pylons')); await p.waitForTimeout(3000);
  const pl = await p.textContent('#pylons');
  check('typed "pylons" presses the Pylons button', /Pressed/.test(pr) && /\(\d+\)/.test(pl), `${pr} -> ${pl}`);
  // 3. A module verb registered at runtime is reached by the same grammar.
  const reg = await p.evaluate(async () => { SIM.registerCommand('echo', r => 'echo:' + r, 'test'); return SIM.command('Echo a b'); });
  check('registered module verb runs with its arguments', reg === 'echo:a b', reg);
  // 4. A line that is no verb and no exact button label goes to the find box unchanged; "Unknown command" only without one.
  const un = await p.evaluate(() => SIM.command('zzz 1'));
  check('non-verb line goes to the find box, not "Unknown"', !/Unknown command/.test(un) && un.length > 0, un);
  const un2 = await p.evaluate(async () => { const f = window.findGo; window.findGo = undefined; try { return await SIM.command('zzz 1'); } finally { window.findGo = f; } });
  check('"Unknown command" only when there is no find box', /Unknown command "zzz"/.test(un2), un2);
  const sr = await p.evaluate(async () => { const on = document.getElementById('rows').className; await SIM.command('solar'); return on === document.getElementById('rows').className; });
  check('"solar" is not taken by the "Solar rows" button (no prefix match)', sr, 'rows button unchanged');
  // 5. The find box takes the grammar: typing "help" there answers in the box; "go" still reaches find-go.
  await p.fill('#fg-in', 'help'); await p.press('#fg-in', 'Enter'); await p.waitForTimeout(500);
  const fm = await p.textContent('#fg-msg');
  check('find box runs "help" through SIM.command', /^Commands:/.test(fm), fm);
  const typeBox = async (t, ms) => { await p.fill('#fg-in', t); await p.press('#fg-in', 'Enter'); await p.waitForTimeout(ms); return p.textContent('#fg-msg'); };
  const offM = (c, lat, lon) => Math.hypot((c.lat - lat) * 111320, (c.lng - lon) * 111320 * Math.cos(lat * Math.PI / 180));
  // Bare grid reference. Reference: pyproj EPSG:27700 -> EPSG:4326 gives 51.489360649, -0.119964729 (computed independently).
  if (EXTRA.some(m => m.name === 'addresses')) {
    await p.evaluate(() => SIM.map.jumpTo({ center: [-1.2, 52.1] }));
    const gm = await typeBox('TQ 30624 78388', 7000), gc = await p.evaluate(() => SIM.map.getCenter()), gd = offM(gc, 51.489360649, -0.119964729);
    check('typed bare "TQ 30624 78388" lands within 50 m', gd < 50, `msg="${gm}" centre ${gd.toFixed(1)} m from the pyproj reference`);
    await p.screenshot({ path: path.join(OUT, '0-gridref-typed.png') });
  } else check('typed bare grid reference (SKIPPED: set EXTRA_MODS to the addresses module)', true, 'skipped, not proven on this run');
  await p.evaluate(() => SIM.map.jumpTo({ center: [-1.0453368, 52.2441634] }));
  const sm = await typeBox('solar', 6000), si = await p.textContent('#info');
  const sb = await p.evaluate(() => SIM.blocks.some(b => b && b.find));
  check('typed "solar" finds a solar asset', sb && /REPD \d+ · solar/.test(si), `msg="${sm}" info="${si}"`);
  await p.screenshot({ path: path.join(OUT, '0b-solar-typed.png') });
  const wm = await typeBox('walk', 1500);
  check('typed "walk" presses Walk', /Pressed "Walk"/.test(wm), wm);
  await p.evaluate(() => SIM.command('drone')); await p.waitForTimeout(1500);
  const hm = await typeBox('help', 500);
  check('typed "help" lists the verbs', /^Commands:.*help.*credits/.test(hm) && /Buttons:.*walk/.test(hm), hm);
  // At a 400 kV substation, with no measured ground drawn: no EA line.
  await p.evaluate(() => { const f = SIM.info; window.__infos = []; SIM.info = (t, ...a) => { window.__infos.push(String(t)); return f.call(SIM, t, ...a); }; });
  await typeBox('go substation 400', 7000); await p.waitForTimeout(3000);
  const k4info = await p.evaluate(() => window.__infos.find(t => /^Substation/.test(t)) || '');
  const k4 = await p.evaluate(() => ({ info: document.getElementById('info').textContent, meas: SIM.blocks.filter(b => b && (b.lidar || b.lidarStream)).length, cr: document.getElementById('credits').textContent }));
  check('at 400 kV with no measured ground drawn: NO EA line', /Substation[^·]*400/.test(k4info) && k4.meas === 0 && !/Environment Agency/.test(k4.cr), `measured blocks ${k4.meas}; landed="${k4info.slice(0, 90)}"; credits="${k4.cr}"`);
  await p.screenshot({ path: path.join(OUT, '5-400kV-no-ea.png') });
  // A synthetic lidarStream-tagged block (fixture, shaped like lane/stream's blocks; no EA request is made).
  await p.evaluate(() => { const c = SIM.map.getCenter(); SIM.addBlock({ lidarStream: 'fixture-tile', lon: c.lng, lat: c.lat, lines: [[-20, 0, 0, 20, 0, 0], [0, -20, 0, 0, 20, 0], [0, 0, 0, 0, 0, 30]] }); SIM.repaint && SIM.repaint(); });
  await p.waitForTimeout(1300);
  const k5 = await p.textContent('#credits');
  check('synthetic lidarStream block: EA OGL line shown', /Environment Agency/.test(k5) && /Open Government Licence v3\.0/.test(k5), k5);
  await p.screenshot({ path: path.join(OUT, '6-lidarstream-fixture-ea.png') });
  await p.evaluate(() => SIM.removeWhere(b => b.lidarStream)); await p.waitForTimeout(1300);
  check('EA line leaves with the lidarStream block', !/Environment Agency/.test(await p.textContent('#credits')), 'removed');
  await p.evaluate(() => SIM.map.jumpTo({ center: [-1.2, 52.1] }));
  await p.fill('#fg-in', 'go 52.2441634,-1.0453368'); await p.press('#fg-in', 'Enter'); await p.waitForTimeout(4000);
  const fm2 = await p.textContent('#fg-msg'), c2g = await p.evaluate(() => SIM.map.getCenter());
  const dm = Math.hypot((c2g.lat - 52.2441634) * 111320, (c2g.lng + 1.0453368) * 111320 * Math.cos(52.24 * Math.PI / 180));
  check('find box still gives "go" to find-go (map flies there)', !/^Commands:|Unknown command/.test(fm2) && dm < 50, `msg="${fm2}" centre ${dm.toFixed(1)} m from target`);
  // 6. Credits: GridAtlas always; no EA line while nothing measured is drawn; EA OGL appears when it is, and survives #info.
  const c0 = await p.textContent('#credits');
  check('credits strip credits GridAtlas', /GridAtlas/.test(c0) && /OpenStreetMap/.test(c0), c0);
  check('no EA credit while no measured ground is drawn', !/Environment Agency/.test(c0), c0);
  await p.screenshot({ path: path.join(OUT, '1-fly-credits.png') });
  // Wait for the map to settle: lidar-onsite clears every lidar-tagged block on moveend when it is switched off.
  await p.evaluate(() => new Promise(r => SIM.map.loaded() && !SIM.map.isMoving() ? r() : SIM.map.once('idle', r)));
  await p.evaluate(() => { SIM.addBlock({ lidar: true, lines: [], lon: 0, lat: 0 }); SIM.info('a module message overwrites #info'); });
  await p.waitForTimeout(1300);
  const c1 = await p.textContent('#credits');
  check('EA OGL credit shown when a LiDAR block is drawn', /Environment Agency/.test(c1) && /Open Government Licence v3\.0/.test(c1), c1);
  check('credit survives a module overwriting #info', /GridAtlas/.test(c1), await p.textContent('#info'));
  await p.evaluate(() => SIM.removeWhere(b => b.lidar)); await p.waitForTimeout(1300);
  const c2 = await p.textContent('#credits');
  check('EA credit leaves when the LiDAR block leaves', !/Environment Agency/.test(c2), c2);
  await p.evaluate(() => SIM.credit('ea-lidar', true)); await p.waitForTimeout(200);
  check('SIM.credit("ea-lidar", true) shows the OGL line', /Open Government Licence v3\.0/.test(await p.textContent('#credits')), 'SIM.credit');
  await p.evaluate(() => SIM.credit('ea-lidar', false)); await p.waitForTimeout(200);
  check('SIM.credit("ea-lidar", false) drops it again', !/Environment Agency/.test(await p.textContent('#credits')), 'SIM.credit off');
  // 7. Walk and fly by typed commands, with screenshots.
  await p.evaluate(() => SIM.command('walk')); await p.waitForTimeout(2000);
  await p.keyboard.down('w'); await p.waitForTimeout(1200); await p.keyboard.up('w'); await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(OUT, '2-walk-typed.png') });
  await p.evaluate(() => SIM.command('drone')); await p.waitForTimeout(2500);
  await p.screenshot({ path: path.join(OUT, '3-drone-typed.png') });
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(OUT, '4-phone.png') });
  check('no page errors', errs.length === 0, errs.join(' | ') || 'none');
  await b.close(); server.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  -- ${r.evidence}`);
  const failed = results.filter(r => !r.ok).length; console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });
