/* probe-v61e：JSON 内嵌原图 + 体积上限保护 + 借用原图 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n); } };

const cc = fs.readFileSync(WS + 'www/charcards.js', 'utf8');
const cui = fs.readFileSync(WS + 'www/cardgroups-ui.js', 'utf8');

check('exportPlan 内嵌原图 imgFull', cc.includes('cc.imgFull = c.imgFull;'));
check('原图内嵌有体积上限', cc.includes('INLINE_FULL_MAX') && cc.includes('var INLINE_FULL_MAX = 2621440'));
check('仍保留 imgFullFile 路径引用', cc.includes("cc.imgFullFile = 'chars_full/'"));
check('借用逻辑覆盖原图', cui.includes('borrowed originals='));

/* 行为：小图内嵌、大图不内嵌 */
global.window = global;
delete require.cache[require.resolve(WS + 'www/charcards.js')];
require(WS + 'www/charcards.js');
const CC = global.CC;
const jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const big = 'data:image/png;base64,' + 'A'.repeat(3 * 1024 * 1024);   /* >2.5MB */
const d = CC.normalize({ schema: 'moyutai.charcards.v1', orig_char_descs: [], dest_char_descs: [],
  cards: [{ id: 'c1', name: '小图', tag: '', img: jpg, imgFull: jpg }, { id: 'c2', name: '大图', tag: '', img: jpg, imgFull: big }] });
const plan = CC.exportPlan(d);
const small = plan.json.cards[0], large = plan.json.cards[1];
check('小原图内嵌进 JSON', !!small.imgFull);
check('小原图仍写 chars_full 路径', !!small.imgFullFile);
check('大原图不内嵌（体积保护）', !large.imgFull, 'len=' + (large.imgFull ? large.imgFull.length : 0));
check('大原图仍写 chars_full 路径', !!large.imgFullFile);
const back = CC.importFromParts(JSON.parse(JSON.stringify(plan.json)), {});
check('往返小图原图保留', !!back.cards[0].imgFull);
check('大图原图仅路径（无内嵌则不还原）', !back.cards[1].imgFull);

console.log('probe-v61e: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
process.exit(fail ? 1 : 0);
