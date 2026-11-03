/* 摸鱼台 v45i —— AV 工作台 UI 层（视频工程，样式表局部生效根治）
 *
 * v45i：10:35 老板截图——av.css 只剩零碎规则生效（顶栏跑中间、列表悬半空、空态字飘在视频上），
 *  根因是 WebView 对本地资源用了旧缓存样式表。三重防御：
 *  ① 结构布局全部内联写死（applyLayoutGuard，不再信样式表）
 *  ② 每次打开强制 fetch av.css 最新内容，内联 <style> 覆盖（refreshCriticalCss）
 *  ③ 渲染取证日志升级（top/side rect 也回报）
 * v45g：空态居中欢迎层/未关联 vs 授权失效文案。
 * v45f：dlog {text:} 形态修复 + toast/VIDEO-ERR 落日志。
 * v45h：内联样式兑底强制渲染 + 渲染取证日志。
 * v45c 布局：右侧竖排控制栏/刻度同层/时间右上角/安全区/工具行序/去全屏/大按钮。
 * 继承 v45b：强制横屏、帧数常显、±半帧红色移除态、r6 交互语义。
 */
(function () {
    'use strict';

    var L = window.__avLogic;
    if (!L) { console.error('[av] __avLogic 未加载'); return; }

    /* ---------- v45e 排障埋点（老板 07:21 反馈：点视频工程只横屏不出界面；
     * 桌面探针全绿但真机静默失败 → 错误不能再用 console 吞掉，全部进 DebugLog） ---------- */

    function dlog(msg) {
        try {
            var cap = window.Capacitor;
            var p = cap && cap.Plugins && cap.Plugins.DebugLog;
            if (p && p.append) {
                // v45f 修复：v45e 传了裸字符串，原生 call.getString("text") 拿到空 → 日志全是空行
                var r = p.append({ text: '[av] ' + msg });
                if (r && r.catch) r.catch(function () { });
            }
        } catch (e) { }
    }
    // 全局网：任何未捕获错误/拒绝都落日志（真机上不再有静默失败）
    window.addEventListener('error', function (e) {
        dlog('JS-ERR ' + (e.message || '') + ' @' + String(e.filename || '').split('/').pop() + ':' + (e.lineno || '?'));
    });
    window.addEventListener('unhandledrejection', function (e) {
        var r = e && e.reason;
        dlog('REJ ' + (r && (r.message || r) || ''));
    });

    function ms() {
        var cap = window.Capacitor;
        return (cap && cap.Plugins && cap.Plugins.MediaServer) || null;
    }
    function savePlug() {
        var cap = window.Capacitor;
        return (cap && cap.Plugins && cap.Plugins.SaveImage) || null;
    }

    var S = {
        project: null,
        meta: null,
        marks: null,
        files: [],
        cur: -1,
        serverPort: 0,
        fps: null,
        fpsSampling: false,
        vfcSamples: [],
        vfcT0: 0,
        built: false
    };

    function effFps() { return S.fps || 25; }

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }
    function fmt2(n) { return (Math.round(n * 100) / 100).toFixed(2); }
    function fmtSize(b) {
        if (b >= 1048576) return (b / 1048576).toFixed(1) + 'MB';
        if (b >= 1024) return (b / 1024).toFixed(0) + 'KB';
        return b + 'B';
    }

    var page, topEl, bodyEl, sideEl, listEl, mainEl, videoEl,
        ovlEl, btnSplit, btnMerge, btnMulti, stepVal, fpsBox,
        tlWrap, posEl, tlRange, ticksEl, btnPlay, btnPrev, btnNext,
        railEl, audioCv, emptyHint, emptyTitle, handleEl, toastTimer = null;

    function toast(msg) {
        dlog('TOAST ' + msg);   // v45f：所有弹窗提示都落日志（toast 2.4s 自动消失，错过就查日志）
        var t = document.querySelector('.pj-toast');
        if (!t) { t = el('div', 'pj-toast'); document.body.appendChild(t); }
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
 }

    /* ---------- 横屏（v45b） + 安全区（v45c #4） ---------- */

    function lockLandscape() {
        var p = ms();
        if (p && p.lockLandscape) { p.lockLandscape({ on: true }).catch(function () { }); return; }
        try {
            if (screen.orientation && screen.orientation.lock) {
                var r = screen.orientation.lock('landscape');
                if (r && r.catch) r.catch(function () { });
            }
        } catch (e) { }
    }
    function unlockOrientation() {
        var p = ms();
        if (p && p.lockLandscape) { p.lockLandscape({ on: false }).catch(function () { }); return; }
        try {
            if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
        } catch (e) { }
    }
    /* #4：系统栏/挖孔 insets → CSS 变量（Android 15 edge-to-edge 下 env() 不可靠）
     * v45d 真机修复（老板截图：整页被撑出大黑边）:
     *  a) 原生返回物理 px，必须 ÷ devicePixelRatio 换算成 CSS px（v45c 直接当 CSS px 用 → 放大 2~3 倍）
     *  b) 旋转过渡期读到旧方向脏值（v45c 截图顶带 ≈460 物理px = 竖屏状态栏值）→ 超过 SAFE_MAX 视为脏值归零
     *  c) 旋转稳定后延迟重读 3 次 + resize/orientationchange 重读，自愈
     */
    var SAFE_MAX = 48;   // CSS px：真实状态栏/挖孔/导航条不会超过它

    function applySafeArea() {
        var p = ms();
        if (!p || !p.getSafeArea) return;
        var read = function () {
            p.getSafeArea().then(function (r) {
                if (!r) return;
                var dpr = window.devicePixelRatio || 1;
                var cvt = function (v) {
                    v = (v || 0) / dpr;
                    if (v < 0 || v > SAFE_MAX) v = 0;   // 脏值一律归零（宁可靠边不撑破）
                    return Math.round(v);
                };
                page.style.setProperty('--av-safe-top', cvt(r.top) + 'px');
                page.style.setProperty('--av-safe-right', cvt(r.right) + 'px');
                page.style.setProperty('--av-safe-left', cvt(r.left) + 'px');
                page.style.setProperty('--av-safe-bottom', cvt(r.bottom) + 'px');
                // v45i：样式表可能被 WebView 旧缓存污染 → 避让 padding 直接内联，不依赖样式表消费变量
                page.style.paddingTop = cvt(r.top) + 'px';
                page.style.paddingRight = cvt(r.right) + 'px';
                page.style.paddingLeft = cvt(r.left) + 'px';
                page.style.paddingBottom = cvt(r.bottom) + 'px';
            }).catch(function () { });
        };
        read();
        [400, 1000, 2000].forEach(function (t) { setTimeout(read, t); });
    }

    /* v45i：结构布局内郸兜底（真机 10:35 截图：样式表仅局部生效 → 顶栏跑中间、
     * 列表悬半空）。关键布局不再依赖样式表解析，全部内联写死。 */
    function applyLayoutGuard() {
        if (!page || !topEl) return;
        var put = function (elm, props) { for (var k in props) elm.style.setProperty(k, props[k]); };
        put(page, {
            position: 'fixed', inset: '0', zIndex: '1550', display: 'flex',
            flexDirection: 'column', background: '#141414'
        });
        put(topEl, {
            display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px',
            background: '#1d1d1f', borderBottom: '1px solid #333', minHeight: '44px',
            flex: '0 0 auto', position: 'relative', zIndex: '2'
        });
        var tt = topEl.querySelector('.av-top-title');
        if (tt) put(tt, { flex: '1', color: '#ddd', fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
        put(bodyEl, { flex: '1', display: 'flex', minHeight: '0', position: 'relative' });
        put(sideEl, {
            width: '30%', minWidth: '190px', maxWidth: '340px', flex: '0 0 auto',
            background: '#181820', borderRight: '1px solid #2c2c34',
            display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden'
        });
        put(mainEl, { flex: '1', position: 'relative', minWidth: '0', background: '#000', overflow: 'hidden' });
        put(videoEl, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', background: '#000' });
        put(emptyHint, { position: 'absolute', inset: '0', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px' });
        put(railEl, { position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', zIndex: '10', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '10px' });
        put(ovlEl, { position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: '64px', zIndex: '10', display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px' });
        put(tlWrap, { position: 'absolute', left: '16px', right: '16px', bottom: '10px', height: '40px', zIndex: '8' });
        put(posEl, { position: 'absolute', top: '10px', right: '12px', zIndex: '12', color: '#eee', fontSize: '12px' });
    }

    /* v45i/v45k：av.css 缓存自愈——WebView 可能拿旧缓存样式表（真机 12:28 截图实锤：
     * 顶栏飘中间/列表贴右缘，新 DOM+旧样式缝合体）。每次打开：①删掉旧 <link>（旧规则
     * 不再参与层叠）②fetch 最新内容内联注入。 */
    function refreshCriticalCss() {
        try {
            [].slice.call(document.querySelectorAll('link[rel="stylesheet"][href*="av.css"]')).forEach(function (l) { l.parentNode.removeChild(l); });
        } catch (e) { }
        fetch('av.css?v=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (txt) {
            if (txt && txt.indexOf('.av-page') >= 0 && txt.indexOf('.av-empty-btn') >= 0) {
                var st = document.getElementById('avCssFresh');
                if (!st) {
                    st = document.createElement('style');
                    st.id = 'avCssFresh';
                    document.head.appendChild(st);
                }
                if (st.textContent !== txt) {
                    st.textContent = txt;
                    dlog('css refreshed ' + txt.length + 'B');
                }
            } else {
                dlog('css fetch suspicious len=' + (txt || '').length);
            }
        }).catch(function (e) { dlog('css fetch ERR ' + (e && e.message || e)); });
    }

    function build() {
        if (S.built) return;
        S.built = true;

        page = el('div', 'av-page');
        page.id = 'avPage';

        // 顶栏（#4：padding 避让系统栏，由 CSS 变量控制）
        topEl = el('div', 'av-top');
        var backBtn = el('button', 'av-top-btn', '← 返回');
        backBtn.addEventListener('click', back);
        topEl.appendChild(backBtn);
        topEl.appendChild(el('div', 'av-top-title', ''));
        var saveBtn = el('button', 'av-top-btn', '💾 保存');
        saveBtn.addEventListener('click', function () { saveAll(true); });
        topEl.appendChild(saveBtn);
        var expBtn = el('button', 'av-top-btn av-primary', '📤 导出');
        expBtn.addEventListener('click', exportJson);
        topEl.appendChild(expBtn);
        page.appendChild(topEl);

        bodyEl = el('div', 'av-body');
        page.appendChild(bodyEl);

        // 左列表
        sideEl = el('div', 'av-side');
        var sideHead = el('div', 'av-side-head');
        var loadBtn = el('button', 'av-side-load', '📂 加载文件夹');
        loadBtn.addEventListener('click', pickFolder);
        sideHead.appendChild(loadBtn);
        var collapse = el('button', 'av-side-coll', '◀');
        collapse.addEventListener('click', function () { setSide(false); });
        sideHead.appendChild(collapse);
        sideEl.appendChild(sideHead);
        listEl = el('div', 'av-list');
        sideEl.appendChild(listEl);
        bodyEl.appendChild(sideEl);

        handleEl = el('button', 'av-handle', '▶');
        handleEl.addEventListener('click', function () { setSide(true); });
        page.appendChild(handleEl);

        // 右播放区
        mainEl = el('div', 'av-main');
        bodyEl.appendChild(mainEl);

        videoEl = el('video', 'av-video');
        videoEl.setAttribute('playsinline', '');
        videoEl.setAttribute('preload', 'auto');
        mainEl.appendChild(videoEl);

        audioCv = el('canvas', 'av-audio');
        mainEl.appendChild(audioCv);

        emptyHint = el('div', 'av-empty');
        emptyTitle = el('div', 'av-empty-t', '还没关联视频文件夹');
        emptyHint.appendChild(emptyTitle);
        emptyHint.appendChild(el('div', 'av-empty-s', '文件列表由所选文件夹自动生成；已打的标记保存在本机不会丢'));
        var reAuth = el('button', 'av-empty-btn', '📂 选择视频文件夹');
        reAuth.addEventListener('click', pickFolder);
        emptyHint.appendChild(reAuth);
        mainEl.appendChild(emptyHint);

        // ===== 右侧竖排控制栏（#1 位置 + #7 放大）=====
        // 上排：⏮ ⏯ ⏭；下排：◀ [步进] ▶
        railEl = el('div', 'av-rail');
        var rr1 = el('div', 'av-rail-row');
        btnPrev = el('button', 'av-ovl-btn av-big', '⏮');
        btnPrev.addEventListener('click', function () { stepFile(-1); });
        rr1.appendChild(btnPrev);
        btnPlay = el('button', 'av-ovl-btn av-big av-play', '▶');
        btnPlay.addEventListener('click', togglePlay);
        rr1.appendChild(btnPlay);
        btnNext = el('button', 'av-ovl-btn av-big', '⏭');
        btnNext.addEventListener('click', function () { stepFile(1); });
        rr1.appendChild(btnNext);
        railEl.appendChild(rr1);

        var rr2 = el('div', 'av-rail-row');
        var stL = el('button', 'av-ovl-btn av-big', '◀');
        stL.addEventListener('click', function () { stepTime(-1); });
        rr2.appendChild(stL);
        stepVal = el('input', 'av-ovl-input av-step');
        stepVal.type = 'text';
        stepVal.addEventListener('change', function () {
            var v = parseFloat(stepVal.value);
            if (v > 0) {
                if (S.meta.mode === 'video') S.meta.stepVideo = Math.max(1, Math.round(v));
                else S.meta.stepAudio = v;
                saveAll(false);
            }
            renderStepBox();
        });
        rr2.appendChild(stepVal);
        var stR = el('button', 'av-ovl-btn av-big', '▶');
        stR.addEventListener('click', function () { stepTime(1); });
        rr2.appendChild(stR);
        railEl.appendChild(rr2);
        mainEl.appendChild(railEl);

        // ===== 工具行（#5 顺序：⤴并入前段 | ✂分割点 | ▦多帧点 | fps）=====
        ovlEl = el('div', 'av-ovl');
        btnMerge = el('button', 'av-ovl-btn', '⤴ 并入前段');
        btnMerge.addEventListener('click', toggleMerge);
        ovlEl.appendChild(btnMerge);
        btnSplit = el('button', 'av-ovl-btn av-accent', '✂ 分割点');
        btnSplit.addEventListener('click', markSplit);
        ovlEl.appendChild(btnSplit);
        btnMulti = el('button', 'av-ovl-btn av-multi', '▦ 多帧点');
        btnMulti.addEventListener('click', toggleMulti);
        ovlEl.appendChild(btnMulti);

        var fpsWrap = el('label', 'av-ovl-fps');
        fpsBox = el('input', 'av-ovl-input av-fps');
        fpsBox.type = 'text';
        fpsBox.addEventListener('change', function () {
            var v = parseFloat(fpsBox.value);
            if (v > 0 && v <= 240) {
                S.meta.fps = v;
                S.meta.fpsSource = 'manual';
                S.fps = v;
                saveAll(false);
                renderPos();
            } else {
                renderStepBox();
            }
        });
        fpsWrap.appendChild(fpsBox);
        fpsWrap.appendChild(el('span', null, 'fps'));
        ovlEl.appendChild(fpsWrap);
        mainEl.appendChild(ovlEl);

        // ===== 播放条（#2 刻度与进度条同层对齐） =====
        tlWrap = el('div', 'av-tl-wrap');
        var rangeWrap = el('div', 'av-range-wrap');
        ticksEl = el('div', 'av-tl-ticks');
        rangeWrap.appendChild(ticksEl);
        tlRange = el('input', 'av-tl-range');
        tlRange.type = 'range';
        tlRange.min = '0';
        tlRange.max = '1000';
        tlRange.value = '0';
        tlRange.addEventListener('input', function () {
            if (!isFinite(videoEl.duration) || videoEl.duration <= 0) return;
            var t = (parseFloat(tlRange.value) / 1000) * videoEl.duration;
            t = L.snapT(t, S.marks.marks, effFps());
            videoEl.currentTime = t;
            renderPos();
        });
        rangeWrap.appendChild(tlRange);
        tlWrap.appendChild(rangeWrap);
        mainEl.appendChild(tlWrap);

        // #3：时间/帧数悬浮播放器右上角（独立于底条，避免被挤位）
        posEl = el('div', 'av-pos-top', '帧 1 · 0.00s / 0.00s');
        mainEl.appendChild(posEl);

        document.body.appendChild(page);

        // 安全区自愈：窗口尺寸/旋转变化时重读（v45d）
        if (!S._safeHooked) {
            S._safeHooked = true;
            var reapply = function () { if (page.classList.contains('open')) applySafeArea(); };
            addEventListener('resize', reapply);
            addEventListener('orientationchange', reapply);
        }

        videoEl.addEventListener('timeupdate', renderPos);
        videoEl.addEventListener('seeked', renderPos);
        videoEl.addEventListener('loadedmetadata', function () { renderPos(); });
        videoEl.addEventListener('error', function () {
            // v45f：视频流加载失败必须留痕（code 4=格式/网络不可用等）
            var ec = videoEl.error && videoEl.error.code;
            dlog('VIDEO-ERR code=' + ec + ' src=' + String(videoEl.src || '').slice(0, 60));
            toast('视频加载失败（code=' + ec + '），试试重新选目录或换文件');
        });
        videoEl.addEventListener('play', function () { btnPlay.textContent = '⏸'; startFpsSample(); });
        videoEl.addEventListener('pause', function () { btnPlay.textContent = '▶'; });
        videoEl.addEventListener('ended', function () { btnPlay.textContent = '▶'; renderPos(); });
    }

    function togglePlay() {
        if (!S.files.length || S.cur < 0) { toast('先加载文件夹并选择片段'); return; }
        if (videoEl.paused) {
            var pr = videoEl.play();
            if (pr && pr.catch) pr.catch(function () { toast('播放失败：格式或流不可用'); });
        } else {
            videoEl.pause();
        }
    }

    /* ---------- fps 估算（rVFC） ---------- */

    var COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];

    function startFpsSample() {
        if (S.meta.fpsSource === 'manual' && S.meta.fps) return;
        if (S.fpsSampling) return;
        if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return;
        S.fpsSampling = true;
        S.vfcSamples = [];
        S.vfcT0 = performance.now();
        var cb = function (now, meta) {
            if (!S.fpsSampling) return;
            S.vfcSamples.push({ t: performance.now(), pd: meta.presentedFrames });
            if (performance.now() - S.vfcT0 < 1000 && !videoEl.paused) {
                videoEl.requestVideoFrameCallback(cb);
            } else {
                finishFpsSample();
            }
        };
        videoEl.requestVideoFrameCallback(cb);
    }

    function finishFpsSample() {
        S.fpsSampling = false;
        var s = S.vfcSamples;
        if (s.length < 4) return;
        var spans = [];
        for (var i = 6; i < s.length; i++) {
            var dt = (s[i].t - s[i - 6].t) / 1000;
            var df = s[i].pd - s[i - 6].pd;
            if (dt > 0.2 && df > 0) spans.push(df / dt);
        }
        if (!spans.length) return;
        spans.sort(function (a, b) { return a - b; });
        var raw = spans[Math.floor(spans.length / 2)];
        var best = COMMON_FPS[0], bd = Infinity;
        COMMON_FPS.forEach(function (f) {
            var d = Math.abs(f - raw);
            if (d < bd) { bd = d; best = f; }
        });
        if (bd / best < 0.06) {
            S.meta.fps = best;
            S.meta.fpsSource = 'auto';
            S.fps = best;
            saveAll(false);
            renderStepBox();
            renderPos();
            toast('已估算 fps=' + best + '（框内可手动修正）');
        }
    }

    /* ---------- 列表 ---------- */

    function setSide(open) {
        sideEl.classList.toggle('closed', !open);
        // v45i：margin 百分比在不同容器解析不确定 → 内联显式赋值（相对 .av-body 宽，-100% 必然全隐藏）
        sideEl.style.marginLeft = open ? '0' : '-100%';
        handleEl.classList.toggle('show', !open);
    }

    function renderList() {
        listEl.innerHTML = '';
        S.files.forEach(function (f, i) {
            var card = el('div', 'av-item' + (i === S.cur ? ' on' : ''));
            card.appendChild(el('div', 'av-item-no', f.label));
            var info = el('div', 'av-item-info');
            info.appendChild(el('div', 'av-item-name', f.name));
            info.appendChild(el('div', 'av-item-sub', fmtSize(f.size)));
            card.appendChild(info);
            if (hasMerge(f.label)) card.appendChild(el('div', 'av-item-badge', '⤴'));
            var n = countSplits(f.label);
            if (n) card.appendChild(el('div', 'av-item-badge av-b-split', '✂' + n));
            card.addEventListener('click', function () { selectFile(i); });
            listEl.appendChild(card);
        });
        var on = listEl.querySelector('.av-item.on');
        if (on) on.scrollIntoView({ block: 'nearest' });
    }

    function countSplits(seg) {
        var n = 0;
        S.marks.marks.forEach(function (m) {
            if (m.type === 'split' && m.seg === seg) n++;
        });
        return n;
    }
    function hasMerge(seg) {
        return S.marks.marks.some(function (m) { return m.type === 'merge_prev' && m.seg === seg; });
    }

    /* ---------- 文件夹 / 服务器 ---------- */

    function pickFolder() {
        var p = ms();
        if (!p) { toast('MediaServer 插件不可用（请用 APK）'); return; }
        dlog('pickFolder: 打开系统目录选择器');
        p.pickFolder().then(function (r) {
            dlog('picked: ' + (r && r.name || '?') + ' uri=' + String(r && r.uri || '').slice(0, 48));
            S.meta.folderUri = r.uri;
            S.meta.folderName = r.name || '';
            saveAll(false);
            return refreshFolder();
        }).catch(function (e) {
            dlog('pick ERR ' + (e && (e.message || e) || e));
            toast('选择目录失败：' + (e && e.message || e));
        });
    }

    function refreshFolder() {
        var p = ms();
        if (!p || !S.meta.folderUri) return Promise.reject(new Error('未授权目录'));
        return p.listFiles({ uri: S.meta.folderUri }).then(function (r) {
            var names = [];
            var sizes = {};
            (r.files || []).forEach(function (f) { names.push(f.name); sizes[f.name] = f.size; });
            S.files = L.buildFileList(names, S.meta.mode);
            S.files.forEach(function (f) { f.size = sizes[f.name] || 0; });
            dlog('listFiles n=' + S.files.length);
            if (!S.files.length) {
                toast('目录里没有' + (S.meta.mode === 'audio' ? '音频' : '视频') + '文件');
            }
            renderSideHead();
            return startServer();
        }).then(function () {
            renderList();
            if (S.cur < 0 && S.files.length) selectFile(0);
            else if (S.cur >= 0) playCurrent(true);
        }).catch(function (e) {
            dlog('folder/server ERR ' + (e && (e.message || e) || e));
            throw e;
        });
    }

    function renderSideHead() {
        var t = topEl.querySelector('.av-top-title');
        t.textContent = S.project + (S.meta.folderName ? ' · ' + S.meta.folderName : '') +
            '（' + S.files.length + ' 段）';
    }

    function startServer() {
        var p = ms();
        if (!p) return Promise.reject(new Error('插件不可用'));
        return p.start({ uri: S.meta.folderUri }).then(function (r) {
            S.serverPort = r.port;
        });
    }

    function stopServer() {
        var p = ms();
        if (p) p.stop().catch(function () { });
        S.serverPort = 0;
    }

    /* ---------- 播放 ---------- */

    function selectFile(i) {
        if (i < 0 || i >= S.files.length) return;
        S.cur = i;
        renderList();
        playCurrent(true);
    }

    function stepFile(dir) {
        var i = S.cur + dir;
        if (i < 0 || i >= S.files.length) { toast(dir < 0 ? '已是第一条' : '已是最后一条'); return; }
        selectFile(i);
    }

    function playCurrent(keepPaused) {
        var f = S.files[S.cur];
        if (!f) return;
        emptyHint.style.display = 'none';
        videoEl.src = 'http://127.0.0.1:' + S.serverPort + '/' + encodeURIComponent(f.name);
        videoEl.load();
        renderList();
        renderPos();
        if (!keepPaused) togglePlay();
    }

    /* ---------- 位置显示 + 按钮状态 ---------- */

    function renderPos() {
        var t = videoEl.currentTime || 0;
        var d = videoEl.duration;
        if (isFinite(d) && d > 0) {
            tlRange.value = String(Math.round((t / d) * 1000));
        }
        if (S.meta.mode === 'video') {
            posEl.textContent = '帧 ' + (L.frameAt(t, effFps()) + 1) + ' · ' + fmt2(t) + 's / ' +
                (isFinite(d) ? fmt2(d) : '0.00') + 's';
        } else {
            posEl.textContent = fmt2(t) + 's / ' + (isFinite(d) ? fmt2(d) : '0.00') + 's';
        }
        renderTicks();
        renderBtnStates();
    }

    function renderBtnStates() {
        var t = videoEl.currentTime || 0;
        var seg = curSeg();
        var f = effFps();
        var half = 0.5 / f;
        var hitSplit = S.marks.marks.some(function (m) {
            return m.type === 'split' && m.seg === seg && Math.abs(m.at - t) <= half + 1e-9;
        });
        btnSplit.textContent = hitSplit ? '✕ 移除分割点' : '✂ 分割点';
        btnSplit.classList.toggle('av-danger', hitSplit);

        var merged = L.normalizeMerge(S.marks, seg);
        btnMerge.textContent = merged ? '✕ 解除并入' : '⤴ 并入前段';
        btnMerge.classList.toggle('av-danger', !!merged);

        var fr = L.frameAt(t, f);
        var mf = null;
        S.marks.marks.forEach(function (m) {
            if (m.type === 'multiframe_ref' && m.seg === seg) mf = m;
        });
        var hitMulti = mf && mf.frames.indexOf(fr) >= 0;
        btnMulti.textContent = hitMulti ? '✕ 移除此帧' : '▦ 多帧点';
        btnMulti.classList.toggle('av-danger', hitMulti);
    }

    function renderTicks() {
        var d = videoEl.duration;
        ticksEl.innerHTML = '';
        if (!isFinite(d) || d <= 0) return;
        var seg = curSeg();
        S.marks.marks.forEach(function (m) {
            if (m.seg !== seg) return;
            if (m.type === 'split' && typeof m.at === 'number') {
                var k = el('i', 'av-tick av-tick-split');
                k.style.left = (m.at / d * 100) + '%';
                ticksEl.appendChild(k);
            }
            if (m.type === 'multiframe_ref' && Array.isArray(m.frames)) {
                m.frames.forEach(function (fr) {
                    var t = L.secAtFrame(fr, effFps());
                    if (t <= d) {
                        var k2 = el('i', 'av-tick av-tick-multi');
                        k2.style.left = (t / d * 100) + '%';
                        ticksEl.appendChild(k2);
                    }
                });
            }
        });
    }

    function curSeg() {
        var f = S.files[S.cur];
        return f ? f.label : null;
    }

    /* ---------- 标记 ---------- */

    function markSplit() {
        if (S.cur < 0) { toast('先选择片段'); return; }
        var seg = curSeg();
        var t = videoEl.currentTime || 0;
        var half = 0.5 / effFps();
        var hit = null;
        S.marks.marks.forEach(function (m) {
            if (m.type === 'split' && m.seg === seg && Math.abs(m.at - t) <= half + 1e-9) hit = m;
        });
        if (hit) {
            S.marks.marks.splice(S.marks.marks.indexOf(hit), 1);
            toast('已移除分割点 @' + fmt2(hit.at) + 's');
        } else {
            var qt = L.quantize(t, 'video', effFps(), 0);
            S.marks.marks.push({ id: 'm' + Date.now(), type: 'split', seg: seg, at: qt, note: '' });
            toast('✂ 分割点 @' + fmt2(qt) + 's（帧 ' + (L.frameAt(qt, effFps()) + 1) + '）');
        }
        saveAll(false);
        renderPos();
    }

    function toggleMerge() {
        if (S.cur < 0) { toast('先选择片段'); return; }
        var seg = curSeg();
        var exist = L.normalizeMerge(S.marks, seg);
        if (exist) {
            S.marks.marks.splice(S.marks.marks.indexOf(exist), 1);
            toast('已解除并入前段（' + seg + '）');
        } else {
            S.marks.marks.push({ id: 'm' + Date.now(), type: 'merge_prev', seg: seg, note: '' });
            toast('⤴ ' + seg + ' 并入前段');
        }
        saveAll(false);
        renderList();
        renderBtnStates();
    }

    function toggleMulti() {
        if (S.cur < 0) { toast('先选择片段'); return; }
        var seg = curSeg();
        var f = effFps();
        var fr = L.frameAt(videoEl.currentTime || 0, f);
        var mark = null;
        S.marks.marks.forEach(function (m) {
            if (m.type === 'multiframe_ref' && m.seg === seg) mark = m;
        });
        if (!mark) {
            mark = { id: 'm' + Date.now(), type: 'multiframe_ref', seg: seg, frames: [], note: '' };
            S.marks.marks.push(mark);
        }
        var i = mark.frames.indexOf(fr);
        if (i >= 0) {
            mark.frames.splice(i, 1);
            toast('▦ 已移除参考帧 ' + (fr + 1) + '（剩 ' + mark.frames.length + '）');
            if (!mark.frames.length) {
                S.marks.marks.splice(S.marks.marks.indexOf(mark), 1);
            }
        } else {
            mark.frames.push(fr);
            mark.frames.sort(function (a, b) { return a - b; });
            toast('▦ 参考帧 ' + (fr + 1) + '（共 ' + mark.frames.length + ' 个）');
        }
        saveAll(false);
        renderPos();
    }

    /* ---------- 步进 ---------- */

    function stepTime(dir) {
        if (S.cur < 0) return;
        var st;
        if (S.meta.mode === 'video') {
            st = (S.meta.stepVideo || 1) / effFps();
        } else {
            st = S.meta.stepAudio || 0.05;
        }
        var t = (videoEl.currentTime || 0) + dir * st;
        if (t < 0) t = 0;
        if (isFinite(videoEl.duration) && t > videoEl.duration) t = videoEl.duration;
        if (S.meta.mode === 'video') t = L.quantize(t, 'video', effFps(), 0);
        videoEl.currentTime = t;
        renderPos();
    }

    function renderStepBox() {
        if (S.meta.mode === 'video') stepVal.value = (S.meta.stepVideo || 1) + '帧';
        else stepVal.value = (S.meta.stepAudio || 0.05) + 's';
        fpsBox.value = S.fps ? String(S.fps) : String(effFps());
        fpsBox.placeholder = String(effFps());
    }

    /* ---------- 保存 / 返回 ---------- */

    function saveAll(explicit) {
        if (!S.project) return;
        try {
            L.saveMeta(S.meta);
            L.saveMarks(S.project, S.marks);
            if (explicit) toast('已保存「' + S.project + '」（' + S.marks.marks.length + ' 条标记）');
        } catch (e) {
            toast('保存失败：' + (e && e.message || e));
        }
    }

    function back() {
        dlog('back() cur=' + S.cur);
        saveAll(false);
        stopServer();
        unlockOrientation();
        page.classList.remove('open');
        page.style.display = 'none';   // v45h：内联兑底样式同步隐藏
        var pj = document.getElementById('pjPage');
        if (pj) pj.classList.add('open');
        if (window.__projects && window.__projects.list) window.__projects.list();
    }

    /* ---------- 导出 ---------- */

    function exportJson() {
        if (!S.project) return;
        var json = L.buildExport(S.meta, S.marks, S.files);
        var text = JSON.stringify(json, null, 2);
        var sp = savePlug();
        var name = 'marks-' + S.project.replace(/[\\/:*?"<>|]/g, '_') + '-' +
            new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '.json';
        if (sp && sp.shareFile) {
            var b64 = btoa(unescape(encodeURIComponent(text)));
            sp.shareFile({ data: b64, filename: name, mime: 'application/json' })
                .then(function () { toast('已唤起分享，把 JSON 发给音视频助手'); })
                .catch(function (e) { toast('分享失败：' + (e && e.message || e)); });
        } else {
            var blob = new Blob([text], { type: 'application/json' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            a.click();
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
            toast('JSON 已下载（APK 内走分享）');
        }
    }

    /* ---------- 打开工程 ---------- */

    function open(projectName) {
        try {
            dlog('open(' + projectName + ') meta=' + (L.loadMeta(projectName) ? 'ok' : 'new') +
                ' folderUri=' + !!(L.loadMeta(projectName) && L.loadMeta(projectName).folderUri));
            build();
            S.project = projectName;
            S.meta = L.loadMeta(projectName) || L.emptyMeta(projectName, 'video');
            S.marks = L.loadMarks(projectName);
            S.files = [];
            S.cur = -1;
            S.fps = S.meta.fps || null;
            setSide(true);
            renderStepBox();
            renderSideHead();
            renderList();
            renderPos();
            page.classList.add('open');
            // v45h 兑底：真机 08:56 日志 class 已加但屏幕仍是工程列表（层叠未生效）→ 内联样式强制铺满置顶
            page.style.position = 'fixed';
            page.style.inset = '0';
            page.style.zIndex = '1550';
            page.style.display = 'flex';
            emptyHint.style.display = 'none';   // v45i：样式表异常时防空态常驻，显示由下方分支显式控制
            applyLayoutGuard();     // v45i：结构布局内联兑底
            refreshCriticalCss();   // v45i：av.css 缓存自愈
            lockLandscape();
            applySafeArea();      // #4：系统栏避让
            dlog('page open; folderUri=' + (S.meta.folderUri ? 'yes' : 'no'));
            // 渲染取证：120ms 后回报计算样式（若再异常，日志直接给出层叠真相）
            setTimeout(function () {
                try {
                    var cs = getComputedStyle(page);
                    dlog('forensics display=' + cs.display + ' z=' + cs.zIndex +
                        ' rect=' + JSON.stringify(page.getBoundingClientRect()) +
                        ' top=' + JSON.stringify(topEl.getBoundingClientRect()) +
                        ' side=' + JSON.stringify(sideEl.getBoundingClientRect()) +
                        ' sheets=' + document.styleSheets.length +
                        ' bodyT=' + (getComputedStyle(document.body).transform || 'none'));
                } catch (e) { }
            }, 120);
            if (S.meta.folderUri) {
                refreshFolder().then(function () {
                    dlog('files=' + S.files.length + ' port=' + S.serverPort + ' cur=' + S.cur);
                }).catch(function (e) {
                    dlog('refresh ERR ' + (e && (e.message || e) || e));
                    emptyTitle.textContent = S.meta.folderName ? '目录「' + S.meta.folderName + '」的授权已失效，重新选一次即可' : '还没关联视频文件夹';
                    emptyHint.style.display = 'flex';
                    toast('目录授权失效或不可读：请重新选择文件夹');
                });
            } else {
                emptyTitle.textContent = S.meta.folderName ? '目录「' + S.meta.folderName + '」的授权已失效，重新选一次即可' : '还没关联视频文件夹';
                emptyHint.style.display = 'flex';
                dlog('empty ui shown (无关联文件夹)');
            }
        } catch (e) {
            // 静默失败终结者：打开过程任何异常都直接告诉老板 + 落日志
            var m = e && (e.stack || e.message) || String(e);
            dlog('open FAIL ' + m);
            toast('打开视频工作台失败：' + (e && e.message || e));
            try { page.classList.remove('open'); page.style.display = 'none'; var pj = document.getElementById('pjPage'); if (pj) pj.classList.add('open'); } catch (e2) { }
        }
    }

    /* ---------- 调试钩子 ---------- */

    window.__av = {
        open: open,
        back: back,
        state: function () {
            return {
                project: S.project, mode: S.meta && S.meta.mode, files: S.files.length,
                cur: S.cur, fps: S.fps, effFps: effFps(), port: S.serverPort,
                marks: S.marks && S.marks.marks.length,
                folderName: S.meta && S.meta.folderName
            };
        },
        marks: function () { return S.marks; },
        files: function () { return S.files; },
        _S: S,
        _setVideoTime: function (t) { videoEl.currentTime = t; renderPos(); },
        _markSplit: markSplit,
        _toggleMerge: toggleMerge,
        _toggleMulti: toggleMulti,
        _stepTime: stepTime,
        _togglePlay: togglePlay,
        _exportJson: function () { return L.buildExport(S.meta, S.marks, S.files); },
        _setFps: function (f) { S.meta.fps = f; S.meta.fpsSource = 'manual'; S.fps = f; renderStepBox(); renderPos(); }
    };
})();
