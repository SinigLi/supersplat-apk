/* v61d DOM 冒烟：从导出的 ZIP 里单独取 charcards.json 再导入，头像必须回来
 * （复现 debug_26：file=charcards.json inlineImgs=0 fileRefs=11）
 */
'use strict';
import { spawn } from 'child_process';
const ROOT = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www';
const SRV = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/tools/dev/staticsrv.cjs';
const PORT = 4253, CDP = 9309;
const srv = spawn(process.execPath, [SRV, ROOT, String(PORT)], { stdio: 'ignore' });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const e = spawn(EDGE, ['--remote-debugging-port=' + CDP, '--headless=new', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + process.env.TEMP + '/edge_v61d', '--window-size=800,360', 'http://127.0.0.1:' + PORT + '/index.html'], { stdio: 'ignore' });
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
      /* 源卡组 */
      var data = window.CC.normalize({ schema:'moyutai.charcards.v1', orig_char_descs:[], dest_char_descs:[],
        cards:[{ id:'c1', name:'GPT', tag:'', img:jpg }, { id:'c2', name:'小圆 日常', tag:'', img:jpg }] });
      /* 模拟 v61d 之后 exportPlan 产出的 JSON（含内联 img） */
      var plan = window.CC.exportPlan(data);
      var jsonObj = plan.json;
      var inlineCount = jsonObj.cards.filter(function(c){ return !!c.img; }).length;

      /* 仅导入这个 JSON（不带 imgMap），模拟老板「只选 charcards.json」 */
      var v2 = window.CC.importFromParts(JSON.parse(JSON.stringify(jsonObj)), {});
      return JSON.stringify({ inlineCount: inlineCount, cards: v2.cards.map(function(c){ return { name:c.name, hasImg: !!c.img }; }) });
    } catch (e) { return 'ERR ' + (e && (e.stack || e.message) || e); }
  })()`);
  console.log('result:', res);
  const r = JSON.parse(res);
  check('导出 JSON 内嵌头像', r.inlineCount === 2, 'inline=' + r.inlineCount);
  check('只导 JSON：GPT 有头像', r.cards[0].hasImg === true);
  check('只导 JSON：带空格名也有头像（debug_26 场景）', r.cards[1].hasImg === true, JSON.stringify(r.cards[1]));
} catch (ex) { console.log('ERR', ex.message); }
finally {
  try { ws && ws.close(); } catch { }
  try { srv.kill(); e.kill(); } catch { }
  console.log('v61d-dom: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
  process.exit(fail ? 1 : 0);
}
