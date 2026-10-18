/* probe_v18a.mjs - 用真实院子 GLB 放大 17 倍，测「院内地面吸附」
 *
 * 复现老板的现象：场景放大后，点院子地面吸附不上。
 * 对多个落点分别调 director.snapPosition()，判断：
 *   1. 是否命中模型（落在网格 aabb 内 / 表面附近）
 *   2. 若没命中，落到了哪里（地面 y=0 / 视平面 / 完全跑偏）
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4240;
const CDP = 9300;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v18a-${Date.now()}`,
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

  const setup = await evalJs(`(async () => {
    const d = window.__director;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const res = await fetch('/tests/assets/courtyard.glb');
    const blob = await res.blob();
    d.importModel(new File([blob], 'courtyard.glb'));
    for (let i = 0; i < 120; i++) { await wait(300); if ((d.listProps() || []).length) break; }
    await wait(1500);
    const p = d.props[0];
    if (!p) return { error: 'no prop' };
    const ent = p.entity;
    // 放大 17 倍
    ent.setLocalScale(17, 17, 17);
    ent.setLocalPosition(0, 0, 0);
    scene.invalidateBound();
    scene.forceRender = true;
    await wait(2500);

    // 统计网格与包围盒
    let meshes = 0, minx=1e9,miny=1e9,minz=1e9,maxx=-1e9,maxy=-1e9,maxz=-1e9;
    (ent.findComponents('render') || []).forEach(rc => (rc.meshInstances || []).forEach(mi => {
      if (!mi.aabb) return;
      meshes++;
      const mn = mi.aabb.getMin(), mx = mi.aabb.getMax();
      minx=Math.min(minx,mn.x); miny=Math.min(miny,mn.y); minz=Math.min(minz,mn.z);
      maxx=Math.max(maxx,mx.x); maxy=Math.max(maxy,mx.y); maxz=Math.max(maxz,mx.z);
    }));

    return {
      props: d.listProps().length,
      meshCount: meshes,
      worldBound: {
        min: [+minx.toFixed(2), +miny.toFixed(2), +minz.toFixed(2)],
        max: [+maxx.toFixed(2), +maxy.toFixed(2), +maxz.toFixed(2)]
      },
      scale: ent.getLocalScale().toArray(),
      sceneBound: {
        min: scene.bound.getMin().toArray().map(v=>+v.toFixed(2)),
        max: scene.bound.getMax().toArray().map(v=>+v.toFixed(2))
      }
    };
  })()`);
  console.log('SETUP', JSON.stringify(setup, null, 2));

  // 选一个"院子内部地面"的点：模型包围盒中心偏下，然后投影到屏幕点击
  const out = await evalJs(`(async () => {
    const d = window.__director;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const p = d.props[0];
    const ent = p.entity;
    const V = ent.getPosition().constructor;

    let minx=1e9,miny=1e9,minz=1e9,maxx=-1e9,maxy=-1e9,maxz=-1e9;
    (ent.findComponents('render') || []).forEach(rc => (rc.meshInstances || []).forEach(mi => {
      if (!mi.aabb) return;
      const mn = mi.aabb.getMin(), mx = mi.aabb.getMax();
      minx=Math.min(minx,mn.x); miny=Math.min(miny,mn.y); minz=Math.min(minz,mn.z);
      maxx=Math.max(maxx,mx.x); maxy=Math.max(maxy,mx.y); maxz=Math.max(maxz,mx.z);
    }));
    const cx = (minx+maxx)/2, cz = (minz+maxz)/2;

    // 相机从院子外上方看向院子中心
    const cam = scene.camera;
    const center = new V(cx, (miny+maxy)/2, cz);
    cam.setFocalPoint(center.clone(), 0);
    cam.setAzimElev(35, -35, 0);
    cam.setDistance(2.2, 0);
    scene.forceRender = true;
    await wait(3000);

    const W = scene.canvas.clientWidth, H = scene.canvas.clientHeight;

    // 多个候选落点：院子地面若干高度
    const tryPts = [
      { label: 'floor-low',  y: miny + (maxy-miny)*0.02 },
      { label: 'floor-mid',  y: miny + (maxy-miny)*0.10 },
      { label: 'floor-high', y: miny + (maxy-miny)*0.20 }
    ];

    const res = [];
    for (const t of tryPts) {
      const wp = new V(cx, t.y, cz);
      const sp = new V();
      cam.worldToScreen(wp, sp);
      const sx = sp.x * W, sy = sp.y * H;
      if (sp.x < 0 || sp.x > 1 || sp.y < 0 || sp.y > 1) {
        res.push({ label: t.label, offscreen: true, ndc: [ +sp.x.toFixed(2), +sp.y.toFixed(2) ] });
        continue;
      }
      const snap = await d.snapPosition(sx, sy);

      // 判断落点是否在模型包围盒内
      let inBox = false, nearSurface = false;
      if (snap) {
        inBox = snap.x >= minx-0.5 && snap.x <= maxx+0.5 &&
                snap.y >= miny-0.5 && snap.y <= maxy+0.5 &&
                snap.z >= minz-0.5 && snap.z <= maxz+0.5;
        // 到最近网格 aabb 的距离
        let best = 1e9;
        (ent.findComponents('render') || []).forEach(rc => (rc.meshInstances || []).forEach(mi => {
          if (!mi.aabb) return;
          const mn = mi.aabb.getMin(), mx = mi.aabb.getMax();
          const dx = Math.max(mn.x - snap.x, 0, snap.x - mx.x);
          const dy = Math.max(mn.y - snap.y, 0, snap.y - mx.y);
          const dz = Math.max(mn.z - snap.z, 0, snap.z - mx.z);
          best = Math.min(best, Math.hypot(dx, dy, dz));
        }));
        nearSurface = best < 0.6;
      }

      res.push({
        label: t.label,
        targetY: +t.y.toFixed(2),
        click: [Math.round(sx), Math.round(sy)],
        snap: snap ? snap.toArray().map(v => +v.toFixed(2)) : null,
        snapY: snap ? +snap.y.toFixed(2) : null,
        inBox, nearSurface,
        errorToTarget: snap ? +snap.distance(wp).toFixed(2) : null
      });
    }

    return {
      modelCenter: [+cx.toFixed(2), +((miny+maxy)/2).toFixed(2), +cz.toFixed(2)],
      modelHeight: +(maxy-miny).toFixed(2),
      camDist: +cam.distance.toFixed(2),
      near: +cam.near.toFixed(4),
      far: +cam.far.toFixed(2),
      samples: res
    };
  })()`);
  console.log('SNAP', JSON.stringify(out, null, 2));
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 500);
}
