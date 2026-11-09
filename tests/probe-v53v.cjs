/* v53v probe：19:54 两条（空白关闭面板 + 草稿恢复同步下拉） */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');

/* ① 空白点击关闭 */
check('document 捕获点击关面板', img.includes(`document.addEventListener('pointerdown'`) && img.includes('closePanels();'));
check('面板/dock/把手点击不误关', img.includes(`el2.closest('.img-sub, .img-dock, .img-tagbar, .img-tag-desc-panel, .img-undo-bar, .img-top, .img-handle')`));
check('描述面板也随空白关闭', /closePanels\(\);[\s\S]{0,200}imgTagDescPanel/.test(img.slice(img.indexOf("v53v：点击空白处自动关闭悬浮面板"), img.indexOf("v53v：点击空白处自动关闭悬浮面板") + 800)));
/* ② 草稿恢复同步下拉 */
check('草稿恢复后同步角色下拉', img.includes(`if (actCard && tagSelEl) tagSelEl.value = actCard.id;`));
check('草稿恢复日志', img.includes(`tagmode draft restored layers=`));
/* 回归 */
check('越开越窄修复保留（v53u）', img.includes(`layersPanel.style.bottom = 'auto';`));
check('回视频页保留（v53t）', !/pjPage\.classList/.test(img.slice(img.indexOf('function finishTag'), img.indexOf('function buildTagBar'))));
check('落笔 guard 保留', img.includes(`enabledIds.indexOf(actCard.id) < 0`));
check('层只读保留', img.includes('img-sub-btn-off'));

console.log('========================');
console.log('probe-v53v: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
