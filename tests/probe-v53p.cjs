/* v53p probe：图标尺寸对齐右侧 dock */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');

check('tagbar grp 尺寸对齐 dock（padding 4x5 居中）', img.includes('.img-tagbar .img-grp{padding:4px 5px;align-items:center;min-width:0}'));
check('栏宽收窄 56-72px', img.includes('min-width:56px;max-width:72px;gap:6px'));
check('无 stretch 拉宽', !img.includes('align-items:stretch'));
check('下拉再收窄 64px', img.includes('.img-grp-tag select{max-width:64px'));
check('ico 同 dock 15px', img.includes('.img-tagbar .img-grp .ico{font-size:15px;line-height:1}'));
/* 回归 */
check('贴顶停靠覆盖保留（v53o）', img.includes('.img-tagbar.img-tagbar-top,.img-tagbar.img-dock-top{'));
check('短标签保留', img.includes(`'启用')`) && img.includes(`'停用')`));
check('层列表贴栏保留', img.includes(`layersPanel.style.right = (window.innerWidth - r.left + 8) + 'px';`));

console.log('========================');
console.log('probe-v53p: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
