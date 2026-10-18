/* probe_v16i.mjs - GLB 渲染节点摘要 + 视锥剔除检查（紧凑输出）
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4215;
const CDP = 9280;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v16i-${Date.now()}`,
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

  await evalJs(`(async () => {
    const d = window.__director;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const res = await fetch('/www/static/director/shiba.glb');
    const blob = await res.blob();
    d.importModel(new File([blob], 'shiba.glb'));
    for (let i = 0; i < 60; i++) { await wait(300); if ((d.listProps() || []).length) break; }
    await wait(1200);
    return true;
  })()`);

  const info = await evalJs(`(() => {
    const d = window.__director;
    const ent = d.props[0].entity;
    let renders = 0, meshes = 0, withAabb = 0;
    const sample = [];
    const walk = (e) => {
      if (e.render && e.render.meshInstances) {
        renders++;
        e.render.meshInstances.forEach((mi) => {
          meshes++;
          if (mi.aabb) withAabb++;
          if (sample.length < 3) {
            sample.push({
              mesh: mi.mesh ? mi.mesh.name : null,
              aabbCenter: mi.aabb ? mi.aabb.center.toArray().map(v => +v.toFixed(2)) : null,
              aabbHalf: mi.aabb ? mi.aabb.halfExtents.toArray().map(v => +v.toFixed(2)) : null,
              visible: mi.visible
            });
          }
        });
      }
      e.children.forEach(walk);
    };
    walk(ent);
    return { renders, meshes, withAabb, sample, entPos: ent.getPosition().toArray().map(v => +v.toFixed(2)) };
  })()`);
  console.log('GLB', JSON.stringify(info));

  // 把 GLB 挪到偏离中心，绕一圈看视锥/屏幕投影
  await evalJs(`(() => {
    const d = window.__director;
    const ent = d.props[0].entity;
    ent.setLocalPosition(5, 1, 0);
    scene.forceRender = true;
    return true;
  })()`);
  await sleep(1500);

  const rows = [];
  for (const az of [0, 90, 180, 270]) {
    await evalJs(`(() => {
      const cam = scene.camera;
      const b = scene.bound;
      cam.lookCameraPos = null;
      cam.setFocalPoint(b.center.clone(), 0);
      cam.setAzimElev(${az}, -8, 0);
      cam.setDistance(1.9, 0);
      scene.forceRender = true;
      return true;
    })()`);
    await sleep(1200);
    const r = await evalJs(`(() => {
      const d = window.__director;
      const ent = d.props[0].entity;
      const p = ent.getPosition();
      const V = p.constructor;
      const v = new V(p.x, p.y + 0.4, p.z);
      scene.camera.worldToScreen(v, v);
      const camPos = scene.camera.mainCamera.getPosition();
      const dist = camPos.distance(p);
      return {
        az: ${az},
        entPos: p.toArray().map(x => +x.toFixed(2)),
        camPos: camPos.toArray().map(x => +x.toFixed(2)),
        distToEnt: +dist.toFixed(2),
        ndc: [Math.round(v.x * 1000) / 1000, Math.round(v.y * 1000) / 1000],
        onScreen: v.x >= 0 && v.x <= 1 && v.y >= 0 && v.y <= 1,
        near: +scene.camera.near.toFixed(4),
        far: +scene.camera.far.toFixed(2)
      };
    })()`);
    rows.push(r);
  }
  console.log('AZIM', JSON.stringify(rows, null, 2));
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 500);
}
