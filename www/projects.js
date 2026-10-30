/* SuperSplat APK —— 工程管理（pure logic + 存储适配）
 *
 * 存储布局 v29（App 私有目录 Directory.Data，免权限）：
 *   projects/<名>/project.json          ← 纯状态（几 KB），保存/打开都只动它
 *   projects/<名>/files/<sha1>.<ext>    ← 模型/道具原始字节，按内容寻址
 *   projects/<名>/thumb.jpg
 *   projects/<名>/meta.json
 *   localStorage['ss-registry']         ← 轻量索引（名字/时间/有无模型）
 *
 * v29 改了什么（为什么）：v28 的自包含 zip（state.json + 全部模型内嵌）
 * 在真机上被 86MB 的 GLB 顶爆——打开时 readFile 一次性把整个 zip 读成
 * base64（膨胀 4/3），一个 173MB 的工程要 230MB 连续堆内存，直接 OOM。
 * 而且 zip 里每个道具各存一份完整字节，同一个模型放两个就是两份。
 *
 * v29 的三个对策：
 *   1. 状态与字节分离：打开工程先只读几 KB 的 project.json，模型按需逐个读
 *   2. 内容寻址：字节按 SHA-1 落盘，两个相同模型自然指向同一个文件（去重）
 *   3. 大文件零 base64 读：getUri + convertFileSrc + fetch(arrayBuffer)，
 *      不再走桥接字符串
 *
 * v28 及以前的 legacy 工程（project.svproj）打开时自动迁移：小 zip 直读，
 * 大 zip 走 fflate 流式解压逐条落盘（任何时刻不持有整份模型），迁移完删旧 zip。
 */
(function () {
    'use strict';

    var PROJECTS_ROOT = 'projects';
    var REGISTRY_KEY = 'ss-registry';
    var STATE_ENTRY = 'state.json';
    var STATE_FILE = 'project.json';
    var FILES_DIR = 'files';

    /* ---------- 路径规划 ---------- */

    function dirNameFor(projectName) {
        return encodeURIComponent(projectName);
    }

    function pathsFor(projectName) {
        var dir = PROJECTS_ROOT + '/' + dirNameFor(projectName);
        return {
            dir: dir,
            proj: dir + '/project.svproj',      // legacy（v28-）
            state: dir + '/' + STATE_FILE,      // v29：纯状态
            filesDir: dir + '/' + FILES_DIR,    // v29：内容寻址的字节
            thumb: dir + '/thumb.jpg',
            meta: dir + '/meta.json'
        };
    }

    /* ---------- 内容寻址 ----------
     * SHA-1（crypto.subtle）做内容指纹；subtle 不可用时退回 FNV-1a
     * （32 位，碰撞概率高于 SHA-1，仅保底不丢数据：引用断了当缺失道具处理）。
     * 字节不会经过聊天或日志，哈希值本身可以出现在任何地方。
     */

    function sha1Hex(u8) {
        try {
            if (window.crypto && crypto.subtle && crypto.subtle.digest) {
                return crypto.subtle.digest('SHA-1', u8).then(function (buf) {
                    var v = new Uint8Array(buf), s = '';
                    for (var i = 0; i < v.length; i++) s += (v[i] < 16 ? '0' : '') + v[i].toString(16);
                    return s;
                }).catch(function () { return fnv1aHex(u8); });
            }
        } catch (e) { /* fall through */ }
        return Promise.resolve(fnv1aHex(u8));
    }

    function fnv1aHex(u8) {
        var h = 0x811c9dc5;
        for (var i = 0; i < u8.length; i++) {
            h ^= u8[i];
            h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
        }
        // 32 位太短，拼接长度做简单增强（不改变弱哈希本质，只是保底）
        var len = u8.length.toString(16);
        while (len.length < 8) len = '0' + len;
        return ('0000000' + h.toString(16)).slice(-8) + len;
    }

    /* ---------- SHA-1（增量式，迁移流式解压专用） ----------
     * crypto.subtle 只能一次性哈希整块大缓冲，迁移要边解压边算，
     * 只能自己实现。结果与 subtle 完全一致（有探针对拍），
     * 这样迁移落盘的文件名和正常保存的一致，去重才跨路径生效。 */

    function sha1New() {
        return {
            h: [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0],
            tmp: new Uint8Array(64), tmpLen: 0, total: 0
        };
    }

    function sha1Block(h, m, off) {
        var w = new Uint32Array(80), i, n;
        for (i = 0; i < 16; i++) {
            w[i] = ((m[off + 4 * i] << 24) | (m[off + 4 * i + 1] << 16) |
                    (m[off + 4 * i + 2] << 8) | m[off + 4 * i + 3]) >>> 0;
        }
        for (i = 16; i < 80; i++) {
            n = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
            w[i] = ((n << 1) | (n >>> 31)) >>> 0;
        }
        var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f, k, t;
        for (i = 0; i < 80; i++) {
            if (i < 20) { f = (b & c) | ((~b) & d); k = 0x5A827999; }
            else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
            else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
            else { f = b ^ c ^ d; k = 0xCA62C1D6; }
            t = (((a << 5) | (a >>> 27)) + (f >>> 0) + e + k + w[i]) >>> 0;
            e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
        }
        h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0;
        h[3] = (h[3] + d) >>> 0; h[4] = (h[4] + e) >>> 0;
    }

    function sha1Update(s, u8) {
        s.total += u8.length;
        var off = 0;
        if (s.tmpLen) {
            var take = Math.min(64 - s.tmpLen, u8.length);
            s.tmp.set(u8.subarray(0, take), s.tmpLen);
            s.tmpLen += take; off = take;
            if (s.tmpLen === 64) { sha1Block(s.h, s.tmp, 0); s.tmpLen = 0; }
        }
        while (off + 64 <= u8.length) { sha1Block(s.h, u8, off); off += 64; }
        if (off < u8.length) { s.tmp.set(u8.subarray(off), 0); s.tmpLen = u8.length - off; }
    }

    function sha1Finish(s) {
        var last = new Uint8Array(64);
        last.set(s.tmp.subarray(0, s.tmpLen));
        last[s.tmpLen] = 0x80;
        if (s.tmpLen >= 56) { sha1Block(s.h, last, 0); last = new Uint8Array(64); }
        // 64 位大端位长：total ≤ 4GB，拆高 32 位/低 32 位
        var hi = Math.floor(s.total / 536870912);
        var lo = (s.total % 536870912) * 8;
        last[56] = (hi >>> 24) & 255; last[57] = (hi >>> 16) & 255;
        last[58] = (hi >>> 8) & 255;  last[59] = hi & 255;
        last[60] = (lo >>> 24) & 255; last[61] = (lo >>> 16) & 255;
        last[62] = (lo >>> 8) & 255;  last[63] = lo & 255;
        sha1Block(s.h, last, 0);
        var out = '';
        for (var i = 0; i < 5; i++) out += ('0000000' + s.h[i].toString(16)).slice(-8);
        return out;
    }

    function concatU8(chunks, total) {
        var out = new Uint8Array(total), o = 0;
        for (var i = 0; i < chunks.length; i++) { out.set(chunks[i], o); o += chunks[i].length; }
        return out;
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
            if (c.name !== d.name) return true;
            // v29 不比 file 引用：保存后是 files/<hash>，活动快照永远是
            // 导演台合成的 props/<i>.<ext>，直接比必假脏。与 v28 一样，
            // 「同名同位置换内容」检测不到——本来也没有用户入口能这么干。
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
            var p = this.fs();
            // 模型动辄 20MB+，base64 后更大。一次性过桥会撑爆 WebView 的
            // 消息通道，也一次性吃掉一份膨胀字符串的内存（v28 的 OOM 同源）。
            // 分块追加：每片各自编码（含各自 padding），解码后拼接与原字节
            // 严格一致，片长不需要任何对齐。
            var CHUNK = 3 * 1024 * 1024;
            if (u8.length <= CHUNK) {
                await p.writeFile({ path: path, data: bytesToBase64(u8), directory: 'DATA', recursive: true });
                return;
            }
            await p.writeFile({ path: path, data: '', directory: 'DATA', recursive: true });
            for (var i = 0; i < u8.length; i += CHUNK) {
                var end = Math.min(i + CHUNK, u8.length);
                await p.appendFile({
                    path: path,
                    data: bytesToBase64(u8.subarray(i, end)),
                    directory: 'DATA',
                    recursive: true
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
        // 大文件专用：拿 file URI 后用 fetch 读，全程不产生 base64 字符串。
        // v29 的 OOM 就死在桥接 base64 上（86MB → 230MB 申请），这条路绕开它。
        async readViaUri(path) {
            var cap = window.Capacitor;
            var r = await this.fs().getUri({ path: path, directory: 'DATA' });
            var toUrl = (cap && cap.convertFileSrc) ? cap.convertFileSrc : function (u) { return u; };
            var resp = await fetch(toUrl(r.uri));
            if (!resp.ok) throw new Error('读取失败(' + resp.status + '): ' + path);
            return new Uint8Array(await resp.arrayBuffer());
        },
        async stat(path) {
            try {
                var r = await this.fs().stat({ path: path, directory: 'DATA' });
                return { size: r.size, mtime: r.mtime, type: r.type };
            } catch (e) { return null; }
        },
        async removeFile(path) {
            try { await this.fs().deleteFile({ path: path, directory: 'DATA' }); } catch (e) { /* 不存在就算了 */ }
        },
        async rename(from, to) {
            await this.fs().rename({ from: from, to: to, directory: 'DATA', toDirectory: 'DATA' });
        },
        async append(path, u8) {
            // recursive 必须带：迁移首块落在 files/ 子目录，父目录还不存在
            //（真机报过 Missing parent directory；web 端无目录概念测不出来）
            await this.fs().appendFile({ path: path, data: bytesToBase64(u8), directory: 'DATA', recursive: true });
        },
        // 大文件流式读取：把 zip/模型字节分块喂给 push(chunk, final)。
        // 优先 fetch 流（ReadableStream），WebView 不给流就退回整包一次性 push。
        // v28 的 OOM 死在一次性 base64 字符串，分块喂数据的峰值只有单块大小。
        async readChunks(path, push) {
            var cap = window.Capacitor;
            var r = await this.fs().getUri({ path: path, directory: 'DATA' });
            var toUrl = (cap && cap.convertFileSrc) ? cap.convertFileSrc : function (u) { return u; };
            var resp = await fetch(toUrl(r.uri));
            if (!resp.ok) throw new Error('读取失败(' + resp.status + '): ' + path);
            if (resp.body && resp.body.getReader) {
                var reader = resp.body.getReader();
                for (;;) {
                    var it = await reader.read();
                    if (it.done) { await push(new Uint8Array(0), true); break; }
                    await push(it.value, false);
                }
            } else {
                await push(new Uint8Array(await resp.arrayBuffer()), true);
            }
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
        // web/桌面：fetch 路径不存在，直接等同 read（IndexedDB 本来就是字节）
        async readViaUri(path) { return this.read(path); },
        async stat(path) {
            try {
                var u8 = await this.read(path);
                return { size: u8.length, mtime: 0, type: 'file' };
            } catch (e) { return null; }
        },
        async removeFile(path) {
            var db = await this._open();
            return new Promise(function (res) {
                var t = db.transaction('files', 'readwrite');
                t.objectStore('files').delete(path);
                t.oncomplete = function () { res(); };
                t.onerror = function () { res(); };
            });
        },
        // web/测试：没有原生 rename，读改写
        async rename(from, to) {
            var u8 = await this.read(from);
            await this.write(to, u8);
            await this.removeFile(from);
        },
        // web/测试：没有原生 append，读改写（IndexedDB 本来就是整块字节）
        async append(path, u8) {
            var old = null;
            try { old = await this.read(path); } catch (e) { old = null; }
            var merged = new Uint8Array((old ? old.length : 0) + u8.length);
            if (old) merged.set(old, 0);
            merged.set(u8, old ? old.length : 0);
            await this.write(path, merged);
        },
        // web/测试环境：IndexedDB 本来就是整块字节，一次 push 完事
        async readChunks(path, push) {
            var u8 = await this.read(path);
            await push(u8, true);
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

    /* ---------- v29 内容寻址落盘 ---------- */

    /**
     * 把一组字节按内容写入 files/<sha1>.<ext>；已存在就跳过（去重的核心）。
     * @returns {Promise<string>} 相对引用路径，如 'files/ab12cd34...glb'
     */
    async function putContentFile(p, ext, u8) {
        var hash = await sha1Hex(u8);
        var rel = FILES_DIR + '/' + hash + '.' + (ext || 'bin');
        var abs = p.dir + '/' + rel;
        var st = await store().stat(abs);
        if (!st || typeof st.size !== 'number' || st.size !== u8.length) {
            await store().write(abs, u8);
            // 写完校验：杜绝静默截断/损坏（v28 时代没有任何校验）
            var after = await store().stat(abs);
            if (!after || after.size !== u8.length) {
                throw new Error('内容文件写入校验失败: ' + rel);
            }
        }
        return rel;
    }

    /* ---------- v28- 自包含 zip 的流式迁移 ----------
     * 老工程是「state.json + 全部模型内嵌」的 zip，86MB 模型的 173MB 包在
     * readFile 的 base64 阶段直接 OOM。
     *
     * 管线（任何时刻内存里只有一个 ~3MB 写盘缓冲 + 几 KB 的 state）：
     *   fetch 流 → fflate 流式解压 → 条目字节攒进缓冲 → 满 3MB append 到
     *   files/.tmp-N.part，同时增量算 SHA-1 → 条目流完 rename 成
     *   files/<sha1>.<ext>（目标已存在且等长就删临时件，内容寻址天然去重）。
     * state.json 只有几 KB，留在内存，最后写 project.json、删旧 zip。
     */

    var MIG_FLUSH_BYTES = 3 * 1024 * 1024;

    async function migrateLegacyProject(p) {
        var f = ffl();
        if (!f.Unzip || !f.UnzipInflate) throw new Error('fflate 无流式解压');

        var stateBuf = [];          // state.json 条目（几 KB，留内存）
        var stateSize = 0;
        var open = [];              // 解压中的条目（fflate 同步回调，一批可能连完多个）
        var done = [];              // 流完的条目 { name, ref, size }
        var tmpCount = 0;

        function newRec(name) {
            tmpCount++;
            return {
                name: name,
                tempRel: FILES_DIR + '/.tmp-' + tmpCount + '.part',
                sha: sha1New(), size: 0, buf: [], bufLen: 0, final: false, started: false
            };
        }

        async function flushRec(r) {
            if (!r.bufLen) return;
            var tmpAbs = p.dir + '/' + r.tempRel;
            // 首次 flush 先截断建档：上次迁移半途而废留下的同名 .tmp 有残尾，
            // 直接 append 会叠出坏文件；write 空内容顺便把 files/ 父目录建好
            //（真机 v29 就是死在 append 建不了父目录）。
            if (!r.started) {
                await store().write(tmpAbs, new Uint8Array(0));
                r.started = true;
            }
            var cat = concatU8(r.buf, r.bufLen);
            r.buf = []; r.bufLen = 0;
            await store().append(tmpAbs, cat);
        }

        async function finishRec(r) {
            await flushRec(r);
            var m = r.name.match(/\.([^.]+)$/);
            var ext = m ? m[1].toLowerCase() : 'bin';
            var ref = FILES_DIR + '/' + sha1Finish(r.sha) + '.' + ext;
            var abs = p.dir + '/' + ref;
            var tmpAbs = p.dir + '/' + r.tempRel;
            var st = await store().stat(abs);
            if (st && st.size === r.size) {
                await store().removeFile(tmpAbs);   // 已有同内容：内容寻址天然去重
            } else {
                await store().rename(tmpAbs, abs);
                var after = await store().stat(abs);
                if (!after || after.size !== r.size) throw new Error('迁移写入校验失败: ' + ref);
            }
            done.push({ name: r.name, ref: ref, size: r.size });
        }

        var u = new f.Unzip();
        u.register(f.UnzipInflate);
        u.onfile = function (file) {
            // fflate 必须显式 start() 才开始吐数据（探针验证过的行为）
            if (file.name === STATE_ENTRY) {
                file.ondata = function (err, chunk, final) {
                    if (err) throw err;
                    if (chunk && chunk.length) { stateBuf.push(chunk); stateSize += chunk.length; }
                };
                file.start();
                return;
            }
            var rec = newRec(file.name);
            open.push(rec);
            file.ondata = function (err, chunk, final) {
                if (err) throw err;
                if (chunk && chunk.length) {
                    rec.buf.push(chunk); rec.bufLen += chunk.length;
                    rec.size += chunk.length;
                    sha1Update(rec.sha, chunk);
                }
                if (final) rec.final = true;
            };
            file.start();
        };

        // fetch 流逐块喂 unzipper；fflate 的 ondata 是同步回调，一批里可能
        // 连着流完多个小条目，所以每次 push 返回后把 open 里所有已完结的
        // 逐个落盘，满 3MB 的也先 flush——内存峰值 ≈ 单批 chunk + 3MB 缓冲。
        await store().readChunks(p.proj, async function (chunk, final) {
            u.push(chunk, final);
            for (var i = 0; i < open.length; ) {
                var r = open[i];
                if (r.final) {
                    await finishRec(r);
                    open.splice(i, 1);
                } else {
                    if (r.bufLen >= MIG_FLUSH_BYTES) await flushRec(r);
                    i++;
                }
            }
        });

        if (open.length) throw new Error('旧工程条目不完整: ' + open.map(function (r) { return r.name; }).join('、'));
        if (!stateSize) throw new Error('旧工程缺少 state.json');
        var state = JSON.parse(strFromU8(concatU8(stateBuf, stateSize)));

        // 旧引用 → 内容地址（同字节两份在这里并成一个文件）
        done.forEach(function (e) {
            if (state.model && state.model.path === e.name) state.model.path = e.ref;
            (state.props || []).forEach(function (r) {
                if (r.file === e.name) r.file = e.ref;
            });
        });

        await store().write(p.state, new TextEncoder().encode(JSON.stringify(state)));
        await store().removeFile(p.proj);
        return state;
    }

    /* ---------- meta ---------- */

    function parseMeta(raw) {
        try {
            var m = JSON.parse(raw);
            if (m && typeof m.name === 'string') return m;
        } catch (e) { /* 忽略 */ }
        return null;
    }

    /* ---------- 空工程 ---------- */

    /**
     * 新建工程时落盘的最小状态。
     *
     * version 必须是 1：restoreProject 开头就是 `if (!t || t.version !== 1)
     * return 'bad-version'`，空工程也要走同一条还原路径，不能省。
     * 数组字段给空数组而不是缺省，省得脏检查里 `current.puppets || []`
     * 这种写法在两边写法不一致时判出假脏。
     */
    function emptyProjectState() {
        return {
            version: 1,
            model: null,
            puppets: [],
            props: [],
            shots: [],
            camera: null,
            cursor: null
        };
    }

    window.__projectLogic = {
        PROJECTS_ROOT: PROJECTS_ROOT,
        STATE_ENTRY: STATE_ENTRY,
        STATE_FILE: STATE_FILE,
        FILES_DIR: FILES_DIR,
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
        putContentFile: putContentFile,
        sha1Hex: sha1Hex,
        sha1New: sha1New,
        sha1Update: sha1Update,
        sha1Finish: sha1Finish,
        migrateLegacyProject: migrateLegacyProject,
        parseMeta: parseMeta,
        emptyProjectState: emptyProjectState,
        isNative: isNative
    };
})();
