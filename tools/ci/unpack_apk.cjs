/* unpack_apk.cjs <zip> <out.apk> — CI 产物是 zip 包装的 apk，取出真 apk
 *
 * 用法（仓库根）：
 *   node tools/ci/unpack_apk.cjs dist/app-debug.apk dist/supersplat-v23-debug.apk
 *
 * 之前这个脚本是个临时文件，输出文件名硬编码成 v13，每版都要手动改名，
 * 已经因此丢过一次 v18 的包。现在输出路径由参数决定。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const zip = path.resolve(process.argv[2] || 'dist/app-debug.apk');
const out = path.resolve(process.argv[3] || 'dist/supersplat-debug.apk');
const tmp = path.join(path.dirname(zip), '_unzip');

if (!fs.existsSync(zip)) {
    console.error('MISS ' + zip);
    process.exit(1);
}

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
execFileSync('tar', ['-xf', zip, '-C', tmp], { stdio: 'inherit' });

// CI artifact 里套一层 app-debug.apk；本地直接给的 apk 没有这一层
const inner = path.join(tmp, 'app-debug.apk');
const src = fs.existsSync(inner) ? inner : zip;

const buf = fs.readFileSync(src);
if (buf.slice(0, 2).toString('ascii') !== 'PK') {
    console.error('not an apk/zip: magic=' + buf.slice(0, 2).toString('ascii'));
    process.exit(1);
}

if (src !== zip) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(src, out);
    fs.rmSync(zip, { force: true });
    console.log('inner size', buf.length, '-> ' + out);
} else {
    console.log('already a bare apk, left in place: ' + zip);
}

fs.rmSync(tmp, { recursive: true, force: true });

// 列出 web 资源，确认覆盖层真的打进去了
const entries = execFileSync('tar', ['-tf', fs.existsSync(out) ? out : zip], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
}).split(/\r?\n/).filter(Boolean);

console.log('entries', entries.length);
const web = ['dock.js', 'dock.css', 'index.js', 'index.html'];
for (const w of web) {
    const hit = entries.some(e => e.endsWith('assets/public/' + w));
    console.log((hit ? 'FOUND ' : 'MISS  ') + w);
}
