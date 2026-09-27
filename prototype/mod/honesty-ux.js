// honesty-ux: one typed grammar for every module, and credits that stay on screen.
// 1. SIM.command(line): the one command grammar. "<verb> <rest>".
//    - A module registers its own verbs with SIM.registerCommand(verb, fn(rest, line) -> text|Promise<text>, help).
//    - A line that EXACTLY equals a bar button's label presses it: "walk", "drone", "wire", "pylons", "solar rows".
//    - Every other line goes to the find box unchanged (window.findGo): "go solar", "solar", "TQ 30624 78388".
//      "Unknown command" only when there is no find box.
//    - "help" lists every verb; "credits" lists every data source shown now.
//    The find box (#fg-in) already on screen takes the whole grammar: Enter on a line that is not "go ..." runs SIM.command.
// 2. Credits strip (#credits): the attribution for what is drawn stays on screen. #info is overwritten by
//    each module's message, so a credit written there is lost; the strip is not.
//    - Always: GridAtlas (grid layers, built on OpenStreetMap, ODbL).
//    - Environment Agency LiDAR, Open Government Licence v3.0, whenever measured ground is drawn:
//      a drawn block tagged lidar or lidarStream (the R5 stream), or a module that calls SIM.credit('ea-lidar', true).
//    - Modules add their own with SIM.credit(key, text) and drop it with SIM.credit(key, false).
(function () {
  'use strict';
  const EA = 'Measured ground: Environment Agency LiDAR. Contains public sector information licensed under the Open Government Licence v3.0.';
  const GA = 'Grid layers: GridAtlas, built on © OpenStreetMap contributors (ODbL).';
  const cmds = new Map();          // verb -> { fn, help }
  const credits = new Map();       // key -> text (only while active)
  let strip = null;

  function whenSim(cb) { if (window.SIM && window.SIM.map) return cb(window.SIM); setTimeout(() => whenSim(cb), 100); }

  const label = b => b.textContent.replace(/\(.*?\)/g, '').trim().toLowerCase();
  const buttons = () => Array.from(document.querySelectorAll('#bar button, button[data-sim-moved]')).filter(b => label(b));

  function help() {
    const own = Array.from(cmds.entries()).map(([v, c]) => c.help ? `${v} (${c.help})` : v);
    const go = window.findGo && !cmds.has('go') ? ['go <place> (find box)'] : [];
    const bt = buttons().map(label);
    return 'Commands: ' + own.concat(go).join(' · ') + ' | Buttons: ' + bt.join(' · ');
  }

  // A registered verb runs; a line that EXACTLY equals a button label presses it; every other line goes to the
  // find box unchanged (window.findGo), so a search is never lost to a button whose label merely starts the same.
  async function command(line) {
    const t = String(line || '').trim(); if (!t) return '';
    const sp = t.search(/\s/), verb = (sp < 0 ? t : t.slice(0, sp)).toLowerCase(), rest = sp < 0 ? '' : t.slice(sp + 1).trim();
    if (cmds.has(verb)) return String(await cmds.get(verb).fn(rest, t) ?? '');
    const want = t.toLowerCase(), b = buttons().find(x => label(x) === want);
    if (b) { b.click(); return `Pressed "${b.textContent.trim()}".`; }
    if (window.findGo) return String(await window.findGo(t) ?? '');
    return `Unknown command "${verb}". Type help.`;
  }

  function activeCredits(S) {
    const out = [GA];
    const ea = credits.has('ea-lidar') || S.blocks.some(b => b && (b.lidar || b.lidarStream));
    if (ea) out.push(EA);
    for (const [k, v] of credits) if (k !== 'ea-lidar' && typeof v === 'string') out.push(v);
    return out;
  }

  function render(S) {
    if (!strip) return;
    const t = activeCredits(S).join(' ');
    if (strip.textContent !== t) strip.textContent = t;
  }

  whenSim(S => {
    const css = document.createElement('style');
    // The strip takes the bottom edge; the map's own attribution (bottom-right) and #info are lifted above it, so
    // no credit covers another. On a phone the strip wraps to at most three lines.
    css.textContent = '#credits{position:absolute;left:0;right:0;bottom:0;z-index:2;font:11px sans-serif;color:#cde;'
      + 'background:rgba(0,0,0,.7);padding:2px 8px;pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
      + '.maplibregl-ctrl-bottom-right,.maplibregl-ctrl-bottom-left{bottom:18px}#info{bottom:44px !important}'
      + '@media (max-width:600px){#credits{white-space:normal;font-size:10px;line-height:12px}'
      + '.maplibregl-ctrl-bottom-right,.maplibregl-ctrl-bottom-left{bottom:40px}#info{bottom:124px !important;right:8px}}';
    document.head.appendChild(css);
    strip = document.createElement('div'); strip.id = 'credits'; strip.setAttribute('role', 'contentinfo');
    document.body.appendChild(strip);

    S.registerCommand = (verb, fn, helpText) => { cmds.set(String(verb).toLowerCase(), { fn, help: helpText || '' }); };
    S.command = command;
    S.credit = (key, text) => {
      if (text === false || text == null) credits.delete(key);
      else credits.set(key, text === true ? EA : String(text));
      render(S);
    };
    S.credits = () => activeCredits(S);
    S.registerCommand('help', () => help(), 'list commands');
    S.registerCommand('credits', () => activeCredits(S).join(' '), 'data sources now shown');

    // The find box on screen takes the whole grammar. Capture phase runs before the box's own Enter handler,
    // so find-go keeps "go ..." and every other verb reaches SIM.command.
    document.addEventListener('keydown', async e => {
      const inp = e.target;
      if (!inp || inp.id !== 'fg-in' || e.key !== 'Enter') return;
      const v = inp.value.trim(), verb = v.split(/\s+/)[0].toLowerCase();
      if (!v || (verb === 'go' && !cmds.has('go'))) return;
      e.stopImmediatePropagation(); e.preventDefault();
      const msg = document.getElementById('fg-msg');
      try { const r = await command(v); if (msg) msg.textContent = r; } catch (err) { if (msg) msg.textContent = 'Command failed: ' + err.message; }
      inp.blur();
    }, true);
    const fixPlaceholder = () => { const i = document.getElementById('fg-in'); if (i && !/help/.test(i.placeholder)) i.placeholder = 'go repd 6502 · walk · help'; else if (!i) setTimeout(fixPlaceholder, 300); };
    fixPlaceholder();

    render(S);
    setInterval(() => render(S), 1000);
  });
})();
