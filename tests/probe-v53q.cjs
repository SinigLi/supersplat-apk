/* v53q probe：吸附时清除内联坐标（截图 16:08 栏钉在画面中央的根因） */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');

check('applyTagPos 非 free 清内联 left/top', /if \(edge !== 'free'\) \{\s*\n\s*tagBarEl\.style\.left = '';\s*\n\s*tagBarEl\.style\.top = '';/.test(img));
check('right/bottom 也清', img.includes(`tagBarEl.style.right = '';`) && img.includes(`tagBarEl.style.bottom = '';`));
check('free 分支不受影响（仍可悬浮）', img.includes(`if (S.tagPos === 'free') {`));
/* 回归 */
check('贴顶覆盖保留（v53o）', img.includes('.img-tagbar.img-tagbar-top,.img-tagbar.img-dock-top{'));
check('尺寸对齐保留（v53p）', img.includes('min-width:56px;max-width:72px;gap:6px'));

console.log('========================');
console.log('probe-v53q: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
