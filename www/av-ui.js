/* 摸鱼台 v45b —— AV 工作台 UI 层（视频工程 P2，真机反馈修复版）
 *
 * v45b 修复（2026-11-02 21:08 老板 6 条真机反馈）：
 *  1. 竖屏太挤 → 进入工作台强制横屏（screen.orientation.lock，返回时 unlock）
 *  2. 没有播放按钮 → 播放条加 ⏯（v45 漏实现，连锁根因：无播放则 rVFC 采不了 fps）
 *  3. 帧数显示异常 → fps 未估算时默认 25 显示帧数（不再只显示秒）
 *  4. 吸附异常/无状态标志 → 播放条点选吸附 ±半帧；分割/并入/多帧按钮游标命中变红「移除」态
 *  5. 多帧按钮无效 → 不再被 fps 阻塞（用有效 fps 默认 25）
 *  6. 布局乱 → 照抄 r6 定稿原型：一行工具行 + 一行播放条（⏮ ⏯ ⏭ 在进度条右侧）
 *
 * 继承 v45：清单/标记/导出逻辑在 av-store.js；原生 MediaServerPlugin 流播放。
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
        project: null,
        meta: null,
        marks: null,
        files: [],
        cur: -1,
        serverPort: 0,
        fps: null,           // 有效估算值；null 时 effFps() 兜底 25
        fpsSampling: false,
        vfcSamples: [],
        vfcT0: 0,
        immersive: false,
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

    /* ---------- DOM ---------- */

    var page, topEl, sideEl, listEl, mainEl, videoEl, stageHit,
        ovlEl, btnSplit, btnMerge, btnMulti, stepVal, fpsBox,
        tlWrap, posEl, tlRange, ticksEl, btnPlay, btnPrev, btnNext,
        audioCv, emptyHint, handleEl, toastTimer = null;

    function toast(msg) {
        var t = document.querySelector('.pj-toast');
        if (!t) { t = el('div', 'pj-toast'); document.body.appendChild(t); }
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
    }

    /* ---------- 横屏锁定（反馈 #1：原生 Activity 级保证，JS API 兑底） ---------- */

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

    function build() {
        if (S.built) return;
        S.built = true;

        page = el('div', 'av-page');
        page.id = 'avPage';

        // 顶栏（G2 沉浸时隐藏）
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

        var body = el('div', 'av-body');
        page.appendChild(body);

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
        body.appendChild(sideEl);

        handleEl = el('button', 'av-handle', '▶');
        handleEl.addEventListener('click', function () { setSide(true); });
        page.appendChild(handleEl);

        // 右播放区
        mainEl = el('div', 'av-main');
        body.appendChild(mainEl);

        videoEl = el('video', 'av-video');
        videoEl.setAttribute('playsinline', '');
        videoEl.setAttribute('preload', 'auto');
        mainEl.appendChild(videoEl);

        audioCv = el('canvas', 'av-audio');
        mainEl.appendChild(audioCv);

        emptyHint = el('div', 'av-empty', '先「📂 加载文件夹」');
        mainEl.appendChild(emptyHint);

        // 点画面层（G2）
        stageHit = el('div', 'av-stage-hit');
        mainEl.appendChild(stageHit);
        stageHit.addEventListener('click', function () { setImmersive(!S.immersive); });

        // ===== 工具行（反馈 #6：照抄 r6 原型 v-tools 一行） =====
        // ✂ 分割点 | ⤴ 并入前段 | ▦ 多帧点 | ◀ [1帧] ▶ | [fps]
        ovlEl = el('div', 'av-ovl');
        var row = el('div', 'av-ovl-row');
        btnSplit = el('button', 'av-ovl-btn av-accent', '✂ 分割点');
        btnSplit.addEventListener('click', markSplit);
        row.appendChild(btnSplit);
        btnMerge = el('button', 'av-ovl-btn', '⤴ 并入前段');
        btnMerge.addEventListener('click', toggleMerge);
        row.appendChild(btnMerge);
        btnMulti = el('button', 'av-ovl-btn av-multi', '▦ 多帧点');
        btnMulti.addEventListener('click', toggleMulti);
        row.appendChild(btnMulti);

        var gap = el('i', 'av-ovl-gap');
        row.appendChild(gap);

        var stL = el('button', 'av-ovl-btn av-sq', '◀');
        stL.addEventListener('click', function () { stepTime(-1); });
        row.appendChild(stL);
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
        row.appendChild(stepVal);
        var stR = el('button', 'av-ovl-btn av-sq', '▶');
        stR.addEventListener('click', function () { stepTime(1); });
        row.appendChild(stR);

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
        row.appendChild(fpsWrap);
        ovlEl.appendChild(row);
        mainEl.appendChild(ovlEl);

        // ===== 播放条行（原型 v-playbar：进度条 + ⏮ ⏯ ⏭） =====
        tlWrap = el('div', 'av-tl-wrap');
        ticksEl = el('div', 'av-tl-ticks');
        tlWrap.appendChild(ticksEl);
        // 时间标签（帧+秒/总时长）叠在进度条左上（原型 ptime）
        posEl = el('div', 'av-tl-pos', '帧 1 · 0.00s / 0.00s');
        tlWrap.appendChild(posEl);

        var prow = el('div', 'av-prow');
        tlRange = el('input', 'av-tl-range');
        tlRange.type = 'range';
        tlRange.min = '0';
        tlRange.max = '1000';
        tlRange.value = '0';
        tlRange.addEventListener('input', function () {
            if (!isFinite(videoEl.duration) || videoEl.duration <= 0) return;
            var t = (parseFloat(tlRange.value) / 1000) * videoEl.duration;
            // 反馈 #4：播放条点选吸附附近标记（±半帧）
            t = L.snapT(t, S.marks.marks, effFps());
            videoEl.currentTime = t;
            renderPos();
        });
        prow.appendChild(tlRange);

        btnPrev = el('button', 'av-ovl-btn av-sq', '⏮');
        btnPrev.addEventListener('click', function () { stepFile(-1); });
        prow.appendChild(btnPrev);
        btnPlay = el('button', 'av-ovl-btn av-sq av-play', '▶');    // 反馈 #2：补播放按钮
        btnPlay.addEventListener('click', togglePlay);
        prow.appendChild(btnPlay);
        btnNext = el('button', 'av-ovl-btn av-sq', '⏭');
        btnNext.addEventListener('click', function () { stepFile(1); });
        prow.appendChild(btnNext);
        tlWrap.appendChild(prow);
        mainEl.appendChild(tlWrap);

        document.body.appendChild(page);

        videoEl.addEventListener('timeupdate', renderPos);
        videoEl.addEventListener('seeked', renderPos);
        videoEl.addEventListener('loadedmetadata', function () { renderPos(); });
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

    /* ---------- fps 估算（rVFC 播放 1s 采样；未估算时 UI 按 25 显示） ---------- */

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

    /* ---------- 列表 / 侧栏 ---------- */

    function setSide(open) {
        sideEl.classList.toggle('closed', !open);
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
        videoEl.src = 'http://127.0.0.1:' + S.serverPort + '/' + encodeURIComponent(f.name);
        videoEl.load();
        renderList();
        renderPos();
        if (!keepPaused) togglePlay();
    }

    /* ---------- 位置显示 + 按钮状态（反馈 #3/#4） ---------- */

    function renderPos() {
        var t = videoEl.currentTime || 0;
        var d = videoEl.duration;
        if (isFinite(d) && d > 0) {
            tlRange.value = String(Math.round((t / d) * 1000));
        }
        if (S.meta.mode === 'video') {
            // 反馈 #3：帧数永远显示（fps 未估算按 25）
            posEl.textContent = '帧 ' + (L.frameAt(t, effFps()) + 1) + ' · ' + fmt2(t) + 's / ' +
                (isFinite(d) ? fmt2(d) : '0.00') + 's';
        } else {
            posEl.textContent = fmt2(t) + 's / ' + (isFinite(d) ? fmt2(d) : '0.00') + 's';
        }
        renderTicks();
        renderBtnStates();
    }

    /* 反馈 #4：游标命中（±半帧）时按钮变红「移除」态——所见即可删 */
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

    /* ---------- 标记（命中判定与按钮状态一致：±半帧） ---------- */

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
            var qt = L.quantize(t, 'video', effFps(), 0);   // G1 帧精确归档
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

    /* 反馈 #5：不再被 fps 阻塞（effFps 兜底 25）；当前帧已在参考集 → 移除 */
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

    /* ---------- 步进（R8） ---------- */

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

    /* ---------- 沉浸（G2） ---------- */

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
        unlockOrientation();     // 反馈 #1：退出恢复竖屏自适应
        page.classList.remove('open');
        var pj = document.getElementById('pjPage');
        if (pj) pj.classList.add('open');
        if (window.__projects && window.__projects.list) window.__projects.list();
    }

    /* ---------- 导出（R10） ---------- */

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
        lockLandscape();         // 反馈 #1：进入工作台强制横屏
        if (S.meta.folderUri) {
            refreshFolder().catch(function () {
                emptyHint.style.display = 'block';
                toast('目录授权失效或不可读：请重新「📂 加载文件夹」');
            });
        } else {
            emptyHint.style.display = 'block';
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
                immersive: S.immersive, folderName: S.meta && S.meta.folderName
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
