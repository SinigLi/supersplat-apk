/* probe-v19b.mjs - 人偶出生位置实测（用 d.puppets 取真实坐标）
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4245;
const CDP = 9305;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v19b-${Date.now()}`,
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
    const posOf = p => p.entity.getLocalPosition().toArray().map(v => +v.toFixed(2));

    // 等角色资源
    for (let i = 0; i < 120; i++) {
      const r = d.addPuppet();
      if (r === 'ok') break;
      await wait(300);
    }
    await wait(1500);
    const results = [];

    // A) 高处游标
    d.placeCursor(new V(3.0, 2.0, -4.0));
    await wait(300);
    const r1 = d.addPuppet();
    await wait(1800);
    const p1 = d.puppets[d.puppets.length - 1];
    results.push({
      case: 'A high cursor',
      cursor: d.cursorRoot.getLocalPosition().toArray().map(v => +v.toFixed(2)),
      add: r1, pos: posOf(p1)
    });

    // B) 游标在院子地板以下（负 y）
    d.placeCursor(new V(-2.0, -3.5, 6.0));
    await wait(300);
    const r2 = d.addPuppet();
    await wait(1800);
    const p2 = d.puppets[d.puppets.length - 1];
    results.push({
      case: 'B below-ground cursor',
      cursor: d.cursorRoot.getLocalPosition().toArray().map(v => +v.toFixed(2)),
      add: r2, pos: posOf(p2)
    });

    // C) 三个都看一下，确认是否都堆在 z=0
    results.push({
      case: 'C all puppets',
      all: d.puppets.map(p => ({ name: p.name, pos: posOf(p) }))
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
