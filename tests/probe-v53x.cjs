/* v53x probe：草稿恢复后重绘遮罩（20:28「保存再进没效果」） */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');
const seg = img.slice(img.indexOf('function openTagMode'), img.indexOf('function openTagMode') + 3600);

check('草稿恢复后调用 redrawMask（画面显示已画笔画）', seg.includes('v53x：草稿恢复后重绘遮罩画布') && /redrawMask\(\);\s*\n\s*updateUndoState\(\);/.test(seg));
check('日志带 strokes 总数（便于验收）', seg.includes(`strokes=' + S.state.layers.reduce`));
check('下拉同步保留（v53w）', seg.includes('S.tagMode.cards.cards.filter'));
/* 回归 */
check('无 tm 裸引用', !/[^.\w]tm\./.test(seg));
check('空白关闭面板保留', img.includes(`el2.closest('.img-sub, .img-dock, .img-tagbar, .img-tag-desc-panel, .img-undo-bar, .img-top, .img-handle')`));
check('fallback 迁移保留', img.includes('tagmask migrated'));

console.log('========================');
console.log('probe-v53x: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
