// Check for mod/lidar-stream.js (rule R5 in the browser). It NEVER calls the EA: every request to the EA WCS is
// answered by a SYNTHETIC GeoTIFF made here, in the service's own form, and any request that escapes is a FAIL.
// Part 1 (node): lattice, clipping, decoder round trip, zero-run rule, receipt hash, pacer.
// Part 2 (Chrome): arrive, stream DTM then DSM, draw ground + above-ground wire, receipt + licence on screen,
// no fetch on movement, and "no measured ground here" outside the envelope. Screenshots to test-output/ or $SHOTS.
const http = require('http'), fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const { webcrypto } = require('crypto');
const ROOT = path.join(__dirname, '..', 'prototype'), OUT = process.env.SHOTS || path.join(__dirname, '..', 'test-output');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (name, ok, evidence) => results.push({ name, ok: !!ok, evidence: String(evidence).slice(0, 240) });
const DTM = (e, n) => 100 + 0.01 * (e % 2048) + 5 * Math.sin((n % 2048) / 150);
const BUILDING = (e, n) => { const u = e % 2048, v = n % 2048; return u >= 1004 && u < 1044 && v >= 1004 && v < 1044 ? 10 : 0; };

(async () => {
  const R5 = await import(pathToFileURL(path.join(ROOT, 'mod', 'lidar-stream', 'r5.mjs')).href);
  // ---- Part 1: pure maths ----
  const t = R5.tileOf(463500.4, 262100.9);
  check('lattice tile corner on 2,048 m', t.e0 === 462848 && t.n0 === 260096 && t.e1 - t.e0 === 2048, JSON.stringify(t));
  check('negative-side cell stays in its tile', R5.tileOf(462848, 260096).key === '462848_260096' && R5.tileOf(462847.99, 260096).e0 === 460800, 'edges');
  check('clip to envelope', JSON.stringify(R5.clip(R5.tileOf(655900, 300000), R5.SOURCES.dtm.env)) === JSON.stringify({ e0: 655360, n0: 299008, e1: 656000, n1: 301056 }), 'east edge');
  check('outside envelope is null', R5.clip(R5.tileOf(330000, 700000), R5.SOURCES.dtm.env) === null, 'Scotland');
  check('DSM card is the catalogue URL (not the 404 guess)', /digital-surface-model-first-return-dsm-1m\/wcs$/.test(R5.SOURCES.dsm.url) && /FZ_DSM_1m$/.test(R5.SOURCES.dsm.coverage), R5.SOURCES.dsm.url);
  const tif = R5.synthTiff(1000, 2064, 64, 64, (i, j) => (i === 3 && j === 5 ? -3.4028234663852886e38 : 50 + i + 100 * j));
  const g = await R5.decodeGeoTiff(tif);
  check('decoder round trip', g.width === 64 && g.west === 1000 && g.north === 2064 && g.res === 1 && g.data[2 * 64 + 7] === 257 && g.hasNodata, `${g.width} ${g.west} ${g.north} ${g.data[2 * 64 + 7]}`);
  const m = R5.measuredMask(g);
  check('nodata cell is unmeasured', m.mask[5 * 64 + 3] === 0 && m.valid === 64 * 64 - 1, `valid ${m.valid}`);
  const z = await R5.decodeGeoTiff(R5.synthTiff(0, 64, 64, 64, () => 0, null));
  check('all-zero box without nodata tag = no measured ground', R5.measuredMask(z).valid === 0, 'valid 0');
  const zr = await R5.decodeGeoTiff(R5.synthTiff(0, 64, 64, 64, i => (i < 20 ? 0 : i === 30 ? 0 : 7), null));
  const zm = R5.measuredMask(zr);
  check('zero run >= 16 dropped, lone zero kept', zm.mask[0] === 0 && zm.mask[30] === 1 && zm.mask[25] === 1, `row0 ${zm.mask.slice(0, 32).join('')}`);
  const s1 = await R5.cellSha256(g.data, webcrypto.subtle), s2 = await R5.cellSha256(new Float32Array(g.data), webcrypto.subtle);
  check('receipt hash is over cells (stable, 64 hex)', s1 === s2 && /^[0-9a-f]{64}$/.test(s1), s1);
  let now = 0; const pc = R5.createPacer({ clock: () => now });
  const a1 = pc.take(); const a2 = pc.take(); pc.done(200); now += 39999; const a3 = pc.take(); now += 1; const a4 = pc.take();
  check('pacer: one at a time, 40 s gap', a1 && !a2 && !a3 && a4, `${a1} ${a2} ${a3} ${a4}`);
  pc.done(429); now += R5.GAP_MS; const b1 = pc.take(); now += R5.PAUSE_MS; const b2 = pc.take();
  check('pacer: refusal pauses 5 min', !b1 && b2, `${b1} ${b2}`);
  const cap = R5.createPacer({ clock: () => now, used: 16 });
  check('pacer: 16 a day', !cap.take() && /daily cap/.test(cap.why()), cap.why());

  // ---- Part 2: the browser, with the fixture ----
  const { chromium } = require('playwright');
  const server = http.createServer((q, s) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'overlay.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
    let body = fs.readFileSync(f);
    if (f.endsWith(path.join('mod', 'index.json'))) { const l = JSON.parse(body); if (!l.includes('lidar-stream')) l.push('lidar-stream'); body = JSON.stringify(l); } // scratch switch-on
    s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); s.end(body);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/overlay.html`;
  const b = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', args: process.env.CI ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [], ea = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route(/environment\.data\.gov\.uk/, async route => {
    const u = decodeURIComponent(route.request().url()); ea.push({ u, at: Date.now() });
    const E = u.match(/subset=E\((\d+),(\d+)\)/), N = u.match(/subset=N\((\d+),(\d+)\)/);
    if (!E || !N) return route.fulfill({ status: 400, body: 'fixture: bad request' });
    const e0 = +E[1], e1 = +E[2], n0 = +N[1], n1 = +N[2], dsm = /DSM/.test(u);
    const body = R5.synthTiff(e0, n1, e1 - e0, n1 - n0, (i, j) => { const e = e0 + i + 0.5, n = n1 - j - 0.5; return DTM(e, n) + (dsm ? BUILDING(e, n) : 0); });
    route.fulfill({ status: 200, headers: { 'content-type': 'image/tiff', 'access-control-allow-origin': '*' }, body: Buffer.from(body) });
  });
  await p.goto(`${base}?lat=52.2441634&lon=-1.0453368`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__lidarStream, null, { timeout: 30000 });
  check('module loads, adds its button', (await p.$$eval('button', bs => bs.map(x => x.textContent))).includes('Stream ground'), 'button');
  check('no EA request before arrival', ea.length === 0, `${ea.length}`);
  await p.evaluate(() => window.__lidarStream.useFixture(null, 3000)); // fixture served by route; gap shortened for the test only
  await p.evaluate(() => document.getElementById('wire').click()); await p.waitForTimeout(1500);
  await p.evaluate(() => window.SIM.map.jumpTo({ pitch: 60, zoom: 15.2, bearing: 30 }));
  await p.evaluate(() => document.getElementById('drone').click()); // arrival
  await p.waitForFunction(() => window.__lidarStream.blocks().some(b => b.kind === 'above-ground'), null, { timeout: 30000 });
  await p.waitForTimeout(1500);
  const bl = await p.evaluate(() => window.__lidarStream.blocks()), rc = await p.evaluate(() => window.__lidarStream.receipt());
  check('two requests: DTM then DSM', ea.length === 2 && /DTM/.test(ea[0].u) && /DSM/.test(ea[1].u), ea.map(x => x.u.slice(0, 120)).join(' | '));
  check('DSM waited the gap after the DTM', ea.length === 2 && ea[1].at - ea[0].at >= 2900, ea.length === 2 ? `${ea[1].at - ea[0].at} ms` : '-');
  check('one 2,048 m box per product', ea.every(x => { const E = x.u.match(/E\((\d+),(\d+)\)/); return E && +E[2] - +E[1] === 2048 && +E[1] % 2048 === 0; }), ea.map(x => (x.u.match(/E\([^)]*\)/) || [''])[0]).join(' '));
  const gr = bl.find(x => x.kind === 'ground'), ab = bl.find(x => x.kind === 'above-ground');
  check('ground wire: 8 m grid over the tile, measured', gr && gr.n === 2 * 256 * 255 && gr.prov === 'measured', JSON.stringify(gr));
  check('above-ground posts: the 40 m block (derived)', ab && ab.prov === 'derived' && ab.n / 5 >= 25 && ab.n / 5 <= 36, JSON.stringify(ab));
  check('anchored near the tile centre (real lat/lon)', gr && Math.abs(gr.lat - 52.25) < 0.03 && Math.abs(gr.lon + 1.05) < 0.03, gr ? `${gr.lat} ${gr.lon}` : '-');
  check('receipt on screen with sha256 and licence', /sha256\(cells\) [0-9a-f]{64}/.test(rc) && /Open Government Licence v3\.0/.test(rc) && /Environment Agency/.test(rc), rc.slice(0, 200));
  check('survey year stated as not read (rule 9)', /pre-construction ground/.test(rc), 'rule 9 words');
  // HEIGHT DATUM: heightAt against the fixture's own formula (independent truth), then the drawn height at 200 nodes.
  const hq = await p.evaluate(() => { const g = window.__lidarStream.tiles.values().next().value.tile; return { g, r: window.__lidarStream.heightAt(g.e0 + 700.3, g.n0 + 900.8) }; });
  const hTrue = DTM(hq.g.e0 + 700.5, hq.g.n0 + 900.5);
  check('heightAt = the measured cell, with its receipt', hq.r.h != null && Math.abs(hq.r.h - hTrue) < 1e-3 && /^[0-9a-f]{12}$/.test(hq.r.receipt) && hq.r.prov === 'measured', `${hq.r.h} vs ${hTrue.toFixed(4)} receipt ${hq.r.receipt}`);
  const pr = await p.evaluate(() => window.__lidarStream.probe(200));
  check('datum probe: 200 nodes drawn at their own DTM height, |D| < 0.5 m', pr.nodes === 200 && pr.maxAbsD < 0.5, `max|D| ${pr.maxAbsD.toFixed(4)} m, mean ${pr.meanD.toFixed(4)} m; map DEM vs DTM max ${pr.maxAbsDemD} m over ${pr.demNodes} loaded nodes (item 3; fixture DTM is synthetic)`);
  await p.screenshot({ path: path.join(OUT, 'stream-1-drone.png') });
  // LAYER ORDER: Satellite moves the measured wire to its own see-through layer (imagery stays visible); Wire takes it back.
  await p.evaluate(() => document.getElementById('sat').click()); await p.waitForTimeout(2500);
  const ls = await p.evaluate(() => window.__lidarStream.layer());
  check('Satellite: measured wire on its own see-through layer above the imagery, not in the solid wire', ls.satellite && ls.onMap && ls.own >= 1 && ls.inWire === 0 && ls.alpha < 0.5, JSON.stringify(ls));
  await p.screenshot({ path: path.join(OUT, 'stream-2-satellite.png') });
  await p.evaluate(() => document.getElementById('wire').click()); await p.waitForTimeout(1500);
  const lw = await p.evaluate(() => window.__lidarStream.layer());
  check('Wire: blocks back in the solid wire layer, own layer empty', !lw.satellite && lw.own === 0 && lw.inWire === bl.length, JSON.stringify(lw));
  // The receipt panel never covers the landing caption (#info, with the pylons line): bounding rects must not intersect.
  await p.evaluate(() => { const i = document.getElementById('info'); i.style.display = ''; i.textContent = 'Pylons: caption overlap check, a long line that runs across the bottom of the screen like the mapped pylons caption does'; });
  await p.waitForTimeout(200);
  await p.waitForTimeout(1200);
  // STRICT (r4): the receipt's visible box against EVERY visible caption element on the page: any element that holds its
  // own text, is rendered (checkVisibility, so position:fixed captions count too; offsetParent is null for those) and has
  // a non-empty rect. Fails on 7cc775a, where the box sat over #where, the note and the attribution strip.
  const ov = await p.evaluate(() => { const R = document.getElementById('lidar-stream-receipt'), vis = e => e.getClientRects().length > 0 && (!e.checkVisibility || e.checkVisibility({ checkOpacityProperty: true, checkVisibilityCSS: true }));
    const shown = [...R.querySelectorAll('*'), R].filter(e => vis(e) && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
    const hits = [], caps = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (R.contains(el) || !vis(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
      const c = el.getBoundingClientRect(); if (!(c.width > 0 && c.height > 0)) continue; caps.push(el.id || el.className || el.tagName);
      for (const a of shown) if (a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom) hits.push(`${el.id || el.tagName}:${el.textContent.trim().slice(0, 30)}`);
    }
    return { receiptRects: shown.length, lines: shown.map(r => Math.round(r.height)), caps: caps.length, hits, visibleIds: caps.filter(x => typeof x === 'string' && /^(where|attribution|sim-note|procedural-caption|info)$/.test(x)) }; });
  check('receipt is ONE line and overlaps NO visible caption (#where, note, pylon/placement caption, attribution)', ov.receiptRects === 1 && ov.lines[0] <= 16 && ov.hits.length === 0 && ov.visibleIds.includes('where') && ov.visibleIds.includes('attribution') && ov.visibleIds.includes('sim-note'), `receipt text boxes ${ov.receiptRects} (h ${ov.lines.join(',')}); ${ov.caps} visible captions incl ${ov.visibleIds.join(',')}; hits: ${ov.hits.join(' | ') || 'none'}`);
  const ln = await p.evaluate(() => window.__lidarStream.line());
  check('one dim line reads "measured ground: EA LiDAR 1 m, tile E/N, receipt sha8"', /^measured ground: EA LiDAR 1 m, tile \d+\/\d+, receipt [0-9a-f]{8}$/.test(ln.text) && !ln.open, ln.text);
  await p.click('#lidar-stream-line'); await p.waitForTimeout(300);
  const op = await p.evaluate(() => { const f = document.getElementById('lidar-stream-full'); return { vis: !f.hidden && f.getClientRects().length > 0, t: f.textContent }; });
  await p.screenshot({ path: path.join(OUT, 'stream-6-receipt-open.png') });
  await p.click('#lidar-stream-line'); await p.waitForTimeout(300);
  const cl = await p.evaluate(() => document.getElementById('lidar-stream-full').hidden);
  check('click opens the full receipt (sha256, licence), click again closes it', op.vis && /sha256\(cells\) [0-9a-f]{64}/.test(op.t) && /Open Government Licence/.test(op.t) && cl, `open ${op.vis}, closed after ${cl}`);
  // WALK (r3): the measured wire is visible near the walker (Satellite, Walk pose). The frame must be healthy
  // (transform.elevation = the ground at the centre); the overlay's stuck MapLibre _elevationFreeze is cleared here and
  // reported to the lead as a separate camera fault. Checks: node count within 100 m on screen, some in the lower third,
  // and pixels the layer adds in the lower third (shown vs hidden).
  await p.evaluate(() => document.getElementById('sat').click()); await p.waitForTimeout(2500);
  await p.evaluate(() => { const m = window.SIM.map; m.jumpTo({ center: [-1.0453368, 52.2441634], zoom: 16.5, pitch: 60, bearing: 30 }); m._elevationFreeze = false; m.triggerRepaint(); });
  await p.waitForTimeout(1500);
  await p.evaluate(() => window.SIM.map.easeTo({ zoom: 18.5, pitch: 80, duration: 900 }));
  await p.evaluate(() => new Promise(r => { const m = window.SIM.map; setTimeout(() => { m.once('idle', r); m.triggerRepaint(); setTimeout(r, 6000); }, 1500); }));
  const near = await p.evaluate(() => { const m = window.SIM.map, T = m.transform, M = T.customLayerMatrix(), c = m.getCenter(), E = T.elevation || 0;
    const mc = maplibregl.MercatorCoordinate.fromLngLat(c, 0), mpm = maplibregl.MercatorCoordinate.fromLngLat(c, 1).z, o2 = { E, nodes: 0, onScreen: 0, low: 0 };
    for (const t of window.__lidarStream.tiles.values()) for (const b of t.blks || []) { if (b.kind !== 'ground') continue;
      const o = maplibregl.MercatorCoordinate.fromLngLat([b.anchor.lon, b.anchor.lat], b.gz + (b.E || 0) - E);
      for (let i = 0; i < b.buf.length; i += 3) { const x = b.buf[i] + o.x, y = b.buf[i + 1] + o.y, z = b.buf[i + 2] + o.z; if (Math.hypot(x - mc.x, y - mc.y) / mpm > 100) continue; o2.nodes++;
        const w = M[3] * x + M[7] * y + M[11] * z + M[15], X = (M[0] * x + M[4] * y + M[8] * z + M[12]) / w, Y = (M[1] * x + M[5] * y + M[9] * z + M[13]) / w;
        if (w > 0 && Math.abs(X) <= 1 && Math.abs(Y) <= 1) { o2.onScreen++; if (Y < -1 / 3) o2.low++; } } }
    return o2; });
  const shotA = await p.screenshot({ path: path.join(OUT, 'stream-5-walk-near.png') });
  await p.evaluate(() => { const m = window.SIM.map; m.setLayoutProperty('lidar-stream-sat', 'visibility', 'none'); m.triggerRepaint(); }); await p.waitForTimeout(700);
  const shotB = await p.screenshot();
  await p.evaluate(() => { const m = window.SIM.map; m.setLayoutProperty('lidar-stream-sat', 'visibility', 'visible'); m.triggerRepaint(); });
  const lowPx = await p.evaluate(async ([A, B]) => { const ld = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s; });
    const [ia, ib] = await Promise.all([ld(A), ld(B)]), W = ia.width, H = ia.height, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
    g.drawImage(ia, 0, 0); const da = g.getImageData(0, 0, W, H).data; g.drawImage(ib, 0, 0); const db = g.getImageData(0, 0, W, H).data; let n = 0;
    for (let y = Math.floor(2 * H / 3); y < H; y++) for (let x = 0; x < W; x++) { const k = 4 * (y * W + x); if (Math.abs(da[k] - db[k]) + Math.abs(da[k + 1] - db[k + 1]) + Math.abs(da[k + 2] - db[k + 2]) > 24) n++; }
    return n; }, [shotA.toString('base64'), shotB.toString('base64')]);
  check('Walk: measured wire visible near the walker (nodes on screen, lower third lit)', near.E > 50 && near.onScreen > 100 && near.low > 0 && lowPx > 500, `E ${near.E.toFixed(2)} m; ${near.onScreen}/${near.nodes} nodes within 100 m on screen, ${near.low} in the lower third; ${lowPx} px drawn in the lower third`);
  const pw = await p.evaluate(() => window.__lidarStream.probe(200));
  check('Walk frame: nodes still at their own DTM height with E set, |D| < 0.05 m', pw.maxAbsD < 0.05, `max|D| ${pw.maxAbsD.toFixed(4)} m at E ${near.E.toFixed(2)} m`);
  await p.evaluate(() => document.getElementById('wire').click()); await p.waitForTimeout(1500);
  // Movement never fetches: walk and pan.
  const n0 = ea.length;
  await p.evaluate(() => window.SIM.map.jumpTo({ center: [-1.046, 52.2436], zoom: 17.5, pitch: 72 }));
  await p.keyboard.down('w'); await p.waitForTimeout(1500); await p.keyboard.up('w');
  await p.evaluate(() => window.SIM.map.panBy([300, 0], { duration: 0 })); await p.waitForTimeout(1500);
  check('walking and panning never fetch', ea.length === n0, `${ea.length - n0} new`);
  await p.screenshot({ path: path.join(OUT, 'stream-2-walk.png') });
  // Outside coverage: Scotland (outside the envelope), by the Stream ground button (an arrival).
  await p.evaluate(() => window.SIM.map.jumpTo({ center: [-3.19, 55.95], zoom: 14 })); await p.waitForTimeout(800);
  await p.$$eval('button', bs => bs.find(x => x.textContent === 'Stream ground').click()); await p.waitForTimeout(1500);
  const rc2 = await p.evaluate(() => window.__lidarStream.receipt());
  check('outside coverage says "no measured ground here", no request', /no measured ground here/.test(rc2) && ea.length === n0, rc2.slice(0, 160));
  await p.screenshot({ path: path.join(OUT, 'stream-3-outside.png') });
  // The landing caption (#info) belongs to the overlay; arrival text goes only to this module's receipt panel.
  const inf0 = await p.evaluate(() => (document.getElementById('info') || {}).textContent);
  await p.evaluate(() => window.__lidarStream.arrive('check')); await p.waitForTimeout(300);
  const inf1 = await p.evaluate(() => (document.getElementById('info') || {}).textContent), rc3 = await p.evaluate(() => window.__lidarStream.receipt());
  check('#info unchanged by arrive(); arrival line is the receipt panel first line', inf0 != null && inf1 === inf0 && /^Arrived \(check\): measured ground for tile \d+ E \d+ N streams here; moving never fetches\./.test(rc3) && ea.length === n0, `info "${String(inf1).slice(0, 60)}" | receipt "${rc3.split('\n')[0].slice(0, 90)}"`);
  // Network error (status 0): exactly one retry in the same arrival, never on movement; then the honest label.
  await p.evaluate(() => { window.__calls = 0; window.__lidarStream.useFixture((u, o) => { window.__calls++; if (window.__calls === 1) throw new TypeError('Failed to fetch'); return fetch(u, o); }, 1500); });
  await p.evaluate(() => window.SIM.map.jumpTo({ center: [-1.30, 51.75], zoom: 15, pitch: 50 })); await p.waitForTimeout(600);
  await p.$$eval('button', bs => bs.find(x => x.textContent === 'Stream ground').click());
  await p.waitForFunction(() => /complete/.test(window.__lidarStream.receipt()), null, { timeout: 30000 });
  const c1 = await p.evaluate(() => window.__calls), rc4 = await p.evaluate(() => window.__lidarStream.receipt());
  check('network error: DTM retried once, then DTM and DSM (fetchImpl 3 calls: fail, DTM, DSM)', c1 === 3 && /DTM receipt [0-9a-f]{12}/.test(rc4), `calls ${c1}`);
  await p.evaluate(() => { window.__calls = 0; window.__lidarStream.useFixture((u, o) => { window.__calls++; if (window.__calls === 1) throw new TypeError('Failed to fetch'); return fetch(u, o); }, 1500); });
  await p.evaluate(() => window.SIM.map.jumpTo({ center: [-1.60, 51.75], zoom: 15, pitch: 50 })); await p.waitForTimeout(600);
  await p.evaluate(() => window.__lidarStream.arrive('check'));
  await p.waitForFunction(() => /DTM receipt/.test(window.__lidarStream.receipt()), null, { timeout: 30000 });
  const c2 = await p.evaluate(() => window.__calls);
  check('throws once then succeeds: exactly 2 DTM calls', c2 === 2, `calls ${c2}`);
  await p.waitForFunction(() => /complete/.test(window.__lidarStream.receipt()), null, { timeout: 30000 });
  await p.evaluate(() => { window.__calls = 0; window.__lidarStream.useFixture(() => { window.__calls++; throw new TypeError('Failed to fetch'); }, 1500); });
  await p.evaluate(() => window.SIM.map.panBy([400, 200], { duration: 0 })); await p.keyboard.down('w'); await p.waitForTimeout(1500); await p.keyboard.up('w');
  await p.evaluate(() => window.SIM.map.jumpTo({ center: [-1.90, 51.75], zoom: 15 })); await p.waitForTimeout(2500);
  check('0 fetch calls on move, pan or walk', (await p.evaluate(() => window.__calls)) === 0, `calls ${await p.evaluate(() => window.__calls)}`);
  await p.evaluate(() => window.__lidarStream.arrive('check'));
  await p.waitForFunction(() => /no measured ground shown/.test(window.__lidarStream.receipt()), null, { timeout: 30000 });
  await p.waitForTimeout(3000);
  const c3 = await p.evaluate(() => window.__calls), rc5 = await p.evaluate(() => window.__lidarStream.receipt());
  check('two network errors: 2 calls, labelled "DTM fetch failed (<reason>); no measured ground shown"', c3 === 2 && /DTM fetch failed \(Failed to fetch\); no measured ground shown/.test(rc5) && !/DTM: no measured ground here/.test(rc5), `calls ${c3} | ${rc5.split('\n')[1]}`);
  await p.screenshot({ path: path.join(OUT, 'stream-4-fetch-failed.png') });
  await p.evaluate(() => window.__lidarStream.useFixture(null, 3000));
  // RIDGE (r5): does the Satellite layer's depth bias let a hill hide the far wire, and still draw the far wire the
  // camera can see? A fully SYNTHETIC world on its own page: the EA WCS fixture AND the map's DEM tiles (terrarium) both
  // come from one steep N-S ridge made here; no live heights. The imagery is a flat grey tile made here, unless
  // RIDGE_REAL_SAT=1 (then the live satellite is drawn, for the look). Each node >= 1 km away (every 13th vertex, on
  // screen, its projected 8 m segment >= 1 px; sub-pixel ones are skipped, not failed) is classed by line of sight over
  // the synthetic ground: HIDDEN if the ground rises > 3 m above the sight line; VISIBLE if the sight line clears the
  // ground by >= 3 m everywhere except the last 50 m before the node; otherwise ambiguous (counted, not asserted).
  // Drawn = the 3x3 pixels round the node differ from the same view with the layer off. RIDGE_BIAS overrides the
  // module's DEPTH_BIAS in the served copy only (for the bias search).
  {
    const BNG = await import(pathToFileURL(path.join(ROOT, 'world', 'bng.mjs')).href);
    const RT = { e0: 374784, n0: 243712 }, RE = RT.e0 + 500, RIDGE = (e) => 50 + 180 * Math.exp(-((e - RE) ** 2) / (2 * 250 * 250));
    const realSat = process.env.RIDGE_REAL_SAT === '1', bias = process.env.RIDGE_BIAS;
    const zlib = require('zlib'), crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (ty, d) => { const L = Buffer.alloc(4), T = Buffer.from(ty), C = Buffer.alloc(4); L.writeUInt32BE(d.length); C.writeUInt32BE(crc(Buffer.concat([T, d]))); return Buffer.concat([L, T, d, C]); };
    const png = (px) => { const raw = Buffer.alloc(256 * 769); for (let y = 0; y < 256; y++) { raw[y * 769] = 0; for (let x = 0; x < 256; x++) { const [r, g, bb] = px(x, y); raw[y * 769 + 1 + 3 * x] = r; raw[y * 769 + 2 + 3 * x] = g; raw[y * 769 + 3 + 3 * x] = bb; } }
      const h = Buffer.alloc(13); h.writeUInt32BE(256, 0); h.writeUInt32BE(256, 4); h[8] = 8; h[9] = 2;
      return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', h), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); };
    const ll = (z, x, y) => ({ lon: x / 2 ** z * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180 / Math.PI });
    const demTile = (z, x, y) => { const c = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([i, j]) => { const g = ll(z, x + i, y + j); return BNG.wgs84ToBng(g.lat, g.lon); });
      return png((px, py) => { const u = (px + 0.5) / 256, v = (py + 0.5) / 256, e = (1 - v) * ((1 - u) * c[0].e + u * c[1].e) + v * ((1 - u) * c[2].e + u * c[3].e);
        const h = Math.round((z < 9 ? 50 : RIDGE(e)) * 256) + 32768 * 256; return [(h >> 16) & 255, (h >> 8) & 255, h & 255]; }); };
    const grey = png(() => [128, 128, 128]);
    const q = await b.newPage({ viewport: { width: 1280, height: 800 } }), rErr = [];
    q.on('pageerror', e => rErr.push(e.message));
    if (bias) await q.route(/mod\/lidar-stream\.js/, async r => { const f = await r.fetch(); r.fulfill({ response: f, body: (await f.text()).replace(/DEPTH_BIAS = [0-9.]+/,`DEPTH_BIAS = ${bias}`) }); });
    await q.route(/elevation-tiles-prod\/terrarium\/\d+\/\d+\/\d+\.png/, r => { const [z, x, y] = r.request().url().match(/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/).slice(1).map(Number);
      r.fulfill({ status: 200, headers: { 'content-type': 'image/png', 'access-control-allow-origin': '*' }, body: demTile(z, x, y) }); });
    if (!realSat) await q.route(/World_Imagery/, r => r.fulfill({ status: 200, headers: { 'content-type': 'image/png', 'access-control-allow-origin': '*' }, body: grey }));
    await q.route(/environment\.data\.gov\.uk/, r => { const u = decodeURIComponent(r.request().url()), E = u.match(/subset=E\((\d+),(\d+)\)/), N = u.match(/subset=N\((\d+),(\d+)\)/);
      if (!E || !N) return r.fulfill({ status: 400, body: 'fixture: bad request' });
      const e0 = +E[1], e1 = +E[2], n0 = +N[1], n1 = +N[2];
      r.fulfill({ status: 200, headers: { 'content-type': 'image/tiff', 'access-control-allow-origin': '*' }, body: Buffer.from(R5.synthTiff(e0, n1, e1 - e0, n1 - n0, i => RIDGE(e0 + i + 0.5))) }); });
    const c0 = BNG.bngToWgs84(RT.e0 + 1024, RT.n0 + 1024);
    await q.goto(`${base}?lat=${c0.lat}&lon=${c0.lon}`, { waitUntil: 'load' });
    await q.waitForFunction(() => window.__lidarStream && window.SIM && window.SIM.map && document.querySelector('canvas.maplibregl-canvas'), null, { timeout: 60000 });
    const gpu = await q.evaluate(() => { const g = document.createElement('canvas').getContext('webgl'), d = g && g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?'; });
    await q.evaluate(() => window.__lidarStream.useFixture(null, 3000));
    await q.evaluate(() => document.getElementById('sat').click()); await q.waitForTimeout(2000);
    await q.evaluate(() => window.__lidarStream.arrive('ridge check'));
    await q.waitForFunction(() => /DTM receipt/.test(window.__lidarStream.receipt()) && window.__lidarStream.blocks().some(b => b.kind === 'ground'), null, { timeout: 60000 });
    // Walker 1.4 km east of the crest, looking west across it: move the centre until the CAMERA stands there.
    const cam = BNG.bngToWgs84(RT.e0 + 1900, RT.n0 + 1024);
    await q.evaluate(async ([la, lo]) => { const m = window.SIM.map; let c = [lo - 0.004, la];
      for (let k = 0; k < 4; k++) { m.jumpTo({ center: c, zoom: 17.2, pitch: 84, bearing: 270 }); m._elevationFreeze = false; m.triggerRepaint();
        await new Promise(r => setTimeout(r, 1500)); const p = m.transform.getCameraPosition().lngLat; c = [c[0] + lo - p.lng, c[1] + la - p.lat]; } }, [cam.lat, cam.lon]);
    await q.evaluate(() => new Promise(r => { const m = window.SIM.map; setTimeout(() => { m.once('idle', r); m.triggerRepaint(); setTimeout(r, 12000); }, 1500); }));
    await q.waitForTimeout(2000);
    const tag = `${realSat ? 'sat-live' : 'grey'}-bias${bias || 'module'}`;
    await q.screenshot({ path: path.join(OUT, `stream-7-ridge-${tag}.png`) });
    // Classify (full wire on the map), then draw ONE class at a time: with the whole mesh drawn, a node behind the crest
    // projects onto pixels the front slope's own wire already lights, so a per-pixel check cannot tell them apart.
    const rs = await q.evaluate(() => {
      const m = window.SIM.map, T = m.transform, M = T.customLayerMatrix(), E = T.elevation || 0, cp = T.getCameraPosition(), PF = window.SIM.PF || window.__pf.PF, LS = window.__lidarStream;
      const W = m.getCanvas().clientWidth, H = m.getCanvas().clientHeight, cb = PF.toBng(cp.lngLat.lat, cp.lngLat.lng), camH = cp.altitude;
      const proj = (x, y, z) => { const w = M[3] * x + M[7] * y + M[11] * z + M[15]; return w <= 0 ? null : [(M[0] * x + M[4] * y + M[8] * z + M[12]) / w, (M[1] * x + M[5] * y + M[9] * z + M[13]) / w]; };
      const st = { E: +E.toFixed(1), camAlt: +camH.toFixed(1), hidden: 0, visible: 0, ambiguous: 0, subPixel: 0, minHidden: 1e9 }, cls = { hidden: [], visible: [] }, segs = { hidden: [], visible: [] };
      const ground = [...LS.tiles.values()].flatMap(t => t.blks || []).filter(b => b.kind === 'ground');
      ground.forEach((bk, bi) => { const o = maplibregl.MercatorCoordinate.fromLngLat([bk.anchor.lon, bk.anchor.lat], bk.gz + (bk.E || 0) - E);
        for (let v = 0; v < bk.buf.length / 3; v += 13) { const i = 3 * v, j = 3 * (v ^ 1), x = bk.buf[i] + o.x, y = bk.buf[i + 1] + o.y, z = bk.buf[i + 2] + o.z;
          const P = proj(x, y, z); if (!P || Math.abs(P[0]) > 0.98 || Math.abs(P[1]) > 0.98) continue;
          const ll = new maplibregl.MercatorCoordinate(x, y, 0).toLngLat(), nb = PF.toBng(ll.lat, ll.lng), nh = LS.heightAt(nb.e, nb.n).h; if (nh == null) continue;
          const d = Math.hypot(nb.e - cb.e, nb.n - cb.n); if (d < 1000) continue;
          const Q = proj(bk.buf[j] + o.x, bk.buf[j + 1] + o.y, bk.buf[j + 2] + o.z); if (!Q || Math.hypot((P[0] - Q[0]) * W / 2, (P[1] - Q[1]) * H / 2) < 1) { st.subPixel++; continue; }
          let up = -1e9, upFar = -1e9; for (let s = 1; s < 200; s++) { const f = s / 200, h = LS.heightAt(cb.e + (nb.e - cb.e) * f, cb.n + (nb.n - cb.n) * f).h; if (h == null) continue; const x2 = h - (camH + (nh - camH) * f); up = Math.max(up, x2); if ((1 - f) * d > 50) upFar = Math.max(upFar, x2); }
          const k = up > 3 ? 'hidden' : upFar <= -3 ? 'visible' : null; if (!k) { st.ambiguous++; continue; }
          st[k]++; if (k === 'hidden') st.minHidden = Math.min(st.minHidden, Math.round(d));
          cls[k].push([(P[0] + 1) / 2, (1 - P[1]) / 2]); segs[k].push([bi, Math.min(v, v ^ 1)]); } });
      const keep = ground.map(b => b.buf);
      window.__ridgeShow = k => { const impl = m.style._layers['lidar-stream-sat'].implementation; impl.vbo = new WeakMap();
        ground.forEach((b, bi) => { if (!k) { b.buf = keep[bi]; return; } const s = segs[k].filter(x => x[0] === bi), f = new Float32Array(s.length * 6);
          s.forEach(([, v], n) => f.set(keep[bi].subarray(3 * v, 3 * v + 6), 6 * n)); b.buf = f; }); m.triggerRepaint(); };
      window.__ridgeCls = cls; return st; });
    const litRate = async (k) => {
      await q.evaluate(k => window.__ridgeShow(k), k); await q.waitForTimeout(1200);
      const A = await q.screenshot({ path: path.join(OUT, `stream-7-ridge-${tag}-only-${k}.png`) });
      await q.evaluate(() => { const m = window.SIM.map; m.setLayoutProperty('lidar-stream-sat', 'visibility', 'none'); m.triggerRepaint(); }); await q.waitForTimeout(900);
      const B = await q.screenshot();
      await q.evaluate(() => { const m = window.SIM.map; m.setLayoutProperty('lidar-stream-sat', 'visibility', 'visible'); m.triggerRepaint(); });
      return q.evaluate(async ([a, bb, k]) => {
        const ld = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s; });
        const [ia, ib] = await Promise.all([ld(a), ld(bb)]), W = ia.width, H = ia.height, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
        g.drawImage(ia, 0, 0); const da = g.getImageData(0, 0, W, H).data; g.drawImage(ib, 0, 0); const db = g.getImageData(0, 0, W, H).data;
        const lit = (px, py) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = px + dx, y = py + dy; if (x < 0 || y < 0 || x >= W || y >= H) continue; const i = 4 * (y * W + x); if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 24) return true; } return false; };
        return window.__ridgeCls[k].filter(([u, v]) => lit(Math.round(u * W), Math.round(v * H))).length; }, [A.toString('base64'), B.toString('base64'), k]);
    };
    rs.hiddenDrawn = await litRate('hidden'); rs.visibleDrawn = await litRate('visible');
    await q.evaluate(() => window.__ridgeShow(null));
    const hr = rs.hidden ? rs.hiddenDrawn / rs.hidden : 1, vr = rs.visible ? rs.visibleDrawn / rs.visible : 0;
    console.log('RIDGE', tag, gpu.slice(0, 70), JSON.stringify(rs));
    check(`ridge: hidden nodes >= 1 km drawn <= 1 % (${realSat ? 'live satellite' : 'grey fixture imagery'})`, rs.hidden >= 200 && hr <= 0.01, `${rs.hiddenDrawn}/${rs.hidden} = ${(100 * hr).toFixed(2)} %; nearest hidden ${rs.minHidden} m`);
    check(`ridge: visible nodes >= 1 km (>= 1 px) drawn >= 80 % (${realSat ? 'live satellite' : 'grey fixture imagery'})`, rs.visible >= 50 && vr >= 0.8, `${rs.visibleDrawn}/${rs.visible} = ${(100 * vr).toFixed(1)} %; sub-pixel skipped ${rs.subPixel}, ambiguous ${rs.ambiguous}; camera ${rs.camAlt} m, E ${rs.E} m`);
    check('ridge page: no page errors', rErr.length === 0, rErr.join(' | ') || 'none');
    await q.close();
  }
  check('no page errors', errs.length === 0, errs.join(' | ') || 'none');
  await b.close(); server.close();
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  -- ${r.evidence}`);
  const failed = results.filter(r => !r.ok).length; console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
