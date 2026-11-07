/* v49 门禁（正式版，随仓库走）：图片模式结构断言 + 模式契约双向校验
 *
 * 原断言 /type *= *['"]file['"][^>]*accept/ 的意图是「创建 file input 时
 * 不设置 accept 属性」。但 img-ui.js 的正确写法分了两行：
 *     var inp = document.createElement('input');
 *     inp.type = 'file';
 *     // 注释解释为什么不设 accept
 *     inp.onchange = ...
 * `[^>]*` 会在「type 行到 accept 注释行」之间跨行匹配（JS 正则 . 与
 * 字符类都不吃 \n，但这里 accept 出现在注释文本里，[^>]* 中 \n 不匹配，
 * 真正命中的是「accept 出现在 type 同一个 > 之前」—— 而注释行里
 * 「accept」三连字恰好落进了同一个未闭合的 <…> 扫描窗口，属于
 * 断言语义写错，不是包里有 accept。
 *
 * 结构性检查更可靠：确认 input.type 赋值行与 accept 赋值行互斥。 */
const { spawnSync } = require('child_process');
const ROOT = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk';
const ARG = process.argv[2] || 'dist/supersplat-v49-debug.apk';
const APK = ARG.indexOf(':') > 0 ? ARG : ROOT + '/' + ARG.replace(/^\.\//, '');

const list = spawnSync('tar', ['-tf', APK], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const entries = String(list.stdout).split(/\r?\n/);
const readEntry = (suffix) => {
    const p = entries.find(e => e.endsWith(suffix));
    if (!p) throw new Error('entry missing: ' + suffix);
    const r = spawnSync('tar', ['-xOf', APK, p], { cwd: ROOT, encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 });
    return Buffer.concat([r.stdout]).toString('utf8');
};

let bad = 0;
const ck = (n, ok, x) => {
    console.log((ok ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : ''));
    if (!ok) bad++;
};

console.log('--- v49 图片模式 ---');
const imgStore = readEntry('assets/public/img-store.js');
const imgUi = readEntry('assets/public/img-ui.js');
const indexHtml = readEntry('assets/public/index.html');
ck('img-store.js 在包里', imgStore.length > 1000, imgStore.length);
ck('img-ui.js 在包里', imgUi.length > 1000, imgUi.length);
ck('index.html 引用 img-store', indexHtml.includes('img-store.js'));
ck('index.html 引用 img-ui', indexHtml.includes('img-ui.js'));
ck('schema 版本标记', imgStore.includes('moyutai.imgmask.v1'));
/* 模式契约：loadMeta 只认 mode==='image'，saveMeta 写入侧也拒收别的模式。
 * （原断言查 upsertProject 里的 mode !== 'image'，但那个函数已删除——
 *   注册表归 projects.js 管，img-store 只负责自己的 meta/strokes。
 *   断言跟着实现改，但校验本身不能丢。） */
ck('模式校验严格(读)', imgStore.includes("m.mode === 'image'"));
ck('模式校验严格(写)', imgStore.includes("meta.mode !== 'image'"));
ck('四选一入口', readEntry('assets/public/projects-ui.js').includes("'image'"));
ck('图片角标', readEntry('assets/public/projects-ui.js').includes('图片'));
ck('路由 image 分支', readEntry('assets/public/projects-ui.js').includes("mm.mode === 'image'"));
ck('渲染器 drawMaskInto', imgUi.includes('function drawMaskInto'));
ck('erase 走 destination-out', imgUi.includes('destination-out'));
ck('导出走 SaveImage.share', imgUi.includes('savePlug'));
ck('反选机制', imgUi.includes('S.invert'));

/* accept 约束的正确打开方式：
 * 1) 有 .type = 'file' 的赋值（说明走 file input）
 * 2) 没有任何 .accept = 赋值语句
 * 3) 魔数校验存在（accept 缺位的补偿措施） */
ck('file input 存在', /type\s*=\s*['"]file['"]/.test(imgUi));
ck('没有 accept 赋值', !/\.accept\s*=/.test(imgUi));
ck('魔数校验兜底', imgStore.includes('sniffImageType'));

/* v49c 回归：返回按钮必须清内联 display。
 * open() 把 display:flex 内联写死，back() 若只 remove('open') 类，
 * 内联样式仍然生效 → 图片页盖住列表，真机表现为「点返回没反应」。 */
ck('v49c back() 清内联 display', /page\.style\.display\s*=\s*'none'/.test(imgUi));
ck('v49c open() 失败兜底也清', (imgUi.match(/page\.style\.display\s*=\s*'none'/g) || []).length >= 2);
/* applySafeArea 的延迟重读要自己复查插件存在性，否则卸载后定时器抛 TypeError */
ck('v49c 安全区重读自检插件', /var read = function \(\) \{[\s\S]{0,400}?if \(!\s*p\s*\|\|\s*!\s*p\.getSafeArea\s*\)\s*return/.test(imgUi));

/* ---- v50：分层遮罩 + 可复用编辑器 ---- */
ck('index.html 引用 img-ops', indexHtml.includes('img-ops.js'));
ck('v2 schema 标记', imgStore.includes('moyutai.imgmask.v2'));
ck('v1 迁移入口', imgStore.includes('moyutai.imgmask.v1') && imgUi.includes('migrateV1'));
const imgOps = readEntry('assets/public/img-ops.js');
ck('img-ops 在包里', imgOps.length > 1000, imgOps.length);
ck('ops 六种齐全', ['stroke', 'addLayer', 'delLayer', 'renameLayer', 'toggleVisible', 'clearLayer'].every(k => imgOps.includes("'" + k + "'")));
ck('ops 逆操作求逆', imgOps.includes('function invertOp'));
ck('最后一层不许删', imgOps.includes('state.layers.length === 1') || imgOps.includes('layers.length === 1'));
ck('层列表面板', imgUi.includes('img-layers'));
ck('层显隐眼睛', imgUi.includes('img-layer-eye'));
ck('换图入口', imgUi.includes('换图'));
ck('换图确认弹窗', imgUi.includes('hadStrokes') && imgUi.includes('confirm('));
ck('分享双模式弹窗', imgUi.includes('showShareDialog'));
ck('分层 zip 导出', imgUi.includes('exportLayersZip') && imgUi.includes('zipSync'));
ck('zip base64 分块（apply 上限修复）', imgUi.includes('subarray(bi, bi + CH)') || /subarray\(/.test(imgUi));
ck('拖拽吸附监听已接线', imgUi.includes('setupDockDrag();'));
ck('吸附持久化', imgUi.includes('img-dock-pos'));
ck('左侧撤销条', imgUi.includes('img-undo-bar'));
ck('dock 纵向滚动', imgUi.includes('max-height:calc(100vh') && imgUi.includes('overflow-y:auto'));

console.log('\n--- 不许回退：AV/导演台/导航 ---');
const dock = readEntry('assets/public/dock.js');
const av = readEntry('assets/public/av-ui.js');
const js = readEntry('assets/public/index.js');
ck('导演台 setNavMode', js.includes('setNavMode'));
ck('游戏模式 exp 缩放', js.includes('Math.exp') && js.includes('gameZoomRate'));
ck('safeCapture 修复', /try\{[^}]*setPointerCapture[^}]*\}catch\(/.test(js));
ck('v48c 缩略图 thumbPaint', av.includes('function thumbPaint'));
ck('v48c seekRelease', av.includes('function seekRelease'));
ck('dock 分组样式源', dock.includes('sd-grp-btn'));

console.log('\n--- 不许回退：v47 lseek ---');
const dexPaths = entries.filter(e => /classes\d*\.dex$/.test(e));
const want = { 'lseek': false, 'Landroid/system/Os;': false, 'MediaServerPlugin': false, 'SaveImagePlugin': false };
for (const dp of dexPaths) {
    const r = spawnSync('tar', ['-xOf', APK, dp], { cwd: ROOT, encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 });
    const buf = Buffer.concat([r.stdout, r.stderr]);
    for (const k of Object.keys(want)) if (buf.includes(Buffer.from(k, 'utf8'))) want[k] = true;
}
for (const k of Object.keys(want)) ck('dex has ' + k, want[k]);

console.log(bad === 0 ? '\n=== v50 GATE ALL PASS ===' : '\n=== v50 GATE FAIL(' + bad + ') ===');
process.exit(bad === 0 ? 0 : 1);
