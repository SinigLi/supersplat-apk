/* probe_bottom.mjs - measure bottom bar 5 buttons + director panel after open */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('www');   // run from repo root
const PORT = 4195;
const CDP = 9254;
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
  '--user-data-dir=' + path.join(process.env.TEMP, 'edge_bottom_profile'),
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
  await sleep(2600);
  for (let i = 0; i < 80; i++) {
    if (await evalJs('!!(window.__director && document.querySelector(".sd-dir-act"))')) break;
    await sleep(400);
  }
  const bar = await evalJs(`(() => {
    const dock = document.querySelector('.sd-dock.sd-bottom');
    const btns = [...document.querySelectorAll('.sd-dir-act')].map(b => {
      const r = b.getBoundingClientRect();
      const name = b.querySelector('.sd-name');
      return { act: b.dataset.act, text: name ? name.textContent : '', w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x),
               labelW: name ? Math.round(name.getBoundingClientRect().width) : 0,
               clipped: name ? name.scrollWidth > name.clientWidth + 1 : false };
    });
    const dr = dock ? dock.getBoundingClientRect() : null;
    return { vw: innerWidth, vh: innerHeight, dock: dr ? { x: Math.round(dr.x), y: Math.round(dr.y), w: Math.round(dr.width), h: Math.round(dr.height) } : null, btns,
             overflowRight: dr ? Math.round(dr.right) > innerWidth : null };
  })()`);
  console.log(JSON.stringify(bar, null, 2));

  await evalJs(`(() => { const b=document.querySelector('.sd-dir-act[data-act="director"]'); b && b.click(); })()`);
  await sleep(800);
  await send('Page.captureScreenshot', { format: 'png' }).then(r => {
    fs.writeFileSync('shot_bottom.png', Buffer.from(r.data, 'base64'));
    console.log('screenshot -> shot_bottom.png');
  });
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 300);
}
