/* v66 引擎能力闸门（classic script，必须在所有业务脚本之前加载）
 *
 * 背景：华为 M6（Android 10 / Chrome 114 / Mali-G76）的 WebGL2 完全正常，
 * 但 WebGPU 只有 API 没有可用 adapter（requestAdapter() → null）。
 * 而编辑器引擎（index.js）硬编码 deviceTypes:['webgpu']，adapter 缺失时
 * 会退到 WebGL2 设备，随后在 StorageBuffer 上撞 `createBufferImpl is not a
 * function`（WebGL 设备没实现该方法），异常冒到 bundle 末尾的 catch：
 *     document.body.replaceChildren(#startup-error)
 * 于是整个 App 被一行提示替换——图片/视频/音频工作台明明不依赖引擎，也一起没了。
 *
 * 本文件做两件事：
 *   1) 启动前探测 WebGPU 适配器；拿不到就【不加载引擎】，body 保持完整，
 *      首页 / 图片 / 视频 / 音频全部照常可用，只把 3D 标记为不可用。
 *   2) 探测拿不准（超时）时乐观加载，由 projects-ui 的救援观察器兜底。
 *
 * 注意：这里刻意用 ES5 语法 + try/catch，能力探测脚本自己不能因为语法崩掉。
 */
(function () {
    'use strict';

    var PROBE_TIMEOUT = 6000;

    var state = {
        probed: false,
        supported: false,      // 三维是否可用（引擎能否安全启动）
        reason: '',            // 人话原因，UI 直接展示
        detail: '',            // 技术细节，写日志/诊断
        adapterInfo: null,
        engineState: 'pending' // pending | loading | loaded | failed | skipped
    };
    window.__engineGate = state;

    function finish(supported, reason, detail) {
        if (state.probed) return;
        state.probed = true;
        state.supported = supported;
        state.reason = reason || '';
        state.detail = detail || '';
        if (!supported) window.__NO_3D = true;
        try {
            document.dispatchEvent(new CustomEvent('engine-capability', { detail: state }));
        } catch (e) {
            try { document.dispatchEvent(new Event('engine-capability')); } catch (e2) { }
        }
        startEngine();
    }

    /* ---------- 日志（复用 boot-diag 的通道，没有就直接 console） ---------- */

    function log(msg) {
        try {
            if (window.__diag && window.__diag.logs) window.__diag.logs.push('[gate] ' + msg);
        } catch (e) { }
        try { console.log('[gate] ' + msg); } catch (e) { }
    }

    /* ---------- 引擎装载 ---------- */

    var ENGINE_SRC = './index.js?v=45x';

    function startEngine() {
        if (state.engineState !== 'pending') return;

        if (!state.supported) {
            state.engineState = 'skipped';
            log('3D 引擎已跳过：' + state.reason);
            return;
        }

        state.engineState = 'loading';
        var p;
        try {
            p = import(ENGINE_SRC);
        } catch (e) {
            state.engineState = 'failed';
            state.supported = false;
            window.__NO_3D = true;
            state.reason = '三维引擎加载失败（当前环境不支持动态模块）';
            state.detail = String((e && e.message) || e);
            log('import 同步失败 ' + state.detail);
            return;
        }
        if (!p || !p.then) {
            state.engineState = 'failed';
            state.supported = false;
            window.__NO_3D = true;
            return;
        }
        p.then(function () {
            state.engineState = 'loaded';
            log('3D 引擎已加载');
        }, function (err) {
            state.engineState = 'failed';
            state.supported = false;
            window.__NO_3D = true;
            state.reason = '三维引擎启动失败';
            state.detail = String((err && (err.message || err)) || err);
            log('import 失败 ' + state.detail);
            try { document.dispatchEvent(new Event('engine-failed')); } catch (e) { }
        });
    }

    /* ---------- 能力探测 ---------- */

    function probe() {
        if (!navigator.gpu) {
            finish(false,
                '本机不支持 WebGPU，三维导演台无法运行',
                'navigator.gpu 不存在');
            return;
        }

        var settled = false;
        var timer = setTimeout(function () {
            if (settled) return;
            settled = true;
            // 超时不等于不支持：可能只是设备忙。乐观放行，失败由救援观察器兜底。
            state.adapterInfo = 'timeout';
            finish(true, '', 'requestAdapter 超时 ' + PROBE_TIMEOUT + 'ms，乐观放行');
            log('WebGPU 探测超时，乐观加载引擎');
        }, PROBE_TIMEOUT);

        var ra;
        try {
            ra = navigator.gpu.requestAdapter();
        } catch (e) {
            clearTimeout(timer);
            if (settled) return;
            settled = true;
            finish(false,
                '本机 WebGPU 不可用，三维导演台无法运行',
                'requestAdapter 抛错: ' + String((e && e.message) || e));
            return;
        }

        if (!ra || !ra.then) {
            clearTimeout(timer);
            if (settled) return;
            settled = true;
            finish(true, '', 'requestAdapter 未返回 Promise，乐观放行');
            return;
        }

        ra.then(function (adapter) {
            clearTimeout(timer);
            if (settled) return;
            settled = true;
            if (!adapter) {
                finish(false,
                    '本机显卡未提供 WebGPU 适配器，三维导演台无法运行',
                    'requestAdapter() 返回 null');
                return;
            }
            try {
                var inf = adapter.info || {};
                state.adapterInfo = [inf.vendor, inf.architecture, inf.device, inf.description]
                    .filter(Boolean).join(' / ') || '(no info)';
            } catch (e) { state.adapterInfo = '(read error)'; }
            // 拿到 adapter 还不够，真正要的是 device
            var rd;
            try { rd = adapter.requestDevice(); } catch (e) {
                finish(true, '', 'adapter 有了但 requestDevice 抛错，乐观放行');
                return;
            }
            if (!rd || !rd.then) {
                finish(true, '', 'requestDevice 未返回 Promise，乐观放行');
                return;
            }
            rd.then(function (dev) {
                if (dev) finish(true, '', 'adapter + device 均可用');
                else finish(false, '本机 WebGPU 无法创建设备，三维导演台无法运行', 'requestDevice() 返回 null');
            }, function (e) {
                finish(false, '本机 WebGPU 无法创建设备，三维导演台无法运行',
                    'requestDevice 失败: ' + String((e && e.message) || e));
            });
        }, function (e) {
            clearTimeout(timer);
            if (settled) return;
            settled = true;
            finish(false,
                '本机 WebGPU 不可用，三维导演台无法运行',
                'requestAdapter 失败: ' + String((e && e.message) || e));
        });
    }

    log('能力闸门启动');
    try {
        probe();
    } catch (e) {
        // 探测本身炸了也不能拦住 App
        finish(true, '', '探测异常，乐观放行: ' + String((e && e.message) || e));
    }
})();
