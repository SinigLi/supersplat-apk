/* 删除按钮点击没生效（removed=0）—— .img-layer-rm 选择器可能不对，或行在弹层面板里
 * renderLayersPanel 输出到哪个容器？查 layersPanel 定义 + rm 行的真实容器。
 */
'use strict';
import { spawn } from 'node:child_process';
const ROOT = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www';
const SRV = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/tools/dev/staticsrv.cjs';
const PORT = 4239, CDP = 9295;
const srv = spawn(process.execPath, [SRV, ROOT, String(PORT)], { stdio: 'ignore' });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const e = spawn(EDGE, [
  '--remote-debugging-port=' + CDP, '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + process.env.TEMP + '/edge_v60f3',
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
  await q(`window.confirm = function(){ return true; }; window.prompt = function(){ return null; }; 'ok'`);
  await new Promise(r => setTimeout(r, 1800));
  await q(`(function(){
    var cards = { schema:'moyutai.charcards.v1', orig_char_descs:[], dest_char_descs:[], cards:[{ id:'c1', name:'GPT', tag:'', img:'' }]};
    var fc = document.createElement('canvas'); fc.width = 640; fc.height = 360;
    window.__img.openTagMode({ project:'s', seg:1, frame:0, at:0, kind:'split', existing:null, cards:cards, frameCanvas:fc, onDone:function(){}, onCancel:function(){} });
  })()`);
  await new Promise(r => setTimeout(r, 300));
  await q(`[...document.querySelectorAll('.img-tagbar-bottom .img-grp')].find(g=>g.textContent.includes('角色')).click()`);
  await new Promise(r => setTimeout(r, 200));
  await q(`[...document.querySelectorAll('.img-cardpicker-row')][0].click()`);
  await new Promise(r => setTimeout(r, 300));
  const info = await q(`(function(){
    var rms = [...document.querySelectorAll('.img-layer-rm')];
    var rows = [...document.querySelectorAll('.img-layer-name')];
    return {
      rmCount: rms.length,
      rmVisible: rms.map(r => { var b = r.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y) }; }),
      panelHtml: (document.querySelector('.img-layers') || document.querySelector('[class*=layer]') || {}).outerHTML?.slice(0, 500)
    };
  })()`);
  console.log(JSON.stringify(info, null, 1));
} catch (ex) { console.log('ERR', ex.message); }
finally { try { ws && ws.close(); } catch { } try { srv.kill(); e.kill(); } catch { } }
