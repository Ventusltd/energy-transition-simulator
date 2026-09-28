// Plan view check (mod/plan-view.js): View > Plan, the key P and the typed "plan"; north-up and flat; the scale
// bar; zoom into the wireframe (past z17.5 the pitch eases into 3D) and back out (past z16.5 it returns to plan).
// Serves prototype/ on a local port. mod/index.json is NOT edited: the server answers it with the shipped list plus
// plan-view (before menu-bar, which stays last), so the check runs whether or not the captain has switched it on.
//   node tests/plan-view.cjs [outDir]
// Env: UI_LAUNCHER (a module exporting launch(); default playwright Chrome with ANGLE d3d11), SHOTS=1 for the
// review pictures (a solar farm in plan, three frames of the ease at a substation, a 400 kV line in plan).
// Every check prints PASS or FAIL with evidence; exit code 1 on any FAIL.
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'prototype');
const OUT = process.argv[2] || path.join(__dirname, '..', 'test-output', 'plan-view');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const FARM = { lat: 51.33877, lon: 0.91389 };          // REPD 6502 register point (public register)
const LINE = { lat: 52.2441634, lon: -1.0453368 };     // on a mapped 400 kV line (the UI check's default)
const SHOTS = process.env.SHOTS === '1';
fs.mkdirSync(OUT, { recursive: true });
function modList() {
  const l = JSON.parse(fs.readFileSync(path.join(ROOT, 'mod', 'index.json'), 'utf8')).filter(n => n !== 'plan-view');
  const i = l.indexOf('menu-bar'); if (i >= 0) l.splice(i, 0, 'plan-view'); else l.push('plan-view');
  if (!l.includes('gpu-rows')) l.splice(Math.max(0, l.indexOf('plan-view')), 0, 'gpu-rows');
  return l;
}
const server = http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'overlay.html';
  if (u === 'mod/index.json') { s.writeHead(200, { 'Content-Type': 'application/json' }); return s.end(JSON.stringify(modList())); }
  const f = path.join(ROOT, u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
});
const results = []; const check = (name, ok, evidence) => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${String(evidence).slice(0, 400)}`); };
async function launch() {
  if (process.env.UI_LAUNCHER) return require(process.env.UI_LAUNCHER).launch();
  const { chromium } = require('playwright');
  return chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
}
const state = p => p.evaluate(() => window.SIM.plan.state());
async function ready(p) {
  await p.waitForFunction(() => window.SIM && document.querySelector('canvas.maplibregl-canvas') && window.SIM.plan, null, { timeout: 30000 });
  await p.waitForTimeout(6000);
}
const idle = p => p.evaluate(() => new Promise(r => { const m = window.SIM.map; let done = false; const f = () => { if (!done) { done = true; r(); } }; m.once('idle', f); setTimeout(f, 8000); m.triggerRepaint(); }));
const shot = async (p, name) => { if (SHOTS) { await p.screenshot({ path: path.join(OUT, name) }); console.log('shot ' + name); } };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port, url = at => `http://127.0.0.1:${port}/overlay.html?lat=${at.lat}&lon=${at.lon}`;
  const b = await launch(), errs = [];
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } }); p.on('pageerror', e => errs.push(e.message));
  await p.goto(url(FARM), { waitUntil: 'load' }); await ready(p);
  check('window.SIM and the map canvas', await p.evaluate(() => !!window.SIM && !!document.querySelector('canvas.maplibregl-canvas')), 'SIM + canvas');
  const where = await p.evaluate(() => { const el = document.getElementById('plan-view'); const pan = el && el.closest('.gm-panel'); return { found: !!el, menu: pan ? pan.dataset.menu : (el && el.parentElement ? el.parentElement.id : ''), label: el ? el.textContent : '' }; });
  check('View > Plan is in the View menu', where.found && where.menu === 'View', JSON.stringify(where));

  // Rows at the farm (baked GPU rows, local file), so plan has a real drawing to show.
  await p.evaluate(() => { const e = window.SIM.menu && window.SIM.menu.element('gpu-rows'); if (e) e.click(); });
  await p.waitForTimeout(8500);                          // the rows module flies in and turns for about 7.5 s
  await p.evaluate(() => window.SIM.map.jumpTo({ zoom: 14.6, pitch: 55, bearing: -20 })); await p.waitForTimeout(3000);

  // 1. The key P: plan, north-up, flat, dimmed, wire hidden, scale bar.
  await p.mouse.click(800, 600); await p.keyboard.press('p'); await p.waitForTimeout(1500); await idle(p);
  let s = await state(p);
  check('P: plan on, pitch 0 and bearing 0', s.on && Math.abs(s.pitch) < 0.01 && Math.abs(s.bearing) < 0.01, JSON.stringify({ on: s.on, pitch: s.pitch, bearing: s.bearing }));
  check('the scale bar is present', s.scaleBar && s.scaleM > 0 && s.scalePx > 20 && s.scalePx <= 120, `${s.scaleM} m = ${s.scalePx} px`);
  const north = await p.evaluate(() => { const n = document.querySelector('#plan-hud .plan-north'); return !!n && getComputedStyle(document.getElementById('plan-hud')).display !== 'none'; });
  check('the north arrow is present', north, 'svg.plan-north');
  check('imagery dimmed and the 3D wire hidden, not restyled', s.dimmed >= 1 && s.hidden.includes('wire'), JSON.stringify({ dimmed: s.dimmed, hidden: s.hidden }));
  check('the 2D drawing comes from blocks on the map', s.lines > 0, `${s.lines} plan segments, ${s.labels} labels [${Array.from(new Set(s.labelProv)).join(',')}]`);
  const gref = await p.evaluate(() => { const w = document.getElementById('where'); return w ? w.textContent : ''; });
  check('the grid-reference line is kept', /^[A-Z]{2} \d{4} \d{4}/.test(gref), gref);
  await shot(p, '01-farm-6502-plan.png');

  // 2. Typed "plan" in a box toggles it (off, then on again).
  const typed = async () => { await p.evaluate(() => { let i = document.getElementById('plan-test-box'); if (!i) { i = document.createElement('input'); i.id = 'plan-test-box'; i.style.cssText = 'position:fixed;left:300px;top:300px;z-index:50'; document.body.appendChild(i); } i.value = ''; i.focus(); }); await p.keyboard.type('plan'); await p.keyboard.press('Enter'); await p.waitForTimeout(1200); };
  await typed(); const offS = await state(p);
  await typed(); const onS = await state(p);
  await p.evaluate(() => { const i = document.getElementById('plan-test-box'); i.blur(); i.remove(); });
  check('typed "plan" toggles off and on', !offS.on && onS.on && Math.abs(onS.pitch) < 0.01, JSON.stringify({ off: offS.on, on: onS.on, pitch: onS.pitch }));

  // 3. Zoom into the wireframe at the nearest substation: past z17.5 the pitch eases to 60 (sampled mid-ease).
  await p.evaluate(() => window.SIM.map.jumpTo({ zoom: 11.5 })); await p.waitForTimeout(2500); await idle(p);
  const sub = await p.evaluate(() => { const m = window.SIM.map, c = m.getCenter(); let best = null, bd = 1e9;
    for (const f of m.querySourceFeatures('subs')) { if (f.geometry.type !== 'Point') continue; const [x, y] = f.geometry.coordinates, d = (x - c.lng) ** 2 + (y - c.lat) ** 2; if (d < bd) { bd = d; best = [x, y]; } }
    return best; });
  await p.evaluate(at => window.SIM.map.jumpTo(at ? { center: at, zoom: 16.9 } : { zoom: 16.9 }), sub); await p.waitForTimeout(2500); await idle(p);
  await p.evaluate(() => { const e = window.SIM.menu && window.SIM.menu.element('substations'); if (e && !e.classList.contains('on')) e.click(); window.SIM.map.jumpTo({ pitch: 0, bearing: 0 }); });
  await p.waitForTimeout(2500); await idle(p);
  await shot(p, '02-station-plan-z16.9.png');
  await p.evaluate(() => { window.__pz = []; const m = window.SIM.map, t0 = performance.now(); const f = () => { window.__pz.push([Math.round(performance.now() - t0), +m.getPitch().toFixed(1)]); if (performance.now() - t0 < 2500) requestAnimationFrame(f); }; requestAnimationFrame(f); m.zoomTo(18, { duration: 300 }); });
  await p.waitForTimeout(560); await shot(p, '03-ease-frame-1.png');
  await p.waitForTimeout(170); await shot(p, '04-ease-frame-2.png');
  await p.waitForTimeout(1500); await idle(p); await shot(p, '05-ease-frame-3-3d.png');
  s = await state(p); const pz = await p.evaluate(() => window.__pz);
  const mid = pz.filter(([, v]) => v > 1 && v < 59).length, ease = s.eases.filter(e => e.why === 'zoom-in').pop();
  check('zoom-in past z17.5 eases into the 3D wire', s.in3d && Math.abs(s.pitch - 60) < 0.5 && !s.hidden.includes('wire') && mid >= 5 && ease && ease.ms >= 450 && ease.ms <= 1200,
    JSON.stringify({ in3d: s.in3d, pitch: s.pitch, zoom: s.zoom, midFrames: mid, easeMs: ease && ease.ms, sub }));

  // 4. Zoom back out past z16.5: plan again.
  await p.evaluate(() => window.SIM.map.zoomTo(16, { duration: 300 })); await p.waitForTimeout(1800); await idle(p);
  s = await state(p); const back = s.eases.filter(e => e.why === 'zoom-out').pop();
  check('zoom-out past z16.5 returns to plan', s.on && !s.in3d && Math.abs(s.pitch) < 0.01 && Math.abs(s.bearing) < 0.01 && s.scaleBar && !!back,
    JSON.stringify({ on: s.on, in3d: s.in3d, pitch: s.pitch, zoom: s.zoom, easeMs: back && back.ms }));
  await p.keyboard.press('p'); await p.waitForTimeout(1200); s = await state(p);
  check('P again leaves plan and restores the look', !s.on && s.dimmed === 0 && s.hidden.length === 0 && !(await p.evaluate(() => !!window.SIM.map.getLayer('plan-documented'))), JSON.stringify({ on: s.on, pitch: s.pitch }));

  // 5. The 400 kV line in plan (View > Plan clicked from its menu).
  await p.goto(url(LINE), { waitUntil: 'load' }); await ready(p);
  await p.evaluate(() => window.SIM.map.jumpTo({ zoom: 14.2 }));
  await p.evaluate(() => { window.SIM.menu.open('View'); document.getElementById('plan-view').click(); }); await p.waitForTimeout(1500); await idle(p);
  s = await state(p);
  check('View > Plan by click: plan on at the 400 kV line', s.on && Math.abs(s.pitch) < 0.01, JSON.stringify({ on: s.on, pitch: s.pitch, labels: s.labels }));
  const kv = await p.evaluate(() => Array.from(document.querySelectorAll('#plan-labels .plan-label')).map(e => e.textContent).filter(t => /kV line/.test(t)));
  check('the line is labelled with its voltage', kv.some(t => /^400 kV/.test(t)), kv.slice(0, 6).join(' | '));
  await shot(p, '06-400kv-line-plan.png');

  check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');
  await b.close(); server.close();
  const bad = results.filter(r => !r.ok).length; console.log(`${results.length - bad}/${results.length} PASS`); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
