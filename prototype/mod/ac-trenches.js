// ac-trenches: AC (LV) cable trenches at REPD 6502, drawn at project scale from mod/ac-trenches-6502.json.
// 2D PLAN: every trench at its true width on the map (fill), labelled with its circuit and duct count, with a scale bar.
// 3D: every duct as a wire at its true place in the section (trefoil groups, 0.9 m floor, 50 mm bed), each vertex set on
// the map's terrain (open terrain tiles, an estimate). STEP IN: eye height (1.7 m) at the widest station approach.
// Variant switch: side entry into the concrete bund by 1, 2, 3 or 4 faces (4 balanced as a fifth). Design switch: A (planning
// count of inverters) or B (owner reference: 28 per 10 MVA station). Everything is a MODEL: stations and tracks derived from
// imagery, inverters, routes and sections assumed; provenance travels in the JSON and is shown on screen.
// Width formula: owner design page ventus/wiring/station-geometry.mjs (n x group width + (n - 1) x gap + 0.2 m); trefoil
// envelope as cable-trench-or-drill getGroupGeometry. Cited, not copied. Plain script; attaches to window.SIM.
(function () {
  'use strict';
  const BASE = (document.currentScript && document.currentScript.src.replace(/[^/]*$/, '')) || 'mod/';
  const EYE = 1.7;
  let fillOpacity = 0.72, doc = null, design = 'B', variant = '1', on = false, show3d = true, panel = null, scale = null;

  // ---- section maths (pure; exported for the smoke check) ----
  function section(d) {
    const s = k => d.section[k].value;
    const D = s('duct_od_m'), gw = 2 * D, gh = D * (1 + Math.sqrt(3) / 2), gap = s('gap_m'), mg = s('margin_m'), bed = s('bed_m'), floor = s('depth_m');
    const width = n => n > 0 ? n * gw + (n - 1) * gap + 2 * mg : 0;
    // duct centres across the trench (x from the trench centre line) and height above the floor (z < 0 below ground)
    function ducts(n) {
      const W = width(n), out = [];
      for (let i = 0; i < n; i++) {
        const x0 = -W / 2 + mg + i * (gw + gap);
        for (const [cx, cy] of [[D / 2, D / 2], [1.5 * D, D / 2], [D, D / 2 + Math.sqrt(3) * D / 2]]) out.push([x0 + cx, -floor + bed + cy]);
      }
      return out;
    }
    return { D, gw, gh, gap, mg, bed, floor, width, ducts, cover: floor - bed - gh };
  }

  function edgesOf(d, dk, vk) {
    const V = d.designs[dk].variants[vk]; return V.counts.map(([e, n]) => ({ a: d.nodes[d.edges[e][0]], b: d.nodes[d.edges[e][1]], n }));
  }
  // metres per degree on the WGS84 ellipsoid (prime-vertical and meridian radii); a local step, true to < 1 mm over a trench width
  const mPer = lat => { const a = 6378137, f = 1 / 298.257223563, e2 = f * (2 - f), r = lat * Math.PI / 180, s = Math.sin(r) ** 2;
    return { x: a / Math.sqrt(1 - e2 * s) * Math.cos(r) * Math.PI / 180, y: a * (1 - e2) / (1 - e2 * s) ** 1.5 * Math.PI / 180 }; };

  // ---- 2D plan: true-width quads ----
  function planGeo(d, dk, vk) {
    const S = section(d), feats = [], labels = [];
    for (const { a, b, n } of edgesOf(d, dk, vk)) {
      const m = mPer((a[1] + b[1]) / 2), dx = (b[0] - a[0]) * m.x, dy = (b[1] - a[1]) * m.y, L = Math.hypot(dx, dy); if (L < 1e-3) continue;
      const w = S.width(n), ox = -dy / L * w / 2 / m.x, oy = dx / L * w / 2 / m.y;
      feats.push({ type: 'Feature', properties: { n, w: +w.toFixed(3) }, geometry: { type: 'Polygon', coordinates: [[[a[0] + ox, a[1] + oy], [b[0] + ox, b[1] + oy], [b[0] - ox, b[1] - oy], [a[0] - ox, a[1] - oy], [a[0] + ox, a[1] + oy]]] } });
      if (L >= 12) labels.push({ type: 'Feature', properties: { t: `${n} x 3 ducts · ${w.toFixed(2)} m` }, geometry: { type: 'LineString', coordinates: [a, b] } });
    }
    const bunds = d.bunds.map(B => ({ type: 'Feature', properties: { id: B.id }, geometry: { type: 'Polygon', coordinates: [[...B.wall, B.wall[0]]] } }));
    return { trench: { type: 'FeatureCollection', features: feats }, labels: { type: 'FeatureCollection', features: labels }, bunds: { type: 'FeatureCollection', features: bunds } };
  }
  function addPlan(map) {
    if (!doc || !on) return;
    const g = planGeo(doc, design, variant);
    for (const [id, data] of [['act-trench', g.trench], ['act-bunds', g.bunds]]) {
      if (map.getSource(id)) map.getSource(id).setData(data); else map.addSource(id, { type: 'geojson', data });
    }
    const below = map.getLayer('wire') ? 'wire' : undefined;   // under the wire layer, so the 3D ducts stay visible
    if (!map.getLayer('act-trench')) map.addLayer({ id: 'act-trench', type: 'fill', source: 'act-trench', paint: {
      'fill-color': ['step', ['get', 'n'], '#ffd23f', 9, '#ff8c1a', 29, '#ff2d55'], 'fill-opacity': fillOpacity } }, below);
    if (!map.getLayer('act-bunds')) map.addLayer({ id: 'act-bunds', type: 'line', source: 'act-bunds', paint: { 'line-color': '#ffffff', 'line-width': 2 } }, below);
    labelView();
  }
  // Labels as DOM markers (the satellite style has no glyphs): the widest segments in view, zoom 17 and closer.
  let marks = [];
  function labelView() {
    const map = window.SIM.map; for (const m of marks) m.remove(); marks = [];
    if (!doc || !on || map.getZoom() < 17) return;
    const bb = map.getBounds(), S = section(doc), inView = p => bb.contains(p);
    const segs = edgesOf(doc, design, variant).map(E => ({ ...E, mid: [(E.a[0] + E.b[0]) / 2, (E.a[1] + E.b[1]) / 2] })).filter(E => inView(E.mid))
      .map(E => { const m = mPer(E.mid[1]); return { ...E, L: Math.hypot((E.b[0] - E.a[0]) * m.x, (E.b[1] - E.a[1]) * m.y) }; }).filter(E => E.L >= 6)
      .sort((x, y) => y.n - x.n || y.L - x.L).slice(0, 60);
    for (const E of segs) {
      const el = document.createElement('div'); el.className = 'act-label';
      el.style.cssText = 'font:11px sans-serif;color:#fff;background:rgba(0,0,0,.6);padding:1px 4px;border-radius:3px;white-space:nowrap;pointer-events:none';
      el.textContent = `${E.n}x3 ducts ${S.width(E.n).toFixed(2)} m`;
      marks.push(new maplibregl.Marker({ element: el }).setLngLat(E.mid).addTo(map));
    }
  }
  function removePlan(map) { for (const m of marks) m.remove(); marks = []; for (const id of ['act-bunds', 'act-trench']) { if (map.getLayer(id)) map.removeLayer(id); if (map.getSource(id)) map.removeSource(id); } }

  // ---- own wire layer: same anchoring as the overlay's wire layer (anchor Mercator point in the matrix, m * T(o)), but drawn
  // with the depth test OFF so ducts below the terrain show as an X-ray. Two colours: ducts amber, trench edges and bund cyan.
  const wires = [];
  const actWire = {
    id: 'act-wire', type: 'custom', renderingMode: '3d',
    onAdd(m, gl) {
      const vs = 'uniform mat4 u; attribute vec3 p; void main(){ gl_Position = u * vec4(p, 1.0); }';
      const fs = 'precision mediump float; uniform vec4 c; void main(){ gl_FragColor = c; }';
      const sh = (t, src) => { const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); return o; };
      this.pr = gl.createProgram(); gl.attachShader(this.pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(this.pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(this.pr); this.buf = gl.createBuffer();
    },
    render(gl, args) {
      const m = args.defaultProjectionData?.mainMatrix || args, map = window.SIM.map, PF = window.SIM.PF || window.__pf.PF;
      gl.useProgram(this.pr); gl.disable(gl.DEPTH_TEST);
      for (const w of wires) {
        const a = w.anchor; let gz = 0; try { gz = (map.queryTerrainElevation && map.queryTerrainElevation([a.lon, a.lat])) || 0; } catch (e) { gz = 0; } const o = PF.toMercator(a.lat, a.lon, gz);
        const r = Array.from(m); for (let k = 0; k < 4; k++) r[12 + k] = m[k] * o.x + m[4 + k] * o.y + m[8 + k] * o.z + m[12 + k];
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.bufferData(gl.ARRAY_BUFFER, w.buf, gl.DYNAMIC_DRAW);
        const loc = gl.getAttribLocation(this.pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.pr, 'u'), false, new Float32Array(r)); gl.uniform4fv(gl.getUniformLocation(this.pr, 'c'), w.color);
        gl.drawArrays(gl.LINES, 0, w.buf.length / 3);
      }
    }
  };
  function ensureWire(map) { if (on && !map.getLayer('act-wire')) map.addLayer(actWire); }

  // ---- 3D: every duct a wire, on the ground ----
  function build3d(S, PF) {
    wires.length = 0; S.repaint(); if (!show3d || !doc) return 0; ensureWire(S.map);
    const map = S.map, sec = section(doc), eds = edgesOf(doc, design, variant), groups = new Map();
    const q = (lo, la) => { try { const g = map.queryTerrainElevation ? map.queryTerrainElevation([lo, la]) : 0; return g == null ? 0 : g; } catch (e) { return 0; } };   // no DEM tile yet: ground offset 0 (said in the info line)
    for (const E of eds) {   // group by nearest bund so every block is local
      const mx = (E.a[0] + E.b[0]) / 2, my = (E.a[1] + E.b[1]) / 2; let bi = 0, bd = Infinity;
      doc.bunds.forEach((B, i) => { const d = (B.centre[0] - mx) ** 2 + ((B.centre[1] - my) * 1.6) ** 2; if (d < bd) { bd = d; bi = i; } });
      if (!groups.has(bi)) groups.set(bi, []); groups.get(bi).push(E);
    }
    let nl = 0;
    for (const [bi, list] of groups) {
      const B = doc.bunds[bi], an = PF.placeKey(B.centre[1], B.centre[0]), g0 = q(an.lon, an.lat), L = [], Ld = [];
      for (const { a, b, n } of list) {
        const pa = PF.toLocal(an, a[1], a[0], 0), pb = PF.toLocal(an, b[1], b[0], 0), dx = pb.x - pa.x, dy = pb.y - pa.y, len = Math.hypot(dx, dy); if (len < 1e-3) continue;
        const ux = -dy / len, uy = dx / len, za = q(a[0], a[1]) - g0, zb = q(b[0], b[1]) - g0;
        for (const [x, z] of sec.ducts(n)) { Ld.push([pa.x + ux * x, pa.y + uy * x, za + z, pb.x + ux * x, pb.y + uy * x, zb + z]); nl++; }
        const w = sec.width(n) / 2;   // trench walls at ground level (outline of the cut)
        L.push([pa.x + ux * w, pa.y + uy * w, za, pb.x + ux * w, pb.y + uy * w, zb], [pa.x - ux * w, pa.y - uy * w, za, pb.x - ux * w, pb.y - uy * w, zb]);
      }
      // the concrete bund: wall outline at ground and at +0.5 m [assumed height], and two transformer units 6.1 x 2.9 x 3.0 m [planning unit size; placing estimated]
      const wl = B.wall.map(p => PF.toLocal(an, p[1], p[0], 0)), zc = q(B.centre[0], B.centre[1]) - g0;
      for (let k = 0; k < 4; k++) { const p = wl[k], r = wl[(k + 1) % 4]; L.push([p.x, p.y, zc, r.x, r.y, zc], [p.x, p.y, zc + 0.5, r.x, r.y, zc + 0.5], [p.x, p.y, zc, p.x, p.y, zc + 0.5]); }
      const c = PF.toLocal(an, B.centre[1], B.centre[0], 0), ex = [(wl[1].x - wl[0].x), (wl[1].y - wl[0].y)], el = Math.hypot(...ex), ux = ex[0] / el, uy = ex[1] / el;
      const long = B.size_m[0] >= B.size_m[1], ax = long ? [ux, uy] : [-uy, ux], ay = [-ax[1], ax[0]], off = (long ? B.size_m[0] : B.size_m[1]) / 4;
      for (const s of [-1, 1]) {
        const cx = c.x + ax[0] * off * s, cy = c.y + ax[1] * off * s, P = [[-1.45, -3.05], [1.45, -3.05], [1.45, 3.05], [-1.45, 3.05]].map(([i, j]) => [cx + ax[0] * i + ay[0] * j, cy + ax[1] * i + ay[1] * j]);
        for (let k = 0; k < 4; k++) { const p = P[k], r = P[(k + 1) % 4]; L.push([p[0], p[1], zc, r[0], r[1], zc], [p[0], p[1], zc + 3, r[0], r[1], zc + 3], [p[0], p[1], zc, p[0], p[1], zc + 3]); }
      }
      wires.push({ anchor: an, buf: PF.wireBuffer(an, Ld), color: [1.0, 0.72, 0.1, 1.0], ducts: Ld.length });
      wires.push({ anchor: an, buf: PF.wireBuffer(an, L), color: [0.5, 0.91, 1.0, 1.0], ducts: 0 });
    }
    S.repaint(); return nl;
  }

  // ---- step in: eye height in the widest station approach ----
  function stepIn() {
    const S = window.SIM, map = S.map, W = doc.designs[design].variants[variant].widest_approach;
    fillOpacity = 0.25; if (map.getLayer('act-trench')) map.setPaintProperty('act-trench', 'fill-opacity', fillOpacity);   // see the ducts below
    const lon = (W.a[0] + W.b[0]) / 2, lat = (W.a[1] + W.b[1]) / 2, B = doc.bunds.find(b => b.id === W.bund);
    const m = mPer(lat), yaw = Math.atan2((B.centre[0] - lon) * m.x, (B.centre[1] - lat) * m.y) * 180 / Math.PI;   // face the bund
    if (window.walkFps) { map.jumpTo({ center: [lon, lat], zoom: 19, bearing: yaw, pitch: 80 }); window.walkFps.enter(); window.walkFps.set({ lon, lat, yaw, pitch: 78 }); }
    else {   // same placement rule as walk-fps.js place(): centre ahead of the eye so the camera sits at 1.7 m
      const p = 78 * Math.PI / 180, b = yaw * Math.PI / 180, d = EYE / Math.cos(p), ahead = d * Math.sin(p);
      const cLa = lat + Math.cos(b) * ahead / m.y, cLo = lon + Math.sin(b) * ahead / m.x, tr = map.transform, H = map.getCanvas().clientHeight || 600;
      const mpp = d / (tr.cameraToCenterDistance || 1.5 * H); map.setMaxZoom(24);
      map.jumpTo({ center: [cLo, cLa], zoom: Math.min(24, Math.log2(40075016.686 * Math.cos(cLa * Math.PI / 180) / (512 * mpp))), bearing: yaw, pitch: 78 });
    }
    setTimeout(() => redraw().then(() => info(`Stepped in at the ${W.bund} approach (ground heights refreshed).`)), 1500);   // terrain tiles near the eye are loaded now
    info(`Stepped in: eye ${EYE} m, in the widest approach to bund ${W.bund}: ${W.circuits} circuits (${3 * W.circuits} ducts), trench ${W.width_m.toFixed(2)} m wide at true scale. V leaves.`);
  }

  function info(extra) {
    if (!doc) return; const V = doc.designs[design].variants[variant], T = V.totals, c = doc.cover_m;
    window.SIM.info(`REPD 6502 AC trenches, MODEL. Design ${doc.designs[design].label}. Bund entry: ${V.label}. ` +
      `Trench ${T.trench_km} km, cable ${T.cable_km} km (plan lengths), runs ${T.run_m.min}-${T.run_m.max} m (median ${T.run_m.median}); widest ${T.widest_circuits} circuits = ${T.widest_m.toFixed(2)} m. ` +
      `Cover ${c.value.toFixed(3)} m at the 0.9 m floor: ${c.finding} (${c.reference_m} m, ${c.reference}). ` +
      `Checks: cables conserved ${V.checks.cables_conserved}, counts mismatch ${V.checks.segment_counts_mismatch}, row crossings ${V.checks.edges_crossing_a_row}. ` +
      `Stations and tracks estimated from Esri imagery; inverters, routes and sections assumed. ` + (extra || ''));
  }

  async function redraw() {
    const S = window.SIM; if (S.map.getLayer('act-trench') && !(window.walkFps && window.walkFps.state().on)) { fillOpacity = 0.72; S.map.setPaintProperty('act-trench', 'fill-opacity', fillOpacity); }
    const PF = S.PF || (window.__pf && window.__pf.PF); addPlan(S.map); const n = build3d(S, PF);
    if (panel) for (const b of panel.querySelectorAll('button[data-k]')) b.classList.toggle('on', b.dataset.v === (b.dataset.k === 'd' ? design : variant));
    info(); return n;
  }
  async function toggle(btn) {
    const S = window.SIM; on = !on; btn.classList.toggle('on', on);
    if (!on) { removePlan(S.map); wires.length = 0; if (S.map.getLayer('act-wire')) S.map.removeLayer('act-wire'); if (panel) panel.style.display = 'none'; if (scale) { S.map.removeControl(scale); scale = null; } return; }
    if (!doc) doc = await (await fetch(BASE + 'ac-trenches-6502.json')).json();
    if (!panel) makePanel(); panel.style.display = 'flex';
    if (!scale) { scale = new maplibregl.ScaleControl({ maxWidth: 160, unit: 'metric' }); S.map.addControl(scale, 'bottom-left'); }
    S.map.jumpTo({ center: doc.register_point, zoom: 15.2, pitch: 0, bearing: 0 });
    S.map.once('idle', () => redraw());
    await redraw();
  }
  function makePanel() {
    panel = document.createElement('div'); panel.id = 'act-panel';
    panel.style.cssText = 'position:absolute;right:8px;top:150px;z-index:6;display:flex;flex-wrap:wrap;gap:4px;max-width:300px;background:rgba(0,0,0,.72);padding:6px;border-radius:6px;font:12px sans-serif;color:#dfe';
    const add = (label, k, v, title) => { const b = document.createElement('button'); b.textContent = label; b.dataset.k = k; b.dataset.v = v; b.title = title || ''; b.onclick = () => { if (k === 'd') design = v; else variant = v; redraw(); }; panel.appendChild(b); };
    panel.append('Design'); add('A', 'd', 'A', 'planning count, about 2,000 inverters'); add('B', 'd', 'B', 'owner reference, 28 per station');
    panel.append('Sides'); for (const v of ['1', '2', '3', '4']) add(v, 'v', v, v + ' face(s), nearest allowed face'); add('4=', 'v', '4b', 'four faces, balanced');
    const s = document.createElement('button'); s.textContent = 'Step in'; s.id = 'act-step'; s.onclick = stepIn; panel.appendChild(s);
    const t = document.createElement('button'); t.textContent = '3D ducts'; t.classList.add('on'); t.onclick = () => { show3d = !show3d; t.classList.toggle('on', show3d); redraw(); }; panel.appendChild(t);
    document.body.appendChild(panel);
  }
  function init() {
    if (!window.SIM || !window.SIM.map) return setTimeout(init, 200);
    const S = window.SIM, b = S.addButton('AC trenches', () => toggle(b)); b.id = 'act-btn';
    S.map.on('style.load', () => setTimeout(() => { addPlan(S.map); ensureWire(S.map); }, 50)); S.map.on('moveend', labelView);
    window.__acTrenches = { section, planGeo, edgesOf, toggle: () => toggle(b), select: (d, v) => { if (d) design = d; if (v) variant = v; return redraw(); }, stepIn,
      state: () => ({ on, design, variant, loaded: !!doc, wireBlocks: wires.length, ductLines: wires.reduce((t, w) => t + w.ducts, 0) }), doc: () => doc };
  }
  init();
})();
