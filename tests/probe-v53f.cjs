/* v53f probe：日志 moyutai-debug_14 的新崩溃回归断言 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');
const ops = fs.readFileSync(WS + 'www/img-ops.js', 'utf8');

check('switchTagLayer 不再调用 OPS.newId（根因）', !img.includes('OPS.newId ? OPS.newId() :'));
check('建层 id 用时间戳（唯一即可）', img.includes(`lay = { id: 'L' + Date.now().toString(36)`));
check('S.state 空防御', img.includes(`if (!S.state) { dlog('switchTagLayer: no state, skip'); return; }`));
check('v53e 拖拽底条未破坏', img.includes('makeDraggable(tagBarEl,'));
check('v53e 描述面板未破坏', img.includes('toggleDescPanel'));
check('img-ops 纯函数未动', ops.includes('function newId(state)'));

console.log('========================');
console.log('probe-v53f: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
