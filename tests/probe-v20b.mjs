/* probe-v20b.mjs — 验证「渲染照片」是否真的出图（不是黑图）
 *
 * 1074 字节的 640x360 PNG 是纯色图的体量。直接调 render.offscreen 拿原始
 * RGBA，统计非零像素比例，判断到底渲染到了什么。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4251;
const CDP = 9311;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v20b-${Date.now()}`,
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

    // 先放一个人偶，确保画面里有东西
    for (let i = 0; i < 120; i++) {
      if (d.addPuppet() === 'ok') break;
      await wait(300);
    }
    await wait(1500);
    res.puppets = d.puppets.length;

    // 角色实际缩放（从实体读，不依赖 listCharacters 字段）
    res.actual = d.puppets.map(p => ({
      charId: p.charId,
      scale: +p.entity.getLocalScale().x.toFixed(4)
    }));

    // 对准人偶
    const V = scene.camera.position.constructor;
    scene.camera.setFocalPoint(new V(0, 0.9, 0), 0);
    scene.camera.setAzimElev(30, -15, 0);
    scene.camera.setDistance(3, 0);
    scene.forceRender = true;
    await wait(1500);

    // 直接调 render.offscreen，统计像素
    const W = 640, H = 360;
    const raw = await d.events.invoke('render.offscreen', W, H);
    let nonZero = 0, nonBlack = 0;
    const step = 4 * 7;   // 抽样，避免 92 万字节的逐字节开销
    let samples = 0;
    for (let i = 0; i < raw.length; i += step) {
      const r = raw[i], g = raw[i+1], b = raw[i+2], a = raw[i+3];
      samples++;
      if (r || g || b || a) nonZero++;
      if (r > 8 || g > 8 || b > 8) nonBlack++;
    }
    res.offscreen = {
      bytes: raw.length,
      samples,
      nonZeroPct: +(100 * nonZero / samples).toFixed(1),
      nonBlackPct: +(100 * nonBlack / samples).toFixed(1)
    };

    // 再走 renderShot（会自己 goto + 出 png）
    const shot = d.addShot();
    const r = await d.renderShot(shot.id, W, H);
    res.renderShot = r;

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
