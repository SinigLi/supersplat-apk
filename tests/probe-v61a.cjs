/* probe-v61a：视频导出附带角色组（复用 CC.exportPlan）+ validData v1/v2 兼容 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n); } };

const av = fs.readFileSync(WS + 'www/av-ui.js', 'utf8');
const cg = fs.readFileSync(WS + 'www/cardgroups.js', 'utf8');

check('导出前收集被引用角色名', av.includes('function refCharNames()') && av.includes("m.type !== \"char_ref\""));
check('卡组打包复用 CC.exportPlan', av.includes('window.CC.exportPlan(slim)'));
check('原图从 IndexedDB 合并', av.includes('window.CGFull.all(gid)'));
check('charcards.json 进 ZIP', av.includes('"charcards.json": new TextEncoder()'));
check('needZip 含角色组分支', av.includes('var needZip = resolved.count > 0 || !!groupPack;'));
check('ZIP 合并组条目', av.includes('entries[k] = groupPack.entries[k];'));
check('validData 接受 v2', cg.includes("d.schema === 'moyutai.charcards.v2'"));

/* 行为验证 */
global.localStorage = { _m: {}, getItem(k) { return this._m[k] !== undefined ? this._m[k] : null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; }, get length() { return Object.keys(this._m).length; }, key(i) { return Object.keys(this._m)[i]; } };
global.window = global;
delete require.cache[require.resolve(WS + 'www/charcards.js')];
delete require.cache[require.resolve(WS + 'www/cardgroups.js')];
require(WS + 'www/charcards.js');
require(WS + 'www/cardgroups.js');
const CC = global.CC, CCG = global.CCG;
const v2 = CC.normalize({ schema: 'moyutai.charcards.v1', orig_char_descs: ['a'], dest_char_descs: ['b'], cards: [{ id: 'c1', name: 'GPT', tag: '', img: 'data:image/jpeg;base64,AAAA' }] });
const g = CCG.create('T');
check('saveData(v2) 成功', CCG.saveData(g.id, v2) === true);
check('读回 v2 cards', CCG.get(g.id).cards.length === 1);
check('exportPlan 出 chars/ 引用', CC.exportPlan(CCG.get(g.id)).images.length === 1 && CC.exportPlan(CCG.get(g.id)).json.cards[0].imgFile === 'chars/GPT.jpg');

console.log('probe-v61a: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
process.exit(fail ? 1 : 0);
