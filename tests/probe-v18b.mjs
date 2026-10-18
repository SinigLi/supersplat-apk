/* probe_v18b.mjs - 确认运行时 mesh 的顶点/索引读取接口 + 三角面数量
 * 目标：为三角形级 raycast 找到可用 API（PlayCanvas 2.23）
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4241;
const CDP = 9301;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v18b-${Date.now()}`,
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

    const api = {
      hasGetPositions: typeof mesh.getPositions === 'function',
      hasGetIndices: typeof mesh.getIndices === 'function',
      primitives: Array.isArray(mesh.primitives) ? mesh.primitives.length : (mesh.primitives ? Object.keys(mesh.primitives).length : 0),
      protoKeys: Object.getOwnPropertyNames(Object.getPrototypeOf(mesh)).filter(k => /pos|index|prim|aabb|stream/i.test(k))
    };

    // 尝试拿顶点
    let posLen = 0, idxLen = 0, triCount = 0;
    try {
      const prims = mesh.primitives || [];
      const p0 = prims[0];
      api.primKeys = p0 ? Object.keys(p0) : [];
      if (p0 && p0.positions) { posLen = p0.positions.length; }
      if (p0 && p0.indices) { idxLen = p0.indices.length; }
      api.primsCount = prims.length;
      api.eachPrim = prims.map(p => ({
        type: p.type,
        posLen: p.positions ? p.positions.length : 0,
        idxLen: p.indices ? p.indices.length : 0
      }));
      triCount = api.eachPrim.reduce((a, b) => a + (b.idxLen ? b.idxLen / 3 : b.posLen / 9), 0);
    } catch (e) { api.primsErr = e.message; }

    return { api, posLen, idxLen, triCount, skinned: !!mi.skinInstance };
  })()`);
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 500);
}
