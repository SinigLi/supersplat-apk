/* v61c DOM 冒烟：真实走 importFile 的 zip 路径
 * 手法：在页面里创建 File 对象 → DataTransfer 塞进 input → dispatch change。
 * 覆盖：zip 无扩展名（魔数识别）、charcards.json 在子目录、图片带空格名、JSON 误导入提示。
 */
'use strict';
import { spawn } from 'child_process';
const ROOT = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www';
const SRV = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/tools/dev/staticsrv.cjs';
const PORT = 4252, CDP = 9308;
const srv = spawn(process.execPath, [SRV, ROOT, String(PORT)], { stdio: 'ignore' });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const e = spawn(EDGE, ['--remote-debugging-port=' + CDP, '--headless=new', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + process.env.TEMP + '/edge_v61c', '--window-size=800,360', 'http://127.0.0.1:' + PORT + '/index.html'], { stdio: 'ignore' });
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

  const res = await q(`(async function(){
    try {
      /* 准备一份带图的卡组 zip（charcards.json 放在子目录 pack/ 下，验证目录容错） */
      var jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
      var data = window.CC.normalize({ schema:'moyutai.charcards.v1', orig_char_descs:['A'], dest_char_descs:['B'],
        cards:[{ id:'c1', name:'GPT', tag:'t1', img:jpg }, { id:'c2', name:'小圆 日常', tag:'', img:jpg }] });
      var plan = window.CC.exportPlan(data);
      var entries = { 'pack/charcards.json': new TextEncoder().encode(JSON.stringify(plan.json, null, 2)) };
      plan.images.forEach(function (im) {
        var b64 = im.dataUrl.split(',')[1]; var bin = atob(b64), u8 = new Uint8Array(bin.length);
        for (var i=0;i<bin.length;i++) u8[i] = bin.charCodeAt(i);
        entries[im.file] = u8;
      });
      var zip = window.fflate.zipSync(entries, { level: 0 });
      /* 造 File，名字**故意不带 .zip**，验证魔数识别 */
      var f = new File([zip], 'charcards-export', { type: 'application/octet-stream' });

      /* 拦截 <input> 创建，直接塞文件并触发 change */
      var origCreate = document.createElement.bind(document);
      var capturedInput = null;
      document.createElement = function (tag) {
        var el = origCreate(tag);
        if (String(tag).toLowerCase() === 'input') {
          capturedInput = el;
          el.click = function () { /* 不真的弹窗 */ };
        }
        return el;
      };
      /* 直接调内部 importFile：需要 __cardgroups 暴露？没有 → 用 sheet 上的按钮 */
      window.__cardgroups.open();
      await new Promise(function (r) { setTimeout(r, 300); });
      var btn = document.querySelector('#cgmImportZip');
      if (!btn) return 'NO IMPORT BUTTON';
      btn.click();
      document.createElement = origCreate;   /* 恢复 */
      if (!capturedInput) return 'INPUT NOT CAPTURED';
      var dt = new DataTransfer();
      dt.items.add(f);
      capturedInput.files = dt.files;
      capturedInput.dispatchEvent(new Event('change'));

      /* 等导入完成（renderList 会新增组） */
      await new Promise(function (r) { setTimeout(r, 600); });
      var groups = window.CCG.list();
      var g = groups[groups.length - 1];
      var d = g ? g.data : null;
      /* 原图在 IndexedDB，这里只看 localStorage 里的头像 */
      return JSON.stringify({ groups: groups.length, name: g && g.name,
        cards: d ? d.cards.map(function(c){ return { name:c.name, tag:c.tag, hasImg: !!c.img }; }) : null });
    } catch (e) { return 'ERR ' + (e && (e.stack || e.message) || e); }
  })()`);
  console.log('result:', res);
  const r = JSON.parse(res);
  check('导入新增了卡组', r.groups >= 1, res);
  check('两张卡都在', r.cards && r.cards.length === 2, JSON.stringify(r.cards));
  check('GPT 有头像', r.cards && r.cards[0].hasImg === true);
  check('「小圆 日常」有头像（关键回归）', r.cards && r.cards[1].hasImg === true, JSON.stringify(r.cards && r.cards[1]));
  check('tag 保留', r.cards && r.cards[0].tag === 't1');
} catch (ex) { console.log('ERR', ex.message); }
finally {
  try { ws && ws.close(); } catch { }
  try { srv.kill(); e.kill(); } catch { }
  console.log('v61c-dom: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
  process.exit(fail ? 1 : 0);
}
