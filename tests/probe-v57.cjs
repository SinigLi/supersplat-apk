/* v57 probe：已落盘 mask 在草稿层存在时重新栅格化（新极性），导出带 zip */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const av = fs.readFileSync(WS + 'www/av-ui.js', 'utf8');
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');

check('need 过滤含已落盘 masks/ 路径', av.includes("m.indexOf('masks/') === 0"));
check('已落盘 mask 按名字反查（v58 口径）', av.includes('function cardIdOfName') && av.includes('loadTagMaskLayersAnyName'));
check('pending 口径保留', av.includes("m.indexOf('pending:') === 0"));
check('栅格化走 v56b 黑底抠洞', img.includes('drawStrokes(og, lay.strokes)') && img.includes("g.drawImage(off, 0, 0)"));
check('无草稿层时 loadTagMaskLayers 返回 null 防呆', /function loadTagMaskLayers[\s\S]{0,400}catch/.test(av));
check('内容寻址备份保留', av.includes('putContentFile'));
check('zip 分支由 count>0 触发', av.includes('resolved.count > 0'));

/* 回归锚 */
check('空 entries 移除 char_ref（v55b）', av.includes('L.removeCharRef(S.marks, rid);'));
check('骨架日志保留（img 侧 v53y/z）', img.includes(`dlog('tag: redraw layers=`));
check('即画即存保留（v54）', img.includes(`if (S.tagMode) saveTagStrokes();`));

console.log('========================');
console.log('probe-v57: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
