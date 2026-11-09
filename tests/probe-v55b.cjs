/* v55b probe：22:47 复现两条（同步对齐第一层 + 空打标移除 char_ref） */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');
const av = fs.readFileSync(WS + 'www/av-ui.js', 'utf8');
const seg = img.slice(img.indexOf('function openTagMode'), img.indexOf('function openTagMode') + 3800);

/* ① 恢复无条件对齐第一遮罩层（activeId + 下拉同步） */
check('activeId 无条件回退第一遮罩层', seg.includes('if (S.state.layers.length) S.state.activeId = S.state.layers[0].id;'));
check('下拉同步第一遮罩层角色', seg.includes(`var actLay = S.state.layers[0] || null;`) && seg.includes(`if (actCard && tagSelEl) tagSelEl.value = actCard.id;`));
/* ② 空打标移除 char_ref（角标消失） */
check('全停确认移除 char_ref（非空数组 upsert）', av.includes(`if (!entries.length) {`) && av.includes(`L.removeCharRef(S.marks, rid);`));
check('有角色时仍 upsert', /} else \{\s*\n\s*L\.upsertCharRef\(S\.marks, tgt\.seg, tgt\.at, entries\);/.test(av));
check('移除后刷新列表', /L\.removeCharRef\(S\.marks, rid\);[\s\S]*?renderTicks\(\); renderList\(\); renderPos\(\);/.test(av));
/* 回归 */
check('即画即存保留（v54）', img.includes(`if (S.tagMode) saveTagStrokes();`));
check('清草稿保留（v55）', img.includes(`cleared drafts (all chars disabled)`));
check('骨架日志保留（v53y/z）', img.includes(`dlog('tag: redraw layers=`));
check('落笔 guard 保留（v53k）', img.includes(`enabledIds.indexOf(actCard.id) < 0`));

console.log('========================');
console.log('probe-v55b: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
