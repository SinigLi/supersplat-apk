/* probe-v61f：原图全量内嵌（不再有 2.5MB 上限）+ 借用必须读 IndexedDB */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log('PASS ' + n + (extra ? ' | ' + extra : '')); } else { fail++; console.log('FAIL ' + n + (extra ? ' | ' + extra : '')); } };

const cc = fs.readFileSync(WS + 'www/charcards.js', 'utf8');
const cui = fs.readFileSync(WS + 'www/cardgroups-ui.js', 'utf8');

check('已移除 2.5MB 内嵌上限', !cc.includes('INLINE_FULL_MAX'));
check('exportPlan 无条件内嵌原图', /if \(c\.imgFull\) \{[\s\S]{0,300}cc\.imgFull = c\.imgFull;/.test(cc));
check('仍保留 imgFullFile 路径引用', cc.includes("cc.imgFullFile = 'chars_full/'"));
check('借用读 IndexedDB', cui.includes('window.CGFull.all(g.id)'), '');
check('借用日志区分头像与原图', cui.includes("borrowed avatars=' + filled + ' originals=' + filledFull"));
check('applyImport 返回 Promise（等借用完成再落盘）', cui.includes('return borrowAvatars(v2)'));
check('两处调用都等 Promise', cui.includes('Promise.resolve(applyImport(data') && cui.includes('Promise.resolve(applyImport(jd'));
check('导出前合并 IDB 原图抽成 mergeFulls', cui.includes('function mergeFulls'));
check('面板未打开时 renderList 不碰 DOM', cui.includes('if (!dlgEl) return;'));

/* 行为：3MB 大图也必须内嵌 */
global.window = global;
delete require.cache[require.resolve(WS + 'www/charcards.js')];
require(WS + 'www/charcards.js');
const CC = global.CC;
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const big = 'data:image/png;base64,' + 'A'.repeat(3 * 1024 * 1024);
const d = CC.normalize({ schema: 'moyutai.charcards.v1', orig_char_descs: [], dest_char_descs: [],
  cards: [{ id: 'c1', name: '小图', tag: '', img: png, imgFull: png }, { id: 'c2', name: '大图', tag: '', img: png, imgFull: big }] });
const plan = CC.exportPlan(d);
check('小原图内嵌', !!plan.json.cards[0].imgFull);
check('3MB 大原图也内嵌（v61f 取消上限）', !!plan.json.cards[1].imgFull, 'len=' + (plan.json.cards[1].imgFull || '').length);
check('大图仍写 chars_full 路径', !!plan.json.cards[1].imgFullFile);
const back = CC.importFromParts(JSON.parse(JSON.stringify(plan.json)), {});
check('往返大图原图恢复', !!back.cards[1].imgFull && back.cards[1].imgFull.length === big.length);

console.log('probe-v61f: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
process.exit(fail ? 1 : 0);
