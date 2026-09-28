// UI check for the menu bar, the site-world tokens and the wire look (mod/menu-style.js, menu-bar.js, wire-look.js).
// Serves prototype/ on a local port. mod/index.json is NOT edited: the server answers it with the shipped list plus the
// UI mods for the chosen stage, so the check runs whether or not the captain has switched them on.
//   node tests/ui.cjs [stage] [outDir]     stage: before | style | menu | wire (default wire)
// Env: UI_LAT, UI_LON (start point; default a 400 kV line), UI_LAUNCHER (a module exporting launch(); default playwright
// Chrome with ANGLE d3d11). Every check prints PASS or FAIL with evidence; exit code 1 on any FAIL.
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'prototype');
const STAGE = process.argv[2] || 'wire', OUT = process.argv[3] || path.join(__dirname, '..', 'test-output', 'ui');
const LAT = process.env.UI_LAT || '52.2441634', LON = process.env.UI_LON || '-1.0453368';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
fs.mkdirSync(OUT, { recursive: true });
function modList() {
  const shipped = JSON.parse(fs.readFileSync(path.join(ROOT, 'mod', 'index.json'), 'utf8')).filter(n => !/^(menu-style|menu-bar|wire-look)$/.test(n));
  if (STAGE === 'before') return shipped;
  const list = ['menu-style', ...shipped];
  if (STAGE === 'menu' || STAGE === 'wire') { if (!list.includes('gpu-rows')) list.push('gpu-rows'); }   // all 22 controls
  if (STAGE === 'wire') list.push('wire-look');
  if (STAGE === 'menu' || STAGE === 'wire') list.push('menu-bar');
  return list;
}
const server = http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'overlay.html';
  if (u === 'mod/index.json') { s.writeHead(200, { 'Content-Type': 'application/json' }); return s.end(JSON.stringify(modList())); }
  const f = path.join(ROOT, u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
});
const results = []; const check = (name, ok, evidence) => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${String(evidence).slice(0, 300)}`); };
async function launch() {
  if (process.env.UI_LAUNCHER) return require(process.env.UI_LAUNCHER).launch();
  const { chromium } = require('playwright');
  return chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
}
// Filled blue anywhere in the page chrome: a background whose blue beats red by 80+ and is not the pale line colour.
const BLUE_SCAN = () => {
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.maplibregl-canvas-container') || el.tagName === 'CANVAS') continue;
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const m = cs.backgroundColor.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/); if (!m) continue;
    const [R, G, B, A] = [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
    if (A > 0.3 && B - R > 80 && B > 120 && R < 120) bad.push((el.id || el.tagName) + ' ' + cs.backgroundColor);
  }
  return bad;
};
async function ready(p) {
  await p.waitForFunction(() => window.SIM && document.querySelector('canvas.maplibregl-canvas'), null, { timeout: 30000 });
  await p.waitForTimeout(7000);
}
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/overlay.html?lat=${LAT}&lon=${LON}`;
  const b = await launch();
  const errs = [];
  // ---- desktop 1920 ----
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } }); p.on('pageerror', e => errs.push(e.message));
  await p.goto(base, { waitUntil: 'load' }); await ready(p);
  check('window.SIM and the map canvas', await p.evaluate(() => !!window.SIM && !!document.querySelector('canvas.maplibregl-canvas')), 'SIM + canvas');
  await p.screenshot({ path: path.join(OUT, `${STAGE}-1920.png`) });
  if (STAGE !== 'before') {
    const blue = await p.evaluate(BLUE_SCAN); check('no blue filled controls (1920)', blue.length === 0, blue.join(' | ') || 'none');
    check('#bar hidden', await p.evaluate(() => getComputedStyle(document.getElementById('bar')).display === 'none'), 'display none');
  }
  if (STAGE === 'menu' || STAGE === 'wire') {
    await p.waitForTimeout(3000);
    const ctl = await p.evaluate(() => window.SIM.menu ? window.SIM.menu.controls() : []);
    const ok = ctl.filter(c => c.found && c.inMenu);
    check('22 controls found, each inside its menu', ok.length === 22, `${ok.length}/22 ` + ctl.filter(c => !c.inMenu).map(c => c.key).join(',') + ' | ' + ctl.map(c => c.menu[0] + ':' + c.label).join(', '));
    // One panel at a time; Escape closes; an outside click closes; Controls opens the help.
    const titles = await p.evaluate(() => window.SIM.menu.titles);
    let one = true, seen = [];
    for (const t of titles) {
      await p.click(`#sim-menu .gm-title[data-menu="${t}"]`); await p.waitForTimeout(120);
      const n = await p.evaluate(() => Array.from(document.querySelectorAll('.gm-panel')).filter(x => !x.hidden).map(x => x.dataset.menu));
      seen.push(t + '=' + n.join('+')); if (n.length !== 1 || n[0] !== t) one = false;
    }
    check('one panel open at a time', one, seen.join(' '));
    await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    check('Escape closes', await p.evaluate(() => window.SIM.menu.openName() === ''), 'open: none');
    await p.click('#sim-menu .gm-title[data-menu="Grid"]'); await p.mouse.click(960, 600); await p.waitForTimeout(100);
    check('outside click closes', await p.evaluate(() => window.SIM.menu.openName() === ''), 'open: none');
    await p.click('#help-toggle'); await p.waitForTimeout(100);
    const help = await p.evaluate(() => ({ open: window.SIM.menu.openName(), text: (document.querySelector('#help #info') || {}).textContent || '' }));
    check('Controls opens the help', help.open === 'Help' && help.text.length > 40, help.open + ' ' + help.text.slice(0, 60));
    await p.keyboard.press('Escape');
    const where = await p.textContent('#where'); check('#where shows the grid reference line', /^[A-Z]{2} \d{4} \d{4} · -?\d+\.\d{6}, -?\d+\.\d{6}/.test(where), where);
    const attr = await p.textContent('#attribution'); check('attribution strip filled', attr.length > 20, attr);
    // Click every control from its menu and record what changed.
    const state = () => p.evaluate(() => ({ blocks: window.SIM.blocks.length, pitch: Math.round(window.SIM.map.getPitch()), zoom: +window.SIM.map.getZoom().toFixed(2),
      layers: (window.SIM.map.getStyle().layers || []).length, c: window.SIM.map.getCenter().lng.toFixed(5) }));
    const clicked = [];
    for (const c of ctl) {
      await p.evaluate(m => window.SIM.menu.open(m), c.menu); await p.waitForTimeout(100);
      const vis = await p.evaluate(k => { const e = window.SIM.menu.element(k); const r = e && e.getBoundingClientRect(); return !!(r && r.width && r.height); }, c.key);
      const s0 = await state(), l0 = await p.evaluate(k => { const e = window.SIM.menu.element(k); return (e.textContent || '').trim() + (e.classList.contains('on') ? '[on]' : ''); }, c.key);
      let how = 'click';
      if (c.key === 'sub-input') { await p.evaluate(k => window.SIM.menu.element(k).focus(), c.key); await p.keyboard.type('go substation 400'); await p.keyboard.press('Enter'); how = 'typed'; }
      else await p.evaluate(k => window.SIM.menu.element(k).click(), c.key);
      await p.waitForTimeout(c.key === 'sat' || c.key === 'dark' || c.key === 'wire' ? 1500 : 900);
      const s1 = await state(), l1 = await p.evaluate(k => { const e = window.SIM.menu.element(k); return (e.textContent || '').trim() + (e.classList.contains('on') ? '[on]' : ''); }, c.key);
      if (c.key === 'fps') { await p.evaluate(() => window.SIM.menu.element('fps').click()); await p.waitForTimeout(300); }   // back out of first person
      const diff = Object.keys(s0).filter(k => s0[k] !== s1[k]).map(k => `${k} ${s0[k]}->${s1[k]}`);
      const changed = l0 !== l1 || diff.length > 0;
      clicked.push({ key: c.key, vis, changed, how, label: `${l0} -> ${l1}`, diff: diff.join(', ') });
    }
    fs.writeFileSync(path.join(OUT, `${STAGE}-clicks.json`), JSON.stringify(clicked, null, 1));
    const reach = clicked.filter(x => x.vis), eff = clicked.filter(x => x.changed);
    check('every control reachable (visible when its menu is open)', reach.length === 22, `${reach.length}/22 ` + clicked.filter(x => !x.vis).map(x => x.key).join(','));
    check('every control shows an effect or label change', eff.length >= 20, `${eff.length}/22; none: ` + clicked.filter(x => !x.changed).map(x => x.key).join(','));
    await p.evaluate(() => window.SIM.menu.close());
    await p.screenshot({ path: path.join(OUT, `${STAGE}-1920-after-clicks.png`) });
  }
  // The two views the owner looks at, for every stage (before and after): the farm by drone, and walking in Wire.
  await p.goto(base, { waitUntil: 'load' }); await ready(p);
  await p.evaluate(() => document.getElementById('drone').click()); await p.waitForTimeout(4000);
  await p.screenshot({ path: path.join(OUT, `${STAGE}-drone-1920.png`) });
  await p.evaluate(() => { document.getElementById('wire').click(); }); await p.waitForTimeout(1500);
  await p.evaluate(() => { const b = document.getElementById('pylons'); if (!b.classList.contains('on')) b.click(); document.getElementById('walk').click(); });
  await p.waitForTimeout(7000);
  await p.screenshot({ path: path.join(OUT, `${STAGE}-walk-wire-1920.png`) });
  if (STAGE === 'wire') {
    const wl = await p.evaluate(() => window.SIM.wireLook ? window.SIM.wireLook.stats() : null);
    check('wire look active with a fade distance', wl && wl.fadeM > 0 && wl.frames > 0 && !wl.err, JSON.stringify(wl));
    check('1 m grid drawn within 30 m', wl && wl.gridOn && wl.minorSegments > 0 && wl.minorRadiusM <= 30, wl && `${wl.minorSegments} minor, ${wl.majorSegments} major segments, radius ${wl.minorRadiusM} m`);
    // The fade, measured: the band just under the horizon with the fade off (1e7 m) against on (the default).
    const band = async () => {
      const png = (await p.screenshot({ clip: { x: 0, y: 324, width: 1920, height: 130 } })).toString('base64');
      return p.evaluate(async b64 => {
        const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + b64; });
        const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, img.width, img.height).data; let s = 0;
        for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return +(s / (d.length / 4) / 3).toFixed(2);
      }, png);
    };
    await p.evaluate(() => window.SIM.wireLook.set({ fadeM: 1e7 })); await p.waitForTimeout(800); const off = await band();
    await p.screenshot({ path: path.join(OUT, `${STAGE}-walk-wire-nofade-1920.png`) });
    await p.evaluate(() => window.SIM.wireLook.set({ fadeM: 0 })); await p.waitForTimeout(800); const onF = await band();
    const lum = { far_band_no_fade: off, far_band_fade: onF };
    check('far lines fade (band under the horizon darker with the fade on)', onF < off * 0.8, JSON.stringify(lum));
  }
  // ---- phone 390 ----
  const q = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); q.on('pageerror', e => errs.push(e.message));
  await q.goto(base, { waitUntil: 'load' }); await ready(q);
  await q.screenshot({ path: path.join(OUT, `${STAGE}-390.png`) });
  if (STAGE !== 'before') {
    const blue = await q.evaluate(BLUE_SCAN); check('no blue filled controls (390)', blue.length === 0, blue.join(' | ') || 'none');
    const over = await q.evaluate(() => document.documentElement.scrollWidth <= innerWidth); check('no sideways scroll at 390', over, 'scrollWidth');
  }
  if (STAGE === 'menu' || STAGE === 'wire') {
    const fit = await q.evaluate(() => { const r = document.querySelector('#sim-menu .gm-views').getBoundingClientRect(); return r.right <= innerWidth + 0.5; });
    check('menu bar fits 390 px', fit, 'views end inside the screen');
    await q.tap('#sim-menu .gm-title[data-menu="Scope"]'); await q.waitForTimeout(200);
    await q.screenshot({ path: path.join(OUT, `${STAGE}-390-scope.png`) });
  }
  check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');
  await b.close(); server.close();
  const bad = results.filter(r => !r.ok).length; console.log(`${results.length - bad}/${results.length} PASS (${STAGE})`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
