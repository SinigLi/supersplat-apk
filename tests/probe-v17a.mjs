/* probe_v17a.mjs - 验证拾取射线是否准
 *
 * 做法：把相机对准一个人偶，把人偶投影到屏幕得到 (sx, sy)，
 * 再用 scene.camera.getRay(sx, sy) 反算射线，看射线是否穿过人偶。
 * 同时验证 pickSceneObject 返回的点是否落在人偶身上。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4218;
const CDP = 9283;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v17a-${Date.now()}`,
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
    d.placeCursor(new (d.cursorRoot.getLocalPosition().constructor)(0, 0, 0));
    d.addPuppet();
    await wait(1500);

    const p = d.puppets[0];
    const ent = p.entity;
    const pos = ent.getPosition();

    // 相机对齐人偶
    const cam = scene.camera;
    cam.setFocalPoint(pos.clone(), 0);
    cam.setAzimElev(0, -10, 0);
    cam.setDistance(1.6, 0);
    scene.forceRender = true;
    await wait(2000);

    // 把"胸口"投影到屏幕
    const V = pos.constructor;
    const target = new V(pos.x, pos.y + 0.9, pos.z);
    const sp = new V();
    cam.worldToScreen(target, sp);
    const W = scene.canvas.clientWidth, H = scene.canvas.clientHeight;
    const sx = sp.x * W, sy = sp.y * H;

    // 反算射线
    const Ray = scene.camera.constructor;
    const ray = new (window.pc ? window.pc.Ray : Object.getPrototypeOf(scene.camera).constructor)();

    // 直接用 getRay
    const r = new (cam.mainCamera.camera.constructor === undefined ? Object : Object)();
    const rayObj = new (window.Ray || (await import('playcanvas')).Ray)();
    cam.getRay(sx, sy, rayObj);

    // 射线到 target 的距离
    const dir = rayObj.direction;
    const oc = new V().sub2(target, rayObj.origin);
    const proj = oc.dot(dir);
    const closest = new V().copy(dir).mulScalar(proj).add(rayObj.origin);
    const err = closest.distance(target);

    // pickSceneObject 结果
    const picked = window.__pickSceneObject ? window.__pickSceneObject(scene, sx, sy) : null;

    return {
      screen: [+sx.toFixed(1), +sy.toFixed(1)],
      canvas: [W, H],
      target: [+target.x.toFixed(2), +target.y.toFixed(2), +target.z.toFixed(2)],
      rayOrigin: rayObj.origin.toArray().map(v => +v.toFixed(2)),
      rayDir: rayObj.direction.toArray().map(v => +v.toFixed(3)),
      distanceFromRayToTarget: +err.toFixed(3),
      picked: picked ? { pos: picked.position.toArray().map(v => +v.toFixed(2)) } : null
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
