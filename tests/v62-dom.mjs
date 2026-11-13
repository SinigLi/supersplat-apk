/* v62 DOM 冒烟：视频导出链路（debug_28 的 92% 闪退场景）
 * 断言：
 *  1) 导出全程分阶段日志（START / tagmask / char group pack / zip / shareFile）
 *  2) charcards.json 不再内嵌 base64 原图，只留路径（ZIP 里已有 chars_full/ 二进制）
 *  3) 遮罩空笔画层被跳过，不产出黑图
 *  4) 导出结束不留 <video> 解码器
 */
'use strict';
import { spawn } from 'child_process';
const ROOT = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www';
const SRV = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/tools/dev/staticsrv.cjs';
const PORT = 4256, CDP = 9312;
const srv = spawn(process.execPath, [SRV, ROOT, String(PORT)], { stdio: 'ignore' });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const e = spawn(EDGE, [
  '--remote-debugging-port=' + CDP, '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + process.env.TEMP + '/edge_v62',
  '--window-size=800,360',
  'http://127.0.0.1:' + PORT + '/index.html'
], { stdio: 'ignore' });
let ws, id = 0; const pend = new Map();
const logs = [];
let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log('PASS ' + n + (extra ? ' | ' + extra : '')); } else { fail++; console.log('FAIL ' + n + (extra ? ' | ' + extra : '')); } };
try {
  let list;
  for (let i = 0; i < 40; i++) { try { list = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json(); if (list.find(t => t.type === 'page' && t.url.includes(String(PORT)))) break; } catch { } await new Promise(r => setTimeout(r, 400)); }
  const pg = list.find(t => t.type === 'page' && t.url.includes(String(PORT)));
  ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + ((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text));
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  };
  const send = (me, pa = {}) => new Promise(res => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method: me, params: pa })); });
  const q = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
  await send('Runtime.enable');
  await new Promise(r => setTimeout(r, 2200));

  /* 桩：DebugLog 收集日志；SaveImage 捕获 shareFile payload */
  const stub = await q(`(function(){
    window.__LOG = []; window.__SHARED = null;
    window.Capacitor = window.Capacitor || {}; window.Capacitor.Plugins = window.Capacitor.Plugins || {};
    window.Capacitor.Plugins.DebugLog = { append: function(o){ window.__LOG.push(o.text); return Promise.resolve({ok:true}); } };
    window.Capacitor.Plugins.SaveImage = { shareFile: function(o){ window.__SHARED = { filename:o.filename, data:o.data, mime:o.mime }; return Promise.resolve({ok:true}); } };
    return 'stubs ready';
  })()`);
  check('桩安装', stub === 'stubs ready', stub);

  /* 造数据：卡组（含原图，落 IDB）+ 视频工程 + 1 条 char_ref（遮罩层空笔画） */
  const setup = await q(`(async function(){
    try {
      var jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
      var pngBig = 'data:image/png;base64,' + 'A'.repeat(300000);   /* 300KB 原图 × 2 */
      var cards = window.CC.normalize({ schema:'moyutai.charcards.v1', orig_char_descs:['origA'], dest_char_descs:['destB'],
        cards:[{ id:'c1', name:'GPT', tag:'', img:jpg, imgFull:pngBig },
               { id:'c2', name:'OTHER', tag:'', img:jpg, imgFull:pngBig }] });
      var g = window.CCG.importPack('EXP-' + Date.now(), cards);   /* saveData 会把原图剥进 IDB */
      var fulls = await window.CGFull.all(g.id);

      var L = window.__avLogic;
      var proj = 'p62';
      L.saveMeta({ name: proj, fps: 24, mode: 'video', folderName: 'clips', charGroupRef: g.id });
      var marks = { version: 1, marks: [] };
      L.upsertCharRef(marks, '001', 0, [{ cardId:'c1', name:'GPT', orig_char_desc:'origA', dest_char_desc:'destB', mask:null }]);
      L.saveMarks(proj, marks);
      /* 给这条 ref 种一个「有层但零笔画」的草稿（mask:null 时不会抽帧，走跳过分支） */
      var refId = marks.marks[marks.marks.length - 1].id;
      localStorage.setItem('av-' + proj + '-tagmask-' + refId, JSON.stringify({
        schema: 'moyutai.imgmask.v2', activeId: 'L1',
        layers: [{ id: 'L1', name: 'GPT', visible: true, strokes: [] }]
      }));
      return JSON.stringify({ gid: g.id, proj: proj, refId: refId, idbFulls: Object.keys(fulls).length });
    } catch (e) { return 'ERR ' + (e && (e.stack || e.message) || e); }
  })()`);
  console.log('setup:', setup);
  const S = setup && setup.startsWith('{') ? JSON.parse(setup) : null;
  check('卡组/工程/草稿 已写入', !!S, String(setup).slice(0, 200));
  if (S) check('原图已落 IndexedDB', S.idbFulls === 2, 'idbFulls=' + S.idbFulls);

  /* 打开工程并注入文件清单 */
  const opened = await q(`(async function(){
    try {
      await window.__av.open('p62');
      for (var i = 0; i < 50; i++) { await new Promise(function(r){ setTimeout(r, 100); }); if (document.querySelector('.av-top-btn.av-primary')) break; }
      var St = window.__av._S;
      St.files = [{ name:'001.mp4', label:'001', seq:1, size:0 }];
      return JSON.stringify({ hasBtn: !!document.querySelector('.av-top-btn.av-primary'), files: St.files.length, marks: St.marks.marks.length, groupRef: St.meta && St.meta.charGroupRef });
    } catch (e) { return 'ERR ' + (e && (e.stack || e.message) || e); }
  })()`);
  console.log('open:', opened);
  const O = opened && opened.startsWith('{') ? JSON.parse(opened) : null;
  check('AV 顶栏导出按钮存在', !!(O && O.hasBtn), String(opened).slice(0, 200));

  /* 点导出（真实入口） */
  const exported = await q(`(async function(){
    try {
      var btn = document.querySelector('.av-top-btn.av-primary');
      if (!btn) return 'NO BTN';
      window.__LOG.length = 0;
      btn.click();
      for (var i = 0; i < 120; i++) { await new Promise(function(r){ setTimeout(r, 100); }); if (window.__SHARED) break; }
      return JSON.stringify({ called: !!window.__SHARED, filename: window.__SHARED && window.__SHARED.filename,
        b64len: window.__SHARED ? window.__SHARED.data.length : 0, log: window.__LOG });
    } catch (e) { return 'ERR ' + (e && (e.stack || e.message) || e); }
  })()`);
  const E = exported && exported.startsWith('{') ? JSON.parse(exported) : null;
  if (!E) { check('导出链路可执行', false, String(exported).slice(0, 300)); }
  else {
    console.log('export: filename=' + E.filename + ' b64len=' + E.b64len + ' logLines=' + (E.log || []).length);
    (E.log || []).forEach(l => console.log('  LOG ' + l));
    check('导出走原生分享', E.called === true);
    const log = E.log || [];
    const has = s => log.some(l => l.includes(s));
    check('有 START 阶段日志', has('export: START'), log.filter(l => l.includes('START'))[0] || '');
    check('START 带内存快照', has('used='), log.filter(l => l.includes('used='))[0] || '');
    check('遮罩阶段 START/DONE', has('tagmask: START') && has('tagmask: DONE'));
    check('空笔画层被跳过并留痕', has('tagmask skip empty') || has('skip (no layer with strokes)'),
      log.filter(l => l.includes('skip')).slice(0, 2).join(' / '));
    check('卡组打包阶段有日志', has('char group pack start') && has('char group pack done'));
    check('zip 有体积日志', has('zip start') && has('zip done'), log.filter(l => l.includes('zip')).join(' / ').slice(0, 200));
    check('shareFile 前后都有日志', has('shareFile call') && has('shareFile ok'));
    check('文件名 .zip', /\.zip$/.test(E.filename || ''), E.filename);

    const zi = await q(`(function(){
      try {
        var bin = atob(window.__SHARED.data);
        var u8 = new Uint8Array(bin.length);
        for (var i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
        var un = window.fflate.unzipSync(u8);
        var keys = Object.keys(un);
        var ccU8 = un['charcards.json'];
        var cc = ccU8 ? JSON.parse(new TextDecoder().decode(ccU8)) : null;
        var cards = cc ? cc.cards : [];
        return JSON.stringify({ keys: keys, ccBytes: ccU8 ? ccU8.length : 0, cards: cards.length,
          inline: cards.filter(function(c){ return !!c.img || !!c.imgFull; }).length,
          refs: cards.filter(function(c){ return !!c.imgFile && !!c.imgFullFile; }).length,
          charsFull: keys.filter(function(k){ return k.indexOf('chars_full/')===0; }).length,
          masks: keys.filter(function(k){ return k.indexOf('masks/')===0; }).length,
          videos: document.getElementsByTagName('video').length,
          captureVideos: Array.prototype.slice.call(document.getElementsByTagName('video')).filter(function(v){ return /opacity:\s*0/.test(v.style.cssText) || v.style.width === '1px'; }).length,
          hasCfVideo: !!window.__avTest && !!window.__avTest.cfVideo() });
      } catch (e) { return 'ERR ' + e.message; }
    })()`);
    console.log('zip:', zi);
    const Z = zi && zi.startsWith('{') ? JSON.parse(zi) : null;
    if (!Z) check('ZIP 可解析', false, String(zi).slice(0, 200));
    else {
      check('ZIP 含 marks.json', Z.keys.includes('marks.json'));
      check('ZIP 含 charcards.json', Z.keys.includes('charcards.json'));
      check('ZIP 含 chars_full/ 原图二进制（只打被引用角色）', Z.charsFull === 1 && Z.charsFull === Z.cards, 'charsFull=' + Z.charsFull + '/' + Z.cards);
      check('charcards.json 不再内嵌 base64', Z.inline === 0, 'inline=' + Z.inline);
      check('charcards.json 保留路径引用', Z.refs === Z.cards, 'refs=' + Z.refs + '/' + Z.cards);
      check('charcards.json 体积小（无原图 base64）', Z.ccBytes < 2000, 'ccBytes=' + Z.ccBytes);
      check('空笔画层不产出遮罩 PNG', Z.masks === 0, 'masks=' + Z.masks);
      check('导出后抽帧解码器已释放', Z.captureVideos === 0, 'captureVideos=' + Z.captureVideos + ' totalVideos=' + Z.videos);
    }
  }
} catch (ex) { console.log('ERR', ex && (ex.stack || ex.message)); }
finally {
  try { ws && ws.close(); } catch { }
  try { srv.kill(); e.kill(); } catch { }
  if (fail) { console.log('--- exceptions ---'); logs.slice(-8).forEach(l => console.log(l.slice(0, 260))); }
  console.log('v62-dom: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
  process.exit(fail ? 1 : 0);
}
