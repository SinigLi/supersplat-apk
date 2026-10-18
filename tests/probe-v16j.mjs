/* probe_v16j.mjs - 直接对比 scene.bound 是否包含偏移 GLB
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4216;
const CDP = 9281;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v16j-${Date.now()}`,
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
    const res = await fetch('/www/static/director/shiba.glb');
    const blob = await res.blob();
    d.importModel(new File([blob], 'shiba.glb'));
    for (let i = 0; i < 60; i++) { await wait(300); if ((d.listProps() || []).length) break; }
    await wait(1200);

    const ent = d.props[0].entity;
    ent.setLocalPosition(5, 1, 0);
    scene.invalidateBound();
    await wait(800);

    const b = scene.bound;
    const bmin = b.getMin(), bmax = b.getMax();
    const countBefore = scene.boundContributors.size;

    // 手动遍历 meshInstance aabb
    let n = 0, minx = 1e9, maxx = -1e9;
    const walk = (e) => {
      if (e.render && e.render.meshInstances) {
        e.render.meshInstances.forEach(mi => {
          if (!mi.aabb) return;
          n++;
          const c = mi.aabb.center, h = mi.aabb.halfExtents;
          minx = Math.min(minx, c.x - h.x); maxx = Math.max(maxx, c.x + h.x);
        });
      }
      e.children.forEach(walk);
    };
    walk(ent);

    return {
      contributors: countBefore,
      boundMin: [bmin.x, bmin.y, bmin.z].map(v => +v.toFixed(2)),
      boundMax: [bmax.x, bmax.y, bmax.z].map(v => +v.toFixed(2)),
      meshAabbCount: n,
      meshXRange: [+minx.toFixed(2), +maxx.toFixed(2)],
      entWorld: ent.getPosition().toArray().map(v => +v.toFixed(2))
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
