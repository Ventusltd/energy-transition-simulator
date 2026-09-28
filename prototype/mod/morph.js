// mod/morph.js - the wire world flattened and raised: one number t in [0, 1] that scales every height.
// t = 0 is the flat drawing (towers are points, conductors lie on the ground, ducts rise to the surface); t = 1 is
// today's 3D exactly (nothing scaled). plan-view.js drives it: zoom in past the plan threshold and t eases 0 -> 1
// over MS with a cubic in-out curve while the pitch eases 0 -> 60; zoom out and the reverse happens.
// How: every custom layer keeps its own shader ("u * vec4(p, 1)", p anchor-relative, the anchor folded into u at
// its ground height). Scaling the third column of u by t scales p.z, so every block flattens onto its own ground.
// While t < 1 this module wraps each custom layer's render() and, for that call only, replaces gl.uniformMatrix4fv
// with one that (a) sets the layer's own u_zscale uniform when its program has one (the overlay's wire layer), or
// (b) scales column 2 of the matrix. At t = 1 the wrap returns to the layer's render at once: no cost, no change.
// Nothing here edits another module's file; the wrap is runtime only and removable (SIM.morph.release()).
// Test hook: SIM.morph = { set(t), animate(to, ms, onFrame) -> Promise, cancel(), state(), ease(x), release() }.
(function () {
  'use strict';
  const MS = 1200;
  const st = { t: 1, active: false, wrapped: [], last: { s: 1, calls: 0, uniform: 0, matrix: 0 }, anim: null, frames: 0 };
  let map;
  const ease = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;           // cubic in-out
  function wait(n) { const S = window.SIM; if (S && S.map) init(S); else if (n < 400) setTimeout(() => wait(n + 1), 50); }

  // The per-call interceptor: called in place of gl.uniformMatrix4fv while a wrapped layer renders at t < 1.
  function scaled(gl, orig, loc, tr, m) {
    st.last.calls++;
    const pr = gl.getParameter(gl.CURRENT_PROGRAM), zl = pr ? gl.getUniformLocation(pr, 'u_zscale') : null;
    if (zl) { st.last.uniform++; gl.uniform1f(zl, st.t); return orig.call(gl, loc, tr, m); }
    st.last.matrix++;
    const r = new Float32Array(m);                     // column-major mat4: column 2 = indices 8..11
    if (tr) { r[2] *= st.t; r[6] *= st.t; r[10] *= st.t; r[14] *= st.t; } else { r[8] *= st.t; r[9] *= st.t; r[10] *= st.t; r[11] *= st.t; }
    return orig.call(gl, loc, tr, r);
  }
  function wrap(id) {
    const L = map.getLayer(id); const impl = L && L.implementation; if (!impl || impl.__morph) return false;
    const inner = impl.render; if (typeof inner !== 'function') return false;
    const w = function (gl, args) {
      if (st.t >= 1 || !st.active) return inner.call(this, gl, args);
      const orig = gl.uniformMatrix4fv; gl.uniformMatrix4fv = (loc, tr, m) => scaled(gl, orig, loc, tr, m);
      try { return inner.call(this, gl, args); } finally { gl.uniformMatrix4fv = orig; }
    };
    w.__inner = inner; impl.render = w; impl.__morph = w; st.wrapped.push(id); return true;
  }
  // Every custom layer in the live order (the overlay's wire, the procedural ghost, the trench wires, the streamed
  // ground, the survey grid). Other modules may wrap the same render later (wire-look does); the interceptor works from
  // inside, whichever order the wraps ended up in, because it reads the program that is current at the call.
  function wrapAll() {
    const ids = map.getLayersOrder ? map.getLayersOrder() : (map.style && map.style._order) || [];
    for (const id of ids) { const L = map.getLayer(id); if (L && L.type === 'custom') wrap(id); }
  }
  function release() { for (const id of st.wrapped) { const L = map.getLayer(id), impl = L && L.implementation; if (impl && impl.render === impl.__morph) impl.render = impl.__morph.__inner; if (impl) delete impl.__morph; } st.wrapped = []; st.active = false; }

  function set(t) {
    t = Math.max(0, Math.min(1, +t || 0)); st.t = t; st.last.s = t;
    if (t < 1) { st.active = true; wrapAll(); } else st.active = false;
    st.frames++; map.triggerRepaint();
  }
  function cancel() { if (st.anim) { cancelAnimationFrame(st.anim.raf); const a = st.anim; st.anim = null; a.reject && a.resolve(false); } }
  // Eases t from its current value to `to` over ms with the cubic; onFrame(e, t) each frame (e = eased progress 0..1).
  function animate(to, ms, onFrame) {
    cancel(); const from = st.t, t0 = performance.now(), D = ms == null ? MS : ms;
    return new Promise(resolve => {
      const a = { resolve, raf: 0, from, to, t0 };
      st.anim = a;
      const step = () => {
        if (st.anim !== a) return;
        const x = Math.min(1, (performance.now() - t0) / D), e = ease(x);
        set(from + (to - from) * e); try { onFrame && onFrame(e, st.t, x); } catch (err) { console.warn('morph frame', err); }
        if (x < 1) a.raf = requestAnimationFrame(step); else { st.anim = null; resolve(true); }
      };
      a.raf = requestAnimationFrame(step);
    });
  }
  function init(S) {
    if (S.morph) return; map = S.map;
    map.on('style.load', () => { st.wrapped = []; if (st.active) setTimeout(wrapAll, 100); });
    S.morph = { set, animate, cancel, release, ease, MS,
      state: () => ({ t: +st.t.toFixed(4), active: st.active, animating: !!st.anim, wrapped: st.wrapped.slice(), last: Object.assign({}, st.last), frames: st.frames }) };
  }
  wait(0);
})();
