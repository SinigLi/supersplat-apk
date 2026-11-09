/* v55c probe：重开后下拉与层高亮同步（单一事实源=activeId） */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');
const seg = img.slice(img.indexOf('function switchTagLayer'), img.indexOf('function switchTagLayer') + 900);
const fin = img.slice(img.indexOf('/* 默认激活'), img.indexOf('/* 默认激活') + 800);

/* ① switchTagLayer 回写下拉（所有切层路径统一入口） */
check('switchTagLayer 回写下拉值', seg.includes('if (tagSelEl) tagSelEl.value = card.id;'));
/* ② finalize 不再覆盖恢复出的层激活状态 */
check('finalize 仅在无恢复层时选第一个启用角色', fin.includes('if (S.state.layers.length === 0 && S.tagMode.enabled.length)'));
check('finalize 有层时下拉对齐激活层角色', fin.includes('c.name === al.name'));
/* ③ 草稿恢复段仍是无条件第一层对齐（v55b 语义保留） */
const dr = img.slice(img.indexOf('v55b：恢复后无条件对齐第一个遮罩层'), img.indexOf('v55b：恢复后无条件对齐第一个遮罩层') + 500);
check('草稿恢复段保持第一层对齐', dr.includes('if (S.state.layers.length) S.state.activeId = S.state.layers[0].id;') && dr.includes('var actLay = S.state.layers[0] || null;'));
/* 回归锚 */
check('即画即存保留（v54）', img.includes(`if (S.tagMode) saveTagStrokes();`));
check('清草稿保留（v55）', img.includes(`cleared drafts (all chars disabled)`));
check('移除 char_ref 保留（v55b av 侧）', fs.readFileSync(WS + 'www/av-ui.js', 'utf8').includes(`L.removeCharRef(S.marks, rid);`));
check('骨架日志保留（v53y/z）', img.includes(`dlog('tag: redraw layers=`));
check('落笔 guard 保留（v53k）', img.includes(`enabledIds.indexOf(actCard.id) < 0`));

console.log('========================');
console.log('probe-v55c: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
