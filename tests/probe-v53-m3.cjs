/* M3 probe：av-ui 交互层 headless 验证
 * 静态断言（无法起完整视频工程的文件，退化为代码结构断言 + 既有 probe 兜底）：
 * 1. btnChar 在 ovlEl 最前（并入前段上方位置 ✓）
 * 2. resolveTagTarget 四分支（split/multi/merge_prev/默认首帧）
 * 3. 卡对话框节点齐全 + 双描述列表管理
 * 4. renderTicks char_ref 分支 + renderList 🎭 徽标
 * 5. CSS 注入（AV_CSS_V53 + apply 拼接）
 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}

const ui = fs.readFileSync(WS + 'www/av-ui.js', 'utf8');
const cc = fs.readFileSync(WS + 'www/charcards.js', 'utf8');
const store = fs.readFileSync(WS + 'www/av-store.js', 'utf8');
const html = fs.readFileSync(WS + 'www/index.html', 'utf8');

/* 1. 按钮 */
check('btnChar 创建且在 ovlEl 内', ui.includes(`btnChar = el('button', 'av-ovl-btn av-charbtn', '⚑ 角色打标')`) && ui.indexOf('btnChar') < ui.indexOf("btnMerge = el('button'"));
check('btnChar 点击 → openTagEditor', ui.includes(`btnChar.addEventListener('click', openTagEditor)`));
const ovlIdx = ui.indexOf(`ovlEl = el('div', 'av-ovl')`);
const btnCharAt = ui.indexOf(`btnChar = el('button'`);
check('btnChar 位于 ovlEl 首', btnCharAt > ovlIdx && btnCharAt < ui.indexOf(`btnMerge = el('button'`), { ovlIdx, btnCharAt });

/* 2. 四分支 */
check('分支: 激活分割点优先', /split' && L\.frameAt\(m\.at, f\) === fr/.test(ui));
check('分支: 多帧点帧命中', ui.includes(`(m.frames || []).indexOf(fr) >= 0`));
check('分支: merge_prev 拒绝（Q1）', ui.includes(`'该片段已并入前段，首帧不能再打标'`));
check('分支: 默认首帧 frame:0', ui.includes(`frame: 0, at: 0, kind: 'first'`));
check('音频模式拒绝', ui.includes(`'音频模式无帧概念，不支持角色打标'`));

/* 3. 无卡引导 */
check('无卡 → toast + 开卡对话框', ui.includes(`'先设定角色卡'`) && ui.includes('openCharDialog(); return'));

/* 4. 对话框 */
for (const w of ['av-chardlg-title', 'av-charlist', 'av-origlist', 'av-destlist', 'av-loadcards', 'av-exportcards', 'av-closedlg', 'av-addchar', 'av-addorig', 'av-adddest']) {
    check('对话框节点 ' + w, ui.includes(w));
}
check('描述列表管理走 CC.removeOrig/DestDesc', ui.includes('CC.removeOrigDesc') && ui.includes('CC.removeDestDesc'));
check('卡删除走 CC.removeCard', ui.includes('CC.removeCard(c2, it.id)'));
check('导入走 CC.importCards + 格式校验', ui.includes('CC.importCards(cards, r.text)') && ui.includes('moyutai.charcards.v1'));
check('导出走 CC.exportCards + share 链路', ui.includes('CC.exportCards') && ui.includes('MediaServer'));

/* 5. 展示 */
check('renderTicks char_ref 分支', ui.includes(`av-tick-char`) && ui.includes(`m.type === 'char_ref'`));
check('renderList 🎭 徽标', ui.includes(`av-b-char`, ) || ui.includes('av-b-char'));
check('hasCharRef 实现', ui.includes(`function hasCharRef(seg)`));
check('CSS 注入拼接', ui.includes('AV_CSS_V53') && ui.includes('AV_CSS + AV_CSS_V53'));
check('.av-tick-char 样式', ui.includes(`'.av-tick-char`));

/* 6. M4 挂钩预留 */
check('M4 openTagMode 调用点', ui.includes('window.__img.openTagMode'));
check('onDone → upsertCharRef + saveAll', ui.includes('L.upsertCharRef(S.marks, tgt.seg, tgt.at, entries)') && ui.includes('saveAll(false)'));

/* 7. 既有层回归（存储函数导出） */
check('store 导出 chars API', ['loadChars', 'saveChars', 'upsertCharRef', 'findCharRefAt', 'removeCharRef'].every(k => store.includes(k + ': ' + k)));
check('index.html 加载 charcards.js', html.includes('charcards.js'));
check('charcards SCHEMA 一致', cc.includes("'moyutai.charcards.v1'") && store.includes("'moyutai.charcards.v1'"));

console.log('========================');
console.log('probe-v53-M3: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
