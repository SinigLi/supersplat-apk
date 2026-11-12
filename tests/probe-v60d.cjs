/* probe-v60d：原图 IDB 化契约 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n); } };

const full = fs.readFileSync(WS + 'www/cardgroups-full.js', 'utf8');
const cg = fs.readFileSync(WS + 'www/cardgroups.js', 'utf8');
const cui = fs.readFileSync(WS + 'www/cardgroups-ui.js', 'utf8');
const html = fs.readFileSync(WS + 'www/index.html', 'utf8');

check('CGFull 库存在（put/get/all/delGroup/stripFull）', ['put:', 'get:', 'all:', 'delGroup:', 'stripFull:'].every(k => full.includes(k)));
check('saveData 剥离 imgFull 后写 localStorage', cg.includes('stripFull(data)') && cg.includes('g.data = sp.slim'));
check('saveData 落 IDB（put per full）', cg.includes('CGFull.put(id, f.cardId, f.dataUrl)'));
check('remove 清理组原图（delGroup）', cg.includes('CGFull.delGroup(id)'));
check('index.html 引入 cardgroups-full.js', html.includes('cardgroups-full.js?v='));
check('导出前合并原图（CGFull.all → imgFull 挂回）', cui.includes('CGFull.all(id)') && cui.includes('c.imgFull = fulls[c.id]'));
check('IDB 失败降级只导头像', cui.includes('doExport(data);   /* 降级：只导头像 */'));
check('localStorage 键不再收原图（stripFull 后 slim 无 imgFull）', full.includes('delete c.imgFull'));

console.log('probe-v60d: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
process.exit(fail ? 1 : 0);
