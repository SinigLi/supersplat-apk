/* probe_v16k.mjs - 泼溅 + 偏移 GLB，检查包围盒合并与远裁剪
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4217;
const CDP = 9282;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v16k-${Date.now()}`,
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

  // 1) 泼溅
  await evalJs(`(async () => {
    const res = await fetch('/spike/glb-load-test/splat.ply');
    const blob = await res.blob();
    await scene.events.invoke('import', [{ filename: 'splat.ply', contents: new File([blob], 'splat.ply') }]);
    return true;
  })()`);
  await sleep(5000);

  const splatBound = await evalJs(`(() => {
    const b = scene.bound;
    return {
      elements: scene.elements.length,
      min: b.getMin().toArray().map(v => +v.toFixed(2)),
      max: b.getMax().toArray().map(v => +v.toFixed(2))
    };
  })()`);
  console.log('SPLAT_BOUND', JSON.stringify(splatBound));

  // 2) GLB 挪到泼溅外侧
  const merged = await evalJs(`(async () => {
    const d = window.__director;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const res = await fetch('/www/static/director/shiba.glb');
    const blob = await res.blob();
    d.importModel(new File([blob], 'shiba.glb'));
    for (let i = 0; i < 60; i++) { await wait(300); if ((d.listProps() || []).length) break; }
    await wait(1000);
    const ent = d.props[0].entity;
    ent.setLocalPosition(12, 1, 0);   // 明显在泼溅(半宽6)之外
    scene.invalidateBound();
    await wait(900);
    const b = scene.bound;
    return {
      contributors: scene.boundContributors.size,
      min: b.getMin().toArray().map(v => +v.toFixed(2)),
      max: b.getMax().toArray().map(v => +v.toFixed(2))
    };
  })()`);
  console.log('MERGED_BOUND', JSON.stringify(merged));

  // 3) 各方位 far 是否覆盖最远内容
  const rows = [];
  for (const az of [0, 90, 180, 270]) {
    await evalJs(`(() => {
      const cam = scene.camera;
      cam.setFocalPoint(scene.bound.center.clone(), 0);
      cam.setAzimElev(${az}, -10, 0);
      cam.setDistance(2.0, 0);
      scene.forceRender = true;
      return true;
    })()`);
    await sleep(1300);
    const r = await evalJs(`(() => {
      const cam = scene.camera;
      const camPos = cam.mainCamera.getPosition();
      const fwd = cam.mainCamera.forward;
      const b = scene.bound;
      const min = b.getMin(), max = b.getMax();
      let farDepth = -1e9;
      const V = camPos.constructor;
      const c = new V();
      for (let i = 0; i < 8; i++) {
        c.set((i&1)?max.x:min.x, (i&2)?max.y:min.y, (i&4)?max.z:min.z);
        const d = new V().sub2(c, camPos).dot(fwd);
        if (d > farDepth) farDepth = d;
      }
      return {
        az: ${az},
        far: +cam.far.toFixed(2),
        needFar: +farDepth.toFixed(2),
        covers: cam.far >= farDepth - 0.01,
        near: +cam.near.toFixed(3)
      };
    })()`);
    rows.push(r);
  }
  console.log('FAR_CHECK', JSON.stringify(rows, null, 2));
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 500);
}
