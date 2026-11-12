/* ============================================================
 * cardgroups-full.js — 角色原图存储（IndexedDB）
 * v60d：localStorage 5MB 配额装不下原图 base64（debug_23 实锤），
 *       原图改存 IDB；localStorage 只留 256 头像。
 * API：
 *   CGFull.put(groupId, cardId, dataUrl)   覆盖写
 *   CGFull.get(groupId, cardId) → dataUrl | null（Promise）
 *   CGFull.all(groupId) → { cardId: dataUrl }（Promise）
 *   CGFull.delGroup(groupId)               删组时清原图
 *   CGFull.stripFull(data)                 深拷贝 data 并剥离 imgFull，返回 { slim, fulls }
 * ============================================================ */
'use strict';
(function (global) {
    var DB = 'moyutai-cg-full', STORE = 'cards', V = 1;
    var _db = null;

    function open() {
        if (_db) return Promise.resolve(_db);
        return new Promise(function (res, rej) {
            var rq = indexedDB.open(DB, V);
            rq.onupgradeneeded = function () { rq.result.createObjectStore(STORE); };
            rq.onsuccess = function () { _db = rq.result; res(_db); };
            rq.onerror = function () { rej(rq.error); };
        });
    }
    function tx(mode, fn) {
        return open().then(function (db) {
            return new Promise(function (res, rej) {
                var t = db.transaction(STORE, mode);
                var os = t.objectStore(STORE);
                var out;
                try { out = fn(os); } catch (e) { rej(e); return; }
                t.oncomplete = function () { res(out && out._r !== undefined ? out._r : out); };
                t.onerror = function () { rej(t.error); };
                t.onabort = function () { rej(t.error || new Error('idb abort')); };
            });
        });
    }

    var CGFull = {
        put: function (groupId, cardId, dataUrl) {
            return tx('readwrite', function (os) {
                os.put({ dataUrl: dataUrl, ts: Date.now() }, groupId + '::' + cardId);
            });
        },
        get: function (groupId, cardId) {
            return tx('readonly', function (os) {
                var rq = os.get(groupId + '::' + cardId);
                var holder = { _r: null };
                rq.onsuccess = function () { holder._r = rq.result ? rq.result.dataUrl : null; };
                return holder;
            });
        },
        all: function (groupId) {
            return tx('readonly', function (os) {
                var range = IDBKeyRange.bound(groupId + '::', groupId + '::\uffff');
                var out = {};
                var cursor = { _r: null };
                var rq = os.openCursor(range);
                rq.onsuccess = function () {
                    var c = rq.result;
                    if (!c) { cursor._r = out; return; }
                    var cardId = String(c.key).split('::')[1];
                    out[cardId] = c.value && c.value.dataUrl;
                    c.continue();
                };
                return cursor;
            });
        },
        delGroup: function (groupId) {
            return tx('readwrite', function (os) {
                var range = IDBKeyRange.bound(groupId + '::', groupId + '::\uffff');
                os.delete(range);
            });
        },
        /* 深拷贝 + 剥离 imgFull（收集 fulls 供批量 put） */
        stripFull: function (data) {
            var slim = JSON.parse(JSON.stringify(data));
            var fulls = [];
            (slim.cards || []).forEach(function (c) {
                if (c.imgFull) { fulls.push({ cardId: c.id, dataUrl: c.imgFull }); delete c.imgFull; }
            });
            return { slim: slim, fulls: fulls };
        }
    };

    global.CGFull = CGFull;
})(typeof window !== 'undefined' ? window : this);
