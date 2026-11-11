/* 语法 OK 但 __cardgroups undefined → IIFE 运行时抛错（CSS 注入或别处）。
 * 在页面里手动加载该脚本抓异常。 */
import { spawn } from 'node:child_process';
const ROOT = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www';
const PORT = 4224, CDP = 9284;
const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const e = spawn(EDGE, [
  '--remote-debugging-port=' + CDP, '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-sync', '--disable-features=msEdgeSyncConfirmation',
  '--user-data-dir=' + process.env.TEMP + '/edge_v59h3',
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
  await send('Runtime.enable');
  await new Promise(r => setTimeout(r, 1500));
  const evalFile = async url => {
    const r = await send('Runtime.evaluate', {
      expression: `fetch('${url}').then(r=>r.text()).then(code=>{ try{ (0,eval)(code); return 'OK '+ (typeof window.__cardgroups); }catch(e){ return 'THROW: '+e.message; } })`,
      returnByValue: true, awaitPromise: true,
    });
    return r.result?.value;
  };
  console.log('cardgroups-ui manual eval:', await evalFile('/cardgroups-ui.js?v=59'));
  console.log('cardgroups manual eval:', await evalFile('/cardgroups.js?v=59'));
  console.log('charcards manual eval:', await evalFile('/charcards.js?v=59'));
} catch (ex) { console.log('ERR', ex.message); }
finally { try { ws && ws.close(); } catch {} e.kill(); srv.kill(); process.exit(0); }
