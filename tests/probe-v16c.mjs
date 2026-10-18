/* probe_v16c.mjs - 量化诊断「转到背面显示不全」
 *
 * 用覆盖度（画面里非背景像素比例）来判断内容是否真的丢失。
 * 对每个方位角，分别在两种裁剪面策略下测：
 *   A) 现状（相机在场景包围球内时 near = far/16384）
 *   B) 修复后（near 比率限制在 1/4096，far 至少覆盖包围球）
 *
 * 如果 A 在 180° 覆盖度骤降、B 正常，就证明是近裁剪面精度问题。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4209;
const CDP = 9274;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = path.resolve('tests/shots_v16');
const sleep = ms => new Promise(r => setTimeout(r, ms));

fs.mkdirSync(OUT, { recursive: true });

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v16c-${Date.now()}`,
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
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
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
  await send('Page.enable');
  await sleep(2500);
  for (let i = 0; i < 100; i++) {
    if (await evalJs('document.body.classList.contains("sd-docks-ready")')) break;
    await sleep(400);
  }

  // 安装覆盖度探针：在 postrender 里把 WebGL canvas 画到 2D canvas 上统计
  const installed = await evalJs(`(() => {
    const src = scene.canvas;
    const c2 = document.createElement('canvas');
    c2.width = 195; c2.height = 422;
    const ctx = c2.getContext('2d', { willReadFrequently: true });
    window.__cover = null;
    window.__grab = () => {
      try {
        ctx.drawImage(src, 0, 0, c2.width, c2.height);
        const d = ctx.getImageData(0, 0, c2.width, c2.height).data;
        let lit = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
        for (let y = 0; y < c2.height; y++) {
          for (let x = 0; x < c2.width; x++) {
            const i = (y * c2.width + x) * 4;
            const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
            if (lum > 26) {
              lit++;
              if (x < minX) minX = x; if (x > maxX) maxX = x;
              if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
          }
        }
        window.__cover = {
          litRatio: +(lit / (c2.width * c2.height)).toFixed(4),
          bbox: maxX < 0 ? null : [minX, minY, maxX, maxY],
          size: [c2.width, c2.height]
        };
      } catch (e) { window.__cover = { error: String(e && e.message || e) }; }
    };
    scene.events.on('postrender', () => window.__grab());
    return true;
  })()`);
  console.log('probe installed', installed);

  // 导入泼溅
  await evalJs(`(async () => {
    const res = await fetch('/spike/glb-load-test/splat.ply');
    const blob = await res.blob();
    const file = new File([blob], 'splat.ply');
    await scene.events.invoke('import', [{ filename: 'splat.ply', contents: file }]);
    return true;
  })()`);
  await sleep(5000);

  // 加一个 GLB 道具
  const prop = await evalJs(`(async () => {
    const d = window.__director;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const res = await fetch('/www/static/director/shiba.glb');
    const blob = await res.blob();
    const file = new File([blob], 'shiba.glb');
    d.importModel(file);
    for (let i = 0; i < 40; i++) { await wait(300); if ((d.listProps() || []).length) break; }
    return (d.listProps() || []).length;
  })()`);
  console.log('PROPS', prop);
  await sleep(1500);

  const measure = async (label, az) => {
    await evalJs(`(() => { scene.camera.setAzimElev(${az}, -15, 0); scene.forceRender = true; return true; })()`);
    await sleep(1500);
    const r = await evalJs(`({ cover: window.__cover, near: +scene.camera.near.toExponential(3), far: +scene.camera.far.toFixed(3), ratio: +(scene.camera.far/scene.camera.near).toFixed(0) })`);
    await shot(label + '_az' + az);
    return r;
  };

  console.log('--- A: 现状裁剪 ---');
  for (const az of [0, 90, 180, 270]) {
    const r = await measure('A', az);
    console.log('A az' + az, JSON.stringify(r));
  }

  // ---- B: 覆盖 fitClippingPlanes，限制 near 比率 ----
  const patched = await evalJs(`(() => {
    const cam = scene.camera;
    const V = cam.constructor;
    cam.__origFit = cam.fitClippingPlanes;
    cam.fitClippingPlanes = function (cameraPosition, forwardVec) {
      const bound = scene.bound;
      const boundRadius = bound.halfExtents.length();
      const vec = new (cameraPosition.constructor)();
      vec.sub2(bound.center, cameraPosition);
      const dist = vec.dot(forwardVec);
      // far 必须覆盖整个包围球，即使相机在球内
      const far = Math.max(dist + boundRadius, boundRadius * 2, 1e-2);
      if (this.ortho) {
        const radius = Math.max(boundRadius, 1e-2);
        this.far = dist + radius;
        this.near = dist - radius;
        return;
      }
      // 关键：near 不再退化成 far/16384，比率封顶 1/2048
      const nearFloor = far / 2048;
      const near = Math.max(dist - boundRadius, nearFloor, 1e-4);
      this.far = far;
      this.near = Math.min(1.0, near);
    };
    return true;
  })()`);
  console.log('patched', patched);

  console.log('--- B: 限制 near 比率 ---');
  for (const az of [0, 90, 180, 270]) {
    const r = await measure('B', az);
    console.log('B az' + az, JSON.stringify(r));
  }
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 500);
}
