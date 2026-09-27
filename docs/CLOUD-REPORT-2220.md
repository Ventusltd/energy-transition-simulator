# Cloud report for the 22:25 round (scout and judge)

## 1. What I ran and saw
In the cloud, on setup/20260927 at 0989c7f: `npm install` worked. `npx playwright install --with-deps chromium` failed because the download was blocked. I ran the unchanged test with the preinstalled Chromium on SwiftShader and `CI=true`. It passed 9 and failed 3:
- PASS: the buttons Satellite, Dark, Wire, Walk, Drone, Map and Pylons (7 checks).
- FAIL: map canvas; pylons on the 400 kV line; walking moves you (the readout was empty before and after).
- PASS: no project names on screen; no page errors.

Diagnosis, from a run: overlay.html:21-23 imports `./place-frame.mjs`, `./world/bng.mjs` and `./world/ostn15.mjs`. None of the three is in git on any branch of this repo, and there is no place-frame.mjs in the private repo either. All three returned 404. MapLibre itself loaded (served locally), and WebGL2 was available. The module script never ran, so no canvas was created and window.SIM does not exist. They pass on the owner's PC only because the files exist there untracked.

All four screenshots (pylons, walk, drone, wire) show the same thing: the button bar, the help line and the joystick on solid black. There is no map, and a player would see nothing to play.

Base does NOT pass in the cloud. Fix: commit those three files. That is inferred, because I can't prove it without place-frame.mjs. The test also needs two changes so it can't pass a dead page:
- fail when any same-origin request returns 404;
- assert `typeof window.SIM === 'object'`.

That is stronger, not weaker. Separately, this cloud's egress blocks the CDN, the imagery hosts and GridAtlas. GitHub Actions does not, so CI is the right judge.

## 2. GitHub Actions
Workflows are enabled. There have been 6 runs, all failed with the same 9 passed and 3 failed. The latest push run is https://github.com/Ventusltd/energy-transition-simulator/actions/runs/36347888127 and the screenshots are in artifact 10940972647.

## 3. The E=mc² paragraph
Inputs: a place (the map centre or ?lat=&lon=), numbers typed into the Design box and run through the engine's createSession, and GridAtlas line and substation GeoJSON. The one transform: every object is lines in local metres (east, north, up). `placed()` takes PF.placeKey(lat, lon) as a 100 m lattice anchor, shifts the lines by PF.toLocal and packs them with PF.wireBuffer into anchor-relative float32 Mercator. At draw time the anchor's float64 Mercator point goes into MapLibre's own matrix. Inside Great Britain, PF.useWorld gets bng.mjs plus OSTN15. Outputs: wireframe blocks in the map's custom layer with honest labels, and 10, 60 or 300 m/s movement (x3 with Shift). Caveat: the transform's own file, place-frame.mjs, is not in the repo.

## 4. The three most important "one of each" findings
1. **Coordinates are split.** About seven home-made conversions sit beside PF, all measured over a 5 km square at latitude 51.34:
   - 111320 × cos: 5 to 8 m east-west error;
   - substations.js:126 uses 110574 for north: 33 m north error;
   - perf.js uses a spherical Mercator scale: 15.8 m per 5 km;
   - an exact tangent plane: 0.000 m.
   One function, PF.toLocal/fromLocal on the ellipsoid, should replace about 25 call sites.
2. **Two render paths.** pylons-real.js:134-162 has its own map layer and WebGL program. overlay.html also has a second pylon builder and a second satellite-rows builder.
3. **Commands bypass the engine grammar.** The engine already parses "go substation 132", "connect here 132", "plant 50mw" and "go repd N", but plant.js lacks the journey, connect, repd and find handlers, so it refuses them with "not in this build". find-go and substations regex-parse "go substation" themselves. Add the four handlers and expose SIM.command.

Also: the GridAtlas release URL is hard-coded 5 times, and find-go.data.json is an unpinned copy of GridAtlas's public-register data with no licence field.

## 5. Honesty bugs (code audit; I couldn't run a live browser here)
- **Solar rows:** called "real mapped panel rows", but heights and tilt are made up (overlay.html:17, 168), and no estimate label appears after load (overlay.html:173).
- **Illustrative labels missing:** "Build here" (overlay.html:76) and the built-in Pylons button (overlay.html:210). "Pylons (real)" should read "Pylons (mapped positions)" (pylons-real.js:33).
- **HUD:** always says LiDAR is not cached, because SIM.lidarAt is never defined (coords-readout.js:82, 112).
- **Attribution and dates:**
  - GridAtlas lines and substations have no attribution (overlay.html:54-64).
  - No note that the imagery date is unknown or that it is stretched beyond zoom 17.
  - The build year comes from an enrichment dataset that isn't credited (find-go.js:67).
- **Stated assumptions missing:**
  - LiDAR survey year unknown (lidar-onsite.js:60).
  - Circuit ratings assumed, and the network operator decides the connection (connect-here.js:138).
  - Rows assumed south-facing (rows-geometry.js:210).
  - The plant fence is a generic square (plant.js:131).
- **IEC 60287:** clauses cited without an edition (engine/connect-here.mjs:26).

No project names were found. The find-go data holds only integer codes across 85,986 records.

## 6. Gladiator plan: 9 builds and 10 questions
Builds, each with an in-page assertion for the smoke test:
1. arrive.js: land in Walk under 1 m from the target, with a ground line.
2. move-speed.js: holding W for 2 s moves 16 to 24 m walking and 100 to 140 m by drone.
3. build-place.js: "plant 50mw" builds 45 to 50 MW; move(100, 0) shifts the plant 100 ± 0.01 m.
4. dig-auto.js: the dig segments sum to the route length ± 1 m, each one of three types.
5. size-check.js: a size above 0 mm², with every citation matching the pattern and at most 40 characters.
6. trench-xray.js: depth 0.6 to 2.0 m, at least one cable, labelled "illustrative".
7. honest-labels.js: every block is tagged measured, estimated or illustrative.
8. existing-sites.js: at least one nearby site outline labelled estimated, with no names.
9. atlas-handoff.js: a 6 dp round trip to GridAtlas under 1 mm, at zoom minus 1.

Questions:
1. The one coordinate function (PF).
2. The one grammar (engine parse).
3. The performance budget for a 500 MW site.
4. Bright or grey panels (keep a detector only at 80% recall or better with 10% false rows or fewer).
5. Pylon positions against satellite shadows (a median offset of 15 m or more means "estimated").
6. The join order that keeps the test green.
7. The two walkers: one walk mode at 10 m/s.
8. Dig rules at crossings, cited or labelled illustrative.
9. The citation format.
10. The outside-service budget: at most 1 request per second per host, with back-off and caching.

The integrator's first job is to commit the three missing files.

## 7. Pull requests
- https://github.com/Ventusltd/energy-transition-simulator/pull/2: CORE.md and ONE-OF-EACH.md
- https://github.com/Ventusltd/energy-transition-simulator/pull/3: OVERNIGHT-PLAN.md
- https://github.com/Ventusltd/energy-transition-simulator/pull/4: HONESTY-AUDIT.md
- This report is on cloud/report.

## 8. Could not do
- Install Playwright's own Chromium; the download is blocked here.
- See the map in the cloud: the page can't start without the three files, and imagery is blocked here.
- Prove that committing the three files turns CI green, because place-frame.mjs exists only on the owner's PC.
- The honesty audit is from code, not from a live screen.
