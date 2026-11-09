/* v54 probe：debug_19 实锤「第二笔草稿未落盘」的双保险修复 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');

check('applyAndPush：tagMode 即画即存', img.includes(`if (S.tagMode) saveTagStrokes();`) && img.includes('v54：tagMode 草稿必须即画即存'));
check('finishTag 确认前兜底落盘', img.includes(`if (ok && S.state) saveTagStrokes();`));
check('兜底在 tagEntries 之后、S.tagMode 置空之前', /var entries = ok \? tagEntries\(\) : null;\s*\n\s*var tm = S\.tagMode;\s*\n\s*\/\* v54：确认前兜底落盘[\s\S]{0,60}if \(ok && S\.state\) saveTagStrokes\(\);/.test(img));
/* 回归 */
check('渲染骨架日志保留（v53z）', img.includes(`dlog('tag: redraw layers=`));
check('save/load 骨架日志保留（v53y）', img.includes(`dlog('tag: save key=`) && img.includes(`dlog('tag: load key=`));
check('重绘修复保留（v53x）', img.includes('v53x：草稿恢复后重绘遮罩画布'));
check('路由修复保留（v53t）', !/pjPage\.classList/.test(img.slice(img.indexOf('function finishTag'), img.indexOf('function buildTagBar'))));
check('落笔 guard 保留（v53k）', img.includes(`enabledIds.indexOf(actCard.id) < 0`));

console.log('========================');
console.log('probe-v54: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
