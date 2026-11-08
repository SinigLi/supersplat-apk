/* v53h probe：22:05 五条反馈回归 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');

/* ① 底部居中 */
check('tagbar bottom 水平居中 CSS', img.includes('.img-tagbar.img-dock-bottom{left:50%;right:auto;transform:translateX(-50%)'));
/* ② 启用/取消打开层列表 */
check('启用打标打开层列表', /renderLayersPanel\(\);\s*\n\s*layersPanel\.classList\.add\('open'\);\s*\n\s*toast\('已启用「/.test(img));
check('取消打标打开层列表', /renderLayersPanel\(\);\s*\n\s*layersPanel\.classList\.add\('open'\);\s*\n\s*toast\('已取消「/.test(img));
check('层列表 active 高亮当前层（既有）', img.includes(`lay.id === S.state.activeId ? ' active'`));
/* ③ 打标模式锁层管理 */
check('层管理锁定（tagMode 渲染时同步置灰，v53l）', img.includes('b.disabled = !!S.tagMode;') && img.includes('img-sub-btn-off'));
/* ④ 描述按钮修复 */
check('描述面板按钮上方居中定位', img.includes('panel.offsetHeight - 10') && img.includes('r.left + r.width / 2 - w / 2'));
check('描述面板不再用 placePanel', !img.includes(`placePanel(panel, anchorBtn);`));
/* ⑤ 锯字 */
check('handle 用 ⠿（U+283F，同 dock）', img.includes(`el('div', 'img-handle', '⠿')`) && !img.includes(`el('div', 'img-handle', '钜')`));
/* 回归 */
check('v53g 默认 bottom 保留', img.includes(`S.tagPos = 'bottom'; /* v53g`) || img.includes(`else applyTagPos('bottom');`));
check('switchTagLayer 安全 id 保留', img.includes(`lay = { id: 'L' + Date.now().toString(36)`));
check('CSS 数组语法完好（逗号链）', img.includes(`52vh}",\n  ".img-tagbar.open{display:flex}"`));

console.log('========================');
console.log('probe-v53h: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
