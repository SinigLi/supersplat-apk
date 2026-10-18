/* probe-v20a.mjs — 机位功能实测（走真实 UI 入口）
 *
 * 1. 猫狗默认缩放是否为 0.225 / 0.19
 * 2. 打开「相机」分组 → 面板里有下拉 + 四个按钮
 * 3. 点「新增」两次（中间移动相机）→ shots 有两条，名字不重复
 * 4. 点「查看」第一台 → 相机回到记录时的位置
 * 5. 点「渲染」→ renderShot 返回 ok 且 png 有字节
 * 6. 点「移除」→ shots 少一条
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4250;
const CDP = 9310;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v20a-${Date.now()}`,
  `http://127.0.0.1:${PORT}/www/index.html`
], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  return r.result.value;
};

try {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      const t = list.find(x => x.type === 'page' && x.url.includes('/www/index.html'));
      if (t) { ws = new WebSocket(t.webSocketDebuggerUrl); break; }
    } catch {}
    await sleep(300);
  }
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
    }
  });
  await send('Runtime.enable');
  await sleep(2500);
  for (let i = 0; i < 100; i++) {
    if (await evalJs('document.body.classList.contains("sd-docks-ready")')) break;
    await sleep(400);
  }

  const out = await evalJs(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const d = window.__director;
    const res = {};

    // ---- 1. 猫狗缩放 ----
    res.charScales = (d.listCharacters() || []).map(c => ({ id: c.id, scale: c.scale }));

    // ---- 2. 打开相机分组 ----
    const grpBtns = Array.from(document.querySelectorAll('.sd-grp-btn'));
    const camBtn = grpBtns.find(b => (b.textContent || '').includes('相机'));
    res.camBtnFound = !!camBtn;
    if (!camBtn) return res;

    camBtn.click();
    await wait(900);

    const wrap = Array.from(document.querySelectorAll('.sd-sub-wrap.sd-open')).find(w => w.querySelector('.sd-shot-list'));
    res.panelOpened = !!wrap;
    if (!wrap) return res;

    res.buttons = Array.from(wrap.querySelectorAll('.sd-shot-btn')).map(b => b.dataset.shot);
    res.hasModeRow = !!wrap.querySelector('.sd-cam-modes');
    const list = wrap.querySelector('.sd-shot-list');

    // 面板初始：无机位
    res.initialOptions = Array.from(list.options).map(o => o.textContent);

    // ---- 3. 记录两个机位（中间移动相机）----
    const cam = scene.camera;
    const V = cam.position.constructor;
    cam.setFocalPoint(new V(0, 1, 0), 0);
    cam.setAzimElev(30, -20, 0);
    cam.setDistance(3, 0);
    scene.forceRender = true;
    await wait(1200);
    const poseA = { pos: cam.position.toArray().map(v => +v.toFixed(2)), fov: +cam.fov.toFixed(1) };

    wrap.querySelector('.sd-shot-btn[data-shot="add"]').click();
    await wait(700);

    cam.setFocalPoint(new V(2, 1.5, 1), 0);
    cam.setAzimElev(140, -10, 0);
    cam.setDistance(6, 0);
    scene.forceRender = true;
    await wait(1200);
    const poseB = { pos: cam.position.toArray().map(v => +v.toFixed(2)) };

    wrap.querySelector('.sd-shot-btn[data-shot="add"]').click();
    await wait(700);

    res.shotsAfterAdd = d.listShots().map(s => ({ id: s.id, name: s.name, pos: s.pos.map(v => +v.toFixed(2)) }));
    res.optionsAfterAdd = Array.from(list.options).map(o => ({ v: o.value, t: o.textContent }));
    res.poseA = poseA;
    res.poseB = poseB;

    // ---- 4. 查看第一台 ----
    const first = d.listShots()[0];
    list.value = String(first.id);
    wrap.querySelector('.sd-shot-btn[data-shot="goto"]').click();
    await wait(1600);
    res.afterGoto = {
      camPos: cam.position.toArray().map(v => +v.toFixed(2)),
      shotPos: first.pos.map(v => +v.toFixed(2)),
      dist: +Math.hypot(
        cam.position.x - first.pos[0],
        cam.position.y - first.pos[1],
        cam.position.z - first.pos[2]
      ).toFixed(3)
    };

    // ---- 5. 渲染照片 ----
    list.value = String(first.id);
    const r = await d.renderShot(first.id, 640, 360);
    res.render = r;

    // ---- 6. 移除 ----
    const second = d.listShots()[1] || d.listShots()[0];
    list.value = String(second.id);
    wrap.querySelector('.sd-shot-btn[data-shot="remove"]').click();
    await wait(700);
    res.shotsAfterRemove = d.listShots().map(s => s.name);

    return res;
  })()`);
  console.log(JSON.stringify(out, null, 1));
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 500);
}
