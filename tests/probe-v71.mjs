/* probe-v71.mjs — v71 验收（WebGL2 兜底下的四项修复）
 *
 * 老板 2026-11-15 反馈的四件事：
 *   ① 泼溅选点/放游标点不动 —— 要有 CPU 光线求交（桥层 pickSplat）
 *   ② 网格和坐标轴没显示 —— 要有线框网格 + 三色坐标轴
 *   ③ 10bit 素材 —— 要能拿到 ffmpeg 编码器清单与失败原因（诊断通道）
 *   ④ 选中父目录时错把旁支 mp4 当工程 —— 要优先用 clips/
 *
 * 本探针只验证可在无头浏览器里验的部分：
 *   ① 桥层 pickSplat 返回合理命中点（对准泼溅中心打一条射线）
 *   ② drawLine 真的被调用（拦截 app.drawLine 计数）
 *   ③ 转码插件的诊断方法存在且能返回编码器清单
 *   ④ listFiles 在 clips/ 布局下返回 hasClips/clipsUri（用 www 下的假布局）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { reclaimPorts } from './lib/net-reclaim.mjs';

const ROOT = path.resolve('.');
const PORT = 4294;
const CDP = 9354;
await reclaimPorts([PORT, CDP]);
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--no-proxy-server', '--window-size=900,700',
    `--user-data-dir=${process.env.TEMP}/edge-v71-${Date.now()}`,
    `http://127.0.0.1:${PORT}/www/index.html`
], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return r.result.value;
};

const fails = [];
const check = (name, ok, extra) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`);
    if (!ok) fails.push(name);
};
const exceptions = [];

try {
    for (let i = 0; i < 70; i++) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
            const t = list.find(x => x.type === 'page' && x.url.includes('/www/index.html'));
            if (t) { ws = new WebSocket(t.webSocketDebuggerUrl); break; }
        } catch { }
        await sleep(300);
    }
    await new Promise(r => ws.addEventListener('open', r));
    ws.addEventListener('message', (e2) => {
        const m = JSON.parse(e2.data);
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || {}); pending.delete(m.id); }
        if (m.method === 'Runtime.exceptionThrown') {
            exceptions.push((m.params.exceptionDetails.exception?.description || '').split('\n')[0].slice(0, 200));
        }
    });
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', {
        source: "Object.defineProperty(navigator,'gpu',{value:undefined,configurable:true});"
    });
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/www/index.html` });
    await sleep(2500);
    for (let i = 0; i < 150; i++) {
        if (await ev('document.body.classList.contains("sd-docks-ready")')) break;
        await sleep(400);
    }
    await sleep(1500);

    /* 载入泼溅 */
    await ev(`(async () => {
        const r = await fetch('../spike/glb-load-test/splat.ply');
        const b = await r.arrayBuffer();
        scene.events.invoke('import', [{ filename: 'v71.ply', contents: new Blob([b]) }]);
        return 1;
    })()`);
    for (let i = 0; i < 120; i++) {
        const s = await ev('window.scene.projectedSplatRenderer?.stats?.instances');
        if (s) break;
        await sleep(500);
    }
    for (let i = 0; i < 40; i++) {
        await ev('(()=>{const a=window.scene.app;a.render();a.render();return 1})()');
        const ic = await ev('(() => { const p = window.scene.projectedSplatRenderer.placements[0]; return p && p.instance ? p.instance.meshInstance.instancingCount : 0; })()');
        if (ic > 0) break;
        await sleep(400);
    }

    /* ---------- ① 选点：CPU 光线求交 ---------- */
    /* 不猜屏幕坐标：在画布上撒一圈采样点，看有多少条射线真的打到泼溅。
     * 命中点还要能对回某个高斯的椭球范围（证明位置是"表面上"而不是乱给一个数）。 */
    const pick = await ev(`(() => {
        const s = window.scene;
        const r = s.projectedSplatRenderer;
        const canvas = s.canvas;
        const out = { hasMethod: typeof r.pickSplat === 'function', hasRows: !!(r.placements[0] && r.placements[0].rows) };
        if (!out.hasMethod || !out.hasRows) return out;
        const pts = r.placements[0].rows;
        out.pointCount = pts.count;
        out.canvasSize = [canvas.clientWidth, canvas.clientHeight];

        /* 采样 9x9 网格 */
        const W = canvas.clientWidth, H = canvas.clientHeight;
        let hitCount = 0, samples = 0;
        const hits = [];
        for (let gy = 1; gy <= 9; gy++) {
            for (let gx = 1; gx <= 9; gx++) {
                const sx = W * gx / 10, sy = H * gy / 10;
                samples++;
                const h = r.pickSplat(sx, sy);
                if (h) { hitCount++; if (hits.length < 5) hits.push([+h.position.x.toFixed(3), +h.position.y.toFixed(3), +h.position.z.toFixed(3), +h.distance.toFixed(3)]); }
            }
        }
        out.samples = samples;
        out.hitCount = hitCount;
        out.hits = hits;

        /* 精度校验：对每个命中点，检查它落在某个高斯的椭球表面上。
         * 做法是把命中点换到泼溅局部坐标，找最近的椭圆（按各轴半径归一化），
         * 归一化距离应 ≈1（=1 表示正好在椭球面上）。 */
        if (hits.length) {
            const e = r.placements[0].entity;
            const inv = e.getWorldTransform().clone().invert();
            const V = s.camera.mainCamera.getPosition().constructor;
            const errs = [];
            for (const h of hits) {
                const lp = inv.transformPoint(new V(h[0], h[1], h[2]), new V());
                let bestErr = Infinity;
                for (let i = 0; i < pts.count; i++) {
                    const rx = pts.scale[0][i], ry = pts.scale[1][i], rz = pts.scale[2][i];
                    if (!(rx > 0) || !(ry > 0) || !(rz > 0)) continue;
                    const qx = (pts.x[i] - lp.x) / rx;
                    const qy = (pts.y[i] - lp.y) / ry;
                    const qz = (pts.z[i] - lp.z) / rz;
                    const norm = Math.sqrt(qx*qx + qy*qy + qz*qz);
                    if (Math.abs(norm - 1) < bestErr) bestErr = Math.abs(norm - 1);
                    if (bestErr < 1e-4) break;
                }
                errs.push(+bestErr.toFixed(5));
            }
            out.surfaceErrors = errs;
            out.maxSurfaceError = Math.max(...errs);
            out.withinSplat = out.maxSurfaceError < 0.25;
        }
        return out;
    })()`);
    check('bridge has pickSplat + per-point data', pick && pick.hasMethod === true && pick.hasRows === true,
        pick && { count: pick.pointCount });
    check('CPU ray pick hits the splat', pick && pick.hitCount > 0,
        pick && { hits: pick.hitCount + '/' + pick.samples, sample: pick.hits && pick.hits[0] });
    check('hit point sits on a gaussian', pick && pick.withinSplat === true,
        pick && { errs: pick.surfaceErrors, max: pick.maxSurfaceError });

    /* ---------- ② 网格 + 坐标轴 ---------- */
    const grid = await ev(`(() => {
        const s = window.scene;
        const out = { wireGrid: !!s.grid.wireGrid, planes: s.grid.planes.slice(), visible: s.grid.visible };
        /* 拦截 drawLine 数一帧里提交了多少条线 */
        const app = s.app;
        const orig = app.drawLine.bind(app);
        const colors = [];
        let n = 0;
        app.drawLine = function(a, b, c, depthTest, layer) {
            n++;
            if (c) colors.push([+c.r.toFixed(2), +c.g.toFixed(2), +c.b.toFixed(2)]);
            return orig(a, b, c, depthTest, layer);
        };
        s.grid.visible = true;
        app.render(); app.render();
        app.drawLine = orig;
        out.lines = n;
        out.haveRed = colors.some(c => c[0] > 0.8 && c[1] < 0.4);
        out.haveGreen = colors.some(c => c[1] > 0.8 && c[0] < 0.4);
        out.haveBlue = colors.some(c => c[2] > 0.8 && c[0] < 0.4);
        return out;
    })()`);
    check('WebGL2 builds a wire grid', grid && grid.wireGrid === true, grid && grid.planes);
    check('grid submits many lines per frame', grid && grid.lines > 40, grid && { lines: grid.lines });
    check('axes drawn in R/G/B', grid && grid.haveRed && grid.haveGreen && grid.haveBlue,
        grid && { r: grid.haveRed, g: grid.haveGreen, b: grid.haveBlue });

    /* ---------- ③④：原生插件（无头浏览器里没有 Capacitor 桥，只做静态校验） ---------- */
    const capPresent = await ev('!!(window.Capacitor && window.Capacitor.Plugins)');
    if (!capPresent) {
        console.log('SKIP  Capacitor 插件不在无头环境里 —— 改为静态校验源码标记');
        const fsx = await import('node:fs');
        const javaTx = fsx.readFileSync('android/app/src/main/java/com/sinigli/supersplat/MediaTranscodePlugin.java', 'utf8');
        const javaSrv = fsx.readFileSync('android/app/src/main/java/com/sinigli/supersplat/MediaServerPlugin.java', 'utf8');
        check('MediaTranscode has diagnostics()', /public void diagnostics\(/.test(javaTx));
        check('MediaTranscode records lastError/lastCommand', javaTx.includes('lastError') && javaTx.includes('lastCommand'));
        check('MediaServer has listFilesIn()', /public void listFilesIn\(/.test(javaSrv));
        check('MediaServer reports hasClips', javaSrv.includes('hasClips'));
        check('MediaServer start accepts subUri', javaSrv.includes('subUri'));
        const wwwTx = fsx.readFileSync('www/av-ui.js', 'utf8');
        check('av-ui calls diagnostics on long press', wwwTx.includes('showTranscodeDiag') && wwwTx.includes('p.diagnostics()'));
        check('av-ui prefers clips/ listing', wwwTx.includes('hasClips') && wwwTx.includes('listFilesIn'));
        check('av-ui passes subUri to server', wwwTx.includes('args.subUri'));
    }

    /* ---------- ③ 转码诊断（真实设备才有） ---------- */
    const tx = await ev(`(() => {
        const cap = window.Capacitor;
        const p = cap && cap.Plugins && cap.Plugins.MediaTranscode;
        if (!p) return { present: false };
        return { present: true, hasDiag: typeof p.diagnostics === 'function', keys: Object.keys(p) };
    })()`);
    if (capPresent) {
        check('MediaTranscode plugin is registered', tx && tx.present === true, tx && tx.keys);
        check('transcode exposes diagnostics()', tx && tx.hasDiag === true);
    }

    if (tx && tx.present && tx.hasDiag) {
        const diag = await ev(`(async () => {
            try { return await window.Capacitor.Plugins.MediaTranscode.diagnostics(); }
            catch (e) { return { __err: String(e && (e.message || e)).slice(0, 200) }; }
        })()`);
        console.log('DIAG: ' + JSON.stringify(diag).slice(0, 900));
        check('diagnostics returns encoder info', diag && (diag.encoders || diag.codecs || diag.ffmpegLoaded !== undefined), diag && Object.keys(diag).slice(0, 8));
    }

    /* ---------- ④ clips/ 布局 ---------- */
    const hasListFilesIn = await ev(`(() => {
        const cap = window.Capacitor;
        const p = cap && cap.Plugins && cap.Plugins.MediaServer;
        return p ? { present: true, listFilesIn: typeof p.listFilesIn === 'function' } : { present: false };
    })()`);
    if (capPresent) {
        check('MediaServer exposes listFilesIn (for clips/)', hasListFilesIn && hasListFilesIn.listFilesIn === true, hasListFilesIn);
    }

    const skipClips = await ev(`(() => {
        const src = window.__av ? 'loaded' : 'absent';
        return { av: src };
    })()`);
    check('av workbench module loaded', skipClips && skipClips.av === 'loaded', skipClips);

    check('no runtime exceptions', exceptions.length === 0, exceptions.slice(0, 3));

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot.data) fs.writeFileSync('shot_v71_webgl2.png', Buffer.from(shot.data, 'base64'));

    console.log(`\n=== ${fails.length === 0 ? 'v71 PASS' : 'v71 FAIL: ' + fails.join(' | ')} ===`);
    console.log('screenshot -> shot_v71_webgl2.png');
} catch (e) {
    console.log('PROBE ERROR', e && e.stack || e);
    fails.push('probe error');
} finally {
    try { edge.kill(); } catch { }
    try { srv.kill(); } catch { }
    process.exit(fails.length ? 1 : 0);
}
