/* v61f-DOM：真机场景复现
 * 1) 已有卡组（原图在 IndexedDB，localStorage 里只剩头像）
 * 2) 导入一个「只写路径引用、没有内联图」的旧 JSON
 * 3) 断言：导入后的卡组重新导出时 chars_full 图片与 imgFull 都在
 */
'use strict';
import { spawn } from 'child_process';
const ROOT = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www';
const SRV = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/tools/dev/staticsrv.cjs';
const PORT = 4255, CDP = 9311;
const srv = spawn(process.execPath, [SRV, ROOT, String(PORT)], { stdio: 'ignore' });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const e = spawn(EDGE, ['--remote-debugging-port=' + CDP, '--headless=new', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + process.env.TEMP + '/edge_v61f', '--window-size=800,360', 'http://127.0.0.1:' + PORT + '/index.html'], { stdio: 'ignore' });
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
  const q = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return 'EXC ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text);
    return r.result && r.result.value;
  };
  await send('Runtime.enable');
  await new Promise(r => setTimeout(r, 2500));

  /* 清库，保证从干净状态开始 */
  await q('indexedDB.deleteDatabase("moyutai-cg-full"); localStorage.clear(); "cleared"');
  await new Promise(r => setTimeout(r, 500));

  const setup = await q(`(async function(){
    var jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
    var png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    var d = window.CC.normalize({ schema:'moyutai.charcards.v1', orig_char_descs:[], dest_char_descs:[],
      cards:[{ id:'c1', name:'GPT', tag:'', img:jpg, imgFull:png },
             { id:'c2', name:'小圆 日常', tag:'', img:jpg, imgFull:png }] });
    var r = window.CCG.importPack('源卡组', d);
    /* localStorage 里应当没有 imgFull，IDB 里应当有 */
    var g = window.CCG.get(r.id);
    var slimHasFull = (g.cards||[]).filter(function(c){return !!c.imgFull;}).length;
    var fulls = await window.CGFull.all(r.id);
    var idbCount = Object.keys(fulls).length;
    return JSON.stringify({ gid: r.id, slimHasFull: slimHasFull, idbCount: idbCount });
  })()`);
  console.log('setup:', setup);
  const S = JSON.parse(setup);
  check('源卡组已保存', !!S.gid, S.gid);
  check('localStorage 中确实无 imgFull（复现前提）', S.slimHasFull === 0, 'slimHasFull=' + S.slimHasFull);
  check('IndexedDB 中存有 2 张原图', S.idbCount === 2, 'idbCount=' + S.idbCount);

  /* 旧的只引用路径、无内联图的 JSON（就是 debug_27 那份的形态） */
  const imported = await q(`(async function(){
    var old = { schema:'moyutai.charcards.v2', descGroups:[{name:'原始',items:[]},{name:'目标',items:[]}],
      cards:[{ id:'x1', name:'GPT', tag:'', imgFile:'chars/GPT.jpg', imgFullFile:'chars_full/GPT.png' },
             { id:'x2', name:'小圆 日常', tag:'', imgFile:'chars/_ .jpg', imgFullFile:'chars_full/_.png' }] };
    var before = { gid: '${S.gid}' };
    await window.__cardgroupsTest.importForTest(old, {});
    var groups = window.CCG.list();
    var created = groups.filter(function(g){ return g.name.indexOf('导入卡组') === 0; })[0];
    if (!created) return JSON.stringify({ err:'no created group', names: groups.map(function(g){return g.name;}) });
    var data = window.CCG.get(created.id);
    var fulls = await window.CGFull.all(created.id);
    var merged = window.__cardgroupsTest.mergeFulls(data, fulls);
    var plan = window.CC.exportPlan(merged);
    var cardsAfter = data.cards.map(function(c){ return { name:c.name, hasImg: !!c.img }; });
    return JSON.stringify({
      gid: created.id,
      cardsAfter: cardsAfter,
      idbFulls: Object.keys(fulls).length,
      planInlineFull: plan.json.cards.filter(function(c){return !!c.imgFull;}).length,
      planImages: plan.images.map(function(i){ return i.file; })
    });
  })()`);
  console.log('import:', imported);
  if (String(imported).startsWith('EXC')) { check('导入流程可执行', false, imported); }
  else {
    const I = JSON.parse(imported);
    check('导入后新卡组建立', !!I.gid, I.gid);
    check('导入后头像已借用', I.cardsAfter.every(c => c.hasImg), JSON.stringify(I.cardsAfter));
    check('导入后原图写入 IndexedDB（v61f 关键修复）', I.idbFulls === 2, 'idbFulls=' + I.idbFulls);
    check('重新导出时 JSON 内嵌原图', I.planInlineFull === 2, 'inlineFull=' + I.planInlineFull);
    check('重新导出时带 chars_full 文件', I.planImages.filter(f => f.indexOf('chars_full/') === 0).length === 2, JSON.stringify(I.planImages));
  }
} catch (ex) { console.log('ERR', ex && (ex.stack || ex.message)); }
finally {
  try { ws && ws.close(); } catch { }
  try { srv.kill(); e.kill(); } catch { }
  console.log('v61f-dom: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
  process.exit(fail ? 1 : 0);
}
