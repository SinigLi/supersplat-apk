/* probe_pick.mjs - 定位 pickSceneObject 为什么没命中人偶 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('www');
const PORT = 4198;
const CDP = 9263;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-pick-${Date.now()}`,
  `http://127.0.0.1:${PORT}/index.html`
], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

try {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      const t = list.find(x => x.type === 'page' && x.url.includes('index.html'));
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
  await send('Page.enable');
  await sleep(2500);
  for (let i = 0; i < 80; i++) {
    if (await evalJs('!!(window.__director && window.__director.listProps)')) break;
    await sleep(400);
  }
  await evalJs(`window.__director.switchCharacter('woman')`);
  await sleep(3500);
  await evalJs(`(() => { const d=window.__director; const v=d.cursorRoot.getLocalPosition().clone(); v.set(0,0,0); d.placeCursor(v); d.addPuppet(); })()`);
  await sleep(1200);

  const out = await evalJs(`(() => {
    const d = window.__director;
    const p = d.puppets.at(-1);
    const q = p.entity.getLocalPosition();
    const V = p.entity.getLocalPosition().constructor;
    const v = new V(q.x, q.y + 1.0, q.z);
    scene.camera.worldToScreen(v, v);
    const sx = v.x * scene.canvas.clientWidth;
    const sy = v.y * scene.canvas.clientHeight;

    // ray + aabb 检查
    const ray = new (scene.camera.constructor.name ? Object.getPrototypeOf(scene.camera) : Object)();
    const R = window.__pcRay;
    const rayObj = new R();
    scene.camera.getRay(sx, sy, rayObj);

    const rc = p.entity.findComponents('render')[0];
    const mi = rc && rc.meshInstances && rc.meshInstances[0];
    const aabb = mi && mi.aabb;
    let intersect = null;
    if (aabb) {
      const hit = new (aabb.min.constructor)();
      intersect = aabb.intersectsRay(rayObj, hit);
    }
    return {
      sx: +sx.toFixed(1), sy: +sy.toFixed(1),
      rayOrigin: [+rayObj.origin.x.toFixed(2), +rayObj.origin.y.toFixed(2), +rayObj.origin.z.toFixed(2)],
      rayDir: [+rayObj.direction.x.toFixed(2), +rayObj.direction.y.toFixed(2), +rayObj.direction.z.toFixed(2)],
      miVisible: mi ? mi.visible : null,
      entityEnabled: p.entity.enabled,
      aabb: aabb ? { min: [+aabb.min.x.toFixed(2), +aabb.min.y.toFixed(2), +aabb.min.z.toFixed(2)],
                     max: [+aabb.max.x.toFixed(2), +aabb.max.y.toFixed(2), +aabb.max.z.toFixed(2)] } : null,
      intersect,
      canvasW: scene.canvas.clientWidth, canvasH: scene.canvas.clientHeight,
      isPickableInList: (window.__sceneObjectsPickables || null)
    };
  })()`);
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 300);
}
