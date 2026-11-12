/* okbar y=-20：说明有东西把它向上顶了 —— inline top:10px 被 buildTagBar 写了
 * 但 v60c-safe CSS 是 top:calc(env(safe-area-inset-top)+10px)；inline style.top='10px'（JS 213 行处）
 * 在 headless 中 env=0 → 10px。可 y=-20 意味着 top 不是 10。
 * 看 okbar HTML 实际 inline style 和 offsetParent。
 */
'use strict';
import { spawn } from 'node:child_process';
const ROOT = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www';
const SRV = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/tools/dev/staticsrv.cjs';
const PORT = 4236, CDP = 9292;
const srv = spawn(process.execPath, [SRV, ROOT, String(PORT)], { stdio: 'ignore' });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const e = spawn(EDGE, [
  '--remote-debugging-port=' + CDP, '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + process.env.TEMP + '/edge_v60e5',
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
  await new Promise(r => setTimeout(r, 2200));
  await q(`(function(){
    var cards = { schema:'moyutai.charcards.v1', orig_char_descs:[], dest_char_descs:[], cards:[{ id:'c1', name:'GPT', tag:'', img:'' }]};
    var fc = document.createElement('canvas'); fc.width=640; fc.height=360;
    window.__img.openTagMode({ project:'smoke', seg:1, frame:0, at:0, kind:'split', existing:null, cards:cards, frameCanvas:fc, onDone:function(){}, onCancel:function(){} });
  })()`);
  await new Promise(r => setTimeout(r, 400));
  const info = await q(`(function(){
    var b = document.querySelector('.img-tag-okbar');
    if (!b) return 'NO OKBAR';
    var r = b.getBoundingClientRect();
    var cs = getComputedStyle(b);
    /* 谁把它移出屏幕：有没有父级 transform */
    var anc = [], n = b.parentElement;
    while (n && n !== document.body) { var c2 = getComputedStyle(n); if (c2.transform !== 'none' || c2.willChange.includes('transform')) anc.push(n.className || n.tagName); n = n.parentElement; }
    /* visual viewport offset */
    return {
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      inline: b.getAttribute('style'),
      csTop: cs.top, csLeft: cs.left, csPos: cs.position, csTransform: cs.transform,
      innerH: window.innerHeight, visualOffsetY: window.visualViewport ? Math.round(window.visualViewport.offsetTop) : 0,
      visualScale: window.visualViewport ? window.visualViewport.scale : 1,
      pageZoom: document.documentElement.style.zoom || '(none)',
      ancestorsWithTransform: anc,
      bodyScrollY: Math.round(window.scrollY), docClientH: document.documentElement.clientHeight
    };
  })()`);
  console.log(JSON.stringify(info, null, 1));
} catch (ex) { console.log('ERR', ex.message); }
finally { try { ws && ws.close(); } catch { } try { srv.kill(); e.kill(); } catch { } }
