/* rm 存在于行内——但 DOM3 冒烟查 .img-layer-rm 是 0：说明图层面板行没渲染（layersListEl 空）。
 * 「图层面板」需要点「图层」按钮才 renderLayersPanel + 打开。冒烟里没点图层按钮，行不在 DOM。
 * 但 v60f-dom.mjs v2 里删除查询也是 0 → 同因。修正冒烟：先点图层按钮。
 */
'use strict';
import { spawn } from 'node:child_process';
const ROOT = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www';
const SRV = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/tools/dev/staticsrv.cjs';
const PORT = 4240, CDP = 9296;
const srv = spawn(process.execPath, [SRV, ROOT, String(PORT)], { stdio: 'ignore' });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const e = spawn(EDGE, [
  '--remote-debugging-port=' + CDP, '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + process.env.TEMP + '/edge_v60f4',
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
  await q(`window.confirm = function(){ return true; }; window.prompt = function(){ return null; }; 'ok'`);
  await new Promise(r => setTimeout(r, 1800));

  const opened = await q(`(function(){
    var cards = { schema:'moyutai.charcards.v1', orig_char_descs:[], dest_char_descs:[], cards:[
      { id:'c1', name:'GPT', tag:'', img:'' }, { id:'c2', name:'Homura', tag:'', img:'' }]};
    var fc = document.createElement('canvas'); fc.width = 640; fc.height = 360;
    window.__done = { called:false, entries:null };
    window.__img.openTagMode({ project:'s60f', seg:1, frame:0, at:0, kind:'split', existing:null, cards:cards, frameCanvas:fc,
      onDone:function(en){ window.__done = { called:true, entries:en }; }, onCancel:function(){} });
    return 'OK';
  })()`);
  check('openTagMode OK', opened === 'OK', opened);

  /* 角色按钮 → 选第一张卡 → 建层 */
  await q(`[...document.querySelectorAll('.img-tagbar-bottom .img-grp')].find(g=>g.textContent.includes('角色')).click()`);
  await new Promise(r => setTimeout(r, 200));
  await q(`[...document.querySelectorAll('.img-cardpicker-row')][0].click()`);
  await new Promise(r => setTimeout(r, 300));
  const s1 = JSON.parse(await q(`JSON.stringify(window.__img.state())`));
  check('选角色建 1 层', s1.layers === 1, 'layers=' + s1.layers);

  /* 点「图层」按钮 → 打开图层面板（渲染行） */
  await q(`[...document.querySelectorAll('.img-tagbar-bottom .img-grp')].find(g=>g.textContent.includes('图层')).click()`);
  await new Promise(r => setTimeout(r, 200));
  const rmInfo = await q(`JSON.stringify({ rm: document.querySelectorAll('.img-layer-rm').length })`);
  check('图层面板出现删除按钮', JSON.parse(rmInfo).rm >= 1, rmInfo);

  /* 点行尾删除 → confirm 已自动 true → 0 层 */
  const del = await q(`(function(){
    var rm = document.querySelector('.img-layer-rm');
    rm.click();
    var s = window.__img.state();
    return { layers: s.layers, activeId: s.activeId };
  })()`);
  console.log('after del:', JSON.stringify(del));
  check('删光到 0 层（tagMode allowEmpty）', del.layers === 0, JSON.stringify(del));
  check('0 层 activeId=null', del.activeId === null);

  /* 确认 → onDone 空 entries（0 角色 → 清打标） */
  await q(`document.querySelector('.img-tag-okbar .img-grp').click()`);
  await new Promise(r => setTimeout(r, 300));
  const d = JSON.parse(await q(`JSON.stringify(window.__done)`));
  console.log('onDone:', JSON.stringify(d));
  check('确认后 onDone 被调用', d.called === true);
  check('onDone 空 entries（清除打标）', Array.isArray(d.entries) && d.entries.length === 0, JSON.stringify(d.entries));
} catch (ex) { console.log('ERR', ex.message); }
finally {
  try { ws && ws.close(); } catch { }
  try { srv.kill(); e.kill(); } catch { }
  console.log('v60f-dom: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
  process.exit(fail ? 1 : 0);
}
