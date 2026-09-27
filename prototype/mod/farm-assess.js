// farm-assess.js: assess a farmer's LAND and GRID for solar, where you arrive (plain script; attaches to window.SIM).
// Round 1 layer: Natural England's Provisional Agricultural Land Classification (ALC), England only.
//  - The site box is 2,048 m x 2,048 m CENTRED ON ARRIVAL (round 3): the map centre, snapped to the nearest 256 m
//    British National Grid node, is the box centre, so every edge lies on the 256 m lattice and the centre is always at
//    least 896 m from each edge. (Rounds 1-2 used the fixed 2,048 m R5 tile, which can leave the centre near an edge.)
//  - ONE ArcGIS REST query by that box (EPSG:27700), cached by the snapped key, at least 1.1 s apart. Nothing fetches
//    while the map moves (R5 rule 6): an assess asked mid-move waits for the map to be idle.
//  - Grade polygons are clipped to the box and drawn as wire outlines, anchored on the map, labelled with grade,
//    source, licence and date. The share of the box by grade is DERIVED (clipped planar area in National Grid metres).
//  - Distance to the nearest GridAtlas substation is DERIVED (great-circle, WGS84 mean radius) from GridAtlas points.
//    GridAtlas substations are OpenStreetMap features (ODbL): the voltage is REPORTED as tagged, the point may be a
//    private or generator substation, and it is never a connection point, an offer or a capacity. An operator is shown
//    only when it looks like a network operator (DNO/TNO pattern); OSM "name" is never shown (it can name a farm).
// Honest limits, shown on screen: the provisional ALC is a 1:250,000 map digitised from 1970s one-inch maps; it does
// NOT split grade 3 into 3a (best and most versatile) and 3b, so BMV here is "grades 1 and 2, plus an unknown part of 3".
// It is not a field survey. Licence (confirmed on the source item page, 27 Sept 2026): Open Government Licence v3.0.
// Round 4 layer: Environment Agency Flood Map for Planning (Rivers and Sea), Flood Zones 3 and 2, from the EA's own
// ArcGIS item 510b860c094046f7813d86811a646543 (licence read there 27 Sept 2026: OGL v3 for both zone datasets). ONE
// service-level query per assess (both layers in one envelope request), cached by the same c<e>_<n> key, at least 40 s
// between EA requests, never on move. The share of the box in each zone layer is DERIVED; the layers can overlap, so the
// two shares are per layer and are not added. Planning flood zones, not a site flood risk assessment.
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
  var FZ = {
    name: 'Flood Map for Planning (Rivers and Sea), Flood Zones 3 and 2',
    by: 'Environment Agency',
    url: 'https://services1.arcgis.com/JZM7qJpmv7vJ0Hzx/arcgis/rest/services/Flood_Map_for_Planning/FeatureServer/query',
    item: 'https://www.arcgis.com/home/item.html?id=510b860c094046f7813d86811a646543',
    licence: 'Open Government Licence v3.0',
    attribution: '© Environment Agency copyright and/or database right 2024. All rights reserved. Some features of this map are based on digital spatial data from the Centre for Ecology & Hydrology, © NERC (CEH). © Crown Copyright and Database Rights 2024 OS AC0000807064.',
    date: 'zones published Nov 2023 (EA item); service data edited FZ3 2024-05-09, FZ2 2025-01-01; may predate the latest EA national update',
    caveat: 'planning flood zones, not a site flood risk assessment',
    // Round 5: EA Flood Zones item text (items cf1cf6ef.../08127810..., (c) Environment Agency, OGL v3.0, read 27 Sept 2026):
    // the zones show risk "ignoring the benefits of defences". Reported by the EA, not measured here.
    defences: 'undefended: they ignore flood defences [reported, EA], so a defended area can still show as Zone 3'
  };
  var EA_GAP_MS = 40000;
  var GA = 'https://ventusltd.github.io/gridatlas/atlas/releases/202608300453-atlas-v9/data/grid_substations.geojson';
  var GA_SRC = 'GridAtlas substations from OpenStreetMap (© OpenStreetMap contributors, ODbL)';
  var GRID_WARN = 'may be a private or generator substation; not a connection point or offer; capacity not assessed';
  var GRID_WARN_PHONE = 'may be private/generator; not a connection offer; capacity not assessed';
  // Network operators only (distribution and transmission licensees and their old names). Anything else, such as a
  // generator, a railway or a factory, is not shown by name.
  var NET_OP = /(power ?networks?|power ?gri[dn]|national grid|electricity (distribution|transmission|networks)|electricity north ?west|nie networks|sp (energy networks|transmission|distribution)|scottish power( distribution)?$|scottish (and|&) southern (electricity networks|energy power distribution)|\bssen\b|sse (power distribution|networks)|scottish hydro electric transmission|western (power|distribution)|southern electric power distribution|central networks|esp electricity|^(ukpn|npg|nget|enwl?|yedl|nedl|sepd|manweb)$)/i;
  var NOT_NET = /renewable|wind|solar|farm|ofto|natural power/i;
  var TILE = 2048, SNAP = 256, R = 6371008.8, D = Math.PI / 180, MIN_GAP_MS = 1100;

  // ---------------- pure core (no DOM, no network; tested by tests/farm-assess.cjs) ----------------
  function tileBox(e, n) { var e0 = Math.floor(e / TILE) * TILE, n0 = Math.floor(n / TILE) * TILE;
    return { e0: e0, n0: n0, e1: e0 + TILE, n1: n0 + TILE, key: e0 + '_' + n0 }; }
  // Box of side TILE centred on the point snapped to the nearest SNAP node. Edges on the SNAP lattice; key is stable for
  // every point in the same SNAP cell; |point - centre| <= SNAP/2 per axis, so each edge is >= TILE/2 - SNAP/2 = 896 m away.
  function centredBox(e, n) { var ce = Math.round(e / SNAP) * SNAP, cn = Math.round(n / SNAP) * SNAP, h = TILE / 2;
    return { e0: ce - h, n0: cn - h, e1: ce + h, n1: cn + h, key: 'c' + ce + '_' + cn, centred: true }; }
  function edgeMargin(b, e, n) { return Math.min(e - b.e0, b.e1 - e, n - b.n0, b.n1 - n); }
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
  // ---- round 4: flood zones ----
  function floodQueryUrl(b) {
    return FZ.url + '?layerDefs=' + encodeURIComponent('{"1":"1=1","2":"1=1"}') + '&geometry=' + [b.e0, b.n0, b.e1, b.n1].join('%2C')
      + '&geometryType=esriGeometryEnvelope&inSR=27700&spatialRel=esriSpatialRelIntersects&returnGeometry=true&outSR=27700&maxAllowableOffset=5&geometryPrecision=1&f=json';
  }
  // Service-level answer { layers:[{id, features:[{geometry:{rings}}], exceededTransferLimit}] } -> { fz3:[rings...], fz2:[...] }.
  function parseFlood(j) {
    if (!j || j.error || !Array.isArray(j.layers)) throw new Error((j && j.error && j.error.message) || 'no layers in answer');
    var out = { fz3: [], fz2: [], exceeded: false };
    j.layers.forEach(function (l) { var k = l.id === 1 ? 'fz3' : l.id === 2 ? 'fz2' : null; if (!k) return;
      if (l.exceededTransferLimit) out.exceeded = true;
      (l.features || []).forEach(function (f) { if (f.geometry && f.geometry.rings) out[k].push(f.geometry.rings); }); });
    return out;
  }
  // Clipped planar area of each zone layer in the box (holes subtract via ring orientation), capped at the box area.
  function floodShares(fl, b) {
    var boxA = (b.e1 - b.e0) * (b.n1 - b.n0), res = { boxHa: boxA / 1e4, exceeded: !!fl.exceeded, clipped: { fz3: [], fz2: [] } };
    ['fz3', 'fz2'].forEach(function (k) { var a = 0;
      fl[k].forEach(function (rings) { var fa = 0, kept = [];
        rings.forEach(function (r) { var c = clipRing(r, b); if (c.length >= 3) { fa += signedArea(c); kept.push(c); } });
        fa = Math.abs(fa); if (fa >= 1) { a += fa; res.clipped[k].push({ rings: kept, area: fa }); } });
      a = Math.min(a, boxA); res[k] = { ha: a / 1e4, share: a / boxA }; });
    return res;
  }
  // The FLOOD line, one place. No answer -> says so and shows no value.
  function floodText(res, phone, err) {
    if (!res) return phone ? 'FLOOD: EA service did not answer; no value shown.'
      : 'FLOOD: Environment Agency Flood Map for Planning did not answer' + (err ? ' (' + err + ')' : '') + '; no value shown.';
    var f = function (z) { return (100 * z.share).toFixed(1) + '% (' + z.ha.toFixed(0) + ' ha)'; };
    if (phone) return 'FLOOD: Zone 3 ' + (100 * res.fz3.share).toFixed(1) + '%, Zone 2 ' + (100 * res.fz2.share).toFixed(1) + '% [derived]; Zone 2 includes Zone 3; do not add. '
      + 'Zones are ' + FZ.defences + '. ' + FZ.caveat.charAt(0).toUpperCase() + FZ.caveat.slice(1) + '. EA, OGL v3.0' + (res.exceeded ? '. WARNING: service transfer limit hit; shares incomplete.' : '');
    return 'FLOOD (EA Flood Map for Planning, Rivers and Sea): box in Flood Zone 3 ' + f(res.fz3) + ' [derived]; in Flood Zone 2 ' + f(res.fz2) + ' [derived]. '
      + 'Per layer (the layers can overlap; do not add). Zones are ' + FZ.defences + '. Caveat: ' + FZ.caveat + '; rivers and sea only, not surface water or groundwater.'
      + (res.exceeded ? ' WARNING: service transfer limit hit; shares incomplete.' : '');
  }
  // Round 6: where the farmer result panel sits. Base offsets are honesty-ux's published lift of #info (bottom 44 px on
  // desktop, 124 px on a phone, <= 480 px wide). The panel is then lifted above anything in the bottom band that would
  // cover it (joystick, find box), and capped between that edge and the top button bar so it scrolls inside instead of
  // running under the attribution strip. Rects are viewport px {left, right, top, bottom}; the panel spans x = 8 .. right.
  var PANEL = { phoneMaxW: 480, phone: 124, desktop: 44, gap: 4, minH: 120, desktopMaxW: 720 };
  function panelLayout(vw, vh, right, obstacles, topReserve) {
    var phone = vw <= PANEL.phoneMaxW, bottom = phone ? PANEL.phone : PANEL.desktop;
    (obstacles || []).forEach(function (o) {
      if (!o || o.right <= 8 || o.left >= right) return;                    // no horizontal overlap with the panel
      if (o.top < vh / 2) return;                                            // only the bottom band pushes the panel up
      bottom = Math.max(bottom, Math.ceil(vh - o.top + PANEL.gap)); });
    var maxH = Math.max(PANEL.minH, Math.floor(vh - bottom - (topReserve || 0) - PANEL.gap));
    return { bottom: bottom, maxHeight: maxH, phone: phone };
  }
  var core = { PANEL: PANEL, panelLayout: panelLayout, SRC: SRC, TILE: TILE, SNAP: SNAP, tileBox: tileBox, centredBox: centredBox, edgeMargin: edgeMargin, clipRing: clipRing, signedArea: signedArea, assessBox: assessBox, centroid: centroid, haversine: haversine, nearest: nearest, netOperator: netOperator, gridText: gridText, grade3Text: grade3Text, GA_SRC: GA_SRC, GRID_WARN: GRID_WARN, kvList: kvList, queryUrl: queryUrl, FZ: FZ, EA_GAP_MS: EA_GAP_MS, floodQueryUrl: floodQueryUrl, parseFlood: parseFlood, floodShares: floodShares, floodText: floodText };
  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }
  root.FARM_ASSESS = core;

  // ---------------- browser ----------------
  var cache = {}, fzCache = {}, lastEa = 0, lastReq = 0, subs = null, markers = [], busy = false;
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
  // One EA request per assess, cached by the box key, at least 40 s after the previous EA request.
  function fetchFlood(b, say) {
    if (fzCache[b.key]) return Promise.resolve(fzCache[b.key]);
    var gap = lastEa ? Math.max(0, lastEa + EA_GAP_MS - Date.now()) : 0;
    if (gap > 0 && say) say(Math.ceil(gap / 1000));
    return new Promise(function (ok) { setTimeout(ok, gap); }).then(function () {
      lastEa = Date.now(); var t0 = performance.now();
      return fetch(floodQueryUrl(b)).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) {
        var fl = parseFlood(j); fl.ms = Math.round(performance.now() - t0); fl.at = new Date().toISOString(); fzCache[b.key] = fl; return fl; });
    });
  }
  // Round 6: lift and cap the result panel (see panelLayout), only while the farmer result is shown (class fa-lift).
  function layoutPanel() {
    var el = document.getElementById('info'); if (!el || !el.classList.contains('fa-lift')) return;
    var vw = innerWidth, vh = innerHeight, right = vw <= PANEL.phoneMaxW ? vw - 8 : Math.min(vw - 8, 8 + PANEL.desktopMaxW);
    var obs = ['joy', 'fg'].map(function (id) { var o = document.getElementById(id); if (!o) return null; var r = o.getBoundingClientRect(); return r.height ? r : null; });
    var bar = document.getElementById('bar'), top = bar ? bar.getBoundingClientRect().bottom : 0;
    var L = panelLayout(vw, vh, right, obs, top);
    el.style.bottom = L.bottom + 'px'; el.style.maxHeight = L.maxHeight + 'px'; el.style.overflowY = 'auto';
    el.style.maxWidth = (right - 8) + 'px'; el.style.boxSizing = 'border-box'; el.style.zIndex = '5'; el.style.background = 'rgba(0,10,20,.88)';   // opaque enough that nothing behind bleeds through
    root.__farmPanel = { bottom: L.bottom, maxHeight: L.maxHeight, phone: L.phone, rect: el.getBoundingClientRect().toJSON(), scrolls: el.scrollHeight > el.clientHeight };
  }
  function clearDraw() { SIM.removeWhere(function (x) { return x.farmAssess; }); markers.forEach(function (m) { m.remove(); }); markers = []; }
  function label(lon, lat, html, border) {
    var el = document.createElement('div');
    el.style.cssText = 'font:11px sans-serif;color:#dfe;background:rgba(0,20,30,.78);border:1px solid ' + (border || '#6cf') + ';padding:3px 6px;border-radius:4px;max-width:210px;pointer-events:none;white-space:normal';
    el.innerHTML = html; markers.push(new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(SIM.map));
  }
  function draw(b, res, ctr, fz) {
    var P = PF(), c = P.fromBng((b.e0 + b.e1) / 2, (b.n0 + b.n1) / 2), an = P.placeKey(c.lat, c.lon);
    // Drape on the map's terrain: each vertex carries its ground height relative to the anchor (the render adds the
    // anchor's own height), so outlines are not hidden by hills. Terrain is the open AWS model: an estimate.
    var m = SIM.map, qe = function (lon, lat) { var v = m.queryTerrainElevation ? m.queryTerrainElevation([lon, lat]) : null; return v == null ? null : v; }, z0 = qe(an.lon, an.lat) || 0;
    var loc = function (e, n) { var g = P.fromBng(e, n), q = P.toLocal(an, g.lat, g.lon, 0); var z = qe(g.lon, g.lat); return [q.x, q.y, z == null ? 0 : z - z0]; };
    var L = [], C = [[b.e0, b.n0], [b.e1, b.n0], [b.e1, b.n1], [b.e0, b.n1]];
    for (var i = 0; i < 4; i++) { var A0 = C[i], B0 = C[(i + 1) % 4];
      for (var s = 0; s < 32; s++) { var a = loc(A0[0] + (B0[0] - A0[0]) * s / 32, A0[1] + (B0[1] - A0[1]) * s / 32), d = loc(A0[0] + (B0[0] - A0[0]) * (s + 1) / 32, A0[1] + (B0[1] - A0[1]) * (s + 1) / 32);
        L.push([a[0], a[1], a[2] + 1, d[0], d[1], d[2] + 1]); if (s === 0) L.push([a[0], a[1], a[2], a[0], a[1], a[2] + 12]); } }
    if (ctr) { var X = 60, t0 = P.toBng(ctr[1], ctr[0]);   // small cross at the map centre (the arrival point), 120 m wide
      [[-X, 0, X, 0], [0, -X, 0, X]].forEach(function (d) { var a = loc(t0.e + d[0], t0.n + d[1]), q = loc(t0.e + d[2], t0.n + d[3]);
        L.push([a[0], a[1], a[2] + 3, q[0], q[1], q[2] + 3]); });
      var o = loc(t0.e, t0.n); L.push([o[0], o[1], o[2], o[0], o[1], o[2] + 25]); }
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
    if (fz) ['fz3', 'fz2'].forEach(function (k) {   // flood zone outlines: low wire (0.6 m FZ3, 0.3 m FZ2), no posts
      var h = k === 'fz3' ? 0.6 : 0.3, big = null;
      fz.clipped[k].forEach(function (f) { f.rings.forEach(function (r) { var ll = r.map(function (p) { return loc(p[0], p[1]); });
        for (var q = 0; q < ll.length; q++) { var p1 = ll[q], p2 = ll[(q + 1) % ll.length]; L.push([p1[0], p1[1], p1[2] + h, p2[0], p2[1], p2[2] + h]); } });
        if (!big || f.area > big.area) big = f; });
      if (big) { var r0 = big.rings[0]; big.rings.forEach(function (r) { if (Math.abs(signedArea(r)) > Math.abs(signedArea(r0))) r0 = r; });
        var v = r0[Math.floor(r0.length * (k === 'fz3' ? 0.25 : 0.6))], gg = P.fromBng(v[0], v[1]);   // on the outline (zones are long and thin)
        label(gg.lon, gg.lat, '<b>' + (k === 'fz3' ? 'Flood Zone 3' : 'Flood Zone 2') + '</b> · ' + fz[k].ha.toFixed(0) + ' ha in box<br>EA Flood Map for Planning · OGL v3.0 · zones Nov 2023, edited ' + (k === 'fz3' ? '2024-05-09' : '2025-01-01'), '#39f'); }
    });
    SIM.addBlock({ lon: an.lon, lat: an.lat, anchor: an, lines: L, buf: P.wireBuffer(an, L), farmAssess: true });
  }
  function report(b, rec, res, sub, c, fz, fzErr) {
    var pct = function (x) { return (100 * x).toFixed(1) + '%'; };
    var lines = ['LAND: site box ' + (b.e0 / 1000) + ',' + (b.n0 / 1000) + ' km (2,048 m, centred on arrival, edges on 256 m BNG grid, ' + res.boxHa.toFixed(0) + ' ha). Agricultural Land Classification (provisional, 1:250k):'];
    res.rows.forEach(function (r) { lines.push('  ' + r.grade + ': ' + pct(r.share) + ' (' + r.ha.toFixed(0) + ' ha) [derived]'); });
    lines.push(grade3Text(res, false) + (res.grade3Share > 0 ? '' : ' Not a field survey.'));
    if (rec.exceeded) lines.push('  WARNING: service transfer limit hit; shares are incomplete.');
    lines.push(floodText(fz, false, fzErr));
    lines.push(gridText(sub, false));
    if (fz) lines.push('Flood source: ' + FZ.by + ', ' + FZ.name + ' (' + FZ.date + '). ' + FZ.licence + '. ' + FZ.attribution + ' One query, ' + fz.ms + ' ms, ' + fz.at.slice(0, 19) + 'Z.');
    lines.push('Source: ' + SRC.by + ', ' + SRC.name + '. ' + SRC.licence + '. ' + SRC.attribution + ' One query, ' + rec.ms + ' ms, ' + rec.at.slice(0, 19) + 'Z.');
    var cb = PF().toBng(c[1], c[0]);
    root.__farmAssess = { box: b, centreBng: { e: cb.e, n: cb.n }, edgeMarginM: edgeMargin(b, cb.e, cb.n), rows: res.rows, bmv12Share: res.bmv12Share, grade3Share: res.grade3Share, polygons: res.clipped.length, nearestSubKm: sub ? sub.m / 1000 : null, nearestSubKv: sub ? sub.kv : null, nearestSubOp: sub ? sub.op || null : null, gridLine: gridText(sub, innerWidth < 600), centre: c, exceeded: rec.exceeded, fetchedAt: rec.at,
      flood: fz ? { fz3: { ha: fz.fz3.ha, share: fz.fz3.share }, fz2: { ha: fz.fz2.ha, share: fz.fz2.share }, exceeded: fz.exceeded, fetchedAt: fz.at, ms: fz.ms } : null,
      floodError: fz ? null : (fzErr || 'no answer'), floodLine: floodText(fz, innerWidth < 600, fzErr) };
    if (innerWidth < 600) lines = [lines[0].replace(' (2,048 m, centred on arrival, edges on 256 m BNG grid, ', ' (centred on arrival, ').replace('Agricultural Land Classification (provisional, 1:250k):', 'ALC provisional 1:250k:')]
      .concat(res.rows.map(function (r) { return '  ' + r.grade.replace(/ \(outside.*\)/, '') + ' ' + pct(r.share); }),
        [grade3Text(res, true), floodText(fz, true, fzErr), gridText(sub, true),
         'Natural England ALC, OGL v3.0. © Natural England; © Crown copyright 2026.' + (fz ? ' EA flood zones, OGL v3.0, © EA 2024.' : '')]);
    SIM.info(lines.join('\n')); var el = document.getElementById('info'); if (el) { el.style.whiteSpace = 'pre-wrap'; el.classList.add('fa-lift'); el.scrollTop = 0; layoutPanel(); }
  }
  function assess() {
    if (busy) return; busy = true;
    if (SIM.map.isMoving && SIM.map.isMoving()) { busy = false; SIM.map.once('idle', assess); return; }   // R5 rule 6
    var c = SIM.map.getCenter(), t = PF().toBng(c.lat, c.lng), b = centredBox(t.e, t.n);
    if (!(t.e > 0 && t.e < 700000 && t.n > 0 && t.n < 1300000)) { SIM.info('Assess: outside Great Britain; no National Grid box.'); busy = false; return; }
    SIM.info('Assessing land in site box ' + b.key + ' (one request to Natural England)...');
    var fzErr = null, fzP = fetchFlood(b, function (s) { SIM.info('Assessing land in site box ' + b.key + '; waiting ' + s + ' s before asking the Environment Agency (at least 40 s between requests)...'); })
      .then(function (fl) { var r = floodShares(fl, b); r.ms = fl.ms; r.at = fl.at; return r; }, function (e) { fzErr = e.message; return null; });
    Promise.all([fetchAlc(b), loadSubs().catch(function () { return []; }), fzP]).then(function (x) {
      var rec = x[0], res = assessBox(rec.feats, b), sub = nearest(x[1], c.lat, c.lng), fz = x[2];
      clearDraw(); draw(b, res, [c.lng, c.lat], fz); report(b, rec, res, sub, [c.lng, c.lat], fz, fzErr);
    }).catch(function (e) { SIM.info('Assess land: Natural England service did not answer (' + e.message + '). Nothing drawn; no value guessed.'); })
      .then(function () { busy = false; });
  }
  wait(function () {
    var btn = SIM.addButton('Assess land', assess); btn.id = 'farm-assess';
    document.addEventListener('keydown', function (e) {   // "assess here" typed in the find box
      if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT' && /^\s*assess( here)?\s*$/i.test(e.target.value)) { e.preventDefault(); e.stopImmediatePropagation(); e.target.value = ''; e.target.blur(); assess(); }
    }, true);
    root.addEventListener('resize', layoutPanel);
    root.FARM_ASSESS.run = assess;
    if (/[?&]assess=1/.test(location.search)) { var go = function () { SIM.map.loaded() ? assess() : SIM.map.once('idle', assess); }; go(); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
