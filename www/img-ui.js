/* v49 / v49b img-ui.js — 图片工作台（第四工程模式）
 *
 * 交互与渲染逻辑来自 prototype/image-mode-proto.html（老板 2026-11-06 12:46 确认），
 * 本文件做工程化接线：
 *   - 图片字节走 projects.js 内容寻址（files/<sha1>.<ext>），不重复存
 *   - 笔画走 img-store（localStorage），每笔一存
 *   - 导出走 SaveImagePlugin（与 3D 机位分享同链路）
 *   - 双层 canvas：底层图片只在视图变化时重绘；蒙版层只在笔画变化时重绘
 *     （4000×3000 图每 pointermove 重绘全图必卡，这是结构性的解法）
 *
 * 渲染核心 drawMaskInto 与原型一致：屏幕预览与导出共用一套顺序语义，
 * brush/polygon = source-over（盖上去），erase = destination-out（抹掉）。
 * 「先画后擦」能补回、「先擦后画」仍被挖——与用户所见一致。
 *
 * ---- v49b 真机反馈三处修订 ----
 * 1) 顶栏避让系统栏：applySafeArea() 读 MediaServer.getSafeArea（物理 px ÷ dpr，
 *    超 SAFE_MAX 判脏值归零，延迟重读 + resize 自愈）。只垫顶栏不垫舞台。
 *    .img-top 必须 box-sizing:border-box，否则 height 与 padding-top 相加。
 * 2) 多边形 = 套索：pointerdown 起笔画 → pointermove 采点（步长比涂抹细）
 *    → pointerup 闭合入栈。拖动中不入撤销栈。
 * 3) 预览透明度放层上（.img-mask opacity:.82），笔画一律 alpha=1。
 *    半透明进笔画会随重叠累积（1-(1-a)^N），曾被误认成「厚度控制」。
 */
(function () {
    'use strict';

    var L = window.__imgLogic;
    var PJ = window.__projectLogic;
    var OPS = window.__imgOps;
    var undoBarEl = null;   // v50c：左侧撤销条（模块级，拖拽吸附用）
    var backBtnEl = null;       // v53：返回键引用（tagMode 下隐藏）
    var saveBtnEl = null;       // v53：tagMode 下隐藏
    var shareBtnEl = null;      // v53：tagMode 下隐藏
    var btnTagConfirm = null;   // v53：打标模式顶部确认
    var btnTagCancel = null;    // v53：打标模式顶部取消
    var tagBarEl = null;        // v53：底部打标工具组
    var tagSelEl = null;        // v53：角色下拉
    var dlog = function () {
        try { console.log.apply(console, ['[img]'].concat([].slice.call(arguments))); } catch (e) { }
        try {
            var cap = window.Capacitor;
            var p = cap && cap.Plugins && cap.Plugins.DebugLog;
            if (p && p.append) {
                var r = p.append({ text: '[img] ' + [].slice.call(arguments).join(' ') });
                if (r && r.catch) r.catch(function () { });
            }
        } catch (e2) { }
    };

    if (!L) { console.error('[img] img-store.js 未加载'); return; }
    if (!OPS) { console.error('[img] img-ops.js 未加载'); return; }

    /* ---------- 样式（内嵌注入，v45i 同款自愈模式） ---------- */

    var IMG_CSS = [
"/* 摸鱼台 v49 —— 图片工作台样式（自原型 image-mode-proto.html 移植） */",
".img-page{position:fixed;top:0;right:0;bottom:0;left:0;display:none;flex-direction:column;background:#1a1d21;z-index:1550}",
".img-page.open{display:flex}",
/* 顶栏：系统栏/挖孔避让由 applySafeArea() 动态注入 padding（Android 15 edge-to-edge
 * 下 env(safe-area-inset) 不可靠，必须走 MediaServer.getSafeArea，同 av-ui 方案） */
/* box-sizing:border-box 必写：applySafeArea() 会设 height=52+inset 并同时加
 * padding-top，content-box 下两者相加会把顶栏撑到 100px（实测），吸掉六分之一屏。 */
".img-top{position:relative;height:52px;box-sizing:border-box;display:flex;align-items:center;gap:6px;flex-shrink:0;",
"  padding:0 8px 0 6px;background:linear-gradient(180deg,rgba(0,0,0,.82),rgba(0,0,0,.35));z-index:60}",
".img-top-btn{height:34px;padding:0 10px;border-radius:8px;border:1px solid rgba(255,255,255,.1);",
"  background:rgba(58,63,70,.9);color:#eee;font-size:12.5px;display:flex;align-items:center;gap:4px;",
"  cursor:pointer;flex-shrink:0;white-space:nowrap}",
".img-top-btn:active{filter:brightness(1.4)}",
".img-top-btn.primary{background:#2563eb;border-color:#3b82f6;color:#fff}",
".img-title{flex:1;text-align:center;font-size:13px;color:#ddd;overflow:hidden;",
"  text-overflow:ellipsis;white-space:nowrap}",
"/* 舞台：棋盘格衬底表示透明区 */",
".img-stage{position:relative;flex:1;overflow:hidden;touch-action:none;",
"  background:repeating-conic-gradient(#26292e 0% 25%,#202327 0% 50%) 50%/24px 24px}",
".img-wrap{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}",
".img-base{display:block;max-width:none}",
/* 蒙版层整体压透明度：笔画以 alpha=1 不透明绘制（重叠不再累积加深），
 * 再由这一层的 opacity 统一降下来。之前是每笔用 rgba(.82) 叠加，
 * 同一处来回涂会越叠越深（1 次 82% → 2 次 96.8% → 3 次 99.4%），
 * 看起来像「有厚度控制」，其实是渲染缺陷。 */
".img-mask{position:absolute;left:0;top:0;pointer-events:none;opacity:.82}",
"/* 右侧工具组：复刻 dock 分组样式（.sd-grp-btn 同源） */",
".img-dock{position:fixed;right:10px;top:50%;transform:translateY(-50%);",
"  display:flex;flex-direction:column;gap:.45rem;z-index:70;",
"  max-height:calc(100vh - 140px);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none}",
".img-dock::-webkit-scrollbar{display:none}",
"/* v50/M4 四边停靠（拖拽吸附目标，setupDockDrag 写类名） */",
".img-dock.img-dock-left{right:auto;left:10px}",
".img-dock.img-dock-top{top:76px;right:12px;bottom:auto;transform:none;flex-direction:row;max-width:calc(100vw - 180px);max-height:none;overflow-x:auto;overflow-y:hidden}",
".img-dock.img-dock-bottom{top:auto;bottom:12px;transform:none;flex-direction:row;max-width:calc(100vw - 24px);max-height:none;overflow-x:auto;overflow-y:hidden}",
".img-grp{width:2.5rem;height:2.5rem;border-radius:12px;border:1px solid rgba(255,255,255,.1);",
"  background:#3a3f46;color:#ccc;display:flex;flex-direction:column;align-items:center;",
"  justify-content:center;font-size:10px;gap:2px;cursor:pointer;position:relative;flex-shrink:0}",
".img-grp .ico{font-size:15px;line-height:1}",
".img-grp.on{background:#2563eb;color:#fff;border-color:#3b82f6}",
".img-grp:active{filter:brightness(1.5)}",
"/* 子面板：2x2 网格 152x134，竖排会撑到 265px 挡住画面右半边（原型实测） */",
".img-sub{position:fixed;z-index:999;display:flex;flex-direction:column;gap:7px;padding:9px;box-sizing:border-box;",
"  width:152px;background:rgba(26,29,34,.94);border-radius:12px;border:1px solid rgba(255,255,255,.08);",
"  box-shadow:0 6px 22px rgba(0,0,0,.62);opacity:0;pointer-events:none;transition:opacity .18s ease}",
".img-sub.open{opacity:1;pointer-events:auto}",
".img-grid2{display:grid;grid-template-columns:1fr 1fr;gap:6px}",
".img-sub-btn{width:100%;height:2.25rem;border-radius:8px;border:1px solid rgba(255,255,255,.1);",
"  background:#454b53;color:#ddd;display:flex;align-items:center;justify-content:center;",
"  font-size:15px;cursor:pointer}",
".img-sub-btn.on{background:#2563eb;border-color:#3b82f6;color:#fff}",
".img-sub-btn:active{filter:brightness(1.4)}",
".img-sub-label{font-size:10px;color:#9aa6b4;line-height:1.2;white-space:nowrap}",
".img-size-row{display:flex;align-items:center;gap:7px}",
".img-size-row .img-sub-label{flex:0 0 auto}",
".img-size-val{font-size:11px;color:#9fd0ff;min-width:1.9em;text-align:right;font-variant-numeric:tabular-nums}",
".img-sub input[type=range]{-webkit-appearance:none;flex:1 1 auto;min-width:48px;width:100%;",
"  height:4px;border-radius:2px;background:#2a2e34;outline:none}",
".img-sub input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:15px;height:15px;",
"  border-radius:50%;background:#4d9eff;border:2px solid #1a1d21;cursor:pointer}",
".img-size-wrap{display:flex;flex-direction:column;gap:5px;padding:6px 0 4px;",
"  border-top:1px solid rgba(255,255,255,.08);margin-top:2px}",
"/* 空态 */",
".img-empty{position:absolute;top:0;right:0;bottom:0;left:0;display:flex;flex-direction:column;align-items:center;",
"  justify-content:center;gap:14px;z-index:5}",
".img-empty-t{font-size:16px;color:#e8e8e8}",
".img-empty-s{font-size:12px;color:#8b96a5;text-align:center;line-height:1.7;padding:0 30px}",
".img-empty-btn{height:42px;padding:0 22px;border-radius:10px;border:1px solid #3b82f6;",
"  background:#2563eb;color:#fff;font-size:14px;cursor:pointer}",
"/* 提示条 */",
".img-hint{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);",
"  padding:8px 14px;border-radius:20px;background:rgba(0,0,0,.8);font-size:12px;color:#ddd;",
"  z-index:80;opacity:0;transition:opacity .25s;pointer-events:none;white-space:nowrap;",
"  max-width:92vw;overflow:hidden;text-overflow:ellipsis}",
".img-hint.show{opacity:1}",
".img-hint.err{background:rgba(140,30,30,.92)}",
/* ---- v50 图层面板 ---- */
".img-layers{display:none;position:absolute;right:10px;bottom:76px;width:210px;max-height:52vh;overflow:auto;background:rgba(24,26,32,.96);border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:8px;z-index:60;box-shadow:0 6px 24px rgba(0,0,0,.5)}",
".img-layers.open{display:block}",
".img-layers-top{display:flex;gap:6px;margin-bottom:8px}",
".img-layers-top .img-sub-btn{flex:1}",
".img-layers-list{display:flex;flex-direction:column;gap:4px}",
".img-layer-row{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:8px;background:rgba(255,255,255,.06);cursor:pointer}",
".img-layer-row.active{background:rgba(255,140,60,.22);outline:1px solid rgba(255,160,80,.55);box-shadow:inset 3px 0 0 #ff9d4d}",
".img-layer-eye{font-size:15px;line-height:1;opacity:.55;flex:none;cursor:pointer}",
".img-layer-eye.on{opacity:1}",
".img-layer-name{font-size:13px;color:#eee;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  "/* v50/M4 左侧历史条：撤销/重做独立分组，老板指定 */",
  ".img-undo-bar{position:fixed;left:10px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:.45rem;z-index:70}",
  ".img-undo-bar .img-grp.off{opacity:.4}",
  "/* v50c：拖拽把手（对齐 3D 场景 .sd-handle 手感） */",
  /* v60b：左上角确认/取消条 + 底部中间工具条 + 当前层名 + 角色卡弹层 */
        ".img-tag-okbar{position:fixed;z-index:1601;transform:none;display:flex;flex-direction:row;gap:8px;background:rgba(18,20,28,.92);border:1px solid #2c3040;border-radius:14px;padding:6px;backdrop-filter:blur(6px);top:calc(env(safe-area-inset-top, 0px) + 10px);left:calc(env(safe-area-inset-left, 0px) + 10px);}",
        ".img-tagbar-bottom{position:fixed;left:50%;right:auto;top:auto;bottom:calc(env(safe-area-inset-bottom, 0px) + 10px);transform:translateX(-50%);flex-direction:row;max-height:none;max-width:calc(100vw - 24px);overflow-x:auto;overflow-y:hidden}",
        ".img-tag-curlayer{max-width:32vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#cfd3e0;padding:0 6px;}",
        ".img-cardpicker .cgm-card{max-height:72vh;}",
        ".img-cardpicker-search{width:100%;box-sizing:border-box;margin:8px 12px 4px;padding:8px 10px;border-radius:10px;border:1px solid #2c3040;background:#14161e;color:#e8eaf2;font-size:14px;}",
        ".img-cardpicker-list{max-height:52vh;overflow:auto;padding:6px 10px 14px;}",
        ".img-cardpicker-row{display:flex;align-items:center;gap:10px;padding:9px 8px;border-radius:12px;cursor:pointer;}",
        ".img-cardpicker-row:active{background:#1b1e2a;}",
        ".img-cardpicker-ava{width:38px;height:38px;border-radius:50%;overflow:hidden;background:#22263a;display:flex;align-items:center;justify-content:center;color:#8f95a8;font-size:15px;flex-shrink:0;}",
        ".img-cardpicker-ava img{width:100%;height:100%;object-fit:cover;}",
        ".img-cardpicker-name{font-size:14px;color:#e8eaf2;}",
                ".img-handle{min-width:18px;min-height:18px;display:flex;align-items:center;justify-content:center;color:#777;font-size:14px;cursor:grab;touch-action:none;flex-shrink:0;letter-spacing:2px;border-radius:10px;}",
  ".img-handle:active{cursor:grabbing;color:#4a9eff}",
  ".img-dock.img-dock-top .img-handle,.img-dock.img-dock-bottom .img-handle{writing-mode:vertical-lr}",
  ".img-undo-bar.img-undo-left{left:10px;right:auto;max-height:calc(100vh - 160px);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none}",
  ".img-undo-bar.img-undo-top{top:76px;bottom:auto;transform:none;flex-direction:row;max-width:calc(100vw - 220px);max-height:none;overflow-x:auto;overflow-y:hidden}",
  ".img-undo-bar.img-undo-bottom{top:auto;bottom:12px;transform:none;flex-direction:row;max-width:calc(100vw - 200px);max-height:none;overflow-x:auto;overflow-y:hidden}",
  ".img-undo-bar.img-undo-right{left:auto;right:10px}",
  ".img-undo-bar::-webkit-scrollbar{display:none}",
  /* ===== v53e 打标底条（复用 .img-dock 垂直 grp 条 + 拖拽吸附） ===== */
  ".img-tagbar{display:none;z-index:55}",
  ".img-tagbar.img-dock-bottom{left:50%;right:auto;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom, 0px) + 10px);top:auto;max-height:none;flex-direction:row;max-width:calc(100vw - 24px);overflow-x:auto;overflow-y:hidden}",
  /* v53r：吸顶=横排（与 dock 原生一致），贴顶避让状态栏，横滑防溢出 */
  ".img-tagbar.img-tagbar-top,.img-tagbar.img-dock-top{top:calc(env(safe-area-inset-top, 0px) + 8px);right:12px;bottom:auto;left:auto;transform:none;max-height:none;flex-direction:row;width:auto;max-width:calc(100vw - 160px);align-items:center;overflow-x:auto;overflow-y:hidden}",
  ".img-tagbar .img-grp{padding:4px 5px;align-items:center;min-width:0}",
  ".img-tagbar .img-grp span:not(.ico){font-size:11px}",
  ".img-tagbar .img-grp .ico{font-size:15px;line-height:1}",
  ".img-tagbar.img-dock-left,.img-tagbar.img-dock-right{min-width:56px;max-width:72px;gap:6px}",
  ".img-tagbar .img-grp-tag select{max-width:64px;font-size:11px;padding:3px 3px}",
  ".img-tagbar .img-tag-confirm,.img-tagbar .img-tag-cancel{opacity:0.92}",
  ".img-tagbar.open{display:flex}",
  ".img-grp-tag{padding:4px 6px}",
  ".img-tagbar-select{background:rgba(255,255,255,0.07);border:1px solid #3a3a3d;border-radius:8px;color:#e6eef9;font-size:12px;padding:4px 6px;max-width:150px;box-sizing:border-box}",
  ".img-tag-in{background:rgba(255,255,255,0.07);border:1px solid #3a3a3d;border-radius:8px;color:#e6eef9;font-size:12px;padding:6px 8px;width:100%;box-sizing:border-box}",
  ".img-tag-desc-panel{position:fixed;z-index:80;width:min(78vw,300px);background:rgba(24,26,32,0.97);border:1px solid #3a3a3d;border-radius:12px;padding:10px 12px;color:#e6eef9;display:flex;flex-direction:column;gap:6px}",
  ".img-tag-desc-title{font-size:11px;color:#8fa3bd}",
  ".img-layers-top .img-sub-btn-off{opacity:0.35;pointer-events:none}",
  ".img-layer-eye.img-layer-eye-off{opacity:0.35}",
  ".img-tag-confirm{background:rgba(70,160,90,0.55)!important}",
  ".img-tag-cancel{background:rgba(170,70,70,0.5)!important}"
    ].join("\n");

    function embedCss() {
        var st = document.getElementById('imgCssEmbed');
        if (!st) {
            st = document.createElement('style');
            st.id = 'imgCssEmbed';
            document.head.appendChild(st);
        }
        if (st.textContent !== IMG_CSS) st.textContent = IMG_CSS;
    }

    /* ---------- 状态 ---------- */

    var S = {
        project: null,
        meta: null,
        state: null,          // v2 分层状态 {schema, layers[], activeId}，img-ops 纯函数操作它
        redo: [],             // op 栈（每项是已应用的 op，undo 时取逆）
        invert: false,
        img: null,
        imgW: 0, imgH: 0,
        scale: 1, tx: 0, ty: 0,
        tool: 'pan',
        size: 24,
        live: null,
        drawing: false,
        panStart: null,
        built: false,
        dirty: false,
        dockPos: 'right',       // v50/M4：工具 dock 停靠边
        undoPos: 'left'         // v50c：撤销条停靠边
    };

    var page, stage, wrap, baseCv, maskCv, bctx, mctx;
    var topEl, titleEl, dockEl, drawGrp, eraseGrp, panGrp, undoGrp, redoGrp;
    var drawPanel, erasePanel, btnBrush, btnPoly, btnClear, btnInvert;
    var sizeRange, sizeVal, sizeRange2, sizeVal2, emptyEl, hintEl;
    var reloadBtnEl;                             // v50：顶栏「换图」
    var layersGrp, layersPanel, layersListEl;   // v50：图层分组/面板/列表

    /* 当前激活层（确保存在，异常时回落首层） */
    function curLayer() {
        return OPS.activeLayer(S.state);
    }

    /* ---------- 小工具 ---------- */

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    function hint(t, isErr) {
        if (!hintEl) return;
        hintEl.textContent = t;
        hintEl.classList.toggle('err', !!isErr);
        hintEl.classList.add('show');
        clearTimeout(hintEl._t);
        hintEl._t = setTimeout(function () { hintEl.classList.remove('show'); }, 1600);
    }

    function toast(msg) {
        if (window.__projectsToast) window.__projectsToast(msg);
        else hint(msg);
    }

    function savePlug() {
        var cap = window.Capacitor;
        return (cap && cap.Plugins && cap.Plugins.SaveImage) || null;
    }

    /* 系统栏/挖孔避让（照搬 av-ui v45d 的教训）：
     *  a) 原生 getSafeArea 返回物理 px，必须 ÷ devicePixelRatio 换算 CSS px
     *     （v45c 直接当 CSS px 用 → 顶带放大 2~3 倍，真机整页被撑出大黑边）
     *  b) 旋转过渡期会读到旧方向脏值 → 超过 SAFE_MAX 一律归零
     *  c) 稳定后延迟重读 + resize/orientationchange 自愈
     *  d) 直接内联 padding，不依赖样式表消费变量（WebView 旧缓存会污染样式） */
    var SAFE_MAX = 48;

    function msPlugin() {
        var cap = window.Capacitor;
        return (cap && cap.Plugins && cap.Plugins.MediaServer) || null;
    }

    function applySafeArea() {
        if (!page) return;
        var read = function () {
            /* 存在性检查必须放在 read 内部、每次重读都做：延迟重读（400/1000/2000ms）
             * 与 resize 回调都是在插件可能已不可用之后才跑的。若只在 applySafeArea
             * 入口查一次，插件卸载后定时器仍会空手敲门 → TypeError 冒到全局
             * （真机上插件不会中途消失，但测试/热更新会，探针已抓到）。 */
            var p = msPlugin();
            if (!p || !p.getSafeArea) return;
            p.getSafeArea().then(function (r) {
                if (!r) return;
                var dpr = window.devicePixelRatio || 1;
                var cvt = function (v) {
                    v = (v || 0) / dpr;
                    if (v < 0 || v > SAFE_MAX) v = 0;
                    return Math.round(v);
                };
                var top = cvt(r.top), right = cvt(r.right),
                    left = cvt(r.left), bottom = cvt(r.bottom);
                page.style.setProperty('--img-safe-top', top + 'px');
                page.style.setProperty('--img-safe-right', right + 'px');
                page.style.setProperty('--img-safe-left', left + 'px');
                page.style.setProperty('--img-safe-bottom', bottom + 'px');
                // 顶部只垫给顶栏，舞台不吃（否则画面被压扁）
                topEl.style.paddingTop = top + 'px';
                topEl.style.height = (52 + top) + 'px';
                topEl.style.paddingLeft = (6 + left) + 'px';
                topEl.style.paddingRight = (8 + right) + 'px';
                page.style.paddingBottom = bottom + 'px';
                // 工具组避开右侧安全区
                if (dockEl) dockEl.style.right = (10 + right) + 'px';
            }).catch(function () { });
        };
        read();
        [400, 1000, 2000].forEach(function (t) { setTimeout(read, t); });
    }

    /* 屏幕坐标 -> 原图像素（wrap 带 transform，rect 已含缩放） */
    function toImage(clientX, clientY) {
        var r = wrap.getBoundingClientRect();
        return { x: (clientX - r.left) / S.scale, y: (clientY - r.top) / S.scale };
    }

    /* ---------- 视图 ---------- */

    function applyView() {
        wrap.style.transform = 'translate(' + S.tx + 'px,' + S.ty + 'px) scale(' + S.scale + ')';
    }

    function fitView() {
        if (!S.img) return;
        var vw = stage.clientWidth, vh = stage.clientHeight;
        if (!vw || !vh) return;
        var s = Math.min(vw / S.imgW, vh / S.imgH) * 0.88;
        S.scale = s;
        S.tx = (vw - S.imgW * s) / 2;
        S.ty = (vh - S.imgH * s) / 2;
        applyView();
    }

    /* ---------- 蒙版渲染（与原型一致的单一渲染器） ---------- */

    function drawMaskInto(g, opt) {
        var alpha = opt.alpha === undefined ? 1 : opt.alpha;
        var showAids = !!opt.showAids;
        var rgb = opt.rgb || '0,0,0';

        g.save();
        g.lineCap = 'round';
        g.lineJoin = 'round';

        /* v50 分层合成：每层先画在自己的离屏 canvas 上（erase 只擦本层），
         * 可见层依次 source-over 贴到目标。单层时代 erase 是「擦掉下层所有内容」，
         * 分层后语义变为「只擦本层」——要擦掉下层请关掉本层的显示或用反选。 */
        var live = S.live;
        S.live = null;   // live 属于激活层的未定格笔画，单独处理

        S.state.layers.forEach(function (lay) {
            if (!lay.visible) return;
            var oc = document.createElement('canvas');
            oc.width = g.canvas.width; oc.height = g.canvas.height;
            var og = oc.getContext('2d');
            og.lineCap = 'round'; og.lineJoin = 'round';
            og.fillStyle = 'rgba(' + rgb + ',' + alpha + ')';
            og.strokeStyle = 'rgba(' + rgb + ',' + alpha + ')';
            var all = lay.strokes.slice();
            if (live && lay.id === S.state.activeId) all.push(live);
            drawStrokes(og, all);
            g.drawImage(oc, 0, 0);
        });

        S.live = live;
        g.restore();

        /* 拖动中的辅助线（轮廓高亮）画在最上面，不参与层合成 */
        if (showAids && S.live && S.live.type === 'polygon' && S.live.points.length > 1) {
            g.save();
            g.globalCompositeOperation = 'source-over';
            g.beginPath();
            S.live.points.forEach(function (p, i) {
                i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]);
            });
            g.lineWidth = 1.5 / S.scale;
            g.setLineDash([7 / S.scale, 5 / S.scale]);
            g.strokeStyle = 'rgba(255,255,255,.9)';
            g.stroke();
            g.setLineDash([]);
            g.restore();
        }
    }

    /* 把一组笔画画到 ctx 上（不 save/restore，由调用方管） */
    function drawStrokes(g, strokes) {
        strokes.forEach(function (st) {
            var isErase = (st.type === 'erase');
            g.globalCompositeOperation = isErase ? 'destination-out' : 'source-over';
            if (st.type === 'polygon') {
                g.beginPath();
                st.points.forEach(function (p, i) { i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); });
                g.closePath();
                g.fill();
            } else {
                g.beginPath();
                st.points.forEach(function (p, i) { i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); });
                if (st.points.length === 1) {
                    g.arc(st.points[0][0], st.points[0][1], st.size / 2, 0, Math.PI * 2);
                    g.fill();
                } else {
                    g.lineWidth = st.size;
                    g.stroke();
                }
            }
        });
        g.globalCompositeOperation = 'source-over';
    }

    /* 反选是全局属性（不分层）：把「已画区域」整体取反 */
    function applyInvert(g, rgb, alpha) {
        var tmp = document.createElement('canvas');
        tmp.width = g.canvas.width; tmp.height = g.canvas.height;
        tmp.getContext('2d').drawImage(g.canvas, 0, 0);
        g.globalCompositeOperation = 'copy';
        g.fillStyle = 'rgba(' + rgb + ',' + alpha + ')';
        g.fillRect(0, 0, g.canvas.width, g.canvas.height);
        g.globalCompositeOperation = 'destination-out';
        g.drawImage(tmp, 0, 0);
        g.globalCompositeOperation = 'source-over';
    }

    function redrawMask() {
        mctx.clearRect(0, 0, maskCv.width, maskCv.height);
        /* v53z：渲染骨架日志（可见层数/笔画数/画布尺寸） */
        try {
            if (S.tagMode) {
                var vis = S.state.layers.filter(function (l) { return l.visible; });
                var nStrokes = vis.reduce(function (n, l) { return n + l.strokes.length; }, 0);
                dlog('tag: redraw layers=' + S.state.layers.length + ' visible=' + vis.length + ' strokes=' + nStrokes + ' canvas=' + maskCv.width + 'x' + maskCv.height + ' tool=' + S.tool);
            }
        } catch (e) { }
        /* alpha=1：同色不透明覆盖，笔画自我重叠不再累积加深。
         * 整体半透明由 .img-mask 的 CSS opacity 统一承担。 */
        drawMaskInto(mctx, { alpha: 1, rgb: '255,42,42', showAids: true });
        /* 反选跟在层合成之后（全局取反） */
        if (S.invert) applyInvert(mctx, '255,42,42', 1);
    }

    /* ---------- 图片载入 ---------- */

    function loadImageFromBytes(u8) {
        return new Promise(function (resolve, reject) {
            var blob = new Blob([u8]);
            var url = URL.createObjectURL(blob);
            var im = new Image();
            im.onload = function () {
                URL.revokeObjectURL(url);
                S.img = im;
                S.imgW = im.naturalWidth;
                S.imgH = im.naturalHeight;
                baseCv.width = S.imgW; baseCv.height = S.imgH;
                maskCv.width = S.imgW; maskCv.height = S.imgH;
                bctx.drawImage(im, 0, 0);
                resolve();
            };
            im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('图片解码失败')); };
            im.src = url;
        });
    }

    async function readProjectImage() {
        if (!S.meta.imageFile || !PJ) throw new Error('工程里没有图片');
        var abs = PJ.pathsFor(S.project).dir + '/' + S.meta.imageFile;
        var bytes = await PJ.store().read(abs);
        await loadImageFromBytes(bytes);
    }

    /* 导入：选文件 → 魔数校验 → 内容寻址落盘 → meta 更新 */
    function pickImage() {
        var inp = document.createElement('input');
        inp.type = 'file';
        // 不设 accept：真机 WebView 会把 accept 映射成 MIME 白名单，挡掉部分图片扩展
        inp.onchange = function () {
            var f = inp.files && inp.files[0];
            if (!f) return;
            var fr = new FileReader();
            fr.onload = async function () {
                try {
                    var u8 = new Uint8Array(fr.result);
                    var kind = L.sniffImageType(u8);
                    if (!kind) { hint('不是图片文件（支持 PNG/JPG/WebP/GIF/BMP）', true); return; }

                    /* v50 换图三选（老板 2026-11-07 确认）：已有图且已有笔画时问一下。
                     * 取消 = 什么都不动；清空 = 一次性 op（可撤销）；保留 = 笔画不动
                     * （坐标是原图像素系，尺寸变了会错位，选保留的人自己负责微调）。 */
                    var hadStrokes = !!(S.img && S.state &&
                        S.state.layers.some(function (l) { return l.strokes.length > 0; }));
                    if (hadStrokes) {
                        var c = confirm('已有笔画，换图后怎么处理？\n\n「确定」= 保留笔画继续编辑\n「取消」= 放弃换图\n（清空笔画请在换图后点 🙑 清空当前层，可撤销）');
                        if (!c) { hint('已取消换图'); return; }
                    }

                    showEmpty(false);
                    hint('导入中…');
                    var p = PJ.pathsFor(S.project);
                    var rel = await PJ.putContentFile(p, kind, u8);
                    await loadImageFromBytes(u8);
                    S.meta.imageFile = rel;
                    S.meta.imageW = S.imgW;
                    S.meta.imageH = S.imgH;
                    L.saveMeta(S.meta);
                    titleEl.textContent = S.project + ' · ' + S.imgW + '×' + S.imgH;
                    fitView();
                    redrawMask();
                    hint('已导入 ' + kind.toUpperCase() + '，点「绘制」开始抠图');
                } catch (e) {
                    showEmpty(true);
                    toast('导入失败：' + (e && e.message || e));
                }
            };
            fr.readAsArrayBuffer(f);
        };
        inp.click();
    }

    /* ---------- 撤销 / 重做 ---------- */

    function updateUndoState() {
        /* off=禁用视觉；undo/redo 仍可点（点了提示没有可撤销），只在视觉上区分 */
        undoGrp.classList.toggle('off', S.done.length === 0);
        undoGrp.classList.toggle('on', S.done.length > 0);
        redoGrp.classList.toggle('off', S.redo.length === 0);
        redoGrp.classList.toggle('on', S.redo.length > 0);
        markTitle();
    }

    /* 标题栏 ● = 未保存（v50b 手动保存语义） */
    function markTitle() {
        if (!titleEl || !S.project) return;
        var base = S.project + (S.img ? ' · ' + S.imgW + '×' + S.imgH : '');
        titleEl.textContent = base + (S.dirty ? ' ●' : '');
    }

    /* ---------- op 化撤销（v50）----------
     * S.done: 已应用 op 栈；undo 取逆应用，redo 重应用。
     * 笔画 op 的逆需要被弹出的笔画本体，存在 op.popped 里。 */
    function applyAndPush(op) {
        if (!OPS.applyOp(S.state, op)) return false;
        S.done.push(op);
        S.redo = [];
        S.dirty = true;   // v50b：只标脏，不即时落盘（老板要求返回时提醒保存）
        /* v54：tagMode 草稿必须即画即存（确认流不落笔画，延迟保存会丢最后一笔） */
        if (S.tagMode) saveTagStrokes();
        redrawMask();
        updateUndoState();
        renderLayersPanel();
        return true;
    }

    function pushStroke(st) {
        applyAndPush({ kind: 'stroke', layerId: S.state.activeId, stroke: st });
    }

    function undo() {
        var op = S.done.pop();
        if (!op) { hint('没有可撤销的操作'); return; }
        if (op.kind === 'stroke') {
            op.popped = OPS.applyUnStroke(S.state, op.layerId);   // 弹出并暂存，供 redo
        } else {
            var inv = OPS.invertOp(op);
            if (inv) OPS.applyOp(S.state, inv);
        }
        S.redo.push(op);
        S.dirty = true;   // v50b：只标脏
        redrawMask();
        updateUndoState();
        renderLayersPanel();
    }

    function redo() {
        var op = S.redo.pop();
        if (!op) { hint('没有可重做的操作'); return; }
        if (op.kind === 'stroke') {
            if (op.popped) {
                var lay = OPS.layerById(S.state, op.layerId);
                if (lay) lay.strokes.push(op.popped);
            }
        } else {
            OPS.applyOp(S.state, op);   // op 带逆信息，重应用即正向
        }
        S.done.push(op);
        S.dirty = true;   // v50b：只标脏
        redrawMask();
        updateUndoState();
        renderLayersPanel();
    }

    function saveAll(explicit) {
        /* v53 tagMode：笔画写 av-tagmask-*，绝不碰 img-* 存储（隔离红线） */
        if (S.tagMode) { saveTagStrokes(); S.dirty = false; return; }
        try {
            L.saveStrokes(S.project, S.state.layers, S.state.activeId);
            S.dirty = false;
            if (explicit) toast('已保存「' + S.project + '」（' + S.state.layers.length + ' 层）');
        } catch (e) {
            toast('保存失败：' + (e && e.message || e));
        }
        /* saveMeta 现在会拒收 mode!=='image' 的 meta，这里兜一层：
         * 笔画已经落了，不该因为 meta 契约不符把整个保存流程炸掉。 */
        if (S.meta) {
            try {
                S.meta.invert = S.invert;
                L.saveMeta(S.meta);
            } catch (e) {
                dlog('saveMeta skipped: ' + (e && e.message || e));
            }
        }
    }

    /* ---------- 工具与面板 ---------- */

    function setTool(t) {
        S.tool = t;
        btnBrush.classList.toggle('on', t === 'brush');
        btnPoly.classList.toggle('on', t === 'polygon');
        var map = { pan: panGrp, brush: drawGrp, polygon: drawGrp, erase: eraseGrp };
        [panGrp, drawGrp, eraseGrp].forEach(function (k) {
            if (k !== map[t]) k.classList.remove('on');
        });
        redrawMask();
        updateUndoState();
        var names = {
            pan: '单指拖动查看 · 双指缩放',
            brush: '涂抹中 · 画到哪挖到哪',
            polygon: '轮廓：拖动画一圈，松手自动闭合',
            erase: '橡皮：擦除遮罩（补回来）'
        };
        hint(names[t] || '');
    }

    function placePanel(panel, btn) {
        var r = btn.getBoundingClientRect();
        panel.style.top = Math.max(8, Math.min(r.top, window.innerHeight - panel.offsetHeight - 8)) + 'px';
        panel.style.left = (r.left - panel.offsetWidth - 8) + 'px';
    }

    /* v53v：点击空白处自动关闭悬浮面板（层列表/绘制/橡皮/描述） */
    document.addEventListener('pointerdown', function (e) {
        try {
            var el2 = e.target && e.target.nodeType === 1 ? e.target : null;
            if (!el2) return;
            var keep = el2.closest('.img-sub, .img-dock, .img-tagbar, .img-tag-desc-panel, .img-undo-bar, .img-top, .img-handle');
            if (keep) return;
            closePanels();
            var dp = document.getElementById('imgTagDescPanel');
            if (dp) dp.remove();
        } catch (err) { }
    }, true);

    function closePanels() {
        drawPanel.classList.remove('open');
        erasePanel.classList.remove('open');
        if (layersPanel) layersPanel.classList.remove('open');
        drawGrp.classList.remove('on');
        eraseGrp.classList.remove('on');
        if (layersGrp) layersGrp.classList.remove('on');
    }

    /* ---------- dock 拖拽吸附（v50/M4，对齐 dock.js 手感） ----------
     * move 用增量判阈值（合成事件 movementX 恒 0）；上下边距离加权 0.8
     * 更易命中横排；松手按最近边吸附并持久化到 localStorage。
     * 长按 vs 直接拖：图片页 dock 组都是按钮，直接拖即可，无需长按门限。 */
    var DOCK_POS_KEY = 'img-dock-pos';

    function nearestImgEdge(x, y) {
        var dist = { top: y * 0.8, bottom: (window.innerHeight - y) * 0.8, left: x, right: window.innerWidth - x };
        var keys = Object.keys(dist);
        keys.sort(function (a, b) { return dist[a] - dist[b]; });
        return keys[0];
    }

    function applyImgDockPos(pos) {
        if (!dockEl) return;
        dockEl.classList.remove('img-dock-left', 'img-dock-top', 'img-dock-bottom');
        if (pos === 'left') dockEl.classList.add('img-dock-left');
        else if (pos === 'top') dockEl.classList.add('img-dock-top');
        else if (pos === 'bottom') dockEl.classList.add('img-dock-bottom');
        /* right 是默认 CSS，无需类 */
        /* 位置切换后子面板重算（子面板贴着 dock 所在边弹出） */
        closePanels();
    }

    function restoreImgDockPos() {
        try {
            var pos = localStorage.getItem(DOCK_POS_KEY);
            if (pos && pos !== 'right') applyImgDockPos(pos);
        } catch (e) { }
    }

    /* v50c：通用拖拽吸附——dock 与撤销条共用（把手上 touch-action:none） */
    function makeDraggable(bar, onEdge, onCommit, getPos, setPos) {
        var drag = null;
        bar.addEventListener('pointerdown', function (e) {
            /* 把手或 bar 本体（非按钮）均可起拖。target 可能是非元素节点
             * （合成事件冒泡），先确保是 Element 再查类名。 */
            if (!e.target || e.target.nodeType !== 1 || !e.target.classList) return;
            var isHandle = e.target.classList.contains('img-handle') ||
                           (e.target.closest && e.target.closest('.img-handle'));
            if (!isHandle && e.target !== bar) return;
            try { bar.setPointerCapture(e.pointerId); } catch (err) { }
            drag = { moved: false, pid: e.pointerId, lastX: e.clientX, lastY: e.clientY, free: null };
            bar.classList.add('img-dragging');
        });
        window.addEventListener('pointermove', function (e) {
            if (!drag || e.pointerId !== drag.pid) return;
            var mdx = e.clientX - drag.lastX, mdy = e.clientY - drag.lastY;
            drag.lastX = e.clientX; drag.lastY = e.clientY;
            if (!drag.moved && Math.abs(mdx) < 4 && Math.abs(mdy) < 4) return;
            drag.moved = true;
            e.preventDefault();
            var edge = nearestImgEdge(e.clientX, e.clientY);
            if (edge !== getPos()) {
                setPos(edge);
                onEdge(edge);
                bar.offsetHeight;   // 强制重排，让类切换立即生效
            }
            bar.style.right = 'auto'; bar.style.bottom = 'auto';
            var r = bar.getBoundingClientRect();
            var nl = Math.max(6, Math.min(e.clientX - r.width / 2, window.innerWidth - r.width - 6));
            var nt = Math.max(60, Math.min(e.clientY - r.height / 2, window.innerHeight - r.height - 6));
            bar.style.transform = 'none';
            bar.style.left = nl + 'px';
            bar.style.top = nt + 'px';
            drag.free = { left: nl, top: nt };
        }, { passive: false });
        function endDrag(e) {
            if (!drag) return;
            if (e && e.pointerId !== undefined && e.pointerId !== drag.pid) return;
            var moved = drag.moved, free = drag.free;
            bar.classList.remove('img-dragging');
            drag = null;
            if (!moved || !free) return;
            var r = bar.getBoundingClientRect();
            var m = 8;
            onCommit(free, r, m);
        }
        window.addEventListener('pointerup', endDrag);
        window.addEventListener('pointercancel', endDrag);
        window.addEventListener('touchmove', function (e) { if (drag) e.preventDefault(); }, { passive: false });
    }

    function setupDockDrag() {
        if (!dockEl) return;
        /* 把手 pointerdown 冒泡到 dockEl：handle 是 bar 子元素，
         * e.target 是 handle → isHandle 放行 ✓ */
        makeDraggable(dockEl, function (edge) {
            applyImgDockPos(edge);
        }, function (free, r, m) {
            /* dock 吸附提交 */
            try { localStorage.setItem(DOCK_POS_KEY, S.dockPos); } catch (err) { }
            if (S.dockPos === 'left') {
                dockEl.style.left = m + 'px';
                dockEl.style.top = Math.max(60, Math.min(free.top, window.innerHeight - r.height - m)) + 'px';
            } else if (S.dockPos === 'top') {
                dockEl.style.top = (76 + 8) + 'px';
                dockEl.style.left = Math.max(m, Math.min(free.left, window.innerWidth - r.width - m)) + 'px';
            } else if (S.dockPos === 'bottom') {
                dockEl.style.bottom = m + 'px'; dockEl.style.top = 'auto';
                dockEl.style.left = Math.max(m, Math.min(free.left, window.innerWidth - r.width - m)) + 'px';
            } else {   // right
                dockEl.style.right = m + 'px'; dockEl.style.left = 'auto';
                dockEl.style.top = Math.max(60, Math.min(free.top, window.innerHeight - r.height - m)) + 'px';
            }
            hint('工具栏已吸附: ' + ({ top: '顶部', bottom: '底部', left: '左侧', right: '右侧' })[S.dockPos]);
        }, function () { return S.dockPos; }, function (p) { S.dockPos = p; });
    }

    /* ---- v50d：横竖屏切换后重钳位悬浮工具条 ----
     * commit 把吸附边和垂直坐标写成内联样式（按当下窗口算的绝对 px）。
     * 旋转后视口尺寸变化，旧的 top/left 可能完全落在屏幕外 → 工具条"丢了"。
     * 这里保留吸附边，只把垂直于该边的坐标按当前视口重新钳位。 */
    function reflowFloatBar(bar) {
        if (!bar) return;
        var cs = getComputedStyle(bar);
        var L = bar.style.left, T = bar.style.top, R = bar.style.right, B = bar.style.bottom;
        var hasInline = (L && L !== 'auto') || (T && T !== 'auto') || (R && R !== 'auto') || (B && B !== 'auto');
        if (!hasInline) return;   /* 默认停靠态（纯 CSS 类定位），无需处理 */
        var m = 8, topMin = 60;
        var vw = window.innerWidth, vh = window.innerHeight;
        var r = bar.getBoundingClientRect();
        /* 吸附边 = 内联里非 auto 的那个水平/垂直属性；缺省视为默认边 */
        var pinnedRight = R && R !== 'auto';
        var pinnedBottom = B && B !== 'auto';
        /* 水平钳位：贴左/右边的只调整与边垂直的坐标；自由 left 也钳 */
        if (L && L !== 'auto') {
            var nl = Math.max(m, Math.min(parseFloat(L), vw - r.width - m));
            bar.style.left = nl + 'px';
        }
        if (T && T !== 'auto') {
            var nt = Math.max(topMin, Math.min(parseFloat(T), vh - r.height - m));
            bar.style.top = nt + 'px';
        }
        if (pinnedRight) {
            bar.style.right = m + 'px';
            bar.style.left = 'auto';
        }
        if (pinnedBottom) {
            bar.style.bottom = m + 'px';
            bar.style.top = 'auto';
        }
        void cs;
    }

    /* ---- v50c：左侧撤销条拖拽（独立持久化 img-undo-pos） ---- */
    var UNDO_POS_KEY = 'img-undo-pos';

    function applyUndoPos(pos) {
        if (!undoBarEl) return;
        undoBarEl.classList.remove('img-undo-right', 'img-undo-top', 'img-undo-bottom');
        if (pos === 'right') undoBarEl.classList.add('img-undo-right');
        else if (pos === 'top') undoBarEl.classList.add('img-undo-top');
        else if (pos === 'bottom') undoBarEl.classList.add('img-undo-bottom');
        /* left 是默认 CSS */
        closePanels();
    }

    function setupUndoDrag() {
        if (!undoBarEl) return;
        S.undoPos = 'left';
        try {
            var pos = localStorage.getItem(UNDO_POS_KEY);
            if (pos && pos !== 'left') { S.undoPos = pos; applyUndoPos(pos); }
        } catch (e) { }
        makeDraggable(undoBarEl, function (edge) {
            S.undoPos = edge;
            applyUndoPos(edge);
        }, function (free, r, m) {
            try { localStorage.setItem(UNDO_POS_KEY, S.undoPos); } catch (err) { }
            if (S.undoPos === 'left') {
                undoBarEl.style.left = m + 'px';
                undoBarEl.style.top = Math.max(60, Math.min(free.top, window.innerHeight - r.height - m)) + 'px';
            } else if (S.undoPos === 'right') {
                undoBarEl.style.right = m + 'px'; undoBarEl.style.left = 'auto';
                undoBarEl.style.top = Math.max(60, Math.min(free.top, window.innerHeight - r.height - m)) + 'px';
            } else if (S.undoPos === 'top') {
                undoBarEl.style.top = (76 + 8) + 'px';
                undoBarEl.style.left = Math.max(m, Math.min(free.left, window.innerWidth - r.width - m)) + 'px';
            } else {
                undoBarEl.style.bottom = m + 'px'; undoBarEl.style.top = 'auto';
                undoBarEl.style.left = Math.max(m, Math.min(free.left, window.innerWidth - r.width - m)) + 'px';
            }
            hint('撤销条已吸附: ' + ({ top: '顶部', bottom: '底部', left: '左侧', right: '右侧' })[S.undoPos]);
        }, function () { return S.undoPos; }, function (p) { S.undoPos = p; });
    }

    /* ---------- 图层面板（v50） ---------- */

    function renderLayersPanel() {
        if (!layersListEl || !S.state) return;
        /* v53l：同步顶部三按钮的锁定态（build 只发生一次，tagMode 可能后开） */
        /* v60b：打标模式层管理可编辑（新增走角色卡选择）——不再锁定 */
        layersListEl.textContent = '';
        /* 列表顺序：上=顶层（数组尾）。显示开关点击不改变激活层；单击名称激活。 */
        S.state.layers.slice().reverse().forEach(function (lay) {
            var row = el('div', 'img-layer-row' + (lay.id === S.state.activeId ? ' active' : ''));

            var eye = el('span', 'img-layer-eye' + (lay.visible ? ' on' : ''), lay.visible ? '👁' : '🚫');
            eye.title = lay.visible ? '点击隐藏' : '点击显示';
            eye.addEventListener('click', function (e) {
                e.stopPropagation();
                applyAndPush({ kind: 'toggleVisible', layerId: lay.id });
                tmSyncCurLayerName();
            });
            row.appendChild(eye);

            /* v50b：整行可点激活——真机反馈「切换不了」，原来只有名字文本可点
             * （行右侧空白点了没反应），移动端命中区域太窄。行点击=激活，
             * 眼睛自己 stopPropagation 不受影响。 */
            row.title = '点击激活此层进行编辑';
            row.addEventListener('click', function () {
                if (S.state.activeId !== lay.id) {
                    S.state.activeId = lay.id;   // 切换激活不是编辑动作，不入撤销栈
                    renderLayersPanel();
                    tmSyncCurLayerName();
                    hint('已激活「' + lay.name + '」');
                }
            });
            /* v60g：行尾删除按老板要求移除，删除只留列表顶部的🗑按钮 */
            var nm = el('span', 'img-layer-name', lay.name +
                (lay.strokes.length ? ' (' + lay.strokes.length + ')' : ''));
            row.appendChild(nm);

            layersListEl.appendChild(row);
        });
        tmSyncCurLayerName();
    }

    /* ---------- 指针交互 ---------- */

    var pointers = new Map();
    var gesture = null, pinchStart = null;

    function posOf(e) {
        var r = stage.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function bindStageEvents() {
        stage.addEventListener('pointerdown', function (e) {
            if (!S.img) return;
            pointers.set(e.pointerId, posOf(e));

            if (pointers.size === 2) {
                S.drawing = false;
                var pts = Array.from(pointers.values());
                var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                var mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
                pinchStart = { d: d, scale: S.scale, mx: mx, my: my, tx: S.tx, ty: S.ty };
                gesture = 'pinch';
                return;
            }
            if (pointers.size !== 1) return;

            var p = posOf(e);
            var ip = toImage(e.clientX, e.clientY);

            if (S.tool === 'pan') {
                S.panStart = { px: e.clientX, py: e.clientY, tx: S.tx, ty: S.ty };
                return;
            }

            /* v49b：多边形改成「拖动画轮廓，松手自动闭合」。
             * 与涂抹共用拖动采点，只是收尾时闭合而不是留成开放路径。
             * 半径采样阈值调小（0.06 而非 0.12）：轮廓要贴合手指轨迹，
             * 太稀会在拐角处切角。 */
            /* v53j/v53k：打标模式下未启用当前角色时禁止落笔。
             * enabled 存的是 cardId；激活层通过层名（=card.name）映射回 card 判断。 */
            if (S.tagMode) {
                var act = (S.state && S.state.layers) ? S.state.layers.filter(function (l) { return l.id === S.state.activeId; })[0] : null;
                var actCard = act ? S.tagMode.cards.cards.filter(function (c) { return c.name === act.name; })[0] : null;
                var enabledIds = S.tagMode.enabled || [];
                if (!act || !actCard || enabledIds.indexOf(actCard.id) < 0) {
                    toast('先点右上「启用」再画');
                    S.drawing = false;
                    return;
                }
            }
            S.drawing = true;
            var kind = S.tool === 'erase' ? 'erase' : (S.tool === 'polygon' ? 'polygon' : 'brush');
            S.live = { type: kind, size: S.size, points: [[ip.x, ip.y]] };
            redrawMask();
        });

        stage.addEventListener('pointermove', function (e) {
            if (!S.img) return;
            if (pointers.has(e.pointerId)) pointers.set(e.pointerId, posOf(e));

            if (gesture === 'pinch' && pointers.size === 2 && pinchStart) {
                var pts = Array.from(pointers.values());
                var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                var ns = Math.max(0.05, Math.min(12, pinchStart.scale * (d / (pinchStart.d || 1))));
                var mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
                var k = ns / pinchStart.scale;
                S.tx = mx - (pinchStart.mx - pinchStart.tx) * k;
                S.ty = my - (pinchStart.my - pinchStart.ty) * k;
                S.scale = ns;
                applyView();
                return;
            }

            if (S.tool === 'pan' && S.panStart && pointers.size === 1) {
                S.tx = S.panStart.tx + (e.clientX - S.panStart.px);
                S.ty = S.panStart.ty + (e.clientY - S.panStart.py);
                applyView();
                return;
            }

            if (!S.drawing || !S.live || pointers.size !== 1) return;
            var ip = toImage(e.clientX, e.clientY);
            var last = S.live.points[S.live.points.length - 1];
            /* 多边形按更细的步长采点（贴合轮廓），涂抹按笔宽比例 */
            var thr = S.live.type === 'polygon'
                ? Math.max(0.75, S.size * 0.06)
                : Math.max(1, S.size * 0.12);
            if (Math.hypot(ip.x - last[0], ip.y - last[1]) > thr) {
                S.live.points.push([ip.x, ip.y]);
                redrawMask();
            }
        });

        function endPointer(e) {
            if (!pointers.has(e.pointerId)) return;
            pointers.delete(e.pointerId);
            if (S.tool === 'pan') S.panStart = null;
            if (gesture === 'pinch') {
                if (pointers.size < 2) { gesture = null; pinchStart = null; }
                return;
            }
            if (S.drawing && S.live) {
                S.drawing = false;
                /* 多边形需要至少 3 点才能闭合成面；不够就丢弃并提示，
                 * 不留下一个看着像笔画、导出却是折线的怪东西。 */
                if (S.live.type === 'polygon' && S.live.points.length < 3) {
                    hint('轮廓太短，已被忽略', true);
                    S.live = null;
                    redrawMask();
                    return;
                }
                if (S.live.points.length) pushStroke(S.live);
                S.live = null;
            }
        }
        stage.addEventListener('pointerup', endPointer);
        stage.addEventListener('pointercancel', endPointer);
    }

    /* ---------- 构建 UI ---------- */

    function build() {
        if (S.built) return;
        S.built = true;
        embedCss();

        page = el('div', 'img-page');
        page.id = 'imgPage';

        topEl = el('div', 'img-top');
        var backBtn = el('button', 'img-top-btn', '← 返回');
        backBtn.addEventListener('click', back);
        topEl.appendChild(backBtn);
        backBtnEl = backBtn;

        /* v53：打标模式顶部确认/取消（默认隐藏，openTagMode 控制） */
        btnTagConfirm = el('button', 'img-top-btn primary', '✅ 确认打标');
        btnTagConfirm.style.display = 'none';
        btnTagConfirm.addEventListener('click', function () { finishTag(true); });
        topEl.appendChild(btnTagConfirm);
        btnTagCancel = el('button', 'img-top-btn', '✖ 取消');
        btnTagCancel.style.display = 'none';
        btnTagCancel.addEventListener('click', function () { finishTag(false); });
        topEl.appendChild(btnTagCancel);
        titleEl = el('div', 'img-title', '');
        topEl.appendChild(titleEl);
        var reloadBtn = el('button', 'img-top-btn', '🔄 换图');
        reloadBtn.title = '更换图片（v50）';
        reloadBtn.addEventListener('click', pickImage);
        reloadBtn.style.display = 'none';   // 有图后才显示（showEmpty 控制）
        topEl.appendChild(reloadBtn);
        reloadBtnEl = reloadBtn;
        var saveBtn = el('button', 'img-top-btn', '💾 保存');
        saveBtn.addEventListener('click', function () { saveAll(true); });
        topEl.appendChild(saveBtn);
        saveBtnEl = saveBtn;
        var shareBtn = el('button', 'img-top-btn primary', '📤 分享');
        shareBtn.addEventListener('click', showShareDialog);
        topEl.appendChild(shareBtn);
        shareBtnEl = shareBtn;
        page.appendChild(topEl);

        stage = el('div', 'img-stage');
        wrap = el('div', 'img-wrap');
        baseCv = el('canvas', 'img-base');
        maskCv = el('canvas', 'img-mask');
        wrap.appendChild(baseCv);
        wrap.appendChild(maskCv);
        stage.appendChild(wrap);
        bctx = baseCv.getContext('2d');
        mctx = maskCv.getContext('2d');

        emptyEl = el('div', 'img-empty');
        emptyEl.appendChild(el('div', 'img-empty-t', '还没有导入图片'));
        emptyEl.appendChild(el('div', 'img-empty-s', '导入一张图片，涂画遮罩区域，分享时对应区域会被抠除'));
        var impBtn = el('button', 'img-empty-btn', '📂 选择图片');
        impBtn.addEventListener('click', pickImage);
        emptyEl.appendChild(impBtn);
        stage.appendChild(emptyEl);
        page.appendChild(stage);

        /* 工具组 */
        dockEl = el('div', 'img-dock');
        panGrp = el('div', 'img-grp on');
        panGrp.appendChild(el('span', 'ico', '✋'));
        panGrp.appendChild(el('span', null, '移动'));
        panGrp.addEventListener('click', function () { closePanels(); setTool('pan'); });
        dockEl.appendChild(panGrp);

        drawGrp = el('div', 'img-grp');
        drawGrp.appendChild(el('span', 'ico', '✏️'));
        drawGrp.appendChild(el('span', null, '绘制'));
        dockEl.appendChild(drawGrp);

        eraseGrp = el('div', 'img-grp');
        eraseGrp.appendChild(el('span', 'ico', '🧽'));
        eraseGrp.appendChild(el('span', null, '橡皮'));
        dockEl.appendChild(eraseGrp);

        /* v50c：dock 顶部拖拽把手（对齐 3D 场景 .sd-handle；真机抓得住） */
        var dockHandle = el('div', 'img-handle', '⠿');
        dockHandle.title = '拖动可吸附到屏幕边缘';
        dockEl.insertBefore(dockHandle, dockEl.firstChild);

        /* v50/M4：撤销/重做移到左侧独立停靠条（老板指定），不占右侧工具 dock */
        undoBarEl = el('div', 'img-undo-bar img-undo-left');
        var undoBar = undoBarEl;
        var undoHandle = el('div', 'img-handle', '⠿');
        undoHandle.title = '拖动可吸附到屏幕边缘';
        undoBar.appendChild(undoHandle);
        undoGrp = el('div', 'img-grp off');
        undoGrp.appendChild(el('span', 'ico', '↩️'));
        undoGrp.appendChild(el('span', null, '撤销'));
        undoGrp.addEventListener('click', undo);
        undoBar.appendChild(undoGrp);
        redoGrp = el('div', 'img-grp off');
        redoGrp.appendChild(el('span', 'ico', '↪️'));
        redoGrp.appendChild(el('span', null, '重做'));
        redoGrp.addEventListener('click', redo);
        undoBar.appendChild(redoGrp);
        page.appendChild(undoBar);

        /* v50 图层分组 */
        layersGrp = el('div', 'img-grp');
        layersGrp.appendChild(el('span', 'ico', '🗂️'));
        layersGrp.appendChild(el('span', null, '图层'));
        layersGrp.addEventListener('click', function () {
            var isOpen = layersPanel.classList.contains('open');
            closePanels();
            if (!isOpen) {
                layersPanel.classList.add('open');
                layersGrp.classList.add('on');
                renderLayersPanel();
            }
        });
        dockEl.appendChild(layersGrp);
        page.appendChild(dockEl);

        /* 图层悬浮面板（点击后弹出） */
        layersPanel = el('div', 'img-sub img-layers');
        var lTop = el('div', 'img-layers-top');
        /* v53h/j/l：打标模式下层管理锁定——按钮置灰禁用（每次 renderLayersPanel 同步，
         * 因面板可能在普通图片模式先 build，tagMode 复用时必须刷新状态） */
        var addBtn = el('button', 'img-sub-btn', '➕'); addBtn.title = '新建图层';
        var delBtn = el('button', 'img-sub-btn', '🗑'); delBtn.title = '删除当前图层';
        var renBtn = el('button', 'img-sub-btn', '✏️'); renBtn.title = '重命名当前图层';
        addBtn.addEventListener('click', function () {
            /* v60b：打标模式 → 弹角色卡选择，卡名=层名；普通图片模式 → 自动命名 */
            if (S.tagMode) {
                openTagCardPicker('add', function (card) {
                    var nm = card.name;
                    if (applyAndPush({ kind: 'addLayer', layer: { id: OPS.newId(S.state), name: nm, visible: true, strokes: [] }, at: S.state.layers.length })) {
                        hint('已新建「' + nm + '」并激活');
                        renderLayersPanel();
                    }
                });
                return;
            }
            var nm = '遮罩 ' + (S.state.layers.length + 1);
            if (applyAndPush({ kind: 'addLayer', layer: { id: OPS.newId(S.state), name: nm, visible: true, strokes: [] }, at: S.state.layers.length })) {
                hint('已新建「' + nm + '」并激活');
            }
        });
        delBtn.addEventListener('click', function () {
            var lay = curLayer();
            if (!lay) return;
            /* v60f/g：打标模式可删光（0 层确认 = 清除该帧打标）；普通图片模式至少保留一层 */
            if (!S.tagMode && S.state.layers.length <= 1) { hint('至少要保留一个图层', true); return; }
            if (!confirm('删除图层「' + lay.name + '」及其全部笔画？')) return;
            var op = OPS.makeDelLayer(S.state, lay.id, { allowEmpty: !!S.tagMode });
            if (op && applyAndPush(op)) { hint('已删除「' + lay.name + '」'); renderLayersPanel(); tmSyncCurLayerName(); if (S.tagMode) saveTagStrokes(); }
        });
        renBtn.addEventListener('click', function () {
            var lay = curLayer();
            var nm = prompt('重命名图层', lay.name);
            if (nm === null) return;
            nm = nm.trim();
            if (!nm) { hint('名称不能为空', true); return; }
            if (nm === lay.name) return;
            applyAndPush({ kind: 'renameLayer', layerId: lay.id, name: nm });
        });
        lTop.appendChild(addBtn); lTop.appendChild(delBtn); lTop.appendChild(renBtn);
        layersPanel.appendChild(lTop);
        layersListEl = el('div', 'img-layers-list');
        layersPanel.appendChild(layersListEl);
        page.appendChild(layersPanel);

        /* 绘制子面板 */
        drawPanel = el('div', 'img-sub');
        var g1 = el('div', 'img-grid2');
        btnBrush = el('button', 'img-sub-btn', '🖌️');
        btnBrush.title = '涂抹';
        btnBrush.addEventListener('click', function () { setTool('brush'); });
        btnPoly = el('button', 'img-sub-btn', '🔺');
        btnPoly.title = '轮廓：拖动画一圈，松手自动闭合';
        btnPoly.addEventListener('click', function () {
            /* v49b：不再有「再点一次结束」——松手即闭合，按钮只负责切换工具 */
            setTool('polygon');
        });
        g1.appendChild(btnBrush); g1.appendChild(btnPoly);
        drawPanel.appendChild(g1);

        var szWrap = el('div', 'img-size-wrap');
        var szRow = el('div', 'img-size-row');
        szRow.appendChild(el('span', 'img-sub-label', '笔画'));
        sizeRange = document.createElement('input');
        sizeRange.type = 'range'; sizeRange.min = '1'; sizeRange.max = '120'; sizeRange.value = '24';
        sizeVal = el('span', 'img-size-val', '24');
        szRow.appendChild(sizeRange); szRow.appendChild(sizeVal);
        szWrap.appendChild(szRow);
        drawPanel.appendChild(szWrap);

        var g2 = el('div', 'img-grid2');
        btnClear = el('button', 'img-sub-btn', '🗑');
        btnClear.title = '清空当前层遮罩';
        btnClear.addEventListener('click', function () {
            var lay = curLayer();
            if (!lay || (!lay.strokes.length && !S.invert)) { hint('遮罩已是空的'); return; }
            /* 清空 = clearLayer op（快照旧笔画，可撤销） */
            applyAndPush({ kind: 'clearLayer', layerId: lay.id });
            hint('已清空「' + lay.name + '」');
        });
        btnInvert = el('button', 'img-sub-btn', '⇄');
        btnInvert.title = '反选：已画/未画互换';
        g2.appendChild(btnClear); g2.appendChild(btnInvert);
        drawPanel.appendChild(g2);
        page.appendChild(drawPanel);

        drawGrp.addEventListener('click', function () {
            var open = drawPanel.classList.contains('open');
            closePanels();
            if (!open) {
                drawPanel.classList.add('open');
                setTool(S.tool === 'brush' || S.tool === 'polygon' ? S.tool : 'brush');
                placePanel(drawPanel, drawGrp);
            }
        });

        /* 橡皮子面板 */
        erasePanel = el('div', 'img-sub');
        var ezWrap = el('div', 'img-size-wrap');
        ezWrap.style.borderTop = '0';
        var ezRow = el('div', 'img-size-row');
        ezRow.appendChild(el('span', 'img-sub-label', '宽度'));
        sizeRange2 = document.createElement('input');
        sizeRange2.type = 'range'; sizeRange2.min = '1'; sizeRange2.max = '120'; sizeRange2.value = '24';
        sizeVal2 = el('span', 'img-size-val', '24');
        ezRow.appendChild(sizeRange2); ezRow.appendChild(sizeVal2);
        ezWrap.appendChild(ezRow);
        erasePanel.appendChild(ezWrap);
        page.appendChild(erasePanel);

        eraseGrp.addEventListener('click', function () {
            var open = erasePanel.classList.contains('open');
            closePanels();
            if (!open) {
                erasePanel.classList.add('open');
                setTool('erase');
                placePanel(erasePanel, eraseGrp);
            } else {
                setTool('pan');
            }
        });

        function bindSize(r, v, other) {
            r.addEventListener('input', function () {
                S.size = +r.value;
                v.textContent = S.size;
                other.value = S.size;
                other._v.textContent = S.size;
            });
        }
        sizeRange._v = sizeVal;
        sizeRange2._v = sizeVal2;
        bindSize(sizeRange, sizeVal, sizeRange2);
        bindSize(sizeRange2, sizeVal2, sizeRange);

        btnInvert.addEventListener('click', function () {
            if (!S.img) { hint('先导入图片', true); return; }
            S.invert = !S.invert;
            btnInvert.classList.toggle('on', S.invert);
            S.dirty = true;   // v50b：只标脏
            redrawMask();
            hint(S.invert ? '已反选：画的是「保留」区域' : '已取消反选');
        });

        hintEl = el('div', 'img-hint');
        page.appendChild(hintEl);

        document.body.appendChild(page);
        bindStageEvents();
        setupDockDrag();
        setupUndoDrag();   // v50c：撤销条拖拽吸附

        window.addEventListener('resize', function () {
            if (page.classList.contains('open') && S.img) fitView();
        });
        // 旋转/窗口变化后重读安全区（与 av-ui 同策略）
        var reapply = function () {
            if (!page.classList.contains('open')) return;
            applySafeArea();
            /* v50d：旋转/改窗后重钳位，防止竖屏存的坐标在横屏落在屏幕外 */
            reflowFloatBar(dockEl);
            reflowFloatBar(undoBarEl);
        };
        window.addEventListener('resize', reapply);
        window.addEventListener('orientationchange', reapply);
    }

    function showEmpty(show) {
        emptyEl.style.display = show ? 'flex' : 'none';
        /* 「换图」只在有图时显示；空态时用空态大按钮导入 */
        if (reloadBtnEl) reloadBtnEl.style.display = show ? 'none' : '';
    }

    /* ---------- 保存 / 返回 / 导出 ---------- */

    function back() {
        if (S.tagMode) { toast('打标模式请用顶部 ✅确认 / ✖取消'); return; }
        dlog('back() project=' + S.project);
        /* v50b：手动保存语义——脏则先问（老板反馈：自动保存+无提醒直接退出不行） */
        if (S.dirty) {
            showBackConfirm();
            return;
        }
        doBack();
    }

    /* 返回确认：保存并退出 / 不保存退出 / 取消 */
    function showBackConfirm() {
        var mask = el('div', 'pj-dlg-mask');
        var box = el('div', 'pj-dlg');
        box.appendChild(el('div', 'pj-dlg-title', '有未保存的修改'));
        box.appendChild(el('div', 'pj-dlg-hint', '笔画/图层改动还没有保存'));
        var col = el('div', 'pj-dlg-col');
        var b1 = el('button', 'pj-dlg-btn pj-primary', '💾 保存并退出');
        var b2 = el('button', 'pj-dlg-btn', '不保存退出');
        var b3 = el('button', 'pj-dlg-btn', '取消');
        col.appendChild(b1); col.appendChild(b2); col.appendChild(b3);
        box.appendChild(col);
        mask.appendChild(box);
        document.body.appendChild(mask);
        requestAnimationFrame(function () { mask.classList.add('open'); });
        var close = function () { mask.classList.remove('open'); setTimeout(function () { mask.remove(); }, 200); };
        b1.addEventListener('click', function () { close(); saveAll(true); doBack(); });
        b2.addEventListener('click', function () { close(); S.dirty = false; doBack(); });
        b3.addEventListener('click', close);
        mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    }

    function doBack() {
        page.classList.remove('open');
        /* 必须同时清掉内联 display：open() 里为绕开样式表缓存把 display:flex
         * 内联写死在 page.style 上，而 .open 只是一个类。只 remove('open') 的话
         * 内联 display:flex 仍然生效，图片页会继续盖在工程列表上面，
         * 表现为「点返回没反应」（v49b 真机反馈）。 */
        page.style.display = 'none';
        var pj = document.getElementById('pjPage');
        if (pj) pj.classList.add('open');
        if (window.__projects && window.__projects.list) window.__projects.list();
    }

    /* 导出：drawMaskInto 生成蒙版 → destination-out 挖图 → SaveImage 分享 */
    /* ---------- 导出（v50 双模式） ---------- */

    /* 单图导出画布：合成可见层蒙版 → destination-out 挖图。导出与分享共用。 */
    function buildCutoutCanvas() {
        var mc = document.createElement('canvas');
        mc.width = S.imgW; mc.height = S.imgH;
        drawMaskInto(mc.getContext('2d'), { alpha: 1, showAids: false });
        if (S.invert) applyInvert(mc.getContext('2d'), '0,0,0', 1);

        var c = document.createElement('canvas');
        c.width = S.imgW; c.height = S.imgH;
        var g = c.getContext('2d');
        g.drawImage(S.img, 0, 0);
        g.globalCompositeOperation = 'destination-out';
        g.drawImage(mc, 0, 0);
        g.globalCompositeOperation = 'source-over';
        return c;
    }

    /* 单层遮罩画布：白笔不透明底透明（老板确认：隐藏层不导出） */
    function buildLayerCanvas(layer) {
        var c = document.createElement('canvas');
        c.width = S.imgW; c.height = S.imgH;
        var g = c.getContext('2d');
        g.lineCap = 'round'; g.lineJoin = 'round';
        g.fillStyle = '#fff'; g.strokeStyle = '#fff';
        drawStrokes(g, layer.strokes);
        return c;
    }

    function safePart(name) {
        return OPS.sanitizeName(name, []);
    }

    function canvasToU8(c) {
        var b64 = c.toDataURL('image/png').split(',')[1];
        var bin = atob(b64);
        var u8 = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return u8;
    }

    /* 分层 zip：原图 + 原图_alpha + 每可见层 原图_层名.png，fflate 打包后分享 */
    async function exportLayersZip() {
        var base = safePart(S.project);
        var entries = {};

        var clean = document.createElement('canvas');
        clean.width = S.imgW; clean.height = S.imgH;
        clean.getContext('2d').drawImage(S.img, 0, 0);
        entries[base + '.png'] = canvasToU8(clean);

        entries[base + '_alpha.png'] = canvasToU8(buildCutoutCanvas());

        var used = [];
        S.state.layers.forEach(function (lay) {
            if (!lay.visible) return;   // 隐藏层不导出（老板确认）
            var nm = OPS.sanitizeName(lay.name, used);
            entries[base + '_' + nm + '.png'] = canvasToU8(buildLayerCanvas(lay));
        });

        if (!window.fflate) throw new Error('fflate 未加载');
        var zipped = window.fflate.zipSync(entries, { level: 0 });   // PNG 已压缩，再压白费 CPU
        /* 分块 base64：String.fromCharCode.apply(null, zipped) 的参数上限
         * ≈65535，图层包很容易越线（RangeError: Maximum call stack size
         * exceeded），异常会被按钮 catch 成 toast，「分享没反应」。探针实测
         * 600×400×5 张已触雷。分块拼，不限大小。 */
        var bin = '';
        var CH = 8192;
        for (var bi = 0; bi < zipped.length; bi += CH) {
            bin += String.fromCharCode.apply(null, zipped.subarray(bi, bi + CH));
        }
        var b64 = btoa(bin);
        var name = base + '_layers.zip';

        var sp = savePlug();
        if (sp && sp.shareFile) {
            await sp.shareFile({ data: b64, filename: name, mime: 'application/zip' });
            hint('已分享分层包（' + Object.keys(entries).length + ' 个文件）');
        } else if (sp && sp.share) {
            await sp.share({ data: 'data:application/zip;base64,' + b64, filename: name });
            hint('已唤起系统分享');
        } else {
            throw new Error('分享插件不可用');
        }
    }

    /* 分享模式弹窗（默认 / 遮罩分层），纯 DOM，不用系统对话框 */
    function showShareDialog() {
        var mask = el('div', 'pj-dlg-mask');
        var box = el('div', 'pj-dlg');
        box.appendChild(el('div', 'pj-dlg-title', '选择导出模式'));
        box.appendChild(el('div', 'pj-dlg-hint', '默认：整图 PNG（遮罩区透明）；分层：打包原图/挖除图/各层遮罩'));
        var col = el('div', 'pj-dlg-col');
        var b1 = el('button', 'pj-dlg-btn pj-primary', '默认导出（PNG）');
        var b2 = el('button', 'pj-dlg-btn', '遮罩分层（ZIP）');
        var b3 = el('button', 'pj-dlg-btn', '取消');
        col.appendChild(b1); col.appendChild(b2); col.appendChild(b3);
        box.appendChild(col);
        mask.appendChild(box);
        document.body.appendChild(mask);
        requestAnimationFrame(function () { mask.classList.add('open'); });
        var close = function () { mask.classList.remove('open'); setTimeout(function () { mask.remove(); }, 200); };
        b1.addEventListener('click', async function () { close(); await exportPng(); });
        b2.addEventListener('click', async function () {
            close();
            try { await exportLayersZip(); } catch (e) { toast('分层导出失败：' + (e && e.message || e)); }
        });
        b3.addEventListener('click', close);
        mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    }

    async function exportPng() {
        if (!S.img) { hint('先导入图片', true); return; }
        try {
            var c = buildCutoutCanvas();

            var url = c.toDataURL('image/png');
            var name = 'cutout-' + S.project.replace(/[\\/:*?"<>|]/g, '_') + '-' +
                new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '.png';

            var sp = savePlug();
            if (sp && sp.share) {
                await sp.share({ data: url, filename: name });
                hint('已唤起系统分享');
            } else {
                var w = window.open('', '_blank');
                if (w) {
                    w.document.write('<title>导出预览</title><body style="margin:0;background:#333;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="' + url + '" style="max-width:96vw;max-height:96vh;background:repeating-conic-gradient(#666 0% 25%,#888 0% 50%) 50%/20px 20px">');
                } else {
                    hint('分享插件不可用，弹窗也被拦截', true);
                }
            }
        } catch (e) {
            toast('导出失败：' + (e && e.message || e));
        }
    }

    /* ---------- 打开（projects-ui 路由入口） ---------- */

    function open(projectName) {
        try {
            build();
            S.project = projectName;
            S.meta = L.loadMeta(projectName) || L.emptyMeta(projectName);
            S.invert = !!S.meta.invert;
            btnInvert.classList.toggle('on', S.invert);
            var loaded = L.loadStrokes(projectName);
            /* v1 老工程在 loadStrokes 里已迁移；若磁盘上仍是 v1 结构，
             * 这里再兑一道并立即落盘为 v2（下次打开不再走迁移）。 */
            if (!OPS.isV2(loaded)) {
                var mig = OPS.migrateV1(loaded);
                S.state = mig || OPS.emptyState();
                L.saveStrokes(projectName, S.state.layers, S.state.activeId);
            } else {
                S.state = loaded;
            }
            S.done = [];
            S.redo = [];
            S.live = null;
            S.tool = 'pan';
            S.dirty = false;
            setTool('pan');
            titleEl.textContent = projectName;
            showEmpty(!S.meta.imageFile);

            page.classList.add('open');
            page.style.position = 'fixed';
            page.style.inset = '0';
            page.style.zIndex = '1550';
            page.style.display = 'flex';
            applySafeArea();
            restoreImgDockPos();

            if (S.meta.imageFile) {
                readProjectImage().then(function () {
                    titleEl.textContent = projectName + ' · ' + S.imgW + '×' + S.imgH;
                    showEmpty(false);
                    fitView();
                    redrawMask();
                    updateUndoState();
                    dlog('open ok layers=' + S.state.layers.length + ' strokes=' +
                        S.state.layers.reduce(function (a, l) { return a + l.strokes.length; }, 0));
                }).catch(function (e) {
                    showEmpty(true);
                    toast('图片读取失败：' + (e && e.message || e) + '，可重新导入');
                });
            } else {
                updateUndoState();
                dlog('open empty (no image)');
            }
        } catch (e) {
            var m = e && (e.stack || e.message) || String(e);
            dlog('open FAIL ' + m);
            toast('打开图片工作台失败：' + (e && e.message || e));
            /* 同样要清内联 display（open() 中途已把它设成 flex），否则失败后
             * 用户被留在一个半死的图片页上，且没有可点的返回入口。 */
            try {
                page.classList.remove('open');
                page.style.display = 'none';
                var pj = document.getElementById('pjPage');
                if (pj) pj.classList.add('open');
            } catch (e2) { }
        }
    }

        /* ---------- v53 角色打标运行模式（M4） ---------- */
    /* ctx = { project, seg, frame, at, kind, existing, cards, onDone, onCancel }
     * 底图 = ctx.frameCanvas（av-ui 抽帧 canvas）；层 = 角色；
     * 笔画 = localStorage 'av-<proj>-tagmask-<maskKey>'（imgmask.v2 结构）。 */

    function tagMaskKey() {
        var tm = S.tagMode;
        return 'av-' + tm.project + '-tagmask-' + (tm.existing ? tm.existing.id : tm.seg + '_' + tm.frame);
    }

    function saveTagStrokes() {
        try {
            localStorage.setItem(tagMaskKey(), JSON.stringify({ schema: 'moyutai.imgmask.v2', layers: S.state.layers, activeId: S.state.activeId }));
            /* v53y：保存生命周期骨架日志 */
            var nStrokes = S.state.layers.reduce(function (n, l) { return n + l.strokes.length; }, 0);
            dlog('tag: save key=' + tagMaskKey() + ' layers=' + S.state.layers.length + ' strokes=' + nStrokes);
        } catch (e) { toast('打标笔画保存失败：' + (e && e.message || e)); }
    }

    function actLayOf(state, id) {
        return state && state.layers ? state.layers.filter(function (l) { return l.id === id; })[0] : null;
    }

    function loadTagStrokes() {
        try {
            var raw = localStorage.getItem(tagMaskKey());
            var migrated = false;
            /* v53j：确认打标后 existing 从 null 变 ref，主 key 随之变化——
             * fallback 读首次绘制的 seg_frame 旧 key 并迁移到主 key，保住已有遮罩 */
            if (!raw && S.tagMode && S.tagMode.existing) {
                var oldKey = 'av-' + S.tagMode.project + '-tagmask-' + S.tagMode.seg + '_' + S.tagMode.frame;
                raw = localStorage.getItem(oldKey);
                if (raw) {
                    migrated = true;
                    localStorage.setItem(tagMaskKey(), raw);
                    dlog('tagmask migrated ' + oldKey + ' -> ' + tagMaskKey());
                }
            }
            if (raw) {
                var o = JSON.parse(raw);
                if (o && o.schema === 'moyutai.imgmask.v2' && Array.isArray(o.layers)) {
                    /* v53y：读取生命周期骨架日志（hit 来源） */
                    dlog('tag: load key=' + tagMaskKey() + ' hit=' + (migrated ? 'fallback' : 'main') + ' layers=' + o.layers.length);
                    return o;
                }
            }
        } catch (e) { /* */ }
        return null;
    }

    function tagEntries() {
        /* 从层与选择组 entries：只收「启用」的角色；有笔画的层带 mask 标记（M5 导出时解析路径） */
        var tm = S.tagMode;
        /* v60b：enabled 派生 = 遮罩层名单（层名=卡名）——不再有独立「启用」登记 */
        var enabledCards = (S.state.layers || []).map(function (l) {
            return tm.cards.cards.filter(function (c) { return c.name === l.name; })[0];
        }).filter(Boolean);
        return enabledCards.map(function (card) {
            var cardId = card.id;
            var card = tm.cards.cards.filter(function (c) { return c.id === cardId; })[0];
            if (!card) return null;
            var lay = S.state.layers.filter(function (l) { return l.name === card.name; })[0];
            var hasStrokes = !!(lay && lay.strokes.length);
            return {
                cardId: card.id,
                name: card.name,
                orig_char_desc: tm.orig[card.id] || '',
                dest_char_desc: tm.dest[card.id] || '',
                mask: hasStrokes ? ('pending:' + card.id) : null
            };
        }).filter(Boolean);
    }

    function finishTag(ok) {
        if (!ok) {
            /* 脏确认：本次进入打标模式后画过笔画（undo 栈非空）才提示 */
            var drew = S.done && S.done.length > 0;
            if (drew && !window.confirm('有未确认的笔画改动，确定放弃？')) return;
        }
        var entries = ok ? tagEntries() : null;
        var tm = S.tagMode;
        /* v54：确认前兜底落盘（最后状态强制存草稿） */
        if (ok && S.state) saveTagStrokes();
        /* v55：全部停用后确认 = 回到无打标状态——清掉该点位 tagmask 草稿
         * （chars=[] 时旧的笔画草稿会残留，再进又看到遮罩层） */
        if (ok && entries && entries.length === 0) {
            try {
                localStorage.removeItem(tagMaskKey());
                localStorage.removeItem('av-' + tm.project + '-tagmask-' + tm.seg + '_' + tm.frame);
                dlog('tag: cleared drafts (all chars disabled)');
            } catch (e) { }
        }
        /* 退出 tagMode：清运行态 */
        S.tagMode = null;
        var dp = document.getElementById('imgTagDescPanel');
        if (dp) dp.remove();
        /* v53s：清层列表面板内联定位（placePanel 设置的 left/top 不残留到图片模式） */
        if (layersPanel) { layersPanel.style.left = ''; layersPanel.style.top = ''; layersPanel.style.bottom = ''; layersPanel.style.height = ''; layersPanel.style.position = ''; layersPanel.classList.remove('open'); }
        if (tagBarEl) tagBarEl.classList.remove('open');
        if (btnTagConfirm) btnTagConfirm.style.display = 'none';
        if (btnTagCancel) btnTagCancel.style.display = 'none';
        /* 恢复图片模式按钮（下次 open() 再按 meta 重算 showEmpty） */
        if (topEl) topEl.style.display = ''; /* v53m：横条恢复 */
        if (backBtnEl) backBtnEl.style.display = '';
        if (saveBtnEl) saveBtnEl.style.display = '';
        if (shareBtnEl) shareBtnEl.style.display = '';
        if (reloadBtnEl) reloadBtnEl.style.display = '';
        if (undoBarEl) undoBarEl.style.display = ''; /* v53d：撤销条恢复 */
        S.tagBarBuilt = false;
        /* v60b：清左上角确认条 */
        if (S.tagOkBarEl) { S.tagOkBarEl.remove(); S.tagOkBarEl = null; }
        /* 恢复图片工程状态（若有）：仅清槽位，下次 open() 重载 */
        S.meta = null; S.state = null; S.img = null; S.done = []; S.redo = [];
        page.classList.remove('open');
        page.style.display = 'none';
        /* v53t：tagMode 仅从视频工程进入——退出回视频页（avPage 一直 open，关掉
         * img page 自然露出）；不开 pjPage（那是图片工程 back() 的路由） */
        if (ok && tm.onDone) tm.onDone(entries);
        if (!ok && tm.onCancel) tm.onCancel();
    }

    function buildTagBar() {   /* v60b：底部中间组（层/当前层名/描述）+ 左上角确认取消 + 角色卡弹层选择 */
        if (S.tagBarBuilt) return;
        S.tagBarBuilt = true;
        var tm = S.tagMode;

        /* ---- 左上角：确认/取消 独立分组（fixed，不随 tagBar 拖拽） ---- */
        var okBar = el('div', 'img-dock img-tag-okbar');
        var gOk = el('div', 'img-grp');
        gOk.appendChild(el('span', 'ico', '✅'));
        gOk.appendChild(el('span', null, '确认'));
        gOk.addEventListener('click', function () { finishTag(true); });
        okBar.appendChild(gOk);
        var gNo = el('div', 'img-grp');
        gNo.appendChild(el('span', 'ico', '✖'));
        gNo.appendChild(el('span', null, '取消'));
        gNo.addEventListener('click', function () { finishTag(false); });
        okBar.appendChild(gNo);
        page.appendChild(okBar);
        okBar.classList.add('open');
        /* 位置：左上角安全区内 */
        okBar.style.position = 'fixed';
        okBar.style.top = '10px';
        okBar.style.left = '10px';   /* v60c：顶部停靠 */
        okBar.style.transform = 'none';   /* v60e: kill .img-dock translateY(-50%), bar half off-screen */
        try {
            var sa = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.MediaServer;
            /* safeArea 由 CSS env() 兜底，无需 JS 计算 */
        } catch (e) { }
        okBar.style.zIndex = '1601';
        S.tagOkBarEl = okBar;

        /* ---- 底部中间：层按钮 + 当前层名 + 描述按钮 ---- */
        tagBarEl = el('div', 'img-dock img-tagbar img-tagbar-bottom');

        /* 图层按钮 → 弹层列表（可编辑） */
        var gLay = el('div', 'img-grp');
        gLay.appendChild(el('span', 'ico', '🗂'));
        gLay.appendChild(el('span', null, '图层'));
        gLay.addEventListener('click', function () {
            renderLayersPanel();
            layersPanel.classList.toggle('open');
            if (layersPanel.classList.contains('open')) {
                layersPanel.style.position = 'fixed';
                layersPanel.style.bottom = 'auto';
                layersPanel.style.height = 'auto';
                layersPanel.style.left = '';
                layersPanel.style.top = '';
                placePanel(layersPanel, gLay);
            }
        });
        tagBarEl.appendChild(gLay);

        /* 当前遮罩层名（常显，随 activeId 同步） */
        var curName = el('span', 'img-tag-curlayer', tmTagCurLayerName());
        curName.id = 'imgTagCurLayerName';
        tagBarEl.appendChild(curName);

        /* 描述按钮 */
        var g3 = el('div', 'img-grp');
        g3.appendChild(el('span', 'ico', '📝'));
        g3.appendChild(el('span', null, '描述'));
        g3.addEventListener('click', function () {
            var card = tmTagActiveCard();
            if (!card) { toast('先选一个角色（点「角色」按钮）'); return; }
            switchTagLayer(card);
            toggleDescPanel(g3, card);
        });
        tagBarEl.appendChild(g3);

        /* 角色按钮（弹角色卡选择） */
        var gSel = el('div', 'img-grp');
        gSel.appendChild(el('span', 'ico', '🎭'));
        gSel.appendChild(el('span', null, '角色'));
        gSel.addEventListener('click', function () { openTagCardPicker(); });
        tagBarEl.appendChild(gSel);

        page.appendChild(tagBarEl);
        tagBarEl.classList.add('open');
        /* 底部中间停靠（CSS：left:50%;transform:translateX(-50%);bottom:安全距离） */
        tagBarEl.style.position = 'fixed';
        tagBarEl.style.bottom = '10px';   /* v60c：底部停靠 */
        tagBarEl.style.top = 'auto';
        tagBarEl.style.left = '50%';
        tagBarEl.style.right = 'auto';
        tagBarEl.style.transform = 'translateX(-50%)';
        tagBarEl.style.zIndex = '1600';
        S.tagPos = 'bottom-center';
    }

    /* ---- v60b helpers：当前层/卡 ---- */
    function tmTagCurLayerName() {
        var lay = (S.state && S.state.layers) ? S.state.layers.filter(function (l) { return l.id === S.state.activeId; })[0] : null;
        return lay ? lay.name : '（无遮罩层）';
    }
    function tmTagActiveCard() {
        var nm = tmTagCurLayerName();
        if (!S.tagMode) return null;
        return S.tagMode.cards.cards.filter(function (c) { return c.name === nm; })[0] || null;
    }
    function tmSyncCurLayerName() {
        var n = document.getElementById('imgTagCurLayerName');
        if (n) n.textContent = tmTagCurLayerName();
    }

    /* ---- v60b：角色卡选择弹层（头像+名字+搜索） ----
     * mode 'pick'：选中即建层激活（tagBar 角色）；mode 'add'：图层新增（卡名=层名）
     */
    function openTagCardPicker(mode, onPick) {
        var tm = S.tagMode;
        if (!tm) return;
        var mask = el('div', 'cgm-mask');
        var sheet = el('div', 'cgm-sheet open img-cardpicker');
        sheet.innerHTML =
            '<div class="cgm-card">' +
            '<div class="cgm-grab"></div>' +
            '<div class="cgm-head"><div class="ttl">' + (mode === 'add' ? '➕ 新建遮罩层 · 选角色卡' : '🎭 选择角色') + '</div><button class="cgm-x" data-x>✕</button></div>' +
            '<input class="img-cardpicker-search" placeholder="搜索角色…" />' +
            '<div class="cgm-body img-cardpicker-list"></div>' +
            '</div>';
        page.appendChild(sheet);
        var close = function () { sheet.classList.remove('open'); setTimeout(function () { sheet.remove(); }, 200); };
        sheet.querySelector('[data-x]').addEventListener('click', close);
        mask.addEventListener('click', close);
        sheet.insertBefore(mask, sheet.firstChild);

        var listEl = sheet.querySelector('.img-cardpicker-list');
        var searchEl = sheet.querySelector('.img-cardpicker-search');
        function render(q) {
            listEl.innerHTML = '';
            var cards = tm.cards.cards.filter(function (c) {
                return !q || c.name.indexOf(q) >= 0 || (c.tag && c.tag.indexOf(q) >= 0);
            });
            if (!cards.length) { listEl.appendChild(el('div', 'cgm-empty', '没有匹配的角色')); return; }
            cards.forEach(function (c) {
                var row = el('div', 'img-cardpicker-row');
                var av = el('span', 'img-cardpicker-ava');
                if (c.img) { var im = document.createElement('img'); im.src = c.img; av.appendChild(im); }
                else { av.textContent = c.name.charAt(0); av.classList.add('ph'); }
                row.appendChild(av);
                row.appendChild(el('span', 'img-cardpicker-name', c.name + (c.tag ? ' · ' + c.tag : '')));
                row.addEventListener('click', function () {
                    close();
                    if (onPick) { onPick(c); return; }
                    /* 默认：选中即建/切层激活 */
                    switchTagLayer(c);
                    tmSyncCurLayerName();
                    toast('已选中「' + c.name + '」，画区域即遮罩');
                });
                listEl.appendChild(row);
            });
        }
        searchEl.addEventListener('input', function () { render(searchEl.value.trim()); });
        render('');
    }

    function applyTagPos(edge) {
        if (!tagBarEl) return;
        tagBarEl.classList.remove('img-dock-left', 'img-dock-right', 'img-dock-top', 'img-dock-bottom', 'img-tagbar-top');
        /* v53q：非 free 吸附时清掉内联坐标（inline 优先级高于 class，残留会把栏钉在旧位置） */
        if (edge !== 'free') {
            tagBarEl.style.left = '';
            tagBarEl.style.top = '';
            tagBarEl.style.right = '';
            tagBarEl.style.bottom = '';
        }
        if (edge === 'top') { tagBarEl.classList.add('img-dock-top', 'img-tagbar-top'); return; }
        if (edge !== 'free') tagBarEl.classList.add('img-dock-' + edge);
    }

    /* 描述弹出面板（一次创建，反复开关） */
    function toggleDescPanel(anchorBtn, card) {
        var panel = document.getElementById('imgTagDescPanel');
        if (panel) { panel.remove(); return; }
        panel = el('div', 'img-tag-desc-panel');
        panel.id = 'imgTagDescPanel';
        var tm = S.tagMode;

        panel.appendChild(el('div', 'img-tag-desc-title', '原角色描述（' + card.name + '）'));
        var origSel = el('select', 'img-tagbar-select');
        var o0 = el('option'); o0.value = ''; o0.textContent = '（不填）';
        origSel.appendChild(o0);
        /* v59：词库分组取词（descGroups），原/替描述不再绑卡 */
        window.CC.wordsOf(tm.cards, '原角色描述').forEach(function (d) { var o = el('option'); o.value = d; o.textContent = d; origSel.appendChild(o); });
        origSel.value = tm.orig[card.id] || '';
        panel.appendChild(origSel);
        var origIn = el('input', 'img-tag-in');
        origIn.placeholder = '或自由输入';
        origIn.value = tm.orig[card.id] || '';
        panel.appendChild(origIn);
        origSel.addEventListener('change', function () { origIn.value = origSel.value; tm.orig[card.id] = origSel.value; saveTagStrokes(); });
        origIn.addEventListener('input', function () { tm.orig[card.id] = origIn.value; });

        panel.appendChild(el('div', 'img-tag-desc-title', '替换角色描述（' + card.name + '）'));
        var destSel = el('select', 'img-tagbar-select');
        var d0 = el('option'); d0.value = ''; d0.textContent = '（不填）';
        destSel.appendChild(d0);
        window.CC.wordsOf(tm.cards, '替换角色描述').forEach(function (d) { var o = el('option'); o.value = d; o.textContent = d; destSel.appendChild(o); });
        destSel.value = tm.dest[card.id] || '';
        panel.appendChild(destSel);
        var destIn = el('input', 'img-tag-in');
        destIn.placeholder = '或自由输入';
        destIn.value = tm.dest[card.id] || '';
        panel.appendChild(destIn);
        destSel.addEventListener('change', function () { destIn.value = destSel.value; tm.dest[card.id] = destSel.value; saveTagStrokes(); });
        destIn.addEventListener('input', function () { tm.dest[card.id] = destIn.value; });

        page.appendChild(panel);
        /* v53h：描述面板定位在按钮上方水平居中（placePanel 左弹出在屏左会出屏） */
        var r = anchorBtn.getBoundingClientRect();
        requestAnimationFrame(function () {
            var w = panel.offsetWidth || 280;
            var left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
            var top = Math.max(8, r.top - panel.offsetHeight - 10);
            panel.style.left = left + 'px';
            panel.style.top = top + 'px';
        });
    }

    function syncDescInputs(card) {
        /* 描述面板开着时同步清空值 */
        var panel = document.getElementById('imgTagDescPanel');
        if (!panel) return;
        var ins = panel.querySelectorAll('input');
        if (ins[0]) ins[0].value = S.tagMode.orig[card.id] || '';
        if (ins[1]) ins[1].value = S.tagMode.dest[card.id] || '';
    }

    function enableChar(c) {
        if (tm_enabledHas(c.id)) return;
        S.tagMode.enabled.push(c.id);
    }
    function tm_enabledHas(id) {
        return S.tagMode.enabled.indexOf(id) >= 0;
    }

    function curTagCard() {
        /* 当前活动层对应的卡（层名=角色名） */
        var lay = (S.state && S.state.layers) ? S.state.layers.filter(function (l) { return l.id === S.state.activeId; })[0] : null;
        if (!lay) return null;
        return S.tagMode.cards.cards.filter(function (c) { return c.name === lay.name; })[0] || null;
    }

    function setCurDesc(kind, val) {
        var c = curTagCard();
        if (!c) return;
        S.tagMode[kind][c.id] = val;
    }

    function switchTagLayer(card) {
        /* 建/切角色层（层名=角色名）；载入该角色已存描述 */
        if (!S.state) { dlog('switchTagLayer: no state, skip'); return; }
        var lay = S.state.layers.filter(function (l) { return l.name === card.name; })[0];
        if (!lay) {
            lay = { id: 'L' + Date.now().toString(36), name: card.name, visible: true, strokes: [] };
            S.state.layers.push(lay);
        }
        S.state.activeId = lay.id;
        /* v60b：单一事实源=activeId（无下拉派生视图），层名显示由 tmSyncCurLayerName 同步 */
        S.tagMode.orig[card.id] = S.tagMode.orig[card.id] || '';
        S.tagMode.dest[card.id] = S.tagMode.dest[card.id] || '';
        redrawMask(); updateUndoState(); saveTagStrokes();
    }

    function openTagMode(ctx) {
        try {
            build();
            /* 退出普通图片会话的残留 */
            S.meta = null; S.done = []; S.redo = []; S.live = null;
            S.project = ctx.project;
            S.tagMode = {
                project: ctx.project, seg: ctx.seg, frame: ctx.frame, at: ctx.at, kind: ctx.kind,
                existing: ctx.existing || null, cards: ctx.cards,
                onDone: ctx.onDone, onCancel: ctx.onCancel,
                enabled: (ctx.existing && ctx.existing.chars || []).map(function (c) { return c.cardId; }),
                orig: {}, dest: {}
            };
            /* 既有描述快照回填 */
            (ctx.existing && ctx.existing.chars || []).forEach(function (c) {
                S.tagMode.orig[c.cardId] = c.orig_char_desc || '';
                S.tagMode.dest[c.cardId] = c.dest_char_desc || '';
            });
            /* 底图 = 帧截图 canvas */
            S.img = ctx.frameCanvas;
            S.imgW = ctx.frameCanvas.width;
            S.imgH = ctx.frameCanvas.height;
            /* v53b：帧图铺底（loadImageFromBytes 同款三件套），否则白屏 */
            baseCv.width = S.imgW; baseCv.height = S.imgH;
            maskCv.width = S.imgW; maskCv.height = S.imgH;
            bctx.clearRect(0, 0, S.imgW, S.imgH);
            bctx.drawImage(ctx.frameCanvas, 0, 0);
            dlog('tagmode frameCanvas ' + S.imgW + 'x' + S.imgH + ' key=' + (S.tagMode.existing ? S.tagMode.existing.id : S.tagMode.seg + '_' + S.tagMode.frame));
            /* 层：existing 优先读 tagmask 草稿，否则按既有 chars 建层 */
            var draft = loadTagStrokes();
            if (draft) {
                S.state = { schema: 'moyutai.imgmask.v2', layers: draft.layers, activeId: draft.activeId };
                /* v53v：草稿恢复后同步角色下拉到激活层对应角色（上次编辑状态可见） */
                /* v55b：恢复后无条件对齐第一个遮罩层——activeId（层高亮）、
                 * 下拉选中、画笔落层三者永远同一个角色 */
                if (S.state.layers.length) S.state.activeId = S.state.layers[0].id;
                var actLay = S.state.layers[0] || null;
                var actCard = actLay ? S.tagMode.cards.cards.filter(function (c) { return c.name === actLay.name; })[0] : null;
                if (actCard) switchTagLayer(actCard);
                /* v53x：草稿恢复后重绘遮罩画布（此前只恢复数据不重绘，画面上看不到已画笔画） */
                redrawMask();
                updateUndoState();
                dlog('tagmode draft restored layers=' + S.state.layers.length + ' active=' + (actLay ? actLay.name : 'none') + ' strokes=' + S.state.layers.reduce(function (n, l) { return n + l.strokes.length; }, 0));
            } else {
                S.state = { schema: 'moyutai.imgmask.v2', layers: [], activeId: null };
                (ctx.existing && ctx.existing.chars || []).forEach(function (c) {
                    S.state.layers.push({ id: 'l' + c.cardId.slice(2, 10), name: c.name, visible: true, strokes: [] });
                });
                S.state.activeId = S.state.layers.length ? S.state.layers[0].id : null;
            }
            S.dirty = false;
            S.tool = 'pan';
            setTool('pan');
            titleEl.textContent = ctx.project + ' · 角色打标 · 第 ' + (ctx.frame + 1) + ' 帧';
            showEmpty(false);
            /* v53b：顶栏切到打标模式（图片模式按钮全藏，返回/保存/分享/换图） */
            if (topEl) topEl.style.display = 'none'; /* v53m：横条整体隐藏（功能已收进停靠栏） */
            if (backBtnEl) backBtnEl.style.display = 'none';
            if (saveBtnEl) saveBtnEl.style.display = 'none';
            if (shareBtnEl) shareBtnEl.style.display = 'none';
            if (reloadBtnEl) reloadBtnEl.style.display = 'none';
            if (btnTagConfirm) btnTagConfirm.style.display = '';
            if (btnTagCancel) btnTagCancel.style.display = '';
            page.classList.add('open');
            page.style.position = 'fixed';
            page.style.inset = '0';
            page.style.zIndex = '1550';
            page.style.display = 'flex';
            applySafeArea();
            fitView();
            redrawMask();
            updateUndoState();
            buildTagBar();
            /* 顶部确认/取消替换返回键 */
            backBtnEl.style.display = 'none';
            btnTagConfirm.style.display = '';
            btnTagCancel.style.display = '';
            /* 默认激活：仅本次没有恢复出遮罩层时才选第一个启用角色；
             * 有层时 activeId 已是事实源（草稿第一层），只把下拉回写成同一角色。
             * （v55b 只在下拉写了值，被这段无条件 switchTagLayer 覆盖回 enabled[0]） */
            /* v60b：有层则高亮第一层；无层等「角色」按钮选择 */
            if (S.state.layers.length) {
                var al = S.state.layers.filter(function (l) { return l.id === S.state.activeId; })[0] || S.state.layers[0];
                S.state.activeId = al.id;
            }
            tmSyncCurLayerName();
            hint('打标：点「角色」选人建层，画区域即遮罩；📝 填描述');
        } catch (e) {
            toast('打标打开失败：' + (e && e.message || e), true);
            dlog('openTagMode error: ' + (e && e.stack || e));
        }
    }

    /* v53 M5：给定层结构 + 尺寸 → 白区透底 canvas（与 buildLayerCanvas 同语义，
     * 但不依赖 S：供视频导出时栅格化打标遮罩）。layerName 匹配层名或层 id。 */
    function renderTagMaskCanvas(layers, w, h, layerName) {
        var lay = layers.filter(function (l) { return l.name === layerName; })[0]
            || layers.filter(function (l) { return l.id === layerName; })[0];
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        if (!lay) return c;
        /* v56b：黑底不透明 + 形状抠穿（ComfyUI LoadImage 蒙版 = alpha 反相）。
         * 老板 01:40 导出实测 v56 只生效一半：drawStrokes 内部每笔按 erase
         * 重置 composite（这是画布引擎需要），外层的 destination-out 被覆盖，
         * 结果黑底+白形。改为离屏画白形 → 一次 drawImage(destination-out) 抠穿，
         * 不依赖笔画引擎的 composite 状态。 */
        var off = document.createElement('canvas');
        off.width = w; off.height = h;
        var og = off.getContext('2d');
        og.lineCap = 'round'; og.lineJoin = 'round';
        og.fillStyle = '#fff'; og.strokeStyle = '#fff';
        drawStrokes(og, lay.strokes);
        /* v57c：形状为空（层无有效笔画）→ 返回空白 canvas 并打标记，
         * av-ui 侧据此跳过该条目，防「纯黑遮罩」混进导出包 */
        if (!lay.strokes.length) return c;
        var g = c.getContext('2d');
        g.fillStyle = '#000';
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'destination-out';
        g.drawImage(off, 0, 0);
        g.globalCompositeOperation = 'source-over';
        return c;
    }

    function canvasToPngU8(canvas) {
        var b64 = canvas.toDataURL('image/png').split(',')[1];
        var bin = atob(b64);
        var u8 = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return u8;
    }

window.__img = {
        open: open,
        openTagMode: openTagMode,
        renderTagMaskCanvas: renderTagMaskCanvas,
        canvasToPngU8: canvasToPngU8,
        back: back,
        state: function () {
            return {
                project: S.project, mode: 'image',
                hasImage: !!S.img, imgW: S.imgW, imgH: S.imgH,
                layers: S.state.layers.length,
                activeId: S.state.activeId,
                activeName: curLayer() ? curLayer().name : null,
                activeStrokes: curLayer() ? curLayer().strokes.length : 0,
                totalStrokes: S.state.layers.reduce(function (a, l) { return a + l.strokes.length; }, 0),
                done: S.done.length, redo: S.redo.length,
                invert: S.invert, tool: S.tool, size: S.size,
                scale: S.scale, dirty: S.dirty
            };
        },
        _setTool: setTool,
        _undo: undo,
        _redo: redo,
        _pickImage: pickImage,
        /* v50 图层 API（探针与后续弹窗复用） */
        _layers: function () { return JSON.parse(JSON.stringify(S.state.layers)); },
        _addLayer: function (name) {
            var id = OPS.newId(S.state);
            var nm = OPS.sanitizeName(name || ('遮罩 ' + S.state.layers.length), []);
            return applyAndPush({ kind: 'addLayer', layer: { id: id, name: nm, visible: true, strokes: [] }, at: S.state.layers.length });
        },
        _delLayer: function (id) {
            var op = OPS.makeDelLayer(S.state, id || S.state.activeId);
            return op ? applyAndPush(op) : false;
        },
        _renameLayer: function (id, name) {
            return applyAndPush({ kind: 'renameLayer', layerId: id || S.state.activeId, name: String(name || '') });
        },
        _toggleLayer: function (id) {
            return applyAndPush({ kind: 'toggleVisible', layerId: id || S.state.activeId });
        },
        _saveNow: function () { saveAll(true); },
        _activateLayer: function (id) {
            var l = OPS.layerById(S.state, id);
            if (!l) return false;
            S.state.activeId = id;
            renderLayersPanel();
            return true;
        },
        _exportCanvas: function () {
            /* 探针用：返回导出画布，不触发分享 */
            var mc = document.createElement('canvas');
            mc.width = S.imgW; mc.height = S.imgH;
            drawMaskInto(mc.getContext('2d'), { alpha: 1, showAids: false });
            var c = document.createElement('canvas');
            c.width = S.imgW; c.height = S.imgH;
            var g = c.getContext('2d');
            g.drawImage(S.img, 0, 0);
            g.globalCompositeOperation = 'destination-out';
            g.drawImage(mc, 0, 0);
            return c;
        }
    };
})();
