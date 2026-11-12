/* 截图单独抓（页面打开 + 渲染后 captureScreenshot 存 workspace temp） */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const PORT = 4201, CDP = 9266;
const ROOT = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore', cwd: ROOT });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-sync', '--disable-features=msEdgeSyncConfirmation',
  '--user-data-dir=' + path.join(process.env.TEMP, 'edge_v59_shot'),
  '--window-size=430,900',
  `http://127.0.0.1:${PORT}/prototype/cardgroups-proto.html`,
], { stdio: 'ignore', cwd: ROOT });
let ws, id = 0; const pending = new Map();
try {
  let list;
  for (let i = 0; i < 40; i++) { try { list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); if (list.find(t => t.type === 'page' && t.url.includes(PORT))) break; } catch {} await sleep(400); }
  const page = list.find(t => t.type === 'page' && t.url.includes(PORT));
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise(res => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send('Page.enable'); await sleep(1500);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('F:/openclawhome/openclaw/fullstack_workspace/temp/v59-proto.png', Buffer.from(shot.data, 'base64'));
  console.log('saved', fs.statSync('F:/openclawhome/openclaw/fullstack_workspace/temp/v59-proto.png').size, 'B');
} catch (e) { console.log('ERR', e.message); }
finally { try { ws && ws.close(); } catch {} edge.kill(); srv.kill(); process.exit(0); }
