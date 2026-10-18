/* probe-v24c.mjs — v24 验收
 *
 * 1. 只导入 GLB、场景里没有人偶时，模型会被自动选中 → 变换 gizmo 挂上去
 *    （修复前 PropAddOp 不选中，必须先点模型，用户以为"没有箭头"）
 * 2. 变换工具激活时，点击没点到箭头、而是点到别的对象 → 切换选中目标
 * 3. 场景管理器「禁止选中」：锁定后点不中、直接选也返回 locked
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4276;
const CDP = 9336;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
    '--use-angle=d3d11', '--window-size=390,844',
    `--user-data-dir=${process.env.TEMP}/edge-v24c-${Date.now()}`,
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
    for (let i = 0; i < 120; i++) {
        if (await evalJs('document.body.classList.contains("sd-docks-ready")')) break;
        await sleep(400);
    }
    await sleep(1500);

    const out = await evalJs(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const D = window.__director;
    const res = {};
    if (!D) return { __err: 'no __director' };

    const V = scene.camera.focalPoint.constructor;
    const selectedSummary = () => {
      const props = D.listProps();
      const pups = D.listPuppets();
      return {
        propSelected: (props.find(p => p.selected) || {}).name || null,
        puppetSelected: (pups.find(p => p.selected) || {}).name || null
      };
    };
    const pivotPos = () => {
      const p = scene.events.invoke('pivot').transform.position;
      return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) };
    };

    // ---------- 1. 只导入 GLB，没有人偶 ----------
    res.puppetsBefore = D.listPuppets().length;
    const resp = await fetch('./static/director/tuxedo.glb');
    const buf = await resp.arrayBuffer();
    D.importModel(new File([buf], 'auto-sel.glb', { type: 'model/gltf-binary' }));
    for (let i = 0; i < 100; i++) {
      if (D.listProps().length > 0) break;
      await wait(250);
    }
    const props0 = D.listProps();
    res.propCount = props0.length;
    if (!props0.length) { res.error = 'import failed'; return res; }
    const pr = props0[props0.length - 1];
    res.importAutoSelected = pr.selected === true;      // ★ 需求 1
    res.toolBefore = scene.events.invoke('tool.active');

    // 挪到 (2,0,0) 再重选一次，让 pivot 落到确定位置
    // 注意：selection.ts 的 setSelection 有 splat !== selection 判定，
    // 重复选中同一个 adapter 不会触发 selection.changed，pivot 也就不会重算。
    // 必须先取消选中再选回来，否则这里量到的 gizmo 会停在旧位置（假失败）。
    const propEnt = scene.app.root.findByName(pr.name);
    propEnt.setLocalPosition(2, 0, 0);
    await wait(200);
    D.selectPropById(null);
    await wait(300);
    D.selectPropById(pr.id);
    await wait(400);

    // 开变换工具
    if (scene.events.invoke('tool.active') !== 'move') scene.events.fire('tool.move');
    await wait(600);
    const gp = scene.app.root.findByName('gizmoPivot');
    res.afterImport = {
      tool: scene.events.invoke('tool.active'),
      pivot: pivotPos(),
      gizmoPivot: gp ? (() => { const p = gp.getLocalPosition(); return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) }; })() : null,
      gizmoAtProp: gp ? Math.abs(gp.getLocalPosition().x - 2) < 0.05 : false,   // ★ gizmo 挂在道具上
      sel: selectedSummary()
    };

    // ---------- 2. 变换工具下点击别的对象 → 切换选中 ----------
    // 人偶放在原点并自动选中，然后把相机对准道具(2,0,0)，点屏幕正中
    D.addPuppet();
    for (let i = 0; i < 80; i++) {
      if (D.listPuppets().length > 0) break;
      await wait(250);
    }
    res.puppetCount = D.listPuppets().length;
    const pup = D.listPuppets()[0];
    if (pup) {
      const pe = scene.app.root.findByName(pup.name);
      if (pe) pe.setLocalPosition(0, 0, 0);
    }
    await wait(300);

    // 相机对准道具
    scene.camera.setPose(new V(2, 1.4, 6), new V(2, 0.3, 0), 0);
    await wait(500);

    const container = document.getElementById('canvas-container') || scene.canvas;
    const r0 = container.getBoundingClientRect();
    const cx = Math.round(r0.left + r0.width / 2);
    const cy = Math.round(r0.top + r0.height / 2);

    const tap = async (x, y) => {
      const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 11, isPrimary: true, pointerType: 'touch', button: 0 };
      container.dispatchEvent(new PointerEvent('pointerdown', opts));
      await wait(60);
      container.dispatchEvent(new PointerEvent('pointerup', opts));
      await wait(500);
    };

    res.beforeSwitch = selectedSummary();
    res.toolDuringSwitch = scene.events.invoke('tool.active');
    await tap(cx, cy);
    res.afterSwitch = selectedSummary();       // ★ 需求 2：应变成道具
    res.switchWorked = res.afterSwitch.propSelected === pr.name;

    // ---------- 3. 禁止选中 ----------
    D.setPropLocked(pr.id, true);
    await wait(400);
    const lockedRow = D.listProps().find(p => p.id === pr.id);
    res.lockFlag = lockedRow ? lockedRow.locked : null;
    res.selAfterLock = selectedSummary();       // 锁住当前选中对象后应被清空

    // 锁住后点同一位置，不应该再选中它
    await tap(cx, cy);
    res.afterLockedTap = selectedSummary();
    res.lockedTapBlocked = res.afterLockedTap.propSelected === null;

    // 直接调用也不该选中
    D.selectPropById(pr.id);
    await wait(300);
    res.afterDirectSelect = selectedSummary();
    res.directSelectBlocked = res.afterDirectSelect.propSelected === null;

    // 解锁后恢复可选
    D.setPropLocked(pr.id, false);
    await wait(300);
    D.selectPropById(pr.id);
    await wait(400);
    res.afterUnlock = selectedSummary();
    res.unlockWorks = res.afterUnlock.propSelected === pr.name;

    // 人偶锁定 API 也在
    if (pup) {
      const lr = D.setPuppetLocked(pup.id, true);
      await wait(250);
      const row = D.listPuppets().find(p => p.id === pup.id);
      res.puppetLock = { ret: lr, lockedFlag: row ? row.locked : null };
      D.setPuppetLocked(pup.id, false);
    }

    res.pass = res.importAutoSelected === true
            && res.afterImport.gizmoAtProp === true
            && res.switchWorked === true
            && res.lockFlag === true
            && res.lockedTapBlocked === true
            && res.directSelectBlocked === true
            && res.unlockWorks === true;

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
