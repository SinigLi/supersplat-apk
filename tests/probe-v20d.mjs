/* probe-v20d.mjs — 决定性验证：把 render.offscreen 的像素写成 PNG，人工看
 *
 * 同时：
 *   1) 摆一只柴犬和一只猫，读实体真实缩放（确认 0.225 / 0.19 生效）
 *   2) 用 CDP 截一张真实视口，与 offscreen 出图对照
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';

const ROOT = path.resolve('.');
const PORT = 4253;
const CDP = 9313;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 最简 PNG 编码（filter 0），用于把 RGBA 写成可视文件
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c;
}
const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
};
const writePng = (rgba, w, h, file) => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const stride = w * 4;
    const raw = Buffer.alloc((stride + 1) * h);
    for (let y = 0; y < h; y++) {
        raw[y * (stride + 1)] = 0;
        rgba.copy ? rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
                  : Buffer.from(rgba).copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
    }
    const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0))
    ]);
    fs.writeFileSync(file, png);
    return png.length;
};

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
    '--use-angle=d3d11', '--window-size=390,844',
    `--user-data-dir=${process.env.TEMP}/edge-v20d-${Date.now()}`,
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

    // 摆人 / 狗 / 猫
    const want = ['woman', 'shiba', 'tuxedo'];
    for (const cid of want) {
      d.switchCharacter(cid);
      for (let i = 0; i < 120; i++) { if (d.addPuppet() === 'ok') break; await wait(300); }
      await wait(1200);
    }
    await wait(1200);

    res.puppets = d.puppets.map(p => ({
      charId: p.charId,
      scale: +p.entity.getLocalScale().x.toFixed(4)
    }));

    // 把三个排开，方便看清
    d.puppets.forEach((p, i) => {
      const q = p.entity.getLocalPosition();
      p.entity.setLocalPosition(i * 1.1 - 1.1, q.y, 0);
    });
    scene.invalidateBound();
    scene.forceRender = true;
    await wait(1200);

    // 相机：正前方看三个人
    scene.camera.setPose(new V(0, 1.1, -3.4), new V(0, 0.85, 0), 0);
    scene.forceRender = true;
    await wait(1600);

    const W = 320, H = 320;
    const raw = await d.events.invoke('render.offscreen', W, H);
    // 数据是 Uint8Array，转 base64 传回
    let bin = '';
    const arr = new Uint8Array(raw);
    const CH = 0x8000;
    for (let i = 0; i < arr.length; i += CH) {
      bin += String.fromCharCode.apply(null, arr.subarray(i, i + CH));
    }
    res.rgbaB64 = btoa(bin);
    res.W = W; res.H = H;
    return res;
  })()`);

    if (out.__err) {
        console.log('ERR', out.__err);
    } else {
        console.log('puppets', JSON.stringify(out.puppets));
        const rgba = Buffer.from(out.rgbaB64, 'base64');
        const n = writePng(rgba, out.W, out.H, 'shot_v20_offscreen.png');
        console.log('wrote shot_v20_offscreen.png', n, 'bytes', out.W + 'x' + out.H);

        // 真实视口截图做对照
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        if (shot && shot.data) {
            fs.writeFileSync('shot_v20_viewport.png', Buffer.from(shot.data, 'base64'));
            console.log('wrote shot_v20_viewport.png');
        }
    }
} catch (e) {
    console.error('ERR', e.message);
} finally {
    try { ws?.close(); } catch {}
    edge.kill(); srv.kill();
    setTimeout(() => process.exit(0), 500);
}
