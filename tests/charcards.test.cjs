/* v53 M1 —— charcards 单元测试（Node 直跑，无依赖）
 * 对齐 groups.test.cjs 风格：check() 累计，末尾汇总退出。 */
'use strict';
const C = require('../www/charcards.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name + ' ' + JSON.stringify(extra || '')); }
}

/* ---- empty/normalize ---- */
{
    const f = C.emptyCards();
    check('empty: schema 正确', f.schema === 'moyutai.charcards.v1');
    check('empty: 三数组齐', Array.isArray(f.orig_char_descs) && Array.isArray(f.dest_char_descs) && Array.isArray(f.cards));
    check('empty: cards 空', f.cards.length === 0);
    check('normalize(null) 空结构', C.normalize(null).cards.length === 0);
    check('normalize 剔除非法卡', C.normalize({ cards: [{ id: '', name: 'x' }, { id: 'a' }, { id: 'b', name: '  ' }, { id: 'ok', name: ' 好 ', tag: 5 }] }).cards.length === 1);
    const n = C.normalize({ cards: [{ id: 'ok', name: ' 好 ', tag: 5 }] });
    check('normalize: name trim + tag 字符串化', n.cards[0].name === '好' && n.cards[0].tag === '');
}

/* ---- CRUD ---- */
{
    const f = C.emptyCards();
    const c1 = C.addCard(f, '女主角', '主角');
    check('addCard: id 前缀 c-', /^c-[0-9a-f]{8}$/.test(c1.id));
    check('addCard: tag 保存', c1.tag === '主角');
    let threw = false;
    try { C.addCard(f, '   '); } catch (e) { threw = true; }
    check('addCard: 空名抛错', threw);
    C.addCard(f, '男配角', '配角');
    check('removeCard: 删对卡', C.removeCard(f, c1.id) === true && f.cards.length === 1);
    check('removeCard: 不存在返回 false', C.removeCard(f, 'nope') === false);
    const c2 = f.cards[0];
    C.renameCard(f, c2.id, '男二号');
    check('renameCard 生效', f.cards[0].name === '男二号');
    C.setTag(f, c2.id, '路人');
    check('setTag 生效', f.cards[0].tag === '路人');
    threw = false;
    try { C.renameCard(f, 'nope', 'x'); } catch (e) { threw = true; }
    check('renameCard: 不存在抛错', threw);
}

/* ---- 描述列表 ---- */
{
    const f = C.emptyCards();
    C.addOrigDesc(f, '红衣女子');
    C.addOrigDesc(f, '红衣女子');       // 去重
    C.addOrigDesc(f, '  红衣女子  ');   // trim 去重
    check('orig 去重', f.orig_char_descs.length === 1);
    C.addDestDesc(f, '穿和服的女人');
    check('dest 追加', f.dest_char_descs.length === 1);
    let threw = false;
    try { C.addOrigDesc(f, '  '); } catch (e) { threw = true; }
    check('addDesc: 空串抛错', threw);
    C.removeOrigDesc(f, '红衣女子');
    check('removeOrigDesc 生效', f.orig_char_descs.length === 0);
    C.removeDestDesc(f, '不存在');
    check('removeDestDesc: 不存在静默', f.dest_char_descs.length === 1);
}

/* ---- 导入合并 ---- */
{
    const f = C.emptyCards();
    const c1 = C.addCard(f, '女主角', '主角');
    C.addOrigDesc(f, '红衣女子');
    const ok = C.importCards(f, JSON.stringify({
        schema: 'moyutai.charcards.v1',
        orig_char_descs: ['红衣女子', '站着的男人'],
        dest_char_descs: ['穿和服的女人'],
        cards: [
            { id: c1.id, name: '同名同id不重复', tag: '' },   // id 冲突 → 跳过
            { id: 'c-aaaa1111', name: '女主角', tag: '主角' }, // 同名不同 id → 保留
            { id: 'c-bbbb2222', name: '男配角', tag: '配角' }
        ]
    }));
    check('import: 返回 file', ok === f);
    check('import: id 去重', f.cards.length === 3);
    check('import: 同名不同 id 保留', f.cards.filter(c => c.name === '女主角').length === 2);
    check('import: 描述并集', f.orig_char_descs.length === 2 && f.dest_char_descs.length === 1);
    check('import: 坏 JSON 拒收', C.importCards(f, '{oops') === null);
    check('import: schema 不符拒收', C.importCards(f, '{"schema":"x","cards":[]}') === null);
    check('import: 缺 cards 数组拒收', C.importCards(f, '{"schema":"moyutai.charcards.v1"}') === null);
}

/* ---- 导出往返 ---- */
{
    const f = C.emptyCards();
    C.addCard(f, '女主角', '主角');
    C.addOrigDesc(f, '红衣女子');
    const f2 = C.normalize(JSON.parse(C.exportCards(f)));
    check('export 往返: cards', f2.cards.length === 1 && f2.cards[0].name === '女主角');
    check('export 往返: orig', f2.orig_char_descs[0] === '红衣女子');
    check('export 往返: schema', f2.schema === 'moyutai.charcards.v1');
}

/* ---- makeTagEntry ---- */
{
    const f = C.emptyCards();
    const c = C.addCard(f, '女主角', '主角');
    const e = C.makeTagEntry(c, '红衣女子', '穿和服的女人');
    check('tagEntry: 字段齐', e.cardId === c.id && e.name === '女主角' && e.orig_char_desc === '红衣女子' && e.dest_char_desc === '穿和服的女人');
    check('tagEntry: mask 缺省 null', e.mask === null);
    const e2 = C.makeTagEntry(c);
    check('tagEntry: 描述缺省空串', e2.orig_char_desc === '' && e2.dest_char_desc === '');
}

console.log('========================');
console.log('charcards: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
