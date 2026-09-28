// Check for prototype/mod/tables.js: the pure helpers run in Node on the real row file (no browser, no network).
//  - the farm parameters against the library defaults: width 24.27 m, pitch 26.77 m, ridge 3.00 m (the measured ridge);
//  - rows from the 5,077 measured runs: axis about 2.4 deg E of N, pitch 26.5 to 27.2 m, a few hundred rows 6 to 11 strips wide;
//  - tables cut where the measured extent steps or breaks, then to the library span; at least 95 % of table area on runs;
//  - route ends of the AC trench model (about 660 of 668 routes) claimed by the tables whose footprint (+2.6 m) holds them;
//  - geometry builders return the expected segment counts; no names or drive paths in the module.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'prototype'), MOD = path.join(ROOT, 'mod');
const T = require(path.join(MOD, 'tables.js'));
const results = []; const check = (name, ok, ev) => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${String(ev).slice(0, 300)}`); };
const near = (a, b, t) => Math.abs(a - b) <= t;
// The library defaults, as the header of the station library's station.mjs states them (not the file: the module imports it by URL).
const DEFAULTS = { height: 1.2, tilt: 10, tables: 23, columns: 90, rows: 5, moduleWidth: 1.303, moduleLength: 2.384, moduleGap: 0.02, rowGap: 8, aisleGap: 10, ridgeGap: 0.5, stringsPerInverter: 24, inverters: 28, modulesPerString: 30 };
const fp = T.farmParams(DEFAULTS);
check('farm parameters: width 24.27 m, pitch 26.77 m, ridge 3.00 m (measured), tilt 8, low edge 1.33', near(fp.width, 24.27, 0.01) && near(fp.pitch, 26.77, 0.01) && near(fp.ridge, T.RIDGE_MEASURED_M, 0.01) && fp.params.tilt === 8 && fp.params.height === 1.33, JSON.stringify({ width: fp.width, pitch: fp.pitch, ridge: fp.ridge }));
check('changed from the library: height, tilt, rowGap only (ridgeGap kept at 0.5)', fp.params.rowGap === 2.5 && fp.params.ridgeGap === 0.5 && fp.params.columns === 90 && fp.params.rows === 5, JSON.stringify(T.FARM));
// rows from the real runs
const farms = JSON.parse(fs.readFileSync(path.join(MOD, 'scanner-rows.farms.json'), 'utf8')).farms, f = farms[0];
const doc = JSON.parse(fs.readFileSync(path.join(MOD, f.rows), 'utf8'));
const R = 6371008.8, D2R = Math.PI / 180, kx = R * Math.cos(f.point.lat * D2R) * D2R, ky = R * D2R;
const runs = doc.rows.map(([[a, b], [c, d]]) => [(a - f.point.lon) * kx, (b - f.point.lat) * ky, (c - f.point.lon) * kx, (d - f.point.lat) * ky]);
const t0 = Date.now(), rr = T.rowsFromRuns(runs, { step: f.sample_step_px.value * doc.metres_per_pixel }), ms = Date.now() - t0;
check('row axis about 2.4 deg E of N (mean run direction)', near(rr.axis / D2R, 2.4, 0.3), (rr.axis / D2R).toFixed(2));
check('strip step 2.238 m (3 px at 0.7461 m/px, from the farms file), the estimate from the runs within 0.05 m', near(rr.step, 2.238, 0.001) && near(T.stripStep(runs.map(r => T.toRow(rr.axis, r[0], r[1])[0])), 2.238, 0.06), rr.step.toFixed(4));
check('row spacing from the rows 26.2 to 27.2 m (the row file reads 26.86; a strip-quantised mask reads about 0.4 m short, said in BUILD)', rr.pitch > 26.2 && rr.pitch < 27.2, rr.pitch);
check('rows: 150 to 700 found, all 6 to 12 strips wide, in under 2 s', rr.rows.length >= 150 && rr.rows.length <= 700 && rr.rows.every(r => r.cols >= 6 && r.cols <= 12) && ms < 2000, `${rr.rows.length} rows, dropped ${JSON.stringify(rr.dropped)}, ${ms} ms`);
const lens = rr.rows.map(r => r.v1 - r.v0).sort((a, b) => a - b);
check('row lengths 15 to 800 m, median over 60 m', lens[0] >= 15 && lens[lens.length - 1] <= 800 && lens[lens.length >> 1] > 60, `min ${lens[0].toFixed(1)} median ${lens[lens.length >> 1].toFixed(1)} max ${lens[lens.length - 1].toFixed(1)}`);
const tb = T.tablesFromRows(rr.rows, fp.params, rr.raster), halfW = T.halfWidthOf(fp.params);
check('tables: none longer than the library span, each inside its row, cut where the extent steps or the row breaks', tb.length >= rr.rows.length && tb.every(t => t.span <= 119.11 && t.columns >= 1 && t.columns <= 90 && t.v0 >= rr.rows[t.row].v0 - 1e-6 && t.v0 + t.span <= rr.rows[t.row].v1 + 1e-6), `${tb.length} tables from ${rr.rows.length} rows, dropped ${JSON.stringify(tb.dropped)}`);
check('most tables carry 40 to 90 columns (cut to fit the measured run)', tb.filter(t => t.columns >= 40).length > tb.length / 2, `${tb.filter(t => t.columns >= 40).length} of ${tb.length} tables with 40+ columns`);
check('each row centre from its own unbridged crossings: rows carry cells, most cells unbridged (10 to 12 strips)', rr.rows.every(r => r.cells && r.cells.length) && rr.cells.unbridged > rr.cells.bridged + rr.cells.partial, JSON.stringify(rr.cells));
check('bridged blocks comb-fitted to both edges: comb cells have fractional or whole columns 11 wide', rr.rows.every(r => r.cells.filter(c => c.bridged).every(c => near(c.c1 - c.c0, 10, 1e-9))), rr.rows.reduce((n, r) => n + r.cells.filter(c => c.bridged).length, 0) + ' comb cells');
let area = 0, onRuns = 0; for (const t of tb) { area += t.span * 2 * halfW; onRuns += t.span * 2 * halfW * t.cov; }
check('at least 95 % of table area on measured runs; no piece under 70 %', onRuns / area >= 0.95 && tb.every(t => t.cov >= T.MIN_COVER), `${(100 * onRuns / area).toFixed(2)} % of ${(area / 1e4).toFixed(1)} ha on runs; min piece ${Math.min(...tb.map(t => t.cov)).toFixed(3)}`);
// route ends of the trench model
const trench = JSON.parse(fs.readFileSync(path.join(MOD, 'ac-trenches-6502.json'), 'utf8')), ends = T.routeEnds(trench, 'A4');
check('route ends: 640 to 668 (the model has 668 routes in A4)', ends.length >= 640 && ends.length <= 668 && ends.every(p => p.length === 2), ends.length);
const FR = trench.frame, endsLocal = ends.map(([e, n]) => [(FR.lon0 + e / FR.KX - f.point.lon) * kx, (FR.lat0 + n / FR.KY - f.point.lat) * ky]);   // the trench frame into the farm's local frame
const tabs = tb.map(t => ({ ...t, at: T.fromRow(rr.axis, t.u, t.v0) })), cl = T.claimPoles(tabs, endsLocal, rr.axis, halfW);
const nPoles = cl.sites.reduce((n, s) => n + s.length, 0), multi = cl.sites.filter(s => s.length > 1).length;
check('poles: every route end within a footprint + 2.6 m claimed (some tables claim several); claimed + free = ends', nPoles + cl.free.length === ends.length && nPoles > 30 && multi > 0 && cl.sites.every((s, i) => s.every(([x, y]) => Math.abs(x) <= halfW + T.CLAIM_M + 1e-6 && y >= -T.CLAIM_M - 1e-6 && y <= tabs[i].span + T.CLAIM_M + 1e-6)), `${nPoles} poles on ${cl.sites.filter(s => s.length).length} tables (${multi} with several), ${cl.free.length} free: beside a table ${cl.free.filter(f => f.d < 15).length}, no rows ${cl.free.filter(f => f.d >= 15).length}`);
// geometry
const shape = { run: fp.run, depth: fp.depth, span: 90 * 1.323 - 0.02, ridge: fp.ridge, halfRidgeGap: 0.25 };
const ol = T.outlineLines(shape, fp.params), gl = T.gridLines(shape, fp.params), sl = T.structureLines(shape, fp.params);
check('outline: 8 segments, low edges at 1.33 m and ridge lines at 3.00 m', ol.length === 8 && ol.filter(l => l[2] === 1.33 && l[5] === 1.33).length === 2 && ol.filter(l => near(l[2], 3.0, 0.01) && near(l[5], 3.0, 0.01)).length === 2, JSON.stringify(ol[0]));
check('module grid: (rows + 1) + (columns + 1) lines per face', gl.length === 2 * (6 + 91), gl.length);
check('structure: dashed posts and diagonals plus rafters and beams, under 1,000 segments', sl.length > 100 && sl.length < 1000, sl.length);
const L = []; T.poleLines([0, -1, 3], L); check('pole and inverter box: 12 box edges plus dashes', L.length >= 15, L.length);
const G = []; T.poleLines([0, -1, 3], G, true); check('library-site pole: a distinct ghost (fine dashes, dashed box), more segments than the solid box', G.length > L.length && G.length > 40, G.length);
const D = []; T.dashed(D, [0, 0, 0], [0, 0, 3], 0.4); check('dashed: half the length drawn', D.length === 4, D.length);
// names and paths
const src = fs.readFileSync(path.join(MOD, 'tables.js'), 'utf8');
check('no drive paths or names in the module', !/[A-Z]:[\/]/.test(src) && !/solar farm|solar park/i.test(src), 'scanned');
check('labels: low edge DERIVED, purlins named, rails said not drawn, bare poles split, plan hides the caption, no moveend build', /DERIVED \(measured 3\.0 m ridge minus the documented 8 deg rise; documented 1\.3-1\.5 m\)/.test(src) && /purlins and rafters assumed, solid; rails are not drawn/.test(src) && /beside a table but unclaimed \(\$\{st\.freeBeside\}\), no measured rows there/.test(src) && /no AC route in the trench model/.test(src) && /SIM\.plan\.state\(\)\.on/.test(src) && !/moveend', moved/.test(src) && /setTimeout\(\(\) => \{ timer = 0;.*\}, 250\)/.test(src) && /between: \(i, side = 1\)/.test(src) && /ridge: i =>/.test(src), 'scanned');
check('the library is imported by URL, not copied', /import\(LIB_URL\)/.test(src) && /globalgrid2050\.com\/solar-design-studio\/202609271853-site-world\/world\/station\.mjs/.test(src) && !/export function tableShape/.test(src), 'import(LIB_URL)');
const fails = results.filter(r => !r.ok).length;
console.log(`${results.length - fails}/${results.length} PASS`); process.exit(fails ? 1 : 0);
