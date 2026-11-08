/* v53e probe：老板 18:22 六条的回归断言
 * 1. 底条用 img-dock 结构 + img-handle + makeDraggable（移动悬浮）
 * 2. 撤销/重做按钮不在底条（左侧 undoBar 常驻不重复）
 * 3. 描述默认收藏：「描述」grp 按钮 → 弹出面板（select 默认列表 + input 自由输入）
 * 4. 启用打标读下拉值（不再误报先选角色）
 * 5. 角色下拉 + 启用/取消/描述 同一工具栏
 * 6. 位置持久化 TAG_POS_KEY
 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');

check('底条复用 img-dock class', img.includes(`el('div', 'img-dock img-tagbar')`));
check('拖拽手柄 img-handle', img.includes(`tagBarEl.appendChild(el('div', 'img-handle', '钜'))`) || img.includes(`tagBarEl.appendChild(el('div', 'img-handle'`));
check('复用 makeDraggable（移动悬浮）', img.includes('makeDraggable(tagBarEl,'));
check('位置持久化', img.includes("TAG_POS_KEY = 'moyutai.tagbarPos'") && img.includes("localStorage.setItem(TAG_POS_KEY"));
check('吸边 class', img.includes(`tagBarEl.classList.add('img-dock-' + edge)`));
check('底条无撤销/重做按钮（不重复）', !(img.includes(`g3.addEventListener('click', undo)`) && img.includes(`g4.addEventListener('click', redo)`)));
check('角色下拉在同一工具栏', (() => { const b = img.indexOf('function buildTagBar'); const s = img.indexOf("tagSelEl = el('select'"); return s > b && img.indexOf('tagBarEl.appendChild(selGrp);') > b; })());
check('启用打标读下拉值（修复误报）', img.includes(`var c = tagSelEl.value ? tm.cards.cards.filter`));
check('取消打标同栏', img.includes(`g2.appendChild(el('span', null, '取消打标'))`));
check('描述按钮弹出面板', img.includes(`toggleDescPanel(g3, c)`));
check('描述面板收起默认（按钮开关）', img.includes("document.getElementById('imgTagDescPanel')") && img.includes('panel.remove(); return;'));
check('面板 select 默认列表（原角色）', img.includes('tm.cards.orig_char_descs.forEach'));
check('面板 select 默认列表（替换角色）', img.includes('tm.cards.dest_char_descs.forEach'));
check('面板自由输入 input', img.includes(`origIn.placeholder = '或自由输入'`));
check('描述改动即存（saveTagStrokes）', img.includes(`tm.orig[card.id] = origSel.value; saveTagStrokes();`));
check('finishTag 关面板', img.includes(`var dp = document.getElementById('imgTagDescPanel')`));
check('undoBar 恢复链路保留', img.includes(`if (undoBarEl) undoBarEl.style.display = ''; /* v53d：撤销条恢复 */`));
check('CSS：dock 复用+面板样式', img.includes('.img-tagbar{display:none;z-index:55}') && img.includes('.img-tag-desc-panel{'));
check('无残留 row1/row2 旧样式', !img.includes('.img-tagbar-row1'));

console.log('========================');
console.log('probe-v53e: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
