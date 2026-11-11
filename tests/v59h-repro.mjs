/* v59h 鐪熸満鍥炲綊锛氬紑濮嬮〉鐐桂煄寜閽?鈫?搴斿脊 sheet銆傛姄椤甸潰寮傚父銆?*/
import { spawn } from 'node:child_process';
const ROOT = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www';
const PORT = 4221, CDP = 9281;
const SRV = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/tools/dev/staticsrv.cjs';
const srv = spawn(process.execPath, [SRV, ROOT, String(PORT)], { stdio: 'ignore' });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const e = spawn(EDGE, [
  '--remote-debugging-port=' + CDP, '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-sync', '--disable-features=msEdgeSyncConfirmation',
  '--user-data-dir=' + process.env.TEMP + '/edge_v59h',
  '--window-size=430,900',
  'http://127.0.0.1:' + PORT + '/index.html',
], { stdio: 'ignore' });
let ws, id = 0; const pend = new Map(); const exceptions = [];
try {
  let list;
  for (let i = 0; i < 40; i++) { try { list = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json(); if (list.find(t => t.type === 'page' && t.url.includes(String(PORT)))) break; } catch {} await new Promise(r => setTimeout(r, 400)); }
  const pg = list.find(t => t.type === 'page' && t.url.includes(String(PORT)));
  ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') exceptions.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text) + ' @' + (m.params.exceptionDetails.url || '').split('/').pop() + ':' + m.params.exceptionDetails.lineNumber);
  };
  const send = (me, pa = {}) => new Promise(res => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method: me, params: pa })); });
  const q = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
  await send('Runtime.enable'); await send('Page.enable');
  await new Promise(r => setTimeout(r, 2500));
  console.log('typeof __cardgroups:', await q('typeof window.__cardgroups'));
  console.log('typeof CCG:', await q('typeof window.CCG'));
  console.log('typeof CC:', await q('typeof window.CC'));
  console.log('typeof fflate:', await q('typeof window.fflate'));
  const btn = await q('(() => { const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes("瑙掕壊鍗?)); return b ? b.textContent : null; })()');
  console.log('button found:', JSON.stringify(btn));
  if (btn) {
    await q('(()=>{ const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes("瑙掕壊鍗?)); b.click(); })()');
    await new Promise(r => setTimeout(r, 500));
    console.log('sheet open after click:', await q('!!document.querySelector(".cgm-sheet.open")'));
  }
  console.log('exceptions:', exceptions.length ? exceptions.slice(0, 4) : 'none');
} catch (ex) { console.log('ERR', ex.message); }
finally { try { ws && ws.close(); } catch {} e.kill(); srv.kill(); process.exit(0); }

