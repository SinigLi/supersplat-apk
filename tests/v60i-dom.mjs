/* v60i DOM 证据：打标页只建遮罩层不画笔 → onDone 应返回含 name+desc 的 entries（mask 为空）
 * 并验证 buildExport 后 JSON 里有 name / orig_char_desc / dest_char_desc
 */
'use strict';
import { spawn } from 'node:child_process';
const ROOT = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www';
const SRV = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/tools/dev/staticsrv.cjs';
const PORT = 4243, CDP = 9299;
const srv = spawn(process.execPath, [SRV, ROOT, String(PORT)], { stdio: 'ignore' });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const e = spawn(EDGE, [
  '--remote-debugging-port=' + CDP, '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + process.env.TEMP + '/edge_v60i',
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

  /* 打开打标页（模拟「多帧 10」目标），记录 onDone */
  const opened = await q(`(function(){
    var cards = { schema:'moyutai.charcards.v1', orig_char_descs:['原角色A'], dest_char_descs:['目标B'],
      cards:[{ id:'c1', name:'GPT', tag:'', img:'' }] };
    var fc = document.createElement('canvas'); fc.width=640; fc.height=360;
    window.__done = { called:false, entries:null };
    window.__img.openTagMode({ project:'s60i', seg:'001', frame:10, at:10/25, kind:'multiframe',
      existing:null, cards:cards, frameCanvas:fc,
      onDone:function(en){ window.__done={called:true, entries:en}; }, onCancel:function(){} });
    return 'OK';
  })()`);
  check('openTagMode OK', opened === 'OK', opened);

  /* 建一层：图层面板顶部「新增」→ 角色卡选择器（不画笔） */
  const added = await q(`(function(){
    var grps = [...document.querySelectorAll('.img-tagbar-bottom .img-grp')];
    var lay = grps.find(function(g){ return g.textContent.indexOf('\u56fe\u5c42') >= 0; });
    if (!lay) return 'NO LAYER BTN';
    lay.click();
    var add = [...document.querySelectorAll('.img-layers-top .img-sub-btn')].find(function(b){ return (b.title||'').indexOf('\u65b0\u5efa') >= 0; });
    if (!add) return 'NO ADD BTN';
    add.click();
    var rows = [...document.querySelectorAll('.img-cardpicker-row')];
    if (!rows.length) return 'NO CARDS';
    rows[0].click();
    return 'added';
  })()`);
  await new Promise(r => setTimeout(r, 300));
  check('通过图层新增建层', added === 'added', added);
  const st = JSON.parse(await q(`JSON.stringify(window.__img.state())`));
  check('有 1 层且 0 笔画', st.layers === 1 && st.totalStrokes === 0, JSON.stringify({ layers: st.layers, strokes: st.totalStrokes }));

  /* 填写描述（模拟老板填名字+描述） */
  const desc = await q(`(function(){
    var btn = [...document.querySelectorAll('.img-tagbar-bottom .img-grp')].find(function(g){ return g.textContent.indexOf('\u63cf\u8ff0') >= 0; });
    if (!btn) return 'NO DESC BTN';
    btn.click();
    var ins = [...document.querySelectorAll('#imgTagDescPanel input')];
    if (!ins.length) return 'NO INPUTS';
    ins[0].value = 'origA';
    ins[0].dispatchEvent(new Event('input', { bubbles: true }));
    if (ins[1]) { ins[1].value = 'destB'; ins[1].dispatchEvent(new Event('input', { bubbles: true })); }
    return 'desc-set:' + ins.length;
  })()`);
  console.log('desc:', desc);

  /* 确认 */
  await q(`document.querySelector('.img-tag-okbar .img-grp').click()`);
  await new Promise(r => setTimeout(r, 300));
  const d = JSON.parse(await q(`JSON.stringify(window.__done)`));
  console.log('onDone:', JSON.stringify(d));
  check('确认后 onDone 被调用', d.called === true);
  check('entries 含该角色（无笔画也保留）', Array.isArray(d.entries) && d.entries.length === 1 && d.entries[0].name === 'GPT', JSON.stringify(d.entries));
  check('entries 无 mask（未画笔）', d.entries && d.entries[0] && !d.entries[0].mask, JSON.stringify(d.entries && d.entries[0]));
  check('entries 带到描述', d.entries && d.entries[0] && d.entries[0].orig_char_desc === 'origA' && d.entries[0].dest_char_desc === 'destB', JSON.stringify(d.entries && d.entries[0]));

  /* 用真实链路生成 JSON：upsertCharRef + buildExport */
  const json = await q(`(function(){
    var L = window.__avLogic;
    if (!L) return 'NO __avLogic';
    var marks = { version: 1, marks: [ { id:'p', type:'multiframe_ref', seg:'001', frames:[10,40] } ] };
    L.upsertCharRef(marks, '001', 10/25, window.__done.entries);
    var files = [ { name:'001.mp4', label:'001', seq:1 } ];
    var out = L.buildExport({ fps:25, mode:'video', folderName:'clip' }, marks, files);
    return JSON.stringify(out);
  })()`);
  const j = JSON.parse(json);
  const pt = (j.marks[0].points || []).filter(p => p.at_frame === 10)[0];
  console.log('exported point@10:', JSON.stringify(pt));
  check('JSON 在该帧点上有 chars', !!(pt && pt.chars && pt.chars.length === 1), JSON.stringify(pt));
  check('JSON chars 含 name', !!(pt && pt.chars && pt.chars[0].name === 'GPT'));
  check('JSON chars 含两个描述', !!(pt && pt.chars && pt.chars[0].orig_char_desc && pt.chars[0].dest_char_desc), JSON.stringify(pt && pt.chars && pt.chars[0]));
  check('JSON chars 无 mask（未画笔）', !!(pt && pt.chars && !pt.chars[0].mask));
} catch (ex) { console.log('ERR', ex.message); }
finally {
  try { ws && ws.close(); } catch { }
  try { srv.kill(); e.kill(); } catch { }
  console.log('v60i-dom: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
  process.exit(fail ? 1 : 0);
}
