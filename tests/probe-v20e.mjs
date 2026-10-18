/* probe-v20e.mjs — 端到端验收（走真实 UI 点击）
 *
 * 1. 猫狗默认缩放 0.225 / 0.19（从实体读，不信任 listCharacters 字段）
 * 2. 相机分组 → 机位面板：下拉 + 新增/移除/查看/渲染 + 模式行
 * 3. 新增两个机位 → 查看第一个（相机落点误差 ≈ 0）
 * 4. 点「渲染」→ 出现预览层，img.src 是 data:image/png，且像素确实有内容
 * 5. 关闭预览层 → 移除机位
 * 6. 面板可反复开关（v19 回归）
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4254;
const CDP = 9314;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
    '--use-angle=d3d11', '--window-size=390,844',
    `--user-data-dir=${process.env.TEMP}/edge-v20e-${Date.now()}`,
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
    const V = scene.camera.position.constructor;
    const res = {};

    // ---- 1. 摆狗和猫，读真实缩放 ----
    for (const cid of ['shiba', 'tuxedo']) {
      d.switchCharacter(cid);
      for (let i = 0; i < 120; i++) { if (d.addPuppet() === 'ok') break; await wait(300); }
      await wait(1000);
    }
    res.scales = d.puppets.map(p => ({ charId: p.charId, scale: +p.entity.getLocalScale().x.toFixed(4) }));

    // ---- 2. 打开相机分组 ----
    const camGrp = Array.from(document.querySelectorAll('.sd-grp-btn'))
      .find(b => (b.textContent || '').includes('相机'));
    if (!camGrp) { res.error = 'no camera group'; return res; }
    camGrp.click();
    await wait(900);

    const wrap = Array.from(document.querySelectorAll('.sd-sub-wrap.sd-open'))
      .find(w => w.querySelector('.sd-shot-list'));
    if (!wrap) { res.error = 'no shot panel'; return res; }
    res.buttons = Array.from(wrap.querySelectorAll('.sd-shot-btn')).map(b => b.dataset.shot);
    res.hasModeRow = !!wrap.querySelector('.sd-cam-modes');
    res.modeButtons = Array.from(wrap.querySelectorAll('.sd-cam-modes .sd-adopted')).map(b => b.id);

    const list = wrap.querySelector('.sd-shot-list');

    // ---- 3. 两个机位 ----
    scene.camera.setPose(new V(0, 1.1, -3.0), new V(0, 0.55, 0), 0);
    scene.forceRender = true;
    await wait(1300);
    wrap.querySelector('.sd-shot-btn[data-shot="add"]').click();
    await wait(600);

    scene.camera.setPose(new V(2.6, 1.6, -2.2), new V(0, 0.5, 0), 0);
    scene.forceRender = true;
    await wait(1300);
    wrap.querySelector('.sd-shot-btn[data-shot="add"]').click();
    await wait(600);

    res.shots = d.listShots().map(s => ({ id: s.id, name: s.name, pos: s.pos.map(v => +v.toFixed(2)) }));

    // 查看第一个
    const first = d.listShots()[0];
    list.value = String(first.id);
    wrap.querySelector('.sd-shot-btn[data-shot="goto"]').click();
    await wait(1600);
    res.gotoError = +Math.hypot(
      scene.camera.position.x - first.pos[0],
      scene.camera.position.y - first.pos[1],
      scene.camera.position.z - first.pos[2]
    ).toFixed(4);

    // ---- 4. 渲染 → 预览层 ----
    list.value = String(first.id);
    wrap.querySelector('.sd-shot-btn[data-shot="render"]').click();

    let layer = null;
    for (let i = 0; i < 60; i++) {
      layer = document.getElementById('sd-shot-preview');
      if (layer && layer.querySelector('img') && layer.querySelector('img').complete) break;
      await wait(400);
    }
    res.previewShown = !!layer;
    if (layer) {
      const img = layer.querySelector('img');
      res.preview = {
        isDataPng: (img.getAttribute('src') || '').startsWith('data:image/png;base64,'),
        b64Len: (img.getAttribute('src') || '').length,
        naturalW: img.naturalWidth,
        naturalH: img.naturalHeight,
        tip: (layer.querySelector('.sd-shot-tip') || {}).textContent || null,
        hasClose: !!layer.querySelector('.sd-shot-close')
      };
      // 关掉
      layer.querySelector('.sd-shot-close').click();
      await wait(400);
      res.previewClosed = !document.getElementById('sd-shot-preview');
    }

    // ---- 5. 移除 ----
    const before = d.listShots().length;
    list.value = String(first.id);
    wrap.querySelector('.sd-shot-btn[data-shot="remove"]').click();
    await wait(600);
    res.remove = { before, after: d.listShots().length };

    // ---- 6. 面板反复开关 ----
    camGrp.click(); await wait(500);
    const closed = !document.querySelector('.sd-sub-wrap.sd-open .sd-shot-list');
    camGrp.click(); await wait(700);
    const reopened = !!document.querySelector('.sd-sub-wrap.sd-open .sd-shot-list');
    res.reopen = { closed, reopened };

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
