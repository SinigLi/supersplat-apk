/* cardgroups 单测：多套卡组 CRUD / 迁移幂等 / 校验 */
'use strict';
/* mock localStorage */
const store = {};
global.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: i => Object.keys(store)[i] || null,
};
global.window = global;

const fs = require('fs');
const path = require('path');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
eval(fs.readFileSync(path.join(WS, 'www/charcards.js'), 'utf8'));
eval(fs.readFileSync(path.join(WS, 'www/cardgroups.js'), 'utf8'));
const CC = global.CC, CCG = global.CCG;

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } };

/* ① 建组/查重/列表 */
const r1 = CCG.create('魔法少女');
check('create 返回 id', r1 && r1.id);
check('同名建组拒收', CCG.create('魔法少女') === null);
const r2 = CCG.create('修仙');
check('第二套可建', r2 && r2.id && r2.id !== r1.id);
check('list 两组', CCG.list().length === 2);
check('nameOf', CCG.nameOf(r1.id) === '魔法少女');

/* ② saveData 校验 */
check('saveData 拒非法 schema', CCG.saveData(r1.id, { schema: 'bad' }) === false);
check('saveData 接合法数据', CCG.saveData(r1.id, { schema: 'moyutai.charcards.v1', orig_char_descs: ['红衣'], dest_char_descs: [], cards: [{ id: 'c-1', name: 'GPT', tag: '' }] }));
check('get 回读', CCG.get(r1.id).cards.length === 1 && CCG.get(r1.id).orig_char_descs[0] === '红衣');
check('rename 重名拒', CCG.rename(r2.id, '魔法少女') === false);
check('rename 正常', CCG.rename(r2.id, '修仙v2') && CCG.nameOf(r2.id) === '修仙v2');

/* ③ importPack 覆写已存在同名 */
check('importPack 新组', CCG.importPack('新组', { schema: 'moyutai.charcards.v1', orig_char_descs: [], dest_char_descs: [], cards: [] }).id);
const imp = CCG.importPack('新组', { schema: 'moyutai.charcards.v1', orig_char_descs: ['a'], dest_char_descs: [], cards: [] });
check('importPack 同名覆写', imp.existed === true && CCG.get(imp.id).orig_char_descs[0] === 'a');
check('importPack 拒非法', CCG.importPack('x', { foo: 1 }) === null);

/* ④ 迁移：旧工程键 → 建组，幂等 */
store['av-魔法少女小圆-chars'] = JSON.stringify({ schema: 'moyutai.charcards.v1', orig_char_descs: ['D1'], dest_char_descs: [], cards: [{ id: 'c-c75f060f', name: 'deepseek', tag: '' }] });
store['av-另一剧-chars'] = JSON.stringify({ schema: 'moyutai.charcards.v1', orig_char_descs: [], dest_char_descs: ['D2'], cards: [{ id: 'c-cddec69b', name: 'claude', tag: '' }] });
store['av-坏数据-chars'] = '{broken';
const created = CCG.migrateIfNeeded();
check('迁移建 2 组（坏数据跳过）', created === 2);
check('迁移后组数据正确', CCG.findByName('魔法少女小圆').data.cards[0].name === 'deepseek');
const created2 = CCG.migrateIfNeeded();
check('迁移幂等（二次 0 组）', created2 === 0);

/* ⑤ 删除 */
check('remove 正常', CCG.remove(r2.id) && CCG.get(r2.id) === null);
check('remove 不存在 false', CCG.remove('nope') === false);

/* ⑥ 坏存储自愈 */
store['moyutai-cardgroups-v1'] = '{broken';
check('坏存储回退空表', CCG.list().length === 0);

console.log('========================');
console.log('cardgroups: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
