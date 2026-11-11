/* v58 M1：charcards.js 升级为多套卡组管理
 *
 * 新增 API（保留既有单卡组纯逻辑函数不动）：
 *  - CCG.list()          → [{id, name, data}] 全局卡组列表
 *  - CCG.get(id)         → 卡组 data（charcards.v1 结构）或 null
 *  - CCG.create(name)    → 新建空卡组，返回 {id}
 *  - CCG.rename(id,name)
 *  - CCG.remove(id)      → 删除卡组（不可删除被引用的？由调用方保证，这里只删）
 *  - CCG.saveData(id, data) → 覆写卡组内容（校验 schema）
 *  - CCG.importPack(name, data) → 导入 json 成新卡组
 *  - CCG.fromProject(name, data) → 从工程数据建组（迁移用，幂等按 name 查重）
 *
 * 存储：localStorage 'moyutai-cardgroups-v1' =
 *   { schema:'moyutai.cardgroups.v1', groups:[{id,name,data}] }
 * id：'cg'+时间戳36。
 *
 * 迁移（av-ui 启动时调 CCG.migrateIfNeeded(projectNames)）：
 *   遍历 localStorage 所有 'av-<工程>-chars' 键 → 每个工程建一套组（名 = 工程名），
 *   幂等：同名组已存在则跳过。工程侧引用由 av-store 另行处理。
 */
'use strict';
(function (global) {
    var SCHEMA = 'moyutai.cardgroups.v1';
    var KEY = 'moyutai-cardgroups-v1';

    function _raw() {
        try {
            var o = JSON.parse(localStorage.getItem(KEY) || 'null');
            if (o && o.schema === SCHEMA && Array.isArray(o.groups)) return o;
        } catch (e) { /* fallthrough */ }
        return { schema: SCHEMA, groups: [] };
    }
    function _write(o) { localStorage.setItem(KEY, JSON.stringify(o)); }

    function validData(d) {
        return d && d.schema === 'moyutai.charcards.v1' && Array.isArray(d.cards);
    }

    var CCG = {
        SCHEMA: SCHEMA,
        list: function () { return _raw().groups.slice(); },
        get: function (id) {
            var g = _raw().groups.filter(function (x) { return x.id === id; })[0];
            return g ? g.data : null;
        },
        nameOf: function (id) {
            var g = _raw().groups.filter(function (x) { return x.id === id; })[0];
            return g ? g.name : null;
        },
        findByName: function (name) {
            return _raw().groups.filter(function (x) { return x.name === name; })[0] || null;
        },
        create: function (name) {
            var o = _raw();
            if (o.groups.some(function (x) { return x.name === name; })) return null;
            var g = { id: 'cg' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), name: String(name), data: { schema: 'moyutai.charcards.v1', orig_char_descs: [], dest_char_descs: [], cards: [] } };
            o.groups.push(g); _write(o);
            return { id: g.id };
        },
        rename: function (id, name) {
            var o = _raw();
            if (o.groups.some(function (x) { return x.id !== id && x.name === name; })) return false;
            var g = o.groups.filter(function (x) { return x.id === id; })[0];
            if (!g) return false;
            g.name = String(name); _write(o); return true;
        },
        remove: function (id) {
            var o = _raw();
            var before = o.groups.length;
            o.groups = o.groups.filter(function (x) { return x.id !== id; });
            if (o.groups.length === before) return false;
            _write(o); return true;
        },
        saveData: function (id, data) {
            if (!validData(data)) return false;
            var o = _raw();
            var g = o.groups.filter(function (x) { return x.id === id; })[0];
            if (!g) return false;
            g.data = data; _write(o); return true;
        },
        importPack: function (name, data) {
            if (!validData(data)) return null;
            var exist = CCG.findByName(name);
            if (exist) { CCG.saveData(exist.id, data); return { id: exist.id, existed: true }; }
            var r = CCG.create(name);
            if (!r) return null;
            CCG.saveData(r.id, data);
            return { id: r.id };
        },
        fromProject: function (name, data) {
            /* 迁移入口：幂等（同名组存在即跳过） */
            var exist = CCG.findByName(name);
            if (exist) return { id: exist.id, existed: true };
            if (!validData(data)) return null;
            return CCG.importPack(name, data);
        },
        /* 迁移：扫描所有 av-<工程>-chars → 建组；返回新建组数 */
        migrateIfNeeded: function () {
            var created = 0, seen = [];
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                var m = /^av-(.+)-chars$/.exec(k || '');
                if (!m) continue;
                var proj = m[1];
                if (seen.indexOf(proj) >= 0) continue;
                seen.push(proj);
                try {
                    var data = JSON.parse(localStorage.getItem(k));
                    if (!validData(data)) continue;
                    var r = CCG.fromProject(proj, data);
                    if (r && !r.existed) created++;
                } catch (e) { /* 单工程坏数据跳过 */ }
            }
            return created;
        }
    };

    global.CCG = CCG;
})(typeof window !== 'undefined' ? window : this);
