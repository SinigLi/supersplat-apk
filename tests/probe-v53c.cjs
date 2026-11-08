/* v53c probe：本轮真机三问题的回归断言
 * 1. tagOrigIn/tagDestIn 模块级声明存在（buildTagBar 崩溃根因）
 * 2. chip 用工厂 mkCharChip 且 renderPos 重绘后重挂（renderPos innerHTML 覆盖根因）
 * 3. dlog 不再引用越界 e（catch 内）
 */
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

check('tagOrigIn 模块级声明', img.includes('var tagOrigIn = null'));
check('tagDestIn 模块级声明', img.includes('var tagDestIn = null'));
check('buildTagBar 赋值 tagOrigIn', img.includes(`tagOrigIn = el('input', 'img-tagbar-in')`));
check('chip 工厂 mkCharChip', av.includes('function mkCharChip()'));
check('renderPos 重绘后重挂 chip', /posEl\.appendChild\(mkThumbToggle\(\)\);\s*\n\s*posEl\.appendChild\(mkCharChip\(\)\);/.test(av));
check('build() 首挂用工厂（无双绑定）', av.includes(`posEl.appendChild(mkCharChip()); /* v53b/c`) || (av.includes('posEl.appendChild(mkCharChip());') && !av.includes(`var charChip = el('span'`)));
check('dlog 移入 catch（无越界 e）', av.includes(`dlog('tag: capture fail '`) && !av.includes(`dlog('tag: captureTagFrame done/openfail '`));
check('抽帧失败 toast 保留', av.includes(`'抽帧失败：'`));
check('chip 点击开对话框', av.includes('openCharDialog();'));

/* 既有红线抽查 */
check('M5 zip 导出未破坏', av.includes('resolveTagMasks') && av.includes(`mime: 'application/zip'`));
check('M4 确认/取消按钮仍在', img.includes(`'✅ 确认打标'`) && img.includes('finishTag(true)'));
check('tagmask 隔离 key 不变', img.includes(`'av-' + tm.project + '-tagmask-'`));

console.log('========================');
console.log('probe-v53c: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
