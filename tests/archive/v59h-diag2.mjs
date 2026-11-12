/* 还是 undefined → 页面根本没跑脚本。检查 headless 里实际 URL / DOM 状态 */
import { spawn } from 'node:child_process';
const ROOT = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www';
const PORT = 4223, CDP = 9283;
const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const e = spawn(EDGE, [
  '--remote-debugging-port=' + CDP, '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-sync', '--disable-features=msEdgeSyncConfirmation',
  '--user-data-dir=' + process.env.TEMP + '/edge_v59h2',
  '--window-size=430,900',
  'http://127.0.0.1:' + PORT + '/index.html',
], { stdio: 'ignore' });
let ws, id = 0; const pend = new Map();
try {
  let list;
  for (let i = 0; i < 40; i++) { try { list = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json(); if (list.find(t => t.type === 'page' && t.url.includes(String(PORT)))) break; } catch {} await new Promise(r => setTimeout(r, 400)); }
  const pg = list.find(t => t.type === 'page' && t.url.includes(String(PORT)));
  console.log('page url:', pg.url);
  ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
  const send = (me, pa = {}) => new Promise(res => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method: me, params: pa })); });
  const q = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
  await send('Runtime.enable');
  await new Promise(r => setTimeout(r, 2000));
  console.log('readyState:', await q('document.readyState'));
  console.log('scripts in DOM:', await q('document.scripts.length'));
  console.log('body child count:', await q('document.body ? document.body.children.length : -1'));
  console.log('title:', await q('document.title'));
  console.log('first 200 of body text:', JSON.stringify(String(await q('document.body.innerText.slice(0,200)'))));
} catch (ex) { console.log('ERR', ex.message); }
finally { try { ws && ws.close(); } catch {} e.kill(); srv.kill(); process.exit(0); }
