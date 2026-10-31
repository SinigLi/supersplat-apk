// verify_v14.cjs — v14 APK 校验：魔数/eocd、web 资源标记、GLB 体积
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const apk = path.resolve(process.argv[2] || 'dist/supersplat-v14-debug.apk');
const size = fs.statSync(apk).size;
const buf = fs.readFileSync(apk);
console.log('APK', apk);
console.log('size', size, 'bytes');
console.log('magic', buf.slice(0, 2).toString('ascii'));
console.log('eocd', buf.slice(size - 22, size - 18).toString('hex'));

const tmp = path.join(os.tmpdir(), 'apk_v14_' + Date.now());
fs.mkdirSync(tmp, { recursive: true });
execFileSync('tar', ['-xf', apk, '-C', tmp], { stdio: 'inherit' });
console.log('extracted OK');

const marks = [
  ['dock.js', "data-act=\"import\""],
  ['dock.js', 'pickAssets()'],
  ['dock.js', 'SPLAT_EXT'],
  ['dock.js', '资产列表'],
  ['dock.js', 'sd-tool-yield'],
  ['index.js', 'importModel'],
  ['index.js', 'listProps'],
  ['index.js', 'measure.debug'],
  ['index.js', 'director-char-'],
];
let bad = 0;
for (const [f, m] of marks) {
  const t = fs.readFileSync(path.join(tmp, 'assets', 'public', f), 'utf8');
  const ok = t.includes(m);
  if (!ok) bad++;
  console.log(f.padEnd(10), JSON.stringify(m).padEnd(26), ok ? 'FOUND' : 'MISSING');
}

const dock = fs.readFileSync(path.join(tmp, 'assets', 'public', 'dock.js'), 'utf8');
const checks = [
  ['single import entry (no prop/addscene)', !dock.includes("data-act=\"prop\"") && !dock.includes("data-act=\"addscene\"")],
  ['sheet renamed', !dock.includes('场景管理')],
];
for (const [name, ok] of checks) {
  if (!ok) bad++;
  console.log(name.padEnd(40), ok ? 'OK' : 'PROBLEM');
}

for (const g of ['woman.glb', 'male.glb', 'shiba.glb', 'tuxedo.glb', 'box.glb']) {
  const p = path.join(tmp, 'assets', 'public', 'static', 'director', g);
  console.log(g.padEnd(12), fs.statSync(p).size, 'bytes');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad === 0 ? '\nALL MARKS OK' : `\n${bad} PROBLEM(S)`);
process.exitCode = bad === 0 ? 0 : 2;
