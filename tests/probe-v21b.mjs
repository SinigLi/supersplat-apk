/* probe-v21b.mjs — 确认渲染真的拍到内容，且相机模型没被拍进照片
 *
 * v21a 的 624 字节是空场景（没放人偶）出的纯色图，属于正常。
 * 这里放一个人偶 + 两个机位，再出图：
 *   1. 图里必须有人偶像素（非背景）
 *   2. 图里不能有相机模型的青色像素（渲染时应被隐藏）
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4261;
const CDP = 9321;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
    '--use-angle=d3d11', '--window-size=390,844',
    `--user-data-dir=${process.env.TEMP}/edge-v21b-${Date.now()}`,
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

    // 人偶站原点
    d.switchCharacter('woman');
    for (let i = 0; i < 120; i++) { if (d.addPuppet() === 'ok') break; await wait(300); }
    await wait(1500);
    res.puppets = d.puppets.length;

    // 机位 A：正面看人偶
    scene.camera.setPose(new V(0, 1.25, -3.2), new V(0, 0.85, 0), 0);
    scene.forceRender = true;
    await wait(1400);
    const a = d.addShot();
    await wait(400);

    // 机位 B：侧后方，这个机位的相机会出现在 A 的视野里
    scene.camera.setPose(new V(2.2, 1.6, 1.4), new V(0, 0.85, 0), 0);
    scene.forceRender = true;
    await wait(1400);
    const b = d.addShot();
    await wait(600);

    res.shots = d.listShots().map(s => ({ id: s.id, pos: s.pos.map(v => +v.toFixed(2)) }));

    // 回到 A 渲染：B 的相机模型此时应该落在视野里（验证隐藏是否生效）
    const r = await d.renderShot(a.id, 480, 270);
    res.render = { ok: r.ok, bytes: r.bytes, wh: [r.width, r.height] };

    if (r.ok) {
      // 解 dataUrl 到像素统计
      const b64 = r.dataUrl.split(',')[1];
      const bin = atob(b64);
      // 直接解析 PNG 太重，这里用 img + canvas 取像素
      const img = new Image();
      img.src = r.dataUrl;
      await new Promise((res2) => { img.onload = res2; img.onerror = res2; });
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, cv.width, cv.height).data;

      let lit = 0, cyan = 0, total = 0;
      let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
      for (let y = 0; y < cv.height; y++) {
        for (let x = 0; x < cv.width; x++) {
          const o = (y * cv.width + x) * 4;
          const R = px[o], G = px[o+1], B = px[o+2];
          total++;
          const bright = (R > 24 || G > 24 || B > 24);
          if (bright) {
            lit++;
            if (x < minX) minX = x; if (y < minY) minY = y;
            if (x > maxX) maxX = x; if (y > maxY) maxY = y;
          }
          // 相机机身的青色：B 明显高于 R，且整体偏亮
          if (B > 90 && B > R + 40 && G > R) cyan++;
        }
      }
      res.pixels = {
        w: cv.width, h: cv.height,
        litPct: +(100 * lit / total).toFixed(2),
        cyanPct: +(100 * cyan / total).toFixed(3),
        bbox: maxX < 0 ? null : { x: [minX, maxX], y: [minY, maxY] }
      };
    }

    // 对照：把相机模型显式打开，再出一张（不经过 renderShot 的隐藏）
    const markerB = scene.app.root.findByName('shot-marker-' + b.id);
    if (markerB) {
      markerB.enabled = true;
      scene.forceRender = true;
      await wait(600);
      const raw = await d.events.invoke('render.offscreen', 480, 270);
      const arr = new Uint8Array(raw);
      let cyan2 = 0;
      for (let i = 0; i < arr.length; i += 4) {
        const R = arr[i], G = arr[i+1], B = arr[i+2];
        if (B > 90 && B > R + 40 && G > R) cyan2++;
      }
      res.cyanWithMarkerVisible = +(100 * cyan2 / (480*270)).toFixed(3);
    }

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
