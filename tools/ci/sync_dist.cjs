/* sync_dist.cjs — 把 supersplat-main/dist 同步到 supersplat-apk/www
 *
 * 覆盖层受保护，绝不能被 dist 覆盖：
 *   www/dock.js  www/dock.css  www/mobile.css  www/mobile.js  www/index.html
 *
 * dist 里没有这些文件，所以只要不整目录 mirror 就安全。
 */
const fs = require('fs');
const path = require('path');

const SRC = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-main/dist';
const DST = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www';

const PROTECTED = new Set([
    'dock.js', 'dock.css', 'mobile.css', 'mobile.js', 'index.html',
    // v28 工程管理层：同样只存在于覆盖层，dist 里没有
    'projects.js', 'projects-ui.js', 'projects.css', 'fflate.js'
]);

const copyRec = (src, dst) => {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, e.name);
        const d = path.join(dst, e.name);
        if (e.isDirectory()) copyRec(s, d);
        else fs.copyFileSync(s, d);
    }
};

const log = [];
for (const e of fs.readdirSync(SRC, { withFileTypes: true })) {
    const s = path.join(SRC, e.name);
    const d = path.join(DST, e.name);

    if (e.name.endsWith('.map')) continue;           // source maps 不进 APK

    if (e.isDirectory()) {
        copyRec(s, d);
        log.push('dir  ' + e.name + '/');
        continue;
    }
    if (PROTECTED.has(e.name)) {
        log.push('SKIP ' + e.name + ' (overlay)');
        continue;
    }
    fs.copyFileSync(s, d);
    log.push('file ' + e.name + ' (' + fs.statSync(s).size + ' B)');
}

console.log(log.join('\n'));

// 覆盖层完整性自检
console.log('\n--- overlay check ---');
for (const f of PROTECTED) {
    const p = path.join(DST, f);
    const ok = fs.existsSync(p);
    console.log((ok ? 'OK   ' : 'MISS ') + f + (ok ? ' ' + fs.statSync(p).size + ' B' : ''));
}

// 引擎新符号是否真的进了产物
const js = fs.readFileSync(path.join(DST, 'index.js'), 'utf8');
const marks = ['gizmo.drag', 'setPropLocked', 'setPuppetLocked', 'sd-pup-locked'];
console.log('\n--- engine marks in index.js ---');
for (const m of marks) {
    console.log((js.includes(m) ? 'FOUND ' : 'MISS  ') + m);
}
// dock 的锁按钮标记在 dock.js，不在引擎产物里
const dock = fs.readFileSync(path.join(DST, 'dock.js'), 'utf8');
console.log('\n--- dock.js marks ---');
for (const m of ['setPuppetLocked', 'setPropLocked', 'sd-pup-lock']) {
    console.log((dock.includes(m) ? 'FOUND ' : 'MISS  ') + m);
}
