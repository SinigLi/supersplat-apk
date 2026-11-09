/* v53t probe：18:43 交互路由修复 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');
const ft = img.slice(img.indexOf('function finishTag'), img.indexOf('function buildTagBar'));

check('finishTag 不再打开 pjPage（回视频页）', !/pjPage\.classList|getElementById\('pjPage'\)/.test(ft));
check('finishTag 保留 onDone/onCancel 路由', ft.includes('tm.onDone(entries)') && ft.includes('tm.onCancel()'));
check('finishTag 关闭 img page', ft.includes(`page.classList.remove('open')`) && ft.includes(`page.style.display = 'none'`));
/* 图片工程正常 back() 仍开 pjPage（不受影响） */
const backSeg = img.slice(img.indexOf('function back()'), img.indexOf('function back()') + 900);
check('图片工程 doBack() 仍回工程列表', img.slice(img.indexOf('function doBack()'), img.indexOf('function doBack()') + 900).includes(`pj.classList.add('open')`));
/* 回归 */
check('placePanel 复用（v53s）', img.includes('placePanel(layersPanel, g1);'));
check('free 持久化忽略（v53s）', img.includes(`if (pos && pos !== 'free')`));
check('层只读保留（v53l）', img.includes('img-sub-btn-off'));

console.log('========================');
console.log('probe-v53t: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
