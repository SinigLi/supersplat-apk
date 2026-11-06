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
    var dlog = function () { try { console.log.apply(console, ['[img]'].concat([].slice.call(arguments))); } catch (e) { } };

    if (!L) { console.error('[img] img-store.js 未加载'); return; }

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
".img-hint.err{background:rgba(140,30,30,.92)}"
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
        strokes: [],
        redo: [],
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
        g.fillStyle = 'rgba(' + rgb + ',' + alpha + ')';
        g.strokeStyle = 'rgba(' + rgb + ',' + alpha + ')';

        var all = S.strokes.slice();
        if (S.live) all.push(S.live);

        all.forEach(function (st) {
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

        /* 反选：先复制已画蒙版 → 铺满 → 把副本挖掉（等价于整图减已画区） */
        if (S.invert) {
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

        if (!showAids) { g.restore(); return; }

        /* 多边形拖动中：把已采样的点描一条高亮轮廓线，
         * 让用户看清自己正在圈哪里（填充是闭合预览，见上面的 polygon 分支）。 */
        if (S.live && S.live.type === 'polygon' && S.live.points.length > 1) {
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
        }
        g.restore();
    }

    function redrawMask() {
        mctx.clearRect(0, 0, maskCv.width, maskCv.height);
        /* alpha=1：同色不透明覆盖，笔画自我重叠不再累积加深。
         * 整体半透明由 .img-mask 的 CSS opacity 统一承担。 */
        drawMaskInto(mctx, { alpha: 1, rgb: '255,42,42', showAids: true });
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
        undoGrp.classList.toggle('on', S.strokes.length > 0);
        redoGrp.classList.toggle('on', S.redo.length > 0);
    }

    function pushStroke(st) {
        S.strokes.push(st);
        S.redo = [];
        S.dirty = true;
        saveStrokes();
        redrawMask();
        updateUndoState();
    }

    function undo() {
        if (!S.strokes.length) { hint('没有可撤销的操作'); return; }
        S.redo.push(S.strokes.pop());
        S.dirty = true;
        saveStrokes();
        redrawMask();
        updateUndoState();
    }

    function redo() {
        if (!S.redo.length) { hint('没有可重做的操作'); return; }
        S.strokes.push(S.redo.pop());
        S.dirty = true;
        saveStrokes();
        redrawMask();
        updateUndoState();
    }

    function saveStrokes() {
        L.saveStrokes(S.project, S.strokes);
        if (S.meta) { S.meta.invert = S.invert; L.saveMeta(S.meta); }
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
        drawGrp.classList.remove('on');
        eraseGrp.classList.remove('on');
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
        var saveBtn = el('button', 'img-top-btn', '💾 保存');
        saveBtn.addEventListener('click', function () { saveAll(true); });
        topEl.appendChild(saveBtn);
        var shareBtn = el('button', 'img-top-btn primary', '📤 分享');
        shareBtn.addEventListener('click', exportPng);
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
        page.appendChild(dockEl);

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
        btnClear.title = '清空遮罩';
        btnClear.addEventListener('click', function () {
            if (!S.strokes.length && !S.invert) { hint('遮罩已是空的'); return; }
            S.strokes = []; S.redo = [];
            S.dirty = true;
            saveStrokes();
            redrawMask(); updateUndoState();
            hint('已清空遮罩');
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
            saveStrokes();
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
    }

    /* ---------- 保存 / 返回 / 导出 ---------- */

    function saveAll(explicit) {
        try {
            saveStrokes();
            S.dirty = false;
            if (explicit) toast('已保存「' + S.project + '」（' + S.strokes.length + ' 笔）');
        } catch (e) {
            toast('保存失败：' + (e && e.message || e));
        }
    }

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
    async function exportPng() {
        if (!S.img) { hint('先导入图片', true); return; }
        try {
            var mc = document.createElement('canvas');
            mc.width = S.imgW; mc.height = S.imgH;
            var mg = mc.getContext('2d');
            drawMaskInto(mg, { alpha: 1, showAids: false });

            var c = document.createElement('canvas');
            c.width = S.imgW; c.height = S.imgH;
            var g = c.getContext('2d');
            g.drawImage(S.img, 0, 0);
            g.globalCompositeOperation = 'destination-out';
            g.drawImage(mc, 0, 0);
            g.globalCompositeOperation = 'source-over';

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
            S.strokes = L.loadStrokes(projectName).strokes.slice();
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
                    dlog('open ok strokes=' + S.strokes.length);
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
                strokes: S.strokes.length, redo: S.redo.length,
                invert: S.invert, tool: S.tool, size: S.size,
                scale: S.scale, dirty: S.dirty
            };
        },
        _setTool: setTool,
        _undo: undo,
        _redo: redo,
        _pickImage: pickImage,
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
