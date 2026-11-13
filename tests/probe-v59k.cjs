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

/* v59k-b：tree+docId 直构（debug_22 真机修复） */
check('readBytes 支持 tree+docId', /call\.getString\("tree"\)/.test(nat) && /call\.getString\("docId"\)/.test(nat) && nat.includes('docUriForId(Uri.parse(treeStr), docId)'));
check('JS 传 tree+docId（绕开 uri 字符串往返）', cui.includes('tree: treeUriStr') && cui.includes('docId: it.docId'));
check('组名取文件夹最后一段', cui.includes(".split('/').pop()"));

/* v59kb：同名重建自愈（删除后注册表残留条目） */
const pui2 = fs.readFileSync(WS + 'www/projects-ui.js', 'utf8');
check('submit 目录感知自愈（stat→ghost clean）', pui2.includes('dup ghost cleaned') && pui2.includes('L.removeProject(reg, v.name)'));
check('stat 用 meta.json 判目录在否', /pathsFor\(v\.name\)[\s\S]{0,120}stat\(pdir\.meta\)/.test(pui2));

/* 缓存 */
check('index.html cache v63', html.includes('av-ui.js?v=76') && html.includes('cardgroups-ui.js?v=76') && html.includes('cardgroups-full.js?v=76'));

console.log('probe-v59k: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
process.exit(fail ? 1 : 0);
