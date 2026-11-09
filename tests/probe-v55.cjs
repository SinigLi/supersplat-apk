/* v55 probe：22:26 两条（下拉默认第一个遮罩层角色 + 全停确认清草稿） */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');
const seg = img.slice(img.indexOf('function openTagMode'), img.indexOf('function openTagMode') + 3800);

check('activeId 无条件对齐第一遮罩层（v55b）', img.includes('if (S.state.layers.length) S.state.activeId = S.state.layers[0].id;'));
check('下拉默认选第一个遮罩层角色（v55b）', img.includes('var actLay = S.state.layers[0] || null;'));
check('actLayOf 辅助存在', img.includes('function actLayOf(state, id)'));
const ft = img.slice(img.indexOf('function finishTag'), img.indexOf('function buildTagBar'));
check('全停确认清草稿（双 key）', ft.includes(`if (ok && entries && entries.length === 0)`) && ft.includes(`localStorage.removeItem(tagMaskKey())`) && ft.includes(`'-tagmask-' + tm.seg + '_' + tm.frame`));
check('清理日志', ft.includes(`cleared drafts (all chars disabled)`));
/* 回归 */
check('即画即存保留（v54）', img.includes(`if (S.tagMode) saveTagStrokes();`));
check('确认兜底落盘保留（v54）', img.includes(`if (ok && S.state) saveTagStrokes();`));
check('骨架日志保留（v53y/z）', img.includes(`dlog('tag: save key=`) && img.includes(`dlog('tag: redraw layers=`));
check('重绘修复保留（v53x）', img.includes('v53x：草稿恢复后重绘遮罩画布'));

console.log('========================');
console.log('probe-v55: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
