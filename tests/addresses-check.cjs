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
const server = http.createServer((q, s) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'overlay.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
});
const results = []; const check = (name, ok, evidence) => results.push({ name, ok: !!ok, evidence: String(evidence).slice(0, 300) });

(async () => {
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
  let worstGr = 0;
  for (const [id, lat, lon, E, N, ref] of gr) {
    const L = await goAndLand('go ' + ref);
    const want = Math.hypot(Math.floor(E) + 0.5 - E, Math.floor(N) + 0.5 - N), got = metres(L, { lat, lon }), err = Math.abs(got - want);
    const back = await readBack(), backRef = await p.evaluate(([e, n]) => import('./world/bng.mjs').then(B => B.gridRef(e, n, 10)), [back.e, back.n]);
    const cen = Math.hypot(back.e - (Math.floor(E) + 0.5), back.n - (Math.floor(N) + 0.5));
    worstGr = Math.max(worstGr, err, cen);
    check(`grid ref ${ref} (OS ${id}) lands exactly`, L.msg === '' && err <= 0.02 && cen <= 0.02 && backRef === ref && back.engine === 'OSTN15',
      `${got.toFixed(3)} m from OS ${id} (square centre is ${want.toFixed(3)} m away); readback ${backRef} by ${back.engine}, ${cen.toFixed(4)} m from square centre`);
    if (id === 'TP09') { await p.waitForTimeout(2500); await p.screenshot({ path: path.join(OUT, '4-gridref-TP09.png') }); }
  }
  // 3. Not an address: find-go keeps it.
  check('non-address text is left to find-go', await p.evaluate(() => window.SIM.addresses.classify('solar 50').then(x => x === null)), 'classify("solar 50") === null');
  // 4. Typed through the real box, as a player would.
  await p.click('#fg-in'); await p.fill('#fg-in', 'TQ 30624 78388'); await p.keyboard.press('Enter');
  await p.waitForTimeout(500); await p.waitForFunction(() => !window.SIM.map.isMoving(), null, { timeout: 30000 }); await p.waitForTimeout(2500);
  const typed = await p.evaluate(() => ({ info: document.getElementById('info').textContent, msg: document.getElementById('fg-msg').textContent }));
  check('typing a grid ref in the find box lands there', /TQ 30624 78388/.test(typed.info) && typed.msg === '', typed.info);
  await p.screenshot({ path: path.join(OUT, '5-typed-box.png') });
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(1500); await p.screenshot({ path: path.join(OUT, '6-phone.png') });
  check('no page errors', errs.length === 0, errs.join(' | ') || 'none');

  await b.close(); server.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ worstPostcodeMetres: worstPc, worstGridRefMetres: worstGr, results }, null, 1));
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  -- ${r.evidence}`);
  const failed = results.filter(r => !r.ok).length;
  console.log(`\nworst postcode ${worstPc.toFixed(2)} m, worst grid ref ${worstGr.toFixed(4)} m\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });
