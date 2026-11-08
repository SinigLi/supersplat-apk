/* v53j probe：23:38 三条 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');

/* ① 置灰替代隐藏 */
check('层管理锁定（tagMode 渲染时同步置灰，v53l）', img.includes('b.disabled = !!S.tagMode;') && img.includes('img-sub-btn-off'));
check('v53h 整行隐藏已替换', !img.includes(`if (S.tagMode) lTop.style.display = 'none';`));
/* ② 落笔拦截 */
check('未启用打标禁止落笔 + toast（层名映射回 cardId）', img.includes(`先在底部点「启用打标」再画`) && img.includes(`enabledIds.indexOf(actCard.id) < 0`));
check('拦截时不落笔', img.includes(`S.drawing = false;\n                    return;`));
/* ③ 草稿 fallback */
check('existing 后 fallback 旧 seg_frame key', img.includes(`'av-' + S.tagMode.project + '-tagmask-' + S.tagMode.seg + '_' + S.tagMode.frame`));
check('fallback 自动迁移到主 key', img.includes('tagmask migrated'));
/* 回归 */
check('切换角色安全 id', img.includes(`lay = { id: 'L' + Date.now().toString(36)`));
check('取消打标删层（v53i）', img.includes('OPS.makeDelLayer(S.state, lay.id)'));
check('无 tagOrigIn 残留（debug_15）', !img.includes('tagOrigIn'));
check('CSS 逗号链完好', img.includes(`pointer-events:none}",\n  ".img-layer-eye.img-layer-eye-off`) || img.includes(`pointer-events:none}",\n  ".img-tag-confirm`));

console.log('========================');
console.log('probe-v53j: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
