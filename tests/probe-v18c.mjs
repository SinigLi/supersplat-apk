/* probe_v18c.mjs - 摸清 PlayCanvas 2.23 运行时 mesh 的几何数据字段
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4242;
const CDP = 9302;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v18c-${Date.now()}`,
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
    const res = await fetch('/tests/assets/courtyard.glb');
    const blob = await res.blob();
    d.importModel(new File([blob], 'courtyard.glb'));
    for (let i = 0; i < 120; i++) { await wait(300); if ((d.listProps() || []).length) break; }
    await wait(2000);

    const ent = d.props[0].entity;
    const mi = ent.findComponents('render')[0].meshInstances[0];
    const mesh = mi.mesh;

    const own = {};
    for (const k of Object.keys(mesh)) {
      const v = mesh[k];
      if (Array.isArray(v)) own[k] = 'array[' + v.length + ']';
      else if (ArrayBuffer.isView(v)) own[k] = v.constructor.name + '[' + v.length + ']';
      else if (v && typeof v === 'object') own[k] = 'obj:' + (v.constructor ? v.constructor.name : '?');
      else own[k] = typeof v;
    }

    // 尝试逐个 primitive 结构
    let primInfo = null;
    try {
      const pr = mesh.primitive !== undefined ? mesh.primitive : mesh.primitives;
      if (pr) {
        const arr = Array.isArray(pr) ? pr : [pr];
        primInfo = arr.map(x => ({
          keys: x ? Object.keys(x) : null,
          posType: x && x.positions ? x.positions.constructor.name : null,
          posLen: x && x.positions ? x.positions.length : 0,
          idxLen: x && x.indices ? x.indices.length : 0
        }));
      }
    } catch (e) { primInfo = 'err:' + e.message; }

    // getPositions 全量
    let gpLen = 0;
    try {
      const n = mesh.getPositions([]);
      gpLen = n;
    } catch (e) { gpLen = 'err:' + e.message; }

    return { ownKeys: Object.keys(mesh), own, primInfo, gpLen, aabb: mesh.aabb ? { min: mesh.aabb.getMin().toArray(), max: mesh.aabb.getMax().toArray() } : null };
  })()`);
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 500);
}
