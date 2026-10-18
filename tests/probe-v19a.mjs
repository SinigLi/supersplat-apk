/* probe-v19a.mjs - 人偶出生位置实测
 *
 * 把游标放到一个明确不在地面原点的位置，然后走真实「+ 添加人偶」入口，
 * 看生成的人偶落在哪里。分别测：
 *   A) 游标放在高处（y=2.0, x=3.0, z=-4.0）
 *   B) 游标放在地面以下（负 y）
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4244;
const CDP = 9304;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v19a-${Date.now()}`,
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
    const V = d.cursorRoot.getLocalPosition().constructor;

    // 先确保角色资源在
    for (let i = 0; i < 120; i++) {
      const r = d.addPuppet();
      if (r === 'ok') break;
      await wait(300);
    }
    await wait(1200);
    const first = d.listPuppets()[0];
    const results = [];

    // A) 高处游标
    const A = new V(3.0, 2.0, -4.0);
    d.placeCursor(A);
    await wait(400);
    const cursorA = d.cursorRoot.getLocalPosition().toArray().map(v => +v.toFixed(2));
    const r1 = d.addPuppet();
    await wait(1500);
    const pups1 = d.listPuppets();
    const p1 = pups1[pups1.length - 1];
    results.push({
      case: 'A cursor high',
      cursor: cursorA,
      addResult: r1,
      spawned: p1 ? p1.name : null,
      pos: p1 ? p1.pos.map(v => +v.toFixed(2)) : null,
      expected: [3.0, 1.98, -4.0]   // y minus CURSOR_Y_LIFT
    });

    // B) 负 y 游标（院子里地面以下很常见）
    const B = new V(-2.0, -3.5, 6.0);
    d.placeCursor(B);
    await wait(400);
    const cursorB = d.cursorRoot.getLocalPosition().toArray().map(v => +v.toFixed(2));
    const r2 = d.addPuppet();
    await wait(1500);
    const pups2 = d.listPuppets();
    const p2 = pups2[pups2.length - 1];
    results.push({
      case: 'B cursor below ground',
      cursor: cursorB,
      addResult: r2,
      spawned: p2 ? p2.name : null,
      pos: p2 ? p2.pos.map(v => +v.toFixed(2)) : null,
      expected: [-2.0, -3.52, 6.0]
    });

    // C) 不放置游标时（初始状态）
    results.push({
      case: 'C cursor initial',
      cursorEnabled: !!d.cursorRoot.enabled,
      cursor: d.cursorRoot.getLocalPosition().toArray().map(v => +v.toFixed(2))
    });

    return results;
  })()`);
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 500);
}
