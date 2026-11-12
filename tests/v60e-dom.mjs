/* v60e DOM 冒烟 v4（最终版）：带 frameCanvas，验证两条栏几何 + 确认/取消按钮 */
'use strict';
import { spawn } from 'node:child_process';
const ROOT = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www';
const SRV = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/tools/dev/staticsrv.cjs';
const PORT = 4235, CDP = 9291;
const srv = spawn(process.execPath, [SRV, ROOT, String(PORT)], { stdio: 'ignore' });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const e = spawn(EDGE, [
  '--remote-debugging-port=' + CDP, '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + process.env.TEMP + '/edge_v60e4',
  '--window-size=800,360',
  'http://127.0.0.1:' + PORT + '/index.html',
], { stdio: 'ignore' });
let ws, id = 0; const pend = new Map();
let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log('PASS ' + n + (extra ? ' | ' + extra : '')); } else { fail++; console.log('FAIL ' + n + (extra ? ' | ' + extra : '')); } };
try {
  let list;
  for (let i = 0; i < 40; i++) { try { list = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json(); if (list.find(t => t.type === 'page' && t.url.includes(String(PORT)))) break; } catch { } await new Promise(r => setTimeout(r, 400)); }
  const pg = list.find(t => t.type === 'page' && t.url.includes(String(PORT)));
  ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
  const send = (me, pa = {}) => new Promise(res => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method: me, params: pa })); });
  const q = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
  await send('Runtime.enable');
  await new Promise(r => setTimeout(r, 2200));

  const opened = await q(`(function(){
    try {
      var cards = { schema:'moyutai.charcards.v1', orig_char_descs:[], dest_char_descs:[], cards:[
        { id:'c1', name:'GPT', tag:'', img:'' } ]};
      var fc = document.createElement('canvas'); fc.width = 640; fc.height = 360;
      fc.getContext('2d').fillStyle = '#888'; fc.getContext('2d').fillRect(0,0,640,360);
      window.__img.openTagMode({ project:'smoke', seg:1, frame:0, at:0, kind:'split', existing:null, cards:cards, frameCanvas:fc, onDone:function(){}, onCancel:function(){} });
      return 'OK';
    } catch (e) { return 'ERR ' + e.message; }
  })()`);
  check('openTagMode executed', opened === 'OK', opened);
  await new Promise(r => setTimeout(r, 400));

  const okbar = await q(`(function(){
    var b = document.querySelector('.img-tag-okbar');
    if (!b) return null;
    var grps = [...b.querySelectorAll(':scope > .img-grp')].map(function(g){ var r=g.getBoundingClientRect(); return { t: g.textContent.trim(), vis: r.width>0 && r.height>0, x: Math.round(r.x) }; });
    var r = b.getBoundingClientRect();
    return { grps: grps, x: Math.round(r.x), y: Math.round(r.y), open: b.classList.contains('open') };
  })()`);
  console.log('okbar:', JSON.stringify(okbar));
  check('okbar 两个按钮（确认/取消）', okbar && okbar.grps.length === 2, okbar && okbar.grps.map(g => g.t).join('|'));
  check('okbar 两按钮可见', okbar && okbar.grps.every(g => g.vis));
  check('okbar 在左上（x<60, y<60）', okbar && okbar.x >= 0 && okbar.x < 60 && okbar.y >= 0 && okbar.y < 60);

  const bar = await q(`(function(){
    var b = document.querySelector('.img-tagbar-bottom');
    if (!b) return null;
    var r = b.getBoundingClientRect();
    var cs = getComputedStyle(b);
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      vw: window.innerWidth, vh: window.innerHeight, dir: cs.flexDirection, pos: cs.position, disp: cs.display };
  })()`);
  console.log('tagbar:', JSON.stringify(bar));
  check('底栏可见（display flex）', bar && bar.disp === 'flex');
  check('底栏横排（row）', bar && bar.dir === 'row');
  check('底栏贴底（y+h >= vh-16）', bar && (bar.y + bar.h) >= (bar.vh - 16));
  check('底栏水平居中（|cx-vw/2|<30）', bar && Math.abs((bar.x + bar.w / 2) - bar.vw / 2) < 30);
} catch (ex) { console.log('ERR', ex.message); }
finally {
  try { ws && ws.close(); } catch { }
  try { srv.kill(); e.kill(); } catch { }
  console.log('v60e-dom: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
  process.exit(fail ? 1 : 0);
}
