/* SuperSplat APK —— 工程管理界面层（双页 UI）
 *
 *   工程页（全屏）↔ 编辑器页（原 SuperSplat 场景，不动其布局）
 *
 * 编辑器页只加一条左上角的「保存 / 返回」小条 —— 场景本身的工具栏、
 * 底栏、右栏全部保持原样，这是老板明确要求的边界。
 *
 * 依赖：fflate.js（zip）、projects.js（window.__projectLogic）
 * 引擎侧：window.__director.projectSnapshot / restoreProject / projectModel / projectPropFiles
 */
(function () {
    'use strict';

    var L = window.__projectLogic;
    if (!L) { console.error('[projects] __projectLogic 未加载'); return; }

    // 延迟取存储：Capacitor 的平台判定在原生注入完成后才可靠
    function store() { return L.store(); }

    var currentProject = null;      // 当前打开的项目名
    var lastSavedSnapshot = null;   // 最近一次保存的快照（脏检查用）
    var busy = false;

    /* ===================== DOM ===================== */

    var page, listEl, emptyEl, barEl, toastEl;

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    function build() {
        // ---- 工程页 ----
        page = el('div', 'pj-page');
        page.id = 'pjPage';

        var head = el('div', 'pj-head');
        head.appendChild(el('div', 'pj-title', '工程'));
        var newBtn = el('button', 'pj-new', '＋ 新建');
        newBtn.addEventListener('click', function () { openNewDialog(); });
        head.appendChild(newBtn);
        page.appendChild(head);

        listEl = el('div', 'pj-list');
        page.appendChild(listEl);

        emptyEl = el('div', 'pj-empty');
        emptyEl.innerHTML = '<div class="pj-empty-ico">📁</div><div>还没有工程</div>' +
            '<div class="pj-empty-sub">点右上角「新建」开始</div>';
        page.appendChild(emptyEl);

        document.body.appendChild(page);

        // ---- 编辑器页顶部小条 ----
        barEl = el('div', 'pj-bar');
        var saveBtn = el('button', 'pj-bar-btn', '💾 保存');
        saveBtn.addEventListener('click', function () { saveProject(); });
        var backBtn = el('button', 'pj-bar-btn', '← 返回');
        backBtn.addEventListener('click', function () { backToProjects(); });
        barEl.appendChild(saveBtn);
        barEl.appendChild(backBtn);
        document.body.appendChild(barEl);
        // 条子建好后补两帧再量一次：字体/安全区会改变它的高度
        requestAnimationFrame(function () { requestAnimationFrame(syncEditorBar); });

        // ---- 提示 ----
        toastEl = el('div', 'pj-toast');
        document.body.appendChild(toastEl);

        // ---- 新建对话框 ----
        buildNewDialog();
        // ---- 退出对话框 ----
        buildExitDialog();
    }

    var toastTimer = null;
    function toast(msg) {
        toastEl.textContent = msg;
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
    }

    /* ---------- 新建对话框 ---------- */

    var newDlg, newInput;

    function buildNewDialog() {
        newDlg = el('div', 'pj-dlg-mask');
        var box = el('div', 'pj-dlg');
        box.appendChild(el('div', 'pj-dlg-title', '新建工程'));
        newInput = el('input', 'pj-input');
        newInput.type = 'text';
        newInput.placeholder = '工程名称';
        newInput.maxLength = 50;
        box.appendChild(newInput);

        var hint = el('div', 'pj-dlg-hint', '');
        box.appendChild(hint);

        var row = el('div', 'pj-dlg-row');
        var cancel = el('button', 'pj-dlg-btn', '取消');
        var ok = el('button', 'pj-dlg-btn pj-primary', '创建');
        row.appendChild(cancel);
        row.appendChild(ok);
        box.appendChild(row);
        newDlg.appendChild(box);
        document.body.appendChild(newDlg);

        function close() { newDlg.classList.remove('open'); }
        cancel.addEventListener('click', close);
        newDlg.addEventListener('click', function (e) { if (e.target === newDlg) close(); });

        var submit = function () {
            var v = L.validateProjectName(newInput.value);
            if (!v.ok) {
                hint.textContent = v.reason;
                return;
            }
            var reg = L.loadRegistry();
            if ((reg.projects || []).some(function (p) { return p.name === v.name; })) {
                hint.textContent = '工程「' + v.name + '」已存在';
                return;
            }
            close();
            createProject(v.name);
        };
        ok.addEventListener('click', submit);
        newInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    }

    function openNewDialog() {
        newInput.value = '';
        newDlg.querySelector('.pj-dlg-hint').textContent = '';
        newDlg.classList.add('open');
        setTimeout(function () { newInput.focus(); }, 60);
    }

    /* ---------- 退出对话框 ---------- */

    var exitDlg;

    function buildExitDialog() {
        exitDlg = el('div', 'pj-dlg-mask');
        var box = el('div', 'pj-dlg');
        box.appendChild(el('div', 'pj-dlg-title', '还有未保存的修改'));
        box.appendChild(el('div', 'pj-dlg-hint', '返回工程列表前要怎么处理？'));

        var col = el('div', 'pj-dlg-col');
        var save = el('button', 'pj-dlg-btn pj-primary', '保存并返回');
        var discard = el('button', 'pj-dlg-btn', '直接返回');
        var cancel = el('button', 'pj-dlg-btn', '取消');
        col.appendChild(save);
        col.appendChild(discard);
        col.appendChild(cancel);
        box.appendChild(col);
        exitDlg.appendChild(box);
        document.body.appendChild(exitDlg);

        cancel.addEventListener('click', function () { exitDlg.classList.remove('open'); });
        exitDlg.addEventListener('click', function (e) { if (e.target === exitDlg) exitDlg.classList.remove('open'); });

        save.addEventListener('click', async function () {
            exitDlg.classList.remove('open');
            var ok = await saveProject();
            if (ok) showProjectsPage();
        });
        discard.addEventListener('click', function () {
            exitDlg.classList.remove('open');
            showProjectsPage();
        });
    }

    /* ===================== 页面切换 ===================== */

    function showProjectsPage() {
        currentProject = null;
        lastSavedSnapshot = null;
        page.classList.add('open');
        barEl.classList.remove('open');
        syncEditorBar();
        refreshList();
    }

    function showEditorPage() {
        page.classList.remove('open');
        barEl.classList.add('open');
        syncEditorBar();
    }

    /* 保存/返回小条的位置是固定的（左上角）。停靠区要绕开它，但不能反过来
     * 挤动这条按钮，所以这里把条子的底边实测出来写进 CSS 变量，由 dock.css
     * 让顶部/左右停靠区自己让位。
     * 只在编辑页（条子可见）时生效：body.sd-has-bar 是开关。 */
    function syncEditorBar() {
        // 模块加载时 rAF 就会跑一次，而 barEl 是在 init() 里才创建的，
        // 这里必须护一下，否则读 null.classList 直接抛错（会污染整页运行时）。
        if (!barEl || !document.body) return;
        var on = barEl.classList.contains('open');
        document.body.classList.toggle('sd-has-bar', on);
        if (!on) {
            document.body.style.removeProperty('--sd-bar-bottom');
            return;
        }
        // 先让布局落定再量，否则拿到的是上一次的尺寸
        var r = barEl.getBoundingClientRect();
        var bottom = r.bottom > 0 ? r.bottom + 8 : 0;
        if (bottom) document.body.style.setProperty('--sd-bar-bottom', bottom + 'px');
    }
    addEventListener('resize', syncEditorBar);
    addEventListener('orientationchange', syncEditorBar);

    /* ===================== 列表 ===================== */

    function refreshList() {
        var reg = L.loadRegistry();
        var items = reg.projects || [];
        listEl.innerHTML = '';
        emptyEl.style.display = items.length ? 'none' : 'flex';

        items.forEach(function (item) {
            var card = el('div', 'pj-card');

            var thumb = el('div', 'pj-thumb-empty', '🔮');
            card.appendChild(thumb);

            if (item.hasModel) {
                var p = L.pathsFor(item.name);
                store().read(p.thumb).then(function (u8) {
                    var url = URL.createObjectURL(new Blob([u8], { type: 'image/jpeg' }));
                    var img = document.createElement('img');
                    img.className = 'pj-thumb';
                    img.src = url;
                    img.onload = function () { URL.revokeObjectURL(url); };
                    thumb.replaceWith(img);
                }).catch(function () { /* 没缩略图就留占位 */ });
            }

            var info = el('div', 'pj-info');
            info.appendChild(el('div', 'pj-name', item.name));
            var sub = el('div', 'pj-sub',
                (item.hasModel ? '已有模型' : '空工程') +
                ' · ' + String(item.updatedAt || '').slice(0, 16).replace('T', ' '));
            info.appendChild(sub);
            card.appendChild(info);

            var del = el('button', 'pj-del', '🗑');
            del.addEventListener('click', function (e) {
                e.stopPropagation();
                if (!confirm('删除工程「' + item.name + '」？模型数据会一并删除。')) return;
                var p = L.pathsFor(item.name);
                store().remove(p.dir).then(function () {
                    L.saveRegistry(L.removeProject(L.loadRegistry(), item.name));
                    refreshList();
                });
            });
            card.appendChild(del);

            card.addEventListener('click', function () { openProject(item.name); });
            listEl.appendChild(card);
        });
    }

    /* ===================== 场景 ===================== */

    function clearScene() {
        var scene = window.scene;
        if (!scene || !scene.events) return;
        try { scene.events.fire('scene.clear'); } catch (e) { /* 忽略 */ }
    }

    async function importModelBytes(bytes, filename) {
        var scene = window.scene;
        if (!scene || !scene.events) throw new Error('编辑器未就绪');
        var file = new File([bytes], filename);
        var res = await scene.events.invoke('import', [{ filename: filename, contents: file }]);
        return res;
    }

    /* ===================== 新建 / 打开 ===================== */

    async function createProject(name) {
        currentProject = name;
        lastSavedSnapshot = null;
        clearScene();
        L.saveRegistry(L.upsertProject(L.loadRegistry(), {
            name: name,
            updatedAt: new Date().toISOString(),
            hasModel: false
        }));
        showEditorPage();
        toast('已创建「' + name + '」，请导入模型');
    }

    async function openProject(name) {
        if (busy) return;
        busy = true;
        try {
            var p = L.pathsFor(name);
            var projBytes = await store().read(p.proj);
            var parsed = L.parseProjectFile(projBytes);
            var state = parsed.state;
            var files = parsed.files || {};

            clearScene();

            // 先重建模型：导演台的对象都摆在模型上，且相机包围盒依赖它
            if (state.model && state.model.path && files[state.model.path]) {
                await importModelBytes(files[state.model.path], state.model.name || 'model.ply');
            }

            var d = window.__director;
            if (d && d.restoreProject) {
                var r = await d.restoreProject(state, files);
                if (r && r.ok === false) {
                    toast('部分对象未能还原：' + (r.failed || []).join('、'));
                }
            } else {
                toast('导演台模块未就绪，仅还原模型');
            }

            currentProject = name;
            lastSavedSnapshot = snapshotNow();
            showEditorPage();
            toast('已打开「' + name + '」');
        } catch (err) {
            console.error('[projects] open failed', err);
            toast('打开失败：' + (err && err.message ? err.message : '未知错误'));
        } finally {
            busy = false;
        }
    }

    /* ===================== 快照 ===================== */

    function snapshotNow() {
        var d = window.__director;
        if (!d || !d.projectSnapshot) return null;
        try { return d.projectSnapshot(); } catch (e) { return null; }
    }

    function extOf(name) {
        var m = String(name || '').match(/\.([^.]+)$/);
        return m ? m[1].toLowerCase() : 'ply';
    }

    /* ===================== 保存 ===================== */

    async function saveProject() {
        if (!currentProject) { toast('不在工程中'); return false; }
        if (busy) return false;
        busy = true;
        try {
            var snap = snapshotNow();
            if (!snap) { toast('场景状态未就绪'); return false; }

            var files = {};

            // 模型：工程里带原始字节（Android SAF 路径授权不跨会话，只能内嵌）
            var d = window.__director;
            var model = d && d.projectModel ? d.projectModel() : null;
            if (model && model.bytes && model.bytes.length) {
                var modelPath = 'model.' + extOf(model.name);
                files[modelPath] = model.bytes;
                snap.model = { name: model.name, path: modelPath };
            } else {
                snap.model = null;
            }

            // 道具：每个 GLB 的源字节
            var propFiles = d && d.projectPropFiles ? d.projectPropFiles() : [];
            propFiles.forEach(function (f) { files[f.path] = f.bytes; });

            var zip = L.buildProjectZip(snap, files);
            var p = L.pathsFor(currentProject);

            await store().write(p.proj, zip);

            // 缩略图
            var thumb = await captureThumb();
            if (thumb) await store().write(p.thumb, thumb);

            var meta = {
                name: currentProject,
                updatedAt: new Date().toISOString(),
                hasModel: !!snap.model
            };
            await store().write(p.meta, new TextEncoder().encode(JSON.stringify(meta)));
            L.saveRegistry(L.upsertProject(L.loadRegistry(), meta));

            lastSavedSnapshot = snap;
            toast('已保存「' + currentProject + '」 ' + fmtBytes(zip.length));
            return true;
        } catch (err) {
            console.error('[projects] save failed', err);
            toast('保存失败：' + (err && err.message ? err.message : '未知错误'));
            return false;
        } finally {
            busy = false;
        }
    }

    function fmtBytes(n) {
        if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + 'MB';
        if (n > 1024) return (n / 1024).toFixed(0) + 'KB';
        return n + 'B';
    }

    async function captureThumb() {
        try {
            var scene = window.scene;
            if (!scene || !scene.events) return null;
            var w = 320, h = 180;
            var data = await scene.events.invoke('render.offscreen', w, h);
            if (!data || !data.length) return null;
            var cv = document.createElement('canvas');
            cv.width = w;
            cv.height = h;
            var ctx = cv.getContext('2d');
            var img = ctx.createImageData(w, h);
            img.data.set(data);
            ctx.putImageData(img, 0, 0);
            var blob = await new Promise(function (r) { cv.toBlob(r, 'image/jpeg', 0.7); });
            if (!blob) return null;
            return new Uint8Array(await blob.arrayBuffer());
        } catch (e) {
            console.warn('[projects] thumb failed', e);
            return null;
        }
    }

    /* ===================== 返回 ===================== */

    function backToProjects() {
        if (!currentProject) { showProjectsPage(); return; }
        var cur = snapshotNow();
        if (L.isDirty(cur, lastSavedSnapshot)) {
            exitDlg.classList.add('open');
        } else {
            showProjectsPage();
        }
    }

    /* ===================== 启动 ===================== */

    function init() {
        build();
        // 先盖住编辑器，等用户选工程（避免空场景闪一下）
        page.classList.add('open');
        refreshList();

        // 硬件返回键：在编辑器里退回工程列表，而不是退出 App
        document.addEventListener('backbutton', function (e) {
            if (currentProject) {
                e.preventDefault();
                backToProjects();
            }
        }, false);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 调试/测试钩子
    window.__projects = {
        current: function () { return currentProject; },
        save: saveProject,
        open: openProject,
        create: createProject,
        back: backToProjects,
        list: refreshList
    };
})();
