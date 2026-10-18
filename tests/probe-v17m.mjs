/* probe_v17m.mjs - 单独验证 capsule 投影是否把点推出包围盒/推到相机背后
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4230;
const CDP = 9295;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v17m-${Date.now()}`,
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

    // 复刻 WL 全部步骤含 capsule
    const mi0 = ent.findComponents('render')[0].meshInstances.find(m => m.aabb);
    const BC = mi0.aabb.constructor;
    const box = new BC();
    let any = false;
    (ent.findComponents('render') || []).forEach(rc => (rc.meshInstances || []).forEach(mi => {
      if (!mi.aabb) return;
      if (!any) { box.copy(mi.aabb); any = true; } else box.add(mi.aabb);
    }));

    const e = new V();
    const okBox = box.intersectsRay(ray, e);
    const beforeCapsule = e.clone();

    // capsule
    const n = box.center, hs = box.halfExtents;
    const rad = 0.85 * Math.max(hs.x, hs.z);
    const lo = n.y - hs.y, hi = n.y + hs.y;
    const y = Math.min(Math.max(e.y, lo + rad), hi - rad);
    const dx = e.x - n.x, dz = e.z - n.z;
    const dist = Math.hypot(dx, dz);
    if (dist > rad) { const k = rad / dist; e.x = n.x + dx * k; e.z = n.z + dz * k; }
    e.y = y;

    const a = new V();
    a.sub2(e, ray.origin);
    const t = a.dot(ray.direction);

    return {
      boxOk: okBox,
      hitBeforeCapsule: beforeCapsule.toArray().map(v => +v.toFixed(3)),
      hitAfterCapsule: e.toArray().map(v => +v.toFixed(3)),
      capsuleRadius: +rad.toFixed(3),
      t,
      tNegative: t < 0,
      isFiniteT: isFinite(t)
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
