/* ============================================================
 * v59 实装 M1：charcards.js 升级 v2（descGroups 词库 + 卡 img）
 * 老板定稿（2026-11-11）：
 *  - 不做旧角色系统兼容（未正式使用）
 *  - 打标页「备注（双描述选择）」和「角色遮罩」适配新数据源
 *  - 移动端交互/UI 按原型 r3
 * v2 结构：
 *   { schema:'moyutai.charcards.v2',
 *     descGroups:[{name, items:[]}],   // 默认两组：全局描述/提示词扩写
 *     cards:[{id,name,tag,img?}] }     // img: dataURL（jpeg 256px 内）
 * 兼容读：v1 的 orig_char_descs/dest_char_descs → 迁入默认两组；卡多余字段丢弃
 *
 * v69（老板 2026-11-15 定改名）：默认两组改叫「全局描述」/「提示词扩写」，
 * 对应 marks.json 的 global_desc / prompt_extend。老数据里的「原角色描述」
 * 「替换角色描述」连同词条一起迁过来（不丢词），v1 的两个数组也照旧读。
 * 全局描述组常驻一条「启用思考」默认词。
 * 本文件只改数据层；DOM/UI 在 av-ui/cardgroups-ui。
 * ============================================================ */
'use strict';
(function (global) {
    var SCHEMA_V2 = 'moyutai.charcards.v2';
    var SCHEMA_V1 = 'moyutai.charcards.v1';
    /* v69：默认两组改名 —— 原角色描述→全局描述、替换角色描述→提示词扩写。
     * 「全局描述」常驻一条默认词「启用思考」：老板要求默认词库必须有它，
     * 否则打标页第一次打开只有空组，看不到能用的默认词。 */
    var GROUP_GLOBAL = '全局描述';
    var GROUP_PROMPT = '提示词扩写';
    var GROUP_LEGACY = { '原角色描述': GROUP_GLOBAL, '替换角色描述': GROUP_PROMPT };
    var WORD_ENABLE_THINK = '启用思考';
    var DEFAULT_GROUPS = function () {
        return [
            { name: GROUP_GLOBAL, items: [WORD_ENABLE_THINK] },
            { name: GROUP_PROMPT, items: [] }
        ];
    };
    /* 老词组名 → 新词组名（幂等；已经是新名原样返回） */
    function migrateGroupName(n) { return GROUP_LEGACY[n] || n; }

    function newId() {
        var s = '';
        for (var i = 0; i < 8; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)];
        return 'c-' + s;
    }

    function emptyCards() {
        return { schema: SCHEMA_V2, descGroups: DEFAULT_GROUPS(), cards: [] };
    }

    /* 接受 v1/v2 */
    function isCardsFile(o) {
        if (!o || !Array.isArray(o.cards)) return false;
        return o.schema === SCHEMA_V2 || o.schema === SCHEMA_V1;
    }

    /* v1 → v2 迁移（就地升级；v2 原样规范化） */
    function toV2(raw) {
        var f = emptyCards();
        if (!raw || typeof raw !== 'object') return f;
        if (raw.schema === SCHEMA_V2 && Array.isArray(raw.descGroups)) {
            f.descGroups = raw.descGroups
                .filter(function (g) { return g && typeof g.name === 'string' && g.name.length > 0; })
                .map(function (g) {
                    /* v69：老词组名就地改名；同名新组已存在时后面 normalize 会合并 */
                    return { name: migrateGroupName(g.name), items: (Array.isArray(g.items) ? g.items : []).filter(function (x) { return typeof x === 'string' && x.length > 0; }) };
                });
            if (!f.descGroups.length) f.descGroups = DEFAULT_GROUPS();
        } else {
            /* v1 迁移（v69：两个数组进新名分组） */
            f.descGroups = DEFAULT_GROUPS();
            f.descGroups[0].items = [];   // 先清掉默认词，v1 有词时按 v1 的来
            (Array.isArray(raw.orig_char_descs) ? raw.orig_char_descs : []).forEach(function (w) {
                if (typeof w === 'string' && w.length > 0 && f.descGroups[0].items.indexOf(w) < 0) f.descGroups[0].items.push(w);
            });
            (Array.isArray(raw.dest_char_descs) ? raw.dest_char_descs : []).forEach(function (w) {
                if (typeof w === 'string' && w.length > 0 && f.descGroups[1].items.indexOf(w) < 0) f.descGroups[1].items.push(w);
            });
        }
        (Array.isArray(raw.cards) ? raw.cards : []).forEach(function (c) {
            if (!c || typeof c.id !== 'string' || !c.id || typeof c.name !== 'string' || !c.name) return;
            var card = { id: c.id, name: c.name, tag: typeof c.tag === 'string' ? c.tag : '' };
            if (typeof c.img === 'string' && c.img.indexOf('data:image') === 0) card.img = c.img;
            /* v60c：原图完整保留（导入时未缩放的 dataURL）；ext 从 mime 嗅探 */
            if (typeof c.imgFull === 'string' && c.imgFull.indexOf('data:image') === 0) card.imgFull = c.imgFull;
            f.cards.push(card);
        });
        return f;
    }

    function normalize(raw) {
        var f = toV2(raw);

        /* v69：老组名迁移后可能与新组名撞车（比如已有「全局描述」又存在
         * 「原角色描述」），先按名字合并，词条取并集不丢词。 */
        var merged = [];
        f.descGroups.forEach(function (g) {
            var hit = null;
            for (var i = 0; i < merged.length; i++) {
                if (merged[i].name === g.name) { hit = merged[i]; break; }
            }
            if (!hit) { merged.push({ name: g.name, items: g.items.slice() }); return; }
            g.items.forEach(function (w) { if (hit.items.indexOf(w) < 0) hit.items.push(w); });
        });
        f.descGroups = merged;

        /* v60b：默认两组常驻——有词保词、没词补空组、顺序固定最前（打开词库必见） */
        DEFAULT_GROUPS().forEach(function (dg, di) {
            var idx = f.descGroups.indexOf(f.descGroups.filter(function (g) { return g.name === dg.name; })[0]);
            var g = idx >= 0 ? f.descGroups.splice(idx, 1)[0] : { name: dg.name, items: [] };
            f.descGroups.splice(di, 0, g);
        });

        /* v69：全局描述组不能是空组——空的就补回默认词「启用思考」。
         * 只在「空」时补，故意删光也会回填一条默认词，但用户自己加的词不会被覆盖。 */
        var gg = f.descGroups[0];
        if (gg.items.length === 0) gg.items.push(WORD_ENABLE_THINK);

        /* 根因修复（老板 2026-11-15 报「默认词组不显示、只有新建分组才冒出来」）：
         * normalize 以前返回新对象、调用方 CC.normalize(data) 把返回值丢了，
         * 于是 v1 素材永远没有 descGroups。这里把结果就地写回入参，
         * 让「丢弃返回值」的调用方式也能生效。 */
        if (raw && typeof raw === 'object') {
            raw.schema = f.schema;
            raw.descGroups = f.descGroups;
            raw.cards = f.cards;
        }
        return f;
    }

    /* ---------- 卡 CRUD（与 v1 语义一致，去掉描述绑定） ---------- */
    function addCard(f, name, tag) {
        name = (name || '').trim();
        if (!name) throw new Error('角色名不能为空');
        if (f.cards.some(function (c) { return c.name === name; })) throw new Error('角色已存在：' + name);
        var card = { id: newId(), name: name, tag: (tag || '').trim() };
        f.cards.push(card);
        return card;
    }
    function removeCard(f, id) {
        var before = f.cards.length;
        f.cards = f.cards.filter(function (c) { return c.id !== id; });
        return f.cards.length !== before;
    }
    function renameCard(f, id, name) {
        name = (name || '').trim();
        if (!name) throw new Error('角色名不能为空');
        if (f.cards.some(function (c) { return c.id !== id && c.name === name; })) throw new Error('角色已存在：' + name);
        var c = f.cards.filter(function (x) { return x.id === id; })[0];
        if (!c) throw new Error('角色不存在');
        c.name = name;
        return c;
    }
    function setCardTag(f, id, tag) {
        var c = f.cards.filter(function (x) { return x.id === id; })[0];
        if (!c) throw new Error('角色不存在');
        c.tag = (tag || '').trim();
        return c;
    }
    function setCardImg(f, id, dataUrl) {
        var c = f.cards.filter(function (x) { return x.id === id; })[0];
        if (!c) throw new Error('角色不存在');
        if (dataUrl && typeof dataUrl === 'string' && dataUrl.indexOf('data:image') === 0) c.img = dataUrl;
        else delete c.img;
        return c;
    }
    function findByName(f, name) {
        return f.cards.filter(function (c) { return c.name === name; })[0] || null;
    }

    /* ---------- 词库 CRUD ---------- */
    function ensureGroups(f) {
        if (!Array.isArray(f.descGroups) || !f.descGroups.length) f.descGroups = DEFAULT_GROUPS();
        return f;
    }
    function addGroup(f, name) {
        name = (name || '').trim();
        if (!name) throw new Error('分组名不能为空');
        ensureGroups(f);
        if (f.descGroups.some(function (g) { return g.name === name; })) throw new Error('分组已存在：' + name);
        var g = { name: name, items: [] };
        f.descGroups.push(g);
        return g;
    }
    function removeGroup(f, name) {
        ensureGroups(f);
        var before = f.descGroups.length;
        f.descGroups = f.descGroups.filter(function (g) { return g.name !== name; });
        return f.descGroups.length !== before;
    }
    function renameGroup(f, oldName, newName) {
        newName = (newName || '').trim();
        if (!newName) throw new Error('分组名不能为空');
        ensureGroups(f);
        if (f.descGroups.some(function (g) { return g.name === newName && g.name !== oldName; })) throw new Error('分组已存在：' + newName);
        var g = f.descGroups.filter(function (x) { return x.name === oldName; })[0];
        if (!g) throw new Error('分组不存在');
        g.name = newName;
        return g;
    }
    function addWord(f, groupName, word) {
        word = (word || '').trim();
        if (!word) throw new Error('词汇不能为空');
        ensureGroups(f);
        var g = f.descGroups.filter(function (x) { return x.name === groupName; })[0];
        if (!g) throw new Error('分组不存在');
        if (g.items.indexOf(word) >= 0) throw new Error('词汇已存在');
        g.items.push(word);
        return g;
    }
    function removeWord(f, groupName, word) {
        ensureGroups(f);
        var g = f.descGroups.filter(function (x) { return x.name === groupName; })[0];
        if (!g) return false;
        var before = g.items.length;
        g.items = g.items.filter(function (x) { return x !== word; });
        return g.items.length !== before;
    }
    /* 打标页下拉数据源：某分组的词条（不存在返回 []） */
    function wordsOf(f, groupName) {
        ensureGroups(f);
        var g = f.descGroups.filter(function (x) { return x.name === groupName; })[0];
        return g ? g.items.slice() : [];
    }

    /* ---------- 导入/导出（JSON 与 zip 侧数据组包解包） ---------- */
    function exportJson(f) {
        return JSON.stringify(f, null, 2);
    }
    function importJson(text) {
        var data;
        try { data = JSON.parse(text); } catch (e) { throw new Error('JSON 解析失败'); }
        if (!isCardsFile(data)) throw new Error('格式不符（需 charcards.v1/v2）');
        return normalize(data);
    }
    /* zip 包数据组包：{ 'charcards.json': u8json, 'chars/<safe>.jpg': u8 } —— u8 由调用方转 */
    function safeFileName(name) {
        return String(name).replace(/[\\/:*?"<>|\s]+/g, '_');
    }
    function dataUrlExt(u) {
        var m = /^data:image\/([a-z0-9+.-]+)[;,]/i.exec(u || '');
        return m ? (m[1] === 'jpeg' ? 'jpg' : m[1]) : 'jpg';
    }
    /* opts.inline（默认 true）：
     *   true  —— 头像/原图同时以 base64 内嵌进 charcards.json，单独拿这份 JSON 就能恢复
     *            （卡组库导出用，老板 v61f 明确要求）
     *   false —— 只写 chars/ 与 chars_full/ 路径引用，图片只以二进制条目进 ZIP
     *            （视频打标包用：ZIP 里本来就有文件，内嵌等于同一份原图在内存里存三遍，
     *             debug_28 的 92% 闪退就是这里把 WebView 进程顶爆的） */
    function exportPlan(f, opts) {
        var inline = !opts || opts.inline !== false;
        var cards = f.cards.map(function (c) {
            var cc = { id: c.id, name: c.name, tag: c.tag || '' };
            if (c.img) {
                cc.imgFile = 'chars/' + safeFileName(c.name) + '.jpg';
                if (inline) cc.img = c.img;   /* 内嵌头像：单独拿 JSON 也能带回图片 */
            }
            if (c.imgFull) {
                cc.imgFullFile = 'chars_full/' + safeFileName(c.name) + '.' + dataUrlExt(c.imgFull);
                if (inline) cc.imgFull = c.imgFull;
            }
            return cc;
        });
        var images = f.cards.filter(function (c) { return c.img; }).map(function (c) {
            return { file: 'chars/' + safeFileName(c.name) + '.jpg', name: c.name, dataUrl: c.img };
        });
        /* v60c：原图进包（与头像同名不同目录，互不冲突） */
        f.cards.filter(function (c) { return c.imgFull; }).forEach(function (c) {
            images.push({ file: 'chars_full/' + safeFileName(c.name) + '.' + dataUrlExt(c.imgFull), name: c.name, dataUrl: c.imgFull });
        });
        return { json: { schema: SCHEMA_V2, descGroups: f.descGroups, cards: cards }, images: images };
    }
    /* zip 解包后的组装：jsonObj + imgMap{ '<角色名>.jpg': dataUrl } → v2 */
    /* v61b：zip 导入时 imgMap 的 key 有两种约定（带 chars/ 前缀 或 只有文件名），
     * 统一用 lookupAny 兼容，避免「图片一张都回不来」或只回来名字刚好等于文件名的那些。 */
    function _lookupImg(imgMap, pathLike) {
        if (!imgMap || !pathLike) return null;
        var keys = [
            String(pathLike),
            String(pathLike).replace(/^chars_full\//, '').replace(/^chars\//, ''),
            String(pathLike).split('/').pop()      /* basename */
        ];
        for (var i = 0; i < keys.length; i++) {
            if (keys[i] && imgMap[keys[i]]) return imgMap[keys[i]];
        }
        return null;
    }

    function importFromParts(jsonObj, imgMap) {
        imgMap = imgMap || {};
        /* imgFile 在 normalize 前回填成 img（normalize 只认 data:image 字段） */
        var pre = jsonObj;
        if (pre && Array.isArray(pre.cards)) {
            pre.cards = pre.cards.map(function (c) {
                var cc = Object.assign({}, c);
                var hit = _lookupImg(imgMap, cc.imgFile);
                if (hit) cc.img = hit;
                else if (!cc.img) {
                    /* 老格式兜底：文件名 = 角色名 + .jpg（含安全化后的名字） */
                    var nm = cc.name || '';
                    cc.img = _lookupImg(imgMap, nm + '.jpg') || _lookupImg(imgMap, safeFileName(nm) + '.jpg') || null;
                    if (!cc.img) delete cc.img;
                }
                /* v60c：原图回填 */
                var fullHit = _lookupImg(imgMap, cc.imgFullFile);
                if (fullHit) cc.imgFull = fullHit;
                delete cc.imgFile;
                delete cc.imgFullFile;
                return cc;
            });
        }
        return normalize(pre);
    }

    var CC = {
        SCHEMA: SCHEMA_V2,
        /* v69：默认组名/默认词集中在这里，UI 与导出都从这里取，
         * 免得再出现「改了一处、另一处还写着中文常量」的漏改。 */
        GROUP_GLOBAL: GROUP_GLOBAL,
        GROUP_PROMPT: GROUP_PROMPT,
        WORD_ENABLE_THINK: WORD_ENABLE_THINK,
        defaultGroups: DEFAULT_GROUPS,
        emptyCards: emptyCards,
        isCardsFile: isCardsFile,
        normalize: normalize,
        toV2: toV2,
        addCard: addCard,
        removeCard: removeCard,
        renameCard: renameCard,
        setCardTag: setCardTag,
        setCardImg: setCardImg,
        findByName: findByName,
        addGroup: addGroup,
        removeGroup: removeGroup,
        renameGroup: renameGroup,
        addWord: addWord,
        removeWord: removeWord,
        wordsOf: wordsOf,
        exportJson: exportJson,
        importJson: importJson,
        safeFileName: safeFileName,
        exportPlan: exportPlan,
        importFromParts: importFromParts,
        /* v1 时代遗留 API 兼容（不再有独立描述列表操作） */
        addOrigDesc: function () { throw new Error('v2：描述词请用词库分组 API（addWord）'); },
        addDestDesc: function () { throw new Error('v2：描述词请用词库分组 API（addWord）'); },
        removeOrigDesc: function () { throw new Error('v2：描述词请用词库分组 API（removeWord）'); },
        removeDestDesc: function () { throw new Error('v2：描述词请用词库分组 API（removeWord）'); }
    };

    global.CC = CC;
})(typeof window !== 'undefined' ? window : this);
