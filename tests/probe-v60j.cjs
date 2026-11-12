/* probe-v60j：首次打标草稿 key（seg_frame）与导出读取 key（char_ref.id）双兼容 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n); } };

const av = fs.readFileSync(WS + 'www/av-ui.js', 'utf8');

check('loadTagMaskLayers 先试 char_ref.id key', av.includes("'av-' + S.project + '-tagmask-' + ref.id,"));
check('loadTagMaskLayers 回退 seg_frame key', av.includes("'-tagmask-' + ref.seg + '_' + L.frameAt(ref.at, effFps())"));
check('双 key 循环读取（命中即返回）', av.includes('for (var ki = 0; ki < keys.length; ki++)'));
check('img-ui 首次写 seg_frame key 保持不变', fs.readFileSync(WS + 'www/img-ui.js', 'utf8').includes("'-tagmask-' + (tm.existing ? tm.existing.id : tm.seg + '_' + tm.frame)"));
check('导出前仍先解析遮罩再 buildExport', av.includes('var resolved = await resolveTagMasks();') && av.includes('L.buildExport(S.meta, S.marks, S.files)'));

console.log('probe-v60j: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
process.exit(fail ? 1 : 0);
