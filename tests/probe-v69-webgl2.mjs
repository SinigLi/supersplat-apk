/* probe-v69-webgl2.mjs — v69 WebGL2 桥验收
 *
 * 目标：在没有 WebGPU adapter 的环境下，原编辑器必须
 *   1) 能启动（不白屏、无 #startup-error、webglFallback=true）
 *   2) 泼溅能载入并真的建出引擎 GSplatInstance（instancingCount > 0）
 *   3) 桥层挂 worldLayer、排序器走 CPU、样点数据正确（不是全 0）
 *   4) 导演台仍可用：spawn 人偶、整层变换、相机移动都不报错
 *
 * 用 spike/glb-load-test/splat.ply（仓库唯一的泼溅资产）。
 * 通过 navigator.gpu = undefined 模拟华为 M6（有 gpu 对象但无 adapter）。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { reclaimPorts } from './lib/net-reclaim.mjs';

const ROOT = path.resolve('.');
const PORT = 4291;
const CDP = 9351;
await reclaimPorts([PORT, CDP]);
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--no-proxy-server', '--window-size=900,700',
    `--user-data-dir=${process.env.TEMP}/edge-v69-webgl2-${Date.now()}`,
    `http://127.0.0.1:${PORT}/www/index.html`
], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
});
const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
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
    ws.addEventListener('message', (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result || {}); pending.delete(m.id); }
        if (m.method === 'Runtime.exceptionThrown') {
            exceptions.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').split('\n')[0].slice(0, 200));
        }
    });
    await send('Runtime.enable');
    /* 关键：模拟 M6 —— 有 navigator.gpu 对象但拿不到 adapter */
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', {
        source: "Object.defineProperty(navigator,'gpu',{value:undefined,configurable:true});"
    });
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/www/index.html` });
    await sleep(2500);

    for (let i = 0; i < 150; i++) {
        if (await evalJs('document.body.classList.contains("sd-docks-ready")')) break;
        await sleep(400);
    }
    await sleep(1500);

    /* ---------- 1) 启动 ---------- */
    const boot = await evalJs(`(() => {
        const s = window.scene;
        if (!s) return { noScene: true, startupError: !!document.querySelector('#startup-error') };
        return {
            device: s.app.graphicsDevice.deviceType,
            isWebGL2: !!s.app.graphicsDevice.isWebGL2,
            webglFallback: s.webglFallback,
            startupError: !!document.querySelector('#startup-error'),
            canvas: [s.canvas.width, s.canvas.height],
            director: !!window.__director
        };
    })()`);
    check('editor boots on WebGL2 (no startup error)', boot && boot.device === 'webgl2' && boot.webglFallback === true && boot.startupError === false, boot);
    check('director present', boot && boot.director === true);

    /* ---------- 2) 泼溅载入 ---------- */
    await evalJs(`(async () => {
        const r = await fetch('../spike/glb-load-test/splat.ply');
        const b = await r.arrayBuffer();
        scene.events.invoke('import', [{ filename: 'v69.ply', contents: new Blob([b]) }]);
        return 1;
    })()`);

    let bridge = null;
    for (let i = 0; i < 120; i++) {
        bridge = await evalJs(`(() => {
            const r = window.scene.projectedSplatRenderer;
            if (!r || !r.stats) return null;
            const p = r.placements && r.placements[0];
            return {
                stats: r.stats,
                ic: p && p.instance ? p.instance.meshInstance.instancingCount : null,
                layers: p && p.entity && p.entity.render ? p.entity.render.layers : null,
                worldLayerId: window.scene.worldLayer.id,
                hasSorter: p && p.instance ? !!p.instance.sorter : null,
                orderTex: p && p.instance ? !!p.instance.orderTexture : null
            };
        })()`);
        if (bridge && bridge.stats && bridge.stats.instances > 0) break;
        await sleep(500);
    }
    /* 桥层建 GSplatInstance 是异步的（要重读 ChunkSource），且 headless 下
     * rAF 会被节流，所以显式驱动 render 直到 instancingCount > 0。 */
    let ic = 0;
    for (let i = 0; i < 40; i++) {
        await evalJs('(() => { const a = window.scene.app; a.render(); a.render(); return 1; })()');
        ic = await evalJs('(() => { const p = window.scene.projectedSplatRenderer.placements[0]; return p && p.instance ? p.instance.meshInstance.instancingCount : 0; })()');
        if (ic > 0) break;
        await sleep(400);
    }
    await sleep(600);

    /* 重新读一次 bridge（上面的 bridge 是建层完成前的快照，ic 还是 0） */
    bridge = await evalJs(`(() => {
        const r = window.scene.projectedSplatRenderer;
        if (!r || !r.stats) return null;
        const p = r.placements && r.placements[0];
        return {
            stats: r.stats,
            ic: p && p.instance ? p.instance.meshInstance.instancingCount : null,
            layers: p && p.entity && p.entity.render ? p.entity.render.layers : null,
            worldLayerId: window.scene.worldLayer.id,
            hasSorter: p && p.instance ? !!p.instance.sorter : null,
            orderTex: p && p.instance ? !!p.instance.orderTexture : null
        };
    })()`);

    check('splat imported into bridge', bridge && bridge.stats && bridge.stats.count > 0, bridge && bridge.stats && { count: bridge.stats.count, backend: bridge.stats.backend });
    check('engine GSplatInstance built', bridge && bridge.ic > 0, bridge && { instancingCount: bridge.ic });
    check('layered into worldLayer (not splatLayer)', bridge && Array.isArray(bridge.layers) && bridge.layers[0] === bridge.worldLayerId, bridge && bridge.layers);
    check('CPU sorter + order texture present', bridge && bridge.hasSorter === true && bridge.orderTex === true);
    check('no bridge error', bridge && bridge.stats && bridge.stats.lastError === '', bridge && bridge.stats && bridge.stats.lastError);

    const sample = bridge && bridge.stats && bridge.stats.sample;
    check('sample data is real (not all zero)',
        sample && sample.n > 0 && (Math.abs(sample.pos[0]) + Math.abs(sample.pos[1]) + Math.abs(sample.pos[2])) > 0 &&
        sample.scale.some(v => v > 0) && sample.opacity > 0,
        sample && { pos: sample.pos, scale: sample.scale, opacity: sample.opacity, nan: sample.nan });

    /* ---------- 3) 导演台功能 ---------- */
    const dir = await evalJs(`(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const D = window.__director;
        const out = {};
        out.puppetsBefore = D.puppets.length;
        D.addPuppet();
        for (let i = 0; i < 120; i++) { if (D.puppets.length > out.puppetsBefore) break; await wait(250); }
        out.puppetsAfter = D.puppets.length;
        out.puppetSkinned = D.puppets.length ? D.puppets[D.puppets.length - 1].meshes?.length ?? null : null;

        const splat = window.scene.projectedSplatRenderer.placements[0]?.splat;
        const before = splat.entity.getLocalPosition();
        out.beforeX = before.x;
        splat.entity.setLocalPosition(before.x + 0.5, before.y, before.z);
        await wait(120);
        out.afterX = splat.entity.getLocalPosition().x;
        out.splatMoved = [out.afterX, out.beforeX];
        return out;
    })()`);
    check('director can spawn a puppet', dir && dir.puppetsAfter > dir.puppetsBefore, dir && { before: dir.puppetsBefore, after: dir.puppetsAfter });
    check('splat layer transform applies', dir && Math.abs(dir.splatMoved[0] - dir.splatMoved[1] - 0.5) < 0.001, dir && dir.splatMoved);

    /* ---------- 4) 出图 ---------- */
    await sleep(1200);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot.data) {
        const fs = await import('node:fs');
        fs.writeFileSync('shot_v69_webgl2.png', Buffer.from(shot.data, 'base64'));
    }

    check('no runtime exceptions', exceptions.length === 0, exceptions.slice(0, 3));

    console.log(`\n=== ${fails.length === 0 ? 'v69 WEBGL2 PASS' : 'v69 WEBGL2 FAIL'} : ${fails.length === 0 ? 'all passed' : fails.join(' | ')} ===`);
    console.log('screenshot -> shot_v69_webgl2.png');
} catch (e) {
    console.log('PROBE ERROR', e && e.stack || e);
    fails.push('probe error');
} finally {
    try { edge.kill(); } catch { }
    try { srv.kill(); } catch { }
    process.exit(fails.length ? 1 : 0);
}
