/* verify_apk.cjs - validate downloaded v12 APK integrity + marker strings */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const apk = path.resolve(process.argv[2] || 'dist_v12/app-debug.apk');
const size = fs.statSync(apk).size;
console.log('APK', apk, size, 'bytes');

const buf = fs.readFileSync(apk);
console.log('magic', buf.slice(0, 2).toString('ascii'), 'eocd', buf.slice(size - 22, size - 18).toString('hex'));

// full extraction test via tar (bsdtar handles zip) into temp
const tmp = path.join(require('os').tmpdir(), 'apk_verify_' + Date.now());
fs.mkdirSync(tmp, { recursive: true });
execFileSync('tar', ['-xf', apk, '-C', tmp], { stdio: 'inherit' });
console.log('extracted OK to', tmp);

const marks = [
  ['dock.js', 'sd-dir-chars'],
  ['dock.js', 'sd-dir-tints'],
  ['dock.js', 'sd-dir-clips'],
  ['dock.js', 'place-puppet'],
  ['index.js', 'director-char-'],
  ['index.js', 'TuxedoCat'],
];
for (const [f, m] of marks) {
  const p = path.join(tmp, 'assets', 'public', f);
  const t = fs.readFileSync(p, 'utf8');
  console.log(f, JSON.stringify(m), t.includes(m) ? 'FOUND' : 'MISSING');
}
const glbs = ['character.glb', 'male.glb', 'shiba.glb', 'tuxedo.glb'];
for (const g of glbs) {
  const p = path.join(tmp, 'assets', 'public', 'static', 'director', g);
  console.log(g, fs.statSync(p).size, 'bytes');
}
fs.rmSync(tmp, { recursive: true, force: true });
