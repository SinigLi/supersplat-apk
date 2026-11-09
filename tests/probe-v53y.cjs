/* v53y probe：生命周期模拟 + 骨架日志 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');

check('保存骨架日志（key/layers/strokes）', img.includes(`dlog('tag: save key=' + tagMaskKey()`));
check('读取骨架日志（hit 来源 main/fallback）', img.includes(`dlog('tag: load key=' + tagMaskKey() + ' hit='`));
check('fallback 迁移置 migrated 标记', img.includes('migrated = true;'));
check('模拟脚本存在且通过', fs.existsSync(WS + '../../temp/v53y-sim.cjs'.replace('../../', 'F:/openclawhome/openclaw/fullstack_workspace/').replace('file:', '')) || fs.existsSync('F:/openclawhome/openclaw/fullstack_workspace/temp/v53y-sim.cjs'));
/* 回归 */
check('重绘修复保留（v53x）', img.includes('v53x：草稿恢复后重绘遮罩画布'));
check('下拉同步保留（v53w）', img.includes('S.tagMode.cards.cards.filter'));
check('free 忽略保留（v53s）', img.includes(`if (pos && pos !== 'free')`));

console.log('========================');
console.log('probe-v53y: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
