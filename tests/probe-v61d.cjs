/* probe-v61d：导出 JSON 内嵌头像 + 缺图时从同名角色借用 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n); } };

const cc = fs.readFileSync(WS + 'www/charcards.js', 'utf8');
const cui = fs.readFileSync(WS + 'www/cardgroups-ui.js', 'utf8');

check('exportPlan 内嵌头像 img', cc.includes('cc.img = c.img;'));
check('仍保留 imgFile 路径引用', cc.includes("cc.imgFile = 'chars/' + safeFileName(c.name) + '.jpg';"));
check('仍保留 imgFullFile', cc.includes("cc.imgFullFile = 'chars_full/'"));
check('borrowAvatars 已实现', cui.includes('function borrowAvatars(v2)'));
check('导入时调用 borrowAvatars', cui.includes('var borrowed = borrowAvatars(v2);'));
check('缺图数量写日志', cui.includes("dlog('import: cards without avatar=' + missing)"));
check('缺图时 toast 提示改导 ZIP', cui.includes('个角色没带图片'));

/* 行为 */
global.window = global;
delete require.cache[require.resolve(WS + 'www/charcards.js')];
require(WS + 'www/charcards.js');
const CC = global.CC;
const jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const d = CC.normalize({ schema: 'moyutai.charcards.v1', orig_char_descs: [], dest_char_descs: [],
  cards: [{ id: 'c1', name: 'GPT', tag: '', img: jpg }, { id: 'c2', name: 'B', tag: '', img: jpg, imgFull: jpg }] });
const plan = CC.exportPlan(d);
check('plan cards 都带 img', plan.json.cards.every(c => !!c.img));
check('plan 图片条目仍是 3（两张头像 + 一张原图）', plan.images.length === 3);
const back = CC.importFromParts(JSON.parse(JSON.stringify(plan.json)), {});
check('往返（无 imgMap）两张卡都有头像', back.cards.every(c => !!c.img));

console.log('probe-v61d: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
process.exit(fail ? 1 : 0);
