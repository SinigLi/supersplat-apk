/* probe-v60f：打标模式可删光遮罩层（0 层确认 = 清除该帧打标）静态契约 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n); } };

const ops = fs.readFileSync(WS + 'www/img-ops.js', 'utf8');
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');
const av = fs.readFileSync(WS + 'www/av-ui.js', 'utf8');

check('makeDelLayer 支持 allowEmpty 选项', ops.includes('function makeDelLayer(state, layerId, opts)') && ops.includes('opts.allowEmpty'));
check('delLayer op 携带 allowEmpty 标记', ops.includes('allowEmpty: !!(opts && opts.allowEmpty)'));
check('apply delLayer 尊重 allowEmpty（普通模式仍禁删最后一层）', ops.includes('if (state.layers.length === 1 && !op.allowEmpty) return false;'));
check('0 层时 activeId=null（不越界）', ops.includes('state.activeId = state.layers.length ? state.layers[Math.min(i, state.layers.length - 1)].id : null;'));
check('打标行删除按钮传 allowEmpty（仅 tagMode）', img.includes('OPS.makeDelLayer(S.state, lay.id, { allowEmpty: !!S.tagMode })'));
check('普通图片模式删除按钮不传 allowEmpty', img.includes('OPS.makeDelLayer(S.state, lay.id);\n') || img.match(/makeDelLayer\(S\.state, lay\.id\);/g));
check('0 层确认清草稿（v55 逻辑保留）', img.includes('localStorage.removeItem(tagMaskKey());'));
check('av-ui 0 角色移除 char_ref（v55b 链路保留）', av.includes('if (!entries.length)') && av.includes('L.removeCharRef(S.marks, rid)'));

console.log('probe-v60f: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
process.exit(fail ? 1 : 0);
