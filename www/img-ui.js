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
    var dlog = function () { try { console.log.apply(console, ['[img]'].concat([].slice.call(arguments))); } catch (e) { } };

    if (!L) { console.error('[img] img-store.js 未加载'); return; }
    if (!OPS) { console.error('[img] img-ops.js 未加载'); return; }

    /* ---------- 样式（内嵌注入，v45i 同款自愈模式） ---------- */

    var IMG_CSS = [
"/* 摸鱼台 v49 —— 图片工作台样式（自原型 image-mode-proto.html 移植） */",
".img-page{position:fixed;inset:0;display:none;flex-direction:column;background:#1a1d21;z-index:1550}",
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
"  display:flex;flex-direction:column;gap:.45rem;z-index:70}",
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
".img-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;",
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
".img-layer-row.active{background:rgba(255,140,60,.22);outline:1px solid rgba(255,160,80,.55)}",
".img-layer-eye{font-size:15px;line-height:1;opacity:.55;flex:none;cursor:pointer}",
".img-layer-eye.on{opacity:1}",
".img-layer-name{font-size:13px;color:#eee;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"
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
        dirty: false
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
        undoGrp.classList.toggle('on', S.done.length > 0);
        redoGrp.classList.toggle('on', S.redo.length > 0);
    }

    /* ---------- op 化撤销（v50）----------
     * S.done: 已应用 op 栈；undo 取逆应用，redo 重应用。
     * 笔画 op 的逆需要被弹出的笔画本体，存在 op.popped 里。 */
    function applyAndPush(op) {
        if (!OPS.applyOp(S.state, op)) return false;
        S.done.push(op);
        S.redo = [];
        S.dirty = true;
        saveAll(false);
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
        S.dirty = true;
        saveAll(false);
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
        S.dirty = true;
        saveAll(false);
        redrawMask();
        updateUndoState();
        renderLayersPanel();
    }

    function saveAll(explicit) {
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

    function closePanels() {
        drawPanel.classList.remove('open');
        erasePanel.classList.remove('open');
        if (layersPanel) layersPanel.classList.remove('open');
        drawGrp.classList.remove('on');
        eraseGrp.classList.remove('on');
        if (layersGrp) layersGrp.classList.remove('on');
    }

    /* ---------- 图层面板（v50） ---------- */

    function renderLayersPanel() {
        if (!layersListEl || !S.state) return;
        layersListEl.textContent = '';
        /* 列表顺序：上=顶层（数组尾）。显示开关点击不改变激活层；单击名称激活。 */
        S.state.layers.slice().reverse().forEach(function (lay) {
            var row = el('div', 'img-layer-row' + (lay.id === S.state.activeId ? ' active' : ''));

            var eye = el('span', 'img-layer-eye' + (lay.visible ? ' on' : ''), lay.visible ? '👁' : '🚫');
            eye.title = lay.visible ? '点击隐藏' : '点击显示';
            eye.addEventListener('click', function (e) {
                e.stopPropagation();
                applyAndPush({ kind: 'toggleVisible', layerId: lay.id });
            });
            row.appendChild(eye);

            var nm = el('span', 'img-layer-name', lay.name +
                (lay.strokes.length ? ' (' + lay.strokes.length + ')' : ''));
            nm.title = '点击激活此层进行编辑';
            nm.addEventListener('click', function () {
                if (S.state.activeId !== lay.id) {
                    S.state.activeId = lay.id;   // 切换激活不是编辑动作，不入撤销栈
                    renderLayersPanel();
                    hint('已激活「' + lay.name + '」');
                }
            });
            row.appendChild(nm);

            layersListEl.appendChild(row);
        });
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
        var shareBtn = el('button', 'img-top-btn primary', '📤 分享');
        shareBtn.addEventListener('click', showShareDialog);
        topEl.appendChild(shareBtn);
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

        undoGrp = el('div', 'img-grp');
        undoGrp.appendChild(el('span', 'ico', '↩️'));
        undoGrp.appendChild(el('span', null, '撤销'));
        undoGrp.addEventListener('click', undo);
        dockEl.appendChild(undoGrp);

        redoGrp = el('div', 'img-grp');
        redoGrp.appendChild(el('span', 'ico', '↪️'));
        redoGrp.appendChild(el('span', null, '重做'));
        redoGrp.addEventListener('click', redo);
        dockEl.appendChild(redoGrp);

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
        var addBtn = el('button', 'img-sub-btn', '➕'); addBtn.title = '新建图层';
        var delBtn = el('button', 'img-sub-btn', '🗑'); delBtn.title = '删除当前图层';
        var renBtn = el('button', 'img-sub-btn', '✏️'); renBtn.title = '重命名当前图层';
        addBtn.addEventListener('click', function () {
            var nm = '遮罩 ' + (S.state.layers.length + 1);
            if (applyAndPush({ kind: 'addLayer', layer: { id: OPS.newId(S.state), name: nm, visible: true, strokes: [] }, at: S.state.layers.length })) {
                hint('已新建「' + nm + '」并激活');
            }
        });
        delBtn.addEventListener('click', function () {
            var lay = curLayer();
            if (S.state.layers.length <= 1) { hint('至少要保留一个图层', true); return; }
            if (!confirm('删除图层「' + lay.name + '」及其全部笔画？')) return;
            var op = OPS.makeDelLayer(S.state, lay.id);
            if (op && applyAndPush(op)) hint('已删除「' + lay.name + '」');
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
            S.dirty = true;
            saveAll(false);
            redrawMask();
            hint(S.invert ? '已反选：画的是「保留」区域' : '已取消反选');
        });

        hintEl = el('div', 'img-hint');
        page.appendChild(hintEl);

        document.body.appendChild(page);
        bindStageEvents();

        window.addEventListener('resize', function () {
            if (page.classList.contains('open') && S.img) fitView();
        });
        // 旋转/窗口变化后重读安全区（与 av-ui 同策略）
        var reapply = function () { if (page.classList.contains('open')) applySafeArea(); };
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
        dlog('back() project=' + S.project);
        saveAll(false);
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

    window.__img = {
        open: open,
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
