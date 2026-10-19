/* SuperSplat APK —— 工程管理（pure logic + 存储适配）
 *
 * 存储布局（App 私有目录 Directory.Data，免权限）：
 *   projects/<encodeURIComponent(项目名)>/project.svproj   ← zip：state.json + model.* + props/*
 *   projects/<encodeURIComponent(项目名)>/thumb.jpg
 *   projects/<encodeURIComponent(项目名)>/meta.json
 *   localStorage['ss-registry']                            ← 轻量索引（名字/时间/有无模型）
 *
 * 为什么是自包含 zip：Android SAF 的路径授权是临时的，只存引用的话
 * 重开工程必然找不到模型（splat-viewer v0.3.x 的真实事故）。模型内嵌后
 * 打开一步到位，代价是工程文件≈模型体积。
 *
 * 为什么不用引擎原生 .ssproj：它要把整个 splat 重新序列化（splat-transform
 * 的 writer 链），移动端代价高，而且保存走 showSaveFilePicker，Android
 * WebView 没有这个 API。这里只存「快照 + 原始字节」，打开时重新走导入管线。
 */
(function () {
    'use strict';

    var PROJECTS_ROOT = 'projects';
    var REGISTRY_KEY = 'ss-registry';
    var STATE_ENTRY = 'state.json';

    /* ---------- 路径规划 ---------- */

    function dirNameFor(projectName) {
        return encodeURIComponent(projectName);
    }

    function pathsFor(projectName) {
        var dir = PROJECTS_ROOT + '/' + dirNameFor(projectName);
        return {
            dir: dir,
            proj: dir + '/project.svproj',
            thumb: dir + '/thumb.jpg',
            meta: dir + '/meta.json'
        };
    }

    /* ---------- 注册表 ---------- */

    function emptyRegistry() {
        return { projects: [] };
    }

    function upsertProject(reg, entry) {
        if (!entry || !entry.name) throw new Error('项目名无效');
        var rest = (reg.projects || []).filter(function (p) { return p.name !== entry.name; });
        return {
            projects: [{
                name: entry.name,
                updatedAt: entry.updatedAt,
                hasModel: !!entry.hasModel
            }].concat(rest)
        };
    }

    function removeProject(reg, name) {
        return { projects: (reg.projects || []).filter(function (p) { return p.name !== name; }) };
    }

    /* ---------- 校验 ---------- */

    function validateProjectName(name) {
        var n = (name || '').trim();
        if (!n) return { ok: false, reason: '项目名不能为空' };
        if (n.length > 50) return { ok: false, reason: '项目名过长（最多 50 字符）' };
        if (/[/\\:*?"<>|]/.test(n)) return { ok: false, reason: '项目名不能包含 / \\ : * ? " < > |' };
        return { ok: true, name: n };
    }

    /* ---------- 脏检查 ----------
     * 只比较「工程真正保存的东西」：人偶/道具/机位/游标/相机。
     * 数值用 1e-6 容差，浮点抖动不算改动。
     */

    function near(a, b) {
        if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
        return a === b;
    }

    function arrNear(a, b) {
        if (!a || !b) return !a && !b;
        if (a.length !== b.length) return false;
        for (var i = 0; i < a.length; i++) {
            if (!near(a[i], b[i])) return false;
        }
        return true;
    }

    function posNear(a, b) {
        if (!a || !b) return !a && !b;
        return near(a[0], b[0]) && near(a[1], b[1]) && near(a[2], b[2]);
    }

    function isDirty(current, saved) {
        if (!saved) {
            // 从未保存过：只要场景里有东西（模型/人偶/道具）就算脏
            if (!current) return false;
            if (current.model) return true;
            if (current.puppets && current.puppets.length) return true;
            if (current.props && current.props.length) return true;
            return false;
        }
        if (!current) return true;

        var cp = current.puppets || [], sp = saved.puppets || [];
        if (cp.length !== sp.length) return true;
        for (var i = 0; i < cp.length; i++) {
            var a = cp[i], b = sp[i];
            if (a.name !== b.name || a.charId !== b.charId) return true;
            if (!posNear(a.pos, b.pos)) return true;
            if (!arrNear(a.rot, b.rot) || !arrNear(a.scale, b.scale)) return true;
            if (a.tint !== b.tint || a.clip !== b.clip) return true;
            if (!!a.locked !== !!b.locked || !!a.visible !== !!b.visible) return true;
        }

        var cr = current.props || [], sr = saved.props || [];
        if (cr.length !== sr.length) return true;
        for (var j = 0; j < cr.length; j++) {
            var c = cr[j], d = sr[j];
            if (c.name !== d.name || c.file !== d.file) return true;
            if (!posNear(c.pos, d.pos)) return true;
            if (!arrNear(c.rot, d.rot) || !arrNear(c.scale, d.scale)) return true;
            if (!!c.locked !== !!d.locked || !!c.visible !== !!d.visible) return true;
        }

        var cs = current.shots || [], ss = saved.shots || [];
        if (cs.length !== ss.length) return true;
        for (var k = 0; k < cs.length; k++) {
            if (cs[k].name !== ss[k].name) return true;
            if (!posNear(cs[k].pos, ss[k].pos) || !posNear(cs[k].target, ss[k].target)) return true;
            if (!near(cs[k].fov, ss[k].fov)) return true;
        }

        var cc = current.cursor, sc = saved.cursor;
        if (!cc !== !sc) return true;
        if (cc && sc) {
            if (!posNear(cc.pos, sc.pos)) return true;
            if (!!cc.on !== !!sc.on) return true;
        }

        if (current.model && saved.model) {
            if (current.model.name !== saved.model.name) return true;
        } else if (!!current.model !== !!saved.model) {
            return true;
        }

        return false;
    }

    /* ---------- 存储适配 ----------
     * native: Capacitor Filesystem（Directory.Data，App 私有，免权限）
     * web/桌面预览: IndexedDB（跨会话持久，不污染 localStorage 配额）
     */

    function isNative() {
        var cap = window.Capacitor;
        return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
    }

    function bytesToBase64(u8) {
        var s = '';
        for (var i = 0; i < u8.length; i += 0x8000) {
            s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        }
        return btoa(s);
    }

    function base64ToBytes(b64) {
        var bin = atob(b64);
        var u8 = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return u8;
    }

    // Capacitor 的原生代理挂在 window.Capacitor.Plugins 上，由桥注入。
    // 不能用 import('@capacitor/filesystem')：本文件是普通 <script>，不是打包产物，
    // WebView 无法解析裸模块名，保存时会直接抛 "Failed to resolve module specifier"。
    function fsPlugin() {
        var cap = window.Capacitor;
        return (cap && cap.Plugins && cap.Plugins.Filesystem) || null;
    }

    var nativeStore = {
        _p: null,
        fs() {
            if (!this._p) {
                this._p = fsPlugin();
                if (!this._p) throw new Error('Filesystem 插件未就绪（原生桥未注入）');
            }
            return this._p;
        },
        async write(path, u8) {
            var b64 = bytesToBase64(u8);
            var p = this.fs();
            // 模型动辄 20MB+，base64 后更大。一次性过桥会撑爆 WebView 的
            // 消息通道（整串 30MB+ JSON），所以大文件先建空文件再分块追加。
            var CHUNK = 2 * 1024 * 1024;
            if (b64.length <= CHUNK) {
                await p.writeFile({ path: path, data: b64, directory: 'DATA', recursive: true });
                return;
            }
            await p.writeFile({ path: path, data: '', directory: 'DATA', recursive: true });
            for (var i = 0; i < b64.length; i += CHUNK) {
                await p.appendFile({
                    path: path,
                    data: b64.slice(i, i + CHUNK),
                    directory: 'DATA'
                });
            }
        },
        async read(path) {
            var r = await this.fs().readFile({ path: path, directory: 'DATA' });
            var data = r.data;
            if (typeof data !== 'string') {
                var buf = await data.arrayBuffer();
                return new Uint8Array(buf);
            }
            return base64ToBytes(data);
        },
        async remove(path) {
            try {
                await this.fs().rmdir({ path: path, directory: 'DATA', recursive: true });
            } catch (e) { /* 不存在就算了 */ }
        }
    };

    var webStore = {
        _db: null,
        _open() {
            var self = this;
            if (self._db) return Promise.resolve(self._db);
            return new Promise(function (res, rej) {
                var r = indexedDB.open('ss-store', 1);
                r.onupgradeneeded = function () { r.result.createObjectStore('files'); };
                r.onsuccess = function () { self._db = r.result; res(self._db); };
                r.onerror = function () { rej(r.error); };
            });
        },
        async write(path, u8) {
            var db = await this._open();
            return new Promise(function (res, rej) {
                var t = db.transaction('files', 'readwrite');
                t.objectStore('files').put(u8, path);
                t.oncomplete = function () { res(); };
                t.onerror = function () { rej(t.error); };
            });
        },
        async read(path) {
            var db = await this._open();
            return new Promise(function (res, rej) {
                var t = db.transaction('files', 'readonly').objectStore('files').get(path);
                t.onsuccess = function () {
                    if (!t.result) { rej(new Error('不存在: ' + path)); return; }
                    res(t.result);
                };
                t.onerror = function () { rej(t.error); };
            });
        },
        async remove(path) {
            var db = await this._open();
            // 只删这个前缀下的所有键（模拟目录删除）
            return new Promise(function (res, rej) {
                var t = db.transaction('files', 'readwrite');
                var os = t.objectStore('files');
                var req = os.openCursor();
                req.onsuccess = function () {
                    var c = req.result;
                    if (!c) return;
                    if (String(c.key).indexOf(path + '/') === 0 || c.key === path) c.delete();
                    c.continue();
                };
                t.oncomplete = function () { res(); };
                t.onerror = function () { rej(t.error); };
            });
        }
    };

    function store() {
        if (_storeImpl) return _storeImpl;
        // 原生插件没注入时退回 IndexedDB：宁可存在 WebView 里，也不要让保存
        // 直接抛错。真机上正常情况一定走 native。
        _storeImpl = (isNative() && fsPlugin()) ? nativeStore : webStore;
        if (isNative() && !fsPlugin()) {
            console.warn('[projects] Filesystem 插件未注入，回退 IndexedDB');
        }
        return _storeImpl;
    }

    var _storeImpl = null;

    /* ---------- 注册表读写 ---------- */

    function loadRegistry() {
        try {
            var raw = localStorage.getItem(REGISTRY_KEY);
            if (raw) {
                var r = JSON.parse(raw);
                if (r && Array.isArray(r.projects)) return r;
            }
        } catch (e) { /* 损坏就当空 */ }
        return emptyRegistry();
    }

    function saveRegistry(reg) {
        try { localStorage.setItem(REGISTRY_KEY, JSON.stringify(reg)); } catch (e) { /* 配额满就放弃 */ }
    }

    /* ---------- zip 往返 ---------- */

    function ffl() {
        var f = window.fflate;
        if (!f) throw new Error('fflate 未加载');
        return f;
    }

    function strToU8(s) { return ffl().strToU8(s); }
    function strFromU8(u8) { return ffl().strFromU8(u8); }

    /**
     * @param {object} state  state.json 内容（导演台快照 + model 描述）
     * @param {object} files  { 'model.ply': Uint8Array, 'props/0.glb': Uint8Array }
     */
    function buildProjectZip(state, files) {
        var entries = {};
        entries[STATE_ENTRY] = strToU8(JSON.stringify(state));
        Object.keys(files || {}).forEach(function (k) {
            if (files[k] && files[k].length) entries[k] = files[k];
        });
        // level 0：模型本身已是压缩格式，再压一遍只烧 CPU
        return ffl().zipSync(entries, { level: 0 });
    }

    function parseProjectFile(bytes) {
        var unzipped = ffl().unzipSync(bytes);
        var stateRaw = unzipped[STATE_ENTRY];
        if (!stateRaw) throw new Error('工程文件缺少 state.json');
        var state = JSON.parse(strFromU8(stateRaw));
        var files = {};
        Object.keys(unzipped).forEach(function (k) {
            if (k !== STATE_ENTRY) files[k] = unzipped[k];
        });
        return { state: state, files: files };
    }

    /* ---------- meta ---------- */

    function parseMeta(raw) {
        try {
            var m = JSON.parse(raw);
            if (m && typeof m.name === 'string') return m;
        } catch (e) { /* 忽略 */ }
        return null;
    }

    window.__projectLogic = {
        PROJECTS_ROOT: PROJECTS_ROOT,
        STATE_ENTRY: STATE_ENTRY,
        dirNameFor: dirNameFor,
        pathsFor: pathsFor,
        emptyRegistry: emptyRegistry,
        upsertProject: upsertProject,
        removeProject: removeProject,
        validateProjectName: validateProjectName,
        isDirty: isDirty,
        store: store,
        loadRegistry: loadRegistry,
        saveRegistry: saveRegistry,
        buildProjectZip: buildProjectZip,
        parseProjectFile: parseProjectFile,
        parseMeta: parseMeta,
        isNative: isNative
    };
})();
