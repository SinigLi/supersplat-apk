/* probe_v16e.mjs - 验证「转到背面模型消失」是否为背面剔除
 *
 * 导入 shiba.glb 后，环绕 0/90/180/270 截图并统计亮像素。
 * 若 180° 覆盖率骤降 -> 单面渲染（backface culling）。
 * 然后把材质改成双面再测一次对比。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const PORT = 4211;
const CDP = 9276;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = path.resolve('tests/shots_v16');
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const decodePng = (buf) => {
  let pos = 8, width = 0, height = 0, colorType = 6;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = colorType === 6 ? 4 : 3;
  const stride = width * ch;
  const out = Buffer.alloc(width * height * ch);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + b) & 255;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      cur[x] = v;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { width, height, channels: ch, data: out };
};

const coverage = (png) => {
  const { width, height, channels, data } = png;
  const x0 = Math.floor(width * 0.08), x1 = Math.floor(width * 0.92);
  const y0 = Math.floor(height * 0.20), y1 = Math.floor(height * 0.80);
  let lit = 0, total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * channels;
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      total++;
      // 模型是彩色/亮色，网格地板偏暗灰；用较高阈值只数模型
      if (lum > 70) lit++;
    }
  }
  return +(lit / total).toFixed(4);
};

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v16e-${Date.now()}`,
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
  const buf = Buffer.from(r.data, 'base64');
  fs.writeFileSync(path.join(OUT, name + '.png'), buf);
  return coverage(decodePng(buf));
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

  // 导入 shiba
  await evalJs(`(async () => {
    const d = window.__director;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const res = await fetch('/www/static/director/shiba.glb');
    const blob = await res.blob();
    d.importModel(new File([blob], 'shiba.glb'));
    for (let i = 0; i < 50; i++) { await wait(300); if ((d.listProps() || []).length) break; }
    return (d.listProps() || []).length;
  })()`);
  await sleep(2000);

  // 把相机固定在模型外侧，围绕模型中心转
  const setup = await evalJs(`(() => {
    const d = window.__director;
    const ent = d.props[0].entity;
    const pos = ent.getPosition();
    const cam = scene.camera;
    cam.lookCameraPos = null;
    cam.setFocalPoint(pos.clone(), 0);
    cam.setDistance(1.6, 0);
    cam.setAzimElev(0, -10, 0);
    scene.forceRender = true;
    return { propPos: [pos.x, pos.y, pos.z], dist: cam.distance, radius: cam.sceneRadius };
  })()`);
  console.log('SETUP', JSON.stringify(setup));
  await sleep(2000);

  const before = {};
  for (const az of [0, 90, 180, 270]) {
    await evalJs(`(() => { scene.camera.setAzimElev(${az}, -10, 0); scene.forceRender = true; return true; })()`);
    await sleep(1400);
    before[az] = await shot('cull_before_' + az);
  }
  console.log('BEFORE (单面)', JSON.stringify(before));

  // 材质改成双面
  const patched = await evalJs(`(() => {
    const d = window.__director;
    let n = 0;
    d.props.forEach(p => {
      p.entity.findComponents('render').forEach((rc) => {
        rc.meshInstances.forEach((mi) => {
          if (mi.material) { mi.material.cull = 0; n++; }
        });
      });
    });
    scene.forceRender = true;
    return n;
  })()`);
  console.log('PATCHED materials', patched);
  await sleep(1200);

  const after = {};
  for (const az of [0, 90, 180, 270]) {
    await evalJs(`(() => { scene.camera.setAzimElev(${az}, -10, 0); scene.forceRender = true; return true; })()`);
    await sleep(1400);
    after[az] = await shot('cull_after_' + az);
  }
  console.log('AFTER (双面)', JSON.stringify(after));
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 500);
}
