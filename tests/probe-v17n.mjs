/* probe_v17n.mjs - 用真实入口验证拾取：直接调 director.snapPosition 与 armPlaceCursor
 * 之前探针用了一个不存在的 window.__pickSceneObject，导致误判。
 * 这里只使用生产代码真实暴露的接口。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const PORT = 4231;
const CDP = 9296;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = path.resolve('tests/shots_v17');
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
  return { width, height, channels: ch, stride, raw };
};

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
  `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
  '--use-angle=d3d11', '--window-size=390,844',
  `--user-data-dir=${process.env.TEMP}/edge-v17n-${Date.now()}`,
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

  const setup = await evalJs(`(async () => {
    const d = window.__director;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    d.switchCharacter('woman');
    for (let i = 0; i < 50; i++) { await wait(300); if (d.info().loaded) break; }
    const V = d.cursorRoot.getLocalPosition().constructor;
    d.placeCursor(new V(0, 0, 0));
    d.addPuppet();
    await wait(2500);
    return { puppets: d.listPuppets().length, loaded: d.info().loaded };
  })()`);
  console.log('SETUP', JSON.stringify(setup));

  // 把相机对准人偶胸口，然后测 snapPosition 落点是否在人偶上
  const out = await evalJs(`(async () => {
    const d = window.__director;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const ent = d.puppets[0].entity;
    const base = ent.getPosition();
    const V = base.constructor;
    const target = new V(base.x, base.y + 0.9, base.z);

    const cam = scene.camera;
    cam.setFocalPoint(target.clone(), 0);
    cam.setAzimElev(0, -5, 0);
    cam.setDistance(1.5, 0);
    scene.forceRender = true;
    await wait(2500);

    const W = scene.canvas.clientWidth, H = scene.canvas.clientHeight;
    const sp = new V();
    cam.worldToScreen(target, sp);
    const cx = sp.x * W, cy = sp.y * H;

    const snap = await d.snapPosition(cx, cy);

    // 验证落点是否落在人偶的身体包围盒内
    let inside = false;
    (ent.findComponents('render') || []).forEach(rc => (rc.meshInstances || []).forEach(mi => {
      if (!mi.aabb || !snap) return;
      const mn = mi.aabb.getMin(), mx = mi.aabb.getMax();
      if (snap.x >= mn.x - 0.05 && snap.x <= mx.x + 0.05 &&
          snap.y >= mn.y - 0.05 && snap.y <= mx.y + 0.05 &&
          snap.z >= mn.z - 0.05 && snap.z <= mx.z + 0.05) inside = true;
    }));

    return {
      click: [Math.round(cx), Math.round(cy)],
      target: target.toArray().map(v => +v.toFixed(3)),
      snap: snap ? snap.toArray().map(v => +v.toFixed(3)) : null,
      distToTarget: snap ? +snap.distance(target).toFixed(3) : null,
      onPuppet: inside,
      puppetPos: base.toArray().map(v => +v.toFixed(3))
    };
  })()`);
  console.log('SNAP', JSON.stringify(out, null, 2));

  // 再用真实游标放置 + 移动到游标 验证整条链路
  const chain = await evalJs(`(async () => {
    const d = window.__director;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const ent = d.puppets[0].entity;
    const V = ent.getPosition().constructor;

    // 把人偶先挪到别处
    ent.setLocalPosition(2, 0, -1);
    scene.forceRender = true;
    await wait(800);

    // 放置游标到人偶原来的位置（模拟点画面）
    d.placeCursor(new V(0, 0.5, 0));
    await wait(400);
    const cur = d.cursorRoot.getLocalPosition().clone();

    // 选中人偶再移动
    d.selectPuppet(d.puppets[0]);
    await wait(300);
    const r = d.moveSelectedToCursor();
    await wait(800);

    return {
      cursor: cur.toArray().map(v => +v.toFixed(3)),
      result: r,
      puppetAfter: ent.getLocalPosition().toArray().map(v => +v.toFixed(3)),
      // 游标有 CURSOR_Y_LIFT(0.02)，落地应为 cursor.y - 0.02
      expectedY: +(cur.y - 0.02).toFixed(3)
    };
  })()`);
  console.log('CHAIN', JSON.stringify(chain, null, 2));

  await shot('v17_final');
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(0), 500);
}
