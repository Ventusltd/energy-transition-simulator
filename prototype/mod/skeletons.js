// mod/skeletons.js - three wireframe skeletons from the wire-frame-scanner, drawn through window.SIM (the one wire layer).
// Plain script. The geometry is NOT computed here: tools/export_skeletons.py runs the scanner's own Python functions
// (structures.tower_skeleton, pylon.lattice_pylon, fictional.solar_block; repo Ventusltd/wire-frame-scanner, pinned
// commit and file hashes inside the JSON) and writes skeletons.data.json. This file only places those line segments,
// authored in local metres (x east, y north, z up), at the map centre via the overlay's place frame (window.__pf.PF).
// Illustrative example, dimensions assumed: a generic tower, a 400 kV-class lattice pylon with assumed dimensions and
// fictional solar rows. Nothing is measured, nothing is a real asset; ground is taken as flat at the anchor.
// Not listed in mod/index.json: a test injects it (tests/skeletons-smoke.cjs).
(function () {
  'use strict';
  const here = document.currentScript && document.currentScript.src ? document.currentScript.src : new URL('mod/', location.href).href;
  const DATA = new URL('skeletons.data.json', here).href;
  let SIM, PF, data = null, on = false, btn = null;

  const ready = () => { SIM = window.SIM; PF = window.__pf && window.__pf.PF; return SIM && SIM.map && PF; };
  (function wait(n) { if (ready()) start(); else if (n < 200) setTimeout(() => wait(n + 1), 100); })(0);

  function start() {
    btn = SIM.addButton('Skeletons', toggle);
    btn.id = 'skeletons';
  }

  const load = () => data ? Promise.resolve(data) : fetch(DATA).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(j => (data = j));

  function clear() { SIM.removeWhere(b => b.skeleton); }

  function draw(d) {
    const c = SIM.map.getCenter(), a = PF.placeKey(c.lat, c.lng), off = PF.toLocal(a, c.lat, c.lng, 0);
    let n = 0;
    for (const o of d.objects) {
      const [dx, dy] = o.place_m, v = o.lines, L = [];
      for (let i = 0; i + 5 < v.length; i += 6) {
        const x = off.x + dx, y = off.y + dy;
        L.push([v[i] + x, v[i + 1] + y, v[i + 2], v[i + 3] + x, v[i + 4] + y, v[i + 5]]);
      }
      SIM.addBlock({ lon: c.lng, lat: c.lat, anchor: a, lines: L, buf: PF.wireBuffer(a, L), skeleton: o.id, provenance: o.provenance });
      n += L.length;
    }
    return n;
  }

  const msgTitle = d => `${d.info} Provenance: ${d.provenance}.`;
  function toggle() {
    if (on) { clear(); on = false; btn.classList.remove('on'); btn.textContent = 'Skeletons'; SIM.info('Skeletons removed.'); return; }
    load().then(d => {
      clear();
      const n = draw(d); on = true; btn.classList.add('on'); btn.textContent = `Skeletons (${n}, illustrative)`; btn.title = msgTitle(d);
      const parts = d.objects.map(o => `${o.id} ${o.n_lines}`).join(', ');
      const msg = `${d.info} ${n} lines (${parts}) at the map centre; ground taken as flat. Provenance: ${d.provenance}; scanner commit ${String(d.source.commit || 'unknown').slice(0, 7)}.`;
      SIM.info(msg);
      window.__skeletons = { lines: n, expected: d.n_lines, info: msg, objects: d.objects.map(o => ({ id: o.id, n: o.n_lines, provenance: o.provenance })) };
    }).catch(e => SIM.info('Skeletons: the data did not load (' + e.message + ')'));
  }
})();
