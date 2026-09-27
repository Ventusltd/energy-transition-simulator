# One of each: audit of prototype/overlay.html + prototype/mod/*.js

Read-only, branch setup/20260927 at 0989c7f. Paths are relative to `prototype/`. There is no top-level `engine/`: the engine is at `mod/engine/` (bng.mjs is `mod/engine/bng.mjs`).
**Missing from the repo:** `place-frame.mjs`, `world/bng.mjs` and `world/ostn15.mjs` are imported by overlay.html:21-23, perf.js:27 and coords-readout.js:22-23, but `git ls-files` lists none of them. The overlay cannot load from this checkout alone. The PF API used below is inferred from its call sites.

## 1. One coordinate conversion

**Every conversion site found:**
| Site | What it does |
|---|---|
| overlay.html:29-31, 93, 162-163, 202, 259-267 | PF.placeKey / toLocal / wireBuffer / toMercator (the intended path) |
| overlay.html:139 | walk/drone step: `dn/111320`, `de/(111320*cos(centre))` |
| overlay.html:243-245, 257-258 | own tile<->lon/lat Mercator; metres/pixel from `111320*cos(centre)` |
| overlay.html:22-25, 219-222 | BNG via world/bng.mjs + OSTN15, through PF.useWorld / PF.toBng |
| find-go.js:35 | distance `111320`, cos(mean lat) |
| find-go.js:53-55 | PF.placeKey / toLocal / wireBuffer (good) |
| pylons-real.js:48-49, 65 | distance and tower direction `111320*cos(lat)` |
| pylons-real.js:95, 101, 109, 149 | PF.toLocal / wireBuffer / toMercator (good) |
| substations.js:17-28 | own WGS84 ECEF->ENU fallback (`6378137`) when PF is absent |
| substations.js:126 | distance `111320*cos(lat)` east, **`110574`** north (equator meridian value) |
| connect-here.js:49-54 | haversine on sphere R 6371008.8 (ranking only) |
| connect-here.js:55-94 | PF.toLocal / fromLocal / wireBuffer (good) |
| walk-fps.js:11-13, 41, 56-60, 80 | own ellipsoid metres/degree at one latitude |
| walk-fps.js:64 | zoom from `40075016.686*cos(lat)` |
| perf.js:20-23, 68-69, 108 | **own Mercator** (`mx/my/mz`, sphere R 6371008.8), replacing PF.toMercator in the render |
| perf.js:51-53 | PF.placeKey / toLocal / wireBuffer (good) |
| coords-readout.js:22-23, 97 | its own import of world/bng.mjs + ostn15 (bypasses PF.toBng) |
| coords-readout.js:44-45 | own lon/lat->tile Mercator |
| rows-geometry.js:15-17 | own tile Mercator (a copy of overlay.html:243-245) |
| rows-geometry.js:191-192 | metres/pixel via PF.toLocal (good) |
| lidar-onsite.js:26-33, 48 | PF.fromBng / bngToWire / wireToBng / toBng (good) |
| gpu-rows.js:16-17 | PF (good) |
| plant.js:42-45 | PF (good) |
| mod/engine/bng.mjs:97-181 | TM forward/inverse on Airy, Helmert WGS84<->BNG, optional `{de,dn}` OSTN offset |

There are two bng.mjs files. `world/bng.mjs` (imported, not in the repo) and `mod/engine/bng.mjs:1`, which says it was "copied unchanged from ... world/bng.mjs", are meant to be the same file. There are three copies of the tile Mercator code (overlay.html:243, rows-geometry.js:15, coords-readout.js:44). The comments disagree about the place frame's Mercator: overlay.html:20 says "WGS84 ellipsoid", while perf.js:20 says "MapLibre 4.7.1 sphere, as place-frame.mjs".

**Numbers.** Script: `node /home/user/sim2/out/oneofeach.mjs` (Vincenty direct on WGS84, compared with an ECEF tangent plane). Site centre 51.33877, 0.91388 (taken from gpu-rows-6502.json).
- True metres per degree here: east 69,685.26, north 111,254.76. The flat values are east 69,543.21 (111320·cos) and north 111,320.
- Error of the flat formula for a point **5 km east**: E **-10.20 m** (-0.20 %, because 111320 is the equatorial degree and ignores N(φ)). N -2.45 m (a flat lat/lon grid is not a tangent plane).
- **5 km north**: N **+2.91 m** with 111320. With substations.js's 110574 it is N **-30.61 m** (-0.61 %).
- **Corner of a 5 km square** (7.07 km NE):
  - cos(centre): E -5.31, N +0.47 m
  - cos(mean lat) (find-go/pylons style): E -7.76 m
  - substations.js style: N -33.05 m
  - walk-fps ellipsoid scale fixed at the centre: E +4.90, N -2.47 m
  - ECEF tangent plane: 0.000 m
- **cos at the centre vs cos at the point** (2.5 km N, 5 km E): 4992.244 vs 4989.798 m, a **2.45 m** difference.
- **Metres to Mercator with the sphere R** (perf.js:20-23 `mz`, and any PF that scales metres by 1/(2πR·cosφ)): east scale +0.317 % (**15.8 m per 5 km**), north +0.054 % (2.7 m per 5 km).
- A linear Mercator scale fixed at the anchor, compared with exact Mercator, errs -2.43 m at 5 km north but only -24 mm at 500 m. So anchor-relative blocks are fine only if each block stays within a few hundred metres, as the 100 m lattice and 150 m chunks (connect-here.js:28) do.
  - Blocks larger than that: overlay's 600 m ground (overlay.html:108), about 760 m of rows (rows-geometry.js:9), plant fields up to km (plant.js:43), and 1-3 km LiDAR (lidar-onsite.js:9).

**Proposal: one function.** `toLocal(anchor, lat, lon, h = 0) -> { x, y, z }`, in `prototype/place-frame.mjs`:
- Its partners are `fromLocal(anchor, x, y, z)` and `placeKey(lat, lon)`, with anchor = `placeKey(...)`. It is exact WGS84 ECEF->ENU (the substations.js:25-27 maths), which gives 0.000 m above.
- Distance between points is `hypot` of `toLocal(placeKey(a), b)`, exported as `PF.metres(a, b)` and built on toLocal.
- For BNG, `PF.toBng / fromBng` wrap **mod/engine/bng.mjs** (one copy) plus OSTN15 through the existing `{de,dn}` hook (bng.mjs:147-160).
- Mercator: the only conversion is `PF.toMercator` for the anchor. Its metres-to-Mercator scale must use the ellipsoid (N east, M north), not R 6371008.8.
- This follows the place contract (contracts/place.v1.md): WGS84 degrees at 6 dp, a local frame at the arrival point outside GB, and round trips exact to 1 mm.

**Mapping to the expected owner place-frame.mjs.** The names above are already its API as used here: placeKey, toLocal, fromLocal, wireBuffer, toMercator, toBng, fromBng, bngToWire, wireToBng, useWorld. The proposal adds no new module. It asks the owner's file to (a) confirm toLocal is ellipsoidal ENU and that toMercator/wireBuffer scale by the ellipsoid, (b) export `metres(a,b)` and `tile(lon,lat,z)`/`tileToLonLat`, and (c) take BNG from mod/engine/bng.mjs rather than a second world/bng.mjs.

**Call sites that change:**
- overlay.html: 139 (`fromLocal`), 243-245 and 257-258 (PF tile, plus metres/pixel via toLocal as in rows-geometry.js:192), 22-25 (one bng.mjs)
- find-go.js: 35
- pylons-real.js: 48-49, 65
- substations.js: 17-28 (delete the fallback), 126
- connect-here.js: 49-54
- walk-fps.js: 11-13, 41, 56-60, 80, 64
- perf.js: 20-23, 68-69, 108 (use PF.toMercator)
- coords-readout.js: 22-23, 97 (PF.toBng), 44-45
- rows-geometry.js: 15-17

## 2. One render path

- The one wire layer is overlay.html:79-100: a custom layer with one program, drawing `blocks[]` with anchor-relative buffers, added at overlay.html:65. perf.js:92-125 replaces `wire.render` on that same layer and program, which is fine.
- These modules draw through `SIM.addBlock` into that layer:
  - find-go.js:57
  - substations.js:142-143
  - connect-here.js:130, 136
  - lidar-onsite.js:55
  - plant.js:45
  - rows-geometry.js:202
  - gpu-rows.js:28
- coords-readout.js (DOM only, :11) and walk-fps.js (camera and DOM, :90) draw nothing in WebGL.
- **FLAG: pylons-real.js has its own custom map layer and its own WebGL program.** The layer is `pylons-real` (pylons-real.js:134-162) and the program is at :139-142.
  - It keeps its own GL buffers (:109-110) and deletes them itself (:127, :132).
  - It has its own per-frame Mercator matrix (:149-151).
  - It skips perf.js caching and culling and the `SIM.blocks` list, so walk-fps collision (walk-fps.js:39) and any "count blocks" check cannot see it.
  - Its only extra need, a per-draw colour uniform (:141, :154-155), could be a `col` field on a block in the wire layer.
- Duplicate: overlay.html:182-210 has its own pylon builder, drawn through the wire layer. So there are **two pylon implementations** (buttons "Pylons" and "Pylons (real)", pylons-real.js:33).
- Duplicate: overlay.html:247-276 has its own satellite rows; rows-geometry.js:218 overrides the `#detect` onclick.
- overlay.html:55-64 adds the 2D GridAtlas line and substation layers. These are basemap layers, not 3D objects, so they are fine.

## 3. One data plane

| Module:line | Source | Owner / licence |
|---|---|---|
| overlay.html:44, 58, 62 | GA atlas-v9 `grid_{400,275,132}kv.geojson`, `grid_substations.geojson` | GridAtlas own |
| connect-here.js:19; find-go.js:7, 30; substations.js:9; pylons-real.js:11, 34 | same GA atlas-v9 URLs | GridAtlas own |
| overlay.html:43; rows-geometry.js:12 | Esri World_Imagery tiles | Esri terms (not an open licence) |
| overlay.html:46; coords-readout.js:16 | AWS Terrain Tiles (terrarium) | open, as labelled |
| overlay.html:47 | Carto dark-matter style | Carto basemap terms |
| overlay.html:157 | Overpass API (OSM) | ODbL |
| connect-here.js:20, 111 | OSRM public demo router | OSM ODbL (demo server, no SLA) |
| find-go.js:8 | **committed** `mod/find-go.data.json` (9,554 records), then fallback `world/data/repd-solar-bess.json` (absent) | DESNZ REPD Q2 2026 via GA registry (licence not stated in the file) |
| substations.js:12, 38 | **committed** `mod/substations-footprints.odbl.json` (1.18 MB) | OSM ODbL, pinned `atlas: 202608300453-atlas-v9`, checked at :43 |
| gpu-rows.js:14 | **committed** `mod/gpu-rows-6502.json` (derived from Esri imagery) | Esri-derived; module **not in mod/index.json** |
| lidar-onsite.js:15, 18 | **committed** `mod/lidar-onsite/index.json`, `repd6502.json` (baked by lidar-onsite/bake.py) | EA LiDAR DTM, OGL v3 |
| plant.js:16 | `mod/engine/data/cables.json`, `trench-sections.json` (generated 2026-09-26) | engine own |
| coords-readout.js:22-23; overlay.html:21-23; perf.js:27 | world/bng.mjs, world/ostn15.mjs, place-frame.mjs | **not in repo** |

**Stale copies:**
- **find-go.data.json is a committed copy of GridAtlas data.** Its registry generation is `202608290716` (source.registry_url in the file). The atlas the page pins is `202608300453`. Nothing checks that they agree, unlike substations.js:43, and the REPD licence is not carried.
- The substations footprints are a derived copy keyed by **feature index** into GA points, valid only for atlas-v9. The atlas check protects it.
- The atlas release URL is hard-coded **5 times** (overlay.html:44, connect-here.js:19, find-go.js:7, substations.js:9, pylons-real.js:11). There should be one `SIM.GA` constant.
- GA substation points are fetched 3 times (connect-here.js:104, find-go.js:30, substations.js:37), with 3 different voltage parsers (`;` only at connect-here.js:106 and find-go.js:32; `;:,` at substations.js:32).

## 4. One command grammar

**Typed boxes today:**
- **Design box**, plant.js:33-35, 135-148: goes through `CM.createSession().exec` → engine cmd-grammar. This is the only box on the engine grammar.
- **find-go**, find-go.js:70-98, 107-121: its own regex for `go <lat,lon>`, `go repd N`, `go solar|bess [MW]`, `go substation [kV]`.
- **substations**, substations.js:163-166, 175-179: a second `go substation` box with its own regex.
- **connect-here**, connect-here.js:43-46: buttons and URL params only, no typed box. Its kV list `[33,132,275,400]` (:28) differs from the engine's `CONNECT_KV [11,33,66,132,275,400]` (engine/connect-here.mjs:19). Its `elec()` (:147-152) duplicates the engine's `planConnection` (engine/connect-here.mjs:86).

Two boxes parse "go substation 132", and neither uses engine/sub-grammar.mjs. They also accept bare "go sub", which the engine refuses (journey.mjs:26).

**The engine already parses all three phrases** (node, cmd-grammar.mjs:188):
- `go substation 132` → `act:'journey', arg:{kv:132}`
- `connect here 132` → `act:'connect', arg:{kv:132}`
- `plant 50mw` → `act:'layout', set:{mw:50}`
- It also parses `go repd 6502` → `act:'repd'`, `go 51.34,0.91` → `act:'find'` and `next substation` → `journey {next:true}`.

cmd-model.mjs:249-254 dispatches these to `engine.repd / journey / connect / find`. The plant.js adapter defines none of them (plant.js:83-113), so they fail with "…is not in this build".

**Proposal:**
1. In plant.js `engine`, add the four handlers. They reuse module code rather than parse:
   - `journey: a => window.SUBS.go(a.kv)` for kv, or next = find-go's seen list.
   - `connect: a => window.__connectRun(null, a)`. Extend connect-here.js `run(from, {kv, mw})`, and replace its `elec()` with engine `planConnection` so the kV list is the engine's.
   - `repd: a => findGo.repd(a)`, exposing `goRepd` plus a filter by `a.tech / a.cls / a.minMw`.
   - `find: a => findGo.latlon(a.place)`.
2. Expose `SIM.command(line)`, which is the Design session's `exec`. The find-go and substations inputs call it and drop their regexes (find-go.js:70-98, substations.js:163-166). Keep one input, or make both inputs feed this one call.
3. Keep "go sub" (no kV) as an engine refusal with its example, or add it in the engine source (v12). Do not add it in a copy: sub-grammar.mjs:2 says "Do not edit here".

## Three most important findings
1. **Coordinates are split between three pipelines.** Seven hand-rolled conversions sit beside the place frame: 111320 flat (-10.2 m per 5 km E-W), 110574 north (-30.6 m per 5 km), spherical Mercator in perf.js (+15.8 m per 5 km E-W if applied to metres), and ellipsoid-at-centre. The place frame itself (`place-frame.mjs`, `world/*.mjs`) is **not in the repo**.
2. **pylons-real.js has its own custom layer and WebGL program** alongside the one wire layer. There is also a second pylon builder and a second satellite-rows builder in overlay.html.
3. **Only the Design box uses the engine grammar.** find-go and substations each regex-parse "go substation", and connect-here has no typed path. The engine already parses all of them, but plant.js's adapter lacks `journey/connect/repd/find`. The committed REPD copy (`find-go.data.json`, 202608290716) is unchecked against the pinned atlas.
