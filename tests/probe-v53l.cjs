/* v53l probe：00:25 两条（层列表只读） */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');

/* ① 按钮锁定改为渲染时同步（build 一次性判断已移除） */
check('build 时锁定判断已移除', !img.includes(`if (S.tagMode) {\n            lTop.querySelectorAll`));
check('renderLayersPanel 每次同步按钮锁定', img.includes(`b.disabled = !!S.tagMode;`) && img.includes(`b.classList.toggle('img-sub-btn-off', !!S.tagMode);`));
/* ② 行为只读 */
check('行点击激活在 tagMode 禁用', img.includes(`if (S.tagMode) { toast('打标模式下换层用底部「启用打标」'); return; }`));
check('眼睛显隐在 tagMode 禁用', img.includes(`if (ro) { toast('打标模式下层由「启用/取消打标」控制'); return; }`));
check('眼睛置灰样式', img.includes('.img-layer-eye.img-layer-eye-off{opacity:0.35}'));
/* 回归 */
check('落笔 guard（v53k 映射）', img.includes(`enabledIds.indexOf(actCard.id) < 0`));
check('取消打标删层', img.includes('OPS.makeDelLayer(S.state, lay.id)'));
check('草稿 fallback', img.includes('tagmask migrated'));
check('CSS 逗号链完好', img.includes(`pointer-events:none}",\n  ".img-layer-eye.img-layer-eye-off`));

console.log('========================');
console.log('probe-v53l: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
