/* v53w probe：debug_16 openTagMode tm 崩溃修复 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');
const seg = img.slice(img.indexOf('function openTagMode'), img.indexOf('function openTagMode') + 3500);

check('openTagMode 草稿同步用 S.tagMode（非 tm）', seg.includes('S.tagMode.cards.cards.filter'));
check('openTagMode 无裸 tm 引用', !/[^.\w]tm\./.test(seg));
check('草稿恢复同步下拉保留', seg.includes(`if (actCard && tagSelEl) tagSelEl.value = actCard.id;`));
check('草稿恢复日志保留', seg.includes(`tagmode draft restored layers=`));
/* 回归 */
check('空白关闭面板保留（v53v）', img.includes(`el2.closest('.img-sub, .img-dock, .img-tagbar, .img-tag-desc-panel, .img-undo-bar, .img-top, .img-handle')`));
check('草稿 fallback 保留（v53j）', img.includes('tagmask migrated'));

console.log('========================');
console.log('probe-v53w: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
