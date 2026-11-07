/* storyboard.js 单元测试 */
const sb = require('../www/storyboard.js');
let bad = 0;
const ck = (n, ok, x) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!ok) bad++; };

/* --- parseCsv --- */
const g1 = sb.parseCsv('a,b\r\nc,d');
ck('csv 基础两行', g1.length === 2 && g1[0][0] === 'a' && g1[1][1] === 'd', g1);
const g2 = sb.parseCsv('"x,y",z\n"he said ""hi""",w');
ck('csv 引号内逗号/转义', g2[0][0] === 'x,y' && g2[1][0] === 'he said "hi"', g2);
const g3 = sb.parseCsv('a,b\n\n\n');
ck('csv 尾部空行去除', g3.length === 1, g3);

/* --- parseRefs：0-based 表格值原样保留（显示层+1） --- */
ck('refs 空', sb.parseRefs('').length === 0 && sb.parseRefs(null).length === 0);
ck('refs 10;20 → [10,20]', JSON.stringify(sb.parseRefs('10;20')) === '[10,20]');
ck('refs 全角分号/逗号/空格', JSON.stringify(sb.parseRefs(' 10； 20，15')) === '[10,15,20]');
ck('refs 排序去重', JSON.stringify(sb.parseRefs('20;10;20')) === '[10,20]');
ck('refs 非法忽略', JSON.stringify(sb.parseRefs('10;abc;-3;2.9')) === '[2,10]', sb.parseRefs('10;abc;-3;2.9'));

/* --- parseStoryboardCsv --- */
const csv1 = '\uFEFF镜号,镜头描述,多参考图\r\n1,开场,10;20\r\n2,变身,\r\n3,战斗,15\r\n';
const p1 = sb.parseStoryboardCsv(csv1);
ck('csv BOM+CRLF+描述列逗号安全', p1.ok && p1.rows.length === 3, p1);
ck('csv 行1 refs', JSON.stringify(p1.rows[0]) === '{"no":1,"refs":[10,20]}', p1.rows[0]);
ck('csv 行2 空 refs', p1.rows[1].refs.length === 0);
const p2 = sb.parseStoryboardCsv('编号,多参考图\n1,10');
ck('csv 缺镜号列报错', !p2.ok && /镜号/.test(p2.error), p2.error);
const p3 = sb.parseStoryboardCsv('镜号,备注\n1,x');
ck('csv 缺多参考图列报错', !p3.ok && /多参考图/.test(p3.error), p3.error);
const p4 = sb.parseStoryboardCsv('镜号,多参考图\nabc,10\n2,');
ck('csv 镜号非数字行忽略', p4.ok && p4.rows.length === 1 && p4.rows[0].no === 2, p4);

/* --- matchStoryboard --- */
const mk = no => ({ no, refs: no === 1 ? [10, 20] : no === 5 ? [20] : [] });
const files5 = [
    { seq: 1, name: 'clip_01.mp4' }, { seq: 2, name: 'clip_02.mp4' }, { seq: 3, name: 'clip_03.mp4' },
    { seq: 4, name: 'clip_04.mp4' }, { seq: 5, name: 'clip_05.mp4' }
];
const m1 = sb.matchStoryboard([1, 2, 3, 4, 5].map(mk), files5);
ck('match 5对5 ok', m1.ok && m1.marks.length === 2, m1);
ck('match seg1 frames', JSON.stringify(m1.marks[0]) === '{"seg":1,"frames":[10,20]}', m1.marks[0]);
ck('match seg5 frames', JSON.stringify(m1.marks[1]) === '{"seg":5,"frames":[20]}', m1.marks[1]);
const m2 = sb.matchStoryboard([1, 2, 3, 4].map(mk), files5);
ck('match 数量不一致拒绝', !m2.ok && /不一致/.test(m2.reason), m2.reason);
const m3 = sb.matchStoryboard([1, 2, 4, 5, 6].map(mk), files5);
ck('match 镜号不连续拒绝', !m3.ok && /不连续/.test(m3.reason), m3.reason);
const m4 = sb.matchStoryboard([1, 1, 2, 4, 5].map(mk), files5);
ck('match 镜号重复拒绝', !m4.ok && /重复/.test(m4.reason), m4.reason);
const m5 = sb.matchStoryboard([1, 2, 3, 4, 5].map(mk), [{ seq: null, name: 'abc.mp4' }, files5[1], files5[2], files5[3], files5[4]]);
ck('match 无标号文件拒绝', !m5.ok && /无标号/.test(m5.reason), m5.reason);
const m6 = sb.matchStoryboard([1, 2, 3, 4, 5].map(mk), files5.slice(0, 5).map((f, i) => i === 2 ? { seq: 1, name: 'dup1.mp4' } : f));
ck('match 标号重复（两文件同seq）也算ok但seg1合并？——标号重复不在校验内，仍 ok', m6.ok);

/* --- mergeIntoMarks --- */
const cur = [
    { id: 's1', type: 'split', seg: 2, at: 3, note: '' },
    { id: 'm9', type: 'multiframe_ref', seg: 1, frames: [30], note: '' }
];
const r1 = sb.mergeIntoMarks(cur, [{ seg: 1, frames: [10, 20] }, { seg: 5, frames: [20] }]);
ck('merge 保留 split', r1.some(m => m.type === 'split' && m.seg === 2));
const mg = r1.find(m => m.type === 'multiframe_ref' && m.seg === 1);
ck('merge seg1 并集排序', JSON.stringify(mg.frames) === '[10,20,30]', mg);
ck('merge 原 mark 不被改', JSON.stringify(cur[1].frames) === '[30]');
const mNew = r1.find(m => m.type === 'multiframe_ref' && m.seg === 5);
ck('merge 新增 note', mNew.note === '分镜清单', mNew);

console.log(bad === 0 ? '\n=== storyboard ALL PASS ===' : '\n=== storyboard FAIL(' + bad + ') ===');
process.exit(bad === 0 ? 0 : 1);
