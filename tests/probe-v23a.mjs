/* probe-v23a.mjs — v23 验收
 *
 * 1. 顶栏不再有「渲染」分组按钮（TOP_MENUS 置空）
 * 2. 视角立方体常驻可见（mobile.css 之前把它 display:none 了）
 * 3. 立方体在右上角、尺寸合理、不压住顶栏
 * 4. 点 X 轴圆点真的能转相机（camera.align -> setAzimElev）
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4272;
const CDP = 9332;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
    '--use-angle=d3d11', '--window-size=390,844',
    `--user-data-dir=${process.env.TEMP}/edge-v23a-${Date.now()}`,
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
    await sleep(1200);

    const out = await evalJs(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const res = {};

    // ---- 1. 顶栏按钮清单 ----
    const topDock = document.querySelector('.sd-dock.sd-top');
    res.topDock = topDock ? Array.from(topDock.querySelectorAll('.sd-grp-btn'))
      .map(b => (b.querySelector('.sd-name') || {}).textContent || '') : null;

    const allGrp = Array.from(document.querySelectorAll('.sd-grp-btn'))
      .map(b => (b.querySelector('.sd-name') || {}).textContent || '');
    res.renderGroupAnywhere = allGrp.filter(t => t.includes('渲染'));

    // 渲染菜单面板本身还应该在 #menu 里，只是没有入口
    const renderPanel = document.getElementById('menu-bar') ? null : null;
    res.menuRootExists = !!document.querySelector('#menu.sd-menu-root');

    // ---- 2/3. 视角立方体 ----
    const vc = document.getElementById('view-cube-container');
    const svg = document.getElementById('view-cube-svg');
    if (!vc) { res.viewCube = { present: false }; return res; }

    const cs = getComputedStyle(vc);
    const r = vc.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    res.viewCube = {
      present: true,
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      w: Math.round(r.width), h: Math.round(r.height),
      rightGap: Math.round(vw - r.right),
      topGap: Math.round(r.top),
      inTopRight: r.right > vw * 0.6 && r.top < vh * 0.3,
      visible: cs.display !== 'none' && cs.visibility !== 'hidden'
               && r.width > 0 && r.height > 0 && +cs.opacity > 0,
      circles: svg ? svg.querySelectorAll('circle').length : 0
    };

    // 顶栏与立方体是否重叠
    if (topDock) {
      const tr = topDock.getBoundingClientRect();
      const overlap = !(r.right < tr.left || r.left > tr.right || r.bottom < tr.top || r.top > tr.bottom);
      res.overlapsTopDock = overlap;
    }

    // ---- 4. 点 X 轴圆点是否真的转相机 ----
    const cam = scene.camera;
    const before = { azim: +cam.azim.toFixed(1), elev: +cam.elevation.toFixed(1) };

    // px 圆点 = 第一个带文本的圆（circle 顺序 nx,ny,nz,px,py,pz）
    const circles = Array.from(svg.querySelectorAll('circle'));
    const pxCircle = circles[3];
    res.circleOrderLen = circles.length;

    // 直接派发 pointerdown（命中区就是 circle 自身）
    const ev = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true });
    pxCircle.dispatchEvent(ev);
    await wait(700);
    const after = { azim: +cam.azim.toFixed(1), elev: +cam.elevation.toFixed(1) };

    res.alignClick = {
      before, after,
      changed: Math.abs(after.azim - before.azim) > 1 || Math.abs(after.elev - before.elev) > 1
    };

    // 再点 py（俯视）
    const pyCircle = circles[4];
    pyCircle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 2, isPrimary: true }));
    await wait(700);
    res.alignTop = { azim: +cam.azim.toFixed(1), elev: +cam.elevation.toFixed(1) };

    // 立方体是否盖住了右侧 dock 的分组按钮（点了能不能穿透）
    const rightDock = document.querySelector('.sd-dock.sd-right');
    if (rightDock) {
      const rr = rightDock.getBoundingClientRect();
      const vr = vc.getBoundingClientRect();
      res.overlapsRightDock = !(vr.right < rr.left || vr.left > rr.right || vr.bottom < rr.top || vr.top > rr.bottom);
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
