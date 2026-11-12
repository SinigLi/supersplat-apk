/* 列出页面上所有按钮文本 + 直接点击「角色卡」按钮 → 验证 sheet 弹出 */
import { spawn } from 'node:child_process';
const ROOT = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www';
const SRV = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/tools/dev/staticsrv.cjs';
const PORT = 4225, CDP = 9285;
const srv = spawn(process.execPath, [SRV, ROOT, String(PORT)], { stdio: 'ignore' });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const e = spawn(EDGE, [
  '--remote-debugging-port=' + CDP, '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-sync', '--disable-features=msEdgeSyncConfirmation',
  '--user-data-dir=' + process.env.TEMP + '/edge_v59h5',
  '--window-size=430,900',
  'http://127.0.0.1:' + PORT + '/index.html',
], { stdio: 'ignore' });
let ws, id = 0; const pend = new Map();
try {
  let list;
  for (let i = 0; i < 40; i++) { try { list = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json(); if (list.find(t => t.type === 'page' && t.url.includes(String(PORT)))) break; } catch {} await new Promise(r => setTimeout(r, 400)); }
  const pg = list.find(t => t.type === 'page' && t.url.includes(String(PORT)));
  ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
  const send = (me, pa = {}) => new Promise(res => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method: me, params: pa })); });
  const q = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
  await send('Runtime.enable');
  await new Promise(r => setTimeout(r, 2200));
  const btns = await q('[...document.querySelectorAll("button")].map(b=>b.textContent.trim()).filter(t=>t.length<12).join(" | ")');
  console.log('buttons:', btns);
  console.log('click ccBtn:', await q('(()=>{ const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes("角色卡")); if(!b) return "NO BUTTON"; b.click(); return "clicked"; })()'));
  await new Promise(r => setTimeout(r, 600));
  console.log('sheet open:', await q('!!document.querySelector(".cgm-sheet.open")'));
  console.log('group items:', await q('document.querySelectorAll("#cgmList .cg-item").length'));
} catch (ex) { console.log('ERR', ex.message); }
finally { try { ws && ws.close(); } catch {} e.kill(); srv.kill(); process.exit(0); }
