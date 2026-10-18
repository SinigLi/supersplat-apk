/* probe_v17k.mjs - 精确复现 pickSceneObject 的每一步，定位失败环节
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4228;
const CDP = 9293;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v17k-${Date.now()}`,
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

    const W = scene.canvas.clientWidth, H = scene.canvas.clientHeight;
    const sp = new V();
    cam.worldToScreen(target, sp);
    const cx = sp.x * W, cy = sp.y * H;

    const ray = { origin: null, direction: null, set(o, dd) { this.origin = o.clone(); this.direction = dd.clone(); } };
    cam.getRay(cx, cy, ray);

    // 拿真正的 BoundingBox 类：从 mi.aabb 的 constructor
    const mi0 = ent.findComponents('render')[0].meshInstances.find(m => m.aabb);
    const BC = mi0.aabb.constructor;
    const minV = mi0.aabb.getMin().constructor;

    const box = new BC();
    box.setMinMax(
      new minV(-0.3833, -0.0310, -0.4043),
      new minV(0.4388, 1.7655, 0.3504)
    );
    const hit = new minV();
    const ok = box.intersectsRay(ray, hit);

    // 逐网格
    const perMesh = [];
    (ent.findComponents('render') || []).forEach(rc => (rc.meshInstances || []).forEach(mi => {
      if (!mi.aabb) return;
      const h = new minV();
      const r = mi.aabb.intersectsRay(ray, h);
      perMesh.push({ hit: r, t: r ? +h.sub(ray.origin).dot(ray.direction).toFixed(3) : null, min: mi.aabb.getMin().toArray().map(v=>+v.toFixed(2)), max: mi.aabb.getMax().toArray().map(v=>+v.toFixed(2)) });
    }));

    // pickSceneObject 实际返回
    const pick = window.__pickSceneObject ? window.__pickSceneObject(scene, cx, cy) : null;

    return {
      click: [Math.round(cx), Math.round(cy)],
      ray: { o: ray.origin.toArray().map(v=>+v.toFixed(3)), d: ray.direction.toArray().map(v=>+v.toFixed(3)) },
      mergedBoxIntersects: ok,
      mergedHit: ok ? hit.toArray().map(v=>+v.toFixed(3)) : null,
      perMesh,
      pick: pick ? pick.position.toArray().map(v=>+v.toFixed(3)) : null,
      nPickables: window.__pickables().length
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
