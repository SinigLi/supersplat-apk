/* v53r probe：停靠方向跟随 dock 原生（顶=横排、底=横排居中、左右=窄竖排） */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');

check('吸顶=横排（flex-direction:row + 横滑防溢出）', img.includes('.img-tagbar.img-tagbar-top,.img-tagbar.img-dock-top{top:calc(env(safe-area-inset-top, 0px) + 8px);right:12px') && img.includes('flex-direction:row;width:auto;max-width:calc(100vw - 160px)'));
check('窄列只给左右吸附', img.includes('.img-tagbar.img-dock-left,.img-tagbar.img-dock-right{min-width:56px;max-width:72px;gap:6px}'));
check('吸底=横排居中', img.includes('.img-tagbar.img-dock-bottom{left:50%;right:auto;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom, 0px) + 10px);top:auto;max-height:none;flex-direction:row;max-width:calc(100vw - 24px);overflow-x:auto;overflow-y:hidden}'));
check('无强制竖排残留', !img.includes('flex-direction:column;width:auto;min-width:64px'));
check('内联坐标清理保留（v53q）', /if \(edge !== 'free'\) \{\s*\n\s*tagBarEl\.style\.left = '';/.test(img));
check('grp 尺寸对齐保留（v53p）', img.includes('.img-tagbar .img-grp{padding:4px 5px;align-items:center;min-width:0}'));

console.log('========================');
console.log('probe-v53r: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
