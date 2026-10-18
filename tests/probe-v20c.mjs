/* probe-v20c.mjs — 查「渲染照片」是不是真的拍到了东西
 *
 * v20b 显示 640x360 出图只有 0.9% 非黑像素。两种可能：
 *   A) 取景问题：setDistance 是按 sceneRadius 归一化的，场景空时半径很小，
 *      distance=3 其实把人偶推到了很远。
 *   B) 渲染管线问题：offscreen 根本没画出来。
 * 用显式世界坐标摆相机 + 读 sceneRadius 来区分。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4252;
const CDP = 9312;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v20c-${Date.now()}`,
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
    const res = {};
    const V = scene.camera.position.constructor;

    for (let i = 0; i < 120; i++) {
      if (d.addPuppet() === 'ok') break;
      await wait(300);
    }
    await wait(1800);

    res.sceneRadius = +scene.camera.sceneRadius.toFixed(3);
    res.canvas = [scene.canvas.clientWidth, scene.canvas.clientHeight];

    // 人偶真实包围盒（判断它有多大、站在哪）
    const p0 = d.puppets[0];
    const mi = p0.entity.findComponents('render')[0];
    const aabb = mi.meshInstances[0].aabb;
    res.puppetAabb = {
      min: aabb.getMin().toArray().map(v => +v.toFixed(2)),
      max: aabb.getMax().toArray().map(v => +v.toFixed(2))
    };
    res.puppetScale = +p0.entity.getLocalScale().x.toFixed(4);

    // 相机：显式世界坐标，贴身看人偶
    const cam = scene.camera;
    const eye = new V(0, 1.2, -2.6);
    const tgt = new V(0, 0.9, 0);
    cam.setPose(eye, tgt, 0);
    scene.forceRender = true;
    await wait(1500);
    res.camAfterPose = {
      pos: cam.position.toArray().map(v => +v.toFixed(2)),
      dist: +cam.distance.toFixed(3)
    };

    // 采样渲染
    const W = 480, H = 480;
    const sample = (raw) => {
      let nz = 0, nb = 0, s = 0;
      for (let i = 0; i < raw.length; i += 4 * 5) {
        if (raw[i] || raw[i+1] || raw[i+2] || raw[i+3]) nz++;
        if (raw[i] > 8 || raw[i+1] > 8 || raw[i+2] > 8) nb++;
        s++;
      }
      return { s, nonZeroPct: +(100*nz/s).toFixed(1), nonBlackPct: +(100*nb/s).toFixed(1) };
    };

    const raw1 = await d.events.invoke('render.offscreen', W, H);
    res.offscreenCloseup = { bytes: raw1.length, ...sample(raw1) };

    // 走 renderShot 全流程（它会 goto 到机位再出图）
    const shot = d.addShot('测试机位');
    res.shotPose = { pos: shot.pos.map(v => +v.toFixed(2)), target: shot.target.map(v => +v.toFixed(2)) };
    const r = await d.renderShot(shot.id, W, H);
    res.renderShot = r;

    // 再截一帧真实视口做对照（CDP 截图在 Node 侧做，这里只回报状态）
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
