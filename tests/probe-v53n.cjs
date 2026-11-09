/* v53n probe：08:46 截图布局优化 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');

/* ① 竖排紧凑 */
check('tagbar 竖排覆盖（横屏不再横排溢出）', img.includes('flex-direction:column;width:auto;min-width:64px;max-width:96px'));
check('grp 紧凑（小字号内边距）', img.includes('.img-tagbar .img-grp{padding:5px 6px}') && img.includes('.img-tagbar .img-grp .ico{font-size:15px}'));
check('角色下拉收窄', img.includes('.img-grp-tag select{max-width:86px'));
/* ② 文字缩短 */
check('短标签（确认/启用/隐藏/停用）', img.includes(`'确认')`) && img.includes(`'启用')`) && img.includes(`'隐藏')`) && img.includes(`'停用')`));
check('无旧长标签', !img.includes(`'确认打标')`) && !img.includes(`el('span', null, '启用打标')`) && !img.includes(`el('span', null, '取消打标')`));
check('toast 同步新措辞', img.includes(`先点右上「启用」再画`) && img.includes(`已停用「`));
/* ③ 层列表贴 tagbar 弹出 */
check('启用后层列表贴 tagbar 左侧', img.includes(`layersPanel.style.right = (window.innerWidth - r.left + 8) + 'px';`) && img.includes(`layersPanel.style.top = Math.max(8, r.top) + 'px';`));
/* 回归 */
check('🙈 隐藏按钮保留', img.includes(`'隐藏')`) && img.includes('toggleVisible'));
check('落笔 guard 保留', img.includes(`enabledIds.indexOf(actCard.id) < 0`));
check('层只读保留', img.includes(`打标模式下换层用右上「启用」`));
check('safe-area 贴顶保留', img.includes('env(safe-area-inset-top, 0px) + 8px'));

console.log('========================');
console.log('probe-v53n: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
