# CORE: the one loop of the overlay

Source: /home/user/sim2/wt-core (Ventusltd/energy-transition-simulator), branch setup/20260927 at 0989c7f. Read-only;
nothing was run in a browser. Every claim below comes from reading the files or from grep/wc.

## 1. The paragraph

Inputs: a place (the map centre, or `?lat=&lon=`, overlay.html:48-49), numbers typed into the Design box
(plant.js:148, run through the engine's `createSession`, plant.js:114) and GridAtlas line and substation GeoJSON
(overlay.html:44, 55-66). The one transform: every object is lines in local metres (east, north, up). `placed()`
takes `PF.placeKey(lat, lon)` as a 100 m lattice anchor, shifts the lines by `PF.toLocal` and packs them with
`PF.wireBuffer` into anchor-relative float32 Mercator (overlay.html:28-32). At draw time the anchor's float64 Mercator
point goes into MapLibre's own matrix (overlay.html:34-38, 93-96; perf.js:112 replaces this at runtime, using
perf.js:21-23). Inside Great Britain, `PF.useWorld` gets bng.mjs plus OSTN15 (overlay.html:22-25). Caveat:
place-frame.mjs and world/*.mjs are not in this commit. Outputs: wireframe blocks in the map's custom layer, labels
such as "not measured" (plant.js:131), and 10/60/300 m/s movement, x3 with Shift (overlay.html:113-142).

**Blocking finding.** overlay.html:21-23 statically imports `./place-frame.mjs`, `./world/bng.mjs` and
`./world/ostn15.mjs`. None of these exists under prototype/. `git log --all -- prototype/place-frame.mjs 'prototype/world/*'`
returns nothing, and `git ls-files | grep place-frame|ostn15|world/bng` is empty. The smoke server
(tests/overlay-smoke.cjs:9-13) serves only prototype/, so these would 404. In browsers, a failed static import stops the
whole inline module from running. On that reading, `window.SIM` and `window.__pf` are never defined, and the ten mods
wait for them without end. This is a reading of the code, not a run. The transform's own code (placeKey, toLocal,
wireBuffer, toMercator, toBng, fromBng, bngToWire, wireToBng, useWorld) cannot be checked in this repo. The
lattice size, the WGS84 ellipsoid and the OSTN15 use are stated only in comments (overlay.html:19-20, 26-27).
prototype/mod/engine/bng.mjs is present, but only engine/journey.mjs:10 imports it. overlay.html asks for
`./world/bng.mjs` instead.

## 2. Core files the loop needs

| File | Lines (wc -l) | Role |
|---|---|---|
| prototype/overlay.html | 300 | Map, GridAtlas layers, `placed()`, the `wire` custom layer, movement, `window.SIM` / `window.__pf`, mod loader (line 299) |
| prototype/place-frame.mjs | MISSING | placeKey, toLocal, wireBuffer, toMercator, toBng: the transform itself |
| prototype/world/bng.mjs, world/ostn15.mjs | MISSING | National Grid and OSTN15, passed into PF.useWorld |
| prototype/mod/index.json | 0 (137 bytes, no newline) | Load list of 10 mods |
| prototype/mod/perf.js | 136 | Replaces `wire.render` (perf.js:92): one static buffer per block, cached anchor, frustum culling |
| prototype/mod/plant.js | 153 | Design box: typed command -> engine session -> lines in metres -> SIM blocks at the anchor |
| engine/cmd-model.mjs | 357 | createSession, derive, DEFAULTS, summarize (typed-command state) |
| engine/plant-layout.mjs | 376 | layoutPlant, tableGeometry, polyArea, LAYOUT_DEFAULTS, LABEL |
| engine/block-build.mjs | 255 | buildBlock (one block's equipment as grouped lines) |
| engine/data/cables.json, trench-sections.json | 387, 184 | Catalogue and sections fetched by plant.js:16 |
| 38 further engine .mjs (graph below) | 5,642 | Imported one or more steps away from the three roots above (41 files, 6,630 lines in all) |

Engine import graph from plant.js (the only mod that imports engine files; plant.js:15 imports
cmd-model, plant-layout and block-build). Worked out with a script over the `import ... from './x'` lines, then
checked by hand for `export ... from`:

- cmd-model -> cmd-derive, cmd-grammar, cmd-trench, measure-format, plant-feeders, plant-layout, plant-template, string-design, structure-presets, structures
- plant-layout -> plant-feeders, plant-packing, plant-piles, plant-template, site-checks, structures
- block-build -> block-mv, block-trenches, cable-rating, mv-network, pile-rules, piles, station
- cmd-grammar -> cmd-grammar-earth, cmd-grammar-plant, cmd-grammar-senses, cmd-grammar-trench, connect-here, repd-grammar, structure-presets, structures, sub-grammar
- cmd-trench -> block-mv, block-trenches, cable-iec, cable-rating, fault-level, lv-dc-sizing, sld-connect, station, trench-plan
- block-mv -> cable-rating, plant-feeders, plant-template, sld-rules; block-trenches -> station, trench-plan
- sld-rules -> cable-rating, plus re-exports from elec-style and measure-format (sld-rules.mjs:92,95)
- connect-here -> cable-rating, cable-route, sld-connect; sub-grammar -> journey -> bng
- lv-dc-sizing -> bs7671-checks, fault-level, module-catalogue; trench-plan -> cable-iec, trench-design
- plant-piles -> pile-rules, piles; piles -> pile-rules; plant-feeders -> cable-rating, trench-plan
- mv-network -> plant-template, station; plant-template -> cable-rating, module-catalogue
- cmd-derive, string-design -> module-catalogue; cmd-grammar-plant -> structure-presets
- No imports: bng, bs7671-checks, cable-iec, cable-rating, cable-route, cmd-grammar-earth/-senses/-trench, elec-style,
  fault-level, measure-format, module-catalogue, pile-rules, plant-packing, repd-grammar, site-checks, sld-connect,
  station, structure-presets, structures, trench-design

Other mods import only the missing `../place-frame.mjs` (perf.js:27) or `world/*.mjs` (coords-readout.js:22-23).

## 3. Not needed for the loop

Engine files copied but never imported:
- **plant-central.mjs** (48 lines). Checked with `grep -rn plant-central` across prototype/, which finds only the file itself.
  (A first pass also flagged elec-style.mjs, but sld-rules.mjs:92 re-exports from it, so it is imported.)

Engine code imported, but plant.js returns a fixed refusal or nothing for it:
- plant.js:110-112: `piles`, `show` and `go` return "not in this module". `constraints` and `avoid` return []. So
  cmd-model.mjs:236, 255, 279, 288 reach only these stubs, and the grammar for them (sub-grammar -> journey -> bng,
  repd-grammar, connect-here.mjs `parseConnect`) parses commands that no module then carries out.
- plant.js:84-85: `drawnBoundary` and `setBoundary` are stubs (null / no-op).
- plant-layout.mjs:363 `layoutPlantAsync` is exported, but plant.js calls only `layoutPlant` (plant.js:95).

Mod code that no button or command reaches:
- **prototype/mod/gpu-rows.js** (39 lines, with gpu-rows-6502.json). It is not in mod/index.json (grep "gpu-rows" finds
  nothing there), so it is never loaded, and its 'GPU rows' button and `window.__gpuRows` never exist.
- overlay.html:247-276 `detectRows`, and its helpers `lonLatToTile`, `tileToLonLat`, `loadImg` and `TILE_URL`
  (242-246). rows-geometry.js:218 sets `#detect.onclick = run`, which replaces it once that mod loads. grep shows these
  helpers are used only inside detectRows.
- overlay.html:88-99 `wire.render` and `withAnchor` (34-38). perf.js:92 overwrites `wire.render` on attach.
  withAnchor is used only at overlay.html:96.
- coords-readout.js:81-82 check `SIM.survey` and `SIM.lidarAt`. `grep -rn "lidarAt\|SIM.survey *="` shows neither is
  ever defined. So the "LiDAR 1 m (cached)" branch (line 115) can never show, and survey state is read from `#survey.on`.
- `SIM.PF` is read by connect-here.js:33,37 and find-go.js:51, but window.SIM never sets it (overlay.html:280-287).
  Only the `window.__pf.PF` fallback applies.
- find-go.js:8: the second REPD URL `world/data/repd-solar-bess.json` does not exist in the repo. Only
  `mod/find-go.data.json` serves.
- plant.js:88-89 calls `CM.derive(...)` twice with the same arguments. The first result is used only for `.tpl`
  inside `tableGeometry`.
- Test hooks with no in-repo caller (`grep` over tests/overlay-smoke.cjs finds none): `window.__pf.build`
  (overlay.html:237), `__designRun` (plant.js:149), `__connectRun` (connect-here.js:174), `findGo` (find-go.js:120),
  `SUBS` (substations.js:185), `__pylonsReal` (pylons-real.js:164), `walkFps.set/state` (walk-fps.js:159),
  `__lidarOnsite` (lidar-onsite.js:71), `SIM.rowsGeometry` (rows-geometry.js:219), `SIM.perf.stats/reset/touch`
  (perf.js:127-131).

Duplicate paths (both reachable, but only one is needed for the loop):
- Pylons: the built-in "Pylons" button (overlay.html:182-211) and "Pylons (real)" (pylons-real.js:33).
- "go substation": find-go.js:89-96 and a second input box in substations.js:163-181.
- Movement: overlay.html:130-145 uses a spherical 111320 m/deg rule. walk-fps.js:12-13 uses WGS84 metres per degree
  (the 'FPS' button or V).
