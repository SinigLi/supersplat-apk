/* v60b 探针：三需求契约断言 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n); } };

const cc = fs.readFileSync(WS + 'www/charcards.js', 'utf8');
const cui = fs.readFileSync(WS + 'www/cardgroups-ui.js', 'utf8');
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');

/* 需求1：默认两组常驻 */
check('normalize 钉住默认两组', /DEFAULT_GROUPS\(\)\.forEach\(function \(dg, di\)/.test(cc) && /splice\(di, 0, g\)/.test(cc));

/* 需求2：导出 zip → shareFile，json 引用图片 */
check('导出走原生分享（shareFile）', cui.includes('shareFile') && cui.includes('application/zip'));
check('网页兜底下载保留', cui.includes('URL.createObjectURL'));
check('u8ToB64 分段编码', cui.includes('function u8ToB64'));
check('json 图片引用 chars/', cc.includes("imgFile = 'chars/'"));

/* 需求3：打标 UI 重构 */
check('确认/取消独立左上角（img-tag-okbar）', img.includes('img-tag-okbar') && img.includes("okBar.style.top = '12px'"));
check('启用/隐藏/停用按钮已删', !img.includes("'启用'") && !img.includes("'停用'") && !/gHide\.appendChild\(el\('span', 'ico', '🙈'\)/.test(img));
check('角色下拉 select 已删（tagSelEl 无 DOM 构建）', !/tagSelEl = el\('select'/.test(img));
check('底部中间工具条（图层/当前层名/描述/角色）', img.includes('img-tagbar-bottom') && img.includes("'图层'") && img.includes("'描述'") && img.includes("'角色'"));
check('当前遮罩层名常显', img.includes('tmTagCurLayerName') && img.includes('imgTagCurLayerName'));
check('角色卡选择弹层（搜索+头像）', img.includes('openTagCardPicker') && img.includes('img-cardpicker-search') && img.includes('img-cardpicker-ava'));
check('选中即建层激活（switchTagLayer）', /onPick[\s\S]{0,400}switchTagLayer\(c\)/.test(img) || img.includes('switchTagLayer(c);'));
check('tagEntries 层派生 enabled', /遮罩层名单/.test(img) && /enabledCards\.map/.test(img));
check('图层面板打标可编辑（锁定代码已移除）', !/b\.disabled = !!S\.tagMode/.test(img));
check('新增按钮 tagMode → 角色卡选择', /addBtn\.addEventListener[\s\S]{0,300}openTagCardPicker\('add'/.test(img));
check('层行删除按钮（img-layer-rm）', img.includes('img-layer-rm'));

console.log('probe-v60b: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
process.exit(fail ? 1 : 0);
