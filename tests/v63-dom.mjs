/* v63-DOM：视频导出超限自动分卷（把阈值调小以便 headless 里触发）
 * 断言：
 *  1) 导出体积超过 limit 时切成多卷，卷名 <原名>.001/.002
 *  2) 走 sharePaths 一次多选分享（不逐卷弹面板）
 *  3) 每卷内容拼起来 == 原 zip 字节（解压可还原）
 *  4) 小于阈值时仍走单次 shareFile
 */
'use strict';
import { spawn } from 'child_process';
const ROOT = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www';
const SRV = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/tools/dev/staticsrv.cjs';
const PORT = 4257, CDP = 9313;
const srv = spawn(process.execPath, [SRV, ROOT, String(PORT)], { stdio: 'ignore' });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const e = spawn(EDGE, [
  '--remote-debugging-port=' + CDP, '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + process.env.TEMP + '/edge_v63',
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

  const stub = await q(`(function(){
    window.__LOG = []; window.__SHARED = null; window.__PATHS = null; window.__WRITES = [];
    window.Capacitor = window.Capacitor || {}; window.Capacitor.Plugins = window.Capacitor.Plugins || {};
    window.Capacitor.Plugins.DebugLog = { append: function(o){ window.__LOG.push(o.text); return Promise.resolve({ok:true}); } };
    window.Capacitor.Plugins.SaveImage = {
      shareFile: function(o){ window.__SHARED = { filename:o.filename, data:o.data, mime:o.mime }; return Promise.resolve({ok:true}); },
      sharePaths: function(o){ window.__PATHS = { names:o.names.slice(), mime:o.mime }; return Promise.resolve({ok:true, count:o.names.length}); }
    };
    window.Capacitor.Plugins.Filesystem = {
      writeFile: function(o){ window.__WRITES.push({ path:o.path, data:o.data }); return Promise.resolve({}); },
      appendFile: function(o){ window.__WRITES.push({ path:o.path, data:o.data, append:true }); return Promise.resolve({}); }
    };
    window.__written = {};
    /* 把写盘收到的 base64 按文件名累积，便于后面拼回原字节 */
    var wr = window.Capacitor.Plugins.Filesystem;
    var _wf = wr.writeFile, _ap = wr.appendFile;
    wr.writeFile = function(o){ window.__written[o.path] = o.data || ''; return _wf(o); };
    wr.appendFile = function(o){ window.__written[o.path] = (window.__written[o.path] || '') + (o.data || ''); return _ap(o); };
    return 'stubs ready';
  })()`);
  check('桩安装', stub === 'stubs ready', stub);

  /* 阈值调小：limit 1MB / 卷 600KB，这样 40MB 场景在 headless 里也能触发 */
  const lim = await q(`(function(){ window.ShareOut._setLimits(1*1024*1024, 600*1024); return window.ShareOut.limit() + '/' + window.ShareOut.volumeSize(); })()`);
  check('阈值已调小（测试用）', lim === String(1048576) + '/' + String(614400), lim);

  /* 直接测 ShareOut：造 2.5MB 假数据应切 5 卷 */
  const split = await q(`(async function(){
    try {
      var n = 2.5 * 1024 * 1024;
      var u8 = new Uint8Array(n);
      for (var i = 0; i < n; i++) u8[i] = i % 251;
      var r = await window.ShareOut.send({ bytes: u8, filename: 'big.zip', mime: 'application/zip' });
      var names = window.__PATHS ? window.__PATHS.names : [];
      /* 把写盘的 base64 拼回字节，校验总长与内容一致 */
      var joined = '';
      names.forEach(function(nm){ joined += (window.__written['shared/' + nm] || ''); });
      var bin = atob(joined);
      var ok = bin.length === n;
      if (ok) { for (var k = 0; k < n; k += 997) { if (bin.charCodeAt(k) !== (k % 251)) { ok = false; break; } } }
      return JSON.stringify({ volumes: r.volumes, mode: r.mode, names: names, joinedLen: bin.length, sameAsInput: ok });
    } catch (e) { return 'ERR ' + (e && (e.stack || e.message) || e); }
  })()`);
  console.log('split:', split);
  const S = split && split.startsWith('{') ? JSON.parse(split) : null;
  if (!S) check('超限分卷链路可执行', false, String(split).slice(0, 300));
  else {
    check('2.5MB 切成 5 卷', S.volumes === 5, JSON.stringify(S));
    check('走多选分享（一次带走全部卷）', S.mode === 'split' && !!S.names.length, S.mode);
    check('卷名 .001 … .005', S.names[0] === 'big.zip.001' && S.names[4] === 'big.zip.005', S.names.join(','));
    check('各卷拼回后字节数一致', S.joinedLen === Math.round(2.5 * 1024 * 1024), 'joinedLen=' + S.joinedLen);
    check('各卷拼回后内容一致（可还原）', S.sameAsInput === true);
  }

  /* 小文件仍走单次 shareFile */
  const single = await q(`(async function(){
    try {
      window.__SHARED = null; window.__PATHS = null;
      var u8 = new Uint8Array(300 * 1024);
      var r = await window.ShareOut.send({ bytes: u8, filename: 'small.zip', mime: 'application/zip' });
      return JSON.stringify({ volumes: r.volumes, mode: r.mode, shared: window.__SHARED && window.__SHARED.filename, paths: !!window.__PATHS });
    } catch (e) { return 'ERR ' + (e && e.message || e); }
  })()`);
  console.log('single:', single);
  const Si = single && single.startsWith('{') ? JSON.parse(single) : null;
  if (!Si) check('小文件链路可执行', false, String(single).slice(0, 200));
  else {
    check('300KB 不分卷', Si.volumes === 1 && Si.mode === 'single', JSON.stringify(Si));
    check('300KB 走 shareFile', Si.shared === 'small.zip' && Si.paths === false);
  }

  /* 真实导出按钮链路（用默认阈值，zip 小 → 单文件） */
  const setup = await q(`(async function(){
    try {
      var jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
      var cards = window.CC.normalize({ schema:'moyutai.charcards.v1', orig_char_descs:['o'], dest_char_descs:['d'],
        cards:[{ id:'c1', name:'GPT', tag:'', img:jpg }] });
      var g = window.CCG.importPack('V63-' + Date.now(), cards);
      var L = window.__avLogic;
      var proj = 'p63';
      L.saveMeta({ name: proj, fps: 24, mode: 'video', folderName: 'clips', charGroupRef: g.id });
      var marks = { version: 1, marks: [] };
      L.upsertCharRef(marks, '001', 0, [{ cardId:'c1', name:'GPT', orig_char_desc:'o', dest_char_desc:'d', mask:null }]);
      L.saveMarks(proj, marks);
      await window.__av.open(proj);
      for (var i = 0; i < 50; i++) { await new Promise(function(r){ setTimeout(r, 100); }); if (document.querySelector('.av-top-btn.av-primary')) break; }
      window.__av._S.files = [{ name:'001.mp4', label:'001', seq:1, size:0 }];
      return JSON.stringify({ hasBtn: !!document.querySelector('.av-top-btn.av-primary'), groupRef: window.__av._S.meta.charGroupRef });
    } catch (e) { return 'ERR ' + (e && (e.stack || e.message) || e); }
  })()`);
  console.log('setup:', setup);
  const O = setup && setup.startsWith('{') ? JSON.parse(setup) : null;
  check('视频工程就绪', !!(O && O.hasBtn), String(setup).slice(0, 200));

  const exported = await q(`(async function(){
    try {
      window.__SHARED = null; window.__PATHS = null; window.__LOG.length = 0;
      var btn = document.querySelector('.av-top-btn.av-primary');
      btn.click();
      for (var i = 0; i < 120; i++) { await new Promise(function(r){ setTimeout(r, 100); }); if (window.__SHARED || window.__PATHS) break; }
      return JSON.stringify({ shared: window.__SHARED && window.__SHARED.filename,
        paths: window.__PATHS && window.__PATHS.names, log: window.__LOG });
    } catch (e) { return 'ERR ' + (e && e.stack || e.message); }
  })()`);
  const E = exported && exported.startsWith('{') ? JSON.parse(exported) : null;
  if (!E) check('导出链路可执行', false, String(exported).slice(0, 300));
  else {
    check('导出成功走 ShareOut', !!(E.shared || E.paths), JSON.stringify({ shared: E.shared, paths: E.paths }));
    const lg = E.log || [];
    check('日志记录阈值判定', lg.some(l => l.includes('threshold=')), lg.filter(l => l.includes('threshold='))[0] || '');
    check('shareout 模块有日志', lg.some(l => l.includes('[share]')), lg.filter(l => l.startsWith('[share]')).slice(0, 2).join(' / '));
  }
} catch (ex) { console.log('ERR', ex && (ex.stack || ex.message)); }
finally {
  try { ws && ws.close(); } catch { }
  try { srv.kill(); e.kill(); } catch { }
  if (fail) { console.log('--- exceptions ---'); logs.slice(-8).forEach(l => console.log(l.slice(0, 240))); }
  console.log('v63-dom: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
  process.exit(fail ? 1 : 0);
}
