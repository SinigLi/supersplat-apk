/* probe-v22a.mjs — v22 验收
 *
 * 1. 相机模型不再随屏幕缩放：把相机拉远/推近，marker 的 localScale 必须不变
 *    （v21 是像素恒定，scale 会随距离变化；v22 应该恒定）
 * 2. 相机模型的屏幕投影尺寸会随距离变化（这正是"正常渲染"的含义）
 * 3. 预览层有 保存到相册 / 另存为 / 分享 / 关闭 四个按钮
 * 4. 网页环境点这三个按钮应明确提示"仅 APK 内可用"，不能静默
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4270;
const CDP = 9330;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
    '--use-angle=d3d11', '--window-size=390,844',
    `--user-data-dir=${process.env.TEMP}/edge-v22a-${Date.now()}`,
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

    // 放一只猫做参照物（老板说的"跟其他猫模型一样大小"）
    d.switchCharacter('tuxedo');
    for (let i = 0; i < 120; i++) { if (d.addPuppet() === 'ok') break; await wait(300); }
    await wait(1400);

    // 建一个机位
    scene.camera.setPose(new V(0, 1.2, -3.2), new V(0, 0.6, 0), 0);
    scene.forceRender = true;
    await wait(1300);
    const shot = d.addShot();
    await wait(600);

    const marker = scene.app.root.findByName('shot-marker-' + shot.id);
    if (!marker) { res.error = 'marker missing'; return res; }

    // ---- 1. 世界尺寸是否恒定 ----
    const scaleNear = marker.getLocalScale().toArray().map(v => +v.toFixed(4));
    scene.camera.setPose(new V(0, 1.2, -9.0), new V(0, 0.6, 0), 0);
    scene.forceRender = true;
    await wait(1300);
    const scaleFar = marker.getLocalScale().toArray().map(v => +v.toFixed(4));
    res.scaleFixed = {
      near: scaleNear,
      far: scaleFar,
      unchanged: Math.abs(scaleNear[0] - scaleFar[0]) < 1e-6
    };

    // ---- 2. 屏幕投影尺寸应随距离变化（正常物体行为）----
    const projectSpan = () => {
      // 把 marker 的世界包围盒中心/边缘投到屏幕
      const p = marker.getPosition();
      const span = marker.getLocalScale().x;   // 近似世界尺寸
      const a = new V(p.x - span * 0.5, p.y, p.z);
      const b = new V(p.x + span * 0.5, p.y, p.z);
      const sa = new V(), sb = new V();
      scene.camera.worldToScreen(a, sa);
      scene.camera.worldToScreen(b, sb);
      const w = scene.canvas.clientWidth || 1;
      return +Math.abs((sb.x - sa.x) / w * 100).toFixed(2);   // 屏宽百分比
    };
    const spanFar = projectSpan();
    scene.camera.setPose(new V(0, 1.2, -2.0), new V(0, 0.6, 0), 0);
    scene.forceRender = true;
    await wait(1300);
    const spanNear = projectSpan();
    res.screenSpan = {
      atDist9: spanFar,
      atDist2: spanNear,
      changesWithDistance: Math.abs(spanFar - spanNear) > 0.1,
      note: 'v22 期望 true（正常物体），v21 是恒定'
    };

    // 猫的缩放做对照
    res.catScale = +d.puppets[0].entity.getLocalScale().x.toFixed(3);

    // ---- 3/4. 预览层三个按钮 ----
    const camGrp = Array.from(document.querySelectorAll('.sd-grp-btn'))
      .find(b => (b.textContent || '').includes('相机'));
    camGrp.click();
    await wait(800);
    const wrap = Array.from(document.querySelectorAll('.sd-sub-wrap.sd-open'))
      .find(w => w.querySelector('.sd-shot-list'));
    wrap.querySelector('.sd-shot-list').value = String(shot.id);
    wrap.querySelector('.sd-shot-btn[data-shot="render"]').click();

    let layer = null;
    for (let i = 0; i < 60; i++) {
      layer = document.getElementById('sd-shot-preview');
      if (layer && layer.querySelector('img') && layer.querySelector('img').complete) break;
      await wait(400);
    }
    res.preview = layer ? {
      buttons: Array.from(layer.querySelectorAll('.sd-shot-actions button')).map(b => ({
        cls: b.className, label: b.textContent
      }))
    } : null;

    if (layer) {
      // 网页环境：三个动作都应提示不支持，而不是静默失败
      const results = [];
      for (const cls of ['sd-shot-save', 'sd-shot-saveas', 'sd-shot-share']) {
        const b = layer.querySelector('.' + cls);
        b.click();
        await wait(500);
        results.push({ cls, label: b.textContent, disabled: b.disabled });
      }
      res.webActions = results;
      layer.querySelector('.sd-shot-close').click();
    }

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
