/* v59 实装 M2：cardgroups-ui.js 全量重写（原型 r3 形态 → APK 实装）
 * 三层 UI：
 *  A. 卡组列表（开始页「🎭 角色卡」入口）：组卡片（头像/名称/角色数/词条数）+ 新建
 *  B. 组编辑抽屉（sheet）：改名、角色卡（头像 📷/名称/标签/删除）、添加角色、
 *     📖 词库（两段式分组：默认原角色描述/替换角色描述 + 自定义分组）、导出 zip/json、导入、删除组
 *  C. 词库 sheet：分组卡（组名/删组）+ 词 chips 逐条删 + 组内添加行 + 新建分组
 * 图片：input image → canvas 256 cover → jpeg dataURL 存卡
 * zip：fflate 打包 charcards.json + chars/<safe>.jpg；导入 .json/.zip 双格式
 * 依赖：CC（charcards v2）、CCG（多套卡组）、fflate（已在 index.html）
 */
(function () {
    'use strict';
    /* v59i：真机排障日志（Capacitor DebugLog，[cg] 前缀；与 [av] 同通道） */
    function dlog(msg) {
        try {
            var cap = window.Capacitor;
            var p = cap && cap.Plugins && cap.Plugins.DebugLog;
            if (p && p.append) {
                var r = p.append({ text: '[cg] ' + msg });
                if (r && r.catch) r.catch(function () { });
            }
            if (window.__MOYUTAI_DEBUG_LOGS) window.__MOYUTAI_DEBUG_LOGS.push('[cg] ' + msg);
        } catch (e) { }
    }
    /* JS 错误兜底捕获（真机 WebView 静默异常排障） */
    window.addEventListener('error', function (ev) {
        dlog('JS ERROR: ' + (ev.message || '?') + ' @' + (ev.filename || '?').split('/').pop() + ':' + ev.lineno);
    });
    window.addEventListener('unhandledrejection', function (ev) {
        dlog('PROMISE REJECT: ' + ((ev.reason && ev.reason.message) || ev.reason || '?'));
    });
    var dlgEl = null;

    function el(tag, cls, txt) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (txt != null) e.textContent = txt;
        return e;
    }
    function toast(msg, isErr) {
        var t = el('div', 'av-toast' + (isErr ? ' av-toast-err' : ''), msg);
        document.body.appendChild(t);
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
    }

    /* ---- 样式（v59 移动端规范：sheet 抽屉/大触控目标/卡片化） ---- */
    var css = document.createElement('style');
    css.textContent = [
        '.cgm-sheet{position:fixed;top:0;right:0;bottom:0;left:0;z-index:2000;display:none;flex-direction:column;justify-content:flex-end}',
        '.cgm-sheet.open{display:flex}',
        '.cgm-mask{position:absolute;top:0;right:0;bottom:0;left:0;background:rgba(0,0,0,.55)}',
        '.cgm-card{position:relative;background:#0b0e14;border-radius:20px 20px 0 0;max-height:92vh;display:flex;flex-direction:column;padding-bottom:env(safe-area-inset-bottom,0px)}',
        '.cgm-grab{width:36px;height:4px;border-radius:2px;background:#2a3345;margin:10px auto 0}',
        '.cgm-head{display:flex;align-items:center;gap:8px;padding:10px 16px 12px;border-bottom:1px solid #2a3345}',
        '.cgm-head .ttl{flex:1;font-size:16px;font-weight:700;color:#e6eef9}',
        '.cgm-head input.ttl{background:none;border:none;color:#e6eef9;min-width:0;padding:0}',
        '.cgm-x{border:none;background:#1d2432;color:#8b98ad;width:30px;height:30px;border-radius:15px;font-size:14px;flex-shrink:0}',
        '.cgm-body{flex:1;overflow-y:auto;padding:14px 16px;scrollbar-width:none}',
        '.cgm-body::-webkit-scrollbar{display:none}',
        '.cgm-foot{padding:10px 16px;border-top:1px solid #2a3345;display:flex;gap:10px}',
        '.cgm-foot .btn{flex:1;padding:12px;font-size:14px;border:none;border-radius:10px;font-weight:600;color:#e6eef9;background:#1d2432}',
        '.cgm-foot .btn.primary{background:#7c6cf0}',
        '.cgm-foot .btn.danger{background:transparent;border:1px solid #e05a5a;color:#e05a5a}',
        '.cg-item{background:#161b26;border:1px solid #2a3345;border-radius:14px;padding:13px;margin-bottom:12px;display:flex;align-items:center;gap:12px}',
        '.cg-item:active{background:#1d2432}',
        '.cg-ico{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#7c6cf0,#5a8df0);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0}',
        '.cg-main{flex:1;min-width:0}',
        '.cg-name{font-size:15px;font-weight:700;color:#e6eef9;margin-bottom:3px}',
        '.cg-meta{font-size:12px;color:#8b98ad}',
        '.cg-meta b{color:#9d8fff;font-weight:600}',
        '.cgm-row{display:flex;gap:8px;margin-top:8px}',
        '.cgm-row input{flex:1;background:#161b26;border:1px solid #2a3345;border-radius:9px;padding:9px 12px;font-size:14px;color:#e6eef9;min-width:0}',
        '.cgm-row input:focus{outline:none;border-color:#7c6cf0}',
        '.cgm-row button{border:none;border-radius:9px;padding:9px 14px;font-size:13px;background:#7c6cf0;color:#fff;font-weight:600}',
        '.ch-card{background:#161b26;border:1px solid #2a3345;border-radius:14px;padding:13px;margin-bottom:12px}',
        '.ch-head{display:flex;align-items:center;gap:10px}',
        '.ch-ava-wrap{position:relative;width:44px;height:44px;flex-shrink:0}',
        '.ch-ava{width:44px;height:44px;border-radius:22px;object-fit:cover;display:block;border:1px solid #2a3345}',
        '.ch-ava-ph{width:44px;height:44px;border-radius:22px;background:linear-gradient(135deg,#5a8df0,#7c6cf0);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;color:#fff}',
        '.ch-cam{position:absolute;right:-4px;bottom:-2px;border:none;border-radius:9px;width:20px;height:20px;font-size:11px;background:#1d2432;color:#e6eef9;padding:0;line-height:1}',
        '.ch-rmimg{position:absolute;left:-4px;top:-2px;border:none;border-radius:9px;width:18px;height:18px;font-size:10px;background:#e05a5a;color:#fff;padding:0;line-height:1}',
        '.ch-name{flex:1;font-size:15px;font-weight:700;color:#e6eef9;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.ch-tag{font-size:11px;background:rgba(124,108,240,.18);color:#9d8fff;border-radius:6px;padding:3px 8px}',
        '.ch-del{border:none;background:none;color:#e05a5a;font-size:13px;padding:4px 6px}',
        '.wd-group{background:#161b26;border:1px solid #2a3345;border-radius:14px;padding:13px;margin-bottom:12px}',
        '.wd-head{display:flex;align-items:center;margin-bottom:8px}',
        '.wd-name{flex:1;font-size:14px;font-weight:700;color:#9d8fff}',
        '.wd-del{border:none;background:none;color:#8b98ad;font-size:12px;padding:4px 6px}',
        '.wd-chiprow{display:flex;flex-wrap:wrap;gap:6px}',
        '.wd-chip{display:inline-flex;align-items:center;gap:5px;background:#1d2432;border-radius:8px;padding:6px 10px;font-size:13px;color:#e6eef9}',
        '.wd-chip button{border:none;background:none;color:#8b98ad;font-size:12px;padding:0}',
        '.wd-empty{font-size:12px;color:#8b98ad;padding:4px 0 8px}',
        '.cgm-empty{font-size:13px;color:#8b98ad;text-align:center;padding:24px 0}',
    ].join('\n');
    document.head.appendChild(css);

    function close() { if (dlgEl && dlgEl.parentNode) dlgEl.parentNode.removeChild(dlgEl); dlgEl = null; }

    /* ============ A+B：卡组列表 + 组编辑抽屉 ============ */
    var curGroupId = null;

    function open() {
        dlog('open: CCG=' + !!window.CCG + ' CC=' + !!window.CC + ' groups=' + (window.CCG ? window.CCG.list().length : '?'));
        if (!window.CCG || !window.CC) { toast('卡组模块未加载', true); dlog('open ABORT: modules missing'); return; }
        if (dlgEl) return;
        dlgEl = el('div', 'cgm-sheet open');
        dlgEl.innerHTML =
            '<div class="cgm-mask"></div>' +
            '<div class="cgm-card">' +
            '<div class="cgm-grab"></div>' +
            '<div class="cgm-head"><div class="ttl">🎭 角色卡库</div><button class="cgm-x" data-close>✕</button></div>' +
            '<div class="cgm-body"><div id="cgmList"></div></div>' +
            '<div class="cgm-foot">' +
            '<button class="btn" id="cgmNew">＋ 新建卡组</button>' +
            '<button class="btn" id="cgmImgFolder">📁 导入图片文件夹</button>' +
            '<button class="btn" id="cgmImportZip">导入文件</button>' +
            '</div></div></div>';
        document.body.appendChild(dlgEl);
        dlgEl.querySelector('.cgm-mask').addEventListener('click', close);
        dlgEl.querySelector('[data-close]').addEventListener('click', close);
        dlgEl.querySelector('#cgmNew').addEventListener('click', function () {
            var nm = window.prompt('新卡组名称：');
            if (!nm) return;
            var r = window.CCG.create(nm.trim());
            if (!r) { toast('名称已存在', true); return; }
            renderList(); openGroup(r.id);
        });
        dlgEl.querySelector('#cgmImgFolder').addEventListener('click', function () { importImageFolder(); });
        dlgEl.querySelector('#cgmImportZip').addEventListener('click', function () { importFile(null); });
        renderList();
        dlog('open done: sheet appended');
    }

    function renderList() {
        dlog('renderList: groups=' + window.CCG.list().length);
        var v = dlgEl.querySelector('#cgmList');
        v.innerHTML = '';
        var groups = window.CCG.list();
        if (!groups.length) v.appendChild(el('div', 'cgm-empty', '暂无卡组。新建一套，或「📁 导入图片文件夹」批量建角色'));
        groups.forEach(function (g) {
            var d = g.data;
            var row = el('div', 'cg-item');
            row.appendChild(el('div', 'cg-ico', '🎭'));
            var main = el('div', 'cg-main');
            main.appendChild(el('div', 'cg-name', g.name));
            var words = (d.descGroups || []).reduce(function (n, w) { return n + w.items.length; }, 0);
            main.appendChild(el('div', 'cg-meta', '')).innerHTML = '<b>' + d.cards.length + '</b> 个角色 · ' + words + ' 个描述词';
            row.appendChild(main);
            var ed = el('button', 'chip', '编辑');
            ed.style.cssText = 'border:none;border-radius:8px;padding:6px 10px;font-size:12px;background:#1d2432;color:#8b98ad';
            ed.addEventListener('click', function (e) { e.stopPropagation(); openGroup(g.id); });
            row.appendChild(ed);
            row.addEventListener('click', function () { openGroup(g.id); });
            v.appendChild(row);
        });
    }

    /* ---- B：组编辑抽屉 ---- */
    function openGroup(id) {
        dlog('openGroup: ' + id);
        curGroupId = id;
        var data = window.CCG.get(id);
        if (!data) { toast('卡组不存在', true); dlog('openGroup ABORT: no data'); return; }
        var sh = el('div', 'cgm-sheet open');
        sh.innerHTML =
            '<div class="cgm-mask"></div>' +
            '<div class="cgm-card">' +
            '<div class="cgm-grab"></div>' +
            '<div class="cgm-head">' +
            '<input class="ttl" id="cgmGrpName" placeholder="卡组名称">' +
            '<button class="cgm-x" id="cgmWords" title="描述词库">📖</button>' +
            '<button class="cgm-x" data-close2>✕</button>' +
            '</div>' +
            '<div class="cgm-body">' +
            '<div id="cgmCards"></div>' +
            '<div class="cgm-row"><input id="cgmNewCharName" placeholder="新角色名"><input id="cgmNewCharTag" placeholder="标签(可选)" style="max-width:110px"><button id="cgmAddChar">添加</button></div>' +
            '</div>' +
            '<div class="cgm-foot">' +
            '<button class="btn" id="cgmGrpExport">导出</button>' +
            '<button class="btn" id="cgmGrpImport">导入</button>' +
            '<button class="btn danger" id="cgmGrpDel">删除组</button>' +
            '<button class="btn primary" id="cgmGrpDone">完成</button>' +
            '</div></div></div>';
        document.body.appendChild(sh);
        sh.querySelector('.cgm-mask').addEventListener('click', function () { sh.parentNode.removeChild(sh); renderList(); });
        sh.querySelector('[data-close2]').addEventListener('click', function () { sh.parentNode.removeChild(sh); renderList(); });
        sh.querySelector('#cgmGrpName').value = window.CCG.nameOf(id);
        sh.querySelector('#cgmGrpName').addEventListener('change', function () {
            var nm = this.value.trim(); if (!nm) return;
            if (!window.CCG.rename(id, nm)) toast('改名失败（重名？）', true);
            else { toast('已改名'); renderList(); }
        });
        sh.querySelector('#cgmAddChar').addEventListener('click', function () {
            var nm = sh.querySelector('#cgmNewCharName').value.trim();
            var tag = sh.querySelector('#cgmNewCharTag').value.trim();
            if (!nm) { toast('先填角色名', true); return; }
            try { window.CC.addCard(data, nm, tag); } catch (e) { toast(e.message, true); return; }
            window.CCG.saveData(id, data);
            sh.querySelector('#cgmNewCharName').value = ''; sh.querySelector('#cgmNewCharTag').value = '';
            renderCards(sh, id, data); renderList(); toast('已添加 ' + nm);
        });
        sh.querySelector('#cgmWords').addEventListener('click', function () { openWords(id); });
        sh.querySelector('#cgmGrpExport').addEventListener('click', function () { exportGroup(id); });
        sh.querySelector('#cgmGrpImport').addEventListener('click', function () { importFile(id, sh); });
        sh.querySelector('#cgmGrpDel').addEventListener('click', function () {
            var nm = window.CCG.nameOf(id);
            if (!window.confirm('删除卡组「' + nm + '」？')) return;
            window.CCG.remove(id);
            sh.parentNode.removeChild(sh); renderList(); toast('已删除 ' + nm);
        });
        sh.querySelector('#cgmGrpDone').addEventListener('click', function () {
            sh.parentNode.removeChild(sh); renderList();
        });
        renderCards(sh, id, data);
    }

    function renderCards(sh, id, data) {
        var v = sh.querySelector('#cgmCards');
        v.innerHTML = '';
        if (!data.cards.length) v.appendChild(el('div', 'cgm-empty', '还没有角色。下面添加第一个'));
        data.cards.forEach(function (c) {
            var card = el('div', 'ch-card');
            var head = el('div', 'ch-head');
            var wrap = el('div', 'ch-ava-wrap');
            if (c.img) {
                var img = el('img', 'ch-ava'); img.src = c.img; wrap.appendChild(img);
                var rm = el('button', 'ch-rmimg', '✕');
                rm.addEventListener('click', function () {
                    window.CC.setCardImg(data, c.id, null);
                    window.CCG.saveData(id, data);
                    renderCards(sh, id, data); toast('已清除图片');
                });
                wrap.appendChild(rm);
            } else {
                wrap.appendChild(el('div', 'ch-ava-ph', c.name.charAt(0)));
            }
            var cam = el('button', 'ch-cam', '📷');
            cam.addEventListener('click', function () {
                var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
                inp.addEventListener('change', function () {
                    var f = inp.files && inp.files[0]; if (!f) return;
                    var rd = new FileReader();
                    rd.onload = function () {
                        var im = new Image();
                        im.onload = function () {
                            var S = 256, cv = document.createElement('canvas'); cv.width = S; cv.height = S;
                            var cx = cv.getContext('2d');
                            var sc = Math.max(S / im.width, S / im.height);
                            var w = im.width * sc, hh = im.height * sc;
                            cx.drawImage(im, (S - w) / 2, (S - hh) / 2, w, hh);
                            window.CC.setCardImg(data, c.id, cv.toDataURL('image/jpeg', 0.82));
                            window.CCG.saveData(id, data);
                            renderCards(sh, id, data); toast('已更新 ' + c.name + ' 的图片');
                        };
                        im.src = rd.result;
                    };
                    rd.readAsDataURL(f);
                });
                inp.click();
            });
            wrap.appendChild(cam);
            head.appendChild(wrap);
            head.appendChild(el('div', 'ch-name', c.name));
            if (c.tag) head.appendChild(el('span', 'ch-tag', c.tag));
            var del = el('button', 'ch-del', '删除');
            del.addEventListener('click', function () {
                if (!window.confirm('删除角色「' + c.name + '」？')) return;
                window.CC.removeCard(data, c.id);
                window.CCG.saveData(id, data);
                renderCards(sh, id, data); renderList(); toast('已删除');
            });
            head.appendChild(del);
            card.appendChild(head);
            v.appendChild(card);
        });
    }

    /* ---- C：词库抽屉 ---- */
    function openWords(id) {
        var data = window.CCG.get(id);
        if (!data) return;
        window.CC.normalize(data); /* 确保 descGroups 存在 */
        var sh = el('div', 'cgm-sheet open');
        sh.innerHTML =
            '<div class="cgm-mask"></div>' +
            '<div class="cgm-card">' +
            '<div class="cgm-grab"></div>' +
            '<div class="cgm-head"><div class="ttl">📖 描述词库</div><button class="cgm-x" data-close3>✕</button></div>' +
            '<div class="cgm-body">' +
            '<div id="cgmWords"></div>' +
            '<div class="cgm-row"><input id="cgmNewGrp" placeholder="新分组名"><button id="cgmAddGrp">新建分组</button></div>' +
            '</div></div></div>';
        document.body.appendChild(sh);
        var closeWords = function () {
            window.CCG.saveData(id, data);
            sh.parentNode.removeChild(sh);
        };
        sh.querySelector('.cgm-mask').addEventListener('click', closeWords);
        sh.querySelector('[data-close3]').addEventListener('click', closeWords);
        sh.querySelector('#cgmAddGrp').addEventListener('click', function () {
            var nm = sh.querySelector('#cgmNewGrp').value.trim();
            if (!nm) { toast('先填分组名', true); return; }
            try { window.CC.addGroup(data, nm); } catch (e) { toast(e.message, true); return; }
            window.CCG.saveData(id, data);
            sh.querySelector('#cgmNewGrp').value = '';
            renderWords(sh, data); toast('已新建分组 ' + nm);
        });
        renderWords(sh, data);
    }

    function renderWords(sh, data) {
        dlog('renderWords: groups=' + (data.descGroups || []).length);
        var v = sh.querySelector('#cgmWords');
        v.innerHTML = '';
        if (!data.descGroups.length) v.appendChild(el('div', 'cgm-empty', '暂无分组'));
        data.descGroups.forEach(function (grp) {
            var box = el('div', 'wd-group');
            var head = el('div', 'wd-head');
            head.appendChild(el('div', 'wd-name', grp.name));
            var del = el('button', 'wd-del', '删组');
            del.addEventListener('click', function () {
                if (!window.confirm('删除分组「' + grp.name + '」及其 ' + grp.items.length + ' 个词？')) return;
                window.CC.removeGroup(data, grp.name);
                window.CCG.saveData(sh ? sh.id || null : null, data) /* noop */;
                window.CCG.saveData(curGroupId, data);
                renderWords(sh, data); toast('已删除分组');
            });
            head.appendChild(del);
            box.appendChild(head);
            if (!grp.items.length) box.appendChild(el('div', 'wd-empty', '（暂无词汇）'));
            else {
                var chips = el('div', 'wd-chiprow');
                grp.items.forEach(function (w, wi) {
                    var chip = el('span', 'wd-chip');
                    chip.appendChild(el('span', null, w));
                    var rm = el('button', null, '✕');
                    rm.addEventListener('click', function () {
                        window.CC.removeWord(data, grp.name, w);
                        window.CCG.saveData(curGroupId, data);
                        renderWords(sh, data);
                    });
                    chip.appendChild(rm);
                    chips.appendChild(chip);
                });
                box.appendChild(chips);
            }
            var row = el('div', 'cgm-row');
            var inp = el('input'); inp.placeholder = '新词汇';
            var btn = el('button', null, '添加');
            btn.addEventListener('click', function () {
                try { window.CC.addWord(data, grp.name, inp.value); } catch (e) { toast(e.message, true); return; }
                window.CCG.saveData(curGroupId, data);
                renderWords(sh, data);
            });
            row.appendChild(inp); row.appendChild(btn);
            box.appendChild(row);
            v.appendChild(box);
        });
    }

    /* ---- v59k：导入图片文件夹 → 角色卡组 ----
     * 选文件夹 → 列图片（jpg/jpeg/png/webp）→ 同名取第一张 → 逐张缩 256 头像 → 建同名卡组
     * 图片文件名（去扩展名）= 角色名；组名 = 文件夹名（同名组覆盖）
     */
    function importImageFolder() {
        var p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.MediaServer;
        if (!p || !p.pickFolder) { toast('需要 APK 环境（MediaServer 插件）', true); return; }
        toast('选择包含角色图的文件夹');
        var treeUriStr = null;
        p.pickFolder().then(function (r) {
            if (!r || !r.uri) return;   /* 用户取消 */
            treeUriStr = r.uri;
            var folderName = (r.name || '导入卡组').split('/').pop() || '导入卡组';
            dlog('imgFolder picked: ' + folderName + ' tree=' + String(r.uri).slice(0, 60));
            return p.listFiles({ uri: r.uri }).then(function (ls) {
                var files = (ls && ls.files) || [];
                var seen = {};
                var picked = [];
                files.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
                files.forEach(function (f) {
                    var base = f.name.replace(/\.[^.]+$/, '');
                    if (seen[base]) return;   /* 重名取第一张 */
                    seen[base] = true;
                    if (!f.uri) { dlog('imgFolder skip no-uri: ' + f.name); return; }   /* 修复后 listFiles 必带 uri */
                    var mExt = (/\.(jpg|jpeg|png|webp|gif|bmp)$/i.exec(f.name) || ['', 'png'])[1].toLowerCase();
                    picked.push({ name: base, uri: f.uri, docId: f.docId, ext: mExt, raw: f });
                });
                if (!picked.length) { toast('该文件夹没有图片（支持 jpg/png/webp）', true); return; }
                dlog('imgFolder files=' + picked.length + '/' + files.length);
                return buildCardsFromImages(folderName, picked, p, treeUriStr);
            });
        }).catch(function (e) {
            dlog('imgFolder ERR: ' + (e && e.message || e));
            toast('导入失败：' + (e && e.message || e), true);
        });
    }

    function buildCardsFromImages(folderName, picked, p, treeUriStr) {
        var cards = { schema: 'moyutai.charcards.v1', orig_char_descs: [], dest_char_descs: [], cards: [] };
        var idx = 0, ok = 0, fail = 0;
        var S2 = 256;
        var total = picked.length;
        if (window.Prog) window.Prog.show('导入角色图片 (0/' + total + ')');
        function next() {
            if (idx >= picked.length) {
                if (window.Prog) window.Prog.set(1, '保存卡组…');
                var r = window.CCG.importPack(folderName, cards);
                if (!r) { toast('保存卡组失败', true); return; }
                dlog('imgFolder done: ok=' + ok + ' fail=' + fail + ' group=' + folderName);
                if (window.Prog) window.Prog.done('已导入 ' + ok + ' 个角色');
                toast(ok ? '已导入 ' + ok + ' 个角色' + (fail ? '（' + fail + ' 张读取失败）' : '') : '没有可用图片', !ok);
                renderList();
                return;
            }
            var it = picked[idx++];
            if (window.Prog) window.Prog.set((idx - 1) / total, '处理 ' + it.name);
            p.readBytes({ uri: it.uri, tree: treeUriStr, docId: it.docId }).then(function (rb) {
                var im = new Image();
                im.onload = function () {
                    try {
                        var cv = document.createElement('canvas'); cv.width = S2; cv.height = S2;
                        var cx = cv.getContext('2d');
                        var sc = Math.max(S2 / im.width, S2 / im.height);
                        cx.drawImage(im, (S2 - im.width * sc) / 2, (S2 - im.height * sc) / 2, im.width * sc, im.height * sc);
                        var card = { id: 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), name: it.name, tag: '' };
                        card.img = cv.toDataURL('image/jpeg', 0.82);
                        /* v60c：原图完整保留（导出时进 chars_full/） */
                        card.imgFull = 'data:image/' + (it.ext || 'png') + ';base64,' + rb.base64;
                        cards.cards.push(card);
                        ok++;
                    } catch (e) { fail++; dlog('imgFolder decode ERR ' + it.name + ': ' + e.message); }
                    setTimeout(next, 0);
                };
                im.onerror = function () { fail++; dlog('imgFolder img ERR: ' + it.name); setTimeout(next, 0); };
                im.src = 'data:image/*;base64,' + rb.base64;
            }).catch(function (e) {
                fail++; dlog('imgFolder read ERR ' + it.name + ': ' + (e && e.message || e));
                setTimeout(next, 0);
            });
        }
        next();
    }

    /* ---- 导出/导入（json + zip 双格式，fflate） ---- */
    function dataUrlToU8(dataUrl) {
        var b64 = dataUrl.split(',')[1];
        var bin = atob(b64);
        var u8 = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return u8;
    }
    function u8ToDataUrl(u8) {
        var bin = '';
        var CH = 0x8000;
        for (var i = 0; i < u8.length; i += CH) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
        return 'data:image/jpeg;base64,' + btoa(bin);
    }
    function u8ToB64(u8) {
        var CH = 0x8000, out = [], pos = 0;
        while (pos < u8.length) {
            out.push(String.fromCharCode.apply(null, u8.subarray(pos, pos + CH)));
            pos += CH;
        }
        return btoa(out.join(''));
    }

    function exportGroup(id) {
        dlog('exportGroup: ' + id);
        var data = window.CCG.get(id);
        var nm = window.CCG.nameOf(id);
        if (!data) return;
        /* v60d：原图在 IDB（localStorage 只留头像）——导出前合并 */
        var doExport = function (data2) {
            exportGroupInner(id, data2, nm);
        };
        if (window.CGFull && window.CGFull.all) {
            window.CGFull.all(id).then(function (fulls) {
                var data2 = JSON.parse(JSON.stringify(data));
                (data2.cards || []).forEach(function (c) {
                    if (fulls[c.id]) c.imgFull = fulls[c.id];
                });
                doExport(data2);
            }).catch(function (e) {
                dlog('exportGroup fulls read ERR: ' + (e && e.message || e));
                doExport(data);   /* 降级：只导头像 */
            });
        } else {
            doExport(data);
        }
    }

    function exportGroupInner(id, data, nm) {
        var plan = window.CC.exportPlan(data);
        if (window.Prog) window.Prog.show('导出卡组…');
        var jsonU8 = new TextEncoder().encode(JSON.stringify(plan.json, null, 2));
        var entries = { 'charcards.json': jsonU8 };
        var done = function () {
            if (window.Prog) window.Prog.set(0.95, '打包 zip…');
            window.fflate.zip(entries, function (err, zipped) {
                if (err) { if (window.Prog) window.Prog.hide(); toast('打包失败', true); return; }
                if (window.Prog) window.Prog.done('已编码 ' + (zipped ? zipped.length : 0) + ' B');
                /* v60b：APK 走原生分享面板（<a download> 在 WebView 无效）；网页保留下载兜底 */
                var sp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SaveImage;
                var fname = 'charcards-' + nm + '.zip';
                if (sp && sp.shareFile) {
                    var b64 = u8ToB64(zipped);
                    sp.shareFile({ data: b64, filename: fname, mime: 'application/zip' }).then(function () {
                        toast('已导出 ' + fname + '（分享面板）');
                    }).catch(function (e) { toast('分享失败：' + (e && e.message || e), true); });
                    return;
                }
                var blob = new Blob([zipped], { type: 'application/zip' });
                var a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = fname;
                a.click();
                toast('已导出 ' + fname);
            });
        };
        if (!plan.images.length) { done(); return; }
        var left = plan.images.length, gi = 0, gt = plan.images.length;
        plan.images.forEach(function (im) {
            entries[im.file] = dataUrlToU8(im.dataUrl);
            left--; gi++;
            if (window.Prog) window.Prog.set(gt ? gi / gt * 0.9 : 0.9, '打包图片 ' + gi + '/' + gt);
            if (left === 0) done();
        });
    }
    function importFile(groupId, parentSheet) {
        var inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '*/*'; /* SAF 常按 MIME 过滤，锁死 .zip 会导致导出的 zip 选不到 */
        inp.addEventListener('change', function () {
            var f = inp.files && inp.files[0]; if (!f) { dlog('import: no file'); return; }
            dlog('import: file=' + f.name + ' size=' + f.size + ' type=' + (f.type || '?'));
            var rd = new FileReader();
            rd.onload = function () {
                try {
                    if (window.Prog) window.Prog.show('\u5bfc\u5165\u5361\u7ec4\u2026');
                    /* v61c：按魔数判 zip（分享面板保存后可能丢掉扩展名） */
                    var isZip = false;
                    if (rd.result instanceof ArrayBuffer) {
                        var head = new Uint8Array(rd.result.slice(0, 4));
                        isZip = (head[0] === 0x50 && head[1] === 0x4B) ||
                                /^\.(zip|apk)$/i.test(f.name) || /\.zip$/i.test(f.type || '');
                    }
                    dlog('import: mode=' + (isZip ? 'zip' : 'json'));
                    if (isZip) {
                        var bytes = rd.result instanceof ArrayBuffer ? new Uint8Array(rd.result) : null;
                        if (!bytes) { if (window.Prog) window.Prog.hide(); toast('\u8bfb\u6587\u4ef6\u5931\u8d25', true); return; }
                        window.fflate.unzip(bytes, function (err, unzipped) {
                            if (err) { if (window.Prog) window.Prog.hide(); dlog('import: unzip ERR ' + (err && err.message || err)); toast('zip \u89e3\u6790\u5931\u8d25', true); return; }
                            var keys = Object.keys(unzipped || {});
                            dlog('import: zip entries=' + keys.length + ' ' + keys.slice(0, 8).join(','));
                            /* charcards.json 允许在子目录 */
                            var jk = keys.filter(function (k) { return /(^|\/)charcards\.json$/i.test(k); })[0];
                            if (!jk) { if (window.Prog) window.Prog.hide(); dlog('import: no charcards.json in zip'); toast('zip \u91cc\u7f3a charcards.json', true); return; }
                            var data = JSON.parse(new TextDecoder().decode(unzipped[jk]));
                            /* 头像 + 原图都入表；同时放带前缀键和纯文件名键 */
                            var imgMap = {};
                            keys.forEach(function (k) {
                                if (!/^chars(_full)?\//i.test(k)) return;
                                var du = u8ToDataUrl(unzipped[k]);
                                imgMap[k] = du;                                   /* chars/GPT.jpg */
                                imgMap[k.replace(/^chars(_full)?\//i, '')] = du;  /* GPT.jpg */
                            });
                            dlog('import: cards=' + ((data.cards || []).length) + ' imgs=' + Object.keys(imgMap).length);
                            if (window.Prog) window.Prog.set(0.75, '\u5199\u5165\u5361\u7ec4\u2026');
                            applyImport(data, imgMap, groupId, parentSheet);
                            if (window.Prog) window.Prog.done('\u5df2\u5bfc\u5165 ' + ((data.cards || []).length) + ' \u4e2a\u89d2\u8272');
                        });
                        return;
                    }
                    /* JSON 分支：先解码字节（rd.result 是 ArrayBuffer） */
                    var raw = '';
                    try {
                        var u8 = new Uint8Array(rd.result);
                        /* 去 BOM */
                        var s0 = u8.length && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF ? 3 : 0;
                        raw = new TextDecoder('utf-8').decode(u8.subarray(s0));
                    } catch (e0) { raw = String(rd.result || ''); }
                    var jd = JSON.parse(raw);
                    if (!jd || !Array.isArray(jd.cards)) {
                        if (window.Prog) window.Prog.hide();
                        var isMarks = !!(jd && jd.marks && jd.schema);
                        dlog('import: json without cards (marks=' + isMarks + ')');
                        toast(isMarks ? '这是打标 JSON，不含角色卡；请导入导出的 ZIP' : '这个 JSON 里没有角色卡', true);
                        return;
                    }
                    var inline = 0;
                    (jd.cards || []).forEach(function (c) { if (c.img || c.imgFull) inline++; });
                    var refs = (jd.cards || []).filter(function (c) { return c.imgFile || c.imgFullFile; }).length;
                    dlog('import: json cards=' + ((jd.cards || []).length) + ' inlineImgs=' + inline + ' fileRefs=' + refs);
                    if (window.Prog) window.Prog.set(0.7, '\u5199\u5165\u5361\u7ec4\u2026');
                    applyImport(jd, {}, groupId, parentSheet);
                    if (window.Prog) window.Prog.done('\u5df2\u5bfc\u5165');
                    if (refs && !inline) {
                        toast('此 JSON 只引用了图片路径，请改导入导出的 ZIP（含图片）', true);
                    }
                } catch (e) { if (window.Prog) window.Prog.hide(); dlog('import: ERR ' + (e && (e.message || e))); toast('\u5bfc\u5165\u5931\u8d25: ' + (e && e.message), true); }
            };
            /* v61c：一律先读 ArrayBuffer，再按魔数决定 zip/json */
            rd.readAsArrayBuffer(f);
        });
        inp.click();
    }

    function applyImport(data, imgMap, groupId, parentSheet) {
        /* 目标：有 groupId（组内导入）→ 覆写该组；无 → 新建卡组（名取文件名去前缀） */
        var v2 = window.CC.importFromParts(data, imgMap);
        var gid;
        if (groupId) {
            gid = groupId;
        } else {
            var r = window.CCG.importPack('导入卡组 ' + new Date().toISOString().slice(0, 10), v2);
            if (!r) { toast('导入失败', true); return; }
            gid = r.id;
            toast('已导入为新卡组');
        }
        window.CCG.saveData(gid, v2);
        if (parentSheet) renderCards(parentSheet, gid, window.CCG.get(gid));
        renderList();
    }

    window.__cardgroups = { open: open };
})();
