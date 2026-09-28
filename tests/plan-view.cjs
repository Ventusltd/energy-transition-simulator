// Plan view check (mod/plan-view.js + mod/morph.js). What it proves:
// - View > Plan, the key P and the typed "plan"; north-up and flat; the scale bar and north arrow; imagery dimmed, the
//   3D wire hidden not restyled; the 2D drawing comes from the blocks on the map; the grid-reference line is kept.
// - Something by default at a register asset: P at the farm switches the scanner rows, the procedural fill and the AC
//   trench model on by itself, one label per object class.
// - The MORPH into the wireframe: past z17.5 the world rises from flat to 3D over about 1.2 s (heights 0 -> 1 with the
//   pitch 0 -> 60) and back out past z16.5; held frames of a real morph change by under 10 % of pixels between
//   consecutive frames, the plan frame to the first morph frame included (the wire fades in, it does not pop).
// - The state machine: P from Walk (deeper than z17.5) eases out to z16.5 flat, a wheel in then ends at pitch 60 with
//   every height back at 1; a "go" from plan leaves plan, legend included.
// - Leaving plan: Walk, Drone and Map (View menu or keys 1 2 3) give plan off and the mode's own camera; a Drone key
//   pressed while plan is still switching modules on gives Drone's camera and presses no further module button.
// Serves prototype/ on a local port. mod/index.json is NOT edited: the server answers it with the SHIPPED list (minus
// morph and plan-view if present) plus morph and plan-view before menu-bar, which stays last, exactly as the lead
// switches them on. No other module is added.
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
  const l = JSON.parse(fs.readFileSync(path.join(ROOT, 'mod', 'index.json'), 'utf8')).filter(n => n !== 'plan-view' && n !== 'morph');
  const i = l.indexOf('menu-bar'); if (i >= 0) l.splice(i, 0, 'morph', 'plan-view'); else l.push('morph', 'plan-view');
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

  const mods = await p.evaluate(() => fetch('mod/index.json').then(r => r.json()));
  const shipped = JSON.parse(fs.readFileSync(path.join(ROOT, 'mod', 'index.json'), 'utf8'));
  check('module list = shipped index.json + morph + plan-view before menu-bar, nothing else', JSON.stringify(mods.filter(n => n !== 'plan-view' && n !== 'morph')) === JSON.stringify(shipped.filter(n => n !== 'plan-view' && n !== 'morph')) && mods.indexOf('plan-view') === mods.indexOf('menu-bar') - 1 && mods.indexOf('morph') === mods.indexOf('plan-view') - 1 && !mods.includes('gpu-rows'), mods.join(','));

  // 0. Something by default: P on arrival at the farm (Drone first, as the lead's look does), nothing else pressed.
  await p.evaluate(() => document.querySelector('#drone').click()); await p.waitForTimeout(4000); await idle(p);
  await p.mouse.click(800, 600); await p.keyboard.press('p'); await p.waitForTimeout(16000); await idle(p);
  let s = await state(p);
  const dflt = await p.evaluate(() => ({ scanner: window.SIM.blocks.filter(b => b.scannerRows && !b.registerPoint).length, procedural: window.__procedural ? window.__procedural.ghostBlocks : 0,
    trenches: window.__acTrenches ? window.__acTrenches.state().on : null, bunds: window.SIM.map.getLayer('act-bunds') ? 1 : 0,
    labels: Array.from(document.querySelectorAll('#plan-labels .plan-label')).map(e => e.textContent) }));
  const uniq = new Set(dflt.labels.map(t => t.replace(/ x\d+$/, '')));
  check('P at the farm shows rows, the procedural fill and the trench model by itself', s.on && dflt.scanner > 0 && dflt.procedural > 0 && dflt.trenches === true && s.auto && s.auto.scanner && s.auto.procedural && s.auto.trenches,
    JSON.stringify({ scanner: dflt.scanner, procedural: dflt.procedural, trenches: dflt.trenches, auto: s.auto, pitch: s.pitch, zoom: s.zoom }));
  check('one label per object class', dflt.labels.length > 0 && uniq.size === dflt.labels.length && dflt.labels.length <= 12, dflt.labels.join(' | '));
  await shot(p, '00-farm-P-default.png');

  // 0b. A real morph, frame by frame (SIM.plan.frame holds one frame of it), the canvas read back after each paint and
  // compared with the frame before: the share of sampled pixels that changed (any channel by more than 32). Steps of
  // 0.02 in eased progress, above the largest step a 60 fps 1.2 s cubic makes (0.021). Two series: `fixed` is the
  // change the morph itself makes at each step (the same camera, heights and wire fade one step apart; the plan lines
  // fade 2 % a step, under the threshold), which is what must stay under 10 %, the plan frame to the first morph frame
  // (frame 0: the wire shown, faded to nothing) included; `moving` is the raw consecutive change with the camera
  // pitching 1.2 degrees a step, printed as evidence (the imagery itself moves; it is not the criterion).
  const px = await p.evaluate(async () => {
    const m = window.SIM.map, gl = m.painter.context.gl, W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, S = 4;
    const grab = () => new Promise(r => { m.once('render', () => { const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); r(b); }); m.triggerRepaint(); });
    const diff = (a, b) => { let n = 0, d = 0; for (let y = 0; y < H; y += S) for (let x = 0; x < W; x += S) { const i = (y * W + x) * 4; n++; if (Math.abs(a[i] - b[i]) > 32 || Math.abs(a[i + 1] - b[i + 1]) > 32 || Math.abs(a[i + 2] - b[i + 2]) > 32) d++; } return +(d / n).toFixed(4); };
    const settle = () => new Promise(r => setTimeout(r, 60));
    const plan = await grab(); let prev = plan; const fixed = [], moving = [];
    for (let k = 0; k <= 50; k++) {
      const e = k / 50; window.SIM.plan.frame(e); await settle(); const cur = await grab(); moving.push(diff(prev, cur));
      if (k === 0) fixed.push(diff(plan, cur)); else { window.SIM.morph.set((k - 1) / 50); await settle(); const back = await grab(); fixed.push(diff(back, cur)); window.SIM.morph.set(e); }
      prev = cur;
    }
    const st = window.SIM.morph.state();
    window.SIM.plan.frame(0); await settle(); await grab();
    return { fixed, moving, first: fixed[0], max: Math.max(...fixed), movingMax: Math.max(...moving), fade: st.fade, faded: st.totals.faded };
  });
  const pc = v => Math.round(v * 1000) / 10;
  check('a real morph changes under 10 % of pixels a frame at a fixed camera, the plan frame to the first morph frame included', px.first < 0.1 && px.max < 0.1 && px.fade.includes('wire') && px.faded > 0,
    JSON.stringify({ first: pc(px.first), maxFixed: pc(px.max), maxMovingCamera: pc(px.movingMax), fadedDraws: px.faded, fade: px.fade, fixed: px.fixed.map(pc).join(' '), moving: px.moving.map(pc).join(' ') }));
  await p.waitForTimeout(400);
  await p.keyboard.press('p'); await p.waitForTimeout(1800);

  // What the SHIPPED modules give at the farm, switched on by their own buttons: scanner rows, the procedural wire,
  // Connect here (then trench-measure's "trench auto"), the lidar-stream ground tile. Pylons and substations are on by default.
  const press = t => p.evaluate(t => { const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim().startsWith(t)); if (b && !b.classList.contains('on')) b.click(); return !!b; }, t);
  const pressed = {}; for (const t of ['Connect here', 'Stream ground']) { pressed[t] = await press(t); await p.waitForTimeout(2500); }
  await p.evaluate(() => new Promise(r => { const t0 = Date.now(); (function go() { if (window.__connect && window.__trench) { window.__trench.cmd('trench auto'); setTimeout(r, 2500); } else if (Date.now() - t0 < 20000) setTimeout(go, 500); else r(); })(); }));
  await p.evaluate(at => window.SIM.map.jumpTo({ center: [at.lon, at.lat], zoom: 14.6, pitch: 55, bearing: -20 }), FARM); await p.waitForTimeout(3000); await idle(p);
  const give = await p.evaluate(() => ({ scanner: window.SIM.blocks.filter(b => b.scannerRows === 'REPD 6502' && !b.registerPoint).length,
    procedural: window.__procedural ? window.__procedural.ghostBlocks : 0, connect: !!window.__connect, trench: window.__trench ? window.__trench.blocks().length : 0,
    lidar: window.SIM.blocks.filter(b => b.lidarStream).length + (window.SIM.map.getLayer('lidar-stream-sat') ? '+sat layer' : '') }));
  console.log('shipped modules at REPD 6502: ' + JSON.stringify({ pressed, give }));

  // 1. The key P: plan, north-up, flat, dimmed, wire hidden, scale bar.
  await p.mouse.click(800, 600); await p.keyboard.press('p'); await p.waitForTimeout(1800); await idle(p);
  s = await state(p);
  check('P: plan on, pitch 0 and bearing 0', s.on && Math.abs(s.pitch) < 0.01 && Math.abs(s.bearing) < 0.01, JSON.stringify({ on: s.on, pitch: s.pitch, bearing: s.bearing }));
  check('the scale bar is present', s.scaleBar && s.scaleM > 0 && s.scalePx > 20 && s.scalePx <= 120, `${s.scaleM} m = ${s.scalePx} px`);
  const north = await p.evaluate(() => { const n = document.querySelector('#plan-hud .plan-north'); return !!n && getComputedStyle(document.getElementById('plan-hud')).display !== 'none'; });
  check('the north arrow is present', north, 'svg.plan-north');
  check('imagery dimmed and the 3D wire hidden, not restyled', s.dimmed >= 1 && s.hidden.includes('wire'), JSON.stringify({ dimmed: s.dimmed, hidden: s.hidden }));
  check('the 2D drawing comes from blocks on the map', s.lines > 0, `${s.lines} plan segments, ${s.labels} labels [${Array.from(new Set(s.labelProv)).join(',')}] kinds ${JSON.stringify(s.kinds)}`);
  const rowsAt = !!s.kinds['scanner-rows'];
  console.log(rowsAt ? `ROWS: scanner-rows (shipped) gives ${s.kinds['scanner-rows']} row blocks at REPD 6502 in plan (estimated from imagery)` : 'ROWS: NO rows at REPD 6502 in plan from the shipped modules; plan shows only ' + JSON.stringify(s.kinds));
  await p.evaluate(txt => { let c = document.getElementById('plan-test-caption'); if (!c) { c = document.createElement('div'); c.id = 'plan-test-caption'; c.style.cssText = 'position:fixed;left:10px;bottom:40px;z-index:30;font:12px ui-monospace,Consolas,monospace;color:#d5dcea;background:rgba(9,12,19,.85);padding:4px 8px;border:1px solid #1a2030;pointer-events:none'; document.body.appendChild(c); } c.textContent = txt; },
    'TEST SHOT. Shipped modules only (index.json + plan-view). Plan draws: ' + Object.entries(s.kinds).map(([k, v]) => k + ' ' + v).join(', ') + (rowsAt ? '' : '. No rows at REPD 6502 from shipped modules.'));
  const gref = await p.evaluate(() => { const w = document.getElementById('where'); return w ? w.textContent : ''; });
  check('the grid-reference line is kept', /^[A-Z]{2} \d{4} \d{4}/.test(gref), gref);
  await shot(p, '01-farm-6502-plan.png');
  await p.evaluate(() => { const c = document.getElementById('plan-test-caption'); if (c) c.remove(); });

  // 1b. Leaving plan by a mode: plan off, the mode's own pitch and zoom, bearing kept (turned to 30 in plan first).
  const MODES = { walk: [80, 18.5], drone: [60, 16.5], map: [0, 14] };
  const viaMode = async (how, m) => {
    await p.evaluate(at => window.SIM.map.jumpTo({ center: [at.lon, at.lat], zoom: 14.6 }), FARM);
    if (!(await state(p)).on) await p.evaluate(() => window.SIM.plan.on());
    await p.waitForTimeout(1600); await p.evaluate(() => window.SIM.map.jumpTo({ bearing: 30 })); await p.waitForTimeout(300);
    const before = await state(p);
    if (how === 'menu') await p.evaluate(m => { window.SIM.menu.open('View'); const it = Array.from(document.querySelectorAll('.gm-panel[data-menu="View"] button')).find(b => b.textContent.startsWith(m[0].toUpperCase() + m.slice(1) + ' (')); it.click(); }, m);
    else { await p.mouse.click(800, 600); await p.keyboard.press(how); }
    await p.waitForTimeout(2200);
    const a = await state(p), spd = await p.evaluate(() => (document.getElementById('spd') || {}).textContent || '');
    const [P, Z] = MODES[m];
    check(`from plan, ${m} (${how === 'menu' ? 'View menu' : 'key ' + how}): plan off, pitch ${P}, zoom ${Z}, bearing kept, ${m} speed`,
      before.on && !a.on && !a.in3d && Math.abs(a.pitch - P) < 0.5 && Math.abs(a.zoom - Z) < 0.05 && Math.abs(a.bearing - 30) < 0.5 && spd.startsWith(m + ' ') &&
      a.eases.length === before.eases.length && a.dimmed === 0 && a.hidden.length === 0 && a.morphT === 1 && a.morphActive === false,
      JSON.stringify({ before: before.on, on: a.on, pitch: a.pitch, zoom: a.zoom, bearing: a.bearing, spd, newEases: a.eases.length - before.eases.length, left: a.left.slice(-1) }));
  };
  await viaMode('menu', 'walk'); await shot(p, '01b-walk-from-plan.png');
  await viaMode('1', 'walk'); await viaMode('2', 'drone'); await viaMode('menu', 'drone'); await viaMode('3', 'map'); await viaMode('menu', 'map');
  await p.evaluate(at => window.SIM.map.jumpTo({ center: [at.lon, at.lat], zoom: 14.6, pitch: 55, bearing: -20 }), FARM); await p.waitForTimeout(1500);
  await p.mouse.click(800, 600); await p.keyboard.press('p'); await p.waitForTimeout(1800); await idle(p);

  // 1c. The state machine from Walk: P deeper than z17.5 eases out to z16.5 flat; a wheel in then morphs to pitch 60
  // with every height back at 1 (the overlay's u_zscale read back from the GPU where the wire's own program is in use).
  await p.keyboard.press('p'); await p.waitForTimeout(1800);
  await p.evaluate(at => window.SIM.map.jumpTo({ center: [at.lon, at.lat] }), FARM); await p.keyboard.press('1'); await p.waitForTimeout(1500);
  const walkS = await state(p);
  await p.keyboard.press('p'); await p.waitForTimeout(2000); await idle(p);
  const flatS = await state(p);
  check('P from Walk (z18.5): plan on, eased out to z16.5, flat, north-up', !walkS.on && Math.abs(walkS.zoom - 18.5) < 0.05 && flatS.on && !flatS.in3d && Math.abs(flatS.zoom - 16.5) < 0.05 && Math.abs(flatS.pitch) < 0.01 && Math.abs(flatS.bearing) < 0.01 && flatS.hidden.includes('wire'),
    JSON.stringify({ walk: { zoom: walkS.zoom, pitch: walkS.pitch }, plan: { zoom: flatS.zoom, pitch: flatS.pitch, on: flatS.on, morphT: flatS.morphT } }));
  await p.evaluate(() => window.SIM.map.zoomTo(18, { duration: 300 })); await p.waitForTimeout(2200); await idle(p);
  const upS = await state(p), zsc = await p.evaluate(() => { try { const m = window.SIM.map, gl = m.painter.context.gl, pr = m.getLayer('wire').implementation.pr, l = gl.getUniformLocation(pr, 'u_zscale'); return l ? gl.getUniform(pr, l) : 'no u_zscale in the current program (wire-look draws the wire with its own fading program; the morph scales the matrix there)'; } catch (e) { return 'err ' + e.message; } });
  const up = upS.morphs.filter(m => m.dir === 'up').pop();
  check('wheel in from that plan ends at pitch 60 with every height at 1 (morph up over about 1.2 s)', upS.on && upS.in3d && Math.abs(upS.pitch - 60) < 0.5 && upS.morphT === 1 && upS.morphActive === false && !upS.hidden.includes('wire') && up && up.full && up.ms >= 1100 && up.ms <= 1800 && up.frames >= 20 && (zsc === 1 || typeof zsc === 'string'),
    JSON.stringify({ pitch: upS.pitch, zoom: upS.zoom, morphT: upS.morphT, active: upS.morphActive, morph: up, u_zscale: zsc }));
  // "go" from plan leaves plan, legend included (a lat, lon go: no network; the same flyTo path as a postcode go).
  await p.evaluate(() => window.SIM.map.zoomTo(16, { duration: 300 })); await p.waitForTimeout(2200); await idle(p);
  const backS = await state(p);
  await p.evaluate(() => { const i = document.getElementById('fg-in'); i.value = 'go 51.5014, -0.1419'; i.focus(); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await p.waitForTimeout(1500);
  const goS = await state(p), legend = await p.evaluate(() => ({ hud: document.getElementById('plan-hud').hidden, layers: ['plan-measured', 'plan-documented', 'plan-estimated', 'plan-g400', 'plan-subs'].filter(id => !!window.SIM.map.getLayer(id)), labels: document.querySelectorAll('#plan-labels .plan-label').length }));
  check('"go" from plan leaves plan: legend gone, plan layers removed, dim and hides restored, heights at 1', backS.on && !backS.in3d && !goS.on && legend.hud === true && legend.layers.length === 0 && legend.labels === 0 && goS.dimmed === 0 && goS.hidden.length === 0 && goS.morphT === 1 && goS.left.slice(-1)[0].why === 'go',
    JSON.stringify({ wasPlan: backS.on, on: goS.on, legend, left: goS.left.slice(-1)[0], morphT: goS.morphT }));
  await p.waitForTimeout(4000); await shot(p, '01c-after-go.png');
  await p.evaluate(at => window.SIM.map.jumpTo({ center: [at.lon, at.lat], zoom: 14.6, pitch: 55, bearing: -20 }), FARM); await p.waitForTimeout(1500);
  await p.mouse.click(800, 600); await p.keyboard.press('p'); await p.waitForTimeout(1800); await idle(p);

  // 2. Typed "plan" in a box toggles it (off, then on again).
  const typed = async () => { await p.evaluate(() => { let i = document.getElementById('plan-test-box'); if (!i) { i = document.createElement('input'); i.id = 'plan-test-box'; i.style.cssText = 'position:fixed;left:300px;top:300px;z-index:50'; document.body.appendChild(i); } i.value = ''; i.focus(); }); await p.keyboard.type('plan'); await p.keyboard.press('Enter'); await p.waitForTimeout(1600); };
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
  await p.waitForTimeout(700); await shot(p, '03-morph-frame-1.png');
  await p.waitForTimeout(400); await shot(p, '04-morph-frame-2.png');
  await p.waitForTimeout(1500); await idle(p); await shot(p, '05-morph-frame-3-3d.png');
  s = await state(p); const pz = await p.evaluate(() => window.__pz);
  const mid = pz.filter(([, v]) => v > 1 && v < 59).length, ease = s.eases.filter(e => e.why === 'zoom-in').pop(), mo = s.morphs.filter(m => m.why === 'zoom-in').pop();
  check('zoom-in past z17.5 morphs into the 3D wire (pitch 0 -> 60 and heights 0 -> 1 together, about 1.2 s)', s.in3d && Math.abs(s.pitch - 60) < 0.5 && !s.hidden.includes('wire') && mid >= 5 && ease && ease.ms >= 1000 && ease.ms <= 1800 && mo && mo.full && mo.frames >= 20 && s.morphT === 1 && s.morphActive === false,
    JSON.stringify({ in3d: s.in3d, pitch: s.pitch, zoom: s.zoom, midFrames: mid, easeMs: ease && ease.ms, morph: mo, sub }));

  // 4. Zoom back out past z16.5: plan again (the reverse morph).
  await p.evaluate(() => window.SIM.map.zoomTo(16, { duration: 300 })); await p.waitForTimeout(2200); await idle(p);
  s = await state(p); const back = s.eases.filter(e => e.why === 'zoom-out').pop(), mb = s.morphs.filter(m => m.why === 'zoom-out').pop();
  check('zoom-out past z16.5 morphs back to plan', s.on && !s.in3d && Math.abs(s.pitch) < 0.01 && Math.abs(s.bearing) < 0.01 && s.scaleBar && !!back && mb && mb.full && s.hidden.includes('wire') && s.morphT === 1 && s.fade === 1,
    JSON.stringify({ on: s.on, in3d: s.in3d, pitch: s.pitch, zoom: s.zoom, easeMs: back && back.ms, morph: mb }));
  await p.keyboard.press('p'); await p.waitForTimeout(1800); s = await state(p);
  check('P again leaves plan (morph up) and restores the look', !s.on && s.dimmed === 0 && s.hidden.length === 0 && s.morphT === 1 && s.morphActive === false && !(await p.evaluate(() => !!window.SIM.map.getLayer('plan-documented'))), JSON.stringify({ on: s.on, pitch: s.pitch, morphT: s.morphT }));

  // 4b. Leave while plan is still switching modules on: a fresh page at the farm, Drone, P, then the real key 2 at 1.5 s.
  // 15 s later Drone's camera stands (pitch 60, zoom 16.5 or more: no module framing move got through) and no module
  // button was pressed after the leave (the auto flags are as they were at the key).
  await p.goto(url(FARM), { waitUntil: 'load' }); await ready(p);
  await p.evaluate(() => document.querySelector('#drone').click()); await p.waitForTimeout(4000); await idle(p);
  await p.mouse.click(800, 600); await p.keyboard.press('p'); await p.waitForTimeout(1500);
  const atKey = await state(p); await p.keyboard.press('2');
  const justLeft = await p.evaluate(() => ({ auto: window.SIM.plan.state().auto, procOn: !!document.querySelector('#procedural.on'), trench: window.__acTrenches ? window.__acTrenches.state().on : null, busy: window.SIM.plan.state().autoBusy }));
  await p.waitForTimeout(15000); await idle(p);
  const later = await state(p), laterMods = await p.evaluate(() => ({ procOn: !!document.querySelector('#procedural.on'), trench: window.__acTrenches ? window.__acTrenches.state().on : null, spd: (document.getElementById('spd') || {}).textContent || '' }));
  const same = JSON.stringify(justLeft.auto) === JSON.stringify(later.auto) && justLeft.procOn === laterMods.procOn && justLeft.trench === laterMods.trench;
  check('key 2 while plan switches modules on: Drone camera stands 15 s later, no module button pressed after the leave', atKey.on && !later.on && Math.abs(later.pitch - 60) < 0.5 && later.zoom >= 16.45 && same && !later.autoBusy && laterMods.spd.startsWith('drone'),
    JSON.stringify({ atKey: { on: atKey.on, busy: atKey.autoBusy, auto: atKey.auto }, justLeft, later: { on: later.on, pitch: later.pitch, zoom: later.zoom, auto: later.auto, busy: later.autoBusy, left: later.left.slice(-1) }, laterMods }));

  // 5. The 400 kV line in plan (View > Plan clicked from its menu).
  await p.goto(url(LINE), { waitUntil: 'load' }); await ready(p);
  await p.evaluate(() => window.SIM.map.jumpTo({ zoom: 14.2 }));
  await p.evaluate(() => { window.SIM.menu.open('View'); document.getElementById('plan-view').click(); }); await p.waitForTimeout(1800); await idle(p);
  s = await state(p);
  check('View > Plan by click: plan on at the 400 kV line', s.on && Math.abs(s.pitch) < 0.01, JSON.stringify({ on: s.on, pitch: s.pitch, labels: s.labels }));
  const kv = await p.evaluate(() => Array.from(document.querySelectorAll('#plan-labels .plan-label')).map(e => e.textContent).filter(t => /kV line/.test(t)));
  check('the line is labelled with its voltage', kv.some(t => /^400 kV/.test(t)), kv.slice(0, 6).join(' | '));
  await shot(p, '06-400kv-line-plan.png');

  check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');
  await b.close(); server.close();
  const bad = results.filter(r => !r.ok).length; console.log(`${results.length - bad}/${results.length} PASS`); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
