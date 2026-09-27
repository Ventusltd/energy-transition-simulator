// procedural.js: procedural fill ANYWHERE. Each public register asset (REPD: ground solar and battery storage) in view
// gets a wireframe anchored at its published register point and sized from its published capacity.
// Solar: the morning engine's own generator, the same one plant.js runs (engine/cmd-model.mjs derive + layoutInput,
// engine/plant-layout.mjs layoutPlantAsync), on a square of open land sized by plant.js's open-land rule. No new generator.
// Battery storage: a container yard sized by a stated, ASSUMED rule (below), since the engine has no battery generator.
// EV forecourts: not drawn, because no public register of forecourts with capacity is loaded here (said on screen).
// Calibration, said as it is: the six measured samples hold ground (DTM) only, no surface (DSM), so no layout dimension
// is calibrated on a measured sample yet (N = 0). Every dimension is an engine default or an assumption, and says so.
// Arrival and view only: the register index is the overlay's own local file; nothing is fetched on movement.
(function () {
  'use strict';
  const here = document.currentScript && document.currentScript.src ? document.currentScript.src : location.href;
  const E = n => new URL('engine/' + n, here).href;
  const LABEL = 'procedural estimate (engine formulas; calibrated on 0 measured samples: the 6 samples hold ground only)';
  const MAX_ASSETS = 4, MIN_ZOOM = 12.5;
  // Battery yard, ASSUMED (not measured, not cited): 2 h duration, 3.7 MWh per 20 ft container (6.06 x 2.44 x 2.9 m),
  // containers in rows of 10 at 3 m gaps, rows 6 m apart, fence 10 m outside.
  const BESS = { hours: 2, mwhPerUnit: 3.7, w: 6.06, d: 2.44, h: 2.9, perRow: 10, gap: 3, aisle: 6, fence: 10 };

  function start(SIM, PF) {
    Promise.all([import(E('cmd-model.mjs')), import(E('plant-layout.mjs')), fetch(E('data/cables.json')).then(r => r.json()),
      fetch(new URL('find-go.data.json', here).href).then(r => r.json())])
      .then(([CM, PL, catalogue, reg]) => mount(SIM, PF, CM, PL, catalogue, reg))
      .catch(e => SIM.info('Procedural: did not load (' + e.message + ')'));
  }

  function mount(SIM, PF, CM, PL, catalogue, reg) {
    const f = reg.fields, ix = k => f.indexOf(k);
    const rows = reg.records.map(x => ({ ref: x[ix('ref')], tech: reg.tech[x[ix('tech')]], mw: x[ix('mw10')] / 10,
      lat: x[ix('lat5')] / 1e5, lon: x[ix('lon5')] / 1e5 })).filter(r => (r.tech === 'solar' || r.tech === 'bess') && r.mw > 0);
    const map = SIM.map, cache = new Map();
    let on = false, busy = false, pending = false, shown = [];

    function place(r, lines) {                                  // local metres at the register point -> anchored block
      const a = PF.placeKey(r.lat, r.lon), off = PF.toLocal(a, r.lat, r.lon, 0), out = [];
      for (let i = 0; i < lines.length; i += 20000) {
        const L = lines.slice(i, i + 20000).map(([x0, y0, z0, x1, y1, z1]) => [x0 + off.x, y0 + off.y, z0, x1 + off.x, y1 + off.y, z1]);
        out.push({ lon: r.lon, lat: r.lat, anchor: a, lines: L, buf: PF.wireBuffer(a, L), procedural: r.ref });
      }
      return out;
    }
    const box = (out, x, y, w, d, z0, h) => { const c = [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
      for (let i = 0; i < 4; i++) { const p = c[i], q = c[(i + 1) % 4]; out.push([p[0], p[1], z0, q[0], q[1], z0], [p[0], p[1], z0 + h, q[0], q[1], z0 + h], [p[0], p[1], z0, p[0], p[1], z0 + h]); } };

    async function solar(r) {                                   // the engine's generator, as plant.js runs it
      const st = { ...CM.DEFAULTS, mw: r.mw }, env = { latDeg: r.lat, catalogue }, inp = CM.layoutInput(st, env);
      const tpl = CM.derive(st, { catalogue }).tpl, ld = { ...PL.LAYOUT_DEFAULTS, ...(inp.options || {}) }, T0 = PL.tableGeometry(st.layout, ld, tpl);
      const side = Math.sqrt(Math.ceil(tpl.counts.strings / 2) * T0.pitch * (T0.lenU + PL.LAYOUT_DEFAULTS.tableGapM) * 1.5) + 2 * st.fence, h = side / 2;
      const res = await PL.layoutPlantAsync({ boundary: [[-h, -h], [h, -h], [h, h], [-h, h]], targetMW: r.mw, layout: st.layout, template: inp.template,
        piles: false, groundAt: () => 0, grid: null, water: [], ohl: null, options: { ...inp.options, slopeLimitPct: st.slope, fenceSetbackM: st.fence } });
      const Fr = res.frame, T = res.table, P = res.params, out = [], at = (u, v, z) => [...Fr.en(u, v), z], seg = (a, b) => out.push([...a, ...b]);
      for (const fl of res.fields || [res.boundary]) for (let i = 0; i < fl.length; i++) seg(at(...fl[i], 1.5), at(...fl[(i + 1) % fl.length], 1.5));
      const lo = P.lowEdgeM, hi = lo + T.rise, t = res.tables;
      for (let q = 0; q < t.length; q += 6) { const ua = t[q], va = t[q + 1], ub = ua + (res.tableLen?.[q / 6] ?? T.lenU), vb = va + T.depth;
        const A = at(ua, va, lo), B = at(ub, va, lo), C = at(ub, vb, hi), D = at(ua, vb, hi); seg(A, B); seg(B, C); seg(C, D); seg(D, A); }
      for (const s of res.stations) { const [e, n] = Fr.en(s.u, s.v); box(out, e - 6, n - 1.5, 12, 3, 0, 3); }
      return { lines: out, text: `${r.mw} MW solar: ${res.built.tables.toLocaleString('en-GB')} tables, pitch ${T.pitch.toFixed(2)} m (engine default), ${res.built.stations} stations` };
    }
    function bess(r) {                                          // ASSUMED yard rule (see BESS above)
      const n = Math.max(1, Math.ceil(r.mw * BESS.hours / BESS.mwhPerUnit)), cols = Math.min(n, BESS.perRow), nr = Math.ceil(n / BESS.perRow);
      const W = cols * BESS.w + (cols - 1) * BESS.gap, D = nr * BESS.d + (nr - 1) * BESS.aisle, out = [];
      for (let k = 0; k < n; k++) box(out, -W / 2 + (k % BESS.perRow) * (BESS.w + BESS.gap), -D / 2 + Math.floor(k / BESS.perRow) * (BESS.d + BESS.aisle), BESS.w, BESS.d, 0, BESS.h);
      box(out, -W / 2 - BESS.fence, -D / 2 - BESS.fence, W + 2 * BESS.fence, D + 2 * BESS.fence, 0, 2.4);
      return { lines: out, text: `${r.mw} MW storage: ${n} containers (assumed 2 h, 3.7 MWh each)` };
    }

    async function refresh() {
      if (!on) return; if (busy) { pending = true; return; } busy = true;
      try {
        const c = map.getCenter(), b = map.getBounds(), k = Math.cos(c.lat * Math.PI / 180);
        const near = map.getZoom() < MIN_ZOOM ? [] : rows.filter(r => b.contains([r.lon, r.lat]))
          .map(r => ({ r, d: Math.hypot(r.lat - c.lat, (r.lon - c.lng) * k) })).sort((a, z) => a.d - z.d).slice(0, MAX_ASSETS).map(x => x.r);
        const texts = [];
        for (const r of near) {
          if (!cache.has(r.ref)) { const g = r.tech === 'bess' ? bess(r) : await solar(r); cache.set(r.ref, { blocks: place(r, g.lines), text: g.text, n: g.lines.length }); }
          texts.push(cache.get(r.ref).text);
        }
        const keep = new Set(near.map(r => r.ref));
        SIM.removeWhere(x => x.procedural && !keep.has(x.procedural));
        for (const r of near) if (!shown.includes(r.ref)) for (const bl of cache.get(r.ref).blocks) SIM.addBlock(bl);
        shown = near.map(r => r.ref);
        btn.textContent = `Procedural (${shown.length})`;
        SIM.info(shown.length ? `${LABEL}. At register points, sized from register capacity: ${texts.join('; ')}. EV forecourts: no register loaded, not drawn.`
          : `Procedural: no register solar or storage in view${map.getZoom() < MIN_ZOOM ? ' (zoom in to ' + MIN_ZOOM + ')' : ''}. ${LABEL}.`);
        window.__procedural = { label: LABEL, shown: near.map(r => ({ ref: r.ref, tech: r.tech, mw: r.mw, lat: r.lat, lon: r.lon, segments: cache.get(r.ref).n, text: cache.get(r.ref).text })) };
      } catch (e) { SIM.info('Procedural: ' + e.message); }
      busy = false; if (pending) { pending = false; refresh(); }
    }
    const btn = SIM.addButton('Procedural', () => { on = !on; btn.classList.toggle('on', on); if (on) refresh(); else { SIM.removeWhere(x => x.procedural); shown = []; btn.textContent = 'Procedural'; } });
    btn.id = 'procedural';
    map.on('moveend', refresh);
    window.__proceduralRefresh = refresh;
  }

  (function wait() { if (window.SIM && window.__pf && window.__pf.PF) start(window.SIM, window.__pf.PF); else setTimeout(wait, 100); })();
})();
