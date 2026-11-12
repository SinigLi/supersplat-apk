/* openTagMode 里 buildTagBar() 在 try 里。DOM 冒烟里 openTagMode 返回 OK，
 * 但 okbar/tagbar 都查不到 → buildTagBar 可能在 S.tagBarBuilt 已 true 时被跳过？
 * 不对，首次调用。或者 build() 里 buildTagBar 之前抛错？不对——返回 OK 说明 try 没抛。
 * 等等：buildTagBar 里 L1693 `if (S.tagBarBuilt) return;` —— build() 会不会调用 buildTagBar？
 * 或者 openTagMode 的 buildTagBar() 被执行，但 page.appendChild(tagBarEl) 后有 CSS display:none ——
 * .img-tagbar{display:none} 需 .open 才显示，buildTagBar 确实 classList.add('open')。
 * 那 querySelector('.img-tag-okbar') 都查不到 = 元素根本不在 DOM。
 * 唯一可能：buildTagBar 抛错但被 openTagMode 的 catch 吞了（toast+console）。
 * 冒烟里加 hook：捕获 console + 直接再次调用后查 S.tagBarBuilt。
 */
'use strict';
import { spawn } from 'node:child_process';
const ROOT = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www';
const SRV = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/tools/dev/staticsrv.cjs';
const PORT = 4234, CDP = 9290;
const srv = spawn(process.execPath, [SRV, ROOT, String(PORT)], { stdio: 'ignore' });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const e = spawn(EDGE, [
  '--remote-debugging-port=' + CDP, '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + process.env.TEMP + '/edge_v60e3',
  '--window-size=800,360',
  'http://127.0.0.1:' + PORT + '/index.html',
], { stdio: 'ignore' });
let ws, id = 0; const pend = new Map();
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
  const logs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map(a => a.value !== undefined ? String(a.value) : a.description || '').join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text));
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  };
  await new Promise(r => setTimeout(r, 2200));

  const r = await q(`(function(){
    try {
      var cards = { schema:'moyutai.charcards.v1', orig_char_descs:[], dest_char_descs:[], cards:[
        { id:'c1', name:'GPT', tag:'', img:'' } ]};
      var fc = document.createElement('canvas'); fc.width = 640; fc.height = 360;
      var fx = fc.getContext('2d'); fx.fillStyle = '#888'; fx.fillRect(0,0,640,360);
      window.__img.openTagMode({ project:'smoke', seg:1, frame:0, at:0, kind:'split', existing:null, cards:cards, frameCanvas:fc, onDone:function(){}, onCancel:function(){} });
      return {
        okbar: !!document.querySelector('.img-tag-okbar'),
        tagbar: !!document.querySelector('.img-tagbar-bottom'),
        pageOpen: !!document.querySelector('#imgPage.open') || !!document.querySelector('.img-page.open'),
        anyOk: !!document.getElementById('imgTagCurLayerName')
      };
    } catch (e) { return { err: e.message }; }
  })()`);
  console.log('result:', JSON.stringify(r));
  console.log('console logs:');
  logs.filter(l => l.includes('tag') || l.includes('error') || l.includes('ERR') || l.includes('Exce')).slice(-12).forEach(l => console.log('  ' + l.slice(0, 220)));
} catch (ex) { console.log('ERR', ex.message); }
finally { try { ws && ws.close(); } catch { } try { srv.kill(); e.kill(); } catch { } }
