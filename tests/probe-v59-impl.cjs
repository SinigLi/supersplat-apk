/* v59 probe：实装验收（数据层 v2 + 开始页管理器 + 视频页 r3 对话框 + 打标适配） */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n); } };

const cc = fs.readFileSync(WS + 'www/charcards.js', 'utf8');
const cui = fs.readFileSync(WS + 'www/cardgroups-ui.js', 'utf8');
const cg = fs.readFileSync(WS + 'www/cardgroups.js', 'utf8');
const av = fs.readFileSync(WS + 'www/av-ui.js', 'utf8');
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');
const pui = fs.readFileSync(WS + 'www/projects-ui.js', 'utf8');
const html = fs.readFileSync(WS + 'www/index.html', 'utf8');

/* 数据层 v2 */
check('schema v2', cc.includes("moyutai.charcards.v2"));
check('v1→v2 迁移（toV2）', cc.includes('function toV2') && cc.includes('orig_char_descs'));
check('词库分组 API（addWord/wordsOf）', cc.includes('function addWord') && cc.includes('function wordsOf'));
check('头像字段（setCardImg dataURL 校验）', cc.includes('function setCardImg') && cc.includes('data:image'));
check('zip 组包计划（exportPlan）', cc.includes('function exportPlan') && cc.includes('imgFile'));
check('zip 解组（importFromParts）', cc.includes('function importFromParts'));
check('safeFileName', cc.includes('function safeFileName'));

/* 开始页管理器（r3 形态） */
check('管理器：sheet 形态', cui.includes('cgm-sheet') && cui.includes('cgm-card'));
check('管理器：图片文件夹全链路（pickFolder→listFiles→缩256）', cui.includes('pickFolder') && cui.includes('listFiles') && cui.includes('toDataURL'));
check('管理器：词库抽屉', cui.includes('📖 描述词库') || cui.includes('描述词库'));
check('管理器：zip 导出（fflate.zip）', cui.includes('fflate.zip'));
check('管理器：zip 导入（fflate.unzip）', cui.includes('fflate.unzip'));
check('管理器：导入图片文件夹入口（v59k）', cui.includes('importImageFolder') && cui.includes('readBytes'));

/* 视频页 r3 对话框 */
check('对话框：r3 sheet 形态', av.includes('cgm-card') && av.includes('cgm-head'));
check('对话框：头像变更入口已随编辑对话框移除（v59k）', !av.includes('ch-cam'));
check('视频页 🎭 纯选择器（v59k）', /openCharDialog\(\)\s*\{[\s\S]{0,200}?openGroupPicker\(\);\s*\}/.test(av) && !av.includes('buildCharDialog'));
check('选库：使用中标', av.includes('✓ 使用中'));
check('切换：缺角色警告保留', av.includes('新卡组缺少以下角色'));
check('切换：成功 toast 保留', av.includes('切换角色库成功'));
check('导出 zip（fflate.zip）', av.includes('fflate.zip'));
check('视频页无编辑对话框（v59k：不含 avcExport/avcImport）', !av.includes('avcExport') && !av.includes('avcImport'));
check('打标数据源仍用 curCards（保留）', av.includes('function curCards') && av.includes('upsertCharRef'));

/* 打标适配 */
check('描述下拉读词库分组（原）', img.includes("wordsOf(tm.cards, '原角色描述')") || img.includes("CC.wordsOf(tm.cards, '原角色描述')"));
check('描述下拉读词库分组（替）', img.includes("wordsOf(tm.cards, '替换角色描述')") || img.includes("CC.wordsOf(tm.cards, '替换角色描述')"));
check('旧 orig_char_descs 直读已除', !img.includes('tm.cards.orig_char_descs'));
check('遮罩路径 v58 保留（帧号目录+角色名）', av.includes("safeName + '.png'"));
check('空层防黑图保留（v57c）', av.includes('layMatch.strokes.length'));
check('极性黑底抠洞保留（v56b）', img.includes('drawStrokes(og, lay.strokes)'));

/* 开始页入口 + html */
check('开始页入口按钮', pui.includes('🎭 角色卡') && pui.includes('__cardgroups.open'));
check('index.html 全部 v59', ['av-ui.js?v=59', 'charcards.js?v=59', 'cardgroups.js?v=59', 'cardgroups-ui.js?v=59', 'img-ui.js?v=59'].every(x => html.includes(x)));

/* 回归锚：不受影响的功能 */
check('即画即存（v54）', img.includes('if (S.tagMode) saveTagStrokes();'));
check('切层回写（v55c）', img.includes("if (tagSelEl) tagSelEl.value = card.id;"));
check('CCG 多套存储', cg.includes('moyutai-cardgroups-v1'));

console.log('========================');
console.log('probe-v59-impl: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
