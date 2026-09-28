// Smoke check for prototype/mod/ac-trenches.js v2, with a synthetic fixture (no network, no browser).
// Runs the module's own maths in a VM and checks it against independent numbers:
//  - duct rules against the duct scout's worked values (Southwire jam ratio bands, 40 % fill, clearance; cited, not copied):
//    31.5 mm singles in 125 SDR17 (ID 110.2): J 3.498 'very small', fill 24.5 %, clearance 66.1 mm, cradled;
//    37.4 mm armoured in 96.5/90: J 2.406 'small', clearance 12.4 mm, triangular;
//  - the live duct pick (125 SDR17 at the default OD), the governing bend (duct 2.5 m; the cable MBR governs and flags past it);
//  - trench widths measured back from the drawn quads with WGS84 radii (within 1 cm), layers and width flags;
//  - bend and entry flags recomputed live when the MBR is edited; section geometry (cables inside their duct);
//  - on the REAL data file: 28 routes (or recorded unreached inverters) and 28 holes per station in every case, no names,
//    no drive paths, neutral labels, the private layer never fetched without ?private=1 on a local server.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..'), MOD = path.join(ROOT, 'prototype', 'mod');
const results = []; const check = (name, ok, ev) => results.push({ name, ok: !!ok, ev: String(ev).slice(0, 220) });
const layers = new Map(), sources = new Map();
const map = { on() {}, once() {}, getLayer: id => layers.get(id), addLayer: (l) => layers.set(l.id, l), removeLayer: id => layers.delete(id), getSource: id => sources.get(id),
  addSource: (id, s) => sources.set(id, { ...s, setData(d) { this.data = d; } }), removeSource: id => sources.delete(id), setPaintProperty() {}, getZoom: () => 15, jumpTo() {},
  addControl() {}, removeControl() {}, getBounds: () => ({ contains: () => true }), queryTerrainElevation: () => 0 };
const PF = { placeKey: (lat, lon) => ({ lat, lon }), toLocal: (an, lat, lon) => ({ x: (lon - an.lon) * 69000, y: (lat - an.lat) * 111000 }), toMercator: () => ({ x: 0, y: 0, z: 0 }),
  wireBuffer: (an, lines) => new Float32Array(lines.length * 6) };
let infoText = '', fetched = [];
const win = { SIM: { map, PF, blocks: [], addButton: () => ({ classList: { toggle() {} } }), info(t) { infoText = t; }, repaint() {} } };
const realText = fs.readFileSync(path.join(MOD, 'ac-trenches-6502.json'), 'utf8'), real = JSON.parse(realText);
const el = () => ({ style: {}, dataset: {}, classList: { toggle() {}, add() {} }, append() {}, appendChild() {}, querySelectorAll: () => [], querySelector: () => null, set innerHTML(v) {} });
const ctx = { window: win, document: { currentScript: null, createElement: el, body: { appendChild() {} }, activeElement: null }, location: { search: '', hostname: 'example.org' },
  URLSearchParams, setTimeout, console, performance: { now: () => 0 }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  fetch: async (u) => { fetched.push(String(u)); return { ok: true, json: async () => JSON.parse(realText) }; },
  maplibregl: { ScaleControl: class {}, Marker: class { setLngLat() { return this; } addTo() { return this; } remove() {} } } };
vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(MOD, 'ac-trenches.js'), 'utf8'), ctx);
const A = win.__acTrenches; check('module attaches window.__acTrenches', !!A, typeof A);
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ac-trenches-fixture.json'), 'utf8'));
const near = (a, b, t) => Math.abs(a - b) <= t;

// ---- duct rules against the scout's worked values ----
let c = A.ductCheck(110.2, 31.5);
check('125 SDR17 with 31.5 mm singles: J 3.498 very small, fill 24.5 %, clearance 66.1 mm, cradled', near(c.J, 3.498, 0.001) && c.band === 'very small' && near(c.fill, 0.245, 0.001) && near(c.cl, 66.1, 0.1) && c.config === 'cradled' && c.preferred, `${c.J.toFixed(3)} ${c.band} ${(c.fill * 100).toFixed(1)} ${c.cl.toFixed(1)} ${c.config}`);
c = A.ductCheck(90.0, 37.4);
check('96.5/90 with 37.4 mm armoured: J 2.406 small, clearance 12.4 mm, triangular, fails fill', near(c.J, 2.406, 0.001) && c.band === 'small' && near(c.cl, 12.4, 0.1) && c.config === 'triangular' && !c.pass, `${c.J.toFixed(3)} ${c.band} ${c.cl.toFixed(1)} ${(c.fill * 100).toFixed(1)} %`);
check('jam bands: 2.75 significant, 2.95 moderate, 3.1 small, 3.3 very small', A.jamBand(2.75) === 'significant' && A.jamBand(2.95) === 'moderate' && A.jamBand(3.1) === 'small' && A.jamBand(3.3) === 'very small', [2.75, 2.95, 3.1, 3.3].map(A.jamBand).join(','));
const pk = A.pickDuct(fx.duct_table, 31.5);
check('default OD 31.5 mm picks 125 SDR17 (ID 110.2), the scout default', pk.duct && pk.duct.id === 'emt_c1_125_sdr17', pk.duct && pk.duct.id);
const pk2 = A.pickDuct(fx.duct_table, 36.0);
check('a larger OD (36 mm) re-sizes the duct upward', pk2.duct && pk2.duct.id_mm > 110.2, pk2.duct && pk2.duct.id);
check('US products are never picked', fx.duct_table.filter(t => !t.uk).every(t => t.id !== pk.duct.id && t.id !== (pk2.duct || {}).id), 'uk only');
// ---- governing bend ----
let pp = A.params(fx, 'A');
check('A: governing bend = duct 2.5 m (cable MBR 472 mm), no MBR flag', near(pp.R, 2.5, 1e-9) && pp.governs === 'duct bend' && !pp.mbrFlag, `${pp.R} ${pp.governs}`);
const ppB = A.params(fx, 'B');
check('B: governing bend = catalogue MBR 0.449 m, OD 37.40 mm', near(ppB.R, 0.449, 1e-9) && near(ppB.od, 0.0374, 1e-9), `${ppB.R} ${ppB.od}`);
// ---- widths and layers ----
check('A width n=7 = 7 x 0.125 + 6 x 0.1 + 0.2 = 1.675 m', near(A.width(pp, 7), 1.675, 1e-9), A.width(pp, 7));
check('B width n=7 (21 cables, one diameter clear) = 21 x 0.0374 + 20 x 0.0374 + 0.2 = 1.7334 m', near(A.width(ppB, 7), 1.7334, 1e-9), A.width(ppB, 7));
const l14 = A.layersFor(pp, 14, 1.2);
check('A n=14 in a 1.2 m corridor: 3 layers still 1.225 m, flagged', l14.L === 3 && l14.fault, JSON.stringify(l14));
check('A n=14 in a 2.0 m corridor: 2 layers, 1.675 m', A.layersFor(pp, 14, 2.0).L === 2 && !A.layersFor(pp, 14, 2.0).fault, JSON.stringify(A.layersFor(pp, 14, 2.0)));
// ---- plan quads measured back with WGS84 meridian / prime-vertical radii (an independent metric) ----
const a_ = 6378137, f_ = 1 / 298.257223563, e2 = f_ * (2 - f_);
const mper = lat => { const s = Math.sin(lat * Math.PI / 180) ** 2; return { x: a_ / Math.sqrt(1 - e2 * s) * Math.cos(lat * Math.PI / 180) * Math.PI / 180, y: a_ * (1 - e2) / (1 - e2 * s) ** 1.5 * Math.PI / 180 }; };
for (const [i, s] of [['A', '4'], ['B', '4']]) {
  const g = A.planGeo(fx, i, s), quads = g.trench.features.filter(f => f.properties.kind === 'quad'), P2 = A.params(fx, i);
  let worst = 0; for (const ft of quads) { const q = ft.geometry.coordinates[0], m = mper(q[0][1]), wd = Math.hypot((q[0][0] - q[3][0]) * m.x, (q[0][1] - q[3][1]) * m.y); worst = Math.max(worst, Math.abs(wd - A.width(P2, ft.properties.n, ft.properties.L))); }
  check(`${i}${s}: every drawn quad is its formula width within 1 cm (measured back)`, quads.length >= 3 && worst < 0.01, `${quads.length} quads, worst ${worst.toFixed(4)} m`);
  check(`${i}${s}: 28 holes drawn (7 per side)`, g.holes.features.length === 28, g.holes.features.length);
  check(`${i}${s}: road drawn as centre + two edges; one ducted crossing marked`, g.roads.features.length === 3 && g.cross.features.length === 1, `${g.roads.features.length} ${g.cross.features.length}`);
}
// ---- live bend and entry flags ----
let ev = A.evaluate(fx, 'A', '4');
check('A4 at defaults: 1 bend tighter than 2.5 m, 8 entries short of 1.0 + 2.5 m', ev.bendFlags.length === 1 && ev.entryFlags === 8, `${ev.bendFlags.length} ${ev.entryFlags}`);
check('A4: the n=14 edge in a 1.2 m corridor is flagged (width)', ev.faults === 1, ev.faults);
const evB = A.evaluate(fx, 'B', '4');
check('B4 at defaults: 0 bend flags at 0.449 m, 0 short entries', evB.bendFlags.length === 0 && evB.entryFlags === 0, `${evB.bendFlags.length} ${evB.entryFlags}`);
A.set('A', 31.5, 3500);   // edit the MBR above the duct bend: the cable governs, flags rise (set() also redraws; doc not loaded yet, guarded)
pp = A.params(fx, 'A'); ev = A.evaluate(fx, 'A', '4');
check('A MBR edited to 3500 mm: cable MBR governs, MBR flag on, 2 bend flags', pp.governs === 'cable MBR' && pp.mbrFlag && near(pp.R, 3.5, 1e-9) && ev.bendFlags.length === 2, `${pp.governs} ${pp.R} ${ev.bendFlags.length}`);
A.set('A', 31.5, 472);
// ---- section ----
const sec = A.sectionOf(A.params(fx, 'A'), 7);
const inside = sec.items.every(it => it.cables.every(([x, z]) => Math.hypot(x - it.x, z - it.z) + it.cr <= it.ri + 1e-9));
check('A section: 7 ducts, 21 cables, every cable inside its duct ID', sec.items.length === 7 && sec.items.reduce((t, it) => t + it.cables.length, 0) === 21 && inside, `${sec.items.length} ${inside}`);
check('A section: ducts inside the trench walls', sec.items.every(it => Math.abs(it.x) + it.r <= sec.W / 2 - 0.1 + 1e-9), sec.W);
const secB = A.sectionOf(A.params(fx, 'B'), 7);
check('B section: 21 cables in one flat layer, inside the walls', secB.items.length === 21 && new Set(secB.items.map(i => i.z.toFixed(4))).size === 1 && secB.items.every(it => Math.abs(it.x) + it.r <= secB.W / 2 - 0.1 + 1e-9), secB.items.length);
check('section SVG carries its width', /data-width-m="1.675"/.test(A.sectionSVG(A.params(fx, 'A'), 7)), 'svg');
check('piles: 12 per station (3 x 2 under each of two units)', A.pilesOf(fx.bunds[0], fx.installations.B.piles, fx).length === 12, A.pilesOf(fx.bunds[0], fx.installations.B.piles, fx).length);
const pt = A.partial([[0, 0], [10, 0], [10, 10]], 0.75);
check('partial(): 75 % of a 20 m polyline ends 5 m up the second leg', pt.length === 3 && near(pt[2][1], 5, 1e-9), JSON.stringify(pt));

// ---- the real data file ----
(async () => {
  check('real file: keyed by REPD ref, no name/site field', real.repd === 'REPD 6502' && !('name' in real) && !('site' in real), real.repd);
  check('real file: no drive paths, user paths or imagery URLs', !/[A-Za-z]:[\\/]|Users[\\/]|\.jpg|\.png|arcgisonline|private[\\/]/i.test(realText), 'scan');
  check('real file: neutral labels (never "as built", never a verdict on a site)', !/as[- ]built|non-?compliant|defect|poor(ly)? (built|installed)/i.test(realText), 'scan');
  check('real file: 8 cases (A/B x 1-4 sides)', ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4'].every(k => real.cases[k]), Object.keys(real.cases).join(','));
  const bad = []; let unreached = 0;
  for (const [k, cs] of Object.entries(real.cases)) {
    for (const s of cs.stations) { if (s.routes + s.unreachable !== 28) bad.push(`${k} ${s.id} ${s.routes}+${s.unreachable}`); unreached += s.unreachable; }
    const holes = {}; for (const p of cs.ports) holes[p.si] = (holes[p.si] || 0) + p.nh;
    for (const s of cs.stations) if (holes[s.si] !== 28) bad.push(`${k} ${s.id} holes ${holes[s.si]}`);
    if (cs.stations.length !== 24) bad.push(`${k} stations ${cs.stations.length}`);
  }
  check('real file: every station in every case has 28 inverters routed or recorded unreached, and 28 holes', bad.length === 0, bad.slice(0, 4).join('; ') + ` (unreached recorded: ${unreached})`);
  check('real file: units drawn only where two were seen (class A)', real.bunds.every(b => (b.units_to_draw === 2) === (b.cls === 'A')), real.bunds.map(b => b.cls + b.units_to_draw).join(''));
  check('real file: chain centrelines over rows < 2 m in every case (routes on free ground)', Object.values(real.cases).every(c => c.totals.chain_rows_m < 2), Object.values(real.cases).map(c => c.totals.chain_rows_m).join(','));
  await A.toggle();   // through the stub map: plan layers, 3D wires and the info line, no private fetch
  check('toggle: plan layers added (trench, holes, roads, crossings, bends)', ['act-trench', 'act-holes', 'act-roads', 'act-cross', 'act-bends'].every(id => layers.has(id)), [...layers.keys()].join(','));
  check('toggle: 3D station wires built', A.state().wires.length === 6 && A.state().wires.some(w => w.n > 0), JSON.stringify(A.state().wires));
  check('info line: MODEL, illustrative, derating NOT assessed, no "as built"', /MODEL/.test(infoText) && /illustrative/.test(infoText) && /Derating NOT assessed/.test(infoText) && !/as built/i.test(infoText), infoText.slice(0, 120));
  check('private layer NOT fetched without ?private=1 on a local server', fetched.every(u => !/sld-layer/.test(u)) && !A.state().priv, fetched.join(','));
  await A.select('B', '1');
  check('select B1: piles and units drawn at the focused station', A.state().inst === 'B' && A.state().wires.find(w => w.kind === 'piles').n > 0, JSON.stringify(A.state().wires));
  const pass = results.filter(r => r.ok).length;
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  [${r.ev}]`);
  console.log(`\nac-trenches smoke: ${pass}/${results.length}`); process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
