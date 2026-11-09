/* v53o probe：贴顶停靠被 .img-dock-top(row/top76) 干扰的覆盖修复 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');

check('dock-top 命中 tagbar 时强制竖排贴右上', img.includes('.img-tagbar.img-tagbar-top,.img-tagbar.img-dock-top{top:calc(env(safe-area-inset-top, 0px) + 8px);right:8px;bottom:auto;left:auto;transform:none'));
check('清除 row 横排与 top:76px 干扰', img.includes('flex-direction:column') && img.includes('transform:none'));
check('v53n 紧凑规格保留（v53p 收窄）', img.includes('min-width:56px;max-width:72px;gap:6px'));
check('层列表贴栏弹出保留', img.includes(`layersPanel.style.right = (window.innerWidth - r.left + 8) + 'px';`));
check('拖拽四边吸附保留', img.includes(`tagBarEl.classList.add('img-dock-' + edge)`));

console.log('========================');
console.log('probe-v53o: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
