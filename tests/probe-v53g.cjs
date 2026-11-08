/* v53g probe：21:29 两条反馈 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');

/* ① 布局：默认吸底不与右 dock 重叠 */
check('tagbar 默认吸 bottom（不与右 dock 重叠）', img.includes(`S.tagPos = 'bottom'; /* v53g`) && img.includes("else applyTagPos('bottom');"));
check('拖拽悬浮能力保留（把手+makeDraggable）', img.includes(`tagBarEl.appendChild(el('div', 'img-handle'`) && img.includes('makeDraggable(tagBarEl,'));

/* ② 启用打标建层链路（v53f 修复 + v53e 流程） */
check('switchTagLayer 无参 newId 已除根', !img.includes('OPS.newId ? OPS.newId() :'));
check('建层时间戳 id', img.includes(`lay = { id: 'L' + Date.now().toString(36)`));
check('S.state 防御（state 未建时不崩）', img.includes(`if (!S.state) { dlog('switchTagLayer: no state, skip'); return; }`));
check('启用打标读下拉值', img.includes(`var c = tagSelEl.value ? tm.cards.cards.filter`));
check('启用后切层激活（画笔落角色层）', img.includes(`switchTagLayer(c);\n            saveTagStrokes();`));
check('启动画 toast 确认', img.includes(`打标，画区域即遮罩`));

/* 回归抽查 */
check('v53e 描述面板保留', img.includes('toggleDescPanel'));
check('v53c 声明区干净', !img.includes('var tagOrigIn = null'));

console.log('========================');
console.log('probe-v53g: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
