/* v44 extract.js — 摸鱼台解压中心 Web 层
 * 接原生 ExtractPlugin（pick/extract + progress/done/error 事件）
 * 供 projects-ui.js 的「🗜️ 解压」按钮调用：window.__extract.open()
 *
 * 交互流（对齐 r6 原型）：
 *   打开弹层 → 选文件（SAF 多选，可全选 .001~.NNN）→ 显示识别结果（卷数/大小/格式）
 *   → 开始解压 → 进度条（copy 拼/extract 两个阶段）→ 完成（目标路径 + 文件数）
 *   / 失败（原生错误文案直接显示）
 */
(function () {
    'use strict';

    function plugin() {
        var cap = window.Capacitor;   // 动态读取：桥注入时序不固定（桌面 mock / 真机注入后均可用）
        return (cap && cap.Plugins && cap.Plugins.Extract) || null;
    }

    var dlg, fileEl, progEl, progBar, progTxt, resEl, goBtn, pickBtn, closeBtn, busy = false;
    var picked = [];   // [{uri,name,size}]

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    function fmtSize(b) {
        if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
        if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
        if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
        return b + ' B';
    }

    /* 卷识别：按 stripVolume 前缀分组，取最大组 */
    function groupVolumes(files) {
        var strip = function (n) {
            var m = n.match(/\.(?:\d{3}|part\d+|z\d\d)$/i);
            return m ? n.slice(0, m.index) : n;
        };
        var groups = {};
        files.forEach(function (f) {
            var k = strip(f.name);
            (groups[k] = groups[k] || []).push(f);
        });
        var best = null;
        Object.keys(groups).forEach(function (k) {
            if (!best || groups[k].length > best.list.length) best = { base: k, list: groups[k] };
        });
        return best;
    }

    function build() {
        dlg = el('div', 'pj-dlg-mask');
        var box = el('div', 'pj-dlg');
        box.appendChild(el('div', 'pj-dlg-title', '🗜️ 解压压缩包'));

        fileEl = el('div', 'pj-dlg-hint', '支持 zip / 7z / 分卷（.7z.001~.NNN，全选一起）；不支持 rar');
        fileEl.style.wordBreak = 'break-all';
        box.appendChild(fileEl);

        progEl = el('div', 'pj-ext-prog');
        progBar = el('i');
        progEl.appendChild(progBar);
        progTxt = el('div', 'pj-dlg-hint', '');
        progEl.style.display = 'none';
        box.appendChild(progEl);

        resEl = el('div', 'pj-ext-res');
        resEl.style.display = 'none';
        box.appendChild(resEl);

        var row = el('div', 'pj-dlg-row');
        pickBtn = el('button', 'pj-dlg-btn', '选择文件');
        goBtn = el('button', 'pj-dlg-btn pj-primary', '开始解压');
        goBtn.disabled = true;
        closeBtn = el('button', 'pj-dlg-btn', '关闭');
        row.appendChild(pickBtn);
        row.appendChild(goBtn);
        row.appendChild(closeBtn);
        box.appendChild(row);

        dlg.appendChild(box);
        document.body.appendChild(dlg);

        function close() { if (!busy) dlg.classList.remove('open'); }
        closeBtn.addEventListener('click', close);
        dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });

        pickBtn.addEventListener('click', function () {
            var p = plugin();
            if (!p) { fileEl.textContent = '插件不可用（请在 APK 内使用）'; return; }
            p.pick().then(function (res) {
                picked = (res && res.files) || [];
                if (!picked.length) { fileEl.textContent = '未选择文件'; goBtn.disabled = true; return; }
                var g = groupVolumes(picked);
                var total = picked.reduce(function (s, f) { return s + (f.size || 0); }, 0);
                var isVol = /(?:\.\d{3}|\.part\d+|\.z\d\d)$/i.test(picked[0].name);
                var txt = '已选择 ' + picked.length + ' 个文件（' + fmtSize(total) + '）';
                if (g && isVol && picked.length > 1) {
                    txt = '已识别分卷：' + g.base + '（' + g.list.length + ' 卷，' + fmtSize(total) + '）';
                } else if (g) {
                    txt = '已选择：' + g.base + '（' + fmtSize(total) + '）';
                }
                if (/\.rar$/i.test(picked[0].name)) {
                    txt += ' · ⚠ rar 不支持';
                    goBtn.disabled = true;
                } else {
                    goBtn.disabled = false;
                }
                fileEl.textContent = txt;
            }).catch(function (e) {
                fileEl.textContent = '选择失败：' + (e && e.message || e);
            });
        });

        goBtn.addEventListener('click', function () {
            if (busy || !picked.length) return;
            var p = plugin();
            if (!p) return;
            busy = true;
            goBtn.disabled = true;
            pickBtn.disabled = true;
            progEl.style.display = 'block';
            resEl.style.display = 'none';
            resEl.className = 'pj-ext-res';
            progBar.style.width = '0%';
            progTxt.textContent = '准备…';
            var uris = picked.map(function (f) { return f.uri; });
            p.extract({ uris: uris }).catch(function (e) {
                busy = false;
                progEl.style.display = 'none';
                resEl.style.display = 'block';
                resEl.classList.add('err');
                resEl.textContent = '❌ ' + (e && e.message || e);
                pickBtn.disabled = false;
            });
        });

        // 原生事件
        var p = plugin();
        if (p) {
            p.addListener('progress', function (ev) {
                progBar.style.width = Math.round(ev.pct || 0) + '%';
                progTxt.textContent = (ev.phase === 'copy' ? '拼接分卷… ' : '解压中… ')
                    + Math.round(ev.pct || 0) + '%';
            });
            p.addListener('done', function (ev) {
                busy = false;
                progEl.style.display = 'none';
                resEl.style.display = 'block';
                resEl.classList.add('ok');
                resEl.textContent = '✅ 解压完成 → ' + ev.dest + '（' + ev.files + ' 个文件 · ' + ev.volumes + ' 卷）';
                pickBtn.disabled = false;
                goBtn.disabled = true;
            });
            p.addListener('error', function (ev) {
                busy = false;
                progEl.style.display = 'none';
                resEl.style.display = 'block';
                resEl.classList.add('err');
                resEl.textContent = '❌ ' + (ev && ev.message || '解压失败');
                pickBtn.disabled = false;
            });
        }
    }

    function open() {
        if (!dlg) build();
        picked = [];
        busy = false;
        goBtn.disabled = true;
        pickBtn.disabled = false;
        progEl.style.display = 'none';
        resEl.style.display = 'none';
        fileEl.textContent = '支持 zip / 7z / 分卷（.7z.001~.NNN，全选一起）；不支持 rar';
        dlg.classList.add('open');
    }

    window.__extract = { open: open };
})();
