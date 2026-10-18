/* probe_v18d.mjs - 验证游标固定屏幕像素大小
 *
 * 做法：把游标放到场景中心，投影"中心"和"轴向端点"到屏幕，
 * 量出屏幕上的像素跨度。分别在：
 *   A) 原始尺寸，相机近
 *   B) 17 倍模型，相机远
 *   C) 再拉远一倍
 * 三次的像素跨度应基本一致（固定屏幕比例）。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4243;
const CDP = 9303;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v18d-${Date.now()}`,
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
    const d = window.__director;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const V = d.cursorRoot.getLocalPosition().constructor;

    d.placeCursor(new V(0, 0, 0));
    await wait(500);

    const cam = scene.camera;
    const W = scene.canvas.clientWidth, H = scene.canvas.clientHeight;

    // 量屏幕像素跨度：中心到 +X 轴端点
    const measure = () => {
      const root = d.cursorRoot;
      const p = root.getPosition();
      // 轴向端点在世界里 = 中心 + 本地 X 跨度 * 缩放
      const halfX = 0.24 * root.getLocalScale().x;   // CURSOR_BASE_SPAN/2 * scale
      const a = new V(p.x, p.y, p.z);
      const b = new V(p.x + halfX, p.y, p.z);
      const sa = new V(), sb = new V();
      cam.worldToScreen(a, sa);
      cam.worldToScreen(b, sb);
      return {
        scale: +root.getLocalScale().x.toFixed(5),
        pixelHalfSpan: +Math.abs(sb.x - sa.x) * W.toFixed(1),
        pixelSpan: +(Math.abs(sb.x - sa.x) * W * 2).toFixed(1),
        worldHalfSpan: +halfX.toFixed(4)
      };
    };

    const results = [];

    // A) 默认距离
    cam.setFocalPoint(new V(0, 0, 0), 0);
    cam.setAzimElev(0, -10, 0);
    cam.setDistance(1.0, 0);
    scene.forceRender = true;
    await wait(1500);
    results.push({ case: 'A dist=1.0', ...measure() });

    // C) 拉远 4 倍
    cam.setDistance(4.0, 0);
    scene.forceRender = true;
    await wait(1500);
    results.push({ case: 'B dist=4.0', ...measure() });

    // D) 拉近
    cam.setDistance(0.25, 0);
    scene.forceRender = true;
    await wait(1500);
    results.push({ case: 'C dist=0.25', ...measure() });

    return { canvas: [W, H], results };
  })()`);
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 500);
}
