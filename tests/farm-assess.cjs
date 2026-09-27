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

// 8. Round 3: the box is centred on arrival, edges on the 256 m BNG lattice, 2,048 m square.
const T = (name, f) => { let c = false, ev = ''; try { [c, ev] = f(); } catch (x) { ev = 'threw: ' + x.message; } ok(name, c, ev); };
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pts = Array.from({ length: 2000 }, () => [100000 + rnd() * 500000, 100000 + rnd() * 800000]);
T('(a) centre >= 896 m from every box edge (2,000 random points, and cell corners)', () => {
  let worst = Infinity; for (const [e, n] of pts.concat([[412416 + 128, 290048 - 128], [412416 - 127.999, 290048 + 127.999]])) worst = Math.min(worst, A.edgeMargin(A.centredBox(e, n), e, n));
  return [worst >= 896, 'worst margin ' + worst.toFixed(3) + ' m']; });
T('(a) centre 30 m above a tile south edge: fixed tile margin < 896 m, centred box margin >= 896 m', () => {
  const e = 520300, n = 335872 + 30, t = A.tileBox(e, n), c = A.centredBox(e, n);   // synthetic; 335872 = 164 x 2048
  return [A.edgeMargin(t, e, n) < 896 && A.edgeMargin(c, e, n) >= 896, `tile ${A.edgeMargin(t, e, n).toFixed(0)} m, centred ${A.edgeMargin(c, e, n).toFixed(0)} m`]; });
T('(b) moves under 256 m inside one 256 m cell reuse the same cache key', () => {
  let same = 0, k = 0; for (const [e, nn] of pts.slice(0, 500)) { const ce = Math.round(e / 256) * 256, cn = Math.round(nn / 256) * 256;
    const k0 = A.centredBox(ce - 127, cn - 127).key; for (const [de, dn] of [[0, 0], [254, 0], [0, 254], [254, 254], [100, 37]]) { k++; if (A.centredBox(ce - 127 + de, cn - 127 + dn).key === k0) same++; } }
  return [same === k, `${same}/${k} same key`]; });
T('(b) any move under 256 m shifts each edge by at most one 256 m step (neighbour key, never a jump)', () => {
  let bad = 0; for (const [e, n] of pts) { const a = A.centredBox(e, n), b2 = A.centredBox(e + 255 * (rnd() * 2 - 1), n + 255 * (rnd() * 2 - 1));
    if (Math.abs(a.e0 - b2.e0) > 256 || Math.abs(a.n0 - b2.n0) > 256) bad++; } return [bad === 0, bad + ' jumps']; });
T('(b) edges lie on the 256 m BNG lattice', () => [pts.every(([e, n]) => { const b2 = A.centredBox(e, n); return [b2.e0, b2.n0, b2.e1, b2.n1].every(v => v % 256 === 0); }), 'all edges % 256 == 0']);
T('(c) centred box area stays 419.43 ha; one envelope query for it', () => {
  const cb = A.centredBox(412345, 290001), rr = A.assessBox([], cb);
  return [near(rr.boxHa, 419.4304, 1e-6) && cb.e1 - cb.e0 === 2048 && cb.n1 - cb.n0 === 2048 && /geometry=411392%2C289024%2C413440%2C291072/.test(A.queryUrl(cb)), `${rr.boxHa} ha, ${JSON.stringify(cb)}`]; });

// 9. Round 4: EA Flood Map for Planning, Flood Zones 3 and 2, clipped to the same centred box (made-up geometry).
T('(fz) one service-level envelope query for both zone layers, EPSG:27700, the centred box', () => {
  const cb = A.centredBox(412345, 290001), u = A.floodQueryUrl(cb);
  return [/Flood_Map_for_Planning\/FeatureServer\/query\?/.test(u) && u.includes(encodeURIComponent('{"1":"1=1","2":"1=1"}')) && /geometry=411392%2C289024%2C413440%2C291072/.test(u) && /inSR=27700/.test(u) && /esriGeometryEnvelope/.test(u), u.slice(0, 140)]; });
T('(fz) licence OGL v3.0, EA attribution, data date, 40 s EA pace', () => [A.FZ.licence === 'Open Government Licence v3.0' && /Environment Agency copyright/.test(A.FZ.attribution) && /Nov 2023/.test(A.FZ.date) && A.EA_GAP_MS >= 40000, A.FZ.date]);
T('(fz) clip and area: FZ3 strip 512 m wide overhanging the box, FZ2 = west half with a 100x100 hole', () => {
  const cb = A.centredBox(412345, 290001), x0 = cb.e0, y0 = cb.n0;
  const ans = { layers: [
    { id: 1, features: [{ geometry: { rings: [sq(x0 - 300, y0 - 300, x0 + 512, y0 + 2048 + 300)] } }] },
    { id: 2, features: [{ geometry: { rings: [sq(x0 - 300, y0 - 300, x0 + 1024, y0 + 2048 + 300), sq(x0 + 700, y0 + 700, x0 + 800, y0 + 800, false)] } },
                        { geometry: { rings: [sq(x0 + 9000, y0, x0 + 9500, y0 + 500)] } }] } ] };
  const r = A.floodShares(A.parseFlood(ans), cb), t = A.floodText(r, false), tp = A.floodText(r, true);
  const ok3 = near(r.fz3.share, 0.25, 1e-12) && near(r.fz3.ha, 104.8576, 1e-6);
  const ok2 = near(r.fz2.share, (1024 * 2048 - 10000) / (2048 * 2048), 1e-12) && near(r.fz2.ha, (1024 * 2048 - 10000) / 1e4, 1e-6);
  const txt = t.includes('Flood Zone 3 25.0% (105 ha) [derived]') && t.includes('Flood Zone 2 49.8% (209 ha) [derived]') && t.includes('planning flood zones, not a site flood risk assessment') && /do not add/.test(t);
  const inside = r.clipped.fz3.concat(r.clipped.fz2).every(f => f.rings.every(g => g.every(p => p[0] >= cb.e0 - 1e-6 && p[0] <= cb.e1 + 1e-6 && p[1] >= cb.n0 - 1e-6 && p[1] <= cb.n1 + 1e-6)));
  return [ok3 && ok2 && txt && inside && r.clipped.fz2.length === 1 && /\[derived\]/.test(tp) && /not a site flood risk assessment/.test(tp), `fz3 ${r.fz3.share} ${r.fz3.ha} ha; fz2 ${r.fz2.share.toFixed(6)}; ${t.slice(0, 110)}`]; });
T('(fz) negative: an empty answer gives 0% in both zones, with the caveat', () => {
  const cb = A.centredBox(412345, 290001), r = A.floodShares(A.parseFlood({ layers: [{ id: 1, features: [] }, { id: 2, features: [] }] }), cb), t = A.floodText(r, false);
  return [r.fz3.share === 0 && r.fz2.share === 0 && t.includes('Flood Zone 3 0.0% (0 ha) [derived]') && t.includes('Flood Zone 2 0.0% (0 ha) [derived]') && t.includes('planning flood zones, not a site flood risk assessment'), t.slice(0, 160)]; });
T('(fz) no answer (service error) -> says so, shows no value', () => {
  let threw = false; try { A.parseFlood({ error: { message: 'Service unavailable' } }); } catch (x) { threw = true; }
  const t = A.floodText(null, false, 'HTTP 503'), tp = A.floodText(null, true);
  return [threw && /did not answer/.test(t) && /no value shown/.test(t) && !/%/.test(t + tp) && /no value shown/.test(tp), t]; });

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
