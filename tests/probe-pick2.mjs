/* probe_pick2.mjs - 用 __pickables() 诊断拾取注册表与射线命中 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('www');
const PORT = 4199;
const CDP = 9264;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-pick2-${Date.now()}`,
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
    if (await evalJs('!!(window.__director && window.__pickables)')) break;
    await sleep(400);
  }
  await evalJs(`window.__director.switchCharacter('woman')`);
  await sleep(3500);
  await evalJs(`(() => { const d=window.__director; const v=d.cursorRoot.getLocalPosition().clone(); v.set(0,0,0); d.placeCursor(v); d.addPuppet(); })()`);
  await sleep(1500);

  const reg = await evalJs(`window.__pickables()`);
  console.log('PICKABLES', JSON.stringify(reg, null, 2));

  const probe = await evalJs(`(() => {
    const d = window.__director;
    const p = d.puppets.at(-1);
    const q = p.entity.getLocalPosition();
    const V = q.constructor;
    const v = new V(q.x, q.y + 1.0, q.z);
    scene.camera.worldToScreen(v, v);
    const sx = v.x * scene.canvas.clientWidth;
    const sy = v.y * scene.canvas.clientHeight;

    const RayC = window.__director.cursorRoot.getLocalPosition().constructor;
    // 用引擎真实 Ray：从 scene 里取构造器
    const ray = Object.create(Object.getPrototypeOf(scene.camera));
    // 直接构造：通过 playcanvas 全局不可用，改用 getRay 输出
    const fake = { origin: new V(), direction: new V() };
    scene.camera.getRay(sx, sy, fake);
    return {
      sx: +sx.toFixed(1), sy: +sy.toFixed(1),
      origin: [+fake.origin.x.toFixed(2), +fake.origin.y.toFixed(2), +fake.origin.z.toFixed(2)],
      dir: [+fake.direction.x.toFixed(2), +fake.direction.y.toFixed(2), +fake.direction.z.toFixed(2)],
      camPos: (() => { const c = scene.camera.mainCamera.getPosition(); return [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)]; })(),
      entity: { x: +q.x.toFixed(2), y: +q.y.toFixed(2), z: +q.z.toFixed(2) },
      dirLen: Math.hypot(fake.direction.x, fake.direction.y, fake.direction.z)
    };
  })()`);
  console.log('RAY', JSON.stringify(probe, null, 2));

  const objAt = await evalJs(`(async () => {
    const d = window.__director;
    const p = d.puppets.at(-1);
    const q = p.entity.getLocalPosition();
    const V = q.constructor;
    const v = new V(q.x, q.y + 1.0, q.z);
    scene.camera.worldToScreen(v, v);
    const sx = v.x * scene.canvas.clientWidth;
    const sy = v.y * scene.canvas.clientHeight;
    await d.tapSelect(sx, sy);
    return { selectedId: d.selectedId, name: d.selected?.name ?? null };
  })()`);
  console.log('TAP', JSON.stringify(objAt));
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 300);
}
