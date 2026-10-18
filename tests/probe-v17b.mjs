/* probe_v17b.mjs - 验证 getRay 在 devicePixelRatio != 1 时是否偏移
 *
 * 怀疑点：CameraComponent.screenToWorld 内部用 device.clientRect（绘制缓冲像素，
 * 已乘 DPR）做分母，而调用方传的是 CSS 像素坐标。DPR=1 时看不出问题，
 * 手机上 DPR≈2.75 就会把射线打偏，越远离屏幕中心偏得越多。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4219;
const CDP = 9284;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v17b-${Date.now()}`,
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
  return r.result?.value;
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
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2.75, mobile: true
  });
  await sleep(2500);
  for (let i = 0; i < 100; i++) {
    if (await evalJs('document.body.classList.contains("sd-docks-ready")')) break;
    await sleep(400);
  }

  const out = await evalJs(`(() => {
    const cam = scene.camera;
    const canvas = scene.canvas;
    const dev = scene.app.graphicsDevice;

    // 一个远离屏幕中心的目标点
    const target = new (scene.bound.center.constructor)(3, 1, 2);
    cam.setFocalPoint(new (scene.bound.center.constructor)(0, 0, 0), 0);
    cam.setAzimElev(30, -20, 0);
    cam.setDistance(2.0, 0);
    scene.forceRender = true;
    cam.onUpdate(0);

    const sp = new (scene.bound.center.constructor)();
    cam.worldToScreen(target, sp);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const sx = sp.x * W, sy = sp.y * H;

    // 假 Ray：只需要 set()
    const fake = { origin: null, direction: null, set(o, d) { this.origin = o.clone(); this.direction = d.clone(); } };
    cam.getRay(sx, sy, fake);

    const oc = new (scene.bound.center.constructor)().sub2(target, fake.origin);
    const proj = oc.dot(fake.direction);
    const closest = new (scene.bound.center.constructor)().copy(fake.direction).mulScalar(proj).add(fake.origin);

    return {
      dpr: window.devicePixelRatio,
      canvasCss: [W, H],
      deviceClientRect: [dev.clientRect.width, dev.clientRect.height],
      drawingBuffer: [canvas.width, canvas.height],
      screenCss: [+sx.toFixed(2), +sy.toFixed(2)],
      target: target.toArray().map(v => +v.toFixed(2)),
      // 射线到目标的垂距：正常应接近 0，若被 DPR 打偏会明显 > 0
      rayMissDistance: +closest.distance(target).toFixed(4)
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
