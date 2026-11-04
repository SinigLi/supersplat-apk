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

    /* v45k：av.css 全量内嵌（WebView 本地缓存不可控，不再 link 外部样式表） */
    var AV_CSS = "/* 摸鱼台 v45c —— AV 工作台样式（真机反馈第二轮 · 老板 7 条布局决议）\n *\n *  1. ⏮⏯⏭ + ◀步进▶ → 右侧中间竖排控制栏 .av-rail（大按钮 .av-big）\n *  2. 标记刻度与进度条同层（.av-range-wrap 内绝对定位，按拇指半径内缩对齐）\n *  3. 时间/帧数 → 播放器右上角悬浮标签 .av-pos-top\n *  4. 系统栏/挖孔避让：JS 把原生 insets 写进 --av-safe-* 变量，页面四向消费\n *     （Android 15 edge-to-edge 下 env(safe-area-inset) 不可靠，见 MediaServer.getSafeArea）\n *  5. 工具行顺序 ⤴|✂|▦|fps（DOM 顺序即视觉顺序，CSS 只管样式）\n *  6. 单击视频切全屏已删（stage-hit/imm 相关样式全部移除）\n *  7. .av-big = v45b 按钮放大 50%\n *\n * 继承 v45b：悬浮层 0.25/blur4、按钮 0.38+文字投影、av-danger 红「移除」态、\n * 强制横屏（JS 层，CSS 竖屏规则仅桌面调试兜底）。\n * v45d 热修：安全区由 .av-page padding 统一承担，内层元素不再重复消费\n *      （23:18 截图：原生物理 px 未换算 + 旋转过渡期脏值 → 整页被撑出大黑边）\n */\n */\n\n/* ===== 页面骨架（#4 安全区四向消费） ===== */\n.av-page {\n    --av-safe-top: 0px;\n    --av-safe-right: 0px;\n    --av-safe-bottom: 0px;\n    --av-safe-left: 0px;\n\n    display: none;\n    position: fixed;\n    inset: 0;\n    z-index: 1550;   /* 盖过工程页 1500，低于对话框 1600/toast 1700 */\n    background: #141414;\n    flex-direction: column;\n    padding-top: var(--av-safe-top);\n    padding-right: var(--av-safe-right);\n    padding-bottom: var(--av-safe-bottom);\n    padding-left: var(--av-safe-left);\n}\n.av-page.open { display: flex; }\n\n/* ===== 顶栏 ===== */\n.av-top {\n    display: flex;\n    align-items: center;\n    gap: 8px;\n    padding: 6px 10px;\n    background: #1d1d1f;\n    border-bottom: 1px solid #333;\n    min-height: 44px;\n    flex: 0 0 auto;\n}\n.av-top-title {\n    flex: 1;\n    color: #ddd;\n    font-size: 13px;\n    white-space: nowrap;\n    overflow: hidden;\n    text-overflow: ellipsis;\n}\n.av-top-btn {\n    background: #2a2a2e;\n    color: #ddd;\n    border: 1px solid #3a3a3e;\n    border-radius: 8px;\n    padding: 6px 12px;\n    font-size: 13px;\n}\n.av-top-btn.av-primary {\n    background: rgba(48, 98, 158, 0.9);\n    border-color: #3d6ea8;\n    color: #fff;\n}\n\n/* ===== 主体 ===== */\n.av-body {\n    flex: 1;\n    display: flex;\n    min-height: 0;\n    position: relative;\n}\n\n/* 左列表 30% */\n.av-side {\n    width: 30%;\n    min-width: 190px;\n    max-width: 340px;\n    background: #181820;\n    border-right: 1px solid #2c2c34;\n    display: flex;\n    flex-direction: column;\n    transition: margin-left 0.18s ease;\n}\n.av-side-head {\n    display: flex;\n    gap: 6px;\n    padding: 8px;\n    border-bottom: 1px solid #2c2c34;\n}\n.av-side-load {\n    flex: 1;\n    background: #26262e;\n    color: #ddd;\n    border: 1px solid #3a3a44;\n    border-radius: 8px;\n    padding: 7px 10px;\n    font-size: 13px;\n}\n.av-list { flex: 1; overflow-y: auto; padding: 6px; }\n.av-item {\n    display: flex;\n    align-items: center;\n    gap: 8px;\n    padding: 8px;\n    border-radius: 8px;\n    cursor: pointer;\n    margin-bottom: 2px;\n}\n.av-item.on { background: rgba(48, 98, 158, 0.35); }\n.av-item-no {\n    min-width: 34px;\n    text-align: center;\n    color: #9fb6d8;\n    font-size: 12px;\n    font-weight: 600;\n    background: rgba(60, 90, 140, 0.25);\n    border-radius: 6px;\n    padding: 3px 4px;\n}\n.av-item-info { flex: 1; min-width: 0; }\n/* v45o：文件名横向滚动看全名（老板 21:31），滚动条隐藏 */\n.av-item-name {\n    color: #ddd;\n    font-size: 12px;\n    white-space: nowrap;\n    overflow-x: auto;\n    overflow-y: hidden;\n    -webkit-overflow-scrolling: touch;\n    scrollbar-width: none;\n}\n.av-item-name::-webkit-scrollbar { display: none; }\n.av-item-sub { color: #777; font-size: 10px; margin-top: 2px; }\n.av-item-badge {\n    color: #ffd37a;\n    font-size: 11px;\n    background: rgba(180, 130, 40, 0.3);\n    border-radius: 5px;\n    padding: 2px 5px;\n}\n.av-item-badge.av-b-split { color: #9be29b; background: rgba(50, 140, 70, 0.3); }\n\n/* ===== 右播放区 ===== */\n.av-main {\n    flex: 1;\n    position: relative;\n    min-width: 0;\n    background: #000;\n    overflow: hidden;\n}\n.av-video {\n    position: absolute;\n    inset: 0;\n    width: 100%;\n    height: 100%;\n    object-fit: contain;\n    background: #000;\n}\n.av-audio {\n    position: absolute;\n    left: 0;\n    right: 0;\n    top: 0;\n    bottom: 56px;   /* v46c：给底部播放条留出完整空间，不再重叠压条 */\n    width: 100%;\n    height: auto;\n    display: none;\n    background: #ffffff;\n}\n.av-empty {\n    position: absolute;\n    inset: 0;\n    display: none;\n    flex-direction: column;\n    align-items: center;\n    justify-content: center;\n    gap: 14px;\n    color: #666;\n    font-size: 14px;\n    white-space: pre-line;\n    text-align: center;\n    pointer-events: auto;\n}\n.av-empty .av-empty-t { color: #aab4c4; font-size: 16px; font-weight: 600; pointer-events: none; }\n.av-empty .av-empty-s { color: #66707f; font-size: 12px; pointer-events: none; }\n.av-empty-btn {\n    background: rgba(48, 98, 158, 0.9);\n    color: #fff;\n    border: 1px solid #3d6ea8;\n    border-radius: 12px;\n    padding: 14px 26px;\n    font-size: 16px;\n}\n\n/* ===== #1 右侧中间竖排控制栏（⏮⏯⏭ / ◀步进▶） ===== */\n/* v46c：去掉大面积毛玻璃底板（真机挡住时频图），按钮自身半透明即可 */\n.av-rail {\n    position: absolute;\n    right: 12px;    /* v45d：安全区由 .av-page padding 统一承担 */\n    top: 50%;\n    transform: translateY(-50%);\n    z-index: 10;\n    display: flex;\n    flex-direction: column;\n    align-items: center;\n    gap: 8px;\n    padding: 0;\n    background: transparent;\n}\n.av-rail-row {\n    display: flex;\n    align-items: center;\n    gap: 8px;\n}\n\n/* ===== 通用按钮（v46c 低不透明度，不遮图） ===== */\n.av-ovl-btn {\n    background: rgba(20, 26, 40, 0.28);\n    color: #f2f2f5;\n    border: 1px solid rgba(255, 255, 255, 0.16);\n    border-radius: 9px;\n    padding: 8px 11px;\n    font-size: 12px;\n    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);\n    white-space: nowrap;\n}\n.av-ovl-btn:active { background: rgba(70, 70, 80, 0.55); }\n.av-ovl-btn.av-sq { padding: 8px 10px; min-width: 36px; }\n.av-ovl-btn.av-accent { color: #9be29b; }\n.av-ovl-btn.av-multi { color: #b48cff; }\n/* 游标命中已有标记 → 红「移除」态 */\n.av-ovl-btn.av-danger {\n    color: #ff7d7d;\n    border-color: rgba(220, 80, 80, 0.55);\n    background: rgba(120, 40, 40, 0.45);\n}\n/* #7 播放/上下集/步进放大 50%（v45b 基准 12px/8x11 → 18px/12x16） */\n.av-ovl-btn.av-big {\n    font-size: 18px;\n    padding: 12px 15px;\n    min-width: 52px;\n}\n.av-ovl-btn.av-big.av-play { min-width: 62px; }\n\n.av-ovl-input {\n    width: 52px;\n    background: rgba(20, 26, 40, 0.28);\n    color: #fff;\n    border: 1px solid rgba(255, 255, 255, 0.16);\n    border-radius: 8px;\n    padding: 6px 6px;\n    font-size: 12px;\n    text-align: center;\n    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);\n}\n.av-ovl-input.av-step { width: 56px; font-size: 13px; padding: 8px 6px; }\n.av-ovl-input.av-fps { width: 44px; }\n.av-ovl-fps {\n    display: flex;\n    align-items: center;\n    gap: 4px;\n    color: #aaa;\n    font-size: 11px;\n    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);\n}\n\n/* ===== #5 工具行（⤴|✂|▦|fps，悬浮底部居中） ===== */\n/* v45l：工具行 = 进度条上方左下角横排（并入前段 | 分割点 | 多帧点；fps 已移右上角信息条） */\n.av-ovl {\n    position: absolute;\n    left: 16px;\n    bottom: 58px;\n    z-index: 10;\n    display: flex;\n    flex-direction: row;\n    align-items: center;\n    gap: 8px;\n    padding: 3px 5px;\n    border-radius: 10px;\n    background: rgba(16, 18, 24, 0.14);\n}\n\n\n/* ===== #3 时间/帧数悬浮右上角 ===== */\n/* v45l：右上角信息条 = 帧/时间 + fps 芯片（点芯片改 fps） */\n.av-pos-top {\n    position: absolute;\n    top: 10px;\n    right: 12px;\n    z-index: 12;\n    display: flex;\n    align-items: center;\n    gap: 8px;\n    padding: 4px 8px;\n    border-radius: 8px;\n    background: rgba(16, 18, 24, 0.18);\n    color: #eee;\n    font-size: 12px;\n    pointer-events: auto;\n}\n.av-fps-chip {\n    padding: 2px 7px;\n    border-radius: 6px;\n    background: rgba(72, 118, 168, 0.35);\n    border: 1px solid rgba(110, 160, 215, 0.4);\n    color: #bcd6f5;\n    font-size: 12px;\n}\n.av-fps-chip:active { background: rgba(72, 118, 168, 0.6); }\n.av-fps-input {\n    width: 52px;\n    font-size: 12px;\n    padding: 2px 6px;\n    border-radius: 6px;\n    border: 1px solid #3a5a80;\n    background: #101014;\n    color: #eee;\n}\n.av-fps-hint { color: #8a8a92; font-size: 11px; }\n.av-fps-native {\n    font-size: 11px;\n    padding: 2px 7px;\n    border-radius: 6px;\n    border: 1px solid #3d6ea8;\n    background: #22405e;\n    color: #dcebff;\n}\n\n\n/* ===== v46c：音频模式（白底）下的深色文字适配 =====\n * 时频图是纯白底，原本为黑底视频设计的浅色文字/半透明底板全部失效，\n * 这里统一改成深色字 + 极淡底板，既不遮图又能读。\n */\n.av-audio-mode .av-pos-top {\n    background: rgba(255, 255, 255, 0.58);\n    color: #1c1c22;\n    border: 1px solid rgba(0, 0, 0, 0.1);\n}\n.av-audio-mode .av-fps-chip {\n    background: rgba(46, 134, 193, 0.16);\n    border-color: rgba(46, 134, 193, 0.45);\n    color: #14507a;\n}\n.av-audio-mode .av-ovl {\n    background: rgba(255, 255, 255, 0.3);\n}\n.av-audio-mode .av-ovl-btn {\n    background: rgba(255, 255, 255, 0.74);\n    color: #1c1c22;\n    border: 1px solid rgba(0, 0, 0, 0.14);\n    text-shadow: 0 1px 1px rgba(255, 255, 255, 0.7);\n}\n/* 右侧大按钮（⏮⏯⏭）：白底上再透一点，不把频谱整块遮掉 */\n.av-audio-mode .av-ovl-btn.av-big {\n    background: rgba(255, 255, 255, 0.70);\n    border: 1px solid rgba(0, 0, 0, 0.16);\n}\n.av-audio-mode .av-ovl-btn.av-accent { color: #167c3c; }\n.av-audio-mode .av-ovl-btn.av-multi { color: #6633cc; }\n.av-audio-mode .av-ovl-btn.av-danger {\n    color: #b32020;\n    background: rgba(255, 235, 235, 0.92);\n    border-color: rgba(200, 60, 60, 0.5);\n}\n.av-audio-mode .av-ovl-input {\n    background: rgba(255, 255, 255, 0.62);\n    color: #1c1c22;\n    border: 1px solid rgba(0, 0, 0, 0.16);\n    text-shadow: none;\n}\n.av-audio-mode .av-tl-wrap {\n    background: rgba(255, 255, 255, 0.42);\n    border: 1px solid rgba(0, 0, 0, 0.1);\n}\n.av-audio-mode .av-tl-range::-webkit-slider-runnable-track {\n    background: rgba(0, 0, 0, 0.18);\n}\n.av-audio-mode .av-tl-range::-webkit-slider-thumb {\n    background: #3a3a44;\n    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);\n}\n\n/* ===== #2 播放条：刻度与进度条同层 ===== */\n.av-tl-wrap {\n    position: absolute;\n    left: 16px;     /* v45d：内层不重复消费安全区 */\n    right: 16px;\n    bottom: 10px;\n    height: 40px;\n    z-index: 8;\n    background: rgba(16, 18, 24, 0.16);\n    border: 1px solid rgba(255, 255, 255, 0.1);\n    border-radius: 12px;\n}\n/* 刻度容器与 range 轨道对齐：内缩半个拇指宽（thumb 20px → 10px） */\n.av-range-wrap {\n    position: relative;\n    width: 100%;\n    height: 100%;\n}\n.av-tl-ticks {\n    position: absolute;\n    left: 10px;\n    right: 10px;\n    top: 8px;\n    bottom: 8px;\n    pointer-events: none;\n}\n.av-tick {\n    position: absolute;\n    top: 0;\n    width: 3px;\n    height: 100%;\n    border-radius: 2px;\n    transform: translateX(-1.5px);\n}\n.av-tick-split { background: #6fdc8c; }\n.av-tick-multi { background: #b48cff; width: 5px; }\n.av-tl-range {\n    position: absolute;\n    inset: 0;\n    width: 100%;\n    height: 100%;\n    -webkit-appearance: none;\n    background: transparent;\n    margin: 0;\n}\n.av-tl-range::-webkit-slider-runnable-track {\n    height: 5px;\n    background: rgba(255, 255, 255, 0.22);\n    border-radius: 3px;\n}\n.av-tl-range::-webkit-slider-thumb {\n    -webkit-appearance: none;\n    width: 20px;\n    height: 20px;\n    margin-top: -8px;\n    border-radius: 50%;\n    background: #e8e8ec;\n    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);\n}\n\n/* ===== 竖屏兜底（真机强制横屏后不会走到；桌面调试用） ===== */\n@media (max-width: 699px) {\n    .av-side {\n        position: absolute;\n        left: 0;\n        top: 44px;\n        bottom: 0;\n        z-index: 30;\n        width: 62%;\n        max-width: 320px;\n        box-shadow: 4px 0 24px rgba(0, 0, 0, 0.5);\n    }\n    .av-rail { right: 8px; }\n}\n\n/* ===== v45m：列表首帧缩略图 ===== */\n.av-thumb {\n    width: 96px;\n    height: 54px;\n    margin-top: 4px;\n    border-radius: 6px;\n    background: #101016;\n    border: 1px solid #2c2c34;\n    overflow: hidden;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n}\n.av-thumb-ph { color: #4a4a55; font-size: 20px; }\n.av-thumb-img { width: 100%; height: 100%; object-fit: cover; display: block; }\n";


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
        railEl, audioCv, emptyHint, emptyTitle, toastTimer = null,
    fpsEditing = false;

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

    /* v45l：结构布局内联兜底 v3（v45k 骨架真机已正常；本版：工具行=进度条上方左下角横排，
 * fps 不再独立浮层，统一进右上角信息条 posEl） */
    function applyLayoutGuard() {
        if (!page || !topEl || !bodyEl) return;
        var pg = page.style;
        pg.position = 'fixed'; pg.top = '0'; pg.right = '0'; pg.bottom = '0'; pg.left = '0';
        pg.zIndex = '1550'; pg.display = 'flex'; pg.flexDirection = 'column'; pg.background = '#141414';
        var tt = topEl.style;
        tt.display = 'flex'; tt.alignItems = 'center'; tt.gap = '8px'; tt.padding = '6px 10px';
        tt.background = '#1d1d1f'; tt.borderBottom = '1px solid #333'; tt.minHeight = '44px';
        tt.flex = '0 0 auto'; tt.position = 'relative'; tt.zIndex = '2'; tt.boxSizing = 'border-box'; tt.width = '100%';
        var t1 = topEl.querySelector('.av-top-title');
        if (t1) {
            t1.style.flex = '1'; t1.style.minWidth = '0'; t1.style.color = '#ddd'; t1.style.fontSize = '13px';
            t1.style.whiteSpace = 'nowrap'; t1.style.overflow = 'hidden'; t1.style.textOverflow = 'ellipsis';
        }
        var bs = bodyEl.style;
        bs.flex = '1'; bs.display = 'flex'; bs.flexDirection = 'row'; bs.minHeight = '0'; bs.position = 'relative'; bs.width = '100%';
        var ss = sideEl.style;
        ss.width = '30%'; ss.minWidth = '190px'; ss.maxWidth = '340px'; ss.flex = '0 0 auto';
        ss.background = '#181820'; ss.borderRight = '1px solid #2c2c34';
        ss.display = 'flex'; ss.flexDirection = 'column'; ss.position = 'relative'; ss.overflow = 'hidden';
        var ms = mainEl.style;
        ms.flex = '1'; ms.position = 'relative'; ms.minWidth = '0'; ms.background = '#000'; ms.overflow = 'hidden';
        var vs = videoEl.style;
        vs.position = 'absolute'; vs.top = '0'; vs.left = '0'; vs.width = '100%'; vs.height = '100%';
        vs.objectFit = 'contain'; vs.background = '#000';
        var es = emptyHint.style;
        es.position = 'absolute'; es.top = '0'; es.right = '0'; es.bottom = '0'; es.left = '0';
        es.flexDirection = 'column'; es.alignItems = 'center'; es.justifyContent = 'center'; es.gap = '14px';
        var rs = railEl.style;
        rs.position = 'absolute'; rs.right = '12px'; rs.top = '50%';
        rs.transform = 'translateY(-50%)'; rs.zIndex = '10';
        rs.display = 'flex'; rs.flexDirection = 'column'; rs.alignItems = 'center'; rs.gap = '8px';
        rs.padding = '0'; rs.background = 'transparent';
        var os = ovlEl.style;
        os.position = 'absolute'; os.left = '16px'; os.bottom = '58px';
        os.zIndex = '10'; os.display = 'flex'; os.flexDirection = 'row'; os.alignItems = 'center'; os.gap = '8px'; os.padding = '3px 5px';
        os.background = 'rgba(16,18,24,0.14)'; os.borderRadius = '10px';
        var ts = tlWrap.style;
        ts.position = 'absolute'; ts.left = '16px'; ts.right = '16px'; ts.bottom = '10px'; ts.height = '40px'; ts.zIndex = '8';
        var ps = posEl.style;
        ps.position = 'absolute'; ps.top = '10px'; ps.right = '12px'; ps.zIndex = '12';
        ps.display = 'flex'; ps.alignItems = 'center'; ps.gap = '8px';
        ps.fontSize = '12px';   // v46c：颜色交给 applyStageMode（音频白底需深色）
    }

    /* v45k：av.css 内嵌注入——不再依赖外部样式表加载（WebView 缓存不可控），
     * 每次打开工作台同步注入全量样式；APK 换版必然带最新样式。 */
    function embedAvCss() {
        try {
            [].slice.call(document.querySelectorAll('link[rel="stylesheet"][href*="av.css"]')).forEach(function (l) { l.parentNode.removeChild(l); });
        } catch (e) { }
        var st = document.getElementById('avCssEmbed');
        if (!st) {
            st = document.createElement('style');
            st.id = 'avCssEmbed';
            document.head.appendChild(st);
        }
        if (st.textContent !== AV_CSS) {
            st.textContent = AV_CSS;
            dlog('av.css embedded ' + AV_CSS.length + 'B');
        }
    }

    /* ---------- v45l：右上角信息条 + fps 原生化 ---------- */

    function trim1(v) {
        var s = (Math.round(v * 100) / 100).toFixed(2);
        return s.replace(/\.?0+$/, '');
    }

    function mkPosMain(t, d) {
        var sp = document.createElement('span');
        sp.textContent = '帧 ' + (L.frameAt(t, effFps()) + 1) + ' · ' + fmt2(t) + 's / ' +
            (isFinite(d) && d > 0 ? fmt2(d) : '0.00') + 's';
        return sp;
    }

    function mkFpsChip() {
        var chip = document.createElement('span');
        chip.className = 'av-fps-chip';
        var src = S.meta.fpsSource === 'native' ? '·原生'
            : (S.meta.fpsSource === 'manual' ? '·手填'
            : (S.meta.fpsSource === 'auto' ? '·估' : ''));
        chip.textContent = trim1(effFps()) + 'fps' + src;
        return chip;
    }

    /* v45w：页面内视频捕获——隐藏 <video> 走本地 Range 服务（与主播放同一条解码栈），
     * seek 到 0.4s 后 canvas 截 192px 帧。并发 1、10s 总超时、失败静默留占位。 */
    function videoThumbPump() {
        if (videoThumbBusy || !videoThumbQueue.length) return;
        if (S.serverPort <= 0) { videoThumbQueue.length = 0; return; }
        videoThumbBusy = true;
        var job = videoThumbQueue.shift();
        var v = document.createElement('video');
        var done = false;
        var timer = setTimeout(function () { finish(null, 'capture timeout'); }, 10000);
        function finish(jpeg, err) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            videoThumbBusy = false;
            try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) { }
            if (jpeg) {
                thumbCache[job.name] = jpeg;   // v45x：先入缓存，下次打开秒出
                thumbOkCount++;
                if (job.box && job.box.isConnected) thumbApply(job.box, jpeg);
            } else {
                thumbFailCount++;
                thumbFailCache[job.name] = 'video capture: ' + (err || 'unknown');
                if (!thumbFailSample) thumbFailSample = job.name + '(video capture fail)';
            }
            if (!thumbJobs.length && !thumbLive && !videoThumbQueue.length) thumbSummary();
            setTimeout(videoThumbPump, 60);
        }
        try {
            v.muted = true;
            v.playsInline = true;
            v.preload = 'auto';
            v.src = 'http://127.0.0.1:' + S.serverPort + '/' + encodeURIComponent(job.name);
            v.addEventListener('loadeddata', function () {
                try { v.currentTime = Math.min(0.4, (v.duration || 1) * 0.1); } catch (e) { finish(null, 'seek err'); }
            });
            v.addEventListener('seeked', function () {
                try {
                    var c = document.createElement('canvas');
                    c.width = 192;
                    c.height = Math.max(1, Math.round(v.videoHeight * 192 / (v.videoWidth || 192)));
                    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
                    var jpeg = c.toDataURL('image/jpeg', 0.7).split(',')[1];
                    finish(jpeg && jpeg.length > 50 ? jpeg : null, jpeg ? null : 'empty capture');
                } catch (e) { finish(null, 'canvas err: ' + (e && e.message || e)); }
            });
            v.addEventListener('error', function () { finish(null, 'video load err'); });
        } catch (e) { finish(null, 'setup err'); }
    }

    function mkThumbToggle() {
        var chip = document.createElement('span');
        chip.className = 'av-fps-chip av-thumb-toggle';
        chip.textContent = (S.meta.thumbs === false ? '🖼 关' : '🖼 开');
        return chip;
    }

    function toggleThumbs() {
        S.meta.thumbs = (S.meta.thumbs === false);   // 默认开
        saveAll(false);
        renderList();
        renderPos();
    }

    function startFpsEdit() {
        if (S.meta.mode !== 'video' || fpsEditing) return;
        fpsEditing = true;
        var inp = document.createElement('input');
        inp.className = 'av-fps-input';
        inp.type = 'text';
        inp.value = S.fps ? String(Math.round(S.fps * 100) / 100) : String(effFps());
        posEl.innerHTML = '';
        posEl.appendChild(inp);
        var hint = document.createElement('span');
        hint.className = 'av-fps-hint';
        hint.textContent = S.meta.fpsSource === 'native' ? '回车确认' : '回车确认';
        posEl.appendChild(hint);
        if (S.meta.fpsSource !== 'native' && S.meta.nativeFps) {
            var useN = document.createElement('button');
            useN.className = 'av-fps-native';
            useN.textContent = '用原生值 ' + trim1(S.meta.nativeFps);
            useN.addEventListener('mousedown', function (e) { e.preventDefault(); });   // 防 input blur 先移除按钮
            useN.addEventListener('click', function () {
                S.meta.fps = S.meta.nativeFps;
                S.meta.fpsSource = 'native';
                S.fps = S.meta.nativeFps;
                saveAll(false);
                fpsEditing = false;
                renderPos();
                toast('已采用容器原生帧率');
            });
            posEl.appendChild(useN);
        }
        inp.focus();
        inp.select();
        var done = function (commit) {
            if (!fpsEditing) return;
            if (commit) {
                var v = parseFloat(inp.value);
                if (v > 0 && v <= 240) {
                    S.meta.fps = v;
                    S.meta.fpsSource = 'manual';
                    S.fps = v;
                    saveAll(false);
                }
            }
            fpsEditing = false;
            renderPos();
        };
        inp.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') done(true);
            else if (ev.key === 'Escape') done(false);
        });
        inp.addEventListener('blur', function () { done(false); });
    }

    function mediaMeta() {
        var cap = window.Capacitor;
        var p = (cap && cap.Plugins && cap.Plugins.MediaServer) || null;
        if (!p || !S.serverPort) return Promise.resolve(null);
        var f = S.files[S.cur];
        if (!f) return Promise.resolve(null);
        return p.probeMeta({ name: f.name }).then(function (r) {
            return (r && r.ok) ? r : null;
        }).catch(function () { return null; });
    }

    function requestNativeMeta() {
        if (S.meta.mode !== 'video') return;
        mediaMeta().then(function (m) {
            if (!m) return;
            // v45p：吸附收紧到 2.5%（v45o 的 6% 会把乱序采样得到的乱值错误吸附到 29.97/25）
            if (m.fps && m.fps > 1 && m.fps <= 240) {
                for (var i = 0; i < COMMON_FPS.length; i++) {
                    if (Math.abs(m.fps - COMMON_FPS[i]) / COMMON_FPS[i] < 0.025) { m.fps = COMMON_FPS[i]; break; }
                }
            }
            dlog('probeMeta fps=' + m.fps + ' rot=' + m.rotation + ' ' + m.width + 'x' + m.height);
            S.meta.nativeFps = m.fps || null;
            S.meta.nativeW = m.width || null;
            S.meta.nativeH = m.height || null;
            S.meta.nativeRot = m.rotation || null;
            if (!m.fps || m.fps <= 1 || m.fps > 240) return;
            if (S.meta.fpsSource !== 'manual' && S.meta.fpsSource !== 'native') {
                S.meta.fps = m.fps;
                S.meta.fpsSource = 'native';
                S.fps = m.fps;
                saveAll(false);
                renderPos();
                renderStepBox();
                toast('帧率（容器原生）：' + trim1(m.fps) + ' fps');
            } else if (S.meta.fpsSource === 'native') {
                S.meta.fps = m.fps;
                S.fps = m.fps;
                saveAll(false);
                renderPos();
            } else if (S.meta.fpsSource === 'manual' && Math.abs(effFps() - m.fps) <= 0.5) {
                // v45p：手填 24 vs 原生 23.976 这类「本质一致」→ 静默采用原生精确值，不再反复弹提示
                S.meta.fps = m.fps;
                S.meta.fpsSource = 'native';
                S.fps = m.fps;
                saveAll(false);
                renderPos();
                renderStepBox();
            } else if (Math.abs(effFps() - m.fps) > 0.4) {
                toast('提示：手填帧率 ' + trim1(effFps()) + ' 与容器原生 ' + trim1(m.fps) + ' 不一致（点右上角 fps 可改）');
            }
        });
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
        sideEl.appendChild(sideHead);   // v45o：收起按钮已删（老板 21:31）
        listEl = el('div', 'av-list');
        sideEl.appendChild(listEl);
        bodyEl.appendChild(sideEl);


        // 右播放区
        mainEl = el('div', 'av-main');
        bodyEl.appendChild(mainEl);

        videoEl = el('video', 'av-video');        videoEl.setAttribute('playsinline', '');
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
            var D = curDur();
            if (!isFinite(D) || D <= 0) return;
            var t = (parseFloat(tlRange.value) / 1000) * D;
            t = L.snapT(t, S.marks.marks, effFps());
            setTime(t);
            renderPos();
        });
        rangeWrap.appendChild(tlRange);
        tlWrap.appendChild(rangeWrap);
        mainEl.appendChild(tlWrap);

        // #3：时间/帧数悬浮播放器右上角（独立于底条，避免被挤位）
        // v45l：右上角信息条（帧/时间 + fps 芯片，点芯片进入编辑）
        posEl = el('div', 'av-pos-top');
        posEl.addEventListener('click', function (e) {
            if (S.meta.mode !== 'video') return;
            if (e.target && e.target.classList && e.target.classList.contains('av-thumb-toggle')) { toggleThumbs(); return; }
            if (e.target && e.target.classList && e.target.classList.contains('av-fps-chip')) startFpsEdit();
        });
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
        videoEl.addEventListener('loadedmetadata', function () {
            // v45n：选中即显示第一帧——部分 WebView loadedmetadata 后画面区仍是黑屏占位，
            // seek 微量触发解码器出第一帧，不用点播放/下一帧
            if (S.meta.mode !== 'audio' && (videoEl.currentTime || 0) === 0) { try { videoEl.currentTime = 0.001; } catch (e) { } }
            renderPos();
        });
        videoEl.addEventListener('error', function () {
            // v45f：视频流加载失败必须留痕（code 4=格式/网络不可用等）
            var ec = videoEl.error && videoEl.error.code;
            dlog('VIDEO-ERR code=' + ec + ' src=' + String(videoEl.src || '').slice(0, 60));
            if (!(S.meta && S.meta.mode === 'audio')) {
                toast('视频加载失败（code=' + ec + '），试试重新选目录或换文件');
            }
        });
        videoEl.addEventListener('play', function () { btnPlay.textContent = '⏸'; startFpsSample(); });
        videoEl.addEventListener('pause', function () { btnPlay.textContent = '▶'; });
        videoEl.addEventListener('ended', function () { btnPlay.textContent = '▶'; renderPos(); });
    }

    function updatePlayBtn() {
        var playing = (S.meta && S.meta.mode === 'audio') ? AP.playing : !videoEl.paused;
        if (btnPlay) btnPlay.textContent = playing ? '⏸' : '▶';
    }

    function togglePlay() {
        if (!S.files.length || S.cur < 0) { toast('先加载文件夹并选择片段'); return; }
        // v46：音频走 WebAudio 引擎（<video> 对 WAV 解码不可靠）
        if (S.meta.mode === 'audio') {
            if (AP.playing) {
                apPause();
            } else {
                var fa = S.files[S.cur];
                if (!AP.buf && fa) {
                    if (vizCache[fa.name]) apLoad(fa.name);
                    else { toast('音频还在分析，稍等一下再点播放'); return; }
                }
                if (!apPlay()) { toast('播放失败：音频未就绪'); return; }
            }
            updatePlayBtn();
            renderPos();
            return;
        }
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
        if (S.meta.fpsSource === 'manual' && S.fps) return;
        if (S.meta.fpsSource === 'native' && S.meta.fps) return;   // v45l：容器原生值优先，不再采样猜
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

    }

    /* v45o：首帧缩略图——原生 MediaServer.thumb 直接解码首帧 JPEG（base64）。
     * v45n 的 WebView 视频管线方案在真机不可靠（解码懒加载/画布路径），原生一次到位。 */
    /* v45s：缩略图缓存 + 泵（并发2 + 30ms 间隔）。
     * 会话级缓存：每个文件只解码一次，renderList 重绘直接命中贴图，不再重复打原生。
     * 清队：back()/renderList 时清待处理队列（旧容器已作废），在途的让它们自然结束（结果按 isConnected 丢弃）。
     * 日志：不再逐条刷 thumb fail（58 条×N 遍），队列排空后汇总一条 ok=N fail=M。 */
    var thumbJobs = [];
    var thumbLive = 0;
    var thumbCache = {};      // name -> jpeg(base64)
    var thumbPending = {};    // name -> true（在途，防重）
    var thumbFailCache = {};  // v45t：name -> 失败原因（会话内不再重试，省电省解码器）
    // v45w：页面内视频捕获降级（原生解码栈失败时的第二通道）
    var videoThumbQueue = [];     // { name, box }
    var videoThumbBusy = false;
    var videoThumbTried = {};     // name -> true（每个文件只降级一次）
    var videoThumbLogCount = 0;
    // v45x：原生通道自适应治理
    var consecutiveNativeFails = 0;
    var nativeThumbDisabled = false;
    var NATIVE_THUMB_KEY = 'moyutai.thumbNative';
    function nativeThumbPersistOff() {
        try {
            var raw = localStorage.getItem(NATIVE_THUMB_KEY);
            if (!raw) return false;
            var o = JSON.parse(raw);
            return !!(o && o.off && (Date.now() - (o.ts || 0) < 3 * 86400000));   // 3 天后自动重试原生
        } catch (e) { return false; }
    }
    function nativeThumbPersistSet(off) {
        try {
            if (off) localStorage.setItem(NATIVE_THUMB_KEY, JSON.stringify({ off: true, ts: Date.now() }));
            else localStorage.removeItem(NATIVE_THUMB_KEY);
        } catch (e) { }
    }
    function noteNativeFail(name, msg, box) {
        consecutiveNativeFails++;
        if (consecutiveNativeFails >= 2 && !nativeThumbDisabled) {
            nativeThumbDisabled = true;
            nativeThumbPersistSet(true);
            dlog('native thumb disabled (' + consecutiveNativeFails + ' fails) -> video capture mode');
        }
        if (!videoThumbTried[name]) {
            videoThumbTried[name] = true;
            if (videoThumbQueue.length < 500) videoThumbQueue.push({ name: name, box: box });
            if (videoThumbLogCount < 3) { videoThumbLogCount++; dlog('thumb native fail -> video capture ' + name); }
            setTimeout(videoThumbPump, 50);
        } else {
            thumbFailCount++;
            thumbFailCache[name] = msg;
            if (thumbFailLogged < 3) { thumbFailLogged++; dlog('thumb fail ' + name + ': ' + msg); }
            if (!thumbFailSample) thumbFailSample = name + '(' + msg + ')';
        }
    }
    var thumbFailLogged = 0;  // 只详细记录前 3 条失败（够定位，不刷屏）
    var thumbFailSample = ''; // 汇总里带的第一条失败样例
    var thumbOkCount = 0, thumbFailCount = 0, thumbSummarized = true;
    function thumbFlush() {
        thumbJobs.length = 0;
    }
    function thumbApply(box, jpeg) {
        var img = document.createElement('img');
        img.className = 'av-thumb-img';
        img.src = 'data:image/jpeg;base64,' + jpeg;
        box.innerHTML = '';
        box.appendChild(img);
    }
    function thumbSummary() {
        if (thumbSummarized) return;
        thumbSummarized = true;
        if (thumbOkCount || thumbFailCount) dlog('thumbs done ok=' + thumbOkCount + ' fail=' + thumbFailCount + (thumbFailSample ? ' e.g. ' + thumbFailSample : ''));
        thumbOkCount = 0;
        thumbFailCount = 0;
    }
    function thumbEnqueue(f, box) {
        var hit = thumbCache[f.name];
        if (hit) { thumbApply(box, hit); return; }
        if (nativeThumbDisabled || nativeThumbPersistOff()) {
            // v45x：原生解码已被判死（会话连续失败或历史记录）→ 直接走视频捕获
            if (videoThumbQueue.length < 500) videoThumbQueue.push({ name: f.name, box: box });
            setTimeout(videoThumbPump, 30);
            return;
        }
        if (thumbFailCache[f.name]) return; // v45t：失败过的文件本会话不再重试
        if (thumbPending[f.name]) return;   // 在途，等结果（结果回调会按 isConnected 决定是否贴图）
        thumbJobs.push({ f: f, box: box });
        thumbSummarized = false;
        thumbDrain();
    }
    function thumbDrain() {
        while (thumbLive < 2 && thumbJobs.length) {
            var job = thumbJobs.shift();
            thumbLive++;
            thumbPending[job.f.name] = true;
            (function (job) {
                var cap = window.Capacitor;
                var p = cap && cap.Plugins && cap.Plugins.MediaServer;
                if (!p || !p.thumb) { thumbLive--; delete thumbPending[job.f.name]; thumbSummary(); return; }
                // v45x：15s 看门狗——原生挂起不让队列冻死，直接转视频捕获
                var settled = false;
                var watchdog = setTimeout(function () {
                    if (settled) return;
                    settled = true;
                    thumbLive--;
                    delete thumbPending[job.f.name];
                    noteNativeFail(job.f.name, 'native timeout', job.box);
                    if (!thumbJobs.length && !thumbLive) thumbSummary();
                    setTimeout(thumbDrain, 30);
                }, 15000);
                p.thumb({ name: job.f.name }).then(function (r) {
                    if (settled) return;
                    settled = true;
                    clearTimeout(watchdog);
                    thumbLive--;
                    delete thumbPending[job.f.name];
                    consecutiveNativeFails = 0;
                    nativeThumbPersistSet(false);
                    if (r && r.jpeg && String(r.jpeg).length > 50) {
                        thumbCache[job.f.name] = r.jpeg;
                        if (job.box.isConnected) thumbApply(job.box, r.jpeg);
                        thumbOkCount++;
                    } else {
                        thumbFailCount++;
                        thumbFailCache[job.f.name] = 'empty jpeg';
                        if (thumbFailLogged < 3) { thumbFailLogged++; dlog('thumb fail ' + job.f.name + ': empty jpeg'); }
                        if (!thumbFailSample) thumbFailSample = job.f.name + '(empty jpeg)';
                    }
                    if (!thumbJobs.length && !thumbLive) thumbSummary();
                    setTimeout(thumbDrain, 30);
                }).catch(function (e) {
                    if (settled) return;
                    settled = true;
                    clearTimeout(watchdog);
                    thumbLive--;
                    delete thumbPending[job.f.name];
                    noteNativeFail(job.f.name, e && e.message || String(e), job.box);
                    if (!thumbJobs.length && !thumbLive) thumbSummary();
                    setTimeout(thumbDrain, 30);
                });
            })(job);
        }
    }
    var mkThumbCalls = 0;
    function mkThumb(f) {
        mkThumbCalls++;
        if (mkThumbCalls <= 3) dlog('mkThumb #' + mkThumbCalls + ' ' + f.name);
        var box = el('div', 'av-thumb');
        box.appendChild(el('div', 'av-thumb-ph', '▶'));
        try { thumbEnqueue(f, box); } catch (e) { dlog('mkThumb enqueue ERR ' + (e && e.message || e)); }
        return box;
    }

    function renderList() {
        thumbFlush();   // v45s：列表即将重建，旧队列任务引用的容器已作废
        listEl.innerHTML = '';
        S.files.forEach(function (f, i) {
            var card = el('div', 'av-item' + (i === S.cur ? ' on' : ''));
            var noEl = el('div', 'av-item-no', f.label);
            card.appendChild(noEl);
            if (S.serverPort > 0 && S.meta.mode === 'video' && S.meta.thumbs !== false) {
                noEl.appendChild(mkThumb(f));          // 首帧缩略图贴在序号下（🖼 开关可关）
            }
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
        dlog('renderList done files=' + S.files.length + ' port=' + S.serverPort + ' mode=' + S.meta.mode +
            ' thumbs=' + S.meta.thumbs + ' q=' + JSON.stringify({ jobs: thumbJobs.length, live: thumbLive }) +
            ' mkCalls=' + mkThumbCalls);
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

    /* ===== v46：音频时频图（av-viz.js） ===== */
    var vizCache = {};        // name -> { mono, sr, dur, segs }
    var vizKeys = [];         // LRU，最多留 3 个
    var vizBusy = null;       // 正在解码的文件名

    function applyStageMode() {
        var isAudio = !!(S.meta && S.meta.mode === 'audio');
        if (videoEl) videoEl.style.display = isAudio ? 'none' : 'block';
        if (audioCv) audioCv.style.display = isAudio ? 'block' : 'none';
        if (!page) return;
        page.classList.toggle('av-audio-mode', isAudio);
        /* v46c：applyLayoutGuard 用内联样式把颜色写死了（内联优先级高于类选择器），
         * 所以这里必须同时改内联值，否则白底上是浅色字根本看不见。 */
        if (posEl) {
            posEl.style.color = isAudio ? '#1c1c22' : '#eee';
            posEl.style.background = isAudio ? 'rgba(255,255,255,0.58)' : 'rgba(16,18,24,0.18)';
            posEl.style.border = isAudio ? '1px solid rgba(0,0,0,0.1)' : 'none';
        }
        if (ovlEl) {
            ovlEl.style.background = isAudio ? 'rgba(255,255,255,0.3)' : 'rgba(16,18,24,0.14)';
        }
        if (tlWrap) {
            tlWrap.style.background = isAudio ? 'rgba(255,255,255,0.42)' : 'rgba(16,18,24,0.16)';
        }
        var btns = [btnMerge, btnSplit, btnMulti];
        for (var b = 0; b < btns.length; b++) {
            if (!btns[b]) continue;
            btns[b].style.background = isAudio ? 'rgba(255,255,255,0.74)' : '';
            btns[b].style.color = '';
            btns[b].style.textShadow = isAudio ? '0 1px 1px rgba(255,255,255,0.8)' : '';
            btns[b].style.border = isAudio ? '1px solid rgba(0,0,0,0.14)' : '';
        }
    }

    function vizPlaceholder(txt) {
        if (!audioCv) return;
        var ctx = audioCv.getContext('2d');
        var w = audioCv.clientWidth || 320, h = audioCv.clientHeight || 180;
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#999999'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(txt, w / 2, h / 2);
    }

    function drawVizCached(name) {
        var c = vizCache[name];
        if (!c) return false;
        try {
            if (!c.scene) c.scene = window.AudioViz.prepare(c.mono, c.sr, {});
            window.AudioViz.render(audioCv, c.scene, curTime(), {});
            return true;
        } catch (e) { dlog('viz redraw ERR ' + (e && e.message || e)); return false; }
    }

    /* v46c：播放头单独重绘（静态层已缓存，这里只描一条线，帧率足够） */
    function drawVizHead() {
        var f = S.files[S.cur];
        if (!f) return;
        var c = vizCache[f.name];
        if (!c || !c.scene) return;
        try { window.AudioViz.render(audioCv, c.scene, curTime(), {}); } catch (e) { }
    }

    function drawAudioViz(f) {
        if (!f || !audioCv || !window.AudioViz) return;
        if (S.serverPort <= 0) return;
        applyStageMode();
        if (drawVizCached(f.name)) { dlog('viz cache hit ' + f.name); return; }
        if (vizBusy === f.name) return;
        vizBusy = f.name;
        vizPlaceholder('正在分析音频…');
        var url = 'http://127.0.0.1:' + S.serverPort + '/' + encodeURIComponent(f.name);
        var mine = f.name;
        fetch(url).then(function (r) { return r.arrayBuffer(); })
            .then(function (buf) { return window.AudioViz.decodeMono(buf); })
            .then(function (res) {
                if (vizBusy === mine) vizBusy = null;
                if (!res.mono.length) throw new Error('解码为空');
                var prep = window.AudioViz.prepare(res.mono, res.sr, {});
                vizCache[mine] = { mono: res.mono, sr: res.sr, dur: res.dur, segs: prep.segs, scene: prep };
                vizKeys.push(mine);
                while (vizKeys.length > 3) { var old = vizKeys.shift(); delete vizCache[old]; }
                // 当前若已切走，不画
                var cur = S.files[S.cur];
                if (!cur || cur.name !== mine) return;
                window.AudioViz.render(audioCv, prep, curTime(), {});
                var out = { segs: prep.segs };
                var curF = S.files[S.cur];
                if (curF && curF.name === mine) apLoad(mine);   // 装载到播放引擎
                renderPos();   // v46：解码后才知道时长，刷新进度条/时间
                renderTicks();
                dlog('viz ok ' + mine + ' dur=' + res.dur.toFixed(2) + 's segs=' + out.segs.length +
                    ' sr=' + res.sr);
            })
            .catch(function (e) {
                if (vizBusy === mine) vizBusy = null;
                dlog('viz ERR ' + mine + ' ' + (e && e.message || e));
                vizPlaceholder('音频分析失败：' + (e && e.message || e));
            });
    }

    /* ===== v46：音频播放引擎（WebAudio） =====
     * 为什么不用 <video>：实测部分 WebView/解码栈对 WAV 直接报 MEDIA_ERR_SRC_NOT_SUPPORTED，
     * 而音频工作台必须保证「能听 + 能精确定位」。音频模式统一走 decodeAudioData 后的
     * AudioBufferSourceNode，时间完全由我们掌控，同时天然支持任意采样率。 */
    var AP = { ctx: null, src: null, buf: null, playing: false, startedAt: 0, offset: 0, dur: 0, name: null };

    function apCtx() {
        if (!AP.ctx) {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            AP.ctx = new AC();
        }
        if (AP.ctx.state === 'suspended') { try { AP.ctx.resume(); } catch (e) { } }
        return AP.ctx;
    }

    function apStop() {
        if (AP.src) {
            try { AP.src.onended = null; AP.src.stop(); } catch (e) { }
            try { AP.src.disconnect(); } catch (e) { }
            AP.src = null;
        }
        AP.playing = false;
    }

    function apLoad(name) {
        var c = vizCache[name];
        if (!c || AP.name === name) return !!c;
        apStop();
        var ctx = apCtx();
        if (!ctx) return false;
        try {
            var buf = ctx.createBuffer(1, c.mono.length, c.sr);
            buf.copyToChannel(c.mono, 0);
            AP.buf = buf;
            AP.name = name;
            AP.dur = buf.duration;
            AP.offset = 0;
            return true;
        } catch (e) { dlog('apLoad ERR ' + (e && e.message || e)); return false; }
    }

    function apTime() {
        if (S.meta.mode !== 'audio') return videoEl.currentTime || 0;
        if (AP.playing && AP.ctx) {
            var tt = AP.offset + (AP.ctx.currentTime - AP.startedAt);
            return Math.min(tt, AP.dur || tt);
        }
        return AP.offset;
    }

    function apPlay() {
        if (!AP.buf) return false;
        if (AP.playing) return true;
        var ctx = apCtx();
        if (!ctx) return false;
        if (AP.offset >= (AP.dur || 0) - 1e-3) AP.offset = 0;
        var src = ctx.createBufferSource();
        src.buffer = AP.buf;
        src.connect(ctx.destination);
        src.onended = function () {
            if (AP.src === src) { AP.offset = 0; AP.playing = false; AP.src = null; renderPos(); updatePlayBtn(); }
        };
        try { src.start(0, AP.offset); } catch (e) { return false; }
        AP.src = src;
        AP.startedAt = ctx.currentTime;
        AP.playing = true;
        startApTicker();
        return true;
    }

    function apPause() {
        if (!AP.playing) return;
        AP.offset = apTime();
        apStop();
        updatePlayBtn();
    }

    function apSeek(t) {
        t = Math.max(0, Math.min(t, AP.dur || 0));
        var was = AP.playing;
        if (was) { apStop(); AP.offset = t; apPlay(); }
        else AP.offset = t;
        renderPos();
    }

    var apTicker = null;
    function startApTicker() {
        if (apTicker) return;
        apTicker = setInterval(function () {
            if (S.meta.mode !== 'audio') { clearInterval(apTicker); apTicker = null; return; }
            if (!AP.playing) { clearInterval(apTicker); apTicker = null; return; }
            renderPos();
            drawVizHead();
        }, 100);
    }

    /* 统一的时间读写（音频走 AP，视频走 <video>） */
    function curTime() {
        return S.meta && S.meta.mode === 'audio' ? apTime() : (videoEl.currentTime || 0);
    }
    function setTime(t) {
        if (S.meta && S.meta.mode === 'audio') { apSeek(t); drawVizHead(); return; }
        videoEl.currentTime = t;
    }

    /* v46：时长来源。视频走 <video>；音频用解码结果兜底
     * （Android WebView / 部分解码栈拿不到音频容器时长，而我们已经解码过整段音频） */
    function curDur() {
        if (S.meta && S.meta.mode === 'audio') {
            if (AP.dur > 0) return AP.dur;
            var f0 = S.files[S.cur];
            var c0 = f0 && vizCache[f0.name];
            if (c0 && c0.dur > 0) return c0.dur;
            return 0;
        }
        return videoEl.duration;
    }

    function playCurrent(keepPaused) {
        var f = S.files[S.cur];
        if (!f) return;
        emptyHint.style.display = 'none';
        var isA = S.meta.mode === 'audio';
        if (isA) {
            // 音频：停掉上一段，重置引擎；<video> 完全不参与
            apStop();
            AP.buf = null; AP.name = null; AP.offset = 0; AP.dur = 0;
            try { videoEl.pause(); videoEl.removeAttribute('src'); videoEl.load(); } catch (e) { }
            setTime(0);
        } else {
            videoEl.src = 'http://127.0.0.1:' + S.serverPort + '/' + encodeURIComponent(f.name);
            videoEl.load();
        }
        renderList();
        renderPos();
        applyStageMode();
        if (isA) {
            drawAudioViz(f);
            if (vizCache[f.name]) {           // 已分析过：立即装载，按钮马上可用
                apLoad(f.name);
                renderPos();
                renderTicks();
            }
        }
        if (!keepPaused) togglePlay();
        if (!isA) requestNativeMeta();
    }

    /* ---------- 位置显示 + 按钮状态 ---------- */

    function renderPos() {
        var t = curTime();
        var d = curDur();
        if (isFinite(d) && d > 0) {
            tlRange.value = String(Math.round((t / d) * 1000));
        }
        if (S.meta.mode === 'video') {
            if (!fpsEditing) {
                posEl.innerHTML = '';
                posEl.appendChild(mkPosMain(t, d));
                posEl.appendChild(mkFpsChip());
                posEl.appendChild(mkThumbToggle());
            }
            renderTicks();
            renderBtnStates();
            return;
        } else {
            posEl.textContent = fmt2(t) + 's / ' + (isFinite(d) ? fmt2(d) : '0.00') + 's';
        }
        renderTicks();
        renderBtnStates();
    }

    function renderBtnStates() {
        var t = curTime();
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

        if (S.meta.mode === 'audio') {
            var qA = L.quantize(t, 'audio', 0, S.meta.stepAudio || 0.05);
            var mfA = null;
            S.marks.marks.forEach(function (m) { if (m.type === 'multiframe_ref' && m.seg === seg) mfA = m; });
            var hitA = !!(mfA && mfA.secs && secIdx(mfA.secs, qA) >= 0);
            btnMulti.textContent = hitA ? '✕ 移除此刻' : '▦ 多帧点';
            btnMulti.classList.toggle('av-danger', hitA);
            return;
        }
        var fr = L.frameAt(t, f);
        var mf = null;
        S.marks.marks.forEach(function (m) {
            if (m.type === 'multiframe_ref' && m.seg === seg) mf = m;
        });
        var hitMulti = mf && mf.frames && mf.frames.indexOf(fr) >= 0;
        btnMulti.textContent = hitMulti ? '✕ 移除此帧' : '▦ 多帧点';
        btnMulti.classList.toggle('av-danger', hitMulti);
    }

    function renderTicks() {
        var d = curDur();
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
            // v46：音频参考点是秒，直接映射
            if (m.type === 'multiframe_ref' && Array.isArray(m.secs)) {
                m.secs.forEach(function (s2) {
                    if (s2 <= d) {
                        var k3 = el('i', 'av-tick av-tick-multi');
                        k3.style.left = (s2 / d * 100) + '%';
                        ticksEl.appendChild(k3);
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
        var isAudio = S.meta.mode === 'audio';
        var stepA = S.meta.stepAudio || 0.05;
        var t = curTime();
        var half = isAudio ? stepA / 2 : 0.5 / effFps();
        var hit = null;
        S.marks.marks.forEach(function (m) {
            if (m.type === 'split' && m.seg === seg && Math.abs(m.at - t) <= half + 1e-9) hit = m;
        });
        if (hit) {
            S.marks.marks.splice(S.marks.marks.indexOf(hit), 1);
            toast('已移除分割点 @' + fmt2(hit.at) + 's');
        } else if (isAudio) {
            // v46：音频按秒量化（无帧概念，fps 为空）
            var qtA = L.quantize(t, 'audio', 0, stepA);
            var rmA = 0;
            S.marks.marks.forEach(function (m) {
                if (m.type === 'multiframe_ref' && m.seg === seg && m.secs) {
                    var k = secIdx(m.secs, qtA);
                    if (k >= 0) {
                        m.secs.splice(k, 1);
                        rmA++;
                        if (!m.secs.length) S.marks.marks.splice(S.marks.marks.indexOf(m), 1);
                    }
                }
            });
            S.marks.marks.push({ id: 'm' + Date.now(), type: 'split', seg: seg, at: qtA, note: '' });
            toast('✂ 分割点 @' + fmt2(qtA) + 's' + (rmA ? '（该时刻的多帧参考已移除）' : ''));
        } else {
            var qt = L.quantize(t, 'video', effFps(), 0);
            var qfr = L.frameAt(qt, effFps());
            // v45m：分割点与多帧点同帧互斥——该帧已被多帧参考占用时改为移除
            var removed = 0;
            S.marks.marks.forEach(function (m) {
                if (m.type === 'multiframe_ref' && m.seg === seg && m.frames && m.frames.indexOf(qfr) >= 0) {
                    m.frames.splice(m.frames.indexOf(qfr), 1);
                    removed++;
                    if (!m.frames.length) S.marks.marks.splice(S.marks.marks.indexOf(m), 1);
                }
            });
            S.marks.marks.push({ id: 'm' + Date.now(), type: 'split', seg: seg, at: qt, note: '' });
            toast(removed
                ? ('✂ 分割点 @' + fmt2(qt) + 's（帧 ' + (qfr + 1) + '，该帧的多帧参考已移除）')
                : ('✂ 分割点 @' + fmt2(qt) + 's（帧 ' + (qfr + 1) + '）'));
        }
        saveAll(false);
        renderPos();
    }

    /* v46：秒数组的容差查找（浮点量化值不能用 indexOf） */
    function secIdx(arr, v) {
        for (var i = 0; i < arr.length; i++) if (Math.abs(arr[i] - v) < 1e-6) return i;
        return -1;
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
        var isAudio = S.meta.mode === 'audio';
        var stepA = S.meta.stepAudio || 0.05;
        var f = effFps();
        var tA = curTime();
        var fr = L.frameAt(tA, f);
        var mark = null;
        if (isAudio) {
            /* v46：音频多帧点 = 时刻点（按 stepAudio 量化），存 secs，不存帧号 */
            S.marks.marks.forEach(function (m) {
                if (m.type === 'multiframe_ref' && m.seg === seg) mark = m;
            });
            var qA = L.quantize(tA, 'audio', 0, stepA);
            var ateSplitA = null;
            S.marks.marks.forEach(function (m) {
                if (m.type === 'split' && m.seg === seg && Math.abs(m.at - qA) < 1e-6) ateSplitA = m;
            });
            if (ateSplitA) {
                S.marks.marks.splice(S.marks.marks.indexOf(ateSplitA), 1);
                toast('该时刻已是分割点，已移除分割点（' + fmt2(qA) + 's）');
                saveAll(false);
                renderPos();
                return;
            }
            if (!mark) {
                mark = { id: 'm' + Date.now(), type: 'multiframe_ref', seg: seg, secs: [], note: '' };
                S.marks.marks.push(mark);
            }
            if (!mark.secs) mark.secs = [];
            var kA = secIdx(mark.secs, qA);
            if (kA >= 0) {
                mark.secs.splice(kA, 1);
                toast('▦ 已移除参考点 ' + fmt2(qA) + 's（剩 ' + mark.secs.length + '）');
                if (!mark.secs.length) S.marks.marks.splice(S.marks.marks.indexOf(mark), 1);
            } else {
                mark.secs.push(qA);
                mark.secs.sort(function (a, b) { return a - b; });
                toast('▦ 参考点 ' + fmt2(qA) + 's（共 ' + mark.secs.length + ' 个）');
            }
            saveAll(false);
            renderPos();
            return;
        }
        S.marks.marks.forEach(function (m) {
            if (m.type === 'multiframe_ref' && m.seg === seg) mark = m;
        });
        if (!mark) {
            mark = { id: 'm' + Date.now(), type: 'multiframe_ref', seg: seg, frames: [], note: '' };
            S.marks.marks.push(mark);
        }
        // v45m：多帧点与分割点同帧互斥——该帧已有分割点时先移除分割点
        var ateSplit = null;
        S.marks.marks.forEach(function (m) {
            if (m.type === 'split' && m.seg === seg && L.frameAt(m.at, f) === fr) ateSplit = m;
        });
        if (ateSplit) {
            S.marks.marks.splice(S.marks.marks.indexOf(ateSplit), 1);
            toast('该帧已是分割点，已移除分割点（帧 ' + (fr + 1) + '）');
            saveAll(false);
            renderPos();
            return;
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
        var t = curTime() + dir * st;
        if (t < 0) t = 0;
        var D2 = curDur();
        if (isFinite(D2) && t > D2) t = D2;
        if (S.meta.mode === 'video') t = L.quantize(t, 'video', effFps(), 0);
        setTime(t);
        renderPos();
    }

    function renderStepBox() {
        if (S.meta.mode === 'video') stepVal.value = (S.meta.stepVideo || 1) + '帧';
        else stepVal.value = (S.meta.stepAudio || 0.05) + 's';
        renderPos();
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
        thumbFlush();   // v45s：退出即清缩略图队列，残留任务不再空转刷日志
        videoThumbQueue.length = 0;   // v45w：退出同步清视频捕获队列
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
            dlog('build v46');   // 每次打开打版本号：日志与包版本永远对得上
            dlog('open(' + projectName + ') meta=' + (L.loadMeta(projectName) ? 'ok' : 'new') +
                ' folderUri=' + !!(L.loadMeta(projectName) && L.loadMeta(projectName).folderUri));
            build();
            S.project = projectName;
            S.meta = L.loadMeta(projectName) || L.emptyMeta(projectName, 'video');
            S.marks = L.loadMarks(projectName);
            S.files = [];
            S.cur = -1;
            S.fps = S.meta.fps || null;
            // v45p：一次性恢复缩略图（v45m/o 期间被误关+持久化；恢复这一次后，再手动关闭会被尊重）
            if (S.meta.thumbs === false && S.meta.thumbsRev !== 'p1') {
                S.meta.thumbs = true;
                S.meta.thumbsRev = 'p1';
                saveAll(false);
            }
            setSide(true);
            applyStageMode();   // v46：音频工程显示时频图、隐藏视频层
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
            embedAvCss();   // v45i：av.css 缓存自愈
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
        _thumbState: function () { return { jobs: thumbJobs.length, live: thumbLive, cached: Object.keys(thumbCache).length, ok: thumbOkCount, fail: thumbFailCount, failed: Object.keys(thumbFailCache).length, mkCalls: mkThumbCalls, vq: videoThumbQueue.length, vbusy: videoThumbBusy, nativeOff: nativeThumbDisabled, nativeFails: consecutiveNativeFails }; },
        _refreshFolder: refreshFolder,
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
        _setVideoTime: function (t) { setTime(t); renderPos(); renderBtnStates(); },
        _markSplit: markSplit,
        _toggleMerge: toggleMerge,
        _toggleMulti: toggleMulti,
        _stepTime: stepTime,
        _togglePlay: togglePlay,
        _exportJson: function () { return L.buildExport(S.meta, S.marks, S.files); },
        _setFps: function (f) { S.meta.fps = f; S.meta.fpsSource = 'manual'; S.fps = f; renderStepBox(); renderPos(); }
    };
})();
