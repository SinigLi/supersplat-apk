/* probe_v17o.mjs - snapPosition 内部：pickSceneObject 是否命中
 * 通过 patch 一个可观测的包装来抓返回值的来源
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4232;
const CDP = 9297;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v17o-${Date.now()}`,
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

    // 拦截 scene.camera.intersectMany，看泼溅是否返回了"命中"
    let splatHit = null;
    const origMany = scene.camera.intersectMany.bind(scene.camera);
    scene.camera.intersectMany = async (pts) => {
      const r = await origMany(pts);
      splatHit = r && r[0] && r[0].position ? r[0].position.toArray().map(v => +v.toFixed(3)) : null;
      return r;
    };

    const snap = await d.snapPosition(cx, cy);
    scene.camera.intersectMany = origMany;

    // 同时测 pickGround 结果
    const g = d.pickGround(cx, cy);
    // 和 pickViewPlane
    const vp = d.pickViewPlane(cx, cy);

    return {
      click: [Math.round(cx), Math.round(cy)],
      splatHit,
      ground: g ? g.toArray().map(v => +v.toFixed(3)) : null,
      viewPlane: vp ? vp.toArray().map(v => +v.toFixed(3)) : null,
      finalSnap: snap ? snap.toArray().map(v => +v.toFixed(3)) : null,
      note: 'finalSnap 若等于 splatHit 说明命中泼溅；等于 ground 说明没命中任何网格'
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
