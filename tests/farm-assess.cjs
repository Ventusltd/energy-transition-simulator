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

// 6. Honest GRID line (round 2): source, licence and provenance words on screen; voltage reported; never an offer.
const sub = { m: 3130, kv: [33], op: 'UK Power Networks' };
const gd = A.gridText(sub, false), gp = A.gridText(sub, true);
ok('grid line names OSM source and ODbL', gd.includes('GridAtlas substations from OpenStreetMap (© OpenStreetMap contributors, ODbL)'), gd.slice(-90));
ok('voltage marked [reported, as tagged]', gd.includes('33 kV [reported, as tagged]'), gd.slice(0, 120));
ok('distance marked [derived, straight line from map centre]', gd.includes('3.13 km [derived, straight line from map centre]'), gd.slice(0, 80));
ok('warning: private/generator, not a connection point, capacity not assessed', gd.includes('may be a private or generator substation; not a connection point or offer; capacity not assessed'), '');
ok('network operator shown', gd.includes('operator UK Power Networks [reported, as tagged]'), '');
ok('phone line keeps meaning: derived, reported, not an offer, ODbL', /\[derived\]/.test(gp) && /\[reported\]/.test(gp) && /not a connection offer/.test(gp) && /capacity not assessed/.test(gp) && /ODbL/.test(gp) && gp.length < 170, gp.length + ' chars');
const nv = A.gridText({ m: 900, kv: [] }, false), nvp = A.gridText({ m: 900, kv: [] }, true);
ok('no voltage tag -> "voltage not tagged", no kV claimed', nv.includes('voltage not tagged') && nvp.includes('voltage not tagged') && !/kV/.test(nv + nvp), nv.slice(0, 100));
ok('no substations loaded -> says so, no distance', !/km/.test(A.gridText(null, false)) && /not loaded/.test(A.gridText(null, true)), A.gridText(null, false));
ok('operator kept only for network operators', ['UK Power Networks', 'NIE Networks', 'SSEN Transmission', 'Northern Powergrid', 'NPG'].every(o => A.netOperator(o) === o)
  && ['Network Rail', 'RWE Renewables', 'Scottish Power Renewables', 'Humber Gateway OFTO', 'Michelin Tyre PLC', 'Lightsource Renewable Energy', 'Some Farm', ''].every(o => A.netOperator(o) === ''), '');
ok('no operator -> says so, never an OSM name', A.gridText({ m: 900, kv: [33], op: '', name: 'Hill Farm' }, false).includes('no network operator recognised in its tags') && !/Hill Farm/.test(A.gridText({ m: 900, kv: [33], name: 'Hill Farm' }, false)), '');

// 7. Grade 3 wording: none present -> "Grade 3: 0%", never "may include BMV 3a".
const g0 = A.grade3Text({ grade3Share: 0, bmv12Share: 1 }, false), g0p = A.grade3Text({ grade3Share: 0, bmv12Share: 1 }, true);
ok('no grade 3 -> "Grade 3: 0%", no "may include"', g0.includes('Grade 3: 0%') && g0p.includes('Grade 3: 0%') && !/may include|not split/.test(g0 + g0p), g0);
const g3 = A.grade3Text({ grade3Share: 0.25, bmv12Share: 0.5 }, false);
ok('grade 3 present -> 3a/3b caveat kept', g3.includes('25.0% may include BMV 3a') && /Field survey needed/.test(g3), g3);

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
