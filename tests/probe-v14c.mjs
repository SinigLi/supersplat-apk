/* probe_v14c.mjs - 相机可用性 + 统一导入入口
 * 1) 用测量后拖动左键，相机位姿必须变化（旧版被 stopPropagation 卡死）
 * 2) 面板只有一个导入按钮，accept 同时含 .glb 和泼溅后缀
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('www');
const PORT = 4203;
const CDP = 9268;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v14c-${Date.now()}`,
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

  // ---- 2) 导入入口 ----
  const importUi = await evalJs(`(() => {
    const panel = document.querySelector('.sd-dir-panel');
    const btns = [...panel.querySelectorAll('.sd-dir-btn')].map(b => ({ act: b.dataset.act, label: b.textContent.trim() }));
    const sceneBtn = panel.querySelector('[data-act="scene"]');
    return {
      acts: btns.map(b => b.act),
      hasImport: btns.some(b => b.act === 'import'),
      hasProp: btns.some(b => b.act === 'prop'),
      hasAddscene: btns.some(b => b.act === 'addscene'),
      sceneLabel: sceneBtn ? sceneBtn.textContent.trim() : null,
      sheetTitle: (document.querySelector('#scene-panel .sd-sheet-title') || {}).textContent || null
    };
  })()`);
  console.log('IMPORT_UI', JSON.stringify(importUi, null, 2));

  await evalJs(`window.__director.switchCharacter('woman')`);
  await sleep(3500);
  await evalJs(`(() => { const d=window.__director; const v=d.cursorRoot.getLocalPosition().clone(); v.set(0,0,0); d.placeCursor(v); d.addPuppet(); })()`);
  await sleep(1200);

  // 用一次测量，再关掉
  const cam = await evalJs(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const c = document.getElementById('canvas-container');
    const d = window.__director;
    const p = d.puppets[0];
    const q = p.entity.getLocalPosition();
    const V = q.constructor;
    const v = new V(q.x, q.y + 1.0, q.z);
    scene.camera.worldToScreen(v, v);
    const pt = { x: Math.round(v.x * scene.canvas.clientWidth), y: Math.round(v.y * scene.canvas.clientHeight) };

    const fire = (type, x, y, buttons) => c.dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: y, offsetX: x, offsetY: y, bubbles: true, cancelable: true,
      pointerId: 1, pointerType: 'mouse', button: 0, buttons, isPrimary: true
    }));

    // 测量一枪（旧版这里会 stopPropagation，把相机锁死）
    scene.events.fire('tool.measure');
    await wait(600);
    fire('pointerdown', pt.x, pt.y, 1);
    fire('pointerup', pt.x, pt.y, 0);
    await wait(700);
    scene.events.fire('tool.deactivate');
    await wait(600);

    const before = scene.camera.mainCamera.getPosition().clone();

    // 左键拖动：轨道旋转
    fire('pointerdown', 200, 420, 1);
    for (let i = 1; i <= 6; i++) fire('pointermove', 200 + i * 12, 420 + i * 3, 1);
    fire('pointerup', 272, 438, 0);
    await wait(600);

    const after = scene.camera.mainCamera.getPosition().clone();
    return {
      before: [+before.x.toFixed(2), +before.y.toFixed(2), +before.z.toFixed(2)],
      after: [+after.x.toFixed(2), +after.y.toFixed(2), +after.z.toFixed(2)],
      moved: +before.distance(after).toFixed(3),
      activeTool: scene.events.invoke('tool.active')
    };
  })()`);
  console.log('CAMERA_AFTER_MEASURE', JSON.stringify(cam, null, 2));
  console.log('EXC', logs.slice(0, 5));
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 300);
}
