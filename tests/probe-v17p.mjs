/* probe_v17p.mjs - 验证测量工具点击落在模型表面（而非包围盒外）
 * measure 的 pickAt 优先用 pickSceneObject，若无 target 才回落到泼溅。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4233;
const CDP = 9298;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v17p-${Date.now()}`,
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
    d.switchCharacter('woman');
    for (let i = 0; i < 50; i++) { await wait(300); if (d.info().loaded) break; }
    const V = d.cursorRoot.getLocalPosition().constructor;
    d.placeCursor(new V(0, 0, 0));
    d.addPuppet();
    await wait(2500);

    const ent = d.puppets[0].entity;
    const base = ent.getPosition();
    const target = new V(base.x, base.y + 0.9, base.z);
    const cam = scene.camera;
    cam.setFocalPoint(target.clone(), 0);
    cam.setAzimElev(0, -5, 0);
    cam.setDistance(1.5, 0);
    scene.forceRender = true;
    await wait(2500);

    // 三个高度：头、胸、脚，检查落点是否贴在人偶表面
    const W = scene.canvas.clientWidth, H = scene.canvas.clientHeight;
    const probe = (label, yOff) => {
      const t = new V(base.x, base.y + yOff, base.z);
      const sp = new V();
      cam.worldToScreen(t, sp);
      return { label, y: yOff, sx: sp.x * W, sy: sp.y * H };
    };
    const pts = [probe('head', 1.55), probe('chest', 0.9), probe('knee', 0.45)];

    const res = [];
    for (const p of pts) {
      const snap = await d.snapPosition(p.sx, p.sy);
      let on = false;
      if (snap) {
        (ent.findComponents('render') || []).forEach(rc => (rc.meshInstances || []).forEach(mi => {
          if (!mi.aabb) return;
          const mn = mi.aabb.getMin(), mx = mi.aabb.getMax();
          if (snap.x >= mn.x - 0.06 && snap.x <= mx.x + 0.06 &&
              snap.y >= mn.y - 0.06 && snap.y <= mx.y + 0.06 &&
              snap.z >= mn.z - 0.06 && snap.z <= mx.z + 0.06) on = true;
        }));
      }
      res.push({
        label: p.label,
        click: [Math.round(p.sx), Math.round(p.sy)],
        snap: snap ? snap.toArray().map(v => +v.toFixed(3)) : null,
        onPuppet: on
      });
    }
    return res;
  })()`);
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 500);
}
