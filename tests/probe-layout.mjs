/* probe_layout.mjs - measure director panel rows at 390x844 and screenshot */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('www');   // run from repo root
const PORT = 4194;
const CDP = 9253;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      const page = list.find(t => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(500);
  }
  throw new Error('CDP not ready');
}

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + path.join(process.env.TEMP, 'edge_layout_profile'),
  '--enable-unsafe-webgpu', '--use-angle=d3d11', '--window-size=390,844',
  `http://127.0.0.1:${PORT}/index.html`
], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const msgId = ++id; pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description };
  return r.result?.value;
}

try {
  ws = new WebSocket(await getWs());
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(2500);
  for (let i = 0; i < 80; i++) {
    if (await evalJs('!!(window.__director && document.querySelector(".sd-dir-panel"))')) break;
    await sleep(400);
  }
  // open the director panel via its bottom-bar button
  await evalJs(`(() => { const b = document.querySelector('.sd-dir-act[data-act="director"]'); if (b) b.click(); return !!b; })()`);
  await sleep(900);

  const layout = await evalJs(`(() => {
    const panel = document.querySelector('.sd-dir-panel');
    const r = panel.getBoundingClientRect();
    const rows = [...panel.querySelectorAll('.sd-dir-row')].map(row => {
      const kids = [...row.children].map(k => {
        const b = k.getBoundingClientRect();
        return { tag: k.tagName.toLowerCase(), w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x) };
      });
      const rb = row.getBoundingClientRect();
      return { rowW: Math.round(rb.width), kids, overflow: rb.right > innerWidth - 2 };
    });
    const opts = {
      chars: panel.querySelector('.sd-dir-chars').options.length,
      tints: panel.querySelector('.sd-dir-tints').options.length,
      clips: panel.querySelector('.sd-dir-clips').options.length
    };
    return { panel: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, rows, opts, vw: innerWidth, vh: innerHeight };
  })()`);
  console.log(JSON.stringify(layout, null, 2));

  await send('Page.captureScreenshot', { format: 'png' }).then(r => {
    fs.writeFileSync('shot_layout.png', Buffer.from(r.data, 'base64'));
    console.log('screenshot -> shot_layout.png');
  });
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 300);
}
