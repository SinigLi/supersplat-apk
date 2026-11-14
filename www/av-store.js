/* 摸鱼台 v45 —— AV 工作台存储适配层（音视频工程）
 *
 * 与 3D 工程的差异（方案 §3.2【D2/D4 已定】）：
 *   3D 工程把模型字节内容寻址落盘进工程目录；音视频工程媒体不进包
 *   （单源 300MB 级，v29 181MB 教训），只存：
 *     - folderUri：SAF 目录授权（takePersistableUriPermission 持久化）
 *     - files.json：文件清单快照（文件名/大小/mtime，排序后）
 *     - marks.json：标记（split / merge_prev / multiframe_ref）
 *
 * localStorage 键：
 *   av-registry    工程索引（name/mode/updatedAt）
 *   av-<名>-meta   工程元数据（mode/folderUri/fps/step 等）
 *   av-<名>-marks  标记数组（几 KB 级，localStorage 足够）
 *
 * 纯逻辑层（folderUri/清单/标记的读写与校验）与 UI 解耦，探针直接测。
 */
(function () {
    'use strict';

    var REG_KEY = 'av-registry';
    var MAX_MARKS = 2000;          // 防御性上限（正常量级几十个）

    /* ---------- 注册表（轻索引，仿 projects.js） ---------- */

    function emptyRegistry() {
        return { projects: [] };
    }

    function upsertProject(reg, entry) {
        if (!entry || !entry.name || !entry.mode) throw new Error('工程条目无效');
        if (entry.mode !== 'video' && entry.mode !== 'audio') throw new Error('模式无效: ' + entry.mode);
        var rest = (reg.projects || []).filter(function (p) { return p.name !== entry.name; });
        return { projects: [{
            name: entry.name,
            mode: entry.mode,
            updatedAt: entry.updatedAt || new Date().toISOString()
        }].concat(rest) };
    }

    function removeProject(reg, name) {
        return { projects: (reg.projects || []).filter(function (p) { return p.name !== name; }) };
    }

    function loadRegistry() {
        try {
            var raw = localStorage.getItem(REG_KEY);
            if (raw) {
                var r = JSON.parse(raw);
                if (r && Array.isArray(r.projects)) return r;
            }
        } catch (e) { /* 损坏当空 */ }
        return emptyRegistry();
    }

    function saveRegistry(reg) {
        try { localStorage.setItem(REG_KEY, JSON.stringify(reg)); } catch (e) { /* 配额满放弃 */ }
    }

    /* ---------- 工程元数据 ---------- */

    function metaKey(name) { return 'av-' + name + '-meta'; }
    function marksKey(name) { return 'av-' + name + '-marks'; }

    function emptyMeta(name, mode) {
        return {
            version: 1,
            name: name,
            mode: mode,                 // 'video' | 'audio'
            folderUri: null,            // SAF tree URI（持久授权）
            folderName: '',             // 展示用
            fps: null,                  // 视频工程：自动估算值（rVFC 采样），可手动修正
            fpsSource: null,            // 'auto' | 'manual'
            stepVideo: 1,               // 视频步进（帧）
            stepAudio: 0.05,            // 音频步进（秒）
            updatedAt: new Date().toISOString()
        };
    }

    function loadMeta(name) {
        try {
            var raw = localStorage.getItem(metaKey(name));
            if (raw) {
                var m = JSON.parse(raw);
                if (m && m.name === name && (m.mode === 'video' || m.mode === 'audio')) return m;
            }
        } catch (e) { /* 损坏当无 */ }
        return null;
    }

    function saveMeta(meta) {
        meta.updatedAt = new Date().toISOString();
        try { localStorage.setItem(metaKey(meta.name), JSON.stringify(meta)); } catch (e) { /* */ }
    }

    function deleteMeta(name) {
        try { localStorage.removeItem(metaKey(name)); localStorage.removeItem(marksKey(name)); } catch (e) { /* */ }
    }

    /* ---------- 文件清单（D2：纯文件名序 + 尾部标号解析） ---------- */

    /* 从文件名解析尾部标号：shot003.mp4 → 3；seg012.wav → 12；无标号 → null */
    function parseSeq(name) {
        var base = String(name || '').replace(/\.[^.]+$/, '');
        var m = base.match(/(\d+)$/);
        return m ? parseInt(m[1], 10) : null;
    }

    /* 显示段号：有标号用标号（去前导零），无标号 auto-N（1 起） */
    function segLabel(file, idx) {
        return file.seq != null ? String(file.seq) : 'auto-' + (idx + 1);
    }

    /* 目录条目 → 清单：只留媒体扩展名，自然排序（数字段按数值），分配序号 */
    var VIDEO_EXT = ['mp4', 'webm', 'mkv', 'mov', 'm4v'];
    var AUDIO_EXT = ['wav', 'mp3', 'flac', 'm4a', 'ogg', 'aac'];

    function mediaFilter(mode) {
        var exts = mode === 'audio' ? AUDIO_EXT : VIDEO_EXT;
        return function (name) {
            var m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
            return m && exts.indexOf(m[1]) >= 0;
        };
    }

    /* 自然排序比较：分段数字/字母，'shot2' < 'shot10' */
    function naturalCmp(a, b) {
        var ra = String(a), rb = String(b), i = 0, j = 0;
        while (i < ra.length && j < rb.length) {
            var ca = ra.charCodeAt(i), cb = rb.charCodeAt(j);
            var da = ca >= 48 && ca <= 57, db = cb >= 48 && cb <= 57;
            if (da && db) {
                var s0 = i, t0 = j;
                while (i < ra.length && ra.charCodeAt(i) >= 48 && ra.charCodeAt(i) <= 57) i++;
                while (j < rb.length && rb.charCodeAt(j) >= 48 && rb.charCodeAt(j) <= 57) j++;
                var va = parseInt(ra.slice(s0, i), 10), vb = parseInt(rb.slice(t0, j), 10);
                if (va !== vb) return va - vb;
                if (i - s0 !== j - t0) return (i - s0) - (j - t0);   // 前导零短的在前
            } else {
                if (ca !== cb) return ca - cb;
                i++; j++;
            }
        }
        return (ra.length - i) - (rb.length - j);
    }

    /**
     * 由目录文件名数组构建清单。
     * @param {string[]} names 全部文件名
     * @param {string} mode 'video'|'audio'
     * @returns {Array} files: [{name, seq, label, size}]
     */
    function buildFileList(names, mode) {
        var keep = names.filter(mediaFilter(mode));
        keep.sort(naturalCmp);
        return keep.map(function (n, i) {
            return { name: n, seq: parseSeq(n), label: null, size: 0 };
        }).map(function (f, i) {
            f.label = segLabel(f, i);
            return f;
        });
    }

    /* ---------- 标记（r2/r3/r5 决议的数据结构） ---------- */

    /* 标记类型：
     *   split         { at } 段内秒（帧精确归档见 roundFrame）
     *   merge_prev    段级开关，标记固定挂片段开头（F1）
     *   multiframe_ref { frames: [帧号...] } 多帧参考（F3）
     * 不变量（F1）：同一段最多一个 merge_prev，且每段至多一个 merge 开关。
     */

    function emptyMarks() { return { version: 1, marks: [] }; }

    /* ---------- 角色打标（v53）：chars 存取 + char_ref ---------- */
    /* char_ref = { id, type:'char_ref', seg:<段label>, at:<段内秒>,
     *              chars:[{ cardId, name, global_desc, prompt_extend, mask }] }
     * v69（老板 2026-11-15 定）：orig_char_desc → global_desc、
     * dest_char_desc → prompt_extend。读老数据时兼容两个旧名。 */

    /* 老字段名兼容层：只读时用，写出去永远是 v69 新名 */
    function cGlobalDesc(c) {
        if (!c) return '';
        if (typeof c.global_desc === 'string') return c.global_desc;
        return typeof c.orig_char_desc === 'string' ? c.orig_char_desc : '';
    }
    function cPromptExtend(c) {
        if (!c) return '';
        if (typeof c.prompt_extend === 'string') return c.prompt_extend;
        return typeof c.dest_char_desc === 'string' ? c.dest_char_desc : '';
    }

    function charsKey(name) { return 'av-' + name + '-chars'; }

    function loadChars(name) {
        try {
            var raw = localStorage.getItem(charsKey(name));
            if (raw) {
                var c = JSON.parse(raw);
                if (c && c.schema === 'moyutai.charcards.v1' && Array.isArray(c.cards)) return c;
            }
        } catch (e) { /* */ }
        return { schema: 'moyutai.charcards.v1', orig_char_descs: [], dest_char_descs: [], cards: [] };
    }

    function saveChars(name, cards) {
        if (!cards || cards.schema !== 'moyutai.charcards.v1' || !Array.isArray(cards.cards)) throw new Error('角色卡数据无效');
        try { localStorage.setItem(charsKey(name), JSON.stringify(cards)); } catch (e) {
            throw new Error('角色卡保存失败（存储配额？）');
        }
    }

    function roundFrame2(at, fps) { return Math.round(at * fps); }

    function findCharRefAt(marks, seg, frame, fps) {
        var hit = null;
        (marks.marks || []).forEach(function (m) {
            if (m.type !== 'char_ref' || m.seg !== seg) return;
            if (roundFrame2(m.at, fps) === frame) hit = m;
        });
        return hit;
    }

    function upsertCharRef(marks, seg, at, chars) {
        var fps = 25; /* 由调用方传 fps 时精确；这里 marks 存秒，帧换算在导出 */
        var i, m;
        for (i = 0; i < marks.marks.length; i++) {
            m = marks.marks[i];
            if (m.type === 'char_ref' && m.seg === seg && Math.abs(m.at - at) < 1e-9) {
                m.chars = chars;
                return m;
            }
        }
        m = { id: 'cr-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), type: 'char_ref', seg: seg, at: at, chars: chars };
        marks.marks.push(m);
        return m;
    }

    function removeCharRef(marks, id) {
        var before = marks.marks.length;
        marks.marks = marks.marks.filter(function (m) { return !(m.type === 'char_ref' && m.id === id); });
        return marks.marks.length < before;
    }

    function loadMarks(name) {
        try {
            var raw = localStorage.getItem(marksKey(name));
            if (raw) {
                var m = JSON.parse(raw);
                if (m && Array.isArray(m.marks)) return m;
            }
        } catch (e) { /* */ }
        return emptyMarks();
    }

    function saveMarks(name, marks) {
        if (!marks || !Array.isArray(marks.marks)) throw new Error('标记数据无效');
        if (marks.marks.length > MAX_MARKS) throw new Error('标记数超上限 ' + MAX_MARKS);
        try { localStorage.setItem(marksKey(name), JSON.stringify(marks)); } catch (e) {
            throw new Error('标记保存失败（存储配额？）');
        }
    }

    /* 秒 → 帧号（fps 已知时帧精确归档；G1：一切判断帧精确） */
    function frameAt(sec, fps) {
        if (!fps || fps <= 0) return null;
        return Math.round(sec * fps);
    }

    /* 帧号 → 秒 */
    function secAtFrame(frame, fps) {
        if (!fps || fps <= 0) return 0;
        return frame / fps;
    }

    /* 播放条点选吸附（F2）：|t - mark.at| < 半帧（fps 已知）或 0.02s（音频/未知 fps）内吸附 */
    function snapT(t, marks, fps) {
        var tol = (fps && fps > 0) ? 0.5 / fps : 0.02;
        var best = null, bestD = Infinity;
        (marks || []).forEach(function (m) {
            if (m.type !== 'split' || typeof m.at !== 'number') return;
            var d = Math.abs(m.at - t);
            if (d < tol && d < bestD) { bestD = d; best = m; }
        });
        return best ? best.at : t;
    }

    /* 步进网格量化（G1/H2）：视频按帧网格、音频按 0.05s 网格翻转按钮状态 */
    function quantize(t, mode, fps, stepAudio) {
        if (mode === 'video' && fps > 0) {
            return secAtFrame(frameAt(t, fps), fps);
        }
        var st = stepAudio || 0.05;
        return Math.round(t / st) * st;
    }

    /* 同段 merge 开关互斥（F1）：设置新 merge_prev 前清掉同段旧开关 */
    function normalizeMerge(marks, seg) {
        var found = null;
        marks.marks.forEach(function (m) {
            if (m.type === 'merge_prev' && m.seg === seg) found = m;
        });
        return found;
    }

    /* ---------- JSON 导出（R10，信封草案 v0 §3.5，P4 联调期定稿） ---------- */

    /**
     * 导出信封。降序排列（音视频助手要求：先切后面的段，镜号不平移）。
     * @param {object} meta 工程元数据
     * @param {object} marks 标记
     * @param {Array} files 清单（用于 target 解析与校验）
     */
    function buildExport(meta, marks, files) {
        /* v45n：moyutai.marks.v3——老板定稿结构：
         * 一视频一节点 { target, merge_prev?, points[] }；
         * points = 统一的点列表，split 与 multiframe 同级同构（type 区分），
         * split 多带 at_seconds（切点时刻，供秒级消费方），multiframe 只记帧号；
         * points 按 at_frame 升序，marks 按段号降序（从后往前切编号不移位）；
         * 同帧互斥兜底：split 优先，剔除同帧 multiframe。 */
        var byLabel = {};
        (files || []).forEach(function (f) { byLabel[f.label] = f; });
        var fps = meta.fps || 25;
        var nodes = {};
        var order = [];
        (marks.marks || []).forEach(function (m) {
            var f = byLabel[m.seg];
            if (!f) return;
            var name = f.name.replace(/\.[^.]+$/, '');
            var node = nodes[name];
            if (!node) {
                node = nodes[name] = { target: name, points: [] };
                order.push(node);
            }
            if (m.note && !node.note) node.note = m.note;
            if (m.type === 'merge_prev') { node.merge_prev = true; return; }
            if (m.type === 'char_ref') {
                /* v53：收集到段级暂存，order 组装后按帧挂载（见下方 mountChars） */
                if (!node._charRefs) node._charRefs = [];
                node._charRefs.push(m);
                return;
            }
            if (m.type === 'split') {
                if (meta.mode === 'audio') {
                    /* v46：音频无帧概念，只写秒（at_seconds），不产出无意义的 at_frame */
                    node.points.push({ type: 'split', at_seconds: Number(m.at.toFixed(2)) });
                } else {
                    node.points.push({ type: 'split', at_frame: frameAt(m.at, fps), at_seconds: Number(m.at.toFixed(2)) });
                }
            } else if (m.type === 'multiframe_ref') {
                if (meta.mode === 'audio') {
                    (m.secs || []).forEach(function (s) {
                        node.points.push({ type: 'multiframe', at_seconds: Number(s.toFixed(2)) });
                    });
                } else {
                    (m.frames || []).forEach(function (fr) {
                        node.points.push({ type: 'multiframe', at_frame: fr });
                    });
                }
            }
        });
        order.forEach(function (node) {
            if (!node.merge_prev) delete node.merge_prev;
            if (!node.note) delete node.note;
            var keyOf = meta.mode === 'audio'
                ? function (pt) { return pt.at_seconds != null ? pt.at_seconds : 0; }
                : function (pt) { return pt.at_frame != null ? pt.at_frame : 0; };
            node.points.sort(function (a, b) { return keyOf(a) - keyOf(b); });
            // 同刻互斥兜底：split 优先（音频按秒、视频按帧各自比对）
            var splitKeys = {};
            node.points.forEach(function (pt) { if (pt.type === 'split') splitKeys[keyOf(pt)] = true; });
            var seen = {};
            node.points = node.points.filter(function (pt) {
                var k0 = keyOf(pt);
                if (pt.type === 'multiframe' && splitKeys[k0]) return false;
                var k = pt.type + ':' + k0;
                if (seen[k]) return false;
                seen[k] = true;
                return true;
            });
        });
        var seqOf = function (name) {
            var f = (files || []).filter(function (x) { return x.name.replace(/\.[^.]+$/, '') === name; })[0];
            return f ? (f.seq != null ? f.seq : -1) : -1;
        };
        /* v53：char_ref → 导出挂载（只增不改：无 char_ref 时零输出差异）
         * 规则：at 帧号 = 段首帧(0) → target.chars（merge_prev 段跳过）；
         *       与某 split/multiframe point 帧相同 → 挂该 point.chars；
         *       其余帧（无对应 point）→ 也挂 target.chars 但带 at_frame 字段。
         * mask 路径由 UI 层在导出前解析成相对路径后写入 entry.mask。 */
        order.forEach(function (node) {
            if (!node._charRefs || !node._charRefs.length) { delete node._charRefs; return; }
            var refs = node._charRefs; delete node._charRefs;
            var mergePrev = !!node.merge_prev;
            refs.forEach(function (ref) {
                var fr = frameAt(ref.at, fps);
                var entries = (ref.chars || []).map(function (c) {
                    /* v69：导出字段名换成 global_desc / prompt_extend */
                    var e = { name: c.name, global_desc: cGlobalDesc(c), prompt_extend: cPromptExtend(c) };
                    if (c.mask) e.mask = c.mask;
                    return e;
                });
                if (!entries.length) return;
                if (fr === 0) {
                    if (mergePrev) return;               /* merge_prev 段无段级 chars（老板定稿） */
                    if (!node.chars) node.chars = entries;
                    return;
                }
                var pt = null;
                (node.points || []).some(function (p) {
                    var pf = p.type === 'split' ? p.at_frame : (p.type === 'multiframe' ? p.at_frame : -1);
                    if (pf === fr) { pt = p; return true; }
                    return false;
                });
                if (pt) { pt.chars = entries; }
                else {
                    /* 无对应 point：挂 target.chars，条目带 at_frame（保留帧信息） */
                    if (!node.chars) node.chars = [];
                    entries[0].at_frame = fr;
                    node.chars.push(entries[0]);
                }
            });
        });
        order.sort(function (a, b) { return seqOf(b.target) - seqOf(a.target); });
        return {
            schema: 'moyutai.marks.v3',
            mode: meta.mode,
            source_dir: meta.folderName || '',
            fps: meta.mode === 'video' ? fps : undefined,
            based_on: 'moyutai v45',
            marks: order
        };
    }
    /* ---------- 校验工程名（复用 3D 侧规则） ---------- */

    function validateProjectName(name) {
        var n = (name || '').trim();
        if (!n) return { ok: false, reason: '工程名不能为空' };
        if (n.length > 50) return { ok: false, reason: '工程名过长（最多 50 字符）' };
        if (/[/\\:*?"<>|]/.test(n)) return { ok: false, reason: '工程名不能包含 / \\ : * ? " < > |' };
        return { ok: true, name: n };
    }

    window.__avLogic = {
        REG_KEY: REG_KEY,
        emptyRegistry: emptyRegistry,
        upsertProject: upsertProject,
        removeProject: removeProject,
        loadRegistry: loadRegistry,
        saveRegistry: saveRegistry,
        emptyMeta: emptyMeta,
        loadMeta: loadMeta,
        saveMeta: saveMeta,
        deleteMeta: deleteMeta,
        parseSeq: parseSeq,
        segLabel: segLabel,
        buildFileList: buildFileList,
        naturalCmp: naturalCmp,
        mediaFilter: mediaFilter,
        VIDEO_EXT: VIDEO_EXT,
        AUDIO_EXT: AUDIO_EXT,
        emptyMarks: emptyMarks,
        loadMarks: loadMarks,
        saveMarks: saveMarks,
        loadChars: loadChars,
        saveChars: saveChars,
        findCharRefAt: findCharRefAt,
        upsertCharRef: upsertCharRef,
        removeCharRef: removeCharRef,
        frameAt: frameAt,
        secAtFrame: secAtFrame,
        snapT: snapT,
        quantize: quantize,
        normalizeMerge: normalizeMerge,
        buildExport: buildExport,
        validateProjectName: validateProjectName
    };
})();
