/* v61a DOM 冒烟（重写）：真实打开视频工程 → 点「导出」→ 捕获 shareFile 的 ZIP → 校验含 charcards.json + chars/*
 */
'use strict';
import { spawn } from 'node:child_process';
const ROOT = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www';
const SRV = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/tools/dev/staticsrv.cjs';
const PORT = 4247, CDP = 9303;
const srv = spawn(process.execPath, [SRV, ROOT, String(PORT)], { stdio: 'ignore' });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const e = spawn(EDGE, [
  '--remote-debugging-port=' + CDP, '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + process.env.TEMP + '/edge_v61a3',
  '--window-size=800,360',
  'http://127.0.0.1:' + PORT + '/index.html',
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
    if (m.method === 'Runtime.consoleAPICalled') logs.push('LOG ' + m.params.args.map(a => a.value !== undefined ? String(a.value) : (a.description || '')).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + ((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text));
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  };
  const send = (me, pa = {}) => new Promise(res => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method: me, params: pa })); });
  const q = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
  await send('Runtime.enable');
  await new Promise(r => setTimeout(r, 2200));

  /* stub 分享（必须在任何插件查找之前） */
  await q(`(function(){ window.Capacitor = window.Capacitor || {}; window.Capacitor.Plugins = window.Capacitor.Plugins || {}; window.__cap = { called:false }; window.Capacitor.Plugins.SaveImage = { shareFile: function(o){ window.__cap.called = true; window.__cap.filename = o.filename; window.__cap.data = o.data; return Promise.resolve(); } }; return 'stub'; })()`);

  /* 造卡组 + 工程 meta + marks，然后 open */
  const setup = await q(`(async function(){
    try {
      var img = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
      var cards = window.CC.normalize({ schema:'moyutai.charcards.v1', orig_char_descs:['origA'], dest_char_descs:['destB'],
        cards:[{ id:'c1', name:'GPT', tag:'', img:img }, { id:'c2', name:'OTHER', tag:'', img:img }] });
      var g = window.CCG.create('TG');
      window.CCG.saveData(g.id, cards);

      var L = window.__avLogic;
      var proj = 'p61a';
      var meta = { name: proj, fps: 25, mode: 'video', folderName: 'clip', charGroupRef: g.id };
      L.saveMeta(meta);
      var marks = { version: 1, marks: [] };
      L.upsertCharRef(marks, '001', 0, [{ cardId:'c1', name:'GPT', orig_char_desc:'origA', dest_char_desc:'destB', mask:null }]);
      L.saveMarks(proj, marks);
      return JSON.stringify({ gid: g.id, proj: proj });
    } catch (e) { return 'ERR ' + e.message; }
  })()`);
  console.log('setup:', setup);
  check('卡组与工程已写入', setup && setup.indexOf('ERR') !== 0, setup);

  /* 打开工程（会读 meta、build 顶栏） */
  const opened = await q(`(async function(){
    try {
      var btn = null;
      await window.__av.open('p61a');
      for (var i = 0; i < 50; i++) {
        await new Promise(function(r){ setTimeout(r, 100); });
        btn = document.querySelector('.av-top-btn.av-primary');
        if (btn) break;
      }
      var S = window.__av._S;
      return JSON.stringify({ hasBtn: !!btn, files: S.files.length, marks: S.marks ? S.marks.marks.length : -1, groupRef: S.meta && S.meta.charGroupRef });
    } catch (e) { return 'ERR ' + (e && (e.stack || e.message) || e); }
  })()`);
  console.log('open:', opened);
  /* 注入文件清单（headless 下没有真实 clips 文件夹） */
  const injected = await q(`(function(){
    var S = window.__av._S;
    S.files = [{ name:'001.mp4', label:'001', seq:1, size:0 }];
    return JSON.stringify({ files: S.files.length, marks: S.marks.marks.length });
  })()`);
  console.log('injected:', injected);
  const op = JSON.parse(opened);
  check('AV 顶栏导出按钮存在', op.hasBtn === true, opened);

  /* 点导出 */
  const exported = await q(`(async function(){
    try {
      var btn = document.querySelector('.av-top-btn.av-primary');
      if (!btn) return 'NO BTN';
      btn.click();
      for (var i = 0; i < 80; i++) {
        await new Promise(function(r){ setTimeout(r, 100); });
        if (window.__cap.called) break;
      }
      return JSON.stringify({ called: window.__cap.called, filename: window.__cap.filename, len: (window.__cap.data||'').length });
    } catch (e) { return 'ERR ' + e.message; }
  })()`);
  console.log('export:', exported);
  check('导出走原生分享', exported && exported.indexOf('"called":true') >= 0, exported);

  if (exported && exported.indexOf('"called":true') >= 0) {
    const ex = JSON.parse(exported);
    check('文件名 .zip', /\.zip$/.test(ex.filename || ''), ex.filename);
    const unzip = await q(`(function(){
      try {
        var bin = atob(window.__cap.data);
        var u8 = new Uint8Array(bin.length);
        for (var i=0;i<bin.length;i++) u8[i] = bin.charCodeAt(i);
        var out = window.fflate.unzipSync(u8);
        var keys = Object.keys(out);
        var cc = out['charcards.json'] ? JSON.parse(new TextDecoder().decode(out['charcards.json'])) : null;
        return JSON.stringify({ keys: keys, names: cc ? cc.cards.map(function(c){return c.name;}) : null,
          charsFiles: keys.filter(function(k){return k.indexOf('chars/')===0;}),
          marksHasGPT: out['marks.json'] ? (new TextDecoder().decode(out['marks.json']).indexOf('GPT') >= 0) : false });
      } catch (e) { return 'ERR ' + e.message; }
    })()`);
    console.log('zip:', unzip);
    const uz = JSON.parse(unzip);
    check('ZIP 含 charcards.json', uz.keys.indexOf('charcards.json') >= 0, JSON.stringify(uz.keys));
    check('ZIP 含 chars/ 头像', uz.charsFiles.length >= 1, JSON.stringify(uz.charsFiles));
    check('只打被引用角色', uz.names && uz.names.length === 1 && uz.names[0] === 'GPT', JSON.stringify(uz.names));
    check('ZIP 含 marks.json 且带角色名', uz.marksHasGPT === true);
  }
} catch (ex) { console.log('ERR', ex.message); }
finally {
  try { ws && ws.close(); } catch { }
  try { srv.kill(); e.kill(); } catch { }
  if (fail) { console.log('--- last logs ---'); logs.slice(-10).forEach(l => console.log(l.slice(0, 260))); }
  console.log('v61a-dom: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
  process.exit(fail ? 1 : 0);
}
