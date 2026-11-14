/* 摸鱼台（SuperSplat fork）APK —— 工程管理界面层（双页 UI）
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

    /* v66：三维能力闸门。engine-gate.js 探测 WebGPU 适配器，拿不到就不加载引擎；
     * 此时图片 / 视频 / 音频照常可用，只有 3D 工程要给出明确拒绝而不是白屏。 */
    function no3d() {
        var g = window.__engineGate;
        if (window.__NO_3D) return true;
        return !!(g && g.probed && !g.supported);
    }
    /* v68：3D 工程在无 WebGPU 机器上不该「建不了」。
     * 编辑器初始化路径（ProjectedSplatRenderer → StorageBuffer）确实要 WebGPU，
     * 但建工程、往场景里摆人偶/道具、存回 project.json 全是纯实体变换 + 字节写盘，
     * WebGL2 下跑得动（v68 的 viewer.html 就是这套）。
     * 所以：没有 WebGPU 也允许建 3D 工程，建完直接进场景工作台。 */
    function canCreate3D() { return true; }
    function no3dReason() {
        var g = window.__engineGate;
        if (g && g.reason) return g.reason;
        return '本机不支持 WebGPU，三维导演台无法运行';
    }

    /* ===================== DOM ===================== */

    var page, listEl, emptyEl, barEl, toastEl, crumbEl, gbarEl, cancelBtn, gateBadge;

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
        // v44 解压中心：新建左侧
        var extBtn = el('button', 'pj-new pj-ext-btn', '🗜️ 解压');
        extBtn.addEventListener('click', function () {
            if (window.__extract) window.__extract.open();
        });
        head.appendChild(extBtn);
        // v58：全局角色卡库入口（解压旁）
        /* v59i：真机排障日志（[pj] 前缀，与 [av]/[cg] 同 DebugLog 通道） */
        function dlog(msg) {
            try {
                var cap = window.Capacitor;
                var p = cap && cap.Plugins && cap.Plugins.DebugLog;
                if (p && p.append) {
                    var r = p.append({ text: '[pj] ' + msg });
                    if (r && r.catch) r.catch(function () { });
                }
            } catch (e) { }
        }
        var ccBtn = el('button', 'pj-new pj-ext-btn', '🎭 角色卡');
        ccBtn.addEventListener('click', function () {
            try {
                dlog('🎭 角色卡 clicked: __cardgroups=' + typeof window.__cardgroups);
                if (!window.__cardgroups) { dlog('🎭 ABORT: module undefined'); return; }
                window.__cardgroups.open();
                dlog('🎭 open() returned');
            } catch (e) {
                dlog('🎭 CLICK ERROR: ' + (e && e.message || e));
                try { toast('角色卡打开失败：' + e.message); } catch (e2) { }
            }
        });
        head.appendChild(ccBtn);
        // v44 调试：真机排障日志（发 release 前置 window.__MOYUTAI_RELEASE=true 即隐藏）
        var dbgBtn = el('button', 'pj-new pj-ext-btn', '🐞 日志');
        dbgBtn.id = 'pjDebugBtn';
        dbgBtn.addEventListener('click', function () {
            if (window.__extract) window.__extract.debugOpen();
        });
        if (window.__MOYUTAI_RELEASE === true) dbgBtn.style.display = 'none';
        head.appendChild(dbgBtn);
        var newBtn = el('button', 'pj-new', '＋ 新建');
        newBtn.addEventListener('click', function () { openNewDialog(); });
        head.appendChild(newBtn);
        page.appendChild(head);

        /* v66：三维不可用时的顶栏徒标（不影响图片 / 视频 / 音频工作） */
        gateBadge = el('div', 'pj-gate-badge', '');
        gateBadge.style.cssText = 'display:none;align-items:center;gap:6px;margin:0 12px 8px;' +
            'padding:7px 10px;border-radius:9px;font-size:0.78rem;line-height:1.45;' +
            'color:#ffcd85;background:rgba(255,180,84,0.09);border:1px solid rgba(255,180,84,0.28)';
        page.appendChild(gateBadge);

        listEl = el('div', 'pj-list');
        page.appendChild(listEl);

        /* v52：分组管理 —— 路径条 / 底部操作条 / 多选取消钮 */
        crumbEl = el('div', 'pj-crumb');
        crumbEl.style.display = 'none';
        page.appendChild(crumbEl);

        emptyEl = el('div', 'pj-empty');
        emptyEl.innerHTML = '<div class="pj-empty-ico">📁</div><div>还没有工程</div>' +
            '<div class="pj-empty-sub">点右上角「新建」开始</div>';
        page.appendChild(emptyEl);

        gbarEl = el('div', 'pj-gbar');
        var gNewBtn = el('button', 'pj-gbar-btn', '📁 新建分组');
        gNewBtn.addEventListener('click', function () { onGroupNewClick(); });
        var gMoveBtn = el('button', 'pj-gbar-btn', '📦 移动到分组');
        gMoveBtn.addEventListener('click', function () { onGroupMoveClick(); });
        gbarEl.appendChild(gNewBtn);
        gbarEl.appendChild(gMoveBtn);
        page.appendChild(gbarEl);

        cancelBtn = el('button', 'pj-cancel', '✕ 取消选择');
        cancelBtn.style.display = 'none';
        cancelBtn.addEventListener('click', function () { setMulti(false); toast('已退出多选'); });
        page.appendChild(cancelBtn);


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

    /* ---------- 全局等待层（v30：打开/保存大工程耗时数秒到数十秒，
     * 没有反馈时界面像卡死；轻量遮罩 + 旋转圈 + 阶段文字） ---------- */
    var waitEl = null, waitTextEl = null;
    function showWait(msg) {
        if (!waitEl) {
            waitEl = el('div', 'pj-wait');
            var box = el('div', 'pj-wait-box');
            box.appendChild(el('div', 'pj-wait-spin'));
            waitTextEl = el('div', 'pj-wait-text');
            box.appendChild(waitTextEl);
            waitEl.appendChild(box);
            document.body.appendChild(waitEl);
        }
        waitTextEl.textContent = msg;
        requestAnimationFrame(function () { waitEl.classList.add('show'); });
    }
    function setWait(msg) { if (waitTextEl) waitTextEl.textContent = msg; }
    function hideWait() { if (waitEl) waitEl.classList.remove('show'); }

    /* ---------- 新建对话框 ---------- */

    var newDlg, newInput, newMode = 'model';

    function buildNewDialog() {
        newDlg = el('div', 'pj-dlg-mask');
        var box = el('div', 'pj-dlg');
        box.appendChild(el('div', 'pj-dlg-title', '新建工程'));
        // v45：模式三选一（R4，默认 3D 模型）；v49 扩为四选一（+图片）
        var modeRow = el('div', 'pj-mode-row');
        var modes = [['model', '🔮 3D 模型'], ['video', '🎬 视频'], ['audio', '🎵 音频'], ['image', '🖼 图片']];
        modes.forEach(function (m) {
            var b = el('button', 'pj-mode' + (m[0] === newMode ? ' on' : ''), m[1]);
            b.addEventListener('click', function () {
                newMode = m[0];
                modeRow.querySelectorAll('.pj-mode').forEach(function (x) { x.classList.remove('on'); });
                b.classList.add('on');
            });
            modeRow.appendChild(b);
        });
        box.appendChild(modeRow);
        /* v66：3D 不可用时的提示条（内容在 openNewDialog / 创建时动态刷新） */
        var gateHint = el('div', 'pj-gate-hint', '');
        gateHint.style.cssText = 'display:none;font-size:0.78rem;line-height:1.5;color:#ffb454;' +
            'background:rgba(255,180,84,0.08);border:1px solid rgba(255,180,84,0.3);' +
            'border-radius:8px;padding:7px 9px;margin-bottom:0.6rem';
        box.appendChild(gateHint);

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

        /* v59kb：同名报已存在前，先看工程目录是否真的还在。
         * 删除流程任何竞态残留的注册表条目（目录已没了）自动清理并放行重建。 */
        var submit = function () {
            var v = L.validateProjectName(newInput.value);
            if (!v.ok) {
                hint.textContent = v.reason;
                return;
            }
            /* v66：3D 工程在没 WebGPU 的机器上建了也打不开，直接拦在门口说清楚 */
            /* v68：改成放行——建完进只读/摆放工作台（WebGL2 就够了），
             * 不再以「没有编辑器」为由禁止创建。 */
            var reg = L.loadRegistry();
            var dup = (reg.projects || []).filter(function (p) { return p.name === v.name; })[0];
            if (dup) {
                var pdir = L.pathsFor(v.name);
                store().stat(pdir.meta).then(function (st) {
                    if (st) {
                        hint.textContent = '工程「' + v.name + '」已存在';
                    } else {
                        /* 目录已删，注册表条目是残留 → 自愈 */
                        L.saveRegistry(L.removeProject(reg, v.name));
                        pjDlog('dup ghost cleaned: ' + v.name);
                        close();
                        createProject(v.name, newMode);
                    }
                }).catch(function () {
                    hint.textContent = '工程「' + v.name + '」已存在';
                });
                return;
            }
            close();
            createProject(v.name, newMode);
        };
        ok.addEventListener('click', submit);
        newInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    }

    function openNewDialog() {
        newInput.value = '';
        // v45：每次打开重置为默认 3D（R4「默认」语义；同时消除模块状态残留，探针确定性）
        newMode = 'model';
        newDlg.querySelectorAll('.pj-mode').forEach(function (x, i) { x.classList.toggle('on', i === 0); });
        newDlg.querySelector('.pj-dlg-hint').textContent = '';
        syncGateHint();
        newDlg.classList.add('open');
        setTimeout(function () { newInput.focus(); }, 60);
    }

    /* v66：把“本机没有 WebGPU”的提醒同步到新建对话框；探测未完成时先不吓人 */
    function syncGateHint() {
        var g = newDlg && newDlg.querySelector('.pj-gate-hint');
        if (!g) return;
        if (no3d()) {
            /* v68：不再说「不能建 3D」，改成说清「建完进哪个工作台」 */
            g.textContent = 'ℹ ' + no3dReason() + '；3D 工程仍可新建，会进入场景工作台（只读查看 + 摆放人偶/道具）。';
            g.style.display = 'block';
            /* v68：3D 模式不再置灰 —— 能建、能摆、能存盘 */
            newDlg.querySelectorAll('.pj-mode').forEach(function (x, i) {
                x.classList.remove('pj-mode-off');
            });
        } else {
            g.style.display = 'none';
            newDlg.querySelectorAll('.pj-mode').forEach(function (x) {
                x.classList.remove('pj-mode-off');
            });
        }
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
        // v34：条子被 dock 收编后 display:none，量到零矩形 —— 旧变量必须清掉，
        // 否则左右停靠区还按旧值避让一个已经不存在的条子
        if (bottom) document.body.style.setProperty('--sd-bar-bottom', bottom + 'px');
        else document.body.style.removeProperty('--sd-bar-bottom');
    }
    addEventListener('resize', syncEditorBar);
    addEventListener('orientationchange', syncEditorBar);

    /* ===================== v52 分组管理 ===================== */

    var curGroup = '';        /* 当前浏览的分组 id，'' = 根 */
    var multiMode = false;    /* 多选模式 */
    var selSet = {};          /* key -> true；工程 'p:名'，分组 'g:id' */

    function selKeys() { return Object.keys(selSet); }
    function selCount() { return selKeys().length; }

    function selNodes() {
        return selKeys().map(function (k) {
            return k.charAt(0) === 'p' ? { type: 'project', name: k.slice(2) } : { type: 'group', id: k.slice(2) };
        });
    }

    function setMulti(on) {
        multiMode = on;
        if (!on) selSet = {};
        if (cancelBtn) cancelBtn.style.display = on ? 'flex' : 'none';
        if (gbarEl) gbarEl.classList.toggle('multi', on);
        refreshList();
    }

    function toggleSel(key) {
        if (selSet[key]) delete selSet[key]; else selSet[key] = true;
        refreshList();
    }

    /* ---------- v52：新建分组 / 移动到分组 ---------- */

    function ensureMultiOrToast() {
        /* 老板规则：非多选点按钮 → 自动进入多选模式 */
        if (!multiMode) { setMulti(true); toast('已进入多选，选好后点本按钮执行'); return false; }
        if (!selCount()) { toast('先长按选择要处理的节点'); return false; }
        return true;
    }

    function onGroupNewClick() {
        if (!ensureMultiOrToast()) return;
        var G = window.__groups;
        var reg = L.loadRegistry();
        var input = prompt('在「' + G.pathText(reg, curGroup) + '」下新建分组：', '新建分组');
        if (input == null) return;
        var made = G.createGroupWithNodes(reg, input, curGroup, selNodes());
        if (!made.ok) { toast('新建分组失败：' + made.reason); return; }
        L.saveRegistry(reg);
        setMulti(false);
        toast('已创建「' + input + '」并放入 ' + selCount() + ' 个节点');
        refreshList();
    }

    function onGroupMoveClick() {
        if (!ensureMultiOrToast()) return;
        openMoveDialog();
    }

    /* 目标路径选择弹窗（层级列表 + 确认移动） */
    var moveDlg = null, moveTarget = '', moveListEl = null, movePathEl = null;

    function ensureMoveDlg() {
        if (moveDlg) return;
        moveDlg = el('div', 'pj-move-dlg');
        var box = el('div', 'pj-move-box');
        movePathEl = el('div', 'pj-move-path', '');
        moveListEl = el('div', 'pj-move-list', '');
        var row = el('div', 'pj-move-btns');
        var cancelB = el('button', 'pj-move-btn', '取消');
        cancelB.addEventListener('click', function () { moveDlg.classList.remove('open'); });
        var okB = el('button', 'pj-move-btn primary', '移动到这里');
        okB.addEventListener('click', function () {
            var G = window.__groups;
            var reg = L.loadRegistry();
            var chk = G.validateMove(reg, selNodes(), moveTarget);
            if (!chk.ok) { movePathEl.textContent = '⚠ ' + chk.reason; return; }
            G.moveNodes(reg, selNodes(), moveTarget);
            L.saveRegistry(reg);
            moveDlg.classList.remove('open');
            setMulti(false);
            toast('已移动到「' + G.pathText(reg, moveTarget) + '」');
            refreshList();
        });
        row.appendChild(cancelB); row.appendChild(okB);
        box.appendChild(el('div', 'pj-move-title', '选择目标分组'));
        box.appendChild(movePathEl);
        box.appendChild(moveListEl);
        box.appendChild(row);
        moveDlg.appendChild(box);
        page.appendChild(moveDlg);
    }

    function renderMoveList() {
        var G = window.__groups;
        var reg = L.loadRegistry();
        moveListEl.innerHTML = '';
        movePathEl.textContent = '目标：' + G.pathText(reg, moveTarget);
        if (moveTarget) {
            var up = el('div', 'pj-move-item', '⬆ 上一级');
            up.addEventListener('click', function () {
                var g = G.findGroup(reg, moveTarget);
                moveTarget = (g && g.parent) || '';
                renderMoveList();
            });
            moveListEl.appendChild(up);
        }
        G.groupsIn(reg, moveTarget).forEach(function (g) {
            var it = el('div', 'pj-move-item', '📁 ' + g.name);
            it.addEventListener('click', function () { moveTarget = g.id; renderMoveList(); });
            moveListEl.appendChild(it);
        });
        if (!G.groupsIn(reg, moveTarget).length) {
            moveListEl.appendChild(el('div', 'pj-move-empty', '（此层没有子分组，点「移动到这里」完成）'));
        }
    }

    function openMoveDialog() {
        ensureMoveDlg();
        moveTarget = curGroup;
        renderMoveList();
        moveDlg.classList.add('open');
    }

    /* ---------- v52b：删除分组三选弹窗 ----------
     * 仅解除分组：子工程/子分组全部上移到被删分组的父路径
     * 完整删除：子工程数据 + 子分组一并删除
     * 取消 */
    var gdelDlg = null, gdelTarget = '', gdelNameEl = null;

    function ensureGroupDelDlg() {
        if (gdelDlg) return;
        gdelDlg = el('div', 'pj-move-dlg');
        var box = el('div', 'pj-move-box');
        gdelNameEl = el('div', 'pj-move-title', '');
        var info = el('div', 'pj-move-path', '');
        info.id = 'pj-gdel-info';
        var row = el('div', 'pj-move-btns');
        var bCancel = el('button', 'pj-move-btn', '取消');
        bCancel.addEventListener('click', function () { gdelDlg.classList.remove('open'); });
        var bLoose = el('button', 'pj-move-btn', '仅解除分组');
        bLoose.addEventListener('click', function () { doGroupDelete(false); });
        var bFull = el('button', 'pj-move-btn primary', '完整删除');
        bFull.style.background = '#b3261e';
        bFull.addEventListener('click', function () { doGroupDelete(true); });
        row.appendChild(bCancel); row.appendChild(bLoose); row.appendChild(bFull);
        box.appendChild(gdelNameEl);
        box.appendChild(info);
        box.appendChild(row);
        gdelDlg.appendChild(box);
        page.appendChild(gdelDlg);
    }

    function openGroupDeleteDialog(groupId) {
        var G = window.__groups;
        var reg = L.loadRegistry();
        var g = G.findGroup(reg, groupId);
        if (!g) return;
        ensureGroupDelDlg();
        gdelTarget = groupId;
        var names = G.collectProjectNames(reg, groupId);
        var childG = G.groupsIn(reg, groupId).length;
        var childP = G.projectsIn(reg, groupId).length;
        gdelNameEl.textContent = '删除分组「' + g.name + '」';
        document.getElementById('pj-gdel-info').textContent =
            '包含 ' + childP + ' 个工程、' + childG + ' 个子分组' +
            (names.length ? ('（涉及工程：' + names.join('、') + '）') : '');
        gdelDlg.classList.add('open');
    }

    function doGroupDelete(full) {
        var G = window.__groups;
        var reg = L.loadRegistry();
        var g = G.findGroup(reg, gdelTarget);
        var name = g ? g.name : '';
        if (full) {
            var names = G.collectProjectNames(reg, gdelTarget);
            if (names.length && !confirm('完整删除将连同 ' + names.length + ' 个工程及其数据一并删除，确定？')) return;
            var res = G.deleteGroupDeep(reg, gdelTarget);
            if (!res.ok) { toast(res.reason); return; }
            /* 逐个删工程数据目录 */
            var chain = Promise.resolve();
            names.forEach(function (n) {
                chain = chain.then(function () {
                    var p = L.pathsFor(n);
                    return store().remove(p.dir).catch(function () { });
                });
            });
            chain.then(function () {
                L.saveRegistry(reg);
                if (curGroup && !G.findGroup(reg, curGroup)) curGroup = '';
                gdelDlg.classList.remove('open');
                refreshList();
                toast('已完整删除「' + name + '」（含 ' + names.length + ' 个工程）');
            });
        } else {
            var res2 = G.dissolveGroup(reg, gdelTarget);
            if (!res2.ok) { toast(res2.reason); return; }
            L.saveRegistry(reg);
            if (curGroup === gdelTarget) curGroup = (g && g.parent) || '';
            gdelDlg.classList.remove('open');
            refreshList();
            toast('已解除「' + name + '」分组（子节点上移）');
        }
    }

    function longPress(elx, fn) {
        var timer = null, moved = false, sx = 0, sy = 0;
        elx.addEventListener('touchstart', function (e) {
            var t = e.touches[0];
            sx = t.clientX; sy = t.clientY; moved = false;
            timer = setTimeout(function () { if (!moved) { timer = null; fn(); } }, 500);
        }, { passive: true });
        elx.addEventListener('touchmove', function (e) {
            var t = e.touches[0];
            if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) { moved = true; if (timer) { clearTimeout(timer); timer = null; } }
        }, { passive: true });
        var clear = function () { if (timer) { clearTimeout(timer); timer = null; } };
        elx.addEventListener('touchend', clear);
        elx.addEventListener('touchcancel', clear);
        /* 桌面：右键长按等价 */
        elx.addEventListener('contextmenu', function (e) { e.preventDefault(); fn(); });
    }

    /* ---------- A2: 底部条/取消按钮/路径条 ---------- */
    /* ===================== 列表 ===================== */

    function refreshList() {
        var reg = L.loadRegistry();
        var G = window.__groups;
        var groups = G ? G.groupsIn(reg, curGroup) : [];
        var items = G ? G.projectsIn(reg, curGroup) : (reg.projects || []);
        listEl.innerHTML = '';
        var total = items.length;
        emptyEl.style.display = total ? 'none' : 'flex';

        /* 路径条 */
        if (crumbEl) {
            crumbEl.innerHTML = '';
            if (curGroup && G) {
                var up = el('button', 'pj-crumb-btn', '⬆ 上级');
                up.addEventListener('click', function () {
                    var g = G.findGroup(reg, curGroup);
                    curGroup = (g && g.parent) || '';
                    refreshList();
                });
                crumbEl.appendChild(up);
                crumbEl.appendChild(el('div', 'pj-crumb-path', G.pathText(reg, curGroup)));
            }
            crumbEl.style.display = (curGroup && G) ? 'flex' : 'none';
        }

        /* 分组卡片 */
        groups.forEach(function (g) {
            var key = 'g:' + g.id;
            var card = el('div', 'pj-card pj-gcard' + (multiMode ? ' selectable' : '') + (multiMode && selSet[key] ? ' sel' : ''));
            var check = el('div', 'pj-check', multiMode && selSet[key] ? '✓' : '');
            card.appendChild(check);
            var icon = el('div', 'pj-thumb-empty', '📁');
            card.appendChild(icon);
            var info = el('div', 'pj-info');
            info.appendChild(el('div', 'pj-name', g.name));
            var cnt = G.projectsIn(reg, g.id).length + G.groupsIn(reg, g.id).length;
            info.appendChild(el('div', 'pj-sub', cnt ? cnt + ' 个内容' : '空分组'));
            card.appendChild(info);
            var gdel = el('button', 'pj-del', '🗑');
            gdel.addEventListener('click', function (e) {
                e.stopPropagation();
                openGroupDeleteDialog(g.id);
            });
            card.appendChild(gdel);
            card.addEventListener('click', function () {
                if (multiMode) { toggleSel(key); return; }
                curGroup = g.id;
                refreshList();
            });
            longPress(card, function () { if (!multiMode) setMulti(true); toggleSel(key); });
            listEl.appendChild(card);
        });

        /* 工程卡片（沿用原渲染，加多选态） */
        items.forEach(function (item) {
            var key = 'p:' + item.name;
            var card = el('div', 'pj-card' + (multiMode ? ' selectable' : '') + (multiMode && selSet[key] ? ' sel' : ''));
            /* v66：卡片记住工程名与模式，顶栏徒标/置灰不用再查注册表 */
            card.setAttribute('data-name', item.name);
            card.setAttribute('data-mode', item.mode || 'model');

            var check = el('div', 'pj-check', multiMode && selSet[key] ? '✓' : '');
            card.appendChild(check);
            var thumb = el('div', 'pj-thumb-empty', '🔮');
            card.appendChild(thumb);

            if (item.hasModel) {
                var p = L.pathsFor(item.name);
                store().read(p.thumb).then(function (u8) {
                    if (u8 && u8.length) {
                        var blob = new Blob([u8], { type: 'image/png' });
                        thumb.textContent = '';
                        thumb.style.background = 'url(' + URL.createObjectURL(blob) + ') center/cover no-repeat';
                    }
                }).catch(function () { /* 没缩略图就留占位 */ });
            }

            var info = el('div', 'pj-info');
            info.appendChild(el('div', 'pj-name', item.name));
            var modeTxt = item.mode === 'video' ? '🎬 视频' :
                item.mode === 'audio' ? '🎵 音频' :
                item.mode === 'image' ? '🖼 图片' :
                (item.hasModel ? '已有模型' : '空工程');
            info.appendChild(el('div', 'pj-sub', modeTxt + ' · ' + String(item.updatedAt || '').slice(0, 16).replace('T', ' ')));
            card.appendChild(info);

            if (!multiMode) {
                var del = el('button', 'pj-del', '🗑');
                del.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (!confirm('删除工程「' + item.name + '」？模型数据会一并删除。')) return;
                    var p = L.pathsFor(item.name);
                    store().remove(p.dir).then(function () {
                        var reg2 = L.loadRegistry();
                        reg2.projects = reg2.projects.filter(function (x) { return x.name !== item.name; });
                        L.saveRegistry(reg2);
                        refreshList();
                        toast('已删除「' + item.name + '」');
                    }).catch(function (e2) { toast('删除失败：' + (e2 && e2.message || e2)); });
                });
                card.appendChild(del);
            }

            card.addEventListener('click', function () {
                if (multiMode) { toggleSel(key); return; }
                openProject(item.name);
            });
            longPress(card, function () { if (!multiMode) setMulti(true); toggleSel(key); });
            listEl.appendChild(card);
        });
        if (!total && !groups.length) emptyEl.style.display = 'flex';
        syncGateBadge();
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

    /* v66：首页顶栏“三维不可用”徒标 —— 只提示，不挡任何图片/视频/音频操作 */
    function syncGateBadge() {
        if (!gateBadge) return;
        if (no3d()) {
            gateBadge.innerHTML = '';
            var ico = el('span', '', '⚠');
            ico.style.fontSize = '0.95rem';
            gateBadge.appendChild(ico);
            gateBadge.appendChild(el('span', '', no3dReason() + '（可打开 3D 工程做只读查看；图片 / 视频 / 音频照常可用）'));
            gateBadge.style.display = 'flex';
        } else {
            gateBadge.style.display = 'none';
        }
        /* 3D 工程卡片置灰（v67：仍可点，点开转只读查看器） */
        var cards = listEl ? listEl.querySelectorAll('.pj-card') : [];
        var off = no3d();
        for (var i = 0; i < cards.length; i++) {
            var md = cards[i].getAttribute('data-mode');
            if (md && md !== 'model') {
                cards[i].classList.remove('pj-card-off');
            } else if (off) {
                cards[i].classList.add('pj-card-off');
                cards[i].setAttribute('title', '本机无 WebGPU：进场景工作台（可查看、摆放人偶/道具并存盘）');
            } else {
                cards[i].removeAttribute('title');
                cards[i].classList.remove('pj-card-off');
            }
        }
    }

    /* ===================== 新建 / 打开 ===================== */

    async function createProject(name, mode) {
        if (busy) return;
        var m = mode || 'model';
        busy = true;
        try {
            var p = L.pathsFor(name);
            if (m === 'model') {
                currentProject = name;
                lastSavedSnapshot = null;
                clearScene();
                showWait('创建工程…');

                // v30 #1：新工程从干净默认视口开始——相机/基准点/游标/手动裁剪
                // 全部重置，不再继承上一个工程调整过的视角
                try {
                    var d0 = window.__director;
                    if (d0 && d0.resetViewport) d0.resetViewport();
                } catch (e) { /* 引擎未就绪就算了 */ }

                // 关键：新建就得把空工程落盘。v29 起写的是纯状态 project.json
                // （几 KB），不再打 zip；模型字节由保存时按内容寻址另存。
                await store().write(p.state, new TextEncoder().encode(JSON.stringify(L.emptyProjectState())));
            } else if (m === 'image') {
                // v49 图片工程：图片字节由工作台导入时按内容寻址落 files/，
                // 笔画在 localStorage（img-store）。这里只建 meta 空记录，
                // 与 AV 同一模式：新建不落图，重开不丢设置。
                showWait('创建工程…');
                if (window.__imgLogic) {
                    window.__imgLogic.saveMeta(window.__imgLogic.emptyMeta(name));
                }
            } else {
                // v45 AV 工程（R4）：媒体不进包（300MB 级，方案 §3.2），
                // 只落 meta.json 带模式标记；AV 工作台的 meta/folderUri/fps
                // 写入 localStorage（av-store），这里先建空记录，否则重开时丢设置
                showWait('创建工程…');
                if (window.__avLogic) {
                    var am = window.__avLogic.emptyMeta(name, m);
                    window.__avLogic.saveMeta(am);
                }
            }

            var meta = {
                name: name,
                mode: m,
                updatedAt: new Date().toISOString(),
                hasModel: false
            };
            await store().write(p.meta, new TextEncoder().encode(JSON.stringify(meta)));
            /* v52b：在子分组里新建的工程落在当前浏览的分组 */
            meta.group = curGroup || '';
            L.saveRegistry(L.upsertProject(L.loadRegistry(), meta));

            hideWait();
            if (m === 'model') {
                if (no3d()) {
                    /* v68：无 WebGPU 时进场景工作台（WebGL2），可以摆人偶/道具并存盘。
                     * 不加载编辑器引擎，避免又一次启动崩溃。 */
                    hideWait();
                    busy = false;
                    toast('已创建「' + name + '」，进入场景工作台');
                    openSceneWorkbench(name);
                    return;
                }
                showEditorPage();
                // 空工程落盘后就是“已保存”状态，返回时不该弹未保存确认
                lastSavedSnapshot = snapshotNow();
                toast('已创建「' + name + '」，请导入模型');
            } else if (m === 'video' || m === 'audio') {
                // AV 工作台直接接管（工程页垫底，工作台返回时恢复）
                showProjectsPage();
                if (window.__av) window.__av.open(name);
                else toast('AV 工作台模块未加载');
            } else {
                // v49 图片工作台
                showProjectsPage();
                if (window.__img) window.__img.open(name);
                else toast('图片工作台模块未加载');
            }
        } catch (err) {
            console.error('[projects] create failed', err);
            toast('创建失败：' + (err && err.message ? err.message : '未知错误'));
        } finally {
            hideWait();
            busy = false;
        }
    }

    /* 区分“文件不存在”和“文件坏了”。
     * 只有前者可以当空工程恢复；后者是真数据损坏，覆盖掉就把用户的活弄没了。 */
    function isMissingFileError(err) {
        var msg = String((err && (err.message || err.error)) || err || '').toLowerCase();
        var code = String((err && err.code) || '').toUpperCase();
        if (code === 'NOT_FOUND' || code === 'ENOENT') return true;
        return msg.indexOf('不存在') >= 0 ||
            msg.indexOf('does not exist') >= 0 ||
            msg.indexOf('no such file') >= 0 ||
            msg.indexOf('not found') >= 0;
    }

    /* v45h：真机 08:57 截图——「打开工程：读取数据…」转圈永久卡死（存储挂起→busy 死锁）。
     * 看门狗 + 存储超时护栏，任何挂起 6s 内强制解锁并提示。 */
    function pjDlog(msg) {
        try {
            var cap = window.Capacitor;
            var p = cap && cap.Plugins && cap.Plugins.DebugLog;
            if (p && p.append) { var r = p.append({ text: '[pj] ' + msg }); if (r && r.catch) r.catch(function () { }); }
        } catch (e) { }
    }
    var waitTimer = null;
    function armWaitWatchdog(label) {
        if (waitTimer) clearTimeout(waitTimer);
        waitTimer = setTimeout(function () {
            waitTimer = null;
            var stuck = waitEl && waitEl.classList.contains('show');
            if (stuck) {
                hideWait();
                busy = false;
                pjDlog('WATCHDOG ' + label + ' 等待框超 6s，强制解锁');
                toast('操作超时已取消，请重试');
            }
        }, 6000);
    }
    function storeTimeout(pr, ms, label) {
        var t = new Promise(function (_, rej) {
            setTimeout(function () { rej(new Error(label + ' 超时')); }, ms);
        });
        return Promise.race([Promise.resolve(pr), t]);
    }

    /* 工程是不是 3D 工程：优先读 registry.mode，读不到当作 3D（旧工程都是 3D） */
    function projectModeOf(name) {
        var reg = L.loadRegistry();
        var hit = (reg.projects || []).filter(function (p) { return p.name === name; })[0];
        return (hit && hit.mode) || 'model';
    }

    /* v68：页面跳转统一走这里。
     * 好处：探针可以把 window.__NAV_HOOK 挂上去拦下跳转，从而在不真正离开
     * 首页的前提下断言「路由到了哪个页面」——之前直接写 location.href，
     * 一导航后面的断言全丢。 */
    function go(url) {
        if (typeof window.__NAV_HOOK === 'function') { window.__NAV_HOOK(url); return; }
        location.href = url;
    }

    /* v67：3D 工程在无 WebGPU 设备上不再直接拦死，改为跳工作台（方案 B）。
     * 工作台用 PlayCanvas legacy gsplat 组件跑 WebGL2，能看泼溅+GLB 摆位；
     * v68 起还能摆放人偶/道具并存回工程（纯实体变换，不需要 WebGPU）。 */
    function openReadonlyViewer(name) {
        var url = './viewer.html?project=' + encodeURIComponent(name);
        pjDlog('route READONLY viewer ' + name);
        go(url);
    }

    /* v68：场景工作台 = 可摆放版本（能放人偶/道具并存回工程）。
     * 和只读查看器的区别只有 edit 权限，页面是同一个。 */
    function openSceneWorkbench(name) {
        var url = './viewer.html?project=' + encodeURIComponent(name);
        pjDlog('route WORKBENCH ' + name);
        go(url);
    }

    async function openProject(name) {
        if (busy) return;
        if (no3d() && projectModeOf(name) === 'model') {
            openSceneWorkbench(name);
            return;
        }
        busy = true;
        try {
            pjDlog('openProject(' + name + ') start');
            armWaitWatchdog('openProject');
            showWait('打开工程：读取数据…');
            var p = L.pathsFor(name);
            // v45 模式路由：AV 工程走 AV 工作台（媒体不进包，无 project.json）
            try {
                var mb = await storeTimeout(store().read(p.meta), 4000, '读取工程数据');
                pjDlog('meta read ok ' + (mb && mb.byteLength || 0) + 'B');
                var mm = JSON.parse(new TextDecoder().decode(mb));
                if (mm && mm.mode === 'image') {
                    // v49：图片工程路由（图片不进包，meta.json 带模式标记）
                    if (window.__img) {
                        pjDlog('route IMG ' + name);
                        hideWait();
                        busy = false;
                        window.__img.open(name);
                        return;
                    }
                    toast('图片工作台模块未加载');
                    return;
                }
                if (mm && (mm.mode === 'video' || mm.mode === 'audio')) {
                    if (window.__av) {
                        pjDlog('route AV ' + name + ' mode=' + mm.mode);
                        hideWait();     // v45r：AV 路由立刻收起等待框并复位 busy（此前靠 6s 看门狗，工作台上假弹「操作超时」）
                        busy = false;
                        window.__av.open(name);
                        return;
                    }
                    toast('AV 工作台模块未加载');
                    return;
                }
            } catch (e) {
                pjDlog('meta read miss/err: ' + (e && e.message || e));
                /* 无 meta/读取失败/超时：按 3D 工程走 */
            }
            var state, files = {}, recovered = false, migrated = false;

            try {
                // v29：先读纯状态（几 KB）。读不到再着 legacy zip 迁移。
                var stateBytes = await storeTimeout(store().read(p.state), 6000, '读取工程状态');
                state = JSON.parse(new TextDecoder().decode(stateBytes));
            } catch (v29Err) {
                var legacy = await store().stat(p.proj);
                if (legacy && legacy.size) {
                    // v28- 的自包含 zip：流式迁移成内容寻址布局（边解压边落盘，
                    // 不整包进内存），迁移完旧 zip 已删、state 已写，直接用。
                    setWait('打开工程：升级旧格式存储…');
                    state = await L.migrateLegacyProject(p);
                    migrated = true;
                } else if (isMissingFileError(v29Err)) {
                    // v28 及以前新建工程只往注册表写了一条记录，没有落盘，
                    // “新建→返回→点开”必然读不到。这类空壳按空工程恢复并补写。
                    state = L.emptyProjectState();
                    recovered = true;
                } else {
                    throw v29Err;
                }
            }

            clearScene();
            setWait('打开工程：载入模型…');

            // v29：模型/道具字节按引用从 files/<hash> 逐个读。
            // 同一个 GLB 放两个道具也只有一个文件，两实例共享同一份字节——
            // #2 的双份内存占用在这里一并解决。
            var need = [];
            if (state.model && state.model.path) need.push(state.model.path);
            (state.props || []).forEach(function (r) {
                if (r.file && need.indexOf(r.file) < 0) need.push(r.file);
            });
            for (var i = 0; i < need.length; i++) {
                files[need[i]] = await store().readViaUri(p.dir + '/' + need[i]);
            }

            // 先重建模型：导演台的对象都摆在模型上，且相机包围盒依赖它
            if (state.model && state.model.path && files[state.model.path]) {
                await importModelBytes(files[state.model.path], state.model.name || 'model.ply');
            }

            var d = window.__director;
            if (d && d.restoreProject) {
                setWait('打开工程：还原场景…');
                var r = await d.restoreProject(state, files);
                if (r && r.ok === false) {
                    toast('部分对象未能还原：' + (r.failed || []).join('、'));
                }
            } else {
                toast('导演台模块未就绪，仅还原模型');
            }

            if (recovered) {
                await store().write(p.state, new TextEncoder().encode(JSON.stringify(state)));
            }

            currentProject = name;
            lastSavedSnapshot = snapshotNow();
            hideWait();
            showEditorPage();
            toast(recovered ?
                '已按空工程打开「' + name + '」（工程文件原先缺失，已补写）' :
                (migrated ? '已打开「' + name + '」（存储已升级，体积去重）' :
                 '已打开「' + name + '」'));
        } catch (err) {
            console.error('[projects] open failed', err);
            toast('打开失败：' + (err && err.message ? err.message : '未知错误'));
        } finally {
            hideWait();
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
        var t0 = Date.now();
        try {
            showWait('保存工程…');
            var snap = snapshotNow();
            if (!snap) { toast('场景状态未就绪'); return false; }

            var d = window.__director;
            var p = L.pathsFor(currentProject);
            var totalBytes = 0;

            // 模型：内容寻址落盘（SHA-1 命名，已存在就跳过——跨保存去重），
            // state 只存引用。打开时按需读，不再整包 zip 过 base64。
            var model = d && d.projectModel ? d.projectModel() : null;
            if (model && model.bytes && model.bytes.length) {
                snap.model = {
                    name: model.name,
                    path: await L.putContentFile(p, extOf(model.name), model.bytes)
                };
                totalBytes += model.bytes.length;
            } else {
                snap.model = null;
            }

            // 道具：同一个模型放 N 个也只存一份——#2 的 173MB 就是两份 86MB。
            var propFiles = d && d.projectPropFiles ? d.projectPropFiles() : [];
            for (var i = 0; i < propFiles.length; i++) {
                setWait('保存工程：写入模型 ' + (i + 1) + '/' + propFiles.length + '…');
                var f = propFiles[i];
                var ref = await L.putContentFile(p, extOf(f.path), f.bytes);
                (snap.props || []).forEach(function (r) {
                    if (r.file === f.path) r.file = ref;
                });
                totalBytes += f.bytes.length;
            }

            var stBytes = new TextEncoder().encode(JSON.stringify(snap));
            await store().write(p.state, stBytes);

            // 缩略图
            var thumb = await captureThumb();
            if (thumb) await store().write(p.thumb, thumb);

            // hasModel 口径修正：GLB 道具也算有模型（v28 只认 splat，
            // 纯 GLB 工程一直错标“空工程”）
            var meta = {
                name: currentProject,
                updatedAt: new Date().toISOString(),
                hasModel: !!(snap.model || (snap.props && snap.props.length))
            };
            await store().write(p.meta, new TextEncoder().encode(JSON.stringify(meta)));
            L.saveRegistry(L.upsertProject(L.loadRegistry(), meta));

            lastSavedSnapshot = snap;
            hideWait();
            toast('已保存「' + currentProject + '」 状态' + fmtBytes(stBytes.length) +
                (totalBytes ? ' · 模型' + fmtBytes(totalBytes) : '') +
                ' · ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
            return true;
        } catch (err) {
            console.error('[projects] save failed', err);
            toast('保存失败：' + (err && err.message ? err.message : '未知错误'));
            return false;
        } finally {
            hideWait();
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
        syncGateBadge();

        // v66：闸门探测是异步的，结果可能晚于 init。监听事件再用轮询兜底一次
        document.addEventListener('engine-capability', function () { syncGateBadge(); });
        var tries = 0;
        var t = setInterval(function () {
            syncGateBadge();
            var g = window.__engineGate;
            if ((g && g.probed) || ++tries > 80) clearInterval(t);
        }, 250);

        // 硬件返回键：AV 工作台开着→工作台自己处理；编辑器里退回工程列表，而不是退出 App
        document.addEventListener('backbutton', function (e) {
            var avPage = document.getElementById('avPage');
            if (avPage && avPage.classList.contains('open')) {
                e.preventDefault();
                if (window.__av) window.__av.back();
                return;
            }
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
        list: refreshList,
        _dbg: function () { return { multiMode: multiMode, sel: selKeys(), curGroup: curGroup }; },
        _setMulti: setMulti,
        _toggleSel: toggleSel,
        _onGroupNew: onGroupNewClick
    };
})();
