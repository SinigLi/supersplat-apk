/* probe-v60c：原图保留 + 停靠栏 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n); } };

const cc = fs.readFileSync(WS + 'www/charcards.js', 'utf8');
const cui = fs.readFileSync(WS + 'www/cardgroups-ui.js', 'utf8');
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');

/* 需求1：原图保留 + 导出 */
check('导入保留原图（imgFull 原始 dataURL）', cui.includes("card.imgFull = 'data:image/'") && cui.includes('ext: mExt'));
check('normalize 白名单收 imgFull', /c\.imgFull === 'string'/.test(cc));
check('导出 chars_full/ 原图引用', cc.includes('chars_full/') && cc.includes('imgFullFile'));
check('dataUrlExt 嗅探原格式', cc.includes('function dataUrlExt'));
check('importFromParts 回填 imgFull', cc.includes('cc.imgFullFile') && cc.includes('delete cc.imgFullFile'));

/* 需求2：停靠栏 */
check('确认/取消顶部停靠（safe-area 贴边）', /img-tag-okbar\{[^\}]*safe-area-inset-top/.test(img));
check('底部工具条停靠（safe-area 贴边）', /img-tagbar-bottom\{[^\}]*safe-area-inset-bottom/.test(img));

console.log('probe-v60c: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
process.exit(fail ? 1 : 0);
