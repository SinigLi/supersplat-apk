/* charcards v2 单测（替换 v1 版）：数据模型/迁移/词库/导入导出计划 */
'use strict';
const fs = require('fs');
const path = require('path');
global.window = global;
require(path.join('F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www/charcards.js'));
const C = global.CC;

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } };
const threw = fn => { try { fn(); return false; } catch (e) { return true; } };

/* 结构 */
const f = C.emptyCards();
check('empty: schema v2', f.schema === 'moyutai.charcards.v2');
/* v69：默认两组改名为 全局描述 / 提示词扩写，且全局描述自带默认词「启用思考」 */
check('empty: descGroups 默认两组', f.descGroups.length === 2 && f.descGroups[0].name === '全局描述' && f.descGroups[1].name === '提示词扩写');
check('empty: 全局描述自带启用思考', JSON.stringify(f.descGroups[0].items) === '["启用思考"]');
check('empty: cards 空', f.cards.length === 0);
check('normalize(null) 空', C.normalize(null).cards.length === 0);

/* v1 → v2 迁移 */
const v1 = C.normalize({ schema: 'moyutai.charcards.v1', orig_char_descs: ['红衣', '红衣'], dest_char_descs: ['和服'], cards: [{ id: 'c-1', name: '小圆', tag: '主角', orig: ['x'], dest: ['y'] }] });
check('v1 迁移：去重并集', JSON.stringify(v1.descGroups[0].items) === '["红衣"]' && JSON.stringify(v1.descGroups[1].items) === '["和服"]');
check('v1 迁移：卡保留 id/name/tag', v1.cards[0].id === 'c-1' && v1.cards[0].name === '小圆' && v1.cards[0].tag === '主角');
check('v1 迁移：卡上 orig/dest 丢弃', !('orig' in v1.cards[0]) && !('dest' in v1.cards[0]));

/* 卡 CRUD */
const c1 = C.addCard(f, '沙耶香', '主角');
check('addCard: id 前缀 c-', /^c-[0-9a-f]{8}$/.test(c1.id));
check('addCard: 重名抛错', threw(() => C.addCard(f, '沙耶香')));
check('addCard: 空名抛错', threw(() => C.addCard(f, '')));
C.setCardImg(f, c1.id, 'data:image/jpeg;base64,AAA');
check('setCardImg: dataURL 存', f.cards[0].img === 'data:image/jpeg;base64,AAA');
C.setCardImg(f, c1.id, 'not-a-url');
check('setCardImg: 非 dataURL 清除', !('img' in f.cards[0]));
C.setCardImg(f, c1.id, 'data:image/png;base64,BBB');
check('setCardTag', C.setCardTag(f, c1.id, '主角').tag === '主角');
C.addCard(f, '丘比');
check('renameCard: 重名拒（与丘比冲突）', threw(() => C.renameCard(f, c1.id, '丘比')));
C.renameCard(f, c1.id, '沙耶香2');
check('renameCard: 改名', f.cards[0].name === '沙耶香2');
check('findByName', C.findByName(f, '丘比').name === '丘比');
check('removeCard', C.removeCard(f, C.findByName(f, '丘比').id) === true);

/* 词库 */
C.addWord(f, '全局描述', '粉发');
C.addWord(f, '全局描述', '校服');
C.addGroup(f, '发型');
C.addWord(f, '发型', '黑长直');
check('addGroup + addWord', C.wordsOf(f, '发型')[0] === '黑长直');
check('addWord: 组不存在抛错', threw(() => C.addWord(f, '没有的组', 'x')));
check('addWord: 重复抛错', threw(() => C.addWord(f, '发型', '黑长直')));
check('wordsOf: 缺组返回 []', JSON.stringify(C.wordsOf(f, '没有的组')) === '[]');
C.removeWord(f, '全局描述', '校服');
/* v69：组里还有默认词「启用思考」，所以断言「粉发还在、校服已删」 */
check('removeWord', C.wordsOf(f, '全局描述').indexOf('粉发') >= 0 && C.wordsOf(f, '全局描述').indexOf('校服') < 0);
check('renameGroup 重名拒', threw(() => C.renameGroup(f, '全局描述', '发型')));
C.renameGroup(f, '发型', '服装');
check('renameGroup', C.wordsOf(f, '服装')[0] === '黑长直');
C.removeGroup(f, '服装');
check('removeGroup', C.wordsOf(f, '服装').length === 0);

/* 导入导出 */
C.setCardImg(f, c1.id, 'data:image/jpeg;base64,IMGDATA');
const plan = C.exportPlan(f);
check('exportPlan: schema v2', plan.json.schema === 'moyutai.charcards.v2');
check('exportPlan: imgFile 规则', plan.images[0].file === 'chars/沙耶香2.jpg' || plan.images[0].file.indexOf('chars/') === 0);
check('exportPlan: images 数与带图卡一致', plan.images.length === f.cards.filter(c => c.img).length);
const back = C.importJson(C.exportJson(f));
check('importJson 往返 v2', back.schema === 'moyutai.charcards.v2' && back.cards[0].name === f.cards[0].name && back.cards[0].img === f.cards[0].img);
check('importJson: 格式不符拒', threw(() => C.importJson('{"schema":"bad"}')));
const parts = C.importFromParts({ schema: 'moyutai.charcards.v2', descGroups: [{ name: '全局描述', items: ['甲'] }], cards: [{ id: 'c-9', name: '林凡', tag: '', imgFile: 'chars/林凡.jpg' }] }, { 'chars/林凡.jpg': 'data:image/jpeg;base64,ZZZ' });
check('importFromParts: imgFile 回填', parts.cards[0].img === 'data:image/jpeg;base64,ZZZ');
check('importFromParts: imgFile 已删', !('imgFile' in parts.cards[0]));

/* safeFileName */
check('safeFileName 特殊字符', C.safeFileName('a b/c:d').indexOf(' ') < 0 && C.safeFileName('a b/c:d').indexOf('/') < 0);

console.log('========================');
console.log('charcards v2: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
