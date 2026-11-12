/* v60j DOM 冒烟：首次打标（existing=null）→ 画笔画 → 确认 → 立即导出解析，遮罩必须被收录
 * 复现原 bug：草稿写 seg_frame key，导出读 char_ref.id key → 漏
 */
'use strict';
import { spawn } from 'node:child_process';
const ROOT = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www';
const SRV = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/tools/dev/staticsrv.cjs';
const PORT = 4244, CDP = 9300;
const srv = spawn(process.execPath, [SRV, ROOT, String(PORT)], { stdio: 'ignore' });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const e = spawn(EDGE, [
  '--remote-debugging-port=' + CDP, '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + process.env.TEMP + '/edge_v60j',
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
  await q(`window.confirm=function(){return true;}; window.prompt=function(){return null;}; 'ok'`);
  await new Promise(r => setTimeout(r, 1800));

  /* 首次打标：existing=null（模拟视频首帧） */
  const opened = await q(`(function(){
    var cards = { schema:'moyutai.charcards.v1', orig_char_descs:['origA'], dest_char_descs:['destB'],
      cards:[{ id:'c1', name:'GPT', tag:'', img:'' }] };
    var fc = document.createElement('canvas'); fc.width=640; fc.height=360;
    var cx = fc.getContext('2d'); cx.fillStyle='#666'; cx.fillRect(0,0,640,360);
    window.__done = { called:false, entries:null };
    window.__img.openTagMode({ project:'p60j', seg:'001', frame:0, at:0, kind:'split',
      existing:null, cards:cards, frameCanvas:fc,
      onDone:function(en){ window.__done={called:true, entries:en}; }, onCancel:function(){} });
    return 'OK';
  })()`);
  check('openTagMode（existing=null）', opened === 'OK', opened);

  /* 建层：图层新增 → 选卡 */
  await q(`[...document.querySelectorAll('.img-tagbar-bottom .img-grp')].find(g=>g.textContent.indexOf('\u56fe\u5c42')>=0).click()`);
  await new Promise(r => setTimeout(r, 150));
  await q(`[...document.querySelectorAll('.img-layers-top .img-sub-btn')].find(b=>(b.title||'').indexOf('\u65b0\u5efa')>=0).click()`);
  await new Promise(r => setTimeout(r, 150));
  await q(`[...document.querySelectorAll('.img-cardpicker-row')][0].click()`);
  await new Promise(r => setTimeout(r, 250));

  /* 切画笔并画一笔 */
  await q(`[...document.querySelectorAll('.img-sub-btn')].find(x=>(x.title||'').indexOf('\u6d82\u62b9')>=0).click()`);
  const drawn = await q(`(function(){
    var stage = document.querySelector('.img-stage');
    var r = stage.getBoundingClientRect();
    var mk = function(t,x,y,b){ return new PointerEvent(t,{bubbles:true,cancelable:true,pointerId:3,pointerType:'pen',isPrimary:true,clientX:x,clientY:y,buttons:b}); };
    stage.dispatchEvent(mk('pointerdown', r.x+50, r.y+50, 1));
    stage.dispatchEvent(mk('pointermove', r.x+120, r.y+100, 1));
    stage.dispatchEvent(mk('pointerup', r.x+120, r.y+100, 0));
    var st = window.__img.state();
    return { strokes: st.totalStrokes, layers: st.layers };
  })()`);
  check('画了一笔', drawn.strokes >= 1, JSON.stringify(drawn));

  /* 记录确认前的 key 列表 */
  const keysBefore = await q(`JSON.stringify(Object.keys(localStorage).filter(k=>k.indexOf('tagmask')>=0))`);
  console.log('draft keys before confirm:', keysBefore);

  /* 确认 */
  await q(`document.querySelector('.img-tag-okbar .img-grp').click()`);
  await new Promise(r => setTimeout(r, 300));
  const d = JSON.parse(await q(`JSON.stringify(window.__done)`));
  console.log('onDone:', JSON.stringify(d));
  check('entries 带 mask', !!(d.entries && d.entries[0] && d.entries[0].mask), JSON.stringify(d.entries));

  const keysAfter = await q(`JSON.stringify(Object.keys(localStorage).filter(k=>k.indexOf('tagmask')>=0))`);
  console.log('draft keys after confirm:', keysAfter);

  /* 立即导出解析：模拟 av-ui 的 need 判定（loadTagMaskLayers 走两个 key） */
  const resolved = await q(`(function(){
    var L = window.__avLogic;
    var marks = { version:1, marks:[] };
    L.upsertCharRef(marks, '001', 0, window.__done.entries);
    var ref = marks.marks[0];
    /* 复刻 av-ui loadTagMaskLayers 的双 key 逻辑 */
    var keys = ['av-p60j-tagmask-' + ref.id, 'av-p60j-tagmask-' + ref.seg + '_' + L.frameAt(ref.at, 25)];
    var hit = null, hitKey = null;
    for (var i=0;i<keys.length;i++){
      var raw = localStorage.getItem(keys[i]);
      if (!raw) continue;
      var o = JSON.parse(raw);
      if (o && o.schema==='moyutai.imgmask.v2' && Array.isArray(o.layers)) { hit = o; hitKey = keys[i]; break; }
    }
    var strokes = hit ? hit.layers.reduce(function(n,l){return n + (l.strokes?l.strokes.length:0);},0) : -1;
    return { refId: ref.id, triedKeys: keys, hitKey: hitKey, layers: hit?hit.layers.length:0, strokes: strokes };
  })()`);
  console.log('resolve:', JSON.stringify(resolved));
  check('首次导出能读到草稿（key fallback）', resolved && resolved.hitKey !== null, JSON.stringify(resolved));
  check('读到笔画数 > 0', resolved && resolved.strokes >= 1, 'strokes=' + (resolved && resolved.strokes));
} catch (ex) { console.log('ERR', ex.message); }
finally {
  try { ws && ws.close(); } catch { }
  try { srv.kill(); e.kill(); } catch { }
  console.log('v60j-dom: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
  process.exit(fail ? 1 : 0);
}
