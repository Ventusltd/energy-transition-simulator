// Smoke check for prototype/mod/farm-assess.js: the pure core only, on a small synthetic fixture. No network.
// Run: node tests/farm-assess.cjs
const A = require('../prototype/mod/farm-assess.js');
let pass = 0, fail = 0;
const ok = (name, c, ev) => { (c ? pass++ : fail++); console.log(`${c ? 'PASS' : 'FAIL'}  ${name}  -- ${ev}`); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// 1. The site box is the R5 tile: 2,048 m on the National Grid lattice.
const b = A.tileBox(412345, 290001);
ok('tile box on 2,048 m lattice', b.e0 === 411648 && b.n0 === 288768 && b.e1 - b.e0 === 2048 && b.key === '411648_288768', JSON.stringify(b));

// 2. Synthetic fixture (Esri rings, outer clockwise, hole counter-clockwise), all in the box above.
const e0 = b.e0, n0 = b.n0, W = 2048;
const sq = (x0, y0, x1, y1, cw = true) => cw ? [[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]] : [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const fixture = [
  { grade: 'Grade 2', rings: [sq(e0 - 500, n0 - 500, e0 + 1024, n0 + W + 500)] },            // west half, overhangs 3 sides
  { grade: 'Grade 3', rings: [sq(e0 + 1024, n0, e0 + W, n0 + 1024), sq(e0 + 1200, n0 + 200, e0 + 1400, n0 + 400, false)] }, // SE quarter minus 200x200 hole
  { grade: 'Grade 4', rings: [sq(e0 + 5000, n0 + 5000, e0 + 6000, n0 + 6000)] }               // wholly outside: ignored
];
const r = A.assessBox(fixture, b);
const get = g => (r.rows.find(x => x.grade === g) || {}).share || 0;
ok('box area 419.43 ha', near(r.boxHa, 419.4304, 1e-3), r.boxHa);
ok('grade 2 share = 50% (clipped to box)', near(get('Grade 2'), 0.5, 1e-9), get('Grade 2'));
ok('grade 3 share = 25% minus hole', near(get('Grade 3'), (1024 * 1024 - 40000) / (W * W), 1e-9), get('Grade 3'));
ok('outside polygon ignored', !r.rows.some(x => x.grade === 'Grade 4'), r.rows.map(x => x.grade).join(','));
const none = r.rows.find(x => /no ALC/.test(x.grade));
ok('uncovered area reported, not filled', none && near(none.share, 0.25 + 40000 / (W * W), 1e-9), none && none.share);
ok('shares sum to 100%', near(r.rows.reduce((s, x) => s + x.share, 0), 1, 1e-9), r.rows.reduce((s, x) => s + x.share, 0));
ok('BMV 1+2 share = grade 2 share', near(r.bmv12Share, 0.5, 1e-9), r.bmv12Share);
ok('clipped vertices all inside box', r.clipped.every(f => f.rings.every(g => g.every(p => p[0] >= b.e0 - 1e-6 && p[0] <= b.e1 + 1e-6 && p[1] >= b.n0 - 1e-6 && p[1] <= b.n1 + 1e-6))), r.clipped.length + ' polygons');

// 3. Negative control: an empty answer gives 100% "no ALC polygon", never a grade.
const e = A.assessBox([], b);
ok('empty answer -> 100% uncovered (negative control)', e.rows.length === 1 && near(e.rows[0].share, 1, 1e-12) && e.bmv12Share === 0, JSON.stringify(e.rows));

// 4. Nearest substation: 1 degree of latitude on the mean sphere is 111,195 m.
const s = A.nearest([{ lat: 53, lon: -1, kv: [132] }, { lat: 52.5, lon: -1, kv: [400] }], 52, -1);
ok('nearest substation picked and distance', s.kv[0] === 400 && near(s.m, 55597.5, 1), `${s.m.toFixed(1)} m ${s.kv}`);
ok('voltage parse "132000;33000" -> [132,33]', JSON.stringify(A.kvList('132000;33000')) === '[132,33]', A.kvList('132000;33000'));

// 5. The query is one bounding-box request in EPSG:27700 to the Natural England service, with the licence stated.
const u = A.queryUrl(b);
ok('query is one bbox in 27700', /geometry=411648%2C288768%2C413696%2C290816/.test(u) && /inSR=27700/.test(u) && /esriGeometryEnvelope/.test(u), u.slice(0, 120));
ok('licence OGL v3 and attribution present', /Open Government Licence v3\.0/.test(A.SRC.licence) && /Natural England/.test(A.SRC.attribution), A.SRC.licence);

const cc = A.centroid([[0, 0], [0, 10], [10, 10], [10, 0], [9, 0], [8, 0], [7, 0]]);
ok('label at area centroid, not vertex average', near(cc[0], 5, 1e-9) && near(cc[1], 5, 1e-9), cc);

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
