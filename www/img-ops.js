/* v50 img-ops.js — 图层操作纯逻辑（可 node 单测，无 DOM 依赖）
 *
 * 撤销模型：所有编辑动作都是 op，applyOp(state, op) 就地应用，
 * invertOp(op) 返回反向 op。undo = 栈顶 op 取逆再应用，redo 同理。
 * 之所以不再用 v49 的「数组 pop/push」：分层后操作有五种
 * （笔画/加层/删层/改名/显隐），pop/push 表达不了「删层再撤销」。
 *
 * UMD：浏览器挂 window.__imgOps，node 用 require 直接拿（module.exports）。
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.__imgOps = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var SCHEMA = 'moyutai.imgmask.v2';

    function emptyState() {
        return {
            schema: SCHEMA,
            layers: [{ id: 'L1', name: '遮罩 1', visible: true, strokes: [] }],
            activeId: 'L1'
        };
    }

    /* ---------- v1 → v2 迁移（纯函数，老工程无损） ---------- */

    function migrateV1(old) {
        if (!old || old.schema !== 'moyutai.imgmask.v1' || !Array.isArray(old.strokes)) return null;
        var st = emptyState();
        st.layers[0].strokes = old.strokes.map(function (s) {
            return { type: s.type, size: s.size, points: s.points };
        });
        return st;
    }

    function isV2(s) {
        return !!s && s.schema === SCHEMA && Array.isArray(s.layers) && s.layers.length > 0;
    }

    /* ---------- 查找 ---------- */

    function layerById(state, id) {
        for (var i = 0; i < state.layers.length; i++) if (state.layers[i].id === id) return state.layers[i];
        return null;
    }

    function activeLayer(state) {
        return layerById(state, state.activeId) || state.layers[0] || null;
    }

    function newId(state) {
        var n = state.layers.length + 1, id;
        do { id = 'L' + n++; } while (layerById(state, id));
        return id;
    }

    /* ---------- op 应用（就地修改 state，返回是否生效） ----------
     * op 结构都带逆信息（oldName/oldVisible/index+layer 等），
     * invertOp 才能不查状态直接生成反向 op。 */

    function applyOp(state, op) {
        if (!op || !op.kind) return false;
        switch (op.kind) {

        case 'stroke': {
            var lay = layerById(state, op.layerId);
            if (!lay) return false;
            lay.strokes.push(op.stroke);
            state.activeId = op.layerId;
            return true;
        }

        case 'addLayer': {
            if (state.layers.some(function (l) { return l.id === op.layer.id; })) return false;
            var idx = (op.at === undefined) ? state.layers.length : Math.max(0, Math.min(op.at, state.layers.length));
            state.layers.splice(idx, 0, op.layer);
            state.activeId = op.layer.id;
            return true;
        }

        case 'delLayer': {
            var i = state.layers.findIndex(function (l) { return l.id === op.layerId; });
            if (i < 0) return false;
            if (state.layers.length === 1 && !op.allowEmpty) return false;   /* v60f: tagMode may empty all */   // 最后一层不许删
            if (!op.layer) op.layer = JSON.parse(JSON.stringify(state.layers[i])); // 快照供逆 op 原样插回
            op.index = i;
            state.layers.splice(i, 1);
            if (state.activeId === op.layerId) {
                /* v60f：0 层时 activeId=null（打标模式删光 = 无激活层，确认即清除打标） */
                state.activeId = state.layers.length ? state.layers[Math.min(i, state.layers.length - 1)].id : null;
            }
            return true;
        }

        case 'renameLayer': {
            var r = layerById(state, op.layerId);
            if (!r) return false;
            op.oldName = r.name;                            // 逆 op 需要
            r.name = op.name;
            return true;
        }

        case 'toggleVisible': {
            var t = layerById(state, op.layerId);
            if (!t) return false;
            op.oldVisible = t.visible;                      // 逆 op 需要
            t.visible = (op.visible === undefined) ? !t.visible : op.visible;
            return true;
        }

        case 'clearLayer': {
            var c = layerById(state, op.layerId);
            if (!c) return false;
            if (!c.strokes.length) return false;            // 空层没得清，不入撤销栈
            op.old = JSON.parse(JSON.stringify(c.strokes)); // 快照供逆 op 恢复
            c.strokes = [];
            return true;
        }

        case 'restoreLayer': {
            var c2 = layerById(state, op.layerId);
            if (!c2) return false;
            if (!Array.isArray(op.strokes)) return false;
            c2.strokes = JSON.parse(JSON.stringify(op.strokes));
            return true;
        }

        default:
            return false;
        }
    }

    /* 构造 op 的入口：delLayer 在应用时才拿到层对象（逆 op 要原样插回），
     * 所以提供 makeDelLayer 在「应用前」快照。 */
    function makeDelLayer(state, layerId, opts) {
        var i = state.layers.findIndex(function (l) { return l.id === layerId; });
        /* v60f：opts.allowEmpty（打标模式）允许删光到 0 层；普通图片模式仍至少保留一层 */
        if (i < 0 || (state.layers.length <= 1 && !(opts && opts.allowEmpty))) return null;
        return { kind: 'delLayer', layerId: layerId, index: i, layer: JSON.parse(JSON.stringify(state.layers[i])), allowEmpty: !!(opts && opts.allowEmpty) };
    }

    function invertOp(op) {
        switch (op.kind) {
        case 'stroke':        return { kind: 'unstroke', layerId: op.layerId };
        case 'addLayer':      return { kind: 'delLayer', layerId: op.layer.id, index: op.at, layer: op.layer };
        case 'delLayer':      return { kind: 'addLayer', layer: op.layer, at: op.index };
        case 'renameLayer':   return { kind: 'renameLayer', layerId: op.layerId, name: op.oldName, oldName: op.name };
        case 'toggleVisible': return { kind: 'toggleVisible', layerId: op.layerId, visible: op.oldVisible };
        case 'clearLayer':    return { kind: 'restoreLayer', layerId: op.layerId, strokes: op.old };
        case 'restoreLayer':  return { kind: 'clearLayer', layerId: op.layerId };
        case 'unstroke':      return null;   // unstroke 的逆需要弹出层对象，直接查状态生成
        default:              return null;
        }
    }

    /* unstroke 的逆：撤销「撤销笔画」时需要恢复被弹出的笔画。
     * applyUnStroke 返回被弹出的笔画，供 redo 压回。 */
    function applyUnStroke(state, layerId) {
        var lay = layerById(state, layerId);
        if (!lay || !lay.strokes.length) return null;
        return lay.strokes.pop();
    }

    /* ---------- 导出辅助（纯函数） ---------- */

    function visibleLayers(state) {
        return state.layers.filter(function (l) { return l.visible; });
    }

    /* 文件名消毒 + 重名消解 */
    function sanitizeName(name, taken) {
        var s = String(name || '').replace(/[\\/:*?"<>|]/g, '_').trim() || '层';
        var base = s, n = 2;
        while (taken.indexOf(s) >= 0) s = base + ' ' + (n++);
        taken.push(s);
        return s;
    }

    return {
        SCHEMA: SCHEMA,
        emptyState: emptyState,
        migrateV1: migrateV1,
        isV2: isV2,
        layerById: layerById,
        activeLayer: activeLayer,
        newId: newId,
        applyOp: applyOp,
        makeDelLayer: makeDelLayer,
        invertOp: invertOp,
        applyUnStroke: applyUnStroke,
        visibleLayers: visibleLayers,
        sanitizeName: sanitizeName
    };
});
