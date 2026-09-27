// farm-assess.js: assess a farmer's LAND and GRID for solar, where you arrive (plain script; attaches to window.SIM).
// Round 1 layer: Natural England's Provisional Agricultural Land Classification (ALC), England only.
//  - The site box is the R5 tile: the 2,048 m x 2,048 m square of the British National Grid lattice under the map centre.
//  - ONE ArcGIS REST query by that box (EPSG:27700), once per tile per visit. Moving never fetches (R5 rule 6).
//  - Grade polygons are clipped to the box and drawn as wire outlines, anchored on the map, labelled with grade,
//    source, licence and date. The share of the box by grade is DERIVED (clipped planar area in National Grid metres).
//  - Distance to the nearest GridAtlas substation is DERIVED (great-circle, WGS84 mean radius) from GridAtlas points.
//    GridAtlas substations are OpenStreetMap features (ODbL): the voltage is REPORTED as tagged, the point may be a
//    private or generator substation, and it is never a connection point, an offer or a capacity. An operator is shown
//    only when it looks like a network operator (DNO/TNO pattern); OSM "name" is never shown (it can name a farm).
// Honest limits, shown on screen: the provisional ALC is a 1:250,000 map digitised from 1970s one-inch maps; it does
// NOT split grade 3 into 3a (best and most versatile) and 3b, so BMV here is "grades 1 and 2, plus an unknown part of 3".
// It is not a field survey. Licence (confirmed on the source item page, 27 Sept 2026): Open Government Licence v3.0.
// Commands: button "Assess land", or type "assess here" (own box, or the find box). ?assess=1 assesses on arrival.
(function (root) {
  'use strict';
  var SRC = {
    name: 'Provisional Agricultural Land Classification (ALC) (England)',
    by: 'Natural England',
    url: 'https://services.arcgis.com/JJzESW51TqeY9uat/ArcGIS/rest/services/Provisional%20Agricultural%20Land%20Classification%20(ALC)%20(England)/FeatureServer/0/query',
    item: 'https://www.arcgis.com/home/item.html?id=5d2477d8d04b41d4bbc9a8742f858f4d',
    licence: 'Open Government Licence v3.0',
    attribution: '© Natural England copyright. Contains Ordnance Survey data © Crown copyright and database right 2026.',
    date: 'service data last edited 2024-11-26; map scale 1:250,000 (digitised from 1970s one-inch maps)'
  };
  var GA = 'https://ventusltd.github.io/gridatlas/atlas/releases/202608300453-atlas-v9/data/grid_substations.geojson';
  var GA_SRC = 'GridAtlas substations from OpenStreetMap (© OpenStreetMap contributors, ODbL)';
  var GRID_WARN = 'may be a private or generator substation; not a connection point or offer; capacity not assessed';
  var GRID_WARN_PHONE = 'may be private/generator; not a connection offer; capacity not assessed';
  // Network operators only (distribution and transmission licensees and their old names). Anything else, such as a
  // generator, a railway or a factory, is not shown by name.
  var NET_OP = /(power ?networks?|power ?gri[dn]|national grid|electricity (distribution|transmission|networks)|electricity north ?west|nie networks|sp (energy networks|transmission|distribution)|scottish power( distribution)?$|scottish (and|&) southern (electricity networks|energy power distribution)|\bssen\b|sse (power distribution|networks)|scottish hydro electric transmission|western (power|distribution)|southern electric power distribution|central networks|esp electricity|^(ukpn|npg|nget|enwl?|yedl|nedl|sepd|manweb)$)/i;
  var NOT_NET = /renewable|wind|solar|farm|ofto|natural power/i;
  var TILE = 2048, R = 6371008.8, D = Math.PI / 180, MIN_GAP_MS = 1100;

  // ---------------- pure core (no DOM, no network; tested by tests/farm-assess.cjs) ----------------
  function tileBox(e, n) { var e0 = Math.floor(e / TILE) * TILE, n0 = Math.floor(n / TILE) * TILE;
    return { e0: e0, n0: n0, e1: e0 + TILE, n1: n0 + TILE, key: e0 + '_' + n0 }; }
  // Sutherland-Hodgman against an axis-aligned box. Keeps ring orientation, so signed areas of holes still subtract.
  function clipRing(ring, b) {
    var out = ring.slice(); if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
    var edges = [[0, b.e0, 1], [0, b.e1, -1], [1, b.n0, 1], [1, b.n1, -1]];
    for (var k = 0; k < 4 && out.length; k++) {
      var ax = edges[k][0], v = edges[k][1], s = edges[k][2], inp = out; out = [];
      var inside = function (p) { return s * (p[ax] - v) >= 0; };
      for (var i = 0; i < inp.length; i++) {
        var P = inp[i], Q = inp[(i + 1) % inp.length], pi = inside(P), qi = inside(Q);
        if (pi) out.push(P);
        if (pi !== qi) { var t = (v - P[ax]) / (Q[ax] - P[ax]); out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]); }
      }
    }
    return out;
  }
  function signedArea(r) { var a = 0; for (var i = 0; i < r.length; i++) { var p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
  // features: [{ grade, rings:[[[e,n],...]] }] in National Grid metres. Returns clipped rings and area by grade.
  function assessBox(features, b) {
    var byGrade = {}, clipped = [], boxA = (b.e1 - b.e0) * (b.n1 - b.n0), covered = 0;
    features.forEach(function (f) {
      var a = 0, rings = [];
      f.rings.forEach(function (r) { var c = clipRing(r, b); if (c.length >= 3) { a += signedArea(c); rings.push(c); } });
      a = Math.abs(a); if (a < 1) return;
      byGrade[f.grade] = (byGrade[f.grade] || 0) + a; covered += a; clipped.push({ grade: f.grade, rings: rings, area: a });
    });
    var rows = Object.keys(byGrade).sort().map(function (g) { return { grade: g, ha: byGrade[g] / 1e4, share: byGrade[g] / boxA }; });
    var none = Math.max(0, boxA - covered);
    if (none / boxA > 0.001) rows.push({ grade: 'no ALC polygon (outside England or unmapped)', ha: none / 1e4, share: none / boxA });
    var bmv = (byGrade['Grade 1'] || 0) + (byGrade['Grade 2'] || 0);
    return { rows: rows, clipped: clipped, boxHa: boxA / 1e4, bmv12Share: bmv / boxA, grade3Share: (byGrade['Grade 3'] || 0) / boxA };
  }
  function centroid(r) { var a = 0, x = 0, y = 0;   // area centroid (vertex averages drift toward shared boundaries)
    for (var i = 0; i < r.length; i++) { var p = r[i], q = r[(i + 1) % r.length], k = p[0] * q[1] - q[0] * p[1]; a += k; x += (p[0] + q[0]) * k; y += (p[1] + q[1]) * k; }
    return a ? [x / (3 * a), y / (3 * a)] : r[0]; }
  function haversine(lat1, lon1, lat2, lon2) { var dl = (lat2 - lat1) * D, dn = (lon2 - lon1) * D;
    var h = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(lat1 * D) * Math.cos(lat2 * D) * Math.sin(dn / 2) * Math.sin(dn / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); }
  function nearest(points, lat, lon) { var best = null;
    points.forEach(function (p) { var d = haversine(lat, lon, p.lat, p.lon); if (!best || d < best.m) best = { m: d, lat: p.lat, lon: p.lon, kv: p.kv, op: p.op }; });
    return best; }
  function kvList(v) { return String(v || '').split(/[;:,]/).map(function (s) { return Math.round(Number(s) / 1000); })
    .filter(function (k) { return k >= 1; }).sort(function (a, b) { return b - a; }); }
  function netOperator(op) { op = String(op || '').trim(); return op && NET_OP.test(op) && !NOT_NET.test(op) ? op.slice(0, 60) : ''; }
  // The GRID line, one place, so the tests read the exact text the screen shows.
  function gridText(sub, phone) {
    if (!sub) return phone ? 'GRID: substations not loaded.' : 'GRID: ' + GA_SRC + ': not loaded. Capacity: not assessed.';
    var op = netOperator(sub.op), km = (sub.m / 1000).toFixed(2) + ' km';
    var tagged = !!(sub.kv && sub.kv.length), kv = tagged ? sub.kv.join('/') + ' kV' : 'voltage not tagged';
    if (phone) return 'GRID: OSM substation ' + km + ' [derived], ' + kv + (tagged ? ' [reported]' : '') + (op ? ', ' + op : '') + '; ' + GRID_WARN_PHONE + '. © OSM, ODbL';
    return 'GRID: nearest substation ' + km + ' [derived, straight line from map centre], ' + kv + (tagged ? ' [reported, as tagged]' : '')
      + (op ? ', operator ' + op + ' [reported, as tagged]' : ', no network operator recognised in its tags') + '. '
      + 'Caution: ' + GRID_WARN + '. Source: ' + GA_SRC + '.';
  }
  function grade3Text(res, phone) {
    var p = (100 * res.grade3Share).toFixed(1) + '%';
    if (!(res.grade3Share > 0)) return phone ? '  Grade 3: 0%.' : '  Grades 1+2 (best and most versatile): ' + (100 * res.bmv12Share).toFixed(1) + '%. Grade 3: 0%.';
    return phone ? '  Grade 3 not split 3a/3b; may include BMV 3a; field survey needed.'
      : '  Grades 1+2 (best and most versatile): ' + (100 * res.bmv12Share).toFixed(1) + '%. Grade 3 not split into 3a/3b here: ' + p + ' may include BMV 3a. Field survey needed.';
  }
  function queryUrl(b) {
    return SRC.url + '?where=1%3D1&geometry=' + [b.e0, b.n0, b.e1, b.n1].join('%2C') + '&geometryType=esriGeometryEnvelope&inSR=27700'
      + '&spatialRel=esriSpatialRelIntersects&outFields=ALC_GRADE&returnGeometry=true&outSR=27700&maxAllowableOffset=5&geometryPrecision=1&f=json';
  }
  var core = { SRC: SRC, TILE: TILE, tileBox: tileBox, clipRing: clipRing, signedArea: signedArea, assessBox: assessBox, centroid: centroid, haversine: haversine, nearest: nearest, netOperator: netOperator, gridText: gridText, grade3Text: grade3Text, GA_SRC: GA_SRC, GRID_WARN: GRID_WARN, kvList: kvList, queryUrl: queryUrl };
  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }
  root.FARM_ASSESS = core;

  // ---------------- browser ----------------
  var cache = {}, lastReq = 0, subs = null, markers = [], busy = false;
  function PF() { return root.__pf && root.__pf.PF; }
  function wait(fn) { if (root.SIM && PF()) fn(); else setTimeout(function () { wait(fn); }, 300); }
  function loadSubs() { if (subs) return subs;
    subs = fetch(GA).then(function (r) { return r.json(); }).then(function (j) {
      return j.features.map(function (f) { var c = f.geometry.coordinates; return { lon: c[0], lat: c[1], kv: kvList(f.properties && f.properties.voltage), op: netOperator(f.properties && f.properties.operator) }; }); });
    return subs; }
  function fetchAlc(b) {
    if (cache[b.key]) return Promise.resolve(cache[b.key]);
    var gap = Math.max(0, lastReq + MIN_GAP_MS - Date.now());
    return new Promise(function (ok) { setTimeout(ok, gap); }).then(function () {
      lastReq = Date.now(); var t0 = performance.now();
      return fetch(queryUrl(b)).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) {
        if (j.error) throw new Error(j.error.message || 'service error');
        var feats = (j.features || []).map(function (f) { return { grade: String(f.attributes.ALC_GRADE || 'unknown'), rings: (f.geometry && f.geometry.rings) || [] }; });
        var rec = { feats: feats, exceeded: !!j.exceededTransferLimit, ms: Math.round(performance.now() - t0), at: new Date().toISOString() };
        cache[b.key] = rec; return rec; });
    });
  }
  function clearDraw() { SIM.removeWhere(function (x) { return x.farmAssess; }); markers.forEach(function (m) { m.remove(); }); markers = []; }
  function label(lon, lat, html) {
    var el = document.createElement('div');
    el.style.cssText = 'font:11px sans-serif;color:#dfe;background:rgba(0,20,30,.78);border:1px solid #6cf;padding:3px 6px;border-radius:4px;max-width:210px;pointer-events:none;white-space:normal';
    el.innerHTML = html; markers.push(new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(SIM.map));
  }
  function draw(b, res) {
    var P = PF(), c = P.fromBng((b.e0 + b.e1) / 2, (b.n0 + b.n1) / 2), an = P.placeKey(c.lat, c.lon);
    // Drape on the map's terrain: each vertex carries its ground height relative to the anchor (the render adds the
    // anchor's own height), so outlines are not hidden by hills. Terrain is the open AWS model: an estimate.
    var m = SIM.map, qe = function (lon, lat) { var v = m.queryTerrainElevation ? m.queryTerrainElevation([lon, lat]) : null; return v == null ? null : v; }, z0 = qe(an.lon, an.lat) || 0;
    var loc = function (e, n) { var g = P.fromBng(e, n), q = P.toLocal(an, g.lat, g.lon, 0); var z = qe(g.lon, g.lat); return [q.x, q.y, z == null ? 0 : z - z0]; };
    var L = [], C = [[b.e0, b.n0], [b.e1, b.n0], [b.e1, b.n1], [b.e0, b.n1]];
    for (var i = 0; i < 4; i++) { var A0 = C[i], B0 = C[(i + 1) % 4];
      for (var s = 0; s < 32; s++) { var a = loc(A0[0] + (B0[0] - A0[0]) * s / 32, A0[1] + (B0[1] - A0[1]) * s / 32), d = loc(A0[0] + (B0[0] - A0[0]) * (s + 1) / 32, A0[1] + (B0[1] - A0[1]) * (s + 1) / 32);
        L.push([a[0], a[1], a[2] + 1, d[0], d[1], d[2] + 1]); if (s === 0) L.push([a[0], a[1], a[2], a[0], a[1], a[2] + 12]); } }
    res.clipped.forEach(function (f) {
      var h = 1.5 + (6 - (parseInt(f.grade.replace(/\D/g, ''), 10) || 6)) * 1.5;   // outline height by grade: a visual cue only
      var big = f.rings[0], be = 0, bn = 0;
      f.rings.forEach(function (r) { var ll = r.map(function (p) { return loc(p[0], p[1]); });
        for (var k = 0; k < ll.length; k++) { var p = ll[k], q = ll[(k + 1) % ll.length]; L.push([p[0], p[1], p[2] + h, q[0], q[1], q[2] + h]); if (k % 25 === 0) L.push([p[0], p[1], p[2], p[0], p[1], p[2] + h]); } });
      f.rings.forEach(function (r) { if (Math.abs(signedArea(r)) > Math.abs(signedArea(big))) big = r; });
      var cc = centroid(big); be = cc[0]; bn = cc[1];
      var g = P.fromBng(be, bn);
      label(g.lon, g.lat, '<b>ALC ' + f.grade + '</b> · ' + (f.area / 1e4).toFixed(0) + ' ha in box<br>Natural England provisional ALC · OGL v3.0 · 1:250k, data 2024-11-26');
    });
    SIM.addBlock({ lon: an.lon, lat: an.lat, anchor: an, lines: L, buf: P.wireBuffer(an, L), farmAssess: true });
  }
  function report(b, rec, res, sub, c) {
    var pct = function (x) { return (100 * x).toFixed(1) + '%'; };
    var lines = ['LAND: site box ' + (b.e0 / 1000) + ',' + (b.n0 / 1000) + ' km (2,048 m BNG tile, ' + res.boxHa.toFixed(0) + ' ha). Agricultural Land Classification (provisional, 1:250k):'];
    res.rows.forEach(function (r) { lines.push('  ' + r.grade + ': ' + pct(r.share) + ' (' + r.ha.toFixed(0) + ' ha) [derived]'); });
    lines.push(grade3Text(res, false) + (res.grade3Share > 0 ? '' : ' Not a field survey.'));
    if (rec.exceeded) lines.push('  WARNING: service transfer limit hit; shares are incomplete.');
    lines.push(gridText(sub, false));
    lines.push('Source: ' + SRC.by + ', ' + SRC.name + '. ' + SRC.licence + '. ' + SRC.attribution + ' One query, ' + rec.ms + ' ms, ' + rec.at.slice(0, 19) + 'Z.');
    root.__farmAssess = { box: b, rows: res.rows, bmv12Share: res.bmv12Share, grade3Share: res.grade3Share, polygons: res.clipped.length, nearestSubKm: sub ? sub.m / 1000 : null, nearestSubKv: sub ? sub.kv : null, nearestSubOp: sub ? sub.op || null : null, gridLine: gridText(sub, innerWidth < 600), centre: c, exceeded: rec.exceeded, fetchedAt: rec.at };
    if (innerWidth < 600) lines = [lines[0].replace(' (2,048 m BNG tile, ', ' (').replace('Agricultural Land Classification (provisional, 1:250k):', 'ALC provisional 1:250k:')]
      .concat(res.rows.map(function (r) { return '  ' + r.grade.replace(/ \(outside.*\)/, '') + ' ' + pct(r.share); }),
        [grade3Text(res, true), gridText(sub, true),
         'Natural England ALC, OGL v3.0. © Natural England; © Crown copyright 2026.']);
    SIM.info(lines.join('\n')); var el = document.getElementById('info'); if (el) el.style.whiteSpace = 'pre-wrap';
  }
  function assess() {
    if (busy) return; busy = true;
    var c = SIM.map.getCenter(), t = PF().toBng(c.lat, c.lng), b = tileBox(t.e, t.n);
    if (!(t.e > 0 && t.e < 700000 && t.n > 0 && t.n < 1300000)) { SIM.info('Assess: outside Great Britain; no National Grid box.'); busy = false; return; }
    SIM.info('Assessing land in site box ' + b.key + ' (one request to Natural England)...');
    Promise.all([fetchAlc(b), loadSubs().catch(function () { return []; })]).then(function (x) {
      var rec = x[0], res = assessBox(rec.feats, b), sub = nearest(x[1], c.lat, c.lng);
      clearDraw(); draw(b, res); report(b, rec, res, sub, [c.lng, c.lat]);
    }).catch(function (e) { SIM.info('Assess land: Natural England service did not answer (' + e.message + '). Nothing drawn; no value guessed.'); })
      .then(function () { busy = false; });
  }
  wait(function () {
    var btn = SIM.addButton('Assess land', assess); btn.id = 'farm-assess';
    document.addEventListener('keydown', function (e) {   // "assess here" typed in the find box
      if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT' && /^\s*assess( here)?\s*$/i.test(e.target.value)) { e.preventDefault(); e.stopImmediatePropagation(); e.target.value = ''; e.target.blur(); assess(); }
    }, true);
    root.FARM_ASSESS.run = assess;
    if (/[?&]assess=1/.test(location.search)) { var go = function () { SIM.map.loaded() ? assess() : SIM.map.once('idle', assess); }; go(); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
