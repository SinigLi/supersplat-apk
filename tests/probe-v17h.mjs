/* probe_v17h.mjs - 直接比较：整体包围盒 vs 单网格，看 pickSceneObject 为何 null
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4225;
const CDP = 9290;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v17h-${Date.now()}`,
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
    const ray = { origin: null, direction: null, set(o, dd) { this.origin = o.clone(); this.direction = dd.clone(); } };
    cam.getRay(cx, cy, ray);

    // 手工合并所有 mesh aabb，得到整体盒
    let mnx=1e9,mny=1e9,mnz=1e9,mxx=-1e9,mxy=-1e9,mxz=-1e9;
    let cnt=0;
    (ent.findComponents('render') || []).forEach(rc => (rc.meshInstances || []).forEach(mi => {
      if (!mi.aabb) return; cnt++;
      const mn = mi.aabb.getMin(), mx = mi.aabb.getMax();
      mnx=Math.min(mnx,mn.x); mny=Math.min(mny,mn.y); mnz=Math.min(mnz,mn.z);
      mxx=Math.max(mxx,mx.x); mxy=Math.max(mxy,mx.y); mxz=Math.max(mxz,mx.z);
    }));

    // 整体盒 slab 测试
    const slab = (mn, mx) => {
      const o = ray.origin, dir = ray.direction;
      let t0 = -1e9, t1 = 1e9;
      for (const ax of ['x','y','z']) {
        const inv = 1 / dir[ax];
        const ta = (mn[ax] - o[ax]) * inv, tb = (mx[ax] - o[ax]) * inv;
        if (!isFinite(ta) || !isFinite(tb)) continue;
        t0 = Math.max(t0, Math.min(ta, tb));
        t1 = Math.min(t1, Math.max(ta, tb));
      }
      return t1 >= Math.max(t0, 0) ? +Math.max(t0,0).toFixed(3) : null;
    };
    const mergedHit = slab({x:mnx,y:mny,z:mnz}, {x:mxx,y:mxy,z:mxz});

    // PlayCanvas BoundingBox 复现 worldBound
    let pcHit = null, pcBox = null;
    try {
      const B = ent.render && ent.render.meshInstances[0].aabb.constructor;
      const box = new B();
      let any = false;
      (ent.findComponents('render') || []).forEach(rc => (rc.meshInstances || []).forEach(mi => {
        if (!mi.aabb) return;
        if (!any) { box.copy(mi.aabb); any = true; } else box.add(mi.aabb);
      }));
      pcBox = { min: box.getMin().toArray().map(v=>+v.toFixed(2)), max: box.getMax().toArray().map(v=>+v.toFixed(2)) };
      const hit = new V();
      pcHit = box.intersectsRay(ray, hit) ? hit.toArray().map(v=>+v.toFixed(3)) : null;
    } catch (e) { pcBox = 'err:' + e.message; }

    return {
      meshCount: cnt,
      mergedBox: { min: [+mnx.toFixed(2), +mny.toFixed(2), +mnz.toFixed(2)], max: [+mxx.toFixed(2), +mxy.toFixed(2), +mxz.toFixed(2)] },
      mergedSlabT: mergedHit,
      pcBox,
      pcIntersectsRay: pcHit,
      rayOrigin: ray.origin.toArray().map(v=>+v.toFixed(2)),
      rayDir: ray.direction.toArray().map(v=>+v.toFixed(3)),
      pickResult: (() => { const p = window.__pickSceneObject ? window.__pickSceneObject(scene, cx, cy) : null; return p ? p.position.toArray() : null; })()
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
