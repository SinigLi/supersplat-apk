/* probe_measure_v14b.mjs - 验证 v14 修复：
 * 1) 测量可跨两个不同模型各取一点（两点同时保留）
 * 2) 退出测量后视口/默认单击仍然可用
 * 3) 退出测量后测量结果不被清空
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('www');
const PORT = 4202;
const CDP = 9267;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-mv14b-${Date.now()}`,
  `http://127.0.0.1:${PORT}/index.html`
], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
const logs = [];
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
  for (let i = 0; i < 50; i++) {
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
    } else if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || '').split('\n')[0]);
    }
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(2500);
  for (let i = 0; i < 80; i++) {
    if (await evalJs('!!(window.__director && window.__director.listProps)')) break;
    await sleep(400);
  }

  await evalJs(`window.__director.switchCharacter('woman')`);
  await sleep(3500);

  await evalJs(`(() => {
    const d = window.__director;
    const mk = (x, z) => { const v = d.cursorRoot.getLocalPosition().clone(); v.set(x, 0, z); d.placeCursor(v); d.addPuppet(); };
    mk(-0.8, 0); mk(0.8, 0);
  })()`);
  await sleep(1500);

  const coords = await evalJs(`(() => {
    const d = window.__director;
    return d.puppets.map(p => {
      const q = p.entity.getLocalPosition();
      const V = q.constructor;
      const v = new V(q.x, q.y + 1.0, q.z);
      scene.camera.worldToScreen(v, v);
      return { id: p.id, x: Math.round(v.x * scene.canvas.clientWidth), y: Math.round(v.y * scene.canvas.clientHeight) };
    });
  })()`);
  console.log('PUPPETS', JSON.stringify(coords));

  const res = await evalJs(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const c = document.getElementById('canvas-container');
    const fire = (pt) => {
      ['pointerdown', 'pointerup'].forEach(t => c.dispatchEvent(new PointerEvent(t, {
        clientX: pt.x, clientY: pt.y, offsetX: pt.x, offsetY: pt.y, bubbles: true, cancelable: true,
        pointerId: 1, pointerType: 'mouse', button: 0, buttons: t === 'pointerdown' ? 1 : 0, isPrimary: true
      })));
    };
    const pts = ${JSON.stringify(coords)};
    scene.events.fire('tool.measure');
    await wait(700);
    fire(pts[0]);
    await wait(900);
    const afterFirst = (scene.events.invoke('measure.debug') || null);
    fire(pts[1]);
    await wait(900);
    const afterSecond = (scene.events.invoke('measure.debug') || null);
    return { activeAfterOpen: scene.events.invoke('tool.active'), afterFirst, afterSecond };
  })()`);
  console.log('MEASURE', JSON.stringify(res, null, 2));

  const after = await evalJs(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const beforeExit = (scene.events.invoke('measure.debug') || null);
    scene.events.fire('tool.deactivate');
    await wait(800);
    const afterExit = (scene.events.invoke('measure.debug') || null);
    const d = window.__director;
    d.selectPuppet(null);
    const p = d.puppets[0];
    const q = p.entity.getLocalPosition();
    const V = q.constructor;
    const v = new V(q.x, q.y + 1.0, q.z);
    scene.camera.worldToScreen(v, v);
    const pt = { x: Math.round(v.x * scene.canvas.clientWidth), y: Math.round(v.y * scene.canvas.clientHeight) };
    const c = document.getElementById('canvas-container');
    ['pointerdown', 'pointerup'].forEach(t => c.dispatchEvent(new PointerEvent(t, {
      clientX: pt.x, clientY: pt.y, offsetX: pt.x, offsetY: pt.y, bubbles: true, cancelable: true,
      pointerId: 1, pointerType: 'mouse', button: 0, buttons: t === 'pointerdown' ? 1 : 0, isPrimary: true
    })));
    await wait(700);
    return {
      activeAfterClose: scene.events.invoke('tool.active'),
      pointsBeforeExit: beforeExit,
      pointsAfterExit: afterExit,
      tapSelected: d.selectedId,
      yieldClass: document.body.classList.contains('sd-tool-yield')
    };
  })()`);
  console.log('AFTER_CLOSE', JSON.stringify(after, null, 2));
  console.log('EXC', logs.slice(0, 5));
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 300);
}
