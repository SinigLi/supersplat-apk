/* v61e DOM 冒烟：只导 JSON 时，头像 + 原图都要回来 */
'use strict';
import { spawn } from 'child_process';
const ROOT = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www';
const SRV = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/tools/dev/staticsrv.cjs';
const PORT = 4254, CDP = 9310;
const srv = spawn(process.execPath, [SRV, ROOT, String(PORT)], { stdio: 'ignore' });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const e = spawn(EDGE, ['--remote-debugging-port=' + CDP, '--headless=new', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + process.env.TEMP + '/edge_v61e', '--window-size=800,360', 'http://127.0.0.1:' + PORT + '/index.html'], { stdio: 'ignore' });
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
  await new Promise(r => setTimeout(r, 2000));

  const res = await q(`(async function(){
    try {
      var jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
      var png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      var data = window.CC.normalize({ schema:'moyutai.charcards.v1', orig_char_descs:[], dest_char_descs:[],
        cards:[{ id:'c1', name:'GPT', tag:'', img:jpg, imgFull:png },
               { id:'c2', name:'小圆 日常', tag:'', img:jpg, imgFull:png }] });
      var plan = window.CC.exportPlan(data);
      var inlineImg = plan.json.cards.filter(function(c){ return !!c.img; }).length;
      var inlineFull = plan.json.cards.filter(function(c){ return !!c.imgFull; }).length;
      var hasFullFile = plan.json.cards.filter(function(c){ return !!c.imgFullFile; }).length;
      /* 只导 JSON（无 imgMap） */
      var back = window.CC.importFromParts(JSON.parse(JSON.stringify(plan.json)), {});
      return JSON.stringify({ inlineImg: inlineImg, inlineFull: inlineFull, fullFileRefs: hasFullFile,
        cards: back.cards.map(function(c){ return { name:c.name, hasImg: !!c.img, hasFull: !!c.imgFull }; }) });
    } catch (e) { return 'ERR ' + (e && (e.stack || e.message) || e); }
  })()`);
  console.log('result:', res);
  const r = JSON.parse(res);
  check('导出 JSON 内嵌头像', r.inlineImg === 2, 'inlineImg=' + r.inlineImg);
  check('导出 JSON 内嵌原图', r.inlineFull === 2, 'inlineFull=' + r.inlineFull);
  check('仍保留 chars_full/ 路径引用（ZIP 用）', r.fullFileRefs === 2);
  check('只导 JSON：两张卡都有头像', r.cards.every(c => c.hasImg));
  check('只导 JSON：两张卡都有原图（v61e 关键）', r.cards.every(c => c.hasFull), JSON.stringify(r.cards));
} catch (ex) { console.log('ERR', ex.message); }
finally {
  try { ws && ws.close(); } catch { }
  try { srv.kill(); e.kill(); } catch { }
  console.log('v61e-dom: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
  process.exit(fail ? 1 : 0);
}
