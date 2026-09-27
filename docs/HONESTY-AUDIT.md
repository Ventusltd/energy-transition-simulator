# Honesty audit: overlay prototype at the owner's test point

Repo `energy-transition-simulator`, branch `setup/20260927` at `0989c7f`, read-only worktree `/home/user/sim2/wt-honesty`.
Scope: `prototype/overlay.html` + `prototype/mod/*.js` (loaded set = `mod/index.json`: perf, coords-readout, find-go,
substations, pylons-real, connect-here, rows-geometry, walk-fps, lidar-onsite, plant). Test point: lat 51.33877, lon 0.91388.

**Method: code-only audit.** This cloud blocks the map CDN, imagery, terrain and GridAtlas hosts, so no live browser
run was possible. What is "seen" is derived from the code paths; nothing here is a visual check.

**Blocking finding (not a label issue):** `overlay.html:21-23` imports `./place-frame.mjs`, `./world/bng.mjs`,
`./world/ostn15.mjs`; none exist at this commit (`git ls-files` has no match). As committed, the module script fails,
`window.SIM`/`__pf` are never set, and every mod waits forever. `coords-readout.js:23-24` and `find-go.js:8` (fallback
URL) also depend on `world/`. The audit below assumes those files are supplied at serve time.

## Classification of visible things

| Thing | Class | Produced by | On-screen label (exact, file:line) | Verdict |
|---|---|---|---|---|
| Satellite imagery | measured (photo; capture date unknown, overzoomed past z17) | overlay.html:43, 50-51 (maxzoom 17, map maxZoom 20) | "Imagery: Esri, Maxar, Earthstar Geographics · Rows © OpenStreetMap contributors, ODbL" (overlay.html:43) | Attribution honest; no date/resolution caveat (missing) |
| Dark basemap | third-party map (OSM-derived) | overlay.html:47, 293 | style's own attribution (not in repo; unverifiable offline) | OK if style attribution renders |
| GridAtlas 400/275/132 kV lines + substation dots | mapped (OSM via GridAtlas) | overlay.html:54-64 | none | **Missing attribution** in all three views |
| Wire view | illustrative (black background + flat 10 m grid) | overlay.html:294, 104-110 | button "Wire"; info "Survey shows the onsite ground grid (LiDAR topography plugs in here)." (overlay.html:17) | Honest-ish; grid is flat, drawn at 0.2 m |
| Terrain relief | estimated (open ~30 m class DEM, exaggeration 1) | overlay.html:46, 295 | "Terrain: AWS Terrain Tiles (open)" (overlay.html:46); "estimate, open terrain model" (coords-readout.js:108) | Honest |
| Rows from satellite (active impl.) | estimated from imagery | rows-geometry.js:9-11, 98, 168; rebinds button at :218 | "Estimated from satellite imagery, not measured: … Row pitch about … m (estimate); tables drawn 0.8 m front, 2.4 m back, legs every 5 m (assumed)." (rows-geometry.js:210-211) | Honest; south-facing assumption (:168) not stated |
| Rows from satellite (overlay built-in) | estimated | overlay.html:247-275 | "Rows estimated from satellite imagery (not measured): …" (overlay.html:274) | Honest; superseded by rows-geometry.js |
| GPU rows (`gpu-rows.js` + `gpu-rows-6502.json`) | estimated, offline | gpu-rows.js:1-39 | "Panel rows ESTIMATED from satellite imagery (not measured): … (estimate)" (gpu-rows.js:25-26) | Honest, but **not in index.json, so never shown**. Data note: `row_pitch_m` 26.86 is implausible as a table-row pitch (likely block/track spacing) |
| OSM solar rows ("Solar rows") | outline mapped; heights/tilt illustrative | overlay.html:152-176 (heights 1.0-2.6 m invented at :168) | info: "\"Solar rows\" stands up the real mapped panel rows (OpenStreetMap) in 3D." (overlay.html:17); button "Solar rows (n)" (:173) | **Misleading**: "real … rows" while height/tilt/"north back edge" are assumed; OSM ways are often array outlines, not rows |
| Build here block | illustrative (fixed 200 x 120 m, 10 m rows, 2.5 m) | overlay.html:70-77 | "\"Build here\" drops a 3D wireframe solar block at the map centre, fixed in real coordinates." (overlay.html:17) | **Missing** "illustrative, not a design" |
| Plant layout (Design box) | illustrative (generic rules, generic square boundary, flat ground) | plant.js:55, 86-95; engine/plant-layout.mjs:31 | "Illustrative layout from generic rules, not a design for any site. Ground taken as flat here (not measured)." (plant.js:131 via plant-layout.mjs:31; also plant.js:145) | Honest; could add that the fence is a generic square, not the site boundary |
| Pylons (overlay built-in) | positions mapped; towers/heights illustrative; straight conductors | overlay.html:182-211 | button "Pylons (n)" (overlay.html:210) only | **Missing** estimate label (comment at :181 says "illustrative", never shown) |
| Pylons with sag (pylons-real, on by default) | positions mapped; infill towers, heights, arms, sag estimated | pylons-real.js:10-19, 54, 102-105 | "Pylons: … at GridAtlas line vertices (© OpenStreetMap). Heights, arms, sag and infill towers are estimates." (pylons-real.js:128); button "Pylons (real)" (:33) | Info honest; button "(real)" **misleading** |
| Substations + footprints | points mapped; fence mapped (OSM) or dashed estimate; plinths estimated | substations.js:1-13, 106, 153-156 | "Substation points: GridAtlas. Fences: OpenStreetMap contributors (ODbL); dashed fence and all plinths are estimates." (substations.js:13) | Honest |
| Connect-here route + figures | route: straight or OSRM road (mapped roads); electrical: estimated with assumed conductors | connect-here.js:21-28, 110-143, 146-151 | "Connect here (ESTIMATE, not a design): … (R' … ohm/km, assumed) … Resistive only, reactance ignored." (connect-here.js:138-141) | Mostly honest; **missing**: circuit ratings (amp) also assumed; nearest point says nothing about capacity or who decides the connection |
| Walk / Drone / Map speeds | illustrative travel speeds | overlay.html:113, 137 | "`walk · 10 m/s · 36 km/h`" (overlay.html:142), x3 with Shift | **Misleading**: "walk" at 36-108 km/h; true walk pace exists only in FPS (walk-fps.js:8, 1.4 m/s) |
| FPS walk | eye 1.7 m on estimated terrain | walk-fps.js:8, 96 | "First-person walk. Eye 1.7 m above terrain; ground … m (open terrain tiles, an estimate)." (walk-fps.js:96); title "First-person walk, eye at 1.7 m (V)" (:155) | Honest |
| Coords HUD (BNG/OSTN15) | computed; OSTN15 ~0.1 m or Helmert ~3.5 m | coords-readout.js:93-110 | "OSTN15 (OS definitive, ~0.1 m)" / "Helmert estimate (~3.5 m), OSTN15 not loaded" (coords-readout.js:101) | Honest |
| Coords HUD ground line | status text | coords-readout.js:82, 112 | "Survey grid 10 m · LiDAR 1 m not cached here" (coords-readout.js:112) | **Misleading**: `SIM.lidarAt` is never defined anywhere, so it always says not cached, even where lidar-onsite draws cached LiDAR (the test point has a baked area) |
| pf-readout / here-readout | computed | overlay.html:213, 217-233 | "BNG … (engine, OSTN15 correction x m)" / "OSTN15 not loaded" (overlay.html:222) | Honest; code comment :212 wrongly says "from GridAtlas's own coordinates" (not shown) |
| LiDAR onsite | measured (EA 1 m DTM), resampled to 5 m mesh; vertical placement relative to terrain model at anchor | lidar-onsite.js:5-6, 52-65; lidar-onsite/repd*.json (`step` 5, `survey_year` null) | "Onsite LiDAR: … km² of measured ground. Contains Environment Agency LiDAR 1 m DTM, OGL v3 (local cache). Mesh every 5 m …" (lidar-onsite.js:60) | Honest on source; **missing**: survey year unknown, absolute height tied to open terrain model at anchor |
| Find-go marker + footprint ring | position as published; ring estimated (1.6 ha/MW) | find-go.js:9, 37-44, 62-67 | "Ring = footprint estimate (1.6 ha/MW, radius … m), not the real boundary." + "Source: DESNZ REPD Q2 2026 via GridAtlas; position as published." (find-go.js:62, 67) | Honest; "built <year>" comes from the enrichment dataset but only REPD is credited |

## Names check (counts and field names only)
- `find-go.data.json`: 9 record fields (`ref, tech, class, repd_status, mw10, lat5, lon5, county, build_year`), 85,986
  records, **all values integers** (lookup indices) - no free-text per record. Lookup string lists: `tech` 3,
  `class` 5, `repd_status` 13, `county` 144 (administrative areas, loaded but never displayed by find-go.js).
  Metadata string fields: `schema, label, generation, source.{registry, registry_url, registry_sha256, dataset,
  published, publisher}, enrich.{build, manifest_sha256, dataset, used_for}, quantised.*`. A name-pattern scan hit 2
  metadata fields (`source.registry_url`, `enrich.dataset`); both are dataset titles/URLs, not project names. **0 project names.**
- `find-go.js`: displays only ref, tech, status, MW, year, lat/lon (find-go.js:66, 94); placeholder uses a numeric register ref (:108). **0 names.**
- `gpu-rows-6502.json`: `site` is a register ref string, `source` 43 chars with no name pattern. **0 names.**
- `substations-footprints.odbl.json`: 5,612 entries, only 1-char type codes as strings. **0 names.**
- `lidar-onsite/`: area `name` and file name are a register ref, not a project name; not shown on screen.
- Tooltips/titles: only walk-fps.js:155 and aria-label "Find" (find-go.js:108). Info-panel and attribution strings: no names.
- Not checked offline: labels inside the third-party dark style and GridAtlas GeoJSON properties (substation names are never read: find-go.js:31-32, substations.js:5, connect-here.js:103-104).

## Standards citations (number and clause only)
Reach the screen only via the Design box engine chain (plant.js imports cmd-model, plant-layout, block-build).
- engine/connect-here.mjs:26-29: IEC 60287-1-1 cl. 2.1; IEC 60287-2-1 cl. 2.2; ESQCR 2002 reg. 27(3); IEC 60228; BS 7671 Reg. 525.
  Subjects match. **Edition not stated**: the IEC 60287 clause numbers match the older editions and are renumbered in current ones.
- engine/plant-feeders.mjs:124, trench-plan.mjs:76/263, cmd-trench.mjs:38: IEC 60287 (method, "own code", "indicative") - honest.
- engine/structures.mjs:133, cmd-trench.mjs:60: IEC 62548-1 - appropriate.
- engine/cmd-trench.mjs:73, bs7671-checks.mjs:17/26: BS 7671; IEC 60364-4-43 - appropriate.
- Comments only (not on screen): IEC 60364-5-52, 60364-7-712, 60949, 60909, 60502-2, 60853-2, 60269(-6), 62930, BS EN 60947-2, BS EN 60898, BS 7671 Appendix 4.
- plant-layout.mjs:275 cites "GS6 planning zone" (a guidance note, not a standard) marked illustrative - OK.
- mod/connect-here.js (the version on screen) cites internal equation IDs only (:14-15), no standard. OK.

## Bugs (missing or misleading labels)
1. overlay.html:17 (static #info) - "real mapped panel rows" misleading. Proposed: "\"Solar rows\" draws OpenStreetMap solar outlines in 3D; table heights and tilt are illustrative."
2. overlay.html:173 (after loadRows) - add info text: "Mapped outlines © OpenStreetMap (ODbL); heights 1.0-2.6 m and north-high tilt are assumed, not measured."
3. overlay.html:17 / :76 (Build here) - add: "Illustrative block (200 x 120 m, generic rows), not a design."
4. overlay.html:210 (built-in Pylons) - add info: "Pylon positions from GridAtlas line vertices; tower heights by voltage class are illustrative; conductors drawn straight." Or drop the duplicate now that pylons-real is on by default.
5. pylons-real.js:33 - button "Pylons (real)" -> "Pylons (mapped positions)".
6. overlay.html:142 - speed label: "walk" at 10-30 m/s. Proposed: "fast travel (walk view) · 10 m/s …; real walking pace: FPS (V)", or rename modes to "Low fly / Drone".
7. overlay.html:54-64 - GridAtlas lines/substation dots have no attribution in any view (Wire view has none at all). Add `attribution: 'Grid: GridAtlas (© OpenStreetMap contributors, ODbL)'` to the `g*`/`subs` sources.
8. overlay.html:43 - add imagery caveat to the attribution or info: "Imagery date unknown; sharp to z17, enlarged beyond."
9. coords-readout.js:82/112 - `SIM.lidarAt` is never defined. The HUD states "LiDAR 1 m not cached here" where lidar-onsite shows cached LiDAR. Fix: have lidar-onsite.js export `SIM.lidarAt`, or change the text to "LiDAR status: see LiDAR onsite".
10. lidar-onsite.js:59-60 - add: "Survey year not recorded; heights placed relative to the open terrain model at the anchor; mesh 5 m (from 1 m data)."
11. connect-here.js:138-141 - add: "Circuit ratings assumed. Nearest point only, capacity unknown; the network operator decides the real connection." (Reuse engine/connect-here.mjs:23 wording.)
12. rows-geometry.js:210-211 - add "south-facing assumed" (the :168 assumption is currently silent).
13. find-go.js:66-67 - credit the build year: "build year: enrichment, not REPD".
14. engine/connect-here.mjs:26 - state the IEC 60287 edition beside the clause numbers.
15. plant.js:131 - optional: "Fence is a generic square around the map centre, not the site boundary."
Non-label: missing `place-frame.mjs`/`world/` (blocking); gpu-rows not in index.json; `gpu-rows-6502.json` pitch 26.86 m is suspect.
