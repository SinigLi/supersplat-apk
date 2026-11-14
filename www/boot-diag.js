/* v65 启动诊断层（纯 ES5，必须在 index.js 之前加载）
 *
 * 目的：老设备上「SuperSplat 启动失败」时，控制台看不到、导出按钮也没有。
 * 本层做三件事：
 *   1) 撒网：抢在引擎之前接管 console / window.onerror / unhandledrejection，把日志攒下来
 *   2) 体检：逐项探测 WebGL2 / WebGPU adapter / structuredClone / localStorage 等硬门槛
 *   3) 交付：启动失败时在页面顶部弹出面板，可「复制全部」到剪贴板（含降级），也可存成文件
 *
 * 为什么用 ES5：诊断层必须比引擎更能跑。若 WebView 老到不支持 const/箭头函数，
 * 用新语法写的诊断脚本自己就先崩了，什么都查不到。这里零 ES6+ 语法。
 */
(function () {
    'use strict';

    var MAX_LINES = 500;
    var logs = [];
    var t0 = Date.now();
    var panel = null;
    var logBox = null;
    var shown = false;
    var flushed = 0;

    function pad(n) {
        n = String(n);
        return n.length < 2 ? '0' + n : n;
    }

    function stamp() {
        var d = new Date();
        var el = d.getTime() - t0;
        return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
            '.' + ('00' + d.getMilliseconds()).slice(-3) + ' +' + el + 'ms';
    }

    function fmtArg(a) {
        try {
            if (a === null) return 'null';
            if (a === undefined) return 'undefined';
            if (typeof a === 'string') return a;
            if (typeof a === 'number' || typeof a === 'boolean') return String(a);
            if (a && typeof a.stack === 'string') return (a.name || 'Error') + ': ' + a.message + '\n' + a.stack;
            if (a && a.message) return String(a.message);
            return JSON.stringify(a);
        } catch (e) {
            try { return String(a); } catch (e2) { return '[unprintable]'; }
        }
    }

    function fmtArgs(args, from) {
        var out = [];
        for (var i = from; i < args.length; i++) out.push(fmtArg(args[i]));
        return out.join(' ');
    }

    function rec(tag, text) {
        var line = '[' + stamp() + '] ' + tag + ' ' + text;
        logs.push(line);
        if (logs.length > MAX_LINES) logs.splice(0, logs.length - MAX_LINES);
        if (logBox) {
            logBox.textContent = logs.join('\n');
            logBox.scrollTop = logBox.scrollHeight;
        }
        flushToPlugin();
    }

    /* ---------- 1) 抢日志 ---------- */

    /* v66 救援：引擎启动失败时会执行 body.replaceChildren(#startup-error)，
     * 把整个 App 界面一次性抹掉。但 3D 引擎只是 App 的一部分——图片 / 视频 /
     * 音频工作台完全不依赖它（av-viz 只用 2D canvas）。所以这里把这次调用拦下：
     * 保留既有 DOM，只登记“三维不可用”，让首页继续能用。 */
    function installRescue() {
        var body = document.body;
        if (!body || body.__diagRescue) return;
        body.__diagRescue = true;
        var orig = body.replaceChildren;
        body.replaceChildren = function () {
            var first = arguments[0];
            if (arguments.length === 1 && first && first.id === 'startup-error') {
                rec('[rescue]', '引擎调用了 body.replaceChildren(#startup-error)，已拦下以保住 App 界面');
                window.__NO_3D = true;
                try { document.dispatchEvent(new Event('engine-failed')); } catch (e) { }
                return;
            }
            return orig.apply(body, arguments);
        };
    }

    // boot-diag 是 <body> 里的第一个脚本，此时 document.body 已存在；
    // 立刻上钩子，不给引擎任何先行抹掉界面的窗口
    try { installRescue(); } catch (e) { }

    var methods = ['log', 'info', 'warn', 'error', 'debug'];
    for (var mi = 0; mi < methods.length; mi++) {
        (function (name) {
            var orig = console[name];
            console[name] = function () {
                try { rec('[' + name + ']', fmtArgs(arguments, 0)); } catch (e) { }
                if (orig) {
                    try { orig.apply(console, arguments); } catch (e) { }
                }
            };
        })(methods[mi]);
    }

    window.addEventListener('error', function (ev) {
        // 资源加载失败（如 index.js 模块本身挂掉）也走这里
        if (ev && ev.target && ev.target !== window && ev.target.tagName) {
            var t = ev.target;
            rec('[res]', t.tagName + ' 加载失败: ' + (t.src || t.href || '(inline)'));
            return;
        }
        var msg = (ev && ev.message) || '';
        var where = ev && ev.filename ? ' @' + ev.filename + ':' + ev.lineno + ':' + ev.colno : '';
        var stack = ev && ev.error && ev.error.stack ? '\n' + ev.error.stack : '';
        rec('[onerror]', msg + where + stack);
    }, true);

    window.addEventListener('unhandledrejection', function (ev) {
        var r = ev && ev.reason;
        var stack = r && r.stack ? '\n' + r.stack : '';
        rec('[reject]', fmtArg(r) + stack);
    });

    /* ---------- 2) 体检 ---------- */

    function tryCanvas(kind) {
        var out = { ok: false, err: '', info: '' };
        try {
            var c = document.createElement('canvas');
            c.width = 4;
            c.height = 4;
            var gl = c.getContext(kind);
            if (!gl) { out.err = 'getContext 返回 null'; return out; }
            out.ok = true;
            try {
                var dbg = gl.getExtension('WEBGL_debug_renderer_info');
                if (dbg) out.info = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
                if (!out.info) out.info = String(gl.getParameter(gl.RENDERER));
            } catch (e) { out.info = '(读不到 renderer)'; }
            out.extFloat = false;
            try { out.extFloat = !!gl.getExtension('EXT_color_buffer_float'); } catch (e) { }
            out.maxTex = 0;
            try { out.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE); } catch (e) { }
            out.version = '';
            try { out.version = String(gl.getParameter(gl.VERSION)); } catch (e) { }
        } catch (e) {
            out.err = String((e && e.message) || e);
        }
        return out;
    }

    function uaChrome(ua) {
        var m = /Chrome\/(\d+)/.exec(ua);
        return m ? m[1] : '?';
    }

    function uaAndroid(ua) {
        var m = /Android\s([\d.]+)/.exec(ua);
        return m ? m[1] : '?';
    }

    function probeSync() {
        var ua = navigator.userAgent || '';
        var r = [];
        r.push(['userAgent', ua]);
        r.push(['Chrome/WebView 主版本', uaChrome(ua)]);
        r.push(['Android 版本', uaAndroid(ua)]);
        r.push(['设备像素比 / 屏幕', String(window.devicePixelRatio) + ' / ' +
            screen.width + 'x' + screen.height + ' @' + screen.colorDepth]);
        r.push(['location', location.href]);
        r.push(['isSecureContext', String(!!window.isSecureContext)]);
        r.push(['Capacitor', window.Capacitor ? ('有 ' + (window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : '?')) : '无']);
        r.push(['Capacitor.Plugins', window.Capacitor && window.Capacitor.Plugins ? Object.keys(window.Capacitor.Plugins).join(',') : '无']);

        var gl2 = tryCanvas('webgl2');
        r.push(['WebGL2 可用', gl2.ok ? '是' : '否 —— ' + gl2.err]);
        if (gl2.ok) {
            r.push(['WebGL2 renderer', gl2.info]);
            r.push(['WebGL2 version', gl2.version]);
            r.push(['WebGL2 maxTextureSize', String(gl2.maxTex)]);
            r.push(['EXT_color_buffer_float', String(gl2.extFloat)]);
        }
        var gl1 = tryCanvas('webgl');
        r.push(['WebGL1 可用', gl1.ok ? '是' : '否 —— ' + gl1.err]);

        r.push(['structuredClone', typeof window.structuredClone === 'function' ? '有' : '缺失（引擎迁移状态会抛错）']);
        r.push(['navigator.gpu', navigator.gpu ? '存在（会先试 WebGPU 路径）' : '不存在（直接走 WebGL2）']);
        r.push(['requestIdleCallback', typeof window.requestIdleCallback]);

        var ls = '不可用';
        try {
            window.localStorage.setItem('__diag_probe', '1');
            window.localStorage.removeItem('__diag_probe');
            ls = '可写';
        } catch (e) { ls = '异常: ' + String((e && e.message) || e); }
        r.push(['localStorage', ls]);
        r.push(['indexedDB', window.indexedDB ? '有' : '无']);
        return r;
    }

    /* WebGPU 异步探测：单独 canvas，绝不碰引擎那个 */
    var gpuCache = null;
    var gpuBusy = false;
    function probeGpu(done) {
        if (gpuCache) { if (done) done(gpuCache); return; }
        if (gpuBusy) { return; }
        gpuBusy = true;
        if (!navigator.gpu) {
            gpuCache = [['WebGPU requestAdapter', '跳过（navigator.gpu 不存在）']];
            gpuBusy = false;
            if (done) done(gpuCache);
            return;
        }
        var rows = [];
        var finish = function () {
            gpuCache = rows;
            gpuBusy = false;
            if (done) done(rows);
        };
        var timer = setTimeout(function () {
            rows.push(['WebGPU requestAdapter', '超时（5s 未返回）']);
            finish();
        }, 5000);
        var p;
        try { p = navigator.gpu.requestAdapter(); } catch (e) {
            clearTimeout(timer);
            rows.push(['WebGPU requestAdapter', '同步抛错: ' + String((e && e.message) || e)]);
            done(rows);
            return;
        }
        if (!p || !p.then) {
            clearTimeout(timer);
            rows.push(['WebGPU requestAdapter', '未返回 Promise']);
            done(rows);
            return;
        }
        p.then(function (adapter) {
            clearTimeout(timer);
            if (!adapter) {
                rows.push(['WebGPU requestAdapter', '返回 null（无可用适配器 —— 这是失败主因）']);
                finish();
                return;
            }
            rows.push(['WebGPU requestAdapter', '拿到 adapter']);
            try {
                var inf = adapter.info || {};
                rows.push(['adapter.vendor', String(inf.vendor || '')]);
                rows.push(['adapter.architecture', String(inf.architecture || '')]);
                rows.push(['adapter.device', String(inf.device || '')]);
                rows.push(['adapter.description', String(inf.description || '')]);
            } catch (e) { rows.push(['adapter.info', '读取异常: ' + String((e && e.message) || e)]); }
            var dp;
            try { dp = adapter.requestDevice(); } catch (e) {
                rows.push(['requestDevice', '同步抛错: ' + String((e && e.message) || e)]);
                finish();
                return;
            }
            if (!dp || !dp.then) { rows.push(['requestDevice', '未返回 Promise']); finish(); return; }
            dp.then(function (dev) {
                rows.push(['requestDevice', dev ? '成功' : '返回 null']);
                finish();
            }).catch(function (e) {
                rows.push(['requestDevice', '失败: ' + String((e && e.message) || e)]);
                finish();
            });
        }).catch(function (e) {
            clearTimeout(timer);
            rows.push(['WebGPU requestAdapter', '失败: ' + String((e && e.message) || e)]);
            finish();
        });
    }

    /* ---------- 3) 落盘 + 面板 ---------- */

    function plugin() {
        var cap = window.Capacitor;
        return (cap && cap.Plugins && cap.Plugins.DebugLog) || null;
    }

    /* 引擎起来之前 Capacitor 可能没注入，所以按需重试，最多 20 次 */
    function flushToPlugin() {
        if (flushed >= logs.length) return;
        var p = plugin();
        if (!p || !p.append) return;
        var from = flushed;
        flushed = logs.length;
        for (var i = from; i < logs.length; i++) {
            try {
                var r = p.append({ text: '[boot] ' + logs[i] });
                if (r && r['catch']) r['catch'](function () { });
            } catch (e) { }
        }
    }

    var retry = 0;
    var retryTimer = setInterval(function () {
        retry++;
        flushToPlugin();
        if (retry > 20) clearInterval(retryTimer);
    }, 1000);

    function buildText(extraRows) {
        var out = [];
        out.push('### 摸鱼台 启动诊断 v65');
        out.push('生成时间: ' + new Date().toString());
        out.push('页面停留: ' + (Date.now() - t0) + 'ms');
        out.push('');
        out.push('--- 能力体检 ---');
        var rows = probeSync();
        for (var i = 0; i < rows.length; i++) out.push(rows[i][0] + ': ' + rows[i][1]);
        var gpu = extraRows || gpuCache;
        if (gpu && gpu.length) {
            for (var j = 0; j < gpu.length; j++) out.push(gpu[j][0] + ': ' + gpu[j][1]);
        } else {
            out.push('WebGPU requestAdapter: (探测尚未完成)');
        }
        out.push('');
        out.push('--- 启动错误面板 ---');
        var se = document.getElementById('startup-error');
        out.push(se ? ('已显示: ' + se.textContent) : '未显示');
        out.push('');
        out.push('--- 日志 (' + logs.length + ' 条) ---');
        out.push(logs.join('\n') || '(空)');
        return out.join('\n');
    }

    function copyText(text, okCb, failCb) {
        // 首选：secure context 下的 clipboard API（Capacitor 是 https://localhost）
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(function () { okCb('clipboard'); },
                    function () { legacyCopy(text, okCb, failCb); });
                return;
            }
        } catch (e) { }
        legacyCopy(text, okCb, failCb);
    }

    function legacyCopy(text, okCb, failCb) {
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', 'readonly');
            ta.style.position = 'fixed';
            ta.style.top = '0';
            ta.style.left = '0';
            ta.style.width = '1px';
            ta.style.height = '1px';
            ta.style.opacity = '0';
            document.documentElement.appendChild(ta);
            ta.focus();
            ta.select();
            try { ta.setSelectionRange(0, text.length); } catch (e) { }
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
            document.documentElement.removeChild(ta);
            if (ok) { okCb('execCommand'); return; }
        } catch (e) { }
        failCb();
    }

    function ensurePanel() {
        if (panel) return panel;

        panel = document.createElement('div');
        panel.id = 'diag-panel';
        panel.setAttribute('style', [
            'position:fixed', 'left:0', 'right:0', 'top:0', 'z-index:2147483647',
            'max-height:72vh', 'display:flex', 'flex-direction:column',
            'background:rgba(12,14,18,0.96)', 'color:#d7e0ea',
            'font:11px/1.45 monospace', 'padding:8px 8px 10px',
            'box-shadow:0 6px 24px rgba(0,0,0,0.6)', 'border-bottom:1px solid #2b3442'
        ].join(';'));

        var head = document.createElement('div');
        head.setAttribute('style', 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px');
        head.textContent = '';

        var title = document.createElement('span');
        title.textContent = '启动诊断 v65';
        title.setAttribute('style', 'font-weight:bold;color:#8fd0ff;margin-right:auto');
        head.appendChild(title);

        function mkBtn(label, bg, fn) {
            var b = document.createElement('button');
            b.textContent = label;
            b.setAttribute('style', 'font:11px/1 monospace;padding:7px 10px;border-radius:6px;border:1px solid #3a4557;' +
                'background:' + bg + ';color:#eaf2fb;cursor:pointer');
            b.addEventListener('click', fn);
            return b;
        }

        var hint = document.createElement('div');
        hint.setAttribute('style', 'flex:1 1 100%;color:#8b98a8;font-size:10px;margin-top:2px');
        hint.textContent = '卡住就点「复制全部」，然后粘贴发给我';

        var copyBtn = mkBtn('📋 复制全部', '#1f6feb', function () {
            var text = buildText(null);
            copyText(text, function (how) {
                hint.textContent = '已复制（' + how + '），共 ' + text.length + ' 字符 → 粘贴发我';
                hint.setAttribute('style', 'flex:1 1 100%;color:#63e6a0;font-size:10px;margin-top:2px');
            }, function () {
                hint.textContent = '自动复制被拒，下面文本框已全选，长按手动「全选→复制」';
                hint.setAttribute('style', 'flex:1 1 100%;color:#ffb454;font-size:10px;margin-top:2px');
                if (fallbackTa) {
                    fallbackTa.value = text;
                    fallbackTa.style.display = 'block';
                    try { fallbackTa.focus(); fallbackTa.select(); } catch (e) { }
                }
            });
        });
        head.appendChild(copyBtn);

        head.appendChild(mkBtn('🔄 重测', '#2d3646', function () {
            rec('[diag]', '手动重测');
            logBox.textContent = logs.join('\n');
            probeGpu(function (rows) {
                for (var i = 0; i < rows.length; i++) rec('[gpu]', rows[i][0] + ' = ' + rows[i][1]);
            });
        }));

        head.appendChild(mkBtn('💾 存文件', '#2d3646', function () {
            var p = plugin();
            if (!p || !p.send) { hint.textContent = '没装 DebugLog 插件，用「复制全部」'; return; }
            try {
                var r = p.send();
                if (r && r.then) r.then(function () { hint.textContent = '已存到手机（moyutai-debug.log）'; },
                    function (e) { hint.textContent = '保存失败: ' + e; });
            } catch (e) { hint.textContent = '保存失败: ' + e; }
        }));

        head.appendChild(mkBtn('✕', '#2d3646', function () {
            panel.style.display = 'none';
        }));

        head.appendChild(hint);

        logBox = document.createElement('pre');
        logBox.setAttribute('style', 'margin:0;padding:6px;overflow:auto;max-height:44vh;' +
            'background:#0b0e13;border:1px solid #232c39;border-radius:6px;' +
            'white-space:pre-wrap;word-break:break-all;color:#c3ceda');

        var fallbackTa = document.createElement('textarea');
        fallbackTa.setAttribute('style', 'display:none;width:100%;height:120px;margin-top:6px;' +
            'background:#0b0e13;color:#c3ceda;border:1px solid #232c39;border-radius:6px;font:11px monospace');
        fallbackTa.value = '';

        panel.appendChild(head);
        panel.appendChild(logBox);
        panel.appendChild(fallbackTa);

        // 挂到 <html> 而不是 <body>：引擎失败时会 body.replaceChildren(...)，挂 body 会被抹掉
        document.documentElement.appendChild(panel);
        return panel;
    }

    function show() {
        if (shown) return;
        shown = true;
        try {
            ensurePanel();
            logBox.textContent = logs.join('\n');
            logBox.scrollTop = logBox.scrollHeight;
            probeGpu(function (rows) {
                for (var i = 0; i < rows.length; i++) rec('[gpu]', rows[i][0] + ' = ' + rows[i][1]);
            });
        } catch (e) { }
    }

    /* 启动失败信号：引擎的兜底 div，或我们自己抓到 error/reject */
    function watchFail() {
        var check = function () {
            if (document.getElementById('startup-error')) { show(); return true; }
            return false;
        };
        if (check()) return;
        var mo = null;
        try {
            mo = new MutationObserver(function () {
                if (check() && mo) { mo.disconnect(); }
            });
            mo.observe(document.documentElement, { childList: true, subtree: true });
        } catch (e) { }
        var n = 0;
        var t = setInterval(function () {
            n++;
            if (check() || n > 60) clearInterval(t);
        }, 500);
    }

    // 抓到硬错误就先亮面板（只在启动后前 20s 内，避免正常使用中的偶发异常弹出面板）
    var origErr = window.onerror;
    window.onerror = function () {
        if (Date.now() - t0 < 20000) show();
        if (origErr) { try { return origErr.apply(window, arguments); } catch (e) { } }
        return false;
    };

    window.__diag = {
        text: function () { return buildText(null); },
        show: show,
        logs: logs
    };

    rec('[diag]', 'boot-diag 已就绪 (UA Chrome/' + uaChrome(navigator.userAgent) + ')');

    if (/[?&]diag=1/.test(location.search)) show();

    // 引擎被闸门拦下 / 启动后崩掉：自动亮面板，方便一眼看到原因
    document.addEventListener('engine-failed', function () {
        rec('[gate]', '引擎启动失败，三维功能已禁用');
        show();
    });

    // body 可能还没解析出来，等 DOM 就位再挂观察器
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', watchFail);
    } else {
        watchFail();
    }
})();
