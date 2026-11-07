/* v52 工程列表分组管理 —— 纯逻辑层（无 DOM，Node 可测）
 *
 * 数据模型（向后兼容）：
 *   registry = {
 *     projects: [{ name, mode, updatedAt, hasModel, group? }],  // group: 分组id，''/'根' 缺省=根层
 *     groups?:  [{ id, name, parent }]                          // parent: 父分组id，'' = 根层
 *   }
 * 老板确认的规则：
 *   - 新建分组：当前路径下创建，选中的节点放进新分组
 *   - 移动到分组：弹目标路径选择，移动选中节点
 *   - 同一路径下不允许重复节点（分组同名冲突；工程名全局唯一由上层保证）
 */
(function (global) {
    'use strict';

    function newId() {
        return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    /* ---------- 读改写 ---------- */

    /* 取 groups 数组（不存在则初始化为空数组，不写回——由调用方 save） */
    function groupsOf(reg) {
        if (!reg || typeof reg !== 'object') return [];
        if (!Array.isArray(reg.groups)) reg.groups = [];
        return reg.groups;
    }

    function findGroup(reg, id) {
        return groupsOf(reg).find(function (g) { return g.id === id; }) || null;
    }

    /* 分组显示路径：根/动画/战斗 → 数组 [{id,name}...] */
    function pathOf(reg, id) {
        var chain = [];
        var guard = 0;
        while (id && guard++ < 50) {
            var g = findGroup(reg, id);
            if (!g) break;
            chain.unshift(g);
            id = g.parent || '';
        }
        return chain;
    }

    function pathText(reg, id) {
        var chain = pathOf(reg, id);
        return chain.length ? chain.map(function (g) { return g.name; }).join(' / ') : '根目录';
    }

    /* parent 下同名分组是否已存在（大小写敏感，含自身排除 excludeId） */
    function groupNameTaken(reg, parent, name, excludeId) {
        return groupsOf(reg).some(function (g) {
            return (g.parent || '') === (parent || '') && g.name === name && g.id !== excludeId;
        });
    }

    /* 当前路径直接子分组 */
    function groupsIn(reg, parent) {
        return groupsOf(reg).filter(function (g) { return (g.parent || '') === (parent || ''); });
    }

    /* 当前路径直接工程 */
    function projectsIn(reg, parent) {
        return (reg.projects || []).filter(function (p) { return (p.group || '') === (parent || ''); });
    }

    /* 新建分组：返回 {ok, id} 或 {ok:false, reason} */
    function createGroup(reg, name, parent) {
        var n = String(name || '').trim();
        if (!n) return { ok: false, reason: '分组名不能为空' };
        if (n.length > 50) return { ok: false, reason: '分组名过长（最多 50 字符）' };
        if (/[/\\:*?"<>|]/.test(n)) return { ok: false, reason: '分组名不能包含 / \\ : * ? " < > |' };
        if (groupNameTaken(reg, parent, n)) return { ok: false, reason: '当前路径已有同名分组「' + n + '」' };
        /* 工程名与分组名同层也不允许撞（避免列表里两种节点重名歧义） */
        var clash = projectsIn(reg, parent).some(function (p) { return p.name === n; });
        if (clash) return { ok: false, reason: '当前路径已有同名工程「' + n + '」' };
        var id = newId();
        groupsOf(reg).push({ id: id, name: n, parent: parent || '' });
        return { ok: true, id: id };
    }

    /* 祖先检测：maybeChildId 是否在 ancestorId 的子树里（自身也算） */
    function isDescendantOrSelf(reg, maybeChildId, ancestorId) {
        var id = maybeChildId;
        var guard = 0;
        while (id && guard++ < 50) {
            if (id === ancestorId) return true;
            var g = findGroup(reg, id);
            if (!g) return false;
            id = g.parent || '';
        }
        return false;
    }

    /* 校验一批节点移动到 target：返回 {ok, reason?}
     * nodes: [{type:'group', id} | {type:'project', name}] */
    function validateMove(reg, nodes, target) {
        target = target || '';
        if (!nodes.length) return { ok: false, reason: '未选择任何节点' };
        for (var i = 0; i < nodes.length; i++) {
            var nd = nodes[i];
            if (nd.type === 'group') {
                var g = findGroup(reg, nd.id);
                if (!g) return { ok: false, reason: '分组不存在（可能已被删除）' };
                if (g.id === target) return { ok: false, reason: '「' + g.name + '」已在目标位置' };
                if (target && isDescendantOrSelf(reg, target, nd.id)) {
                    return { ok: false, reason: '不能移动到自己的子分组里' };
                }
                if (groupNameTaken(reg, target, g.name, g.id)) {
                    return { ok: false, reason: '目标路径已有同名分组「' + g.name + '」' };
                }
            } else if (nd.type === 'project') {
                var p = (reg.projects || []).find(function (x) { return x.name === nd.name; });
                if (!p) return { ok: false, reason: '工程「' + nd.name + '」不存在' };
                if ((p.group || '') === target) return { ok: false, reason: '「' + nd.name + '」已在目标位置' };
            }
        }
        /* 同批内分组重名互斥（都移到同一目标下时同名分组撞车） */
        var seen = {};
        for (var j = 0; j < nodes.length; j++) {
            if (nodes[j].type !== 'group') continue;
            var gg = findGroup(reg, nodes[j].id);
            if (gg) {
                if (seen[gg.name]) return { ok: false, reason: '选中了两个同名分组「' + gg.name + '」' };
                seen[gg.name] = true;
            }
        }
        return { ok: true };
    }

    /* 执行移动：假定已 validateMove；原地修改 reg 并返回它 */
    function moveNodes(reg, nodes, target) {
        target = target || '';
        nodes.forEach(function (nd) {
            if (nd.type === 'group') {
                var g = findGroup(reg, nd.id);
                if (g) g.parent = target;
            } else {
                var p = (reg.projects || []).find(function (x) { return x.name === nd.name; });
                if (p) p.group = target;
            }
        });
        return reg;
    }

    /* 把节点放进一个新建分组（新建分组按钮的核心动作）
     * 返回 {ok, id} 或 {ok:false, reason}；已原改 reg */
    function createGroupWithNodes(reg, name, parent, nodes) {
        var made = createGroup(reg, name, parent);
        if (!made.ok) return made;
        if (nodes && nodes.length) {
            var chk = validateMove(reg, nodes, made.id);
            if (!chk.ok) {
                /* 回滚新分组 */
                var gs = groupsOf(reg);
                var idx = gs.findIndex(function (g) { return g.id === made.id; });
                if (idx >= 0) gs.splice(idx, 1);
                return chk;
            }
            moveNodes(reg, nodes, made.id);
        }
        return made;
    }

    var api = { newId: newId, groupsOf: groupsOf, findGroup: findGroup, pathOf: pathOf, pathText: pathText, groupNameTaken: groupNameTaken, groupsIn: groupsIn, projectsIn: projectsIn, createGroup: createGroup, isDescendantOrSelf: isDescendantOrSelf, validateMove: validateMove, moveNodes: moveNodes, createGroupWithNodes: createGroupWithNodes };
    global.__groups = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
