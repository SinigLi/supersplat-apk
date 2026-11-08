/* v53i probe：debug_15 崩溃 + 22:36 澄清语义 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');

/* A. debug_15 崩溃根因清除 */
check('tagOrigIn 引用全清除（debug_15 崩溃）', !img.includes('tagOrigIn'));
check('tagDestIn 引用全清除', !img.includes('tagDestIn'));

/* B1. 启用打标 = 建层/选中 + 打开层列表 */
check('启用打标打开层列表同步', /switchTagLayer\(c\);\s*\n\s*saveTagStrokes\(\);\s*\n\s*renderLayersPanel\(\);\s*\n\s*layersPanel\.classList\.add\('open'\);/.test(img));
/* B2. 取消打标 = 删除角色层（走撤销栈） */
check('取消打标删除层（makeDelLayer）', img.includes('var op = OPS.makeDelLayer(S.state, lay.id);') && img.includes('if (op) applyAndPush(op);'));
check('取消打标打开层列表同步', /renderLayersPanel\(\);\s*\n\s*layersPanel\.classList\.add\('open'\);\s*\n\s*toast\('已取消「' \+ c\.name \+ '」打标，层已删除'\);/.test(img));
/* ④ 描述面板（v53h 定位修复仍在） */
check('描述面板按钮上方定位（v53h）', img.includes('r.left + r.width / 2 - w / 2'));
check('描述面板默认列表下拉仍在', img.includes('tm.cards.orig_char_descs.forEach'));
/* 回归 */
check('handle ⠿', img.includes(`el('div', 'img-handle', '⠿')`));
check('层管理锁定（tagMode 渲染时同步置灰，v53l）', img.includes('b.disabled = !!S.tagMode;') && img.includes('img-sub-btn-off'));
check('切换角色安全 id', img.includes(`lay = { id: 'L' + Date.now().toString(36)`));

console.log('========================');
console.log('probe-v53i: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
