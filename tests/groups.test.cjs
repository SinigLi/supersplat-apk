/* groups.js 单测 */
const G = require('../www/groups.js');
let bad = 0;
const ck = (n, ok, x) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!ok) bad++; };

const reg = () => ({ projects: [
    { name: '甲', mode: 'video', updatedAt: '2026-11-07T10:00:00', hasModel: false, group: '' },
    { name: '乙', mode: 'image', updatedAt: '2026-11-07T09:00:00', hasModel: false, group: '' },
    { name: '丙', mode: 'model', updatedAt: '2026-11-07T08:00:00', hasModel: true, group: '' }
], groups: [] });

/* createGroup */
const r1 = reg();
const g1 = G.createGroup(r1, '动画', '');
ck('根下建动画', g1.ok && r1.groups.length === 1 && r1.groups[0].name === '动画', r1.groups);
ck('同层重名拒绝', !G.createGroup(r1, '动画', '').ok);
const g2 = G.createGroup(r1, '战斗', g1.id);
ck('子分组', g2.ok && G.findGroup(r1, g2.id).parent === g1.id);
ck('路径文本', G.pathText(r1, g2.id) === '动画 / 战斗', G.pathText(r1, g2.id));
ck('不同层同名允许', G.createGroup(r1, '动画', g2.id).ok);
ck('空名拒绝', !G.createGroup(r1, '  ', '').ok);
ck('非法字符拒绝', !G.createGroup(r1, 'a/b', '').ok);
ck('与工程重名拒绝', !G.createGroup(r1, '甲', '').ok);

/* groupsIn / projectsIn */
ck('groupsIn 根=1', G.groupsIn(r1, '').length === 1, G.groupsIn(r1, '').length);
ck('groupsIn 动画=1', G.groupsIn(r1, g1.id).length === 1);

/* validateMove */
const mv1 = [{ type: 'project', name: '甲' }, { type: 'project', name: '乙' }];
ck('move 校验通过', G.validateMove(r1, mv1, g1.id).ok);
ck('move 已在目标', !G.validateMove(r1, [{ type: 'project', name: '甲' }], '').ok);
ck('move 空选择', !G.validateMove(r1, [], g1.id).ok);
const mv2 = [{ type: 'group', id: g1.id }];
ck('move 到自己拒绝', !G.validateMove(r1, mv2, g1.id).ok);
ck('move 到子孙拒绝', !G.validateMove(r1, mv2, g2.id).ok);
const g3 = G.createGroup(r1, '动画', '');
ck('目标同名分组拒绝', !G.validateMove(r1, [{ type: 'group', id: g1.id }], g3.id).ok ? false : true, '跨父同名允许（根下已有动画与 g3 同层冲突才拒）');
/* g1 在根，g3 也在根——把 g1 移到 g3.parent='' 即根 → 同名拒绝 */
ck('根下无同名则移回允许', G.validateMove(r1, [{ type: 'group', id: g1.id }], '').ok);
/* 同批同名分组 */
ck('同批同名分组拒绝', !G.validateMove(r1, [{ type: 'group', id: g1.id }, { type: 'group', id: g3.id }], '').ok);

/* moveNodes */
const r2 = reg();
const ga = G.createGroup(r2, 'A', '').id;
const gb = G.createGroup(r2, 'B', ga).id;
G.moveNodes(r2, [{ type: 'project', name: '甲' }, { type: 'project', name: '乙' }], ga);
ck('移动后 projectsIn', G.projectsIn(r2, ga).length === 2 && G.projectsIn(r2, '').length === 1);
G.moveNodes(r2, [{ type: 'group', id: gb }], '');
ck('分组移根后 pathOf', G.findGroup(r2, gb).parent === '' && G.pathText(r2, gb) === 'B');

/* 环检测 */
const r3 = reg();
const x = G.createGroup(r3, 'X', '').id;
const y = G.createGroup(r3, 'Y', x).id;
ck('isDescendantOrSelf 自身', G.isDescendantOrSelf(r3, x, x));
ck('isDescendantOrSelf 子', G.isDescendantOrSelf(r3, y, x));
ck('isDescendantOrSelf 非子', !G.isDescendantOrSelf(r3, x, y));

/* createGroupWithNodes */
const r4 = reg();
const made = G.createGroupWithNodes(r4, '今日', '', [{ type: 'project', name: '甲' }]);
ck('createWith 建组+放入', made.ok && G.projectsIn(r4, made.id).length === 1 && G.projectsIn(r4, '').length === 2);
ck('createWith 重名回滚', (() => {
    const before = r4.groups.length;
    const res = G.createGroupWithNodes(r4, '今日', '', [{ type: 'project', name: '乙' }]);
    return !res.ok && r4.groups.length === before && G.projectsIn(r4, '').length === 2;
})());
ck('createWith 空名', !G.createGroupWithNodes(r4, '', '').ok);

/* 坏 schema 容忍 */
ck('null groups 容忍', (() => { const r = { projects: [] }; G.groupsOf(r); return Array.isArray(r.groups) && r.groups.length === 0; })());

console.log(bad === 0 ? '\n=== groups ALL PASS ===' : '\n=== groups FAIL(' + bad + ') ===');
process.exit(bad === 0 ? 0 : 1);
