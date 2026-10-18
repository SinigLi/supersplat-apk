/* probe_v15c.mjs - 验证统一导入入口：
 * 1) input 不设 accept（Android 不再被 MIME 白名单卡住）
 * 2) 真实 PLY 走泼溅管线并能在画布上点选
 * 3) 真实 GLB 走道具管线并能在画布上点选
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4206;
const CDP = 9271;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v15c-${Date.now()}`,
  `http://127.0.0.1:${PORT}/www/index.html`
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

  // ---- 1) input 属性 ----
  const inputInfo = await evalJs(`(async () => {
    const panel = document.querySelector('.sd-dir-panel [data-act="import"]');
    const origClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {};
    panel.click();
    HTMLInputElement.prototype.click = origClick;
    const el = document.querySelector('input[type=file]');
    return el ? { accept: el.getAttribute('accept'), multiple: el.multiple } : { error: 'no input' };
  })()`);
  console.log('INPUT', JSON.stringify(inputInfo));

  // ---- 2) 真实 PLY ----
  const ply = await evalJs(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const res = await fetch('/spike/glb-load-test/splat.ply');
    const blob = await res.blob();
    const file = new File([blob], 'splat.ply', { type: 'application/octet-stream' });
    const input = document.querySelector('input[type=file]');
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));

    // 等 splat 元素进场景
    let splat = null;
    for (let i = 0; i < 60; i++) {
      await wait(500);
      const els = scene.getElementsByType ? scene.getElementsByType('splat') : [];
      if (els.length) { splat = els[0]; break; }
    }
    if (!splat) {
      const all = [...scene.root.children].map(e => e.name + ':' + (e.type || '?'));
      return { imported: false, plyStatus: window.__plyProbe || null, children: all };
    }
    await wait(1500);

    // 点画布中心选中
    const c = document.getElementById('canvas-container');
    const cx = Math.round(scene.canvas.clientWidth / 2);
    const cy = Math.round(scene.canvas.clientHeight / 2);
    ['pointerdown', 'pointerup'].forEach(t => c.dispatchEvent(new PointerEvent(t, {
      clientX: cx, clientY: cy, offsetX: cx, offsetY: cy, bubbles: true, cancelable: true,
      pointerId: 1, pointerType: 'mouse', button: 0, buttons: t === 'pointerdown' ? 1 : 0, isPrimary: true
    })));
    await wait(1200);
    let hitName = null;
    try {
      const h = await scene.camera.intersect(cx / scene.canvas.clientWidth, cy / scene.canvas.clientHeight);
      hitName = h && h.splat ? h.splat.name : null;
    } catch (e) { hitName = 'err:' + e.message; }
    return {
      imported: true,
      raycastHit: hitName,
      name: splat.name,
      numSplats: splat.numSplats,
      selected: !!scene.events.invoke('selection'),
      selectionName: (scene.events.invoke('selection') || {}).name || null,
      directorTap: (scene.events.invoke('selection') || {}).name || null
    };
  })()`);
  console.log('PLY', JSON.stringify(ply, null, 2));

  // ---- 3) 真实 GLB 道具 ----
  const glb = await evalJs(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const d = window.__director;
    const res = await fetch('/www/static/director/shiba.glb');
    const blob = await res.blob();
    const file = new File([blob], 'shiba_prop.glb', { type: 'model/gltf-binary' });
    const input = document.querySelector('input[type=file]');
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));

    let props = [];
    for (let i = 0; i < 60; i++) {
      await wait(400);
      props = d.listProps ? d.listProps() : [];
      if (props.length) break;
    }
    if (!props.length) return { imported: false };
    await wait(1200);

    const p = props[0];
    const ent = d.props ? d.props.find(x => x.id === p.id || x.name === p.name) : null;
    if (!ent) return { imported: true, props, error: 'entity lookup failed' };

    const pos = ent.entity.getPosition();
    const V = pos.constructor;
    const v = new V(pos.x, pos.y + 0.2, pos.z);
    scene.camera.worldToScreen(v, v);
    const cx = Math.round(v.x * scene.canvas.clientWidth);
    const cy = Math.round(v.y * scene.canvas.clientHeight);
    const c = document.getElementById('canvas-container');
    ['pointerdown', 'pointerup'].forEach(t => c.dispatchEvent(new PointerEvent(t, {
      clientX: cx, clientY: cy, offsetX: cx, offsetY: cy, bubbles: true, cancelable: true,
      pointerId: 1, pointerType: 'mouse', button: 0, buttons: t === 'pointerdown' ? 1 : 0, isPrimary: true
    })));
    await wait(1000);
    return { imported: true, props: props.length, tapAt: [cx, cy], selectedId: d.selectedId, selectedName: (d.listProps().find(x => x.id === d.selectedId) || {}).name || null };
  })()`);
  console.log('GLB', JSON.stringify(glb, null, 2));
  console.log('EXC', logs.slice(0, 5));
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 300);
}
