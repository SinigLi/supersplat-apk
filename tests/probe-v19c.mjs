/* probe-v19c.mjs - 设置分组三个面板「只能打开一次」复现
 *
 * 对 外观/浮层/设置 三个面板各走一遍：
 *   1. 点右侧栏按钮打开
 *   2. 点我们注入的「‹ 返回」关闭
 *   3. 再点右侧栏按钮
 * 记录每一步的：pcui-hidden 类、inline display、computed display、
 * SS 内部可见状态（events.invoke('xxxPanel.visible')）
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4246;
const CDP = 9306;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v19c-${Date.now()}`,
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
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const report = [];

    const state = (pid, evName) => {
      const p = document.getElementById(pid);
      const cs = getComputedStyle(p);
      let internal = null;
      try { internal = scene.events.invoke(evName + '.visible'); } catch (e) { internal = 'err:' + e.message; }
      return {
        hiddenClass: p.classList.contains('pcui-hidden'),
        inlineDisplay: p.style.display || '(none)',
        computed: cs.display,
        visibleOnScreen: cs.display !== 'none' && cs.visibility !== 'hidden',
        ssInternal: internal
      };
    };

    const defs = [
      ['appearance-panel', 'appearancePanel', 'right-toolbar-appearance'],
      ['overlays-panel', 'overlaysPanel', 'right-toolbar-overlays'],
      ['settings-panel', 'settingsPanel', 'right-toolbar-settings']
    ];

    for (const [pid, evName, btnId] of defs) {
      const btn = document.getElementById(btnId);
      const panel = document.getElementById(pid);
      const back = panel.querySelector(':scope > .sd-sheet-header .sd-back-btn');
      const row = { panel: pid, steps: [] };

      row.steps.push({ step: 'initial', ...state(pid, evName) });

      if (!btn) { row.error = 'no toolbar button'; report.push(row); continue; }
      btn.click();
      await wait(700);
      row.steps.push({ step: 'after open click #1', ...state(pid, evName) });

      if (!back) { row.error = 'no back button'; report.push(row); continue; }
      back.click();
      await wait(700);
      row.steps.push({ step: 'after back', ...state(pid, evName) });

      btn.click();
      await wait(700);
      row.steps.push({ step: 'after open click #2', ...state(pid, evName) });

      // 再来一轮，看是不是永久锁死
      if (back) { back.click(); await wait(500); }
      if (btn) { btn.click(); await wait(700); }
      row.steps.push({ step: 'after close+open #3', ...state(pid, evName) });

      report.push(row);
    }

    return report;
  })()`);
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 500);
}
