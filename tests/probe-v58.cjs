/* v58 probe：卡组引用体系 + 导出目录结构 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } };

const ccg = fs.readFileSync(WS + 'www/cardgroups.js', 'utf8');
const cui = fs.readFileSync(WS + 'www/cardgroups-ui.js', 'utf8');
const av = fs.readFileSync(WS + 'www/av-ui.js', 'utf8');
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');
const pui = fs.readFileSync(WS + 'www/projects-ui.js', 'utf8');
const html = fs.readFileSync(WS + 'www/index.html', 'utf8');

/* M1 cardgroups 核心 */
check('CCG 全局存储键', ccg.includes("moyutai-cardgroups-v1") && ccg.includes('moyutai.cardgroups.v1'));
check('迁移幂等', ccg.includes('migrateIfNeeded') && ccg.includes('existed: true'));
check('importPack 校验 schema', ccg.includes('validData'));

/* M2 av-ui 数据源 */
check('curCards 引用优先回退旧键', av.includes('function curCards()') && av.includes('charGroupRef') && av.includes('L.loadChars(S.project)'));
check('writeCards 双写路径', av.includes('function writeCards(') && av.includes('CCG.saveData') && av.includes('L.saveChars(S.project, cards)'));
check('旧 loadChars 调用清零', !(av.slice(0, 100).includes('loadChars')) || (av.match(/L\.loadChars\(S\.project\)/g) || []).length === 0);
check('切换成功 toast', av.includes("切换角色库成功"));
check('缺失警告 confirm', av.includes('新卡组缺少以下角色') && av.includes('仍要切换吗'));
check('缺失后仍切换', av.includes('已切换，但缺少角色'));

/* M3 切换选择器 */
check('组选择弹层（v59 r3 sheet）', av.includes('openGroupPicker') && av.includes('cgm-sheet'));
check('新建空组入口', cui.includes('cgmNew'));

/* M4 开始页入口 */
check('projects-ui 角色卡按钮', pui.includes('🎭 角色卡') && pui.includes('__cardgroups.open'));
check('cardgroups-ui 管理对话框（v59 完整版）', cui.includes('cgm-sheet') && cui.includes('migrateIfNeeded') && cui.includes('fflate.zip'));
check('index.html 加载新文件（v59）', html.includes('cardgroups.js?v=59') && html.includes('cardgroups-ui.js?v=59'));

/* M5 导出结构 */
check('帧号目录 + 纯角色名文件', av.includes("'masks/' + ref.seg + '/' + frame + '/' + safeName + '.png'"));
check('文件名安全过滤', av.includes('safeName'));
check('旧 cardId 解析已替换', !av.includes("split('_').pop()"));
check('名字反查卡 id', av.includes('function cardIdOfName'));
check('按名找草稿（兼容旧键）', av.includes('loadTagMaskLayersAnyName'));

/* 回归锚 */
check('空层防黑图保留（v57c）', av.includes('tagmask skip empty') || av.includes("layMatch.strokes.length"));
check('极性黑底抠洞保留（v56b）', img.includes('drawStrokes(og, lay.strokes)'));
check('即画即存保留（v54）', img.includes(`if (S.tagMode) saveTagStrokes();`));
check('切层回写下拉（v55c）', img.includes(`if (tagSelEl) tagSelEl.value = card.id;`));

console.log('========================');
console.log('probe-v58: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
