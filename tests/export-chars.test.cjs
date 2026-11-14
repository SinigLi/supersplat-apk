/* v53 M2 —— 导出兼容单测
 * 红线1：老 marks（无 char_ref）导出与基线字节级一致。
 * 红线2：char_ref 三处挂载 + merge_prev 无段级 chars + 0-based 帧号。
 * 红线3：无 mask 字段缺省；有 mask 才输出。
 * av-store 是浏览器模块（window.__avLogic），Node 下用 globalThis.__avLogic hack：
 * 它用 localStorage —— 造一个最小 stub。
 */
'use strict';
global.localStorage = {
    _m: {},
    getItem(k) { return this._m[k] !== undefined ? this._m[k] : null; },
    setItem(k, v) { this._m[k] = String(v); },
    removeItem(k) { delete this._m[k]; }
};
global.window = global;   // av-store 是浏览器 IIFE（window.__avLogic），Node 下用 globalThis 兑当
global.window = global;   // av-store 是浏览器 IIFE（window.__avLogic），Node 下用 globalThis 兑当
require('../www/av-store.js');          // IIFE 无 module.exports，导出走 window.__avLogic
const L = global.__avLogic;

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name + ' ' + JSON.stringify(extra || '')); }
}

const meta = { fps: 25, mode: 'video', folderName: 'clip' };
const files = [
    { name: '001.mp4', label: '001', seq: 1 },
    { name: '002.mp4', label: '002', seq: 2 }
];

/* ---- 基线：split + multiframe + merge_prev（无 char_ref） ---- */
function baseMarks() {
    return { version: 1, marks: [
        { id: 'm1', type: 'split', seg: '001', at: 3.0 },
        { id: 'm2', type: 'multiframe_ref', seg: '001', frames: [10, 40] },
        { id: 'm3', type: 'merge_prev', seg: '002' },
        { id: 'm4', type: 'split', seg: '002', at: 5.2 }
    ] };
}
const baseline = L.buildExport(meta, baseMarks(), files);
const baselineStr = JSON.stringify(baseline);

check('基线: schema v3', baseline.schema === 'moyutai.marks.v3');
check('基线: 无 chars 节点', baselineStr.indexOf('"chars"') < 0);
check('基线: 002 merge_prev', baseline.marks.find(n => n.target === '002').merge_prev === true);
check('基线: points 排序 at_frame 升序', (() => {
    const p = baseline.marks.find(n => n.target === '001').points;
    return p[0].at_frame === 10 && p[1].at_frame === 40 && p[2].at_frame === 75;
})());
check('基线: split 双帧秒', baseline.marks.find(n => n.target === '001').points[2].at_seconds === 3);

/* ---- 老导出字节级不变（重复构建对比） ---- */
check('基线: 幂等（两次构建一致）', JSON.stringify(L.buildExport(meta, baseMarks(), files)) === baselineStr);

/* ---- char_ref 段首帧 → target.chars；merge_prev 跳过 ---- */
{
    const m = baseMarks();
    m.marks.push({ id: 'cr1', type: 'char_ref', seg: '001', at: 0, chars: [
        { cardId: 'c-a1', name: '女主角', orig_char_desc: '红衣女子', dest_char_desc: '穿和服的女人', mask: 'masks/001/0_c-a1.png' }
    ] });
    const out = L.buildExport(meta, m, files);
    const n1 = out.marks.find(n => n.target === '001');
    check('段级: chars 挂 target', Array.isArray(n1.chars) && n1.chars.length === 1);
    /* v69：导出字段改名 global_desc / prompt_extend（老板 2026-11-15） */
    check('段级: 字段齐', n1.chars[0].name === '女主角' && n1.chars[0].global_desc === '红衣女子' && n1.chars[0].prompt_extend === '穿和服的女人');
    check('段级: mask 输出', n1.chars[0].mask === 'masks/001/0_c-a1.png');

    const m2 = baseMarks();
    m2.marks.push({ id: 'cr2', type: 'char_ref', seg: '002', at: 0, chars: [{ cardId: 'c-x', name: '路人', orig_char_desc: '', dest_char_desc: '' }] });
    const out2 = L.buildExport(meta, m2, files);
    const n2 = out2.marks.find(n => n.target === '002');
    check('merge_prev: 段级 chars 不输出', n2.chars === undefined);
}

/* ---- char_ref 挂点级：multiframe 帧 & split 帧 ---- */
{
    const m = baseMarks();
    /* 帧 40 = 1.6s */
    m.marks.push({ id: 'cr3', type: 'char_ref', seg: '001', at: 1.6, chars: [
        { cardId: 'c-a1', name: '女主角', orig_char_desc: '', dest_char_desc: '白衣侠客' },
        { cardId: 'c-b2', name: '男配角', orig_char_desc: '站着的男人', dest_char_desc: '', mask: 'masks/001/40_c-b2.png' }
    ] });
    const out = L.buildExport(meta, m, files);
    const pts = out.marks.find(n => n.target === '001').points;
    const mf40 = pts.find(p => p.type === 'multiframe' && p.at_frame === 40);
    check('点级: multiframe@40 挂 chars', Array.isArray(mf40.chars) && mf40.chars.length === 2);
    check('点级: 无 mask 条目缺 mask 字段', !('mask' in mf40.chars[0]) && mf40.chars[1].mask === 'masks/001/40_c-b2.png');
    check('点级: 其他 point 无 chars', pts.find(p => p.type === 'multiframe' && p.at_frame === 10).chars === undefined);
}

/* ---- 无对应 point 的帧 → target.chars 带 at_frame ---- */
{
    const m = baseMarks();
    /* 帧 20 = 0.8s，无 point */
    m.marks.push({ id: 'cr4', type: 'char_ref', seg: '001', at: 0.8, chars: [{ cardId: 'c-c3', name: '路人', orig_char_desc: '', dest_char_desc: 'x' }] });
    const out = L.buildExport(meta, m, files);
    const n1 = out.marks.find(n => n.target === '001');
    const c = n1.chars && n1.chars[0];
    check('孤儿帧: 挂 target.chars + at_frame', !!c && c.at_frame === 20 && c.name === '路人');
}

/* ---- upsert/find/remove ---- */
{
    const m = { version: 1, marks: [] };
    L.upsertCharRef(m, '001', 0, [{ cardId: 'c-1', name: 'A', orig_char_desc: '', dest_char_desc: '' }]);
    L.upsertCharRef(m, '001', 0, [{ cardId: 'c-1', name: 'A2', orig_char_desc: '', dest_char_desc: '' }]);
    check('upsert: 同帧替换不新增', m.marks.length === 1 && m.marks[0].chars[0].name === 'A2');
    L.upsertCharRef(m, '001', 1.2, [{ cardId: 'c-2', name: 'B', orig_char_desc: '', dest_char_desc: '' }]);
    check('upsert: 异帧新增', m.marks.length === 2);
    check('find: 帧命中（帧精度）', !!L.findCharRefAt(m, '001', 30, 25));
    check('find: 未命中 null', L.findCharRefAt(m, '001', 99, 25) === null);
    check('remove', L.removeCharRef(m, m.marks[0].id) === true && m.marks.length === 1);
}

/* ---- loadChars/saveChars（stub localStorage） ---- */
{
    const saved = JSON.stringify({ schema: 'moyutai.charcards.v1', orig_char_descs: ['a'], dest_char_descs: [], cards: [{ id: 'c-1', name: 'X', tag: '' }] });
    localStorage.setItem('av-p1-chars', saved);
    const c = L.loadChars('p1');
    check('loadChars: 读回', c.cards.length === 1 && c.orig_char_descs[0] === 'a');
    check('loadChars: 空默认', L.loadChars('none').cards.length === 0);
    L.saveChars('p2', c);
    check('saveChars: 写入可读回', L.loadChars('p2').cards[0].name === 'X');
    let threw = false;
    try { L.saveChars('p3', { bad: 1 }); } catch (e) { threw = true; }
    check('saveChars: 非法结构抛错', threw);
}

console.log('========================');
console.log('export-chars: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
