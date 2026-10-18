/* probe_v17f.mjs - 逐层拆解拾取：包围盒命中 vs 每网格命中 vs 人偶真实几何
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4223;
const CDP = 9288;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v17f-${Date.now()}`,
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
    await wait(2200);

    const ent = d.puppets[0].entity;
    const base = ent.getPosition();
    const target = new V(base.x, base.y + 0.9, base.z);

    const cam = scene.camera;
    cam.setFocalPoint(target.clone(), 0);
    cam.setAzimElev(0, -5, 0);
    cam.setDistance(1.5, 0);
    scene.forceRender = true;
    await wait(2500);

    const W = scene.canvas.clientWidth, H = scene.canvas.clientHeight;
    const sp = new V();
    cam.worldToScreen(target, sp);
    const cx = sp.x * W, cy = sp.y * H;

    const RayC = new V().constructor;   // 拿不到 Ray 类，用 getRay 构造
    const ray = { origin: null, direction: null, set(o, dd) { this.origin = o.clone(); this.direction = dd.clone(); } };
    cam.getRay(cx, cy, ray);

    const BBox = (await import('/www/index.js').catch(() => null)) ? null : null;

    // 用 pickSceneObject 的公开结果
    const pk = window.__pickSceneObject ? window.__pickSceneObject(scene, cx, cy) : null;

    // 每个 mesh 的 aabb 命中测试，用 PlayCanvas 的 BoundingBox
    const boxes = [];
    (ent.findComponents('render') || []).forEach((rc, ri) => {
      (rc.meshInstances || []).forEach((mi, ii) => {
        if (!mi.aabb) return;
        const b = mi.aabb;
        const hitP = new V();
        // 手工 slab 测试，避免依赖类
        const o = ray.origin, dir = ray.direction;
        const mn = b.getMin(), mx = b.getMax();
        let t0 = -1e9, t1 = 1e9;
        for (const ax of ['x','y','z']) {
          const inv = 1 / dir[ax];
          let ta = (mn[ax] - o[ax]) * inv;
          let tb = (mx[ax] - o[ax]) * inv;
          const lo = Math.min(ta, tb), hi = Math.max(ta, tb);
          t0 = Math.max(t0, lo); t1 = Math.min(t1, hi);
        }
        if (t1 >= Math.max(t0, 0)) {
          const t = Math.max(t0, 0);
          hitP.copy(dir).mulScalar(t).add(o);
          boxes.push({
            ri, ii,
            min: mn.toArray().map(v => +v.toFixed(2)),
            max: mx.toArray().map(v => +v.toFixed(2)),
            t: +t.toFixed(3),
            hit: hitP.toArray().map(v => +v.toFixed(3))
          });
        }
      });
    });

    return {
      target: target.toArray().map(v => +v.toFixed(2)),
      click: [Math.round(cx), Math.round(cy)],
      rayOrigin: ray.origin.toArray().map(v => +v.toFixed(2)),
      rayDir: ray.direction.toArray().map(v => +v.toFixed(3)),
      puppetWorld: ent.getPosition().toArray().map(v => +v.toFixed(2)),
      pickResult: pk ? { pos: pk.position.toArray().map(v => +v.toFixed(3)), entity: pk.entity.name } : null,
      meshBoxHits: boxes
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
