// Smoke check for prototype/mod/ac-trenches.js, with a synthetic fixture (no network, no browser).
// Runs the module's own section and plan maths in a VM, then measures the drawn quads back with WGS84 radii (an
// independent metric), and checks the section numbers against the owner design page's table for one bus bar
// (14 groups, one core per 96.5 mm duct in trefoil, 100 mm gap, 100 mm margins: 4.20 m wide; cover 0.670 m).
// Also checks the real data file: keyed by REPD ref, no name field, every variant's checks recorded.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..'), MOD = path.join(ROOT, 'prototype', 'mod');
const results = []; const check = (name, ok, ev) => results.push({ name, ok: !!ok, ev: String(ev).slice(0, 200) });
const win = { SIM: { map: { on() {} }, blocks: [], addButton: () => ({ classList: { toggle() {} } }), info() {}, repaint() {} } };
const ctx = { window: win, document: { currentScript: null }, setTimeout, console, fetch: null, maplibregl: {} };
vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(MOD, 'ac-trenches.js'), 'utf8'), ctx);
const A = win.__acTrenches; check('module attaches window.__acTrenches', !!A, typeof A);
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ac-trenches-fixture.json'), 'utf8'));
const S = A.section(fx);
const w14 = S.width(14), w28 = S.width(28);
check('width n=14 = 14 x 0.193 + 13 x 0.1 + 0.2 = 4.202 m (owner table 4.20 m)', Math.abs(w14 - 4.202) < 0.01, w14.toFixed(4));
check('width n=28 = 8.304 m (owner table 8.30 m)', Math.abs(w28 - 8.304) < 0.01, w28.toFixed(4));
check('cover at the 0.9 m floor = 0.670 m, below 0.91 m', Math.abs(S.cover - 0.670) < 0.001 && S.cover < 0.91, S.cover.toFixed(4));
const d14 = S.ducts(14);
check('14 groups draw 42 ducts', d14.length === 42, d14.length);
check('ducts sit inside the trench walls', d14.every(([x]) => Math.abs(x) + S.D / 2 <= w14 / 2 - S.mg + 1e-9), 'x range ' + Math.min(...d14.map(d => d[0])).toFixed(3) + '..' + Math.max(...d14.map(d => d[0])).toFixed(3));
check('ducts sit on the 50 mm bed above the 0.9 m floor', Math.abs(Math.min(...d14.map(d => d[1])) - (-0.9 + 0.05 + S.D / 2)) < 1e-9, Math.min(...d14.map(d => d[1])).toFixed(4));
// the quads, measured back with WGS84 meridian / prime-vertical radii
const g = A.planGeo(fx, 'T', '1');
const a = 6378137, f = 1 / 298.257223563, e2 = f * (2 - f);
const mper = lat => { const s = Math.sin(lat * Math.PI / 180) ** 2; return { x: a / Math.sqrt(1 - e2 * s) * Math.cos(lat * Math.PI / 180) * Math.PI / 180, y: a * (1 - e2) / (1 - e2 * s) ** 1.5 * Math.PI / 180 }; };
for (const ft of g.trench.features) {
  const c = ft.geometry.coordinates[0], m = mper(c[0][1]), wd = Math.hypot((c[0][0] - c[3][0]) * m.x, (c[0][1] - c[3][1]) * m.y);
  check(`quad for n=${ft.properties.n} is ${S.width(ft.properties.n).toFixed(3)} m wide on the ground (within 1 cm)`, Math.abs(wd - S.width(ft.properties.n)) < 0.01, wd.toFixed(4));
}
// the real data file
const real = JSON.parse(fs.readFileSync(path.join(MOD, 'ac-trenches-6502.json'), 'utf8'));
check('data keyed by REPD ref', real.ref === 'REPD 6502', real.ref);
check('data carries no name field', !('name' in real) && !JSON.stringify(real).match(/"name"\s*:/), 'keys: ' + Object.keys(real).join(','));
check('no project-name words in the data or module', !/solar farm|solar park/i.test(JSON.stringify(real) + fs.readFileSync(path.join(MOD, 'ac-trenches.js'), 'utf8')), 'scanned');
for (const [dk, D] of Object.entries(real.designs)) for (const [vk, V] of Object.entries(D.variants)) {
  const c = V.checks;
  check(`design ${dk} sides ${vk}: cables conserved, counts rebuilt equal, node balance, width formula`, c.cables_conserved && c.segment_counts_mismatch === 0 && c.node_balance_violations === 0 && c.width_within_1cm, JSON.stringify(c));
  const w = Math.max(...V.counts.map(([, n]) => S.width(n)));
  check(`design ${dk} sides ${vk}: widest drawn = recorded widest (${V.totals.widest_m} m)`, Math.abs(w - V.totals.widest_m) < 0.01, w.toFixed(3));
}
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  -- ${r.ev}`);
const failed = results.filter(r => !r.ok).length; console.log(`\n${results.length - failed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
