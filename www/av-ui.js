/* 摸鱼台 v45 —— AV 工作台 UI 层（视频工程 P2）
 *
 * 对齐 r6 定稿原型（原型决议表 F1~J2 全条）：
 *   左 30% 文件列表（可收起）+ 右 70% 播放区（横屏为主，竖屏侧栏变抽屉）
 *   悬浮半透明控件层（层 0.25/blur4、按钮 0.38+文字投影，J2）
 *   点画面隐藏/恢复全部编辑层（G2，含顶栏/列表/控件层）
 *   ✂ 分割点（游标命中 ±半帧 内变「移除」，F2；一切判断帧精确，G1）
 *   ⤴ 并入前段 = 片段级开关，标记固定片段开头（F1）
 *   ▦ 多帧参考（F3）
 *   步进组：◀ 值 ▶（视频默认 1 帧，fps 自动估算 rVFC + 手动修正 Q4）
 *   播放条左上角当前帧/秒（两位小数，R9）
 *   💾 保存（只存编辑状态）/ 📤 导出 JSON（降序，schema moyutai.marks.v1）
 *
 * 原生：MediaServerPlugin（SAF 选目录 + 本地 Range 流服务器）
 * 依赖：av-store.js（window.__avLogic）
 */
(function () {
    'use strict';

    var L = window.__avLogic;
    if (!L) { console.error('[av] __avLogic 未加载'); return; }

    /* ---------- 原生桥 ---------- */

    function ms() {
        var cap = window.Capacitor;
        return (cap && cap.Plugins && cap.Plugins.MediaServer) || null;
    }
    function savePlug() {
        var cap = window.Capacitor;
        return (cap && cap.Plugins && cap.Plugins.SaveImage) || null;
    }

    /* ---------- 状态 ---------- */

    var S = {
        project: null,       // 工程名
        meta: null,          // L.loadMeta()
        marks: null,         // L.loadMarks()
        files: [],           // 清单 [{name,seq,label,size,docId}]
        cur: -1,             // 当前文件索引
        serverPort: 0,       // 本地流端口
        fps: null,           // 有效 fps（meta.fps）
        fpsSampling: false,
        vfcSamples: [],
        vfcT0: 0,
        immersive: false,
        built: false
    };

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

    /* ---------- DOM ---------- */

    var page, topEl, sideEl, listEl, sideHeadEl, mainEl, videoEl, stageHit,
        ovlEl, btnPrev, btnNext, btnSplit, btnMerge, btnMulti, stepVal,
        fpsBox, posEl, tlEl, tlCur, tlDur, tlRange, ticksEl, handleEl,
        audioCv, emptyHint, toastTimer = null;

    function toast(msg) {
        var t = document.querySelector('.pj-toast');
        if (!t) { t = el('div', 'pj-toast'); document.body.appendChild(t); }
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
    }

    function build() {
        if (S.built) return;
        S.built = true;

        page = el('div', 'av-page');
        page.id = 'avPage';

        // 顶栏
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

        // 主体：左列表 + 右播放
        var body = el('div', 'av-body');
        page.appendChild(body);

        sideEl = el('div', 'av-side');
        sideHeadEl = el('div', 'av-side-head');
        var loadBtn = el('button', 'av-side-load', '📂 加载文件夹');
        loadBtn.addEventListener('click', pickFolder);
        sideHeadEl.appendChild(loadBtn);
        var collapse = el('button', 'av-side-coll', '◀');
        collapse.addEventListener('click', function () { setSide(false); });
        sideHeadEl.appendChild(collapse);
        sideEl.appendChild(sideHeadEl);
        listEl = el('div', 'av-list');
        sideEl.appendChild(listEl);
        body.appendChild(sideEl);

        handleEl = el('button', 'av-handle', '▶');
        handleEl.addEventListener('click', function () { setSide(true); });
        page.appendChild(handleEl);

        mainEl = el('div', 'av-main');
        body.appendChild(mainEl);

        videoEl = el('video', 'av-video');
        videoEl.setAttribute('playsinline', '');
        videoEl.setAttribute('preload', 'auto');
        videoEl.crossOrigin = 'anonymous';
        mainEl.appendChild(videoEl);

        audioCv = el('canvas', 'av-audio');
        mainEl.appendChild(audioCv);

        emptyHint = el('div', 'av-empty', '先「📂 加载文件夹」\n或返回新建视频工程时选目录');
        mainEl.appendChild(emptyHint);

        // 点画面层（G2）：盖住视频区，点击切换沉浸
        stageHit = el('div', 'av-stage-hit');
        mainEl.appendChild(stageHit);
        stageHit.addEventListener('click', function () { setImmersive(!S.immersive); });

        // 悬浮控件层（J2 透明度定稿）
        ovlEl = el('div', 'av-ovl');
        var row1 = el('div', 'av-ovl-row');
        btnPrev = el('button', 'av-ovl-btn', '◀ 上一条');
        btnPrev.addEventListener('click', function () { stepFile(-1); });
        row1.appendChild(btnPrev);
        btnNext = el('button', 'av-ovl-btn', '下一条 ▶');
        btnNext.addEventListener('click', function () { stepFile(1); });
        row1.appendChild(btnNext);
        var sp = el('i', 'av-ovl-gap');
        row1.appendChild(sp);
        btnSplit = el('button', 'av-ovl-btn av-accent', '✂ 分割点');
        btnSplit.addEventListener('click', markSplit);
        row1.appendChild(btnSplit);
        btnMerge = el('button', 'av-ovl-btn', '⤴ 并入前段');
        btnMerge.addEventListener('click', toggleMerge);
        row1.appendChild(btnMerge);
        btnMulti = el('button', 'av-ovl-btn', '▦ 多帧');
        btnMulti.addEventListener('click', toggleMulti);
        row1.appendChild(btnMulti);
        ovlEl.appendChild(row1);

        var row2 = el('div', 'av-ovl-row');
        var stL = el('button', 'av-ovl-btn av-sq', '◀');
        stL.addEventListener('click', function () { stepTime(-1); });
        row2.appendChild(stL);
        stepVal = el('input', 'av-ovl-input');
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
        row2.appendChild(stepVal);
        var stR = el('button', 'av-ovl-btn av-sq', '▶');
        stR.addEventListener('click', function () { stepTime(1); });
        row2.appendChild(stR);
        var fpsWrap = el('label', 'av-ovl-fps', 'fps');
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
            }
        });
        fpsWrap.appendChild(fpsBox);
        row2.appendChild(fpsWrap);
        posEl = el('div', 'av-ovl-pos', '帧 -- · 0.00s');
        row2.appendChild(posEl);
        ovlEl.appendChild(row2);
        mainEl.appendChild(ovlEl);

        // 播放条（时间轴 + 标记刻度）
        tlEl = el('div', 'av-tl');
        tlCur = el('div', 'av-tl-cur', '0.00');
        tlDur = el('div', 'av-tl-dur', '0.00');
        tlRange = el('input', 'av-tl-range');
        tlRange.type = 'range';
        tlRange.min = '0';
        tlRange.max = '1000';
        tlRange.value = '0';
        tlRange.addEventListener('input', function () {
            if (!isFinite(videoEl.duration)) return;
            var t = (parseFloat(tlRange.value) / 1000) * videoEl.duration;
            videoEl.currentTime = t;
            renderPos();
        });
        ticksEl = el('div', 'av-tl-ticks');
        tlEl.appendChild(tlCur);
        tlEl.appendChild(tlRange);
        tlEl.appendChild(tlDur);
        var tlWrap = el('div', 'av-tl-wrap');
        tlWrap.appendChild(ticksEl);
        tlWrap.appendChild(tlEl);
        mainEl.appendChild(tlWrap);

        document.body.appendChild(page);

        videoEl.addEventListener('timeupdate', renderPos);
        videoEl.addEventListener('loadedmetadata', function () {
            tlDur.textContent = fmt2(videoEl.duration || 0);
            renderPos();
        });
        videoEl.addEventListener('ended', function () { renderPos(); });
        // fps 采样：rVFC 播放 1 秒取中位帧间隔（Q4 自动估算）
        if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
            videoEl.addEventListener('play', startFpsSample);
        }
    }

    /* ---------- fps 估算（rVFC 采样 1s，取中位间隔就近吸附常见帧率） ---------- */

    var COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];

    function startFpsSample() {
        if (S.meta.fpsSource === 'manual' && S.meta.fps) return;    // 手动值不覆盖
        if (S.fpsSampling) return;
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
        if (s.length < 4) return;                    // 样本太少（拖动/暂停），放弃
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
        if (bd / best < 0.06) {                      // 6% 内才算命中
            S.meta.fps = best;
            S.meta.fpsSource = 'auto';
            S.fps = best;
            saveAll(false);
            renderStepBox();
            renderPos();
            toast('已估算 fps=' + best + '（可手动修正）');
        }
    }

    /* ---------- 列表 / 侧栏 ---------- */

    function setSide(open) {
        sideEl.classList.toggle('closed', !open);
        handleEl.classList.toggle('show', !open);
    }

    function renderList() {
        listEl.innerHTML = '';
        S.files.forEach(function (f, i) {
            var card = el('div', 'av-item' + (i === S.cur ? ' on' : ''));
            var no = el('div', 'av-item-no', f.label);
            card.appendChild(no);
            var info = el('div', 'av-item-info');
            info.appendChild(el('div', 'av-item-name', f.name));
            info.appendChild(el('div', 'av-item-sub', fmtSize(f.size)));
            card.appendChild(info);
            if (hasMerge(f.label)) {
                var b = el('div', 'av-item-badge', '⤴');
                b.title = '并入前段';
                card.appendChild(b);
            }
            var nSplits = countSplits(f.label);
            if (nSplits) {
                var s = el('div', 'av-item-badge av-b-split', '✂' + nSplits);
                card.appendChild(s);
            }
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

    /* ---------- 文件夹加载 / 服务器 ---------- */

    function pickFolder() {
        var p = ms();
        if (!p) { toast('MediaServer 插件不可用（请用 APK）'); return; }
        p.pickFolder().then(function (r) {
            S.meta.folderUri = r.uri;
            S.meta.folderName = r.name || '';
            saveAll(false);
            return refreshFolder();
        }).catch(function (e) {
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
            if (!S.files.length) {
                toast('目录里没有' + (S.meta.mode === 'audio' ? '音频' : '视频') + '文件');
            }
            renderSideHead();
            return startServer();
        }).then(function () {
            renderList();
            if (S.cur < 0 && S.files.length) selectFile(0);
            else if (S.cur >= 0) playCurrent(true);
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
        if (p) p.stop().catch(function () { /* */ });
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
        var url = 'http://127.0.0.1:' + S.serverPort + '/' + encodeURIComponent(f.name);
        videoEl.src = url;
        videoEl.load();
        renderList();
        renderPos();
        if (!keepPaused) videoEl.play().catch(function () { /* 自动播放被拦：用户手动 */ });
    }

    /* ---------- 位置显示（R9：帧 + 两位小数秒） ---------- */

    function renderPos() {
        var t = videoEl.currentTime || 0;
        var d = videoEl.duration;
        if (isFinite(d) && d > 0) {
            tlRange.value = String(Math.round((t / d) * 1000));
        }
        tlCur.textContent = fmt2(t);
        if (S.meta.mode === 'video' && S.fps) {
            posEl.textContent = '帧 ' + (L.frameAt(t, S.fps) + 1) + ' · ' + fmt2(t) + 's';
        } else {
            posEl.textContent = fmt2(t) + 's';
        }
        renderTicks();
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
                    var t = L.secAtFrame(fr, S.fps || 25);
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

    /* ---------- 标记（F1/F2/F3/G1） ---------- */

    function markSplit() {
        if (S.cur < 0) return;
        var seg = curSeg();
        var t = videoEl.currentTime || 0;
        // F2：命中已有标记（±半帧）→ 变「移除」
        var snapped = L.snapT(t, S.marks.marks, S.fps);
        var hit = null;
        S.marks.marks.forEach(function (m) {
            if (m.type === 'split' && m.seg === seg && Math.abs(m.at - snapped) < 1e-9) hit = m;
        });
        if (hit) {
            S.marks.marks.splice(S.marks.marks.indexOf(hit), 1);
            toast('已移除分割点 @' + fmt2(hit.at) + 's');
        } else {
            // G1：帧精确归档
            var qt = S.fps ? L.quantize(t, 'video', S.fps, 0) : t;
            S.marks.marks.push({ id: 'm' + Date.now(), type: 'split', seg: seg, at: qt, note: '' });
            toast('✂ 分割点 @' + fmt2(qt) + 's' + (S.fps ? '（帧 ' + (L.frameAt(qt, S.fps) + 1) + '）' : ''));
        }
        saveAll(false);
        renderPos();
    }

    function toggleMerge() {
        if (S.cur < 0) return;
        var seg = curSeg();
        var exist = L.normalizeMerge(S.marks, seg);
        if (exist) {
            S.marks.marks.splice(S.marks.marks.indexOf(exist), 1);
            toast('已解除并入前段（' + seg + '）');
        } else {
            // F1：标记固定片段开头
            S.marks.marks.push({ id: 'm' + Date.now(), type: 'merge_prev', seg: seg, note: '' });
            toast('⤴ ' + seg + ' 并入前段（标记在片段开头）');
        }
        saveAll(false);
        renderList();
    }

    function toggleMulti() {
        if (S.cur < 0) return;
        if (!S.fps) { toast('fps 未就绪（播放 1 秒自动估算，或手动填）'); return; }
        var seg = curSeg();
        var fr = L.frameAt(videoEl.currentTime || 0, S.fps);
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
            toast('▦ 已移除参考帧 ' + (fr + 1));
        } else {
            mark.frames.push(fr);
            mark.frames.sort(function (a, b) { return a - b; });
            toast('▦ 参考帧 ' + (fr + 1) + '（共 ' + mark.frames.length + ' 个）');
        }
        saveAll(false);
        renderPos();
    }

    /* ---------- 步进（R8：视频 1 帧 / 音频 0.05s，值可改） ---------- */

    function stepTime(dir) {
        if (S.cur < 0) return;
        var st;
        if (S.meta.mode === 'video') {
            st = S.meta.stepVideo || 1;
            if (S.fps) st = st / S.fps;
            else st = 1 / 25;                        // fps 未就绪按 25 占位
        } else {
            st = S.meta.stepAudio || 0.05;
        }
        var t = (videoEl.currentTime || 0) + dir * st;
        if (t < 0) t = 0;
        if (isFinite(videoEl.duration) && t > videoEl.duration) t = videoEl.duration;
        // G1：步进落帧网格（视频）
        if (S.meta.mode === 'video' && S.fps) t = L.quantize(t, 'video', S.fps, 0);
        videoEl.currentTime = t;
        renderPos();
    }

    function renderStepBox() {
        stepVal.value = S.meta.mode === 'video' ? (S.meta.stepVideo || 1) : (S.meta.stepAudio || 0.05);
        fpsBox.value = S.fps ? String(S.fps) : '';
        fpsBox.placeholder = S.meta.fpsSource === 'auto' ? 'auto' : 'fps';
    }

    /* ---------- 沉浸（G2：点画面隐藏/恢复全部编辑层） ---------- */

    function setImmersive(on) {
        S.immersive = on;
        page.classList.toggle('imm', on);
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
        saveAll(false);
        stopServer();
        page.classList.remove('open');
        // 回工程列表（刷新 updatedAt/段数）
        var pj = document.getElementById('pjPage');
        if (pj) pj.classList.add('open');
        if (window.__projects && window.__projects.list) window.__projects.list();
    }

    /* ---------- 导出（R10，降序，schema v1） ---------- */

    function exportJson() {
        if (!S.project) return;
        var json = L.buildExport(S.meta, S.marks, S.files);
        var text = JSON.stringify(json, null, 2);
        var sp = savePlug();
        var name = 'marks-' + S.project.replace(/[\\/:*?"<>|]/g, '_') + '-' +
            new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '.json';
        if (sp && sp.shareFile) {
            // b64（文本小，直接 btoa）
            var b64 = btoa(unescape(encodeURIComponent(text)));
            sp.shareFile({ data: b64, filename: name, mime: 'application/json' })
                .then(function () { toast('已唤起分享，把 JSON 发给音视频助手'); })
                .catch(function (e) { toast('分享失败：' + (e && e.message || e)); });
        } else {
            // 桌面/无插件：下载兜底
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
        build();
        S.project = projectName;
        S.meta = L.loadMeta(projectName) || L.emptyMeta(projectName, 'video');
        S.marks = L.loadMarks(projectName);
        S.files = [];
        S.cur = -1;
        S.fps = S.meta.fps || null;
        S.immersive = false;
        page.classList.remove('imm');
        setSide(true);
        renderStepBox();
        renderSideHead();
        renderList();
        renderPos();
        page.classList.add('open');
        // 已授权目录：恢复列表（Q11 授权失效时 listFiles 报错 → 引导重选）
        if (S.meta.folderUri) {
            refreshFolder().catch(function (e) {
                emptyHint.style.display = 'block';
                toast('目录授权失效或不可读：请重新「📂 加载文件夹」');
            });
        } else {
            emptyHint.style.display = 'block';
        }
    }

    /* ---------- 调试钩子（探针用） ---------- */

    window.__av = {
        open: open,
        back: back,
        state: function () {
            return {
                project: S.project, mode: S.meta && S.meta.mode, files: S.files.length,
                cur: S.cur, fps: S.fps, port: S.serverPort, marks: S.marks && S.marks.marks.length,
                immersive: S.immersive, folderName: S.meta && S.meta.folderName
            };
        },
        marks: function () { return S.marks; },
        files: function () { return S.files; },
        _S: S,
        _setVideoTime: function (t) { videoEl.currentTime = t; renderPos(); },
        _setDuration: function (d) { Object.defineProperty(videoEl, 'duration', { value: d, configurable: true }); renderPos(); },
        _markSplit: markSplit,
        _toggleMerge: toggleMerge,
        _toggleMulti: toggleMulti,
        _stepTime: stepTime,
        _exportJson: function () { return L.buildExport(S.meta, S.marks, S.files); },
        _setFps: function (f) { S.meta.fps = f; S.fps = f; renderStepBox(); renderPos(); }
    };
})();
