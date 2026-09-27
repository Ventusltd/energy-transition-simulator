// Checks for prototype/mod/scanner-rows.js against known references. Node only, no network, no browser.
//   node tests/scanner-rows.test.cjs
const path = require('path'), fs = require('fs');
const M = require('../prototype/mod/scanner-rows.js');
const MOD = path.join(__dirname, '..', 'prototype', 'mod');
const farms = JSON.parse(fs.readFileSync(path.join(MOD, 'scanner-rows.farms.json'), 'utf8')).farms;
const results = []; const check = (name, ok, ev) => results.push({ name, ok: !!ok, ev: String(ev) });
const R = 6371008.8, D2R = Math.PI / 180;

// 1. Every farm's rows sit on the farm: the rows' bounding box overlaps the register point.
for (const f of farms) {
  const doc = JSON.parse(fs.readFileSync(path.join(MOD, f.rows), 'utf8'));
  const r = M.checkFarm(f, doc);
  check(`${f.register}: rows' box overlaps the register point`, r.ok, JSON.stringify({ inside: r.inside, distToBboxM: r.distToBboxM, nearestRowM: r.nearestRowM, bboxM: r.bboxM, runs: r.runs }));
  // Negative control: the same rows moved 0.05 deg east (about 3.5 km) must FAIL the check.
  const moved = { rows: doc.rows.map(s => s.map(([lo, la]) => [lo + 0.05, la])) };
  const m = M.checkFarm(f, moved);
  check(`${f.register}: negative control (rows moved 3.5 km) fails`, !m.ok && m.distToBboxM > 1000, `distToBboxM ${m.distToBboxM} m`);
  // Known reference: Web Mercator ground resolution at zoom z = 156543.03392 * cos(lat) / 2^z (m per px).
  const mpp = 156543.03392 * Math.cos(doc.centre[1] * D2R) / 2 ** doc.zoom;
  check(`${f.register}: metres per pixel matches the Web Mercator formula`, Math.abs(mpp - doc.metres_per_pixel) < 1e-4, `${mpp.toFixed(5)} vs ${doc.metres_per_pixel}`);
  // Strips tile without overlap: the across-row spacing of neighbouring runs equals the derived strip width (5 cm).
  const W = M.stripWidthM(f, doc), c = doc.centre, kx = D2R * R * Math.cos(c[1] * D2R), ky = D2R * R;
  const th = doc.row_azimuth_deg_from_east * D2R, ux = Math.cos(th), uy = Math.sin(th), nx = -uy, ny = ux;
  const offs = [...new Set(doc.rows.map(([[lo, la]]) => Math.round((((lo - c[0]) * kx) * nx + ((la - c[1]) * ky) * ny) * 100) / 100))].sort((a, b) => a - b);
  const gaps = []; for (let i = 1; i < offs.length; i++) { const g = offs[i] - offs[i - 1]; if (g > 0.5 && g < 1.5 * W) gaps.push(g); }
  gaps.sort((a, b) => a - b); const med = gaps[gaps.length >> 1];
  check(`${f.register}: neighbouring runs are one strip width apart`, Math.abs(med - W) < 0.05, `median gap ${med && med.toFixed(3)} m vs strip ${W.toFixed(3)} m (${gaps.length} gaps)`);
}

// 2. distToBboxM against a hand reference: 0.001 deg of latitude = R * 0.001 * pi/180 = 111.195 m.
const b = { w: 0, s: 51, e: 0.01, n: 51.001 };
check('distance to box: 0.001 deg north of the box = 111.195 m', Math.abs(M.distToBboxM(b, 51.002, 0.005) - R * 0.001 * D2R) < 0.01, M.distToBboxM(b, 51.002, 0.005).toFixed(3));
check('distance to box: a point inside is 0', M.distToBboxM(b, 51.0005, 0.005) === 0, 'inside');

// 3. Tilted table geometry, exact to 1 cm: a 10 m north-south run and a 10 m east-west run, strip width 2.238 m.
const W = 2.238, rise = W * Math.tan(M.TILT_DEG * D2R);
const ns = M.tableLines(0, 0, 0, 10, W), [lo, hi] = ns;
check('table: 8 lines (2 edges, 2 ends, 4 legs)', ns.length === 8, ns.length);
check('table: low edge length 10 m', Math.abs(Math.hypot(lo[3] - lo[0], lo[4] - lo[1]) - 10) < 0.01, Math.hypot(lo[3] - lo[0], lo[4] - lo[1]));
check('table: plan width = strip width', Math.abs(Math.abs(lo[0] - hi[0]) - W) < 0.01, Math.abs(lo[0] - hi[0]));
check(`table: rise = width x tan(${M.TILT_DEG} deg), low edge ${M.LOW_M} m`, Math.abs(hi[2] - lo[2] - rise) < 0.01 && Math.abs(lo[2] - M.LOW_M) < 1e-9, `${(hi[2] - lo[2]).toFixed(4)} vs ${rise.toFixed(4)}`);
check('table: north-south run faces east (low edge east of high edge)', lo[0] > hi[0], `${lo[0]} > ${hi[0]}`);
const ew = M.tableLines(0, 0, 10, 0, W);
check('table: east-west run faces south (low edge south of high edge)', ew[0][1] < ew[1][1], `${ew[0][1]} < ${ew[1][1]}`);
check('table: legs stand on the ground (z = 0)', ns.slice(4).every(l => l[2] === 0), 'legs');

// 4. Rule R5-9 gate: LiDAR rows only where every DSM and DTM survey is later than the build year.
const G = M.surveyGate;
check('R5-9: survey 2022 under a 2025 build is pre-construction', !G(2025, [2022], [2022]).lidarRows && G(2025, [2022], [2022]).ground === 'pre-construction', G(2025, [2022], [2022]).reason);
check('R5-9: survey in the build year itself is pre-construction ("same as or later")', !G(2024, [2024], [2024]).lidarRows, G(2024, [2024], [2024]).reason);
check('R5-9: surveys 2025 and 2026 after a 2024 build allow LiDAR rows', G(2024, [2025], [2026]).lidarRows, G(2024, [2025], [2026]).reason);
check('R5-9: one early year among later ones blocks LiDAR rows', !G(2021, [2022, 2019], [2022]).lidarRows, G(2021, [2022, 2019], [2022]).reason);
check('R5-9: unknown build year blocks LiDAR rows', !G(null, [2025], [2025]).lidarRows, G(null, [2025], [2025]).reason);
check('R5-9: missing DTM year blocks LiDAR rows', !G(2020, [2025], []).lidarRows, G(2020, [2025], []).reason);
for (const f of farms) {
  const doc = JSON.parse(fs.readFileSync(path.join(MOD, f.rows), 'utf8')), a = M.rowsAllowed(f, doc);
  check(`${f.register}: every farm carries build year, survey years and imagery capture, each tagged`,
    f.build_year && f.build_year.tag && f.lidar_survey_years && f.lidar_survey_years.tag && f.imagery && f.imagery.capture_date && f.imagery.tag, JSON.stringify({ b: f.build_year && f.build_year.value, s: f.lidar_survey_years, i: f.imagery && f.imagery.capture_date }));
  check(`${f.register}: row file is imagery, drawn and labelled estimated`, a.source === 'imagery' && a.allowed && /estimated/i.test(doc.estimate || ''), `${a.source}, ${a.reason}`);
  // Negative control: the same rows claimed as a LiDAR DSM scan must be REFUSED where the survey predates the build.
  const lid = Object.assign({}, doc, { source: 'EA LiDAR composite DSM', method: 'DSM minus DTM height mask' }), b = M.rowsAllowed(f, lid);
  const pre = f.lidar_survey_years.dsm.concat(f.lidar_survey_years.dtm).some(y => y <= f.build_year.value);
  check(`${f.register}: LiDAR-claimed rows ${pre ? 'refused' : 'allowed'} by R5-9`, b.source === 'lidar' && b.allowed === !pre, `${b.source}, allowed ${b.allowed}: ${b.reason}`);
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  -- ${r.ev}`);
const failed = results.filter(r => !r.ok).length; console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
