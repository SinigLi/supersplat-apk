/* v53m probe：08:29 两条（顶栏收进停靠栏 + 隐藏打标按钮） */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');

/* ① 顶栏收进停靠栏 */
check('确认打标按钮在 tagbar 内', img.includes(`gOk.addEventListener('click', function () { finishTag(true); })`));
check('取消按钮在 tagbar 内', img.includes(`gNo.addEventListener('click', function () { finishTag(false); })`));
check('tagMode 下 img-top 整条隐藏', img.includes(`if (topEl) topEl.style.display = 'none'; /* v53m`));
check('finishTag 恢复 img-top', img.includes(`if (topEl) topEl.style.display = ''; /* v53m`));
check('默认右上角停靠', img.includes(`S.tagPos = 'top'; /* v53m`) && img.includes(`else applyTagPos('top');`));
check('贴顶避让状态栏 CSS', img.includes('.img-tagbar.img-tagbar-top{top:calc(env(safe-area-inset-top, 0px) + 8px);right:8px'));
check('拖拽四边吸附保留', img.includes(`tagBarEl.classList.add('img-dock-' + edge)`));
/* ② 隐藏打标 */
check('文案/按钮短标签（v53n）', img.includes("gHide.appendChild(el('span', null, '隐藏'))"));
check('隐藏走 toggleVisible（撤销栈）', img.includes(`applyAndPush({ kind: 'toggleVisible', layerId: act.id });`) && img.includes(`已隐藏「`));
check('隐藏后层列表同步', /applyAndPush\(\{ kind: 'toggleVisible', layerId: act\.id \}\);\s*\n\s*renderLayersPanel\(\);/.test(img));
/* 回归 */
check('文案/按钮短标签（v53n）', img.includes("toast('打标模式下换层用右上「启用」')"));
check('落笔 guard 保留（v53k）', img.includes(`enabledIds.indexOf(actCard.id) < 0`));
check('草稿 fallback 保留', img.includes('tagmask migrated'));
check('描述面板保留', img.includes('toggleDescPanel'));

console.log('========================');
console.log('probe-v53m: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
