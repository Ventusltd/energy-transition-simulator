// Privacy scan for the PUBLIC repo. Fails (exit 1) when any tracked text file carries:
//   (a) a local drive path (a drive letter, then Users, swarm, gw or private: the operator's machine, never the public site);
//   (b) an e-mail address;
//   (c) a token whose sha256 is listed in tests/privacy-hashes.json (private place and project names; only hashes are
//       committed, so the list itself says nothing). Tokens are lowercased runs of 6+ letters, and runs of 2 to 6 such
//       words joined by one space (whole names). The report prints file:line and the first 12 hex of the hash, never
//       the token, so the CI log stays clean too.
// Usage: node tests/privacy-scan.cjs   (from anywhere inside the repo; scans `git ls-files`)
const { execSync } = require('child_process'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const HASHES = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, 'privacy-hashes.json'), 'utf8')).hashes);
const DRIVE = /[A-Z]:[\\/](Users|swarm|gw|private)\b/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.html', '.css', '.md', '.txt', '.yml', '.yaml', '.py', '.csv', '.svg', '.geojson', '.sh', '.ps1', '.toml', '.cfg', '.ini', '']);
const SKIP = new Set(['tests/privacy-hashes.json', 'package-lock.json']);
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const files = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean)
  .filter(f => !SKIP.has(f) && TEXT_EXT.has(path.extname(f).toLowerCase()) && !f.startsWith('node_modules/'));
const findings = [];
for (const f of files) {
  const abs = path.join(ROOT, f); if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) continue;
  const buf = fs.readFileSync(abs); if (buf.includes(0)) continue; // binary
  const lines = buf.toString('utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const at = `${f}:${i + 1}`;
    for (const m of line.matchAll(DRIVE)) findings.push(`${at} drive path ${m[0]}`);
    for (const m of line.matchAll(EMAIL)) findings.push(`${at} e-mail address (${m[0].length} chars)`);
    if (HASHES.size) {
      const words = (line.toLowerCase().match(/[a-z]+/g) || []);
      for (let a = 0; a < words.length; a++) {
        if (words[a].length >= 6) { const h = sha(words[a]); if (HASHES.has(h)) findings.push(`${at} private word ${h.slice(0, 12)}`); }
        for (let n = 2; n <= 6 && a + n <= words.length; n++) {
          const h = sha(words.slice(a, a + n).join(' ')); if (HASHES.has(h)) findings.push(`${at} private name ${h.slice(0, 12)}`);
        }
      }
    }
  });
}
console.log(`privacy scan: ${files.length} files, ${HASHES.size} hashes, ${findings.length} finding(s)`);
for (const x of findings) console.log('  FAIL ' + x);
process.exit(findings.length ? 1 : 0);
