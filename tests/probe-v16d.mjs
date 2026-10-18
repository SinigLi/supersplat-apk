/* probe_v16d.mjs - 定向验证：相机在包围球外 vs 内，正/背面覆盖度
 *
 * 用 CDP 截图（不是 readPixels，WebGL 无 preserveDrawingBuffer）逐像素统计，
 * 判断「背面显示不全」是否源于相机陷进场景内部。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const PORT = 4210;
const CDP = 9275;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = path.resolve('tests/shots_v16');
const sleep = ms => new Promise(r => setTimeout(r, ms));

fs.mkdirSync(OUT, { recursive: true });

// ---- 极简 PNG 解码（只处理 CDP 的 8bit RGB/RGBA，无行滤波或 0..4 滤波）----
const decodePng = (buf) => {
  let pos = 8, width = 0, height = 0, bitDepth = 8, colorType = 6;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const out = Buffer.alloc(width * height * channels);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      cur[x] = v;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { width, height, channels, data: out };
};

// 只统计视口中部区域（避开工具栏），背景是深色
const coverage = (png) => {
  const { width, height, channels, data } = png;
  const x0 = Math.floor(width * 0.05), x1 = Math.floor(width * 0.95);
  const y0 = Math.floor(height * 0.18), y1 = Math.floor(height * 0.86);
  let lit = 0, total = 0;
  let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * channels;
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      total++;
      if (lum > 24) {
        lit++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  return {
    ratio: +(lit / total).toFixed(4),
    bbox: maxX < 0 ? null : [minX, minY, maxX, maxY]
  };
};

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v16d-${Date.now()}`,
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
const shotPng = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(r.data, 'base64');
  if (name) fs.writeFileSync(path.join(OUT, name + '.png'), buf);
  return decodePng(buf);
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

  await evalJs(`(async () => {
    const res = await fetch('/spike/glb-load-test/splat.ply');
    const blob = await res.blob();
    const file = new File([blob], 'splat.ply');
    await scene.events.invoke('import', [{ filename: 'splat.ply', contents: file }]);
    return true;
  })()`);
  await sleep(5000);

  const info = () => evalJs(`(() => {
    const b = scene.bound;
    const cam = scene.camera;
    return {
      dist: +cam.distance.toFixed(3),
      radius: +cam.sceneRadius.toFixed(3),
      near: +cam.near.toFixed(5),
      far: +cam.far.toFixed(2),
      boundCenter: [+b.center.x.toFixed(2), +b.center.y.toFixed(2), +b.center.z.toFixed(2)],
      boundHalf: [+b.halfExtents.x.toFixed(2), +b.halfExtents.y.toFixed(2), +b.halfExtents.z.toFixed(2)],
      camPos: cam.mainCamera.getLocalPosition().toArray().map(v => +v.toFixed(2))
    };
  })()`);

  console.log('BASE', JSON.stringify(await info()));

  // 关键实验：强制相机在包围球外，正/背对比
  for (const az of [0, 180]) {
    await evalJs(`(() => {
      const cam = scene.camera;
      cam.lookCameraPos = null;
      cam.setFocalPoint(scene.bound.center.clone(), 0);
      cam.setAzimElev(${az}, 0, 0);
      cam.setDistance(2.2, 0);
      scene.forceRender = true;
      return true;
    })()`);
    await sleep(2200);
    const st = await info();
    const png = await shotPng('outside_az' + az);
    console.log('OUTSIDE az' + az, JSON.stringify({ ...st, cover: coverage(png) }));
  }

  // 对照：用默认的 scene 相机状态（可能贴在场景内）
  for (const az of [0, 180]) {
    await evalJs(`(() => {
      scene.camera.setAzimElev(${az}, -15, 0);
      scene.forceRender = true;
      return true;
    })()`);
    await sleep(2000);
    const st = await info();
    const png = await shotPng('default_az' + az);
    console.log('DEFAULT az' + az, JSON.stringify({ ...st, cover: coverage(png) }));
  }
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 500);
}
