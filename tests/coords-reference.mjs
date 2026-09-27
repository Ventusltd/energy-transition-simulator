// Coords reference check: the ONE conversion (place-frame.mjs with the world's OSTN15) against the Ordnance Survey's
// own published answers. No network, no browser: reads the committed OSTN15 blocks from disk through the same
// hash-checked loader the page uses, so a checkout that alters the data (CRLF line endings on ostn15.json) FAILS here
// instead of silently dropping the page to Helmert (about 2 m off).
//
// References (external truth): OS OSTN15 test points TP01 to TP12 from OSTN15_TestInput_ETRStoOSGB / TestOutput
// (ETRS89 lat/lon and National Grid E/N as the OS publishes them, to the mm). These are the OS test points inside the
// committed England blocks. Tolerance 0.1 m, the owner's lane target.
// Run: node tests/coords-reference.mjs      (exit 1 on any FAIL)
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as PF from '../prototype/place-frame.mjs';
import * as BNG from '../prototype/world/bng.mjs';
import { createOstn15, etrsToBng, bngToEtrs, INDEX_SHA256 } from '../prototype/world/ostn15.mjs';

const WORLD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prototype', 'world');
const results = [];
const check = (name, ok, evidence) => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  | ${evidence}`); };

// Same contract as ostn15.mjs getChecked: refuse any file whose SHA-256 is not the pinned one.
const get = async (rel, sha) => {
  const buf = readFileSync(path.join(WORLD, rel)), got = createHash('sha256').update(buf).digest('hex');
  if (got !== sha) throw Error(`${rel}: hash ${got.slice(0, 12)} is not the pinned ${sha.slice(0, 12)}`);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

const idx = readFileSync(path.join(WORLD, 'data', 'ostn15', 'ostn15.json'));
const idxSha = createHash('sha256').update(idx).digest('hex');
check('OSTN15 index hash is the pinned one (fails on a CRLF checkout)', idxSha === INDEX_SHA256,
  `file ${idxSha.slice(0, 12)} pinned ${INDEX_SHA256.slice(0, 12)}${idx.includes(13) ? ', file has CR bytes' : ''}`);

const OSTN = createOstn15({ get });
PF.useWorld(BNG, { blocks: OSTN.blocks, etrsToBng, bngToEtrs });

const TP = [['TP01', 49.92226393730, -6.29977752014, 91492.146, 11318.804], ['TP02', 49.96006137820, -5.20304609998, 170370.718, 11572.405],
  ['TP03', 50.43885825610, -4.10864563561, 250359.811, 62016.569], ['TP04', 50.57563665000, -1.29782277240, 449816.371, 75335.861],
  ['TP05', 50.93127937910, -1.45051433700, 438710.920, 114792.250], ['TP06', 51.40078220140, -3.55128349240, 292184.870, 168003.465],
  ['TP07', 51.37447025550, 1.44454730409, 639821.835, 169565.858], ['TP08', 51.42754743020, -2.54407618349, 362269.991, 169978.690],
  ['TP09', 51.48936564950, -0.11992557180, 530624.974, 178388.464], ['TP10', 51.85890896400, -4.30852476960, 241124.584, 220332.641],
  ['TP11', 51.89436637350, 0.89724327012, 599445.590, 225722.826], ['TP12', 52.25529381630, -2.15458614387, 389544.190, 261912.153]];

let worstF = 0, worstI = 0, worstRT = 0, worstH = 0;
for (const [id, lat, lon, E, N] of TP) {
  const ok = await OSTN.need(lat, lon);
  const f = PF.toBng(lat, lon), dF = Math.hypot(f.e - E, f.n - N);
  const b = PF.fromBng(E, N), a = PF.placeKey(lat, lon), q = PF.toLocal(a, lat, lon, 0), r = PF.toLocal(a, b.lat, b.lon, 0);
  const dI = Math.hypot(q.x - r.x, q.y - r.y); // inverse error in ground metres, measured in the one local frame
  const back = PF.fromLocal(a, q.x, q.y, 0), rt = PF.toLocal(a, back.lat, back.lon, 0), dRT = Math.hypot(rt.x - q.x, rt.y - q.y);
  worstF = Math.max(worstF, dF); worstI = Math.max(worstI, dI); worstRT = Math.max(worstRT, dRT); worstH = Math.max(worstH, f.helmert ? Math.hypot(f.helmert.e - E, f.helmert.n - N) : 0);
  check(`${id} ETRS89 -> National Grid within 0.1 m by OSTN15`, ok && f.engine === 'OSTN15' && dF <= 0.1, `${f.engine} ${dF.toFixed(4)} m (Helmert would be ${f.helmert ? Math.hypot(f.helmert.e - E, f.helmert.n - N).toFixed(2) : '?'} m)`);
  check(`${id} National Grid -> ETRS89 within 0.1 m by OSTN15`, b.engine === 'OSTN15' && dI <= 0.1, `${b.engine} ${dI.toFixed(4)} m`);
  check(`${id} toLocal/fromLocal round trip within 1 mm`, dRT <= 0.001, `${(dRT * 1000).toFixed(6)} mm at ${a.key}`);
}
console.log(`worst: forward ${worstF.toFixed(4)} m, inverse ${worstI.toFixed(4)} m, local round trip ${(worstRT * 1000).toFixed(6)} mm; Helmert alone worst ${worstH.toFixed(2)} m`);
console.log(`references: ${TP.length} OS test points (external truth); the lane target is 20, so ${20 - TP.length} are still missing`);
const fail = results.filter(r => !r.ok).length;
console.log(`${results.length - fail}/${results.length} PASS`);
process.exit(fail ? 1 : 0);
