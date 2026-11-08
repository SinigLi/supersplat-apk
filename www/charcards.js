/* v53 M1 —— 角色卡纯逻辑层（无 DOM，Node 可测）
 *
 * 数据模型（老板 2026-11-08 11:54 定稿，docs/CHAR-TAG.md）：
 *   cardsFile = {
 *     schema: 'moyutai.charcards.v1',
 *     orig_char_descs: [string...],   // 原角色描述默认列表（卡页可增删）
 *     dest_char_descs: [string...],   // 替换角色描述默认列表（卡页可增删）
 *     cards: [{ id, name, tag }]      // tag: 单个字符串标签
 *   }
 * 存储：av-store 侧 localStorage `av-<工程>-chars`；本模块只管结构与规则。
 * 规则（老板确认）：
 *   - 导入合并按 id 去重（同名不同 id 保留）；描述列表并集去重
 *   - 导入容错：schema 不符/缺数组 → 整文件拒收，不崩溃
 *   - 卡名非空；tag 为字符串（可空）
 */
(function (global) {
    'use strict';

    var SCHEMA = 'moyutai.charcards.v1';

    function newId() {
        var s = '';
        for (var i = 0; i < 8; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)];
        return 'c-' + s;
    }

    function emptyCards() {
        return { schema: SCHEMA, orig_char_descs: [], dest_char_descs: [], cards: [] };
    }

    function isCardsFile(o) {
        return !!o && o.schema === SCHEMA && Array.isArray(o.cards) &&
            Array.isArray(o.orig_char_descs || []) && Array.isArray(o.dest_char_descs || []);
    }

    /* 规范化：补默认数组、过滤非法卡（无 id/无 name）、字符串化 tag */
    function normalize(raw) {
        var f = emptyCards();
        if (!raw || typeof raw !== 'object') return f;
        f.orig_char_descs = (Array.isArray(raw.orig_char_descs) ? raw.orig_char_descs : [])
            .filter(function (x) { return typeof x === 'string' && x.length > 0; });
        f.dest_char_descs = (Array.isArray(raw.dest_char_descs) ? raw.dest_char_descs : [])
            .filter(function (x) { return typeof x === 'string' && x.length > 0; });
        (Array.isArray(raw.cards) ? raw.cards : []).forEach(function (c) {
            if (!c || typeof c.id !== 'string' || !c.id || typeof c.name !== 'string' || !c.name.trim()) return;
            f.cards.push({ id: c.id, name: c.name.trim(), tag: typeof c.tag === 'string' ? c.tag : '' });
        });
        return f;
    }

    function findCard(file, id) {
        for (var i = 0; i < file.cards.length; i++) if (file.cards[i].id === id) return file.cards[i];
        return null;
    }

    function addCard(file, name, tag) {
        var n = (name || '').trim();
        if (!n) throw new Error('角色名不能为空');
        file.cards.push({ id: newId(), name: n, tag: typeof tag === 'string' ? tag : '' });
        return file.cards[file.cards.length - 1];
    }

    function removeCard(file, id) {
        var before = file.cards.length;
        file.cards = file.cards.filter(function (c) { return c.id !== id; });
        return file.cards.length < before;
    }

    function renameCard(file, id, name) {
        var c = findCard(file, id);
        if (!c) throw new Error('角色不存在');
        var n = (name || '').trim();
        if (!n) throw new Error('角色名不能为空');
        c.name = n;
        return c;
    }

    function setTag(file, id, tag) {
        var c = findCard(file, id);
        if (!c) throw new Error('角色不存在');
        c.tag = typeof tag === 'string' ? tag : '';
        return c;
    }

    /* 描述列表：去重追加；删除按值 */
    function addDesc(list, val) {
        var v = (val || '').trim();
        if (!v) throw new Error('描述不能为空');
        if (list.indexOf(v) < 0) list.push(v);
        return list;
    }
    function addOrigDesc(file, val) { return addDesc(file.orig_char_descs, val); }
    function addDestDesc(file, val) { return addDesc(file.dest_char_descs, val); }
    function removeOrigDesc(file, val) { file.orig_char_descs = file.orig_char_descs.filter(function (x) { return x !== val; }); }
    function removeDestDesc(file, val) { file.dest_char_descs = file.dest_char_descs.filter(function (x) { return x !== val; }); }

    /* 导入合并：容错（非法文件拒收返回 null）；按 id 去重（同名不同 id 保留）；描述并集去重 */
    function importCards(file, rawText) {
        var raw;
        try { raw = JSON.parse(rawText); } catch (e) { return null; }
        if (!isCardsFile(raw)) return null;
        var inc = normalize(raw);
        inc.cards.forEach(function (c) {
            if (!findCard(file, c.id)) file.cards.push(c);
        });
        inc.orig_char_descs.forEach(function (d) { addDesc(file.orig_char_descs, d); });
        inc.dest_char_descs.forEach(function (d) { addDesc(file.dest_char_descs, d); });
        return file;
    }

    function exportCards(file) {
        return JSON.stringify(normalize(file), null, 2);
    }

    /* 打标条目快照（导出/写 marks 用）：name/orig/dest 可编辑，cardId 稳定引用 */
    function makeTagEntry(card, origDesc, destDesc) {
        return {
            cardId: card.id,
            name: card.name,
            orig_char_desc: typeof origDesc === 'string' ? origDesc : '',
            dest_char_desc: typeof destDesc === 'string' ? destDesc : '',
            mask: null
        };
    }

    var api = {
        SCHEMA: SCHEMA,
        emptyCards: emptyCards, isCardsFile: isCardsFile, normalize: normalize,
        findCard: findCard, addCard: addCard, removeCard: removeCard,
        renameCard: renameCard, setTag: setTag,
        addOrigDesc: addOrigDesc, addDestDesc: addDestDesc,
        removeOrigDesc: removeOrigDesc, removeDestDesc: removeDestDesc,
        importCards: importCards, exportCards: exportCards, makeTagEntry: makeTagEntry
    };
    global.__charcards = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
