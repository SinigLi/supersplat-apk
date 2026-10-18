/* probe_api.mjs — 探测 puppet 网格与 aabb / 蒙皮信息，供测量拾取方案选型 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('www');
const PORT = 4196;
const CDP = 9261;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { cwd: path.resolve('.'), stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-api-${Date.now()}`,
  `http://127.0.0.1:${PORT}/index.html`
], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id;
  pending.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
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
    if (await evalJs('!!(window.__director && window.__director.listCharacters)')) break;
    await sleep(400);
  }
  await evalJs(`window.__director.switchCharacter('woman')`);
  await sleep(3000);
  await evalJs(`window.__director.addPuppet()`);
  await sleep(2500);

  const out = await evalJs(`(() => {
    const d = window.__director;
    const p = d.puppets[0];
    if (!p) return { err: 'no puppet' };
    const rc = p.entity.findComponents('render')[0];
    const mi = rc && rc.meshInstances && rc.meshInstances[0];
    const mesh = mi && mi.mesh;
    const a = mi && mi.aabb;
    const vb = mesh && mesh.vertexBuffer;
    const fmt = vb && vb.format;
    const elems = fmt ? fmt.elements.map(e => ({ s: e.name, c: e.numComponents, t: e.dataType, norm: e.normalize })) : null;
    return {
      hasPuppet: true,
      meshInstances: (rc.meshInstances || []).length,
      skinned: !!(mi && mi.skinInstance),
      bones: mi && mi.skinInstance ? mi.skinInstance.bones.length : 0,
      aabbKeys: a ? Object.keys(a) : null,
      aabb: (a && a.min && a.max) ? { min: [+a.min.x.toFixed(2), +a.min.y.toFixed(2), +a.min.z.toFixed(2)],
                  max: [+a.max.x.toFixed(2), +a.max.y.toFixed(2), +a.max.z.toFixed(2)] } : null,
      entityPos: (() => { const q = p.entity.getLocalPosition(); return [+q.x.toFixed(2), +q.y.toFixed(2), +q.z.toFixed(2)]; })(),
      vertCount: mesh ? mesh.vertexBuffer.numVertices : 0,
      indexCount: mesh ? mesh.indexBuffer.length : 0,
      elems,
      hasGetData: !!(vb && typeof vb.getData === 'function'),
      skinApi: mi && mi.skinInstance ? Object.keys(mi.skinInstance).slice(0, 20) : null,
      meshApi: mesh ? Object.keys(mesh).slice(0, 30) : null
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
