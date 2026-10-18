/* probe_v16a.mjs - 验证底栏让位只对「有底部工具条」的工具生效
 * 1) 点「变换」→ 打开子面板 → 点「移动」：底栏必须仍在，子面板仍可再次打开
 * 2) 激活测量：底栏必须让位（隐藏）
 * 3) 退出测量：底栏必须恢复
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('www');
const PORT = 4207;
const CDP = 9272;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v16a-${Date.now()}`,
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
    if (await evalJs('document.body.classList.contains("sd-docks-ready")')) break;
    await sleep(400);
  }

  const out = await evalJs(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const dock = document.querySelector('.sd-dock.sd-bottom');
    const dockState = () => ({
      display: getComputedStyle(dock).display,
      yield: document.body.classList.contains('sd-tool-yield')
    });
    const res = {};

    // 打开变换组并点「移动」
    const xformBtn = dock.querySelector('[data-act="xform"]');
    xformBtn.click();
    await wait(400);
    const wrap = document.querySelector('.sd-sub-wrap[data-grp="xform"]');
    res.panelOpened = wrap ? wrap.classList.contains('sd-open') : false;
    res.moveButtons = wrap ? [...wrap.querySelectorAll('.sd-adopted')].map(b => b.id) : [];

    const moveBtn = wrap.querySelector('#bottom-toolbar-move');
    res.hasMoveBtn = !!moveBtn;
    if (moveBtn) { moveBtn.click(); await wait(900); }
    res.activeAfterMove = scene.events.invoke('tool.active');
    res.dockAfterMove = dockState();

    // 子面板此时仍开着；点一次关闭，再点一次必须能重新打开
    xformBtn.click();
    await wait(400);
    res.panelClosedAfterSecondClick = !wrap.classList.contains('sd-open');
    xformBtn.click();
    await wait(500);
    res.panelReopenAfterMove = wrap.classList.contains('sd-open');

    // 关掉移动工具
    scene.events.fire('tool.deactivate');
    await wait(600);

    // 测量：底栏应当让位
    scene.events.fire('tool.measure');
    await wait(900);
    res.activeAfterMeasure = scene.events.invoke('tool.active');
    res.dockAfterMeasure = dockState();

    // 退出测量：底栏应当恢复
    scene.events.fire('tool.deactivate');
    await wait(900);
    res.dockAfterMeasureExit = dockState();

    return res;
  })()`);
  console.log(JSON.stringify(out, null, 2));
  console.log('EXC', logs.slice(0, 5));
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 300);
}
