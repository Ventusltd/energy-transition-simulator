// Addresses check: typed postcodes and grid references land on the right spot, in the real overlay, in Chrome.
//   20 postcodes: land within 50 m of the centroid postcodes.io publishes (tests/fixtures/postcodes-20.json, fetched
//     once; the page's calls to postcodes.io are answered from that file, so the test never touches the service).
//   10 grid references: 10-figure refs cut from the Ordnance Survey's published OSTN15 test points TP03 to TP12
//     (OSTN15_TestInput_ETRStoOSGB / TestOutput, ETRS89 lat/lon with National Grid E/N to the mm). The ref names a
//     1 m square and we land at its centre, so the landing must sit exactly the square-centre offset away from the
//     OS point (to 2 cm), and the landed centre read back through the overlay's own OSTN15 must give the same ref.
// Serves prototype/ locally, adds the addresses module to the module list for this run only (index.json unchanged).
// Screenshots and results.json go to test-output/addresses/ (or ADDR_SHOTS). Browser: playwright's Chrome, or the
// module named by CHROME_LAUNCHER (exports launch()).
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'prototype');
const OUT = process.env.ADDR_SHOTS || path.join(__dirname, '..', 'test-output', 'addresses');
const FIX = require('./fixtures/postcodes-20.json');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
// OS OSTN15 test points (ETRS89 lat, lon; National Grid E, N as the OS publishes them).
const TP = [['TP03', 50.43885825610, -4.10864563561, 250359.811, 62016.569], ['TP04', 50.57563665000, -1.29782277240, 449816.371, 75335.861],
  ['TP05', 50.93127937910, -1.45051433700, 438710.920, 114792.250], ['TP06', 51.40078220140, -3.55128349240, 292184.870, 168003.465],
  ['TP07', 51.37447025550, 1.44454730409, 639821.835, 169565.858], ['TP08', 51.42754743020, -2.54407618349, 362269.991, 169978.690],
  ['TP09', 51.48936564950, -0.11992557180, 530624.974, 178388.464], ['TP10', 51.85890896400, -4.30852476960, 241124.584, 220332.641],
  ['TP11', 51.89436637350, 0.89724327012, 599445.590, 225722.826], ['TP12', 52.25529381630, -2.15458614387, 389544.190, 261912.153]];
fs.mkdirSync(OUT, { recursive: true });
const metres = (a, b) => { const k = Math.cos((a.lat + b.lat) * Math.PI / 360); return Math.hypot((a.lat - b.lat) * 111320, (a.lon - b.lon) * 111320 * k); };
// mode 'crlf' serves the OSTN15 index with CRLF line ends (what a Windows autocrlf checkout holds); mode 'http500'
// answers it with HTTP 500. Both must make the landing label name the fault, not "no OSTN15 block here".
// mode 'block500' answers only the block 51_-1 (holds TP09) with HTTP 500: that fault applies there and nowhere else.
const serve = mode => http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'overlay.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
  if (mode === 'block500' && path.basename(f) === '51_-1.o15') { s.writeHead(500); return s.end(); }
  if (mode && mode !== 'block500' && path.basename(f) === 'ostn15.json') {
    if (mode === 'http500') { s.writeHead(500); return s.end(); }
    s.writeHead(200, { 'Content-Type': 'application/json' }); return s.end(fs.readFileSync(f, 'utf8').replace(/\r?\n/g, '\r\n'));
  }
  s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
});
const server = serve(null);
const results = []; const check = (name, ok, evidence) => results.push({ name, ok: !!ok, evidence: String(evidence).slice(0, 300) });

(async () => {
  // 0. The OSTN15 index must be byte-identical to what ostn15.mjs expects. A Windows checkout with core.autocrlf=true
  //    rewrites it with CRLF; the hash then fails and the page quietly falls back to Helmert (1-3 m off). Say so first.
  { const want = (fs.readFileSync(path.join(ROOT, 'world', 'ostn15.mjs'), 'utf8').match(/INDEX_SHA256 = '([0-9a-f]{64})'/) || [])[1];
    const buf = fs.readFileSync(path.join(ROOT, 'world', 'data', 'ostn15', 'ostn15.json'));
    const got = require('crypto').createHash('sha256').update(buf).digest('hex'), crlf = buf.includes(Buffer.from([13, 10]));
    check('OSTN15 index file is intact (hash matches, so the page uses OSTN15, not Helmert)', want && got === want,
      got === want ? `sha256 ${got.slice(0, 12)}... matches` : `sha256 ${got.slice(0, 12)}... expected ${String(want).slice(0, 12)}...${crlf ? '; the file has CRLF line ends (git core.autocrlf): add "prototype/world/data/** -text" to .gitattributes or clone with -c core.autocrlf=false' : ''}`); }
  const launch = process.env.CHROME_LAUNCHER ? require(process.env.CHROME_LAUNCHER).launch
    : () => require('playwright').chromium.launch({ channel: process.env.CI ? undefined : 'chrome', args: process.env.CI ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [] });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/overlay.html`;
  const b = await launch(); const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [], pcCalls = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/mod/index.json', async r => { const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'mod', 'index.json'), 'utf8'));
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(list.includes('addresses') ? list : [...list, 'addresses']) }); });
  await p.route('https://api.postcodes.io/**', r => { const key = decodeURIComponent(r.request().url().split('/').pop()).replace(/\s/g, '').toUpperCase(); pcCalls.push(key);
    const row = FIX.rows.find(x => x.postcode.replace(/\s/g, '') === key);
    r.fulfill(row ? { status: 200, contentType: 'application/json', body: JSON.stringify({ status: 200, result: row }) } : { status: 404, contentType: 'application/json', body: '{"status":404}' }); });
  await p.goto(`${base}?lat=51.5&lon=-0.12`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.SIM && window.SIM.addresses, null, { timeout: 30000 });
  await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} });

  const goAndLand = async text => {
    const msg = await p.evaluate(t => window.SIM.addresses.go(t), text);
    await p.waitForFunction(() => !window.SIM.map.isMoving(), null, { timeout: 30000 });
    return p.evaluate(m => { const c = window.SIM.map.getCenter(), l = window.SIM.addresses.last(); return { msg: m, lat: c.lat, lon: c.lng, target: l, info: document.getElementById('info').textContent }; }, msg);
  };
  // Readback through the overlay's own converter (window.__pf.PF, its own OSTN15 blocks, loaded on moveend).
  const readBack = async () => { await p.waitForFunction(() => { const c = window.SIM.map.getCenter(); return window.__pf.PF.toBng(c.lat, c.lng).engine === 'OSTN15'; }, null, { timeout: 15000 }).catch(() => {});
    return p.evaluate(() => { const c = window.SIM.map.getCenter(); return window.__pf.PF.toBng(c.lat, c.lng); }); };

  // 1. Postcodes.
  let worstPc = 0; const shotsAt = { 'SW1A 1AA': '1-postcode-SW1A1AA', 'EH1 1YZ': '2-postcode-EH11YZ-helmert', 'CF10 1EP': '3-postcode-CF101EP' };
  for (const row of FIX.rows) {
    const L = await goAndLand('go ' + row.postcode);
    const d = metres(L, { lat: row.latitude, lon: row.longitude }), flown = L.target ? metres(L, L.target) : NaN;
    worstPc = Math.max(worstPc, d);
    const engine = L.target && / by OSTN15/.test(L.target.text) ? 'OSTN15' : 'Helmert';
    check(`postcode ${row.postcode} within 50 m of published centroid`, L.msg === '' && d <= 50 && flown < 0.5,
      `${d.toFixed(2)} m from published ${row.latitude}, ${row.longitude}; landed ${L.lat.toFixed(6)}, ${L.lon.toFixed(6)} by ${engine}; flight end ${flown.toFixed(3)} m from target`);
    if (shotsAt[row.postcode]) { await p.waitForTimeout(2500); await p.screenshot({ path: path.join(OUT, shotsAt[row.postcode] + '.png') }); }
  }
  check('postcodes.io asked once per postcode (cache)', pcCalls.length === FIX.rows.length, `${pcCalls.length} calls for ${FIX.rows.length} postcodes`);
  const again = await goAndLand('go SW1A 1AA');
  check('a repeat postcode uses the cache', pcCalls.length === FIX.rows.length && again.msg === '', `${pcCalls.length} calls after repeat`);

  // 2. Grid references cut from the OS test points.
  const gr = await p.evaluate(tp => import('./world/bng.mjs').then(B => tp.map(([id, lat, lon, E, N]) => [id, lat, lon, E, N, B.gridRef(E, N, 10)])), TP);
  let worstGr = 0, tp09 = null;
  for (const [id, lat, lon, E, N, ref] of gr) {
    const L = await goAndLand('go ' + ref);
    const want = Math.hypot(Math.floor(E) + 0.5 - E, Math.floor(N) + 0.5 - N), got = metres(L, { lat, lon }), err = Math.abs(got - want);
    const back = await readBack(), backRef = await p.evaluate(([e, n]) => import('./world/bng.mjs').then(B => B.gridRef(e, n, 10)), [back.e, back.n]);
    const cen = Math.hypot(back.e - (Math.floor(E) + 0.5), back.n - (Math.floor(N) + 0.5));
    worstGr = Math.max(worstGr, err, cen);
    check(`grid ref ${ref} (OS ${id}) lands exactly`, L.msg === '' && err <= 0.02 && cen <= 0.02 && backRef === ref && back.engine === 'OSTN15',
      `${got.toFixed(3)} m from OS ${id} (square centre is ${want.toFixed(3)} m away); readback ${backRef} by ${back.engine}, ${cen.toFixed(4)} m from square centre`);
    if (id === 'TP09') { tp09 = { err, cen, engine: back.engine, info: L.target && L.target.text }; await p.waitForTimeout(2500); await p.screenshot({ path: path.join(OUT, '4-gridref-TP09.png') }); }
  }
  // 3. Not an address: find-go keeps it.
  check('non-address text is left to find-go', await p.evaluate(() => window.SIM.addresses.classify('solar 50').then(x => x === null)), 'classify("solar 50") === null');
  // 4. Typed through the real box, as a player would.
  await p.click('#fg-in'); await p.fill('#fg-in', 'TQ 30624 78388'); await p.keyboard.press('Enter');
  await p.waitForTimeout(500); await p.waitForFunction(() => !window.SIM.map.isMoving(), null, { timeout: 30000 }); await p.waitForTimeout(2500);
  const typed = await p.evaluate(() => ({ info: document.getElementById('info').textContent, msg: document.getElementById('fg-msg').textContent }));
  check('typing a grid ref in the find box lands there', /TQ 30624 78388/.test(typed.info) && typed.msg === '', typed.info);
  await p.screenshot({ path: path.join(OUT, '5-typed-box.png') });
  // 5. Walk and fly where we landed: the landing must hold while the camera changes mode.
  const hold = async (key, shot) => { const t = await p.evaluate(() => window.SIM.addresses.last());
    await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.keyboard.press(key); await p.waitForTimeout(1200); await p.waitForFunction(() => !window.SIM.map.isMoving(), null, { timeout: 30000 }); await p.waitForTimeout(2000);
    const v = await p.evaluate(() => { const c = window.SIM.map.getCenter(); return { lat: c.lat, lon: c.lng, pitch: window.SIM.map.getPitch(), zoom: window.SIM.map.getZoom() }; });
    await p.screenshot({ path: path.join(OUT, shot + '.png') }); return { v, off: t ? metres(v, t) : NaN }; };
  const w = await hold('1', '7-walk-at-gridref'), f = await hold('2', '8-drone-at-gridref');
  check('walk (1) and drone (2) keep the landed spot', w.v.pitch > 30 && f.v.pitch > 20 && w.off < 0.5 && f.off < 0.5,
    `walk pitch ${w.v.pitch.toFixed(0)} zoom ${w.v.zoom.toFixed(1)} off ${w.off.toFixed(3)} m; drone pitch ${f.v.pitch.toFixed(0)} zoom ${f.v.zoom.toFixed(1)} off ${f.off.toFixed(3)} m`);
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(1500); await p.screenshot({ path: path.join(OUT, '6-phone.png') });
  check('no page errors', errs.length === 0, errs.join(' | ') || 'none');
  check('normal serve: TP09 lands by OSTN15 within 0.01 m', tp09 && tp09.engine === 'OSTN15' && / by OSTN15\./.test(tp09.info) && tp09.err <= 0.01 && tp09.cen <= 0.01,
    tp09 ? `err ${tp09.err.toFixed(4)} m, readback ${tp09.cen.toFixed(4)} m by ${tp09.engine}` : 'TP09 not run');

  // 6. OSTN15 fails to load: the label must name the fault and tag the value estimated, not claim "no block here".
  const HELMERT = 'Helmert, about 3.5 m (OS guide, section 6.6)';
  const faultRun = async (mode, want, shots, scot) => {
    const srv = serve(mode); await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const q = await b.newPage({ viewport: { width: 1280, height: 800 } }), qerr = []; q.on('pageerror', e => qerr.push(e.message));
    await q.route('**/mod/index.json', async r => { const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'mod', 'index.json'), 'utf8'));
      r.fulfill({ contentType: 'application/json', body: JSON.stringify(list.includes('addresses') ? list : [...list, 'addresses']) }); });
    await q.route('https://api.postcodes.io/**', r => { const key = decodeURIComponent(r.request().url().split('/').pop()).replace(/\s/g, '').toUpperCase();
      const row = FIX.rows.find(x => x.postcode.replace(/\s/g, '') === key);
      return row ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: 200, result: row }) })
        : r.fulfill({ status: 404, contentType: 'application/json', body: '{"status":404}' }); });
    await q.goto(`http://127.0.0.1:${srv.address().port}/overlay.html?lat=51.5&lon=-0.12`, { waitUntil: 'load' });
    await q.waitForFunction(() => window.SIM && window.SIM.addresses, null, { timeout: 30000 });
    const typeGo = async t => { await q.click('#fg-in'); await q.fill('#fg-in', t); await q.keyboard.press('Enter');
      await q.waitForTimeout(500); await q.waitForFunction(() => !window.SIM.map.isMoving(), null, { timeout: 30000 }); await q.waitForTimeout(2500);
      return q.evaluate(() => ({ info: document.getElementById('info').textContent, last: window.SIM.addresses.last(), fault: window.SIM.addresses.fault() })); };
    const got = await typeGo('TQ 30624 78388');
    const txt = got.last ? got.last.text : '';
    check(`OSTN15 ${mode}: typed grid ref label names the fault`, txt.includes(HELMERT + ': ' + want) && txt.includes('[estimated]') && !/no OSTN15 block here/.test(txt) && !/ by OSTN15\./.test(txt) && !/±5/.test(txt),
      txt || JSON.stringify(got));
    if (shots) { await q.screenshot({ path: path.join(OUT, shots[0] + '.png') });
      if (shots[1]) { await q.setViewportSize({ width: 390, height: 844 }); await q.waitForTimeout(1500); await q.screenshot({ path: path.join(OUT, shots[1] + '.png') }); } }
    if (scot) { // same page: a key not in the index keeps "no OSTN15 block here", with no stale block fault
      const g2 = await typeGo('go EH1 1YZ'), t2 = g2.last ? g2.last.text : '';
      check(`OSTN15 ${mode}: EH1 1YZ afterwards still says no OSTN15 block here, not the stale fault`,
        /^EH1 1YZ/.test(t2) && t2.includes(HELMERT + ', no OSTN15 block here') && !/could not be fetched|failed its check|\[estimated\]|±5/.test(t2), t2 || JSON.stringify(g2));
      await q.screenshot({ path: path.join(OUT, scot + '.png') }); }
    check(`OSTN15 ${mode}: no page errors`, qerr.length === 0, qerr.join(' | ') || 'none');
    await q.close(); srv.close();
  };
  await faultRun('crlf', 'OSTN15 index failed its check', ['9-ostn15-crlf-fault-desktop', '10-ostn15-crlf-fault-phone390']);
  await faultRun('http500', 'OSTN15 index could not be fetched', null);
  await faultRun('block500', 'OSTN15 block 51_-1 could not be fetched (HTTP 500)', ['11-block500-TP09-fault'], '12-block500-then-EH11YZ-no-block');

  await b.close(); server.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ worstPostcodeMetres: worstPc, worstGridRefMetres: worstGr, results }, null, 1));
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  -- ${r.evidence}`);
  const failed = results.filter(r => !r.ok).length;
  console.log(`\nworst postcode ${worstPc.toFixed(2)} m, worst grid ref ${worstGr.toFixed(4)} m\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });
