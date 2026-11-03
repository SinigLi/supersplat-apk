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
        var byLabel = {};
        (files || []).forEach(function (f) { byLabel[f.label] = f; });
        /* v45m：一视频一节点。节点字段：
         *   target          视频名（去扩展名）
         *   split_at_frame / split_at_seconds   分割点（每段至多一个，帧为权威）
         *   multiframe_refs 多帧参考帧号列表（升序去重）
         *   merge_prev      该段并入前段标记
         * 同帧互斥：split 与 multiframe_refs 不共存于同一帧（UI 层已互斥，导出层再兜底）
         * 列表按段号降序（导出后从后往前切，前面的段编号不发生平移）
         */
        var bySeg = {};
        var order = [];                          // 保持首次出现顺序之外，还要能按 seq 排
        (marks.marks || []).forEach(function (m) {
            var f = byLabel[m.seg];
            if (!f) return;                      // 清单已变的标记：导出时剔除
            var name = f.name.replace(/\.[^.]+$/, '');
            var node = bySeg[name];
            if (!node) {
                node = { target: name, note: m.note || '' };
                bySeg[name] = node;
                order.push(node);
            }
            if (!node.note && m.note) node.note = m.note;
            if (m.type === 'split') {
                var fr = frameAt(m.at, meta.fps);
                // 同段多 split 不可能（UI 单点互斥），但兜底取最早帧
                if (node.split_at_frame == null || (fr != null && fr < node.split_at_frame)) {
                    node.split_at_frame = fr;
                    node.split_at_seconds = Number(m.at.toFixed(2));
                }
            }
            if (m.type === 'multiframe_ref') {
                var set = node.multiframe_refs || (node.multiframe_refs = []);
                (m.frames || []).forEach(function (fr2) {
                    if (set.indexOf(fr2) < 0) set.push(fr2);
                });
            }
            if (m.type === 'merge_prev') node.merge_prev = true;
        });
        order.forEach(function (node) {
            if (node.split_at_frame == null) { delete node.split_at_frame; delete node.split_at_seconds; }
            if (node.multiframe_refs) {
                node.multiframe_refs.sort(function (a, b) { return a - b; });
                // 同帧互斥兜底：若与分割点同帧，剔除该参考帧
                if (node.split_at_frame != null) {
                    var i = node.multiframe_refs.indexOf(node.split_at_frame);
                    if (i >= 0) node.multiframe_refs.splice(i, 1);
                }
                if (!node.multiframe_refs.length) delete node.multiframe_refs;
            }
            if (!node.merge_prev) delete node.merge_prev;
            if (!node.note) delete node.note;
        });
        var seqOf = function (name) {
            var f = (files || []).filter(function (x) { return x.name.replace(/\.[^.]+$/, '') === name; })[0];
            return f ? (f.seq != null ? f.seq : -1) : -1;
        };
        order.sort(function (a, b) { return seqOf(b.target) - seqOf(a.target); });
        return {
            schema: 'moyutai.marks.v2',
            mode: meta.mode,
            source_dir: meta.folderName || '',
            fps: meta.mode === 'video' ? (meta.fps || null) : undefined,
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
        frameAt: frameAt,
        secAtFrame: secAtFrame,
        snapT: snapT,
        quantize: quantize,
        normalizeMerge: normalizeMerge,
        buildExport: buildExport,
        validateProjectName: validateProjectName
    };
})();
