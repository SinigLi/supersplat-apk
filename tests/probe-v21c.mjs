/* probe-v21c.mjs — 用像素差证明「渲染时相机模型被隐藏」
 *
 * 不用颜色阈值（上一版 cyan 判定在 tonemap 后不可靠），直接对比同一视角：
 *   A) 相机模型 隐藏 → 出图
 *   B) 相机模型 显示 → 出图
 * 两图必须不同（差异像素 > 0），才能证明模型确实画得出来；
 * 再确认 renderShot 出的图等于 A 而不是 B。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4262;
const CDP = 9322;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
    '--use-angle=d3d11', '--window-size=390,844',
    `--user-data-dir=${process.env.TEMP}/edge-v21c-${Date.now()}`,
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
    const W = 320, H = 180;

    // 人偶在原点
    d.switchCharacter('woman');
    for (let i = 0; i < 120; i++) { if (d.addPuppet() === 'ok') break; await wait(300); }
    await wait(1500);

    // 一个机位放在人偶正前方偏侧，让它的相机模型能进画面
    scene.camera.setPose(new V(0, 1.25, -3.2), new V(0, 0.85, 0), 0);
    scene.forceRender = true;
    await wait(1400);
    const shotA = d.addShot();

    // 机位 B：在 A 的右前方，其相机模型应出现在 A 的画面里
    scene.camera.setPose(new V(1.0, 1.35, -2.0), new V(0, 0.85, 0), 0);
    scene.forceRender = true;
    await wait(1400);
    const shotB = d.addShot();
    await wait(600);

    // 回到 A
    d.gotoShot(shotA.id);
    await wait(1600);

    const markerA = scene.app.root.findByName('shot-marker-' + shotA.id);
    const markerB = scene.app.root.findByName('shot-marker-' + shotB.id);
    if (!markerA || !markerB) { res.error = 'markers missing'; return res; }

    const shoot = async () => {
      scene.forceRender = true;
      const raw = await d.events.invoke('render.offscreen', W, H);
      return new Uint8Array(raw);
    };

    // A) 两个相机模型都隐藏
    markerA.enabled = false; markerB.enabled = false;
    await wait(400);
    const hidden = await shoot();

    // B) 两个相机模型都显形
    markerA.enabled = true; markerB.enabled = true;
    await wait(400);
    const shown = await shoot();

    const diff = (a, b) => {
      let n = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (Math.abs(a[i]-b[i]) > 6 || Math.abs(a[i+1]-b[i+1]) > 6 || Math.abs(a[i+2]-b[i+2]) > 6) n++;
      }
      return n;
    };
    const total = W * H;
    res.markerVisibleDiffPx = diff(hidden, shown);
    res.markerVisibleDiffPct = +(100 * diff(hidden, shown) / total).toFixed(3);

    // C) renderShot 出的图（内部会隐藏）应当等于 hidden，而不是 shown
    const r = await d.renderShot(shotA.id, W, H);
    res.renderShot = { ok: r.ok, bytes: r.bytes };

    if (r.ok) {
      const img = new Image();
      img.src = r.dataUrl;
      await new Promise((res2) => { img.onload = res2; img.onerror = res2; });
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const shotPx = ctx.getImageData(0, 0, cv.width, cv.height).data;

      const toRgb = (u8) => {
        const out2 = new Uint8ClampedArray(W*H*4);
        // 读回的 RGBA 是顶行优先，canvas 也是顶行优先，直接比
        for (let i = 0; i < W*H*4; i++) out2[i] = u8[i];
        return out2;
      };
      const shotArr = toRgb(shotPx);

      res.renderShotVsHiddenPct = +(100 * diff(shotArr, hidden) / total).toFixed(3);
      res.renderShotVsShownPct  = +(100 * diff(shotArr, shown) / total).toFixed(3);
    }

    // 恢复
    markerA.enabled = true; markerB.enabled = true;
    scene.forceRender = true;
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
