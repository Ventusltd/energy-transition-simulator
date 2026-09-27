// Test for mod/menu-bar.js: the minimal site-world look. Every control in the button row is re-parented into the
// dash (Walk, Drone, Build here, Satellite, Wire) or into one menu: nothing lost, nothing duplicated, all reachable.
// Serves prototype/ locally and switches the modules on in a scratch way: mod/index.json is answered with the shipped
// list plus "honesty-ux" (run A), and plus "honesty-ux" and "menu-bar" (run B). The file on disk is not changed.
// Screenshots go to $SHOTS or test-output/menu-bar/.
const http = require('http'), fs = require('fs'), path = require('path');
// CHROME_GPU_LAUNCHER: path to a shared launcher module exposing launch() (GPU Chrome); plain Playwright without it.
let gpu = null; try { if (process.env.CHROME_GPU_LAUNCHER) gpu = require(process.env.CHROME_GPU_LAUNCHER); } catch (e) { gpu = null; }
const { chromium } = gpu || require('playwright');
const ROOT = path.join(__dirname, '..', 'prototype');
const OUT = process.env.SHOTS || path.join(__dirname, '..', 'test-output', 'menu-bar');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
fs.mkdirSync(OUT, { recursive: true });
let EXTRA = [];
const server = http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '');
  if (u === 'mod/index.json') {
    const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'mod', 'index.json'), 'utf8'));
    for (const m of EXTRA) if (!list.includes(m)) list.push(m);
    s.writeHead(200, { 'Content-Type': 'application/json' }); return s.end(JSON.stringify(list));
  }
  const f = path.join(ROOT, u || 'overlay.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
});
const results = []; const check = (name, ok, evidence) => results.push({ name, ok: !!ok, evidence: String(evidence).slice(0, 400) });
const norm = t => t.replace(/\(.*?\)/g, '').trim().toLowerCase();
const URL_Q = '?lat=52.2441634&lon=-1.0453368';
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/overlay.html${URL_Q}`;
  const b = gpu ? await gpu.launch() : await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', args: process.env.CI ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const settle = async p => { await p.waitForFunction(() => window.SIM && window.SIM.command, null, { timeout: 20000 }); await p.waitForTimeout(9000); };
  // Run A: without the menu bar. Every clickable control in the row, by label.
  EXTRA = ['honesty-ux'];
  const pa = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await pa.goto(base, { waitUntil: 'load' }); await settle(pa);
  const before = await pa.evaluate(() => Array.from(document.querySelectorAll('#bar button, #bar input')).map(e => (e.textContent || e.placeholder || '').trim()));
  await pa.screenshot({ path: path.join(OUT, '0-before-desktop.png') });
  await pa.close();
  // Run B: with the menu bar.
  EXTRA = ['honesty-ux', 'menu-bar'];
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(base, { waitUntil: 'load' }); await settle(p);
  const gl = await p.evaluate(() => { const c = document.createElement('canvas').getContext('webgl'); const d = c && c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  check('renderer', true, gl);
  const all = await p.evaluate(() => SIM.menuBar.where()), where = all.filter(w => w.tag !== 'span');  // readouts (#spd) move too but are not clickable
  check('the speed readout moved with the controls (VIEW)', all.some(w => w.id === 'spd' && w.menu === 'View'), JSON.stringify(all.filter(w => w.tag === 'span')));
  const left = await p.evaluate(() => document.querySelectorAll('#bar button, #bar input').length);
  const bs = before.map(norm).sort(), as = where.map(w => norm(w.label)).sort();
  check('count before (row) equals count reachable after (dash + menus)', before.length === where.length && JSON.stringify(bs) === JSON.stringify(as) && left === 0,
    `before ${before.length}, after ${where.length}, left in the row ${left}; missing [${bs.filter(x => !as.includes(x))}] extra [${as.filter(x => !bs.includes(x))}]`);
  const dupes = await p.evaluate(() => { const seen = new Set(); let d = 0; for (const e of document.querySelectorAll('[data-sim-moved]')) { if (seen.has(e)) d++; seen.add(e); } return d + Array.from(document.querySelectorAll('button')).filter(e => e.id && document.querySelectorAll('#' + CSS.escape(e.id)).length > 1).length; });
  check('no control duplicated (each element once, ids unique)', dupes === 0, `duplicates ${dupes}`);
  const dash = where.filter(w => w.menu === 'Dash').map(w => w.label);
  check('the five visible text buttons are Walk, Drone, Build here, Satellite, Wire', JSON.stringify(dash) === JSON.stringify(['Walk', 'Drone', 'Build here', 'Satellite', 'Wire']), dash.join(' | '));
  check('the old button row is hidden', await p.evaluate(() => getComputedStyle(document.getElementById('bar')).display === 'none'), 'display none');
  // Reachable: open each menu by clicking its title, and every control placed there is visible and clickable.
  const unreach = [];
  for (const m of ['File', 'Edit', 'View', 'Scope', 'Grid', 'About']) {
    await p.click(`#sim-menu .mb-t[data-menu="${m}"]`); await p.waitForTimeout(150);
    const r = await p.evaluate(m => Array.from(document.querySelectorAll(`[data-sim-moved="${m}"]`)).filter(e => { const q = e.getBoundingClientRect(); if (!q.width || !q.height) return true; const at = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return !(at === e || e.contains(at)); }).map(e => e.textContent || e.placeholder), m);
    unreach.push(...r);
    if (m === 'Scope') await p.screenshot({ path: path.join(OUT, '2-desktop-scope-open.png') });
    await p.keyboard.press('Escape');
  }
  check('every moved control is visible and on top when its menu is open', unreach.length === 0, unreach.join(' | ') || 'all reachable');
  // A menu item keeps its own handler: SCOPE > Dark switches the basemap, then Satellite (dash) switches it back.
  await p.click('#sim-menu .mb-t[data-menu="Scope"]'); await p.click('#dark'); await p.waitForTimeout(1500);
  const darkOn = await p.evaluate(() => document.getElementById('dark').classList.contains('on'));
  await p.click('#sat'); await p.waitForTimeout(2500);
  check('a menu item runs its original handler (Scope > Dark, then Satellite)', darkOn && await p.evaluate(() => document.getElementById('sat').classList.contains('on')), `dark on ${darkOn}`);
  // SIM.command still presses a hidden button by its exact label, and "go repd 6502" still reaches find-go.
  const typeBox = async (t, ms) => { await p.fill('#fg-in', t); await p.press('#fg-in', 'Enter'); await p.waitForTimeout(ms); return p.textContent('#fg-msg'); };
  const gm = await typeBox('go repd 6502', 6000), gi = await p.textContent('#info'), gc = await p.evaluate(() => SIM.map.getCenter());
  check('typed "go repd 6502" still works', /6502/.test(gm + gi) && !/Unknown command/.test(gm), `msg="${gm}" info="${gi.slice(0, 120)}" centre ${gc.lat.toFixed(5)},${gc.lng.toFixed(5)}`);
  await p.screenshot({ path: path.join(OUT, '1-desktop-repd-6502.png') });
  const wm = await typeBox('walk', 2000);
  check('typed "walk" presses the Walk button', /Pressed "Walk"/.test(wm), wm);
  await p.keyboard.down('w'); await p.waitForTimeout(1200); await p.keyboard.up('w'); await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(OUT, '3-desktop-walk.png') });
  const tm = await p.evaluate(() => SIM.command('survey')); await p.waitForTimeout(800);
  check('typed "survey" presses a button hidden inside a closed menu', /Pressed "Survey"/.test(tm) && await p.evaluate(() => document.getElementById('survey').classList.contains('on')), tm);
  await p.evaluate(() => SIM.command('drone')); await p.waitForTimeout(2500);
  await p.screenshot({ path: path.join(OUT, '4-desktop-drone.png') });
  // No control covers the credits strip (desktop and phone).
  const cover = () => p.evaluate(() => { const s = document.getElementById('credits'); if (!s) return 'no strip'; const c = s.getBoundingClientRect(); const bad = [];
    for (const e of document.querySelectorAll('#sim-menu button, .mb-panel.open > *, #joy, #fg, #info, #design-box')) { const r = e.getBoundingClientRect(); if (!r.width || getComputedStyle(e).display === 'none') continue;
      if (r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top) bad.push((e.id || e.textContent || '').slice(0, 30)); } return bad.join(' | '); });
  const cd = await cover(); check('desktop: no control covers the credits strip', cd === '', cd || 'clear');
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(1500);
  await p.evaluate(() => SIM.command('satellite')); await p.waitForTimeout(3000);
  const cp = await cover(); check('phone 390 px: no control covers the credits strip', cp === '', cp || 'clear');
  const fits = await p.evaluate(() => document.getElementById('sim-menu').scrollWidth <= innerWidth && document.documentElement.scrollWidth <= innerWidth);
  check('phone 390 px: the bar fits, no sideways scroll', fits, 'scrollWidth checked');
  await p.screenshot({ path: path.join(OUT, '5-phone.png') });
  await p.click('#sim-menu .mb-t[data-menu="Grid"]'); await p.waitForTimeout(200);
  await p.screenshot({ path: path.join(OUT, '6-phone-grid-open.png') });
  check('no page errors', errs.length === 0, errs.join(' | ') || 'none');
  fs.writeFileSync(path.join(OUT, 'where.json'), JSON.stringify({ before, where: all }, null, 1));
  await b.close(); server.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  -- ${r.evidence}`);
  const failed = results.filter(r => !r.ok).length; console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });
