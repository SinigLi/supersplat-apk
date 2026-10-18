/* probe_v16b.mjs - 复现「转到背面显示不全」
 * 每个场景在方位角 0/90/180/270 各截一张，并打印 near/far/dist/bound
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4208;
const CDP = 9273;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = path.resolve('tests/shots_v16');
const sleep = ms => new Promise(r => setTimeout(r, ms));

fs.mkdirSync(OUT, { recursive: true });

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v16b-${Date.now()}`,
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
  console.log('shot ->', name);
};
const camInfo = () => evalJs(`(() => {
  const b = scene.bound;
  return {
    azim: +scene.camera.azim.toFixed(1),
    near: +scene.camera.near.toFixed(5),
    far: +scene.camera.far.toFixed(3),
    dist: +scene.camera.distance.toFixed(3),
    sceneRadius: +scene.camera.sceneRadius.toFixed(3),
    boundCenter: [+b.center.x.toFixed(2), +b.center.y.toFixed(2), +b.center.z.toFixed(2)],
    boundHalf: [+b.halfExtents.x.toFixed(2), +b.halfExtents.y.toFixed(2), +b.halfExtents.z.toFixed(2)],
    ratio: +(scene.camera.far / scene.camera.near).toFixed(1)
  };
})()`);

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

  console.log('BASE', JSON.stringify(await camInfo()));

  // 导入泼溅
  const imp = await evalJs(`(async () => {
    const res = await fetch('/spike/glb-load-test/splat.ply');
    const blob = await res.blob();
    const file = new File([blob], 'splat.ply');
    await scene.events.invoke('import', [{ filename: 'splat.ply', contents: file }]);
    return { size: file.size };
  })()`);
  console.log('IMPORT', JSON.stringify(imp));
  await sleep(5000);
  console.log('AFTER_SPLAT', JSON.stringify(await camInfo()));

  for (const az of [0, 90, 180, 270]) {
    await evalJs(`(() => { scene.camera.setAzimElev(${az}, -15, 0); scene.forceRender = true; return true; })()`);
    await sleep(1800);
    console.log('AZ' + az, JSON.stringify(await camInfo()));
    await shot('splat_azim_' + az);
  }
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 500);
}
