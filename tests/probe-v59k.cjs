/* v59k 新增回归：视频页纯选择器 + 图片文件夹导入链路源码契约 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n); } };

const av = fs.readFileSync(WS + 'www/av-ui.js', 'utf8');
const cui = fs.readFileSync(WS + 'www/cardgroups-ui.js', 'utf8');
const nat = fs.readFileSync(WS + 'android/app/src/main/java/com/sinigli/supersplat/MediaServerPlugin.java', 'utf8');
const html = fs.readFileSync(WS + 'www/index.html', 'utf8');

/* 原生层 */
check('MIME 图片扩展（jpg/jpeg/png/webp）', ['"jpg"', '"jpeg"', '"png"', '"webp"'].every(k => nat.includes(k)));
check('readBytes 插件方法', nat.includes('public void readBytes') && nat.includes('Base64.encodeToString'));
check('listFiles 带 document uri', /o\.put\("uri",\s*docUriForId\(treeUri, docIdChild\)/.test(nat));

/* 管理器：图片文件夹导入 */
check('导入图片文件夹按钮', cui.includes('cgmImgFolder') && cui.includes('📁 导入图片文件夹'));
check('旧迁移入口已移除', !cui.includes('cgmMigrate') && !cui.includes('从工程导入'));
check('importImageFolder 流程', cui.includes('function importImageFolder') && cui.includes('pickFolder') && cui.includes('listFiles'));
check('同名取第一张', cui.includes('if (seen[base]) return;'));
check('缩 256 头像', cui.includes("cv.width = S2") && cui.includes("toDataURL('image/jpeg', 0.82)"));
check('importPack 建组（同名覆盖）', cui.includes('window.CCG.importPack(folderName, cards)'));
check('空状态文案更新', cui.includes('📁 导入图片文件夹」批量建角色'));

/* 视频页：纯选择器 */
check('openCharDialog 只开选择器', /function openCharDialog\(\)\s*\{\s*\/\*[^}]*?\*\/\s*openGroupPicker\(\);\s*\}/.test(av));
check('编辑对话框全移除', ['buildCharDialog', 'refreshCharDialog', 'closeCharDialog', 'exportCharCards', 'importCharCards', 'avcExport', 'avcImport', 'charDlgEl'].every(k => !av.includes(k)));
check('switchCharGroup 只记状态', !/switchCharGroup[\s\S]{0,800}buildCharDialog/.test(av) && av.includes('L.saveMeta(S.meta)'));
check('打标数据源保留（curCards/upsertCharRef）', av.includes('function curCards') && av.includes('upsertCharRef'));
check('选库 sheet 保留（✓使用中/高亮）', av.includes('✓ 使用中') && av.includes("border-color:#7c6cf0"));

/* 缓存 */
check('index.html cache v60', html.includes('av-ui.js?v=60') && html.includes('cardgroups-ui.js?v=60'));

console.log('probe-v59k: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
process.exit(fail ? 1 : 0);
