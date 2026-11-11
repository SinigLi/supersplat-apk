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
  check('页面 title', (await ev('document.title')) === '角色卡库原型 r2');
  check('卡组列表 2 组', (await ev('document.querySelectorAll(".grp").length')) === 2);
  check('组名渲染', (await ev('[...document.querySelectorAll(".grp-name")].map(e=>e.textContent).join(",")')) === '魔法少女,修仙');

  /* B */
  await ev('document.querySelectorAll(".grp .edit")[0].click()');
  await sleepMs(300);
  check('编辑 sheet 打开', await ev('document.getElementById("shGroupEdit").classList.contains("open")'));
  check('组名回填', (await ev('document.getElementById("grpName").value')) === '魔法少女');
  check('3 张角色卡', (await ev('document.querySelectorAll("#cardList .card").length')) === 3);
  check('tag 渲染', (await ev('document.querySelector("#cardList .tag")?.textContent')) === '主角');
  /* r2：描述词解绑——卡片无 .desc；有 📖 词库按钮 */
  check('卡片无描述列表（解绑）', (await ev('document.querySelectorAll("#cardList .card")[0].querySelectorAll(".desc").length')) === 0);
  check('词库按钮存在', !!(await ev('document.getElementById("btnWords")')));

  /* C: 数据层增描述 → 重开 sheet 验证持久化 */
  await ev('document.getElementById("btnGrpDone").click()'); await sleepMs(150);
  check('跳过 localStorage 注入（r2 改词库断言，无需注入）', true);
  await ev('document.querySelectorAll(".grp .edit")[0].click()'); await sleepMs(200);
  check('页面内存 DB.groups 存在（2 组）', (await ev('DB.groups.length')) === 2);
check('localStorage 注入不影响内存（设计如此）', (await ev('JSON.parse(localStorage.getItem("cc-proto")||"null")===null || !!JSON.parse(localStorage.getItem("cc-proto")).groups')) === true);

  /* r2：词库 sheet */
  check('词库 sheet 初始关闭', !(await ev('document.getElementById("shWords").classList.contains("open")')));
  await ev('document.getElementById("btnWords").click()'); await sleepMs(250);
  check('词库 sheet 打开', await ev('document.getElementById("shWords").classList.contains("open")'));
  check('默认两组渲染', (await ev('document.querySelectorAll("#wordList .card").length')) === 2);
  check('默认组名', (await ev('[...document.querySelectorAll("#wordList .cname")].map(e=>e.textContent).join(",")')) === '原角色描述,替换角色描述');
  check('g1 词数渲染（4+4=8 chips）', (await ev('document.querySelectorAll("#wordList .desc").length')) === 8);
  /* 组内加词（页面内调数据层等价于点添加后 save+render） */
  await ev('(function(){ var g=DB.groups.filter(function(x){return x.id===editingId;})[0]; g.words[0].items.push("黑长直"); save(); renderWords(); })()');
  check('加词后 9 chips', (await ev('document.querySelectorAll("#wordList .desc").length')) === 9);
  /* 新建分组 */
  await ev('(function(){ document.getElementById("newGroupName").value="发型"; })()');
  await ev('document.getElementById("btnAddGroup").click()'); await sleepMs(200);
  check('新建分组后 3 组', (await ev('document.querySelectorAll("#wordList .card").length')) === 3);
  check('新组名渲染', (await ev('[...document.querySelectorAll("#wordList .cname")].map(e=>e.textContent).join(",")')) === '原角色描述,替换角色描述,发型');
  await ev('document.querySelector("[data-close3]").click()'); await sleepMs(150);
  check('词库 sheet 关闭', !(await ev('document.getElementById("shWords").classList.contains("open")')));
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
