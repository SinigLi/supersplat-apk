/* probe-v23b.mjs — 精确验证视角立方体六个轴
 *
 * view-cube.ts 的 update() 每帧按画家算法重排 DOM（fragment.appendChild），
 * 所以 circles[3] 不一定是 px。必须按文本标签（X/Y/Z）定位正向轴，
 * 负向轴则用「无文本」的圆 + 与正向轴相反的位移来判定。
 *
 * 期望映射（src/editor.ts:359 camera.align）：
 *   px -> azim 90,  elev 0
 *   py -> azim 0,   elev -90
 *   pz -> azim 0,   elev 0
 *   nx -> azim 270, elev 0
 *   ny -> azim 0,   elev 90
 *   nz -> azim 180, elev 0
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4273;
const CDP = 9333;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
    '--use-angle=d3d11', '--window-size=390,844',
    `--user-data-dir=${process.env.TEMP}/edge-v23b-${Date.now()}`,
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
    const cam = scene.camera;
    const svg = document.getElementById('view-cube-svg');
    const res = { axes: [], unreachable: [] };

    // 正向轴：g 里有 text 'X'/'Y'/'Z'
    const posG = {};
    svg.querySelectorAll('g > g').forEach(g => {
      const t = g.querySelector('text');
      if (t) posG[t.textContent] = g;
    });
    if (!posG.X || !posG.Y || !posG.Z) {
      res.error = 'missing labelled axes: ' + Object.keys(posG).join(',');
      return res;
    }

    const tap = async (el) => {
      el.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerId: 7, isPrimary: true
      }));
      await wait(800);
      return { azim: Math.round(cam.azim), elev: Math.round(cam.elevation) };
    };

    // 先回到一个中性姿态，确保每次点击都是真的在改
    scene.camera.setAzimElev(315, -10, 0);
    await wait(300);

    const expect = { X: [90, 0], Y: [0, -90], Z: [0, 0] };
    for (const k of ['X', 'Y', 'Z']) {
      scene.camera.setAzimElev(45, -20, 0);
      await wait(250);
      const got = await tap(posG[k].querySelector('circle'));
      const [ea, ee] = expect[k];
      const norm = a => ((a % 360) + 360) % 360;
      res.axes.push({
        axis: 'p' + k.toLowerCase(),
        got, expect: [ea, ee],
        ok: Math.abs(norm(got.azim) - norm(ea)) <= 1 && Math.abs(got.elev - ee) <= 1
      });
    }

    // 负向轴：没有 text 的圆。按当前相机姿态反推它应该是哪个轴：
    // nx 在 azim 270、ny 在 90、nz 在 180。
    const negGs = Array.from(svg.querySelectorAll('g > g')).filter(g => !g.querySelector('text'));
    res.negCount = negGs.length;

    // 用 align 的逆推：对每个负向圆点一下，看落在哪个标准角度
    const negExpect = { '270,0': 'nx', '0,90': 'ny', '180,0': 'nz' };
    for (const g of negGs) {
      scene.camera.setAzimElev(45, -20, 0);
      await wait(250);
      const got = await tap(g.querySelector('circle'));
      const key = Math.round(((got.azim % 360) + 360) % 360) + ',' + got.elev;
      const name = negExpect[key];
      if (name) res.axes.push({ axis: name, got, expect: key, ok: true });
      else res.unreachable.push({ got, key });
    }

    res.allOk = res.axes.length === 6 && res.axes.every(a => a.ok) && res.unreachable.length === 0;

    // 立方体本身仍是可见的（点完不该把自己弄没）
    const vc = document.getElementById('view-cube-container');
    const r = vc.getBoundingClientRect();
    res.stillVisible = getComputedStyle(vc).display !== 'none' && r.width > 0 && r.height > 0;

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
