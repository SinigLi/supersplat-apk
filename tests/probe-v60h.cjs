/* probe-v60h：绘制守卫只认激活层（旧「启用」逻辑彻底下线）+ 单图片模式不受影响 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n); } };

const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');

check('绘制守卫不再引用旧 enabled 列表', !/tm\.enabled|S\.tagMode\.enabled/.test(img));
check('enabled 死代码（enableChar/tm_enabledHas）已移除', !img.includes('function enableChar') && !img.includes('function tm_enabledHas'));
check('守卫只判激活层存在', img.includes('if (!act) {') && !img.includes('enabledIds.indexOf'));
check('无层提示改为引导建层', img.includes('img.includes') || /\\u5148\\u70b9|先点/.test(img));
check('单图片模式绘制路径未被 tagMode 守卫包裹', img.includes('if (S.tagMode) {') && img.includes("var kind = S.tool === 'erase'"));
check('普通模式图层仍至少保留一层', fs.readFileSync(WS + 'www/img-ops.js', 'utf8').includes('if (state.layers.length === 1 && !op.allowEmpty) return false;'));

console.log('probe-v60h: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
process.exit(fail ? 1 : 0);
