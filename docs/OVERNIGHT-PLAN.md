# Overnight plan, 27 to 28 September (22:25 to 02:00 London, owner's GPU PC)

Base: `prototype/overlay.html` + `prototype/mod/*.js`, branch `setup/20260927`. Never restart. Gate: `npm run test:overlay`.

**Precondition (integrator, 22:25):** at 0989c7f `overlay.html` imports `place-frame.mjs` and `world/bng.mjs`/`ostn15.mjs`, which are untracked. Commit them first. Nothing joins until a clean checkout shows 12/12.

## Team
- **9 builders:** each owns ONE new `prototype/mod/<name>.js` and appends one check to `tests/overlay-smoke.cjs`. Never `overlay.html`, `index.json` or others' files.
- **10 reasoners:** no feature code. Each writes one decision note.
- **1 integrator:** adds one module per join to `mod/index.json`, only after a green run; reverts on red.
- **1 browser tester** and **1 watcher** (every 15 min).

## Loop builds (in order)
1. **`arrive.js`: arrive on real ground.**
   - Does: after find/go or `?lat&lon`, lands you in Walk at the exact point with a chevron and a ground line (satellite + open terrain; LiDAR only when surveying cached ground).
   - Reuse: `find-go.js` `run` (via `window.findGo`), `engine/journey.mjs` `standAt`, `contracts/place.v1.md`.
   - Check: after `findGo('go 52.2441634,-1.0453368')`, the result satisfies `__arrive.state()` → `mode==='walk'`, `PF.toLocal` distance from target < 1 m, `ground` matches `/satellite/` and not `/LiDAR/`.
2. **`move-speed.js`: walk 10 m/s, drone 60 m/s.**
   - Does: shows measured ground speed; the drone pin marks the ground point below.
   - Reuse: overlay `tick`/`MODES`, `PF.toLocal`.
   - Check: hold `w` for 2.0 s → `__move.metres()` is 16 to 24 in Walk and 100 to 140 in Drone.
3. **`build-place.js`: Roblox-style building.**
   - Does: "plant 50mw" places the generated block; drag or keys move and rotate it (1 m snap), with undo.
   - Reuse: `plant.js` `__designRun`, `engine/cmd-model.mjs` `createSession`, `engine/plant-layout.mjs` `layoutPlant`.
   - Check: `await __designRun('plant 50mw')`, then `__design.layout.built.mw` is between 45 and 50. After `__build.move(100,0)`, the anchor shift by `PF.toLocal` is 100 ± 0.01 m east.
4. **`dig-auto.js`: dig types along the route.**
   - Does: splits the route into open cut, soft dig and directional drill at crossings. The straight line stays the first pass.
   - Reuse: `connect-here.js` `__connectRun`/`__connect`, `engine/trench-plan.mjs` `planTrenches`, `engine/cable-route.mjs` `routeCable`.
   - Check: after `await __connectRun()`, the sum of `__dig.segments` lengths equals `__connect.route_m` ± 1. Every `type` is in the three dig types.
5. **`size-check.js`: sizing at the chosen kV.**
   - Does: sizes the cable for MW and kV; checks drop, rating and disconnection, cited by number and clause; failures in small red text.
   - Reuse: `engine/connect-here.mjs` `planConnection`, `engine/sld-connect.mjs` `kvForMW`, `engine/cable-rating.mjs` `sizeFor`, `engine/bs7671-checks.mjs` `buriedOverload`/`disconnection`.
   - Check: `__size.result.mm2 > 0`. Every `checks[i].cite` matches `/^[A-Z]{2,4}[ \d-]+ (cl\.|Table) [\d.A-Z]+$/`, and no cite is longer than 40 characters.
6. **`trench-xray.js`: X-ray the trench.**
   - Does: the trench section at any route point (depth, width, cables, ducts), labelled illustrative.
   - Reuse: `engine/trench-design.mjs` `section`, `engine/block-trenches.mjs` `hvSection`.
   - Check: `__xray.open(0.5)` returns `depth_m` from 0.6 to 2.0 and `cables >= 1`. `#xray` is visible and its text matches `/illustrative/i`.
7. **`honest-labels.js`: measured, estimated or illustrative.**
   - Does: tags every block and shows a legend.
   - Reuse: the existing block flags (`pylon`, `sat`, `gpuRows`, `lidar`, `built`, `connect`).
   - Check: after pylons, rows and a plant are drawn, `SIM.blocks.every(b => ['measured','estimated','illustrative'].includes(__labels.of(b)))` is `true`.
8. **`existing-sites.js`: see what exists.**
   - Does: operational solar and battery sites nearby as outlines (1.6 ha/MW, estimated). No names.
   - Reuse: `find-go.data.json` via `find-go.js` `loadRepd`, and `rows-geometry.js`.
   - Check: at the test point, zoomed out, `__existing.count() > 0`, and `document.body.innerText` does not match `/solar (farm|park)|energy (centre|park)/i`.
9. **`atlas-handoff.js`: switch to GridAtlas and back.**
   - Does: the GridAtlas URL per `place.v1`; restores the view on return.
   - Reuse: `contracts/place.v1.md`, `PF.placeKey`.
   - Check: `new URL(__handoff.url()).searchParams`: `latitude` equals the map centre to 6 dp, `zoom` equals the map zoom − 1, and `from === 'site-world'`. `__handoff.roundTrip()` returns an error under 0.001 m.

## Reasoning questions (a note each, by 00:30)
1. **The one coordinate function.** Deliverable: `place-frame.mjs` `PF` as the only call; list private WGS84 maths (`substations.js`, `walk-fps.js`). Rule: a module missing a `PF` round trip by more than 1 mm switches to `PF`.
2. **The one grammar.** Deliverable: one parser (`engine/cmd-grammar.mjs` `parse`) covering the find box, the Design box, "go substation" and "connect". Rule: a verb lives in exactly one grammar file; any duplicate is deleted.
3. **Performance budget for a 500 MW site.** Deliverable: blocks, vertices and draw calls for 60 fps (PC) and 30 fps (phone). Rule: over budget → LOD (outlines when far) before cutting content.
4. **Satellite row detection for bright or grey panels.** Deliverable: the thresholds and a test tile set. Rule: keep a method only if recall is at least 0.8 against mapped rows and false rows are at most 10% on both dark and bright tiles; otherwise label the area "rows not resolved".
5. **Pylon positions against satellite shadows, at scale.** Deliverable: offline GPU method, CPU witness, offset histogram. Rule: if the median offset is 15 m or more, mark those towers estimated and keep the line vertices.
6. **Module join order that keeps the test green.** Deliverable: the ordered `index.json` with its dependencies. Rule: a module joins only after its dependencies; if a join goes red, revert that join alone.
7. **The two walkers.** `walk-fps.js` uses 1.4 m/s; the owner wants 10 m/s. Deliverable: which one survives. Rule: the owner's speed wins, and there is one walk mode.
8. **Dig-type rules at crossings.** Deliverable: crossing → dig type, with standard number and clause. Rule: no cited basis → labelled illustrative.
9. **The citation format.** Deliverable: one format, `<standard> cl. <n>`, and a list of checks and their clauses. Rule: if any text is copied beyond the reference, the check is rejected.
10. **Outside-service budget.** Deliverable: request rates per host and a cache plan. Rule: at most 1 request/s per host, exponential back-off on 429/5xx, cache everything fetched.

## Browser tester (after each join)
1. Open `overlay.html?lat=52.2441634&lon=-1.0453368`: satellite, grid, readout; no console errors.
2. `go substation 132`: flies there; the compound shows voltage only.
3. `1`, hold W 2 s: about 20 m. `2`: about 120 m. The ground stays the map.
4. `plant 50mw`: a block at the centre; Achieved is 50 MW or less.
5. Connect at 132 kV: route with dig colours, size and cites; failures red.
6. X-ray: section labelled illustrative.
7. Survey: LiDAR only where cached.
8. Map, then back: same spot and heading.
9. 390 px phone view: no button covered.
10. No project or site names anywhere.

Report PASS/FAIL per step, with a screenshot of each FAIL.

## Watcher checklist (every 15 minutes, read-only)
- **Stuck:** no commit or note in 30 min → ping; 45 min → reassign.
- **Duplicate work:** two files doing one job, or a private copy of coordinate maths or grammar.
- **Broken test:** red → name the last join; the integrator reverts it.
- **Outside the owned file:** any diff to `overlay.html`, another's module, or `index.json` (except by the integrator).
- **Names:** grep diffs and screenshots for names of projects, sites or people.
- **Hammering outside services:** over 1 request/s to any host, retries without back-off, or any EA WCS call.
- Board: agent, file, state, last commit, test result.

## Stop
Agents 01:30, final push 01:45, summary 02:00. Never push to main; private data stays on the PC.
