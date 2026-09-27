// Test for mod/honesty-ux.js: the one typed grammar (SIM.command) and the credits strip.
// Serves prototype/ locally and switches the module on in a scratch way: mod/index.json is answered with the
// shipped list plus "honesty-ux" (the file on disk is not changed). PASS or FAIL per check, with evidence.
// Screenshots go to $SHOTS or test-output/honesty-ux/.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..', 'prototype');
const OUT = process.env.SHOTS || path.join(__dirname, '..', 'test-output', 'honesty-ux');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
fs.mkdirSync(OUT, { recursive: true });
const server = http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '');
  if (u === 'mod/index.json') {
    const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'mod', 'index.json'), 'utf8'));
    if (!list.includes('honesty-ux')) list.push('honesty-ux');
    s.writeHead(200, { 'Content-Type': 'application/json' }); return s.end(JSON.stringify(list));
  }
  const f = path.join(ROOT, u || 'overlay.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
});
const results = []; const check = (name, ok, evidence) => results.push({ name, ok: !!ok, evidence: String(evidence).slice(0, 240) });
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/overlay.html`;
  const b = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', args: process.env.CI ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
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
  // 4. Unknown verbs say so (never silently pass).
  const un = await p.evaluate(() => SIM.command('zzz 1'));
  check('unknown verb is reported', /Unknown command "zzz"/.test(un), un);
  // 5. The find box takes the grammar: typing "help" there answers in the box; "go" still reaches find-go.
  await p.fill('#fg-in', 'help'); await p.press('#fg-in', 'Enter'); await p.waitForTimeout(500);
  const fm = await p.textContent('#fg-msg');
  check('find box runs "help" through SIM.command', /^Commands:/.test(fm), fm);
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
  // 7. Walk and fly by typed commands, with screenshots.
  await p.evaluate(() => SIM.command('walk')); await p.waitForTimeout(2000);
  await p.keyboard.down('w'); await p.waitForTimeout(1200); await p.keyboard.up('w'); await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(OUT, '2-walk-typed.png') });
  await p.evaluate(() => SIM.command('drone')); await p.waitForTimeout(2500);
  await p.screenshot({ path: path.join(OUT, '3-drone-typed-ea-credit.png') });
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(OUT, '4-phone.png') });
  check('no page errors', errs.length === 0, errs.join(' | ') || 'none');
  await b.close(); server.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  -- ${r.evidence}`);
  const failed = results.filter(r => !r.ok).length; console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });
