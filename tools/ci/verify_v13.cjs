// verify_v13.cjs — 校验真实 APK：魔数、eocd、web 资源标记、GLB 体积
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const apk = path.resolve(process.argv[2] || 'dist/supersplat-v13-debug.apk');
const size = fs.statSync(apk).size;
const buf = fs.readFileSync(apk);
console.log('APK', apk);
console.log('size', size, 'bytes');
console.log('magic', buf.slice(0, 2).toString('ascii'));
console.log('eocd', buf.slice(size - 22, size - 18).toString('hex'));

const tmp = path.join(os.tmpdir(), 'apk_v13_' + Date.now());
fs.mkdirSync(tmp, { recursive: true });
execFileSync('tar', ['-xf', apk, '-C', tmp], { stdio: 'inherit' });
console.log('extracted OK');

const marks = [
  ['dock.js', "act:'movetocursor'"],
  ['dock.js', 'sd-tool-yield'],
  ['dock.js', 'propInput'],
  ['dock.js', 'sd-pup-title'],
  ['index.js', 'importModel'],
  ['index.js', 'listProps'],
  ['index.js', 'deletePropById'],
  ['index.js', 'director-char-'],
];
let bad = 0;
for (const [f, m] of marks) {
  const p = path.join(tmp, 'assets', 'public', f);
  const t = fs.readFileSync(p, 'utf8');
  const ok = t.includes(m);
  if (!ok) bad++;
  console.log(f.padEnd(10), JSON.stringify(m).padEnd(24), ok ? 'FOUND' : 'MISSING');
}

// 旧「选择」按钮必须已经不在底栏
const dock = fs.readFileSync(path.join(tmp, 'assets', 'public', 'dock.js'), 'utf8');
const noSelect = !dock.includes("act:'select'");
console.log('bottom select removed'.padEnd(25), noSelect ? 'OK' : 'STILL THERE');
if (!noSelect) bad++;

const glbs = ['woman.glb', 'male.glb', 'shiba.glb', 'tuxedo.glb'];
for (const g of glbs) {
  const p = path.join(tmp, 'assets', 'public', 'static', 'director', g);
  console.log(g.padEnd(12), fs.statSync(p).size, 'bytes');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad === 0 ? '\nALL MARKS OK' : `\n${bad} PROBLEM(S)`);
process.exitCode = bad === 0 ? 0 : 2;
