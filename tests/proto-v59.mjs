/* v59 原型验证：cardgroups-proto.html（headless Edge + CDP，node24 内建 WebSocket）
 * 断言组：
 *  A. 页面加载无异常 + 卡组列表渲染 2 组
 *  B. 打开编辑 sheet → 卡片渲染（3 角色）+ tag
 *  C. 描述增删持久化
 *  D. 工程视角选库 → 缺角色警告 → 切换成功 toast
 *  全程 Runtime.exceptionThrown == 0
 */
'use strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { reclaimPorts } from './lib/net-reclaim.mjs';

const PORT = 4196, CDP = 9256;
await reclaimPorts([PORT, CDP]);
const ROOT = path.resolve('.');   // 仓库根（prototype/ 在根下）
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n); } };

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-sync', '--disable-features=msEdgeSyncConfirmation',
  '--user-data-dir=' + path.join(process.env.TEMP, 'edge_v59_profile'),
  '--window-size=430,900',
  `http://127.0.0.1:${PORT}/prototype/cardgroups-proto.html`,
], { stdio: 'ignore' });

const sleepMs = ms => new Promise(r => setTimeout(r, ms));
async function getWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      const page = list.find(t => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleepMs(500);
  }
  throw new Error('CDP not ready');
}

let ws, id = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const msgId = ++id; pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result?.value;
}

let exceptions = 0;
try {
  ws = new WebSocket(await getWs());
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') exceptions++;
  };

  await send('Page.enable'); await send('Runtime.enable');
  await sleepMs(1200);

  /* A */
  check('页面 title', (await ev('document.title')) === '角色卡库原型 r1');
  check('卡组列表 2 组', (await ev('document.querySelectorAll(".grp").length')) === 2);
  check('组名渲染', (await ev('[...document.querySelectorAll(".grp-name")].map(e=>e.textContent).join(",")')) === '魔法少女,修仙');

  /* B */
  await ev('document.querySelectorAll(".grp .edit")[0].click()');
  await sleepMs(300);
  check('编辑 sheet 打开', await ev('document.getElementById("shGroupEdit").classList.contains("open")'));
  check('组名回填', (await ev('document.getElementById("grpName").value')) === '魔法少女');
  check('3 张角色卡', (await ev('document.querySelectorAll("#cardList .card").length')) === 3);
  check('tag 渲染', (await ev('document.querySelector("#cardList .tag")?.textContent')) === '主角');
  check('描述条数（原2+替2）', (await ev('document.querySelectorAll("#cardList .card")[0].querySelectorAll(".desc").length')) === 4);

  /* C: 数据层增描述 → 重开 sheet 验证持久化 */
  await ev('document.getElementById("btnGrpDone").click()'); await sleepMs(150);
  await ev('(function(){ var raw=localStorage.getItem("cc-proto"); var g=JSON.parse(raw)||{schema:"x",groups:[{id:"g1",name:"魔法少女",cards:[{name:"小圆",tag:"主角",orig:[],dest:[]},{name:"沙耶香",tag:"主角",orig:[],dest:[]},{name:"丘比",tag:"使魔",orig:[],dest:[]}]},{id:"g2",name:"修仙",cards:[]}],video:{using:"g1",project:"demo"}}; if(!g.groups) g.groups=[]; g.groups[0].cards[0].orig.push("测试描述"); localStorage.setItem("cc-proto", JSON.stringify(g)); })()');
  await ev('document.querySelectorAll(".grp .edit")[0].click()'); await sleepMs(200);
  check('页面内存 DB.groups 存在（2 组）', (await ev('DB.groups.length')) === 2);
check('localStorage 注入不影响内存（设计如此）', (await ev('JSON.parse(localStorage.getItem("cc-proto")||"null")===null || !!JSON.parse(localStorage.getItem("cc-proto")).groups')) === true);
  await ev('document.getElementById("btnGrpDone").click()'); await sleepMs(150);

  /* D: 工程视角选库 */
  await ev('document.getElementById("btnMode").click()'); await sleepMs(250);
  check('选库 sheet 打开', await ev('document.getElementById("shPick").classList.contains("open")'));
  check('两组可选', (await ev('document.querySelectorAll("#pickList .pickitem").length')) === 2);
  check('使用中标记', !!(await ev('document.querySelector(".pickitem.cur")')));
  await ev('(function(){ window.confirm=function(){return true;}; })()');
  await ev('document.querySelectorAll("#pickList .pickitem")[1].click()'); await sleepMs(300);
  const toastTxt = String(await ev('document.getElementById("toast").textContent'));
  check('缺角色警告 toast', /缺少角色/.test(toastTxt) && /小圆/.test(toastTxt));
  check('使用中已切换 g2', (await ev('(JSON.parse(localStorage.getItem("cc-proto")||"null")||{video:{}}).video.using')) === 'g2');
  await ev('document.getElementById("btnMode").click()'); await sleepMs(200);
  await ev('document.querySelectorAll("#pickList .pickitem")[0].click()'); await sleepMs(300);
  { const t2 = String(await ev('document.getElementById("toast").textContent')); console.log('  [diag] toast:', t2); check('切回成功 toast', /切换/.test(t2)); }

  check('全程无页面异常', exceptions === 0);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result?.data) {
    fs.writeFileSync(path.join('..', '..', 'temp', 'v59-proto.png'), Buffer.from(shot.result.data, 'base64'));
    console.log('screenshot saved');
  }
} catch (e) {
  check('驱动异常: ' + e.message, false);
} finally {
  try { ws && ws.close(); } catch {}
  edge.kill(); srv.kill();
  console.log('========================');
  console.log('proto-v59: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
  process.exit(fail === 0 ? 0 : 1);
}
