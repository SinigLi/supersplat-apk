/* probe_v16g.mjs - 验证 GLB 被视锥剔除（stale AABB）
 *
 * 把 GLB 放在偏离环绕中心的位置（模拟用户把恐龙摆在院子里），
 * 绕一圈检查 meshInstance 是否被 frustum 剔除、AABB 是否与实际包围盒一致。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4213;
const CDP = 9278;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v16g-${Date.now()}`,
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
  await send('Page.enable');
  await sleep(2500);
  for (let i = 0; i < 100; i++) {
    if (await evalJs('document.body.classList.contains("sd-docks-ready")')) break;
    await sleep(400);
  }

  // 导入泼溅（让场景包围盒变大）
  await evalJs(`(async () => {
    const res = await fetch('/spike/glb-load-test/splat.ply');
    const blob = await res.blob();
    await scene.events.invoke('import', [{ filename: 'splat.ply', contents: new File([blob], 'splat.ply') }]);
    return true;
  })()`);
  await sleep(5000);

  // 导入 GLB 并挪到偏离中心的位置
  const setup = await evalJs(`(async () => {
    const d = window.__director;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const res = await fetch('/www/static/director/shiba.glb');
    const blob = await res.blob();
    d.importModel(new File([blob], 'shiba.glb'));
    for (let i = 0; i < 60; i++) { await wait(300); if ((d.listProps() || []).length) break; }
    const ent = d.props[0].entity;
    // 偏离场景中心 4 个单位，模拟"恐龙摆在院子里一角"
    ent.setLocalPosition(4, 1, 0);
    ent.syncHierarchy();
    scene.forceRender = true;
    await wait(800);
    return { pos: ent.getLocalPosition().toArray().map(v => +v.toFixed(2)) };
  })()`);
  console.log('SETUP', JSON.stringify(setup));
  await sleep(2500);

  const report = await evalJs(`(() => {
    const d = window.__director;
    const ent = d.props[0].entity;
    const rc = ent.render;
    const out = [];
    rc.meshInstances.forEach((mi, i) => {
      // 实际世界包围盒：用 mesh 的 aabb 经世界变换
      const aabb = mi.aabb;
      out.push({
        i,
        aabb: aabb ? {
          center: [+aabb.center.x.toFixed(2), +aabb.center.y.toFixed(2), +aabb.center.z.toFixed(2)],
          half: [+aabb.halfExtents.x.toFixed(2), +aabb.halfExtents.y.toFixed(2), +aabb.halfExtents.z.toFixed(2)]
        } : null,
        visible: mi.visible,
        cull: mi.cull,
        meshAabb: mi.mesh && mi.mesh.aabb ? {
          center: [+mi.mesh.aabb.center.x.toFixed(2), +mi.mesh.aabb.center.y.toFixed(2), +mi.mesh.aabb.center.z.toFixed(2)],
          half: [+mi.mesh.aabb.halfExtents.x.toFixed(2), +mi.mesh.aabb.halfExtents.y.toFixed(2), +mi.mesh.aabb.halfExtents.z.toFixed(2)]
        } : null,
        node: mi.node ? mi.node.getPosition().toArray().map(v => +v.toFixed(2)) : null
      });
    });
    return { meshInstances: out, entPos: ent.getPosition().toArray().map(v => +v.toFixed(2)) };
  })()`);
  console.log('MESHINFO', JSON.stringify(report, null, 2));

  // 逐方位检查是否被视锥剔除
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
    await sleep(1400);
    const r = await evalJs(`(() => {
      const d = window.__director;
      const ent = d.props[0].entity;
      const cam = scene.camera.mainCamera.camera;
      const frustum = cam.frustum;
      const res = [];
      ent.render.meshInstances.forEach((mi, i) => {
        // 用 PlayCanvas 的 aabb 做视锥测试
        const visible = frustum ? frustum.containsAabb(mi.aabb) : null;
        res.push({ i, inFrustum: visible, miVisible: mi.visible });
      });
      // 投影到屏幕，看是否在画面内
      const p = ent.getPosition();
      const V = p.constructor;
      const v = new V(p.x, p.y + 0.3, p.z);
      scene.camera.worldToScreen(v, v);
      return {
        az: ${az},
        screen: [Math.round(v.x * scene.canvas.clientWidth), Math.round(v.y * scene.canvas.clientHeight)],
        inView01: [v.x >= 0 && v.x <= 1, v.y >= 0 && v.y <= 1],
        meshes: res
      };
    })()`);
    rows.push(r);
  }
  console.log('PER_AZIM', JSON.stringify(rows, null, 2));
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 500);
}
