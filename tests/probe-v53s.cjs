/* v53s probe：18:25 四条（复用 placePanel / free 残留 / 面板旁展开 / 图片模式不污染） */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');

/* A. 层列表面板复用 placePanel（按钮旁展开，不再乱飞） */
check('启用打开面板用 placePanel', img.includes(`placePanel(layersPanel, g1);`) && !img.includes(`layersPanel.style.right = (window.innerWidth - r.left + 8) + 'px';`));
check('停用打开面板用 placePanel', img.includes(`placePanel(layersPanel, g2);`));
check('手写 RAF 定位已清除', !img.includes('v53n：层列表面板贴 tagbar 左侧弹出'));
/* B. free 残留忽略 */
check('持久化 free 坐标被忽略（防画面中间）', img.includes(`if (pos && pos !== 'free') { S.tagPos = pos; applyTagPos(pos); }`));
/* C. 退出打标清理内联 */
check('finishTag 清层面板内联定位', img.includes(`layersPanel.style.left = ''; layersPanel.style.top = '';`));
/* 回归 */
check('停靠方向保留（v53r 顶=横排）', img.includes('flex-direction:row;width:auto;max-width:calc(100vw - 160px)'));
check('吸附清内联保留（v53q）', img.includes(`tagBarEl.style.left = '';`) && img.includes(`tagBarEl.style.top = '';`));
check('落笔 guard 保留', img.includes(`enabledIds.indexOf(actCard.id) < 0`));
check('草稿 fallback 保留', img.includes('tagmask migrated'));
check('描述面板保留', img.includes('toggleDescPanel'));

console.log('========================');
console.log('probe-v53s: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
