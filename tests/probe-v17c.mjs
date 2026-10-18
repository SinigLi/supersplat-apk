/* probe_v17c.mjs - 正确验证 getRay / snapPosition 精度
 *
 * 1) 相机对准人偶，人偶投影到屏幕（必须在 0..1 内）
 * 2) 用 getRay(sx,sy) 反算射线，检查射线到人偶的垂距（应≈0）
 * 3) 调 director.snapPosition(sx,sy)，看落点是否就在人偶身上
 * 4) 再测一个偏屏幕边缘的点，看误差是否随离中心距离放大（DPR/尺寸换算错误的特征）
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4220;
const CDP = 9285;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v17c-${Date.now()}`,
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
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2.75, mobile: true });
  await sleep(2500);
  for (let i = 0; i < 100; i++) {
    if (await evalJs('document.body.classList.contains("sd-docks-ready")')) break;
    await sleep(400);
  }

  const out = await evalJs(`(async () => {
    const d = window.__director;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    d.switchCharacter('woman');
    for (let i = 0; i < 50; i++) { await wait(300); if (d.info().loaded) break; }
    const V = d.cursorRoot.getLocalPosition().constructor;
    d.placeCursor(new V(0, 0, 0));
    d.addPuppet();
    await wait(1800);

    const ent = d.puppets[0].entity;
    const base = ent.getPosition();
    const target = new V(base.x, base.y + 0.9, base.z);   // 胸口

    const cam = scene.camera;
    cam.setFocalPoint(target.clone(), 0);
    cam.setAzimElev(0, -5, 0);
    cam.setDistance(1.5, 0);
    scene.forceRender = true;
    await wait(2500);

    const W = scene.canvas.clientWidth, H = scene.canvas.clientHeight;
    const sp = new V();
    cam.worldToScreen(target, sp);

    const fake = { origin: null, direction: null, set(o, dd) { this.origin = o.clone(); this.direction = dd.clone(); } };
    const measure = async (label, cx, cy) => {
      cam.getRay(cx, cy, fake);
      const oc = new V().sub2(target, fake.origin);
      const proj = oc.dot(fake.direction);
      const closest = new V().copy(fake.direction).mulScalar(proj).add(fake.origin);
      const missDist = closest.distance(target);

      // snapPosition 落点
      let snap = null;
      try {
        const p = await d.snapPosition(cx, cy);
        snap = p ? p.toArray().map(v => +v.toFixed(3)) : null;
      } catch (e) { snap = 'err:' + e.message; }

      return {
        label,
        click: [Math.round(cx), Math.round(cy)],
        rayMissToTarget: +missDist.toFixed(4),
        snap,
        snapDistToTarget: snap && Array.isArray(snap)
          ? +new V(snap[0], snap[1], snap[2]).distance(target).toFixed(3) : null
      };
    };

    const centerX = sp.x * W, centerY = sp.y * H;
    const r1 = await measure('at-puppet', centerX, centerY);
    // 往右偏 60 CSS 像素
    const r2 = await measure('offset-60px', Math.min(W - 4, centerX + 60), centerY);
    // 往左下偏
    const r3 = await measure('offset-120px', Math.max(4, centerX - 120), Math.min(H - 4, centerY + 80));

    return {
      dpr: window.devicePixelRatio,
      canvas: [W, H],
      drawingBuffer: [scene.canvas.width, scene.canvas.height],
      puppetScreen: [+centerX.toFixed(1), +centerY.toFixed(1)],
      onScreen: sp.x >= 0 && sp.x <= 1 && sp.y >= 0 && sp.y <= 1,
      target: target.toArray().map(v => +v.toFixed(2)),
      samples: [r1, r2, r3]
    };
  })()`);
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 500);
}
