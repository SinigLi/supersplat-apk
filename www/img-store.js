/* v49 img-store.js — 图片工程存储（pure logic）
 *
 * 独立于 av-store：av-store 对 mode 有严格校验（video|audio 之外直接抛，
 * 见 av-store.js:31），往里塞 image 要么改它的校验（搅动已稳定链路），
 * 要么让 image 绕开所有校验（更糟）。图片工程的持久化需求不同
 * （单张图 + 笔画数组，无文件夹授权/无 fps），独立成对。
 *
 * 存储分工：
 *   meta（localStorage img-<名>-meta）  → 模式/图片引用/尺寸/反选标志
 *   strokes（localStorage img-<名>-strokes）→ v2 分层结构：layers[]（id/name/visible/strokes）
 *     + activeId；v1 单数组老数据由 loadStrokes 自动迁移为单层「遮罩 1」
 *   图片字节本身 → projects/<名>/files/<sha1>.<ext>（内容寻址，projects.js putContentFile）
 *
 * 为什么 strokes 放 localStorage 而不是 project.json：
 *   strokes 是编辑态，保存频率高（每笔一存，几 KB），走 localStorage 与
 *   av-store 的 marks 同一模式；project.json 只存"这个工程有什么"（图片引用），
 *   由 projects-ui 在创建/删除时维护。
 */
(function () {
    'use strict';

    var SCHEMA = 'moyutai.imgmask.v2';   // v2：分层（layers[]+activeId）；v1 单 strokes 数组由 loadStrokes 自动迁移

    /* ---------- meta ---------- */

    function metaKey(name) { return 'img-' + name + '-meta'; }
    function strokesKey(name) { return 'img-' + name + '-strokes'; }

    function emptyMeta(name) {
        return {
            version: 1,
            name: name,
            mode: 'image',
            imageFile: null,     // 'files/<sha1>.<ext>'，相对工程目录
            imageW: 0,
            imageH: 0,
            invert: false,       // 反选：画的是「保留」区域
            updatedAt: new Date().toISOString()
        };
    }

    function loadMeta(name) {
        try {
            var raw = localStorage.getItem(metaKey(name));
            if (raw) {
                var m = JSON.parse(raw);
                if (m && m.name === name && m.mode === 'image') return m;
            }
        } catch (e) { /* 损坏当空 */ }
        return null;
    }

    function saveMeta(meta) {
        /* 写入侧也把关：loadMeta 只认 mode==='image'，若让别的模式混进来写，
         * 那份 meta 会变成永远读不出来的死数据（占用配额还查不出原因）。
         * 注册表归 projects.js 管，但 meta 的 mode 是本模块的契约。 */
        if (!meta || !meta.name || meta.mode !== 'image') {
            throw new Error('meta 无效：mode 必须是 image');
        }
        meta.updatedAt = new Date().toISOString();
        try { localStorage.setItem(metaKey(meta.name), JSON.stringify(meta)); } catch (e) { /* 配额满 */ }
    }

    function deleteMeta(name) {
        try {
            localStorage.removeItem(metaKey(name));
            localStorage.removeItem(strokesKey(name));
        } catch (e) { /* */ }
    }

    /* ---------- strokes ---------- */

    function emptyStrokes() {
        return { schema: SCHEMA, layers: [{ id: 'L1', name: '遮罩 1', visible: true, strokes: [] }], activeId: 'L1' };
    }

    function loadStrokes(name) {
        try {
            var raw = localStorage.getItem(strokesKey(name));
            if (raw) {
                var s = JSON.parse(raw);
                if (!s) return emptyStrokes();
                /* v1 老工程：单层 strokes 数组 → 迁移成 v2 单层「遮罩 1」。
                 * 调用方拿到 v2 后会在下次 saveStrokes 时落盘为 v2。 */
                if (s.schema === 'moyutai.imgmask.v1' && Array.isArray(s.strokes)) {
                    var mig = (typeof window !== 'undefined' && window.__imgOps)
                        ? window.__imgOps.migrateV1(s)
                        : null;
                    if (mig) return mig;
                    /* img-ops 未加载（理论不发生）：降级为 v1 结构，至少不丢数据 */
                    return s;
                }
                if (s.schema === SCHEMA && Array.isArray(s.layers)) {
                    /* v2 校验：每层结构完整，坏层丢弃并记因，不让坏坐标进渲染 */
                    var err = validateLayers(s.layers);
                    if (!err) {
                        if (!s.activeId || !s.layers.some(function (l) { return l.id === s.activeId; })) {
                            s.activeId = s.layers[0].id;
                        }
                        return s;
                    }
                    try { console.error('[img-store] layers 校验失败，丢弃：' + err); } catch (e2) { }
                }
            }
        } catch (e) { /* */ }
        return emptyStrokes();
    }

    function saveStrokes(name, layers, activeId) {
        try {
            localStorage.setItem(strokesKey(name), JSON.stringify({
                schema: SCHEMA,
                layers: layers,
                activeId: activeId || (layers[0] && layers[0].id) || null
            }));
        } catch (e) { /* 配额满：笔画太多时可能发生，UI 层提示 */ }
    }

    /* ---------- 校验（纯函数，供探针复用） ---------- */

    /* 笔画合法性：类型已知、坐标成对、点数下限正确 */
    function validateStroke(st) {
        if (!st || typeof st !== 'object') return '笔画必须是对象';
        if (st.type !== 'brush' && st.type !== 'polygon' && st.type !== 'erase') return '未知类型: ' + st.type;
        if (!Array.isArray(st.points) || !st.points.length) return 'points 必须是非空数组';
        for (var i = 0; i < st.points.length; i++) {
            var p = st.points[i];
            if (!Array.isArray(p) || p.length !== 2 ||
                typeof p[0] !== 'number' || typeof p[1] !== 'number' ||
                !isFinite(p[0]) || !isFinite(p[1])) {
                return '第 ' + i + ' 个点坐标无效';
            }
        }
        if (st.type === 'polygon' && st.points.length < 3) return '多边形至少 3 个点';
        if ((st.type === 'brush' || st.type === 'erase') &&
            (typeof st.size !== 'number' || !(st.size > 0))) return '笔画宽度无效';
        return null;
    }

    function validateStrokes(arr) {
        if (!Array.isArray(arr)) return 'strokes 必须是数组';
        for (var i = 0; i < arr.length; i++) {
            var err = validateStroke(arr[i]);
            if (err) return 'strokes[' + i + ']: ' + err;
        }
        return null;
    }

    /* v2 层结构校验：层必须能查、id 唯一、strokes 合法 */
    function validateLayers(layers) {
        if (!Array.isArray(layers) || !layers.length) return 'layers 必须是非空数组';
        var seen = {};
        for (var i = 0; i < layers.length; i++) {
            var l = layers[i];
            if (!l || typeof l !== 'object') return 'layers[' + i + '] 必须是对象';
            if (!l.id || typeof l.id !== 'string') return 'layers[' + i + '].id 无效';
            if (seen[l.id]) return 'layers[' + i + '] id 重复: ' + l.id;
            seen[l.id] = 1;
            if (typeof l.name !== 'string' || !l.name) return 'layers[' + i + '].name 无效';
            if (typeof l.visible !== 'boolean') return 'layers[' + i + '].visible 必须是布尔';
            var err = validateStrokes(l.strokes);
            if (err) return 'layers[' + i + '](' + l.name + '): ' + err;
        }
        return null;
    }

    /* 图片魔数：PNG / JPEG / WebP（file input 没有 accept 过滤，选错文件在这里拦） */
    function sniffImageType(u8) {
        if (u8.length > 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47) return 'png';
        if (u8.length > 3 && u8[0] === 0xFF && u8[1] === 0xD8 && u8[2] === 0xFF) return 'jpg';
        if (u8.length > 12 && u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50) return 'webp';
        if (u8.length > 3 && u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) return 'gif';
        if (u8.length > 2 && u8[0] === 0x42 && u8[1] === 0x4D) return 'bmp';
        return null;
    }

    window.__imgLogic = {
        SCHEMA: SCHEMA,
        emptyMeta: emptyMeta,
        loadMeta: loadMeta,
        saveMeta: saveMeta,
        deleteMeta: deleteMeta,
        emptyStrokes: emptyStrokes,
        loadStrokes: loadStrokes,
        saveStrokes: saveStrokes,
        validateStroke: validateStroke,
        validateStrokes: validateStrokes,
        validateLayers: validateLayers,
        sniffImageType: sniffImageType
    };
})();
