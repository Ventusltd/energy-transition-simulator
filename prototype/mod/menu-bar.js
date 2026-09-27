// menu-bar: the minimal site-world look. One thin menu bar across the top (FILE EDIT VIEW SCOPE GRID ABOUT),
// closed at rest, and five small text buttons at its right end: Walk, Drone, Build here, Satellite, Wire.
// Nothing is created twice and nothing is lost: every control already in the button row (#bar) is RE-PARENTED
// (the same element, the same click handler) into the dash or into one menu, then the row is hidden.
// Controls that modules add later through SIM.addButton land in #bar and are moved the same way.
// A moved button is marked data-sim-moved, so SIM.command still presses it by its exact label while it is hidden.
// Style tokens follow the site world: black panel, hairline edge, dim text, the wire blue for the active item.
(function () {
  const DASH = ['walk', 'drone', 'here', 'sat', 'wire'];                // element ids, in this order
  const MENUS = ['File', 'Edit', 'View', 'Scope', 'Grid', 'About'];
  // Where each control goes: by element id first, then by label (the text without a count in brackets).
  const BY_ID = { map2d: 'View', 'walk-fps': 'View', tilt: 'View', spd: 'View', dark: 'Scope', survey: 'Scope',
    rows: 'Scope', detect: 'Scope', pylons: 'Grid', 'farm-assess': 'File' };
  const BY_LABEL = [
    [/^connect here$/, 'File'], [/^assess land$/, 'File'],
    [/kv$/, 'Edit'], [/mw$/, 'Edit'], [/^(road route|straight)$/, 'Edit'],
    [/^(gpu rows|lidar onsite|scanner rows|trench x-ray|rows from satellite)$/, 'Scope'],
    [/^(pylons|substations)/, 'Grid']
  ];
  const FALLBACK = 'View';
  const label = el => (el.textContent || el.placeholder || '').replace(/\(.*?\)/g, '').trim().toLowerCase();
  const menuFor = el => {
    if (BY_ID[el.id]) return BY_ID[el.id];
    if (el.tagName === 'INPUT') return /substation/i.test(el.placeholder || '') ? 'Edit' : FALLBACK;
    const l = label(el); for (const [re, m] of BY_LABEL) if (re.test(l)) return m;
    return FALLBACK;
  };

  let bar = null, root = null, dash = null; const panels = {}, titles = {};

  function css() {
    const s = document.createElement('style'); s.id = 'menu-bar-css';
    s.textContent = ':root{--mb-line:#9cdbff;--mb-text:#cfe9ff;--mb-dim:#6f8ea6;--mb-panel:rgba(10,10,10,.86);--mb-edge:#1c2c3a}'
      + '#bar{display:none !important}'
      + '#sim-menu{position:fixed;top:0;left:0;right:0;z-index:6;display:flex;flex-wrap:wrap;align-items:stretch;'
      + 'min-height:30px;background:var(--mb-panel);border-bottom:1px solid var(--mb-edge);font:12px/1.45 system-ui,sans-serif}'
      + '#sim-menu .mb-titles{display:flex;align-items:stretch}'
      + '#sim-menu .mb-t{background:transparent;border:0;border-bottom:1px solid transparent;color:var(--mb-dim);font:inherit;padding:0 9px;min-height:30px;cursor:pointer}'
      + '#sim-menu .mb-t:hover,#sim-menu .mb-t[aria-expanded="true"]{color:#fff;border-bottom-color:var(--mb-line)}'
      + '#sim-menu .mb-dash{margin-left:auto;display:flex;gap:4px;align-items:center;padding:0 6px}'
      + '#sim-menu .mb-dash button{background:var(--mb-panel);color:var(--mb-dim);border:1px solid var(--mb-edge);border-radius:4px;'
      + 'padding:3px 9px;min-height:24px;font:inherit;cursor:pointer}'
      + '#sim-menu .mb-dash button.on,#sim-menu .mb-dash button[aria-pressed="true"]{color:#fff;border-color:var(--mb-line)}'
      + '.mb-panel{position:fixed;z-index:7;display:none;flex-direction:column;min-width:190px;max-width:calc(100vw - 16px);'
      + 'background:var(--mb-panel);border:1px solid var(--mb-edge);border-radius:0 0 6px 6px;padding:4px 0;font:12px/1.45 system-ui,sans-serif}'
      + '.mb-panel.open{display:flex}'
      + '.mb-panel>button{all:unset;box-sizing:border-box;display:block;padding:6px 12px 6px 24px;color:var(--mb-text);cursor:pointer;position:relative}'
      + '.mb-panel>button:hover{background:rgba(156,219,255,.10)}'
      + '.mb-panel>button.on::before{content:"\\2713";position:absolute;left:8px;color:var(--mb-line)}'
      + '.mb-panel>input{margin:4px 10px;font:12px monospace !important;padding:4px 6px !important;min-height:0 !important;width:auto !important;'
      + 'background:#000 !important;color:#fff !important;border:1px solid var(--mb-edge) !important;border-radius:3px !important}'
      + '.mb-panel>span{padding:4px 12px;color:var(--mb-dim);background:none !important;font:12px system-ui !important}'
      + '.mb-panel .mb-own{color:var(--mb-dim)}'
      + '.maplibregl-ctrl-top-right{top:32px}#coords-hud{top:38px !important}#fg{top:38px}#design-box{top:74px !important}'
      + '@media (max-width:600px){#sim-menu .mb-dash{margin-left:0;width:100%;padding:3px 6px;border-top:1px solid var(--mb-edge)}'
      + '#sim-menu .mb-t{padding:0 7px}.maplibregl-ctrl-top-right{top:64px}#coords-hud{top:70px !important}'
      + '#here-readout{top:66px !important}#design-box{top:66px !important}#fg{top:auto}}';
    document.head.appendChild(s);
  }

  function closeAll() { for (const m of MENUS) { panels[m].classList.remove('open'); titles[m].setAttribute('aria-expanded', 'false'); } }
  function open(m) {
    const was = panels[m].classList.contains('open'); closeAll(); if (was) return;
    const r = titles[m].getBoundingClientRect();
    panels[m].style.left = Math.max(0, Math.min(r.left, innerWidth - 200)) + 'px'; panels[m].style.top = r.bottom + 'px';
    panels[m].classList.add('open'); titles[m].setAttribute('aria-expanded', 'true');
  }

  function build() {
    css();
    root = document.createElement('nav'); root.id = 'sim-menu'; root.setAttribute('aria-label', 'Simulator menu');
    const tl = document.createElement('div'); tl.className = 'mb-titles'; root.appendChild(tl);
    for (const m of MENUS) {
      const t = document.createElement('button'); t.className = 'mb-t'; t.textContent = m.toUpperCase(); t.dataset.menu = m;
      t.setAttribute('aria-haspopup', 'true'); t.setAttribute('aria-expanded', 'false'); t.onclick = e => { e.stopPropagation(); open(m); };
      tl.appendChild(t); titles[m] = t;
      const p = document.createElement('div'); p.className = 'mb-panel'; p.dataset.menu = m; p.setAttribute('role', 'menu');
      document.body.appendChild(p); panels[m] = p;
    }
    dash = document.createElement('div'); dash.className = 'mb-dash'; root.appendChild(dash);
    document.body.appendChild(root);
    // ABOUT holds two items of its own (not moved controls): the keys, and the data sources now shown.
    const own = (txt, fn) => { const b = document.createElement('button'); b.className = 'mb-own'; b.dataset.mbOwn = '1'; b.textContent = txt; b.onclick = fn; panels.About.appendChild(b); };
    own('Controls and keys', () => window.SIM && SIM.info('Walk (1), Drone (2), Map (3). W A S D or the joystick to move, Q and E to turn, R and F to tilt, Shift for fast. Type a command in the find box: go repd 6502, walk, help.'));
    own('Credits', () => window.SIM && SIM.info(SIM.credits ? SIM.credits().join(' ') : 'Imagery: Esri, Maxar, Earthstar Geographics. Rows and grid: OpenStreetMap contributors, ODbL.'));
    // A click on any menu item runs its own handler first (bubbling), then the menu closes.
    document.addEventListener('click', e => { if (!e.target.closest || !e.target.closest('.mb-panel > input')) if (!e.target.closest || !e.target.closest('.mb-t')) closeAll(); });
    addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });
  }

  // Move one control out of #bar. The element and its handler are kept; only its parent changes.
  function place(el) {
    if (!el || el.dataset.simMoved) return;
    if (el.tagName !== 'BUTTON' && el.tagName !== 'INPUT' && el.tagName !== 'SPAN') return;
    const d = DASH.indexOf(el.id);
    el.dataset.simMoved = d >= 0 ? 'Dash' : menuFor(el);
    if (d >= 0) {
      const after = Array.from(dash.children).find(c => DASH.indexOf(c.id) > d);
      dash.insertBefore(el, after || null);
    } else panels[el.dataset.simMoved].appendChild(el);
  }
  function sweep() { for (const el of Array.from(bar.children)) place(el); }

  function start() {
    bar = document.getElementById('bar'); if (!bar || !window.SIM) return setTimeout(start, 100);
    build();
    // Modules that insert "after" a control that has moved (walk-fps after #map2d) still land in #bar, then move.
    const ins = Node.prototype.insertBefore;
    bar.insertBefore = function (n, ref) { return ins.call(this, n, ref && ref.parentNode === this ? ref : null); };
    sweep();
    new MutationObserver(sweep).observe(bar, { childList: true });
    window.SIM.menuBar = {
      menus: MENUS.slice(),
      where: () => Array.from(document.querySelectorAll('[data-sim-moved]')).map(el => ({ label: (el.textContent || el.placeholder || '').trim(), id: el.id || '', tag: el.tagName.toLowerCase(), menu: el.dataset.simMoved })),
      open, close: closeAll
    };
  }
  start();
})();
