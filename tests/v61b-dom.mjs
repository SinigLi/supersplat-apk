/* v61b DOM 冒烟：进度条 + 角色组 zip 往返导入
 * 1) Prog 存在且 show/set/done/hide 生效（DOM 上有 .prog-mask / .prog-bar 宽度）
 * 2) 卡组导出 zip → 用 exportPlan+importFromParts 往返，图片必须全部回来（含带空格名）
 * 3) 走真实 importFile 路径：stub <input type=file> 难，改为直接调 CC.importFromParts（同一条链路）
 */
'use strict';
import { spawn } from 'node:child_process';
const ROOT = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www';
const SRV = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/tools/dev/staticsrv.cjs';
const PORT = 4251, CDP = 9307;
const srv = spawn(process.execPath, [SRV, ROOT, String(PORT)], { stdio: 'ignore' });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const e = spawn(EDGE, ['--remote-debugging-port=' + CDP, '--headless=new', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + process.env.TEMP + '/edge_v61b2', '--window-size=800,360', 'http://127.0.0.1:' + PORT + '/index.html'], { stdio: 'ignore' });
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

  /* 1. Progress module */
  const prog = await q(`(function(){
    if (!window.Prog) return 'NO Prog';
    window.Prog.show('test title');
    window.Prog.set(0.4, 'mid');
    var mask = document.querySelector('.prog-mask');
    var bar = document.querySelector('.prog-bar');
    var ttl = document.querySelector('.prog-ttl');
    return JSON.stringify({ open: window.Prog.isOpen(), hasMask: !!mask, barW: bar ? bar.style.width : null, ttl: ttl ? ttl.textContent : null });
  })()`);
  console.log('prog:', prog);
  const pj = JSON.parse(prog);
  check('Prog 已加载且显示', pj.open === true && pj.hasMask === true, prog);
  check('进度条宽度按比例', pj.barW === '40%', pj.barW);
  check('标题+百分比渲染', pj.ttl && pj.ttl.indexOf('test title') >= 0 && pj.ttl.indexOf('40%') >= 0, pj.ttl);

  await q(`window.Prog.done('done', 100)`);
  await new Promise(r => setTimeout(r, 200));
  check('done 后自动隐藏', await q(`window.Prog.isOpen()`) === false);

  /* 2. 卡组导出 → 导入往返（含空格名、带 imgFull） */
  const rt = await q(`(function(){
    try {
      var jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
      var png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      var data = window.CC.normalize({ schema:'moyutai.charcards.v1', orig_char_descs:['A'], dest_char_descs:['B'],
        cards:[{ id:'c1', name:'GPT', tag:'t1', img:jpg },
               { id:'c2', name:'小圆 日常', tag:'', img:jpg, imgFull:png }] });
      var plan = window.CC.exportPlan(data);
      var entries = { 'charcards.json': new TextEncoder().encode(JSON.stringify(plan.json, null, 2)) };
      plan.images.forEach(function (im) {
        var b64 = im.dataUrl.split(',')[1];
        var bin = atob(b64); var u8 = new Uint8Array(bin.length);
        for (var i=0;i<bin.length;i++) u8[i] = bin.charCodeAt(i);
        entries[im.file] = u8;
      });
      var zipped = window.fflate.zipSync(entries, { level: 0 });
      var un = window.fflate.unzipSync(zipped);
      /* 复刻 importFile 的 imgMap 构建（v61b 未改这步：key 仍是去前缀的 basename） */
      var imgMap = {};
      Object.keys(un).forEach(function (k) {
        if (k.indexOf('chars/') === 0) {
          var arr = un[k], s2 = '';
          for (var j=0;j<arr.length;j++) s2 += String.fromCharCode(arr[j]);
          imgMap[k.slice('chars/'.length)] = 'data:image/jpeg;base64,' + btoa(s2);
        }
        if (k.indexOf('chars_full/') === 0) {
          var arr2 = un[k], s3 = '';
          for (var j2=0;j2<arr2.length;j2++) s3 += String.fromCharCode(arr2[j2]);
          imgMap[k.slice('chars_full/'.length)] = 'data:image/png;base64,' + btoa(s3);
        }
      });
      var back = window.CC.importFromParts(JSON.parse(new TextDecoder().decode(un['charcards.json'])), imgMap);
      return JSON.stringify({ zipKeys: Object.keys(un),
        cards: back.cards.map(function(c){ return { name:c.name, tag:c.tag, hasImg: !!c.img, hasFull: !!c.imgFull }; }) });
    } catch (e) { return 'ERR ' + (e && (e.stack || e.message) || e); }
  })()`);
  console.log('roundtrip:', rt);
  const r = JSON.parse(rt);
  check('导出 zip 含两张头像', r.zipKeys.filter(k => k.indexOf('chars/') === 0).length === 2, JSON.stringify(r.zipKeys));
  check('导出 zip 含原图', r.zipKeys.filter(k => k.indexOf('chars_full/') === 0).length === 1, JSON.stringify(r.zipKeys));
  check('导入后 GPT 有图', r.cards[0].hasImg === true);
  check('导入后「小圆 日常」有图（旧 bug 在这里丢）', r.cards[1].hasImg === true, JSON.stringify(r.cards[1]));
  check('导入后 tag 保留', r.cards[0].tag === 't1');
  check('导入后原图回来', r.cards[1].hasFull === true);
} catch (ex) { console.log('ERR', ex.message); }
finally {
  try { ws && ws.close(); } catch { }
  try { srv.kill(); e.kill(); } catch { }
  console.log('v61b-dom: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
  process.exit(fail ? 1 : 0);
}
