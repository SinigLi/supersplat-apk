/* probe_pick3.mjs - 检查人偶实体树的 render 组件与 meshInstance aabb */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('www');
const PORT = 4200;
const CDP = 9265;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-pick3-${Date.now()}`,
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
  await sleep(2000);

  const tree = await evalJs(`(() => {
    const d = window.__director;
    const p = d.puppets.at(-1);
    const out = [];
    const walk = (e, depth) => {
      const rc = e.render;
      out.push({
        depth,
        name: e.name,
        enabled: e.enabled,
        hasRender: !!rc,
        miCount: rc ? (rc.meshInstances || []).length : 0,
        mi: rc ? (rc.meshInstances || []).map(mi => ({
          visible: mi.visible,
          hasAabb: !!(mi.aabb && mi.aabb.min),
          aabb: (mi.aabb && mi.aabb.min) ? [
            [+mi.aabb.min.x.toFixed(2), +mi.aabb.min.y.toFixed(2), +mi.aabb.min.z.toFixed(2)],
            [+mi.aabb.max.x.toFixed(2), +mi.aabb.max.y.toFixed(2), +mi.aabb.max.z.toFixed(2)]
          ] : null,
          meshName: mi.mesh ? mi.mesh.name : null,
          verts: mi.mesh && mi.mesh.vertexBuffer ? mi.mesh.vertexBuffer.numVertices : 0
        })) : []
      });
      (e.children || []).forEach(c => walk(c, depth + 1));
    };
    walk(p.entity, 0);
    return { props: (window.__pickables()||[]), tree: out.slice(0, 12) };
  })()`);
  console.log(JSON.stringify(tree, null, 2));
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 300);
}
