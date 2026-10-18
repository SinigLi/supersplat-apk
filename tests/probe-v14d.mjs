/* probe_v14d.mjs - 验证统一导入入口的分流（不依赖真实资产）
 * 拦截 events.invoke('import') 与 director.importModel，构造 File 塞进隐藏 input，
 * 断言：.ply/.splat 走泼溅管线；.glb/.gltf 走导演台道具；.obj 提示不支持。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('www');
const PORT = 4204;
const CDP = 9269;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v14d-${Date.now()}`,
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
    }
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(2500);
  for (let i = 0; i < 80; i++) {
    if (await evalJs('!!(window.__director && window.__director.listProps)')) break;
    await sleep(400);
  }

  const routing = await evalJs(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const calls = { splat: [], model: [], toast: [] };

    // 拦截两条管线（Events.functions 是 Map）
    const fnMap = scene.events.functions;
    const origImport = fnMap.get('import');
    fnMap.set('import', (files, frame) => {
      calls.splat.push({ names: (files || []).map(f => f.filename), hasContents: (files || []).every(f => !!f.contents) });
      return Promise.resolve([]);
    });

    const d = window.__director;
    const origImportModel = d.importModel.bind(d);
    d.importModel = (file) => { calls.model.push(file.name); return 'stub'; };

    // 找隐藏 input
    let input = document.querySelector('input[type=file][multiple]');
    if (!input) {
      // 触发一次 pickAssets() 让它创建（拦截 click 避免真弹窗）
      const panel = document.querySelector('.sd-dir-panel [data-act="import"]');
      const origClick = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function () { /* no-op */ };
      panel.click();
      HTMLInputElement.prototype.click = origClick;
      input = document.querySelector('input[type=file][multiple]');
    }
    if (!input) return { error: 'no input' };

    const mk = (name) => new File([new Uint8Array([1,2,3])], name);
    const feed = async (names) => {
      const dt = new DataTransfer();
      names.forEach(n => dt.items.add(mk(n)));
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
      await wait(250);
    };

    await feed(['scene.ply']);
    await feed(['clip.splat']);
    await feed(['robot.glb']);
    await feed(['robot.gltf']);
    await feed(['thing.obj']);

    // 还原
    if (origImport) fnMap.set('import', origImport);
    d.importModel = origImportModel;

    const toast = document.getElementById('sd-msg');
    return {
      splatCalls: calls.splat,
      modelCalls: calls.model,
      accept: input.getAttribute('accept'),
      toastAfterObj: toast ? toast.textContent : null
    };
  })()`);
  console.log(JSON.stringify(routing, null, 2));
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 300);
}
