/* r3 页面诊断：抓异常 + DOM 状态 */
import { spawn } from 'node:child_process';
const ROOT = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk';
const PORT = 4211, CDP = 9271;
const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore', cwd: ROOT });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const e = spawn(EDGE, [
  '--remote-debugging-port=' + CDP, '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-sync', '--disable-features=msEdgeSyncConfirmation',
  '--user-data-dir=' + process.env.TEMP + '/edge_r3dbg',
  '--window-size=430,900',
  'http://127.0.0.1:' + PORT + '/prototype/cardgroups-proto.html',
], { stdio: 'ignore' });
let ws, id = 0; const pend = new Map();
setTimeout(async () => {
  try {
    const l = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json();
    const pg = l.find(t => t.type === 'page' && t.url.includes(String(PORT)));
    ws = new WebSocket(pg.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const exceptions = [];
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
      else if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.exception?.description || JSON.stringify(m.params).slice(0, 200));
    };
    const send = (me, pa = {}) => new Promise(res => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method: me, params: pa })); });
    await send('Runtime.enable');
    await new Promise(r => setTimeout(r, 1500));
    const q = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value;
    console.log('grp count:', await q('document.querySelectorAll(".grp").length'));
    console.log('typeof DB:', await q('typeof DB'));
    console.log('typeof renderGroups:', await q('typeof renderGroups'));
    console.log('typeof zipOut:', await q('typeof zipOut'));
    console.log('exceptions:', exceptions.length ? exceptions.slice(0, 3) : 'none');
    e.kill(); srv.kill(); process.exit(0);
  } catch (ex) { console.log('ERR', ex.message); e.kill(); srv.kill(); process.exit(1); }
}, 1000);
