/* probe-v21a.mjs — v21 验收
 *
 * 1. 新增机位后场景里真的多了一个相机模型，位置就是记录时的相机位置
 * 2. 相机模型朝向目标的 -Z（lookAt 相机约定）
 * 3. 相机模型按屏幕像素缩放（远近不同但屏幕尺寸恒定）
 * 4. 渲染照片期间相机模型被隐藏，渲染后恢复
 * 5. 预览层有「保存到相册」按钮（网页环境下应报告不支持，而不是静默失败）
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4260;
const CDP = 9320;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
    '--use-angle=d3d11', '--window-size=390,844',
    `--user-data-dir=${process.env.TEMP}/edge-v21a-${Date.now()}`,
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

    // ---- 1. 建两个机位，检查场景里出现相机模型 ----
    scene.camera.setPose(new V(0, 1.2, -3.2), new V(0, 0.8, 0), 0);
    scene.forceRender = true;
    await wait(1200);
    const s1 = d.addShot();
    await wait(400);

    scene.camera.setPose(new V(2.5, 1.6, -2.0), new V(0, 0.6, 0), 0);
    scene.forceRender = true;
    await wait(1200);
    const s2 = d.addShot();
    await wait(600);

    const findMarkers = () => {
      const out = [];
      scene.app.root.forEach(function(e){ if (e.name && e.name.indexOf('shot-marker-') === 0) out.push(e); });
      return out;
    };
    let markers = findMarkers();
    res.markerCount = markers.length;
    res.shotCount = d.listShots().length;

    // 位置是否等于机位位置
    res.markerPositions = markers.map(m => m.getLocalPosition().toArray().map(v => +v.toFixed(2)));
    res.shotPositions = d.listShots().map(s => s.pos.map(v => +v.toFixed(2)));

    // ---- 2. 朝向：模型 -Z 是否指向 target ----
    res.markers = d.listShots().map(s => {
      const m = scene.app.root.findByName('shot-marker-' + s.id);
      if (!m) return { id: s.id, missing: true };
      const fwd = m.forward;
      const tgt = new V(s.target[0], s.target[1], s.target[2]);
      const toTarget = tgt.sub(m.getPosition()).normalize();
      const dot = +fwd.dot(toTarget).toFixed(3);
      return { id: s.id, forwardDotTarget: dot, childCount: m.children.length };
    });

    // ---- 3. 屏幕像素缩放：换个距离看 scale 是否变化 ----
    const m1 = scene.app.root.findByName('shot-marker-' + s1.id);
    const scaleFar = +m1.getLocalScale().x.toFixed(4);
    scene.camera.setPose(new V(0, 1.2, -8.0), new V(0, 0.8, 0), 0);
    scene.forceRender = true;
    await wait(1200);
    const scaleNear = +m1.getLocalScale().x.toFixed(4);
    res.markerScale = { atDist3: scaleFar, atDist8: scaleNear, changesWithDistance: Math.abs(scaleFar - scaleNear) > 1e-3 };

    // ---- 4. 渲染时隐藏 / 之后恢复 ----
    scene.camera.setPose(new V(0, 1.2, -3.2), new V(0, 0.8, 0), 0);
    scene.forceRender = true;
    await wait(1200);
    const beforeEnabled = markers.map(m => m.enabled);
    const r = await d.renderShot(s1.id, 480, 270);
    await wait(400);
    const afterEnabled = findMarkers().map(m => m.enabled);
    res.render = { ok: r.ok, bytes: r.bytes, wh: [r.width, r.height] };
    res.markerVisibility = { before: beforeEnabled, after: afterEnabled };

    // ---- 5. 预览层保存按钮 ----
    // 预览层是闭包内的函数，只能走 UI 点击触发
    const camGrp = Array.from(document.querySelectorAll('.sd-grp-btn'))
      .find(b => (b.textContent || '').includes('相机'));
    camGrp.click();
    await wait(800);
    const wrap = Array.from(document.querySelectorAll('.sd-sub-wrap.sd-open'))
      .find(w => w.querySelector('.sd-shot-list'));
    const list = wrap.querySelector('.sd-shot-list');
    list.value = String(s1.id);
    wrap.querySelector('.sd-shot-btn[data-shot="render"]').click();

    let layerEl = null;
    for (let i = 0; i < 60; i++) {
      layerEl = document.getElementById('sd-shot-preview');
      if (layerEl && layerEl.querySelector('img') && layerEl.querySelector('img').complete) break;
      await wait(400);
    }
    res.preview = layerEl ? {
      hasSaveBtn: !!layerEl.querySelector('.sd-shot-save'),
      saveLabel: (layerEl.querySelector('.sd-shot-save') || {}).textContent || null,
      hasClose: !!layerEl.querySelector('.sd-shot-close'),
      tip: (layerEl.querySelector('.sd-shot-tip') || {}).textContent || null
    } : null;

    // 点保存：网页环境没有原生插件，应该明确提示而不是静默
    if (layerEl) {
      layerEl.querySelector('.sd-shot-save').click();
      await wait(900);
      res.saveInWeb = {
        stillThere: !!document.getElementById('sd-shot-preview'),
        label: (layerEl.querySelector('.sd-shot-save') || {}).textContent || null
      };
      const c = layerEl.querySelector('.sd-shot-close');
      if (c) c.click();
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
