/* probe-v27.mjs — v27 验收
 *
 * 1) 选中黄点和游标一样，屏幕像素固定，不随相机远近变化
 * 2) 相机渲染（renderShot）时，游标和黄点都不出现在画面里
 * 3) GLB 重设基准点后，黄点跟着基准点走（以前钉在实体原点）
 * 4) 泼溅的「中心」改用高斯密度中心，而不是包围盒中心
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4283;
const CDP = 9343;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
    '--use-angle=d3d11', '--window-size=390,844',
    `--user-data-dir=${process.env.TEMP}/edge-v27-${Date.now()}`,
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

    const Vec3 = scene.camera.focalPoint.constructor;
    const vec = (x, y, z) => new Vec3(x, y, z);
    const round = v => ({ x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(3) });
    const near = (a, b, eps = 0.06) =>
      Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.z - b.z) < eps;

    const marker = scene.app.root.findByName('selection-marker');
    const cursor = scene.app.root.findByName('director-cursor');
    res.markerExists = !!marker;
    res.cursorExists = !!cursor;

    // ---------- 3) GLB 重设基准点后，黄点跟着走 ----------
    scene.events.fire('tool.move');
    await wait(500);

    const r1 = await fetch('./static/director/tuxedo.glb');
    const b1 = await r1.arrayBuffer();
    D.importModel(new File([b1], 'v27-prop.glb', { type: 'model/gltf-binary' }));
    for (let i = 0; i < 100; i++) { if (D.listProps().length) break; await wait(250); }
    const pr = D.listProps().slice(-1)[0];
    const pent = scene.app.root.findByName(pr.name);
    D.selectPropById(null); await wait(300);
    D.selectPropById(pr.id); await wait(800);

    res.atSelection = {
      markerOn: marker.enabled,
      markerPos: round(marker.getLocalPosition()),
      pivot: round(scene.events.invoke('pivot').transform.position)
    };

    // 定位到中心 → 黄点应当立刻跟到中心
    const rc = D.anchorPivotToCenter();
    await wait(900);
    const pivotAfterCenter = scene.events.invoke('pivot').transform.position.clone();
    res.afterCenter = {
      ret: rc,
      pivot: round(pivotAfterCenter),
      markerPos: round(marker.getLocalPosition()),
      followed: near(marker.getLocalPosition(), pivotAfterCenter, 0.02)
    };

    // 重设 → 黄点回到实体原点
    const rr = D.resetPivot();
    await wait(900);
    const entPos = pent.getLocalPosition().clone();
    res.afterReset = {
      ret: rr,
      entity: round(entPos),
      pivot: round(scene.events.invoke('pivot').transform.position),
      markerPos: round(marker.getLocalPosition()),
      followed: near(marker.getLocalPosition(), entPos, 0.02)
    };
    res.req3 = res.afterCenter.followed === true && res.afterReset.followed === true;

    // 再验证一次「定位到游标」，黄点也要跟
    D.armPlaceCursor(); await wait(200);
    D.placeCursor(vec(2.5, 1.0, -1.5)); await wait(500);
    D.anchorPivotToCursor(); await wait(900);
    res.afterCursor = {
      pivot: round(scene.events.invoke('pivot').transform.position),
      markerPos: round(marker.getLocalPosition()),
      followed: near(marker.getLocalPosition(), vec(2.5, 1.0, -1.5), 0.06)
    };

    // ---------- 1) 屏幕像素固定 ----------
    const measure = () => {
      const cam = scene.camera;
      const camPos = cam.mainCamera.getPosition();
      const depth = Math.max(0.001, marker.getPosition().clone().sub(camPos).dot(cam.mainCamera.forward));
      const px = cam.worldSizePerPixel(depth);
      return {
        depth: +depth.toFixed(3),
        scale: +marker.getLocalScale().x.toFixed(4),
        pixels: +(marker.getLocalScale().x / px).toFixed(2)
      };
    };

    // 近处
    scene.camera.setPose(vec(0, 0.6, 3), vec(0, 0.6, 0));
    await wait(700);
    const nearM = measure();

    // 远处
    scene.camera.setPose(vec(0, 0.6, 14), vec(0, 0.6, 0));
    await wait(700);
    const farM = measure();

    res.screenConstant = {
      near: nearM,
      far: farM,
      scaleGrewWithDistance: farM.scale > nearM.scale * 2,
      samePixels: Math.abs(nearM.pixels - farM.pixels) < 2.5
    };
    res.req1 = res.screenConstant.samePixels && res.screenConstant.scaleGrewWithDistance;

    // ---------- 2) 渲染时不出现游标和黄点 ----------
    // 截获 render.offscreen，在它真正渲染前记录两者状态
    const fns = scene.events.functions;
    const orig = fns.get('render.offscreen');
    let seenDuringCapture = null;
    fns.set('render.offscreen', async (w, h) => {
      seenDuringCapture = {
        marker: marker.enabled,
        cursor: cursor ? cursor.enabled : null
      };
      return orig(w, h);
    });

    D.addShot();
    await wait(600);
    const shot = D.listShots().slice(-1)[0];
    const rs = await D.renderShot(shot.id, 320, 180);
    fns.set('render.offscreen', orig);
    await wait(400);

    res.render = {
      ok: !!rs.ok,
      bytes: rs.bytes || 0,
      duringCapture: seenDuringCapture,
      afterCapture: { marker: marker.enabled, cursor: cursor ? cursor.enabled : null }
    };
    res.req2 = rs.ok === true
            && seenDuringCapture !== null
            && seenDuringCapture.marker === false
            && seenDuringCapture.cursor === false
            && res.render.afterCapture.marker === true;

    // ---------- 4) 泼溅用密度中心 ----------
    const r2 = await fetch('../spike/glb-load-test/splat.ply');
    if (!r2.ok) return { __err: 'ply fetch failed ' + r2.status };
    const b2 = await r2.arrayBuffer();
    scene.events.invoke('import', [{ filename: 'v27.ply', contents: new Blob([b2]) }]);

    let splat = null;
    for (let i = 0; i < 200; i++) {
      const sels = scene.getElementsByType('splat');
      if (sels.length) { splat = sels[sels.length - 1]; break; }
      await wait(300);
    }
    if (!splat) return { __err: 'splat import failed' };
    for (let i = 0; i < 80; i++) {
      if (splat.localBound && splat.localBound.halfExtents.length() > 0 && splat.densityValid) break;
      await wait(300);
    }
    await wait(600);

    scene.events.invoke('selection', splat);
    await wait(900);

    const density = splat.densityCenter.clone();
    const aabb = splat.localBound.center.clone();
    const rsc = D.anchorPivotToCenter();
    await wait(1000);

    res.density = {
      ret: rsc,
      densityCenter: round(density),
      aabbCenter: round(aabb),
      localFrameOrigin: round(splat.localFrameOrigin),
      matchesDensity: near(splat.localFrameOrigin, density, 0.01),
      differsFromAabb: !near(density, aabb, 0.02),
      markerPos: round(marker.getLocalPosition())
    };
    res.req4 = res.density.ret === 'ok' && res.density.matchesDensity === true;

    res.pass = res.req1 === true
            && res.req2 === true
            && res.req3 === true
            && res.req4 === true
            && res.afterCursor.followed === true;
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
