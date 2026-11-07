/* img-ops 纯逻辑单测（node 直跑，不进浏览器）
 * 覆盖：五种 op 的 do/undo/redo 往返、v1→v2 迁移、最后一层保护、
 *       可见层过滤、文件名消毒与重名。 */
const OPS = require('../www/img-ops.js');

let bad = 0;
const ck = (n, ok, x) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!ok) bad++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stroke = (n) => ({ type: 'brush', size: n || 24, points: [[10, 10], [20, 20]] });

/* ---- 迁移 ---- */
(() => {
    const v2 = OPS.migrateV1({ schema: 'moyutai.imgmask.v1', strokes: [stroke(), stroke(30)] });
    ck('v1→v2 迁移保留笔画', v2.layers.length === 1 && v2.layers[0].strokes.length === 2);
    ck('迁移后 schema 升级', v2.schema === 'moyutai.imgmask.v2');
    ck('迁移层名默认「遮罩 1」', v2.layers[0].name === '遮罩 1');
    ck('坏 schema 迁移返回 null', OPS.migrateV1({ schema: 'x' }) === null);
    ck('v1 数据本身不被改动', eq(OPS.migrateV1({ schema: 'moyutai.imgmask.v1', strokes: [stroke()] }) !== null, true));
})();

/* ---- stroke / unstroke 往返 ---- */
(() => {
    const s = OPS.emptyState();
    const op = { kind: 'stroke', layerId: 'L1', stroke: stroke(42) };
    ck('stroke 生效', OPS.applyOp(s, op) === true && s.layers[0].strokes.length === 1);
    ck('stroke 激活所在层', s.activeId === 'L1');
    const popped = OPS.applyUnStroke(s, 'L1');            // undo
    ck('undo 弹出该笔画', popped && popped.size === 42 && s.layers[0].strokes.length === 0);
    s.layers[0].strokes.push(popped);                      // redo
    ck('redo 恢复', s.layers[0].strokes.length === 1 && s.layers[0].strokes[0].size === 42);
    ck('stroke 到不存在的层失败', OPS.applyOp(s, { kind: 'stroke', layerId: 'NOPE', stroke: stroke() }) === false);
})();

/* ---- addLayer / delLayer 往返 ---- */
(() => {
    const s = OPS.emptyState();
    const layer = { id: 'L2', name: '遮罩 2', visible: true, strokes: [] };
    const add = { kind: 'addLayer', layer, at: 1 };
    ck('加层生效', OPS.applyOp(s, add) === true && s.layers.length === 2 && s.activeId === 'L2');
    const del = OPS.makeDelLayer(s, 'L2');
    ck('delLayer 快照层对象', del && del.layer.id === 'L2');
    ck('删层生效', OPS.applyOp(s, del) === true && s.layers.length === 1);
    ck('删激活层后回落到剩余层', s.activeId === 'L1');
    ck('addLayer 重复 id 拒绝', OPS.applyOp(s, { kind: 'addLayer', layer: { id: 'L1', name: 'x', visible: true, strokes: [] } }) === false);
    const inv = OPS.invertOp(del);                          // undo del = add 回来
    ck('delLayer 求逆是 addLayer', inv.kind === 'addLayer' && inv.at === del.index);
    ck('逆 op 插回原位', OPS.applyOp(s, inv) === true && s.layers.length === 2 && s.layers[1].id === 'L2');
    const del2 = OPS.makeDelLayer(s, 'L2');
    OPS.applyOp(s, del2);
    ck('最后一层不许删', (() => {
        const t = OPS.emptyState();
        return OPS.makeDelLayer(t, 'L1') === null;
    })());
})();

/* ---- renameLayer 往返 ---- */
(() => {
    const s = OPS.emptyState();
    const op = { kind: 'renameLayer', layerId: 'L1', name: '头发' };
    ck('改名生效', OPS.applyOp(s, op) === true && s.layers[0].name === '头发');
    const inv = OPS.invertOp(op);
    ck('改名求逆带旧名', inv.name === '遮罩 1');
    OPS.applyOp(s, inv);
    ck('逆 op 改回', s.layers[0].name === '遮罩 1');
    ck('改名不存在的层失败', OPS.applyOp(s, { kind: 'renameLayer', layerId: 'NOPE', name: 'x' }) === false);
})();

/* ---- toggleVisible 往返 ---- */
(() => {
    const s = OPS.emptyState();
    const op = { kind: 'toggleVisible', layerId: 'L1' };
    OPS.applyOp(s, op);
    ck('翻转显隐 false', s.layers[0].visible === false);
    const inv = OPS.invertOp(op);
    OPS.applyOp(s, inv);
    ck('求逆恢复 true', s.layers[0].visible === true);
    ck('显式值生效', OPS.applyOp(s, { kind: 'toggleVisible', layerId: 'L1', visible: false }) === true && s.layers[0].visible === false);
})();

/* ---- 多 op 复合往返（模拟真实编辑序列） ---- */
(() => {
    const s = OPS.emptyState();
    const done = [], undone = [];
    const doOp = (op) => { if (OPS.applyOp(s, op)) done.push(op); };
    doOp({ kind: 'stroke', layerId: 'L1', stroke: stroke(1) });
    doOp({ kind: 'addLayer', layer: { id: 'L2', name: '遮罩 2', visible: true, strokes: [] }, at: 1 });
    doOp({ kind: 'stroke', layerId: 'L2', stroke: stroke(2) });
    doOp({ kind: 'renameLayer', layerId: 'L2', name: '天空' });
    doOp({ kind: 'toggleVisible', layerId: 'L1' });
    // 全部撤销
    while (done.length) {
        const op = done.pop();
        if (op.kind === 'stroke') { OPS.applyUnStroke(s, op.layerId); }
        else { const inv = OPS.invertOp(op); if (inv) OPS.applyOp(s, inv); }
        undone.push(op);
    }
    ck('全撤销后回到空单层', s.layers.length === 1 && s.layers[0].strokes.length === 0 && s.layers[0].name === '遮罩 1' && s.layers[0].visible === true);
    // 全部重做
    while (undone.length) {
        const op = undone.pop();
        if (op.kind === 'stroke') { s.layers.find(l => l.id === op.layerId).strokes.push(op.stroke); }
        else { OPS.applyOp(s, op); }
        done.push(op);
    }
    ck('全重做后状态一致', s.layers.length === 2 && s.layers[1].name === '天空' && s.layers[0].visible === false && s.layers[1].strokes.length === 1);
})();

/* ---- clearLayer / restoreLayer 往返 ---- */
(() => {
    const s = OPS.emptyState();
    OPS.applyOp(s, { kind: 'stroke', layerId: 'L1', stroke: stroke(7) });
    OPS.applyOp(s, { kind: 'stroke', layerId: 'L1', stroke: stroke(8) });
    const op = { kind: 'clearLayer', layerId: 'L1' };
    ck('清空层生效', OPS.applyOp(s, op) === true && s.layers[0].strokes.length === 0);
    ck('空层再清不入栈', OPS.applyOp(s, { kind: 'clearLayer', layerId: 'L1' }) === false);
    const inv = OPS.invertOp(op);
    ck('清空求逆是 restoreLayer', inv.kind === 'restoreLayer');
    OPS.applyOp(s, inv);
    ck('恢复后笔画数量一致', s.layers[0].strokes.length === 2 && s.layers[0].strokes[1].size === 8);
    const inv2 = OPS.invertOp(inv);
    OPS.applyOp(s, inv2);
    ck('restore 再求逆又清空', s.layers[0].strokes.length === 0);
})();

/* ---- 可见层过滤 / 文件名 ---- */
(() => {
    const s = OPS.emptyState();
    OPS.applyOp(s, { kind: 'addLayer', layer: { id: 'L2', name: '隐藏层', visible: false, strokes: [] } });
    ck('visibleLayers 只留可见', OPS.visibleLayers(s).length === 1 && OPS.visibleLayers(s)[0].id === 'L1');
    const taken = [];
    ck('消毒替换非法字符', OPS.sanitizeName('a/b:c*d', taken) === 'a_b_c_d');
    ck('空名兜底', OPS.sanitizeName('', taken) === '层');
    ck('重名追加序号', OPS.sanitizeName('层', taken) === '层 2' && OPS.sanitizeName('层', taken) === '层 3');
})();

console.log(bad === 0 ? '\n=== img-ops ALL PASS ===' : '\n=== img-ops FAIL(' + bad + ') ===');
process.exit(bad === 0 ? 0 : 1);
