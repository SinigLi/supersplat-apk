/* probe-v26.mjs — v26 验收
 *
 * 需求 1：GLB / PLY 选中时也有黄色原点标记（此前只有人偶有）
 * 需求 2：泼溅也能设基准点（此前按钮返回 no-selection，看起来失效）
 * 需求 3：新增「重设基准点」按钮，回到模型原点
 *
 * 泼溅用 spike/glb-load-test/splat.ply（4.7MB，仓库里唯一的泼溅资产）。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4282;
const CDP = 9342;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
    '--use-angle=d3d11', '--window-size=390,844',
    `--user-data-dir=${process.env.TEMP}/edge-v26-${Date.now()}`,
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
    const pivotPos = () => scene.events.invoke('pivot').transform.position;
    const yellowVisible = (ent) => {
      // the selection dot is a child render entity of ent
      let hit = null;
      ent.findComponents('render').forEach(rc => {
        if (!rc.entity || rc.entity === ent) return;
        const n = rc.entity.name || '';
        if (/marker/i.test(n)) hit = rc.entity;
      });
      return hit ? !!hit.enabled : null;
    };
    const splatMarkerState = () => {
      const m = scene.app.root.findByName('splat-marker');
      return m ? { enabled: m.enabled, pos: m.enabled ? round(m.getLocalPosition()) : null } : null;
    };

    // ---------- 需求 1a：GLB 选中时有黄点 ----------
    scene.events.fire('tool.move');
    await wait(500);

    const r1 = await fetch('./static/director/tuxedo.glb');
    const b1 = await r1.arrayBuffer();
    D.importModel(new File([b1], 'v26-prop.glb', { type: 'model/gltf-binary' }));
    for (let i = 0; i < 100; i++) { if (D.listProps().length) break; await wait(250); }
    const pr = D.listProps().slice(-1)[0];
    const pent = scene.app.root.findByName(pr.name);
    D.selectPropById(null); await wait(300);
    D.selectPropById(pr.id); await wait(700);

    res.propMarker = {
      found: pent ? yellowVisible(pent) : null,
      deselected: null
    };
    // 取消选中后应当隐藏
    D.selectPropById(null); await wait(500);
    res.propMarker.deselected = pent ? yellowVisible(pent) : null;
    D.selectPropById(pr.id); await wait(600);

    // ---------- 需求 1b：人偶黄点仍然在（回归） ----------
    D.addPuppet();
    for (let i = 0; i < 120; i++) { if (D.listPuppets().length) break; await wait(250); }
    await wait(900);
    const pup = D.listPuppets().slice(-1)[0];
    const pupent = scene.app.root.findByName(pup.name);
    res.puppetMarker = {
      found: pupent ? yellowVisible(pupent) : null,
      selectedInList: pup && pup.selected
    };

    // ---------- 需求 2：泼溅基准点 ----------
    const r2 = await fetch('../spike/glb-load-test/splat.ply');
    if (!r2.ok) return { __err: 'ply fetch failed ' + r2.status };
    const b2 = await r2.arrayBuffer();
    scene.events.invoke('import', [{ filename: 'v26.ply', contents: new Blob([b2]) }]);

    let splat = null;
    for (let i = 0; i < 200; i++) {
      const sels = scene.getElementsByType('splat');
      if (sels.length) { splat = sels[sels.length - 1]; break; }
      await wait(300);
    }
    if (!splat) return { __err: 'splat import failed' };
    // 让边界算出来
    for (let i = 0; i < 60; i++) { if (splat.localBound && splat.localBound.halfExtents.length() > 0) break; await wait(300); }
    await wait(800);

    // 选中泼溅（SS 原生管线）
    scene.events.invoke('selection', splat);
    await wait(900);

    res.splatSelected = {
      isSelection: scene.events.invoke('selection') === splat,
      localFrameOrigin: round(splat.localFrameOrigin),
      localBoundCenter: round(splat.localBound.center)
    };

    // 需求 1c：泼溅选中时 splay 标记出现
    res.splatMarkerShown = splatMarkerState();

    // 需求 2a：设中心点
    const rc = D.anchorPivotToCenter();
    await wait(900);
    res.splatCenter = {
      ret: rc,
      localFrameOrigin: round(splat.localFrameOrigin),
      pivot: round(pivotPos()),
      marker: splatMarkerState()
    };
    res.req2a = res.splatCenter.ret === 'ok'
             && near(splat.localFrameOrigin, splat.localBound.center, 0.01);

    // 需求 2b：设到游标
    D.armPlaceCursor(); await wait(200);
    D.placeCursor(vec(1.5, 2.0, -1.0)); await wait(500);
    const rcur = D.anchorPivotToCursor();
    await wait(900);

    // 注意：localFrameOrigin 是实体局部空间，而 PLY 加载后绕 Z 轴转了 180°
    // （已知约束），所以局部值和游标世界坐标差一个 180° 旋转，(x,y) 取反。
    // 真正该验的是 pivot 的世界坐标落在游标处。
    const cursorWorld = scene.app.root.findByName('director-cursor').getLocalPosition().clone();
    const pivAfterCursor = pivotPos().clone();
    res.splatCursor = {
      ret: rcur,
      localFrameOrigin: round(splat.localFrameOrigin),
      cursorWorld: round(cursorWorld),
      pivotWorld: round(pivAfterCursor),
      marker: splatMarkerState()
    };
    res.req2b = res.splatCursor.ret === 'ok'
             && near(pivAfterCursor, cursorWorld, 0.06)
             && res.splatCursor.marker && res.splatCursor.marker.enabled === true
             && near(res.splatCursor.marker.pos, cursorWorld, 0.06);

    // 需求 3：重设基准点回到原点
    const rre = D.resetPivot();
    await wait(900);
    res.splatReset = {
      ret: rre,
      localFrameOrigin: round(splat.localFrameOrigin),
      pivot: round(pivotPos())
    };
    res.req3splat = res.splatReset.ret === 'ok'
                 && splat.localFrameOrigin.length() < 1e-4;

    // ---------- 需求 3：人偶/道具的重设 ----------
    // 先给人偶设个中心点，再重设
    D.selectPuppetById(pup.id); await wait(700);
    const pvBefore = pivotPos().clone();
    D.anchorPivotToCenter(); await wait(800);
    const pvCentered = pivotPos().clone();
    const rre2 = D.resetPivot(); await wait(900);
    res.puppetReset = {
      ret: rre2,
      centeredAt: round(pvCentered),
      backTo: round(pivotPos()),
      entityPos: round(pupent.getLocalPosition()),
      returnedToOrigin: near(pivotPos(), pupent.getLocalPosition(), 0.02)
    };
    res.req3puppet = res.puppetReset.ret === 'ok' && res.puppetReset.returnedToOrigin;

    // 面板里三个按钮
    res.anchorButtons = document.querySelectorAll('.sd-anchor-btn').length;

    res.pass = res.propMarker.found === true
            && res.propMarker.deselected === false
            && res.puppetMarker.found === true
            && res.splatMarkerShown && res.splatMarkerShown.enabled === true
            && res.req2a === true
            && res.req2b === true
            && res.req3splat === true
            && res.req3puppet === true
            && res.anchorButtons === 3;
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
