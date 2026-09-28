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

// 10. Round 5: honest flood wording (undefended zones; phone overlap note; phone transfer-limit warning).
const empty5 = () => A.floodShares(A.parseFlood({ layers: [{ id: 1, features: [] }, { id: 2, features: [] }] }), A.centredBox(412345, 290001));
T('(fz5) desktop and phone say the zones are undefended and ignore flood defences', () => {
  const t = A.floodText(empty5(), false), tp = A.floodText(empty5(), true), w = /undefended: they ignore flood defences \[reported, EA\], so a defended area can still show as Zone 3/;
  return [w.test(t) && w.test(tp), tp]; });
T('(fz5) phone line says Zone 2 includes Zone 3; do not add', () => {
  const tp = A.floodText(empty5(), true); return [tp.includes('Zone 2 includes Zone 3; do not add'), tp.slice(0, 120)]; });
T('(fz5) phone line warns when the service transfer limit is hit, and not otherwise', () => {
  const hit = A.floodShares(A.parseFlood({ layers: [{ id: 1, features: [], exceededTransferLimit: true }, { id: 2, features: [] }] }), A.centredBox(412345, 290001));
  const tp = A.floodText(hit, true);
  return [hit.exceeded && /WARNING: service transfer limit hit; shares incomplete/.test(tp) && !/WARNING/.test(A.floodText(empty5(), true)), tp.slice(-70)]; });

// 11. Round 6: the result panel sits above the bottom band (honesty-ux offsets) and scrolls inside a capped height.
T('(panel6) offsets: phone (<=480 px) bottom 124 px, desktop bottom 44 px', () => {
  const p = A.panelLayout(390, 844, 382, [], 0), p480 = A.panelLayout(480, 844, 472, [], 0), d = A.panelLayout(1280, 800, 728, [], 0);
  return [A.PANEL.phone === 124 && A.PANEL.desktop === 44 && p.bottom === 124 && p.phone && p480.bottom === 124 && d.bottom === 44 && !d.phone, `phone ${p.bottom}, 480 ${p480.bottom}, desktop ${d.bottom}`]; });
T('(panel6) phone 390: lifted above joystick and find box, never below 124, max-height capped under the button bar', () => {
  const joy = { left: 246, right: 366, top: 684, bottom: 804 }, fg = { left: 150, right: 382, top: 634, bottom: 668 };
  const p = A.panelLayout(390, 844, 382, [joy, fg], 350);
  return [p.bottom === 214 && p.bottom >= 124 && p.maxHeight === 844 - 214 - 350 - 4 && 844 - p.bottom <= fg.top, JSON.stringify(p)]; });
T('(panel6) negative: obstacles beside or above the panel do not lift it; height never below the floor', () => {
  const p = A.panelLayout(1280, 800, 728, [{ left: 1136, right: 1256, top: 640, bottom: 760 }, { left: 0, right: 700, top: 8, bottom: 60 }], 790);
  return [p.bottom === 44 && p.maxHeight === A.PANEL.minH, JSON.stringify(p)]; });

// 12. Round 7: #info is shared; the farmer lift is undone exactly when another module writes #info.
const fakeInfo = (style, cls) => { const c = new Set(cls || []); return { textContent: '', style: Object.assign({}, style),
  classList: { contains: k => c.has(k), add: k => c.add(k), remove: k => c.delete(k) } }; };
const ORIG = { whiteSpace: '', bottom: '', maxHeight: '', overflowY: '', maxWidth: '', boxSizing: '', zIndex: '', background: 'rgba(1, 2, 3, 0.5)' };
const lift = (el, text) => { el.textContent = text; Object.assign(el.style, { whiteSpace: 'pre-wrap', bottom: '214px', maxHeight: '276px', overflowY: 'auto', maxWidth: '374px', boxSizing: 'border-box', zIndex: '5', background: 'rgba(0,10,20,.88)' }); el.classList.add('fa-lift'); };
const FARM = A.FARM_HEAD + ' 519.936,332.8 km (centred on arrival, 419 ha). ALC provisional 1:250k:';
T('(info7) records all 8 inline styles and the class; a foreign SIM.info write restores them exactly and drops fa-lift', () => {
  const el = fakeInfo(ORIG), prev = A.snapInfo(el); lift(el, FARM);
  const kept = A.infoChanged(prev, el); el.textContent = '52.88900, -0.20000 (typed coordinates, WGS84).'; const done = A.infoChanged(prev, el);
  return [A.INFO_KEYS.length === 8 && !kept && done && JSON.stringify(el.style) === JSON.stringify(ORIG) && !el.classList.contains('fa-lift'), JSON.stringify(el.style)]; });
T('(info7) a second farmer result after a restore re-applies the lift (fresh snapshot is the original)', () => {
  const el = fakeInfo(ORIG); let prev = A.snapInfo(el); lift(el, FARM); el.textContent = 'Pylons: 12 at GridAtlas line vertices.'; A.infoChanged(prev, el);
  prev = A.snapInfo(el); lift(el, FARM);
  return [el.classList.contains('fa-lift') && el.style.bottom === '214px' && JSON.stringify(prev.style) === JSON.stringify(ORIG) && !prev.lift, JSON.stringify(prev)]; });
T('(info7) negative: a farmer re-render (text still starts with the LAND line) does NOT clear the lift', () => {
  const el = fakeInfo(ORIG), prev = A.snapInfo(el); lift(el, FARM); el.textContent = FARM + '\n  Grade 1 83.4%';
  const r = A.infoChanged(prev, el), r0 = A.infoChanged(null, el);
  return [!r && !r0 && el.classList.contains('fa-lift') && el.style.zIndex === '5' && el.style.background === 'rgba(0,10,20,.88)' && !A.isFarmText(' ' + FARM), JSON.stringify(el.style)]; });

// 13. Round 8: the LAND line names the box by its OS grid reference (box centre), not the internal key.
// Known points: OS published references (Ben Nevis summit trig NN 16667 71278; TF, TQ, SU and NT 100 km squares).
T('(gref8) TF: box centre 520960,333824 gives TF 2096 3382 (8-figure, truncated)', () => { const g = A.gridRef(520960, 333824); return [g === 'TF 2096 3382', g]; });
T('(gref8) TQ: Trafalgar Square about 530000,180400 gives TQ 3000 8040; SU 441234,112345 gives SU 4123 1234', () => {
  const a = A.gridRef(530000, 180400), c = A.gridRef(441234, 112345); return [a === 'TQ 3000 8040' && c === 'SU 4123 1234', a + ' | ' + c]; });
T('(gref8) NT and 10-figure: Edinburgh 325000,673000 gives NT 2500 7300; Ben Nevis 216667,771278 gives NN 16667 71278', () => {
  const a = A.gridRef(325000, 673000), c = A.gridRef(216667, 771278, 10); return [a === 'NT 2500 7300' && c === 'NN 16667 71278', a + ' | ' + c]; });
T('(gref8) corners and the skipped I: 0,0 is SV; 699999,1299999 is JM; HP (Shetland) 460000,1210000; no square uses I', () => {
  const a = A.gridRef(0, 0), c = A.gridRef(699999, 1299999), d = A.gridRef(460000, 1210000);
  let noI = true; for (let e = 50000; e < 700000; e += 100000) for (let n = 50000; n < 1300000; n += 100000) if (/I/.test(A.gridRef(e, n).slice(0, 2))) noI = false;
  return [a === 'SV 0000 0000' && c === 'JM 9999 9999' && d === 'HP 6000 1000' && noI, [a, c, d, noI].join(' | ')]; });
T('(gref8) negative: outside the grid or not a number gives null, never a wrong square', () => {
  const bad = [[-1, 300000], [300000, -0.5], [700000, 300000], [300000, 1300000], [NaN, 1], [1, Infinity], ['520960', 333824], [520960, 333824, 7], [520960, 333824, 12]];
  const out = bad.map(x => A.gridRef(x[0], x[1], x[2])); return [out.every(v => v === null), JSON.stringify(out)]; });
T('(gref8) LAND line head: grid ref of the centred box, tagged [derived]; still starts with FARM_HEAD; cache key unchanged', () => {
  const bx = A.centredBox(520900, 333800), h = A.landHead(bx);
  return [bx.key === 'c520960_333824' && h === 'LAND: site box TF 2096 3382 [derived, box centre, OS grid ref]' && A.isFarmText(h + ' (centred on arrival, 419 ha)') && !/519\.936/.test(h), bx.key + ' | ' + h]; });
T('(gref8) negative: a box outside the lettered grid falls back to km and says so, never a letter pair', () => {
  const h = A.landHead({ e0: -2048, n0: 300000, e1: 0, n1: 302048 }); return [A.isFarmText(h) && /km BNG \[derived, box centre; outside the lettered OS grid\]/.test(h) && !/[A-Z]{2} \d/.test(h), h]; });

// 14. Round 9: SLOPE of the site box from an already-streamed R5 DTM tile (lidar-stream's decoded form). No network.
// geo in the decoder's form: rows north to south, west/north = the tile's NW corner, res = cell size (m).
const dtmTile = (e0, n0, size, res, fn, holes) => { const w = size / res, h = w, data = new Float32Array(w * h), mask = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) { const e = e0 + (c + 0.5) * res, n = n0 + size - (r + 0.5) * res; data[r * w + c] = fn(e, n); mask[r * w + c] = holes && holes(e, n) ? 0 : 1; }
  return { geo: { data, width: w, height: h, west: e0, north: n0 + size, res }, mask, src: { product: 'LIDAR Composite DTM 1 m' }, sha: 'abcdef0123456789' }; };
const bx9 = A.centredBox(520900, 333800);                                   // c520960_333824: E 519936-521984, N 332800-334848
const tan = d => Math.tan(d * Math.PI / 180);
T('(slope9) synthetic plane of 7.0 deg rising to the NE gives 100% in the 5-10 deg band; 3.0 deg gives 100% under 5; 14.0 deg gives 100% over 10', () => {
  const out = [7, 3, 14].map(deg => { const g = tan(deg) / Math.SQRT2;   // equal E and N components; magnitude tan(deg)
    const t = dtmTile(519000, 332000, 4096, 4, (e, n) => 10 + g * (e - 519000) + g * (n - 332000));
    const sl = A.slopeBands([t], bx9); return sl.bands.map(x => x.share); });
  return [near(out[0][1], 1, 1e-12) && near(out[1][0], 1, 1e-12) && near(out[2][2], 1, 1e-12), JSON.stringify(out)]; });
T('(slope9/r10) a flat tile gives 100% under 5 deg over the whole 419 ha box, tagged [derived, 5 m blocks from DTM 1 m: Environment Agency LIDAR Composite, OGL v3.0], licence and attribution named', () => {
  const sl = A.slopeBands([dtmTile(519000, 332000, 4096, 1, () => 4.2)], bx9), d = A.slopeText(sl, false), ph = A.slopeText(sl, true), cr = A.slopeCredit(sl);
  return [near(sl.bands[0].share, 1, 1e-12) && near(sl.assessedHa, 419.4304, 1e-6) && sl.bands[1].ha === 0 && sl.bands[2].ha === 0
    && /under 5° 100\.0% \(419 ha\)/.test(d) && d.indexOf('[derived, 5 m blocks from DTM 1 m: Environment Agency LIDAR Composite, OGL v3.0]') > 0 && d.indexOf('5 m blocks from DTM 1 m (mean of measured cells, blocks at least 80% measured)') > 0 && ph.indexOf('5 m blocks from DTM 1 m') > 0 && /^SLOPE: <5° 100\.0%/.test(ph)
    && /Open Government Licence v3\.0\. Contains Environment Agency information © Environment Agency and database right\./.test(cr) && /receipt abcdef012345/.test(cr), d + ' || ' + ph + ' || ' + cr]; });
T('(slope9) a missing tile gives "slope not assessed (no DTM tile loaded)" and no value, on desktop and phone', () => {
  const a = A.slopeBands([], bx9), c = A.slopeBands(undefined, bx9), d = A.slopeBands([{ none: 'outside the service envelope' }], bx9);
  const t = A.slopeText(a, false), tp = A.slopeText(null, true);
  return [a === null && c === null && d === null && t === 'SLOPE: slope not assessed (no DTM tile loaded).' && tp === t && A.slopeCredit(null) === '' && !/\d/.test(t), t]; });
T('(slope9, 1 m path) bands split by area: W part flat, middle 8 deg, E part 15 deg; only cells in the box count; shares are of the assessed part', () => {
  // Tile E 520960-523008, N 333824-335872 overlaps the box in E 520960-521984, N 333824-334848. Its W column and S row are
  // tile edges (no west/south neighbour), so 1023 x 1023 cells are assessable. The kinks at x1, x2 move at most one column.
  const s8 = tan(8), s15 = tan(15), x1 = 521300, x2 = 521700;
  const z = e => e < x1 ? 0 : e < x2 ? (e - x1) * s8 : (x2 - x1) * s8 + (e - x2) * s15;
  const sl = A.slopeBands([dtmTile(520960, 333824, 2048, 1, e => z(e))], bx9, { block: 1 }), H = sl.bands.map(x => x.ha * 1e4);
  const rows = 1023, flat = (x1 - 520961) * rows, mid = (x2 - x1) * rows, steep = (521984 - x2) * rows;
  return [near(sl.assessedHa, 1023 * 1023 / 1e4, 1e-9) && Math.abs(H[0] - flat) <= rows && Math.abs(H[1] - mid) <= rows && Math.abs(H[2] - steep) <= rows
    && near(sl.bands.reduce((s, x) => s + x.share, 0), 1, 1e-12) && near(sl.cover, 1023 * 1023 / (2048 * 2048), 1e-12), JSON.stringify(H) + ' vs ' + [flat, mid, steep]]; });
T('(slope9, 1 m path) holes: unmeasured cells and their 4 neighbours are not assessed (never 0 m)', () => {
  const t = dtmTile(519000, 332000, 4096, 1, () => 0, (e, n) => e > 521000 && e < 521100 && n > 333000 && n < 333100);
  const sl = A.slopeBands([t], bx9, { block: 1 });
  return [near(sl.assessedHa * 1e4, 2048 * 2048 - 100 * 100 - 4 * 100, 1e-6) && sl.bands[0].share === 1, sl.assessedHa]; });
T('(gref9) gridRef digits=0 gives null (was 8 figures via digits||8); omitted still gives 8; 6 gives 6', () => {
  const z = A.gridRef(520960, 333824, 0), u = A.gridRef(520960, 333824), n6 = A.gridRef(520960, 333824, 6);
  return [z === null && u === 'TF 2096 3382' && n6 === 'TF 209 338', [z, u, n6].join(' | ')]; });

// 15. Round 10: SCALE. 5 m blocks (mean of measured 1 m cells, blocks at least 80% measured) so ditch banks are not "steep".
T('(slope10) a narrow 2 m ditch, 1.5 m deep with vertical banks, cut into flat ground: over 10 deg at 1 m, but 100% under 5 deg at 5 m blocks', () => {
  const ditch = (e, n) => (e >= 521001 && e < 521003) || (n >= 333401 && n < 333403) ? -1.5 : 0;   // one N-S and one E-W ditch
  const t = dtmTile(519000, 332000, 4096, 1, ditch), s1 = A.slopeBands([t], bx9, { block: 1 }), s5 = A.slopeBands([t], bx9);
  return [s1.bands[2].ha > 0.8 && s5.block === 5 && s5.bands[0].share === 1 && s5.bands[2].ha === 0 && s5.bands[1].ha === 0,
    '1 m over 10: ' + s1.bands[2].ha.toFixed(3) + ' ha; 5 m: ' + s5.bands.map(x => x.share).join(',')]; });
T('(slope10) 5 m blocks keep a real 7 deg field in the 5-10 band and a 14 deg bank over 10 (averaging does not flatten true slope)', () => {
  const out = [7, 14].map(deg => { const g = tan(deg); return A.slopeBands([dtmTile(519000, 332000, 4096, 1, (e, n) => g * (n - 332000))], bx9).bands.map(x => x.share); });
  return [near(out[0][1], 1, 1e-9) && near(out[1][2], 1, 1e-9), JSON.stringify(out)]; });
T('(slope10) the 80% rule: blocks with 5 of 25 cells unmeasured are used (their junk heights ignored); 6 of 25 are not, nor their 4 neighbours', () => {
  const inR = (e, n) => e > 521000 && e < 521100 && n > 333000 && n < 333100, k5 = [0, 1, 2, 3, 4], k6 = [0, 1, 2, 3, 4, 5];
  const mk = K => { const t = dtmTile(519000, 332000, 4096, 1, () => 0, (e, n) => inR(e, n) && K.includes((Math.floor(e) % 5) * 5 + (Math.floor(n) % 5)));
    for (let i = 0; i < t.mask.length; i++) if (!t.mask[i]) t.geo.data[i] = 1000; return A.slopeBands([t], bx9); };
  const a = mk(k5), b6 = mk(k6), box = 2048 * 2048;
  return [near(a.assessedHa * 1e4, box, 1e-6) && a.bands[0].share === 1 && near(b6.assessedHa * 1e4, box - (400 + 80) * 25, 1e-6) && b6.bands[0].share === 1,
    a.assessedHa + ' / ' + b6.assessedHa]; });
T('(slope10) the over-10 deg outline: none on flat ground; on a 14 deg plane every segment is one 5 m block side on the 5 m BNG lattice', () => {
  const f0 = A.slopeBands([dtmTile(519000, 332000, 4096, 1, () => 0)], bx9, { edges: true });
  const s = A.slopeBands([dtmTile(519000, 332000, 4096, 1, (e, n) => tan(14) * (n - 332000))], bx9, { edges: true });
  const okSeg = s.edges.every(q => q.every(v => v % 5 === 0) && Math.hypot(q[2] - q[0], q[3] - q[1]) === 5);
  return [f0.edges.length === 0 && s.edges.length > 0 && okSeg && !s.edgesCut, f0.edges.length + ' / ' + s.edges.length]; });
T('(slope10) the scale is said: 5 m blocks from DTM 1 m by default; block 1 on a 1 m tile says DTM 1 m and 1 cell central differences', () => {
  const t = dtmTile(519000, 332000, 4096, 1, () => 0), a = A.slopeBands([t], bx9), c = A.slopeBands([t], bx9, { block: 1 });
  return [A.SLOPE_BLOCK_M === 5 && A.slopeScale(a) === '5 m blocks from DTM 1 m' && A.slopeScale(c) === 'DTM 1 m' && /1 cell central differences/.test(A.slopeText(c, false)), A.slopeScale(a) + ' | ' + A.slopeScale(c)]; });

// 16. Round 12: DESIGNATIONS (Natural England SSSI, National Landscapes, National Parks, Ramsar, SAC, SPA) in the site box.
// Made-up geometry and codes only; no site names anywhere (the query never asks for them).
const bx12 = A.centredBox(520900, 333800), X0 = bx12.e0, Y0 = bx12.n0, AT = '2026-09-28T00:40:12.000Z';
const L12 = id => A.DES.layers.find(L => L.id === id);
const okAll = (feats, extra) => { const o = {}; A.DES.layers.forEach(L => { const pl = A.parseDes(Object.assign({ features: feats[L.id] || [] }, extra && extra[L.id]), L); o[L.id] = { res: A.desAssess(pl, bx12), at: AT }; }); return o; };
T('(des12) six layers, one envelope query each in EPSG:27700 on the centred box; code field only, never NAME', () => {
  const us = A.DES.layers.map(L => A.desQueryUrl(L, bx12));
  const want = ['SSSI_England', 'Areas_of_Outstanding_Natural_Beauty_England', 'National_Parks_England', 'Ramsar_England', 'Special_Areas_of_Conservation_England', 'Special_Protection_Areas_England'];
  return [us.length === 6 && us.every((u, i) => u.includes('/' + want[i] + '/FeatureServer/0/query?') && /geometry=519936%2C332800%2C521984%2C334848/.test(u) && /inSR=27700/.test(u) && /esriGeometryEnvelope/.test(u) && !/NAME/i.test(u.split('outFields=')[1].split('&')[0])),
    us[0].slice(0, 150)]; });
T('(des12) licence OGL v3.0 and NE attribution recorded and in the credit line', () => {
  const c = A.desCredit(); return [A.DES.licence === 'Open Government Licence v3.0' && /Natural England copyright/.test(A.DES.attribution) && c.includes('Open Government Licence v3.0') && c.includes(A.DES.attribution) && /SSSI England/.test(c) && /Special Protection Areas England/.test(c), c.slice(0, 120)]; });
T('(des12) EMPTY: successful empty answers say "none in box", tagged [derived, NE <layer>, queried <time>]', () => {
  const t = A.desText(okAll({}), false), tp = A.desText(okAll({}), true);
  return [t.includes('SSSI: none in box [derived, NE SSSI_England, queried 00:40 UTC]') && t.includes('SPA: none in box [derived, NE Special_Protection_Areas_England, queried 00:40 UTC]')
    && (t.match(/none in box/g) || []).length === 6 && !/fetch failed/.test(t) && /land outside it not checked/.test(t) && (tp.match(/none in box/g) || []).length === 6, t.split('\n').slice(0, 2).join(' | ')]; });
T('(des12) HIT: SSSI strip 256 m wide overhanging the box (12.5%), nearest from box centre; SAC contains the centre (0 m)', () => {
  const des = okAll({ SSSI: [{ attributes: { REF_CODE: '1000001' }, geometry: { rings: [sq(X0 - 100, Y0 - 100, X0 + 256, Y0 + 2148)] } }],
    SAC: [{ attributes: { SAC_CODE: 'UK0000001' }, geometry: { rings: [sq(X0 + 900, Y0 + 900, X0 + 1100, Y0 + 1100)] } }] });
  const s1 = des.SSSI.res, s2 = des.SAC.res, t = A.desText(des, false), tp = A.desText(des, true);
  return [s1.n === 1 && near(s1.share, 0.125, 1e-12) && near(s1.ha, 256 * 2048 / 1e4, 1e-9) && near(s1.nearestM, 1024 - 256, 1e-9) && s2.n === 1 && s2.nearestM === 0 && near(s2.ha, 4, 1e-9)
    && t.includes('SSSI: 1 site in box, 12.5% of box (52.4 ha); nearest 768 m from box centre [derived, NE SSSI_England, queried 00:40 UTC]')
    && t.includes('SAC: 1 site in box, 1.0% of box (4.0 ha); nearest 0 m (box centre inside)') && t.includes('Ramsar: none in box') && tp.includes('SSSI 1 in box, 12.5%, nearest 768 m from box centre [derived]') && !/1000001|UK0000001/.test(t + tp),
    t.split('\n').slice(1, 2) + ' | ' + s2.nearestM]; });
T('(des12) HIT geometry: a hole around the centre is not "inside"; clipped outline lies in the box; outside-box feature counts 0 but gives nearest', () => {
  const ring = [sq(X0 + 500, Y0 + 500, X0 + 1500, Y0 + 1500), sq(X0 + 900, Y0 + 900, X0 + 1150, Y0 + 1150, false)];
  const r = A.desAssess(A.parseDes({ features: [{ attributes: {}, geometry: { rings: ring } }] }, L12('SPA')), bx12);
  const o = A.desAssess(A.parseDes({ features: [{ attributes: {}, geometry: { rings: [sq(X0 + 2048, Y0, X0 + 2548, Y0 + 500)] } }] }, L12('SPA')), bx12);
  const inside = r.clipped.every(f => f.rings.every(g => g.every(p => p[0] >= bx12.e0 && p[0] <= bx12.e1 && p[1] >= bx12.n0 && p[1] <= bx12.n1)));
  return [r.n === 1 && near(r.nearestM, 124, 1e-9) && near(r.ha, (1e6 - 250 * 250) / 1e4, 1e-9) && inside && o.n === 0 && near(o.nearestM, Math.hypot(1024, 524), 1e-9)
    && A.desLine(L12('SPA'), { res: o, at: AT }, false).startsWith('SPA: none in box'), r.nearestM + ' / ' + o.n + ' ' + o.nearestM]; });
T('(des12) FAILURE: an error answer throws (never "none"); a failed layer says "designations not checked (fetch failed)"; all failed says it once', () => {
  let threw = 0; [{ error: { code: 500, message: 'Unable to complete operation.' } }, {}, null].forEach(j => { try { A.parseDes(j, L12('SSSI')); } catch (x) { threw++; } });
  const part = okAll({}); part.NP = { err: 'HTTP 503' };
  const t = A.desText(part, false), tp = A.desText(part, true), all = {}; A.DES.layers.forEach(L => { all[L.id] = { err: 'Failed to fetch' }; });
  const ta = A.desText(all, false), tn = A.desText(null, true);
  return [threw === 3 && t.includes('National Park: designations not checked (fetch failed) [NE National_Parks_England, HTTP 503]') && !/National Park: none/.test(t) && (t.match(/none in box/g) || []).length === 5
    && tp.includes('National Park: designations not checked (fetch failed)') && ta === 'DESIGNATIONS: designations not checked (fetch failed).' && tn === ta && !/none/.test(ta), t.split('\n')[3] + ' || ' + ta]; });
T('(des12) transfer limit hit: never "none in box"; says not fully checked', () => {
  const d = okAll({}, { SPA: { exceededTransferLimit: true } }), t = A.desText(d, false);
  return [t.includes('SPA: not fully checked (service transfer limit hit)') && !/SPA: none/.test(t), t.split('\n')[6]]; });

// Round 13: the England guard, decided from the ALC answer already fetched.
const alcOf = feats => A.assessBox(feats, bx12);
T('(eng13) 0% England (all "no ALC polygon", ALC ok): every designation line NO_ENG, never "none in box"; ALC note says England only', () => {
  const res = alcOf([]), eng = A.englandPart(res, false), t = A.desText(null, false, eng), tp = A.desText(null, true, eng), t2 = A.desText(okAll({}), false, eng);
  const lines = t.split('\n').slice(1), n = A.alcEngText(eng, false), np = A.alcEngText(eng, true);
  return [eng.known && eng.zero && eng.share === 0 && lines.length === 6 && lines.every(l => l.endsWith(': ' + A.NO_ENG)) && !/none in box/.test(t + tp + t2) && !/fetch failed/.test(t)
    && tp.startsWith('DESIGNATIONS: ' + A.NO_ENG + ': SSSI, National Landscape, National Park, Ramsar, SAC, SPA') && t2 === t
    && /no NE ALC polygon/i.test(n) && /England only/.test(n) && /no NE ALC polygon/i.test(np), lines[0] + ' || ' + tp]; });
T('(eng14) 0% England states its EVIDENCE, not a conclusion: no bare "No England land" on desktop or phone; "no NE ALC polygon" in the ALC note, the designations header, NO_ENG and the phone line; still "Not a statement that the land is poor"', () => {
  const eng = A.englandPart(alcOf([]), false), n = A.alcEngText(eng, false), np = A.alcEngText(eng, true), t = A.desText(null, false, eng), tp = A.desText(null, true, eng);
  const all = [n, np, t, tp, A.NO_ENG].join(' || ');
  return [!/No England land/i.test(all) && [n, np, t, tp, A.NO_ENG].every(x => /no NE ALC polygon/i.test(x))
    && n.includes('No NE ALC polygon in box, read as outside England [derived; ALC covers England only; estuaries or large water may also be unmapped]')
    && t.split('\n')[0].includes('No NE ALC polygon in box, read as outside England [derived;') && A.NO_ENG === 'not checked (box read as outside England: no NE ALC polygon)'
    && /read as outside England; ALC does not apply/.test(np) && np.length < 120 && /Not a statement that the land is poor/.test(n) && /Not a statement that the land is poor/.test(np), np + ' || ' + tp]; });
T('(eng13) PARTIAL: England covers 37.5% of the box: per-layer lines kept, header and phone say "England part only: 37.5% of box"', () => {
  const res = alcOf([{ grade: 'Grade 3', rings: [sq(X0 - 50, Y0 - 50, X0 + 768, Y0 + 2100)] }]), eng = A.englandPart(res, false);
  const d = okAll({ SSSI: [{ attributes: {}, geometry: { rings: [sq(X0, Y0, X0 + 256, Y0 + 2048)] } }] }), t = A.desText(d, false, eng), tp = A.desText(d, true, eng);
  return [eng.known && !eng.zero && eng.part && near(eng.share, 0.375, 1e-9) && t.split('\n')[0].includes('England part only: 37.5% of box') && t.split('\n').length === 7
    && t.includes('SSSI: 1 site in box, 12.5% of box') && (t.match(/none in box/g) || []).length === 5 && tp.startsWith('DESIGNATIONS (England part only: 37.5% of box, box only)')
    && A.alcEngText(eng, false).includes('England part only: 37.5% of box') && A.alcEngText(A.englandPart(alcOf([{ grade: 'Grade 2', rings: [sq(X0 - 9, Y0 - 9, X0 + 2060, Y0 + 2060)] }]), false), false) === '',
    t.split('\n')[0].slice(-60) + ' || ' + tp.slice(0, 60)]; });
T('(eng13) ALC FAILED: hits still reported; "none in box" becomes "none in the England part (England extent unknown, ALC fetch failed)"; limit hit says incomplete', () => {
  const eng = A.englandPart(null), d = okAll({ SAC: [{ attributes: {}, geometry: { rings: [sq(X0 + 900, Y0 + 900, X0 + 1100, Y0 + 1100)] } }] });
  const t = A.desText(d, false, eng), tp = A.desText(d, true, eng), te = A.desText(okAll({}), false, A.englandPart(alcOf([]), true));
  return [!eng.known && eng.why === 'ALC fetch failed' && t.includes('SAC: 1 site in box, 1.0% of box (4.0 ha)') && !/none in box/.test(t + tp)
    && (t.match(/none in the England part \(England extent unknown, ALC fetch failed\)/g) || []).length === 5 && (tp.match(/none in the England part/g) || []).length === 5
    && A.alcEngText(eng, false) === '' && (te.match(/England extent unknown, ALC answer incomplete/g) || []).length === 6 && !/no England land/.test(te),
    t.split('\n')[1]]; });

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
