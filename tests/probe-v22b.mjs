/* probe-v22b.mjs — 验证「站在机位上时隐藏那台相机模型」
 *
 * 相机模型固定世界尺寸后，点「查看」会把视口塞进相机机身内部。规则：
 * 距离 < SHOT_MARKER_SCALE*0.62 就隐藏该 marker。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4271;
const CDP = 9331;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
    '--use-angle=d3d11', '--window-size=390,844',
    `--user-data-dir=${process.env.TEMP}/edge-v22b-${Date.now()}`,
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

try {
    for (let i = 0; i < 60; i++) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
            const t = list.find(x => x.type === 'page' && x.url.includes('/www/index.html'));
            if (t) { ws = new WebSocket(t.webSocketDebuggerUrl); break; }
        } catch {}
        await sleep(300);
    }
    await new Promise(r => ws.addEventListener('open', r));
    ws.addEventListener('message', (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && pending.has(m.id)) {
            const p = pending.get(m.id); pending.delete(m.id);
            m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
        }
    });
    await send('Runtime.enable');
    await sleep(2500);
    for (let i = 0; i < 100; i++) {
        if (await evalJs('document.body.classList.contains("sd-docks-ready")')) break;
        await sleep(400);
    }

    const out = await evalJs(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const d = window.__director;
    const V = scene.camera.position.constructor;
    const res = {};

    // 两个机位，A 在近处、B 在远处
    scene.camera.setPose(new V(0, 1.2, -3.0), new V(0, 0.7, 0), 0);
    scene.forceRender = true;
    await wait(1200);
    const A = d.addShot();
    await wait(400);

    scene.camera.setPose(new V(0, 1.2, -6.0), new V(0, 0.7, 0), 0);
    scene.forceRender = true;
    await wait(1200);
    const B = d.addShot();
    await wait(600);

    const mA = () => scene.app.root.findByName('shot-marker-' + A.id);
    const mB = () => scene.app.root.findByName('shot-marker-' + B.id);

    // 站在 A 上：A 应隐藏，B 应可见
    d.gotoShot(A.id);
    await wait(1500);
    res.atA = { aEnabled: mA() ? mA().enabled : null, bEnabled: mB() ? mB().enabled : null };

    // 站在 B 上：反过来
    d.gotoShot(B.id);
    await wait(1500);
    res.atB = { aEnabled: mA() ? mA().enabled : null, bEnabled: mB() ? mB().enabled : null };

    // 退远：两个都可见
    scene.camera.setPose(new V(0, 2.4, -12.0), new V(0, 0.7, 0), 0);
    scene.forceRender = true;
    await wait(1500);
    res.farAway = { aEnabled: mA() ? mA().enabled : null, bEnabled: mB() ? mB().enabled : null };

    // 渲染期间仍然全部隐藏（capturing 生效），渲染后恢复就近规则
    d.gotoShot(A.id);
    await wait(1200);
    const r = await d.renderShot(A.id, 320, 180);
    await wait(600);
    res.render = { ok: r.ok, bytes: r.bytes };
    res.afterRender = { aEnabled: mA() ? mA().enabled : null, bEnabled: mB() ? mB().enabled : null };

    return res;
  })()`);
    console.log(JSON.stringify(out, null, 1));
} catch (e) {
    console.error('ERR', e.message);
} finally {
    try { ws?.close(); } catch {}
    edge.kill(); srv.kill();
    setTimeout(() => process.exit(0), 500);
}
