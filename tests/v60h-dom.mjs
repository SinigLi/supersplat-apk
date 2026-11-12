/* v60h DOM 冒烟：无层画笔被拦（toast 提示建层）→ 选角色建层 → 直接画笔落点成功（无需启用）
 * 模拟 pointer 事件画一笔，断言激活层 strokes=1
 */
'use strict';
import { spawn } from 'node:child_process';
const ROOT = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www';
const SRV = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/tools/dev/staticsrv.cjs';
const PORT = 4241, CDP = 9297;
const srv = spawn(process.execPath, [SRV, ROOT, String(PORT)], { stdio: 'ignore' });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const e = spawn(EDGE, [
  '--remote-debugging-port=' + CDP, '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + process.env.TEMP + '/edge_v60h',
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
      { id:'c1', name:'GPT', tag:'', img:'' }]};
    var fc = document.createElement('canvas'); fc.width = 640; fc.height = 360;
    window.__img.openTagMode({ project:'s60h', seg:1, frame:0, at:0, kind:'split', existing:null, cards:cards, frameCanvas:fc, onDone:function(){}, onCancel:function(){} });
    return 'OK';
  })()`);
  check('openTagMode OK', opened === 'OK', opened);

  /* 无层时落笔：应 toast 拦截，drawing=false */
  const blocked = await q(`(function(){
    var stage = document.querySelector('.img-stage');
    var r = stage.getBoundingClientRect();
    var opts = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: r.x + 50, clientY: r.y + 50, buttons: 1 };
    stage.dispatchEvent(new PointerEvent('pointerdown', opts));
    /* 必须收尾：否则 pointers Map 残留触点，后续单指绘制会被判成双指捏合 */
    stage.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, opts, { buttons: 0 })));
    stage.dispatchEvent(new PointerEvent('pointercancel', Object.assign({}, opts, { buttons: 0 })));
    var st = window.__img.state();
    return { strokes: st.totalStrokes, layers: st.layers, blockedToast: !!document.querySelector('.img-hint.err') };
  })()`);
  console.log('no-layer draw:', JSON.stringify(blocked));
  check('无层时不可画（0 笔）', blocked.strokes === 0 && blocked.layers === 0, JSON.stringify(blocked));

  /* 选角色建层 */
  await q(`[...document.querySelectorAll('.img-tagbar-bottom .img-grp')].find(g=>g.textContent.includes('角色')).click()`);
  await new Promise(r => setTimeout(r, 200));
  await q(`[...document.querySelectorAll('.img-cardpicker-row')][0].click()`);
  await new Promise(r => setTimeout(r, 300));
  const st1 = JSON.parse(await q(`JSON.stringify(window.__img.state())`));
  check('选角色建层', st1.layers === 1, 'layers=' + st1.layers);

  /* 直接画一笔（不点任何启用）→ 应成功 */
  /* 切画笔工具（涂抹按钮在绘制子面板） */
  const tool = await q(`(function(){
    var b = [...document.querySelectorAll('.img-sub-btn')].find(function(x){ return (x.title||'').indexOf('\u6d82\u62b9') >= 0; });
    if (!b) return 'NO BRUSH BTN';
    b.click(); return 'brush';
  })()`);
  check('切画笔工具', tool === 'brush', tool);
  const drawn = await q(`(function(){
    var stage = document.querySelector('.img-stage');
    var r = stage.getBoundingClientRect();
    var mk = function(type, x, y, buttons) { return new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'pen', isPrimary: true, clientX: x, clientY: y, buttons: buttons }); };
    stage.dispatchEvent(mk('pointerdown', r.x + 60, r.y + 60, 1));
    stage.dispatchEvent(mk('pointermove', r.x + 120, r.y + 90, 1));
    stage.dispatchEvent(mk('pointermove', r.x + 180, r.y + 120, 1));
    stage.dispatchEvent(mk('pointerup', r.x + 180, r.y + 120, 0));
    var st = window.__img.state();
    return { strokes: st.totalStrokes, layers: st.layers, activeName: st.activeName };
  })()`);
  console.log('draw:', JSON.stringify(drawn));
  check('有激活层直接可画（无需启用）', drawn.strokes >= 1, JSON.stringify(drawn));

  /* 画完自动落盘（v54 语义）→ 草稿 key 里 strokes>=1 */
  const saved = await q(`(function(){
    var k = Object.keys(localStorage).filter(function(x){ return x.indexOf('tagmask') >= 0; })[0];
    if (!k) return 'NO KEY';
    var d = JSON.parse(localStorage.getItem(k));
    return { layers: d.layers.length, strokes: d.layers.reduce(function(n,l){ return n + l.strokes.length; }, 0) };
  })()`);
  console.log('saved draft:', JSON.stringify(saved));
  check('笔画已落盘（草稿 layers=1 strokes>=1）', saved && saved.strokes >= 1, JSON.stringify(saved));
} catch (ex) { console.log('ERR', ex.message); }
finally {
  try { ws && ws.close(); } catch { }
  try { srv.kill(); e.kill(); } catch { }
  console.log('v60h-dom: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
  process.exit(fail ? 1 : 0);
}
