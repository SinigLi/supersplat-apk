/* probe-v25.mjs — v25 验收
 *
 * 需求 1：开启变换后用「移动到游标」，方向坐标系必须跟着模型走
 *   - 旧行为：只挪实体，pivot 留在原地 → gizmo 和模型分离
 *   - 新行为：实体 + pivot 同一条撤销记录一起移动，一次 undo 全还原
 *
 * 需求 2：定位分组两个按钮重设基准点
 *   - anchorPivotToCenter(): 基准点 → 模型包围盒中心
 *   - anchorPivotToCursor(): 基准点 → 3D 游标位置
 *   - 必须"真的生效"：绕新基准点旋转时，模型要绕着那个点转
 *
 * 另外验证 定位 面板里确实存在两个按钮。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('.');
const PORT = 4281;
const CDP = 9341;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--enable-unsafe-webgpu',
    '--use-angle=d3d11', '--window-size=390,844',
    `--user-data-dir=${process.env.TEMP}/edge-v25-${Date.now()}`,
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
    const res = { steps: [] };
    if (!D) return { __err: 'no __director' };

    const Vec3 = scene.camera.focalPoint.constructor;
    const vec = (x, y, z) => new Vec3(x, y, z);
    const round = v => ({ x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(3) });
    const near = (a, b, eps = 0.06) =>
      Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.z - b.z) < eps;

    const pivotPos = () => scene.events.invoke('pivot').transform.position;
    const gizmoPos = () => {
      const g = scene.app.root.findByName('gizmoPivot');
      return g ? g.getLocalPosition() : null;
    };

    // 变换处理器要先激活工具才会有 selection 绑定
    scene.events.fire('tool.move');
    await wait(600);

    // 导入模型（v24 起自动选中）
    const resp = await fetch('./static/director/tuxedo.glb');
    const buf = await resp.arrayBuffer();
    D.importModel(new File([buf], 'v25-prop.glb', { type: 'model/gltf-binary' }));
    for (let i = 0; i < 100; i++) {
      if (D.listProps().length > 0) break;
      await wait(250);
    }
    const props = D.listProps();
    if (!props.length) return { __err: 'import failed' };
    const pr = props[props.length - 1];
    const ent = scene.app.root.findByName(pr.name);
    res.entityFound = !!ent;
    if (!ent) return { __err: 'entity not found' };

    // 归零 + 干净重选（重复选中不会重算 pivot）
    ent.setLocalPosition(0, 0, 0);
    D.selectPropById(null);
    await wait(300);
    D.selectPropById(pr.id);
    await wait(700);

    const startPivot = pivotPos().clone();
    res.baseline = { pivot: round(startPivot), gizmo: gizmoPos() ? round(gizmoPos()) : null };

    // ---------- 需求 1：移动到游标 ----------
    D.armPlaceCursor();
    await wait(200);
    D.placeCursor(vec(4, 0, 0));
    await wait(400);

    const r1 = D.moveSelectedToCursor();
    await wait(800);

    const entAfter = ent.getLocalPosition().clone();
    const pivAfter = pivotPos().clone();
    res.moveToCursor = {
      ret: r1,
      entity: round(entAfter),
      pivot: round(pivAfter),
      gizmo: gizmoPos() ? round(gizmoPos()) : null,
      entityAtCursor: near(entAfter, vec(4, 0, 0)),
      pivotFollowed: near(pivAfter, entAfter),
      gizmoFollowed: gizmoPos() ? near(gizmoPos(), entAfter) : false
    };
    res.req1 = res.moveToCursor.ret === 'ok'
            && res.moveToCursor.entityAtCursor
            && res.moveToCursor.pivotFollowed;

    // 撤销：实体与 pivot 一起回原点
    scene.events.fire('edit.undo');
    await wait(1000);
    res.undo = {
      entity: round(ent.getLocalPosition()),
      pivot: round(pivotPos()),
      bothRestored: near(ent.getLocalPosition(), vec(0, 0, 0)) && near(pivotPos(), vec(0, 0, 0))
    };
    scene.events.fire('edit.redo');
    await wait(1000);

    // ---------- 需求 2a：基准点 → 外边中心 ----------
    // 先取模型世界包围盒，作为“外边中心”的参照
    const min = new Vec3(Infinity, Infinity, Infinity);
    const max = new Vec3(-Infinity, -Infinity, -Infinity);
    let anyBox = false;
    (ent.findComponents('render') || []).forEach(rc => {
      if (!rc.entity || !rc.entity.enabled) return;
      (rc.meshInstances || []).forEach(mi => {
        if (!mi || mi.visible === false || !mi.aabb) return;
        const a = mi.aabb;
        min.x = Math.min(min.x, a.center.x - a.halfExtents.x);
        min.y = Math.min(min.y, a.center.y - a.halfExtents.y);
        min.z = Math.min(min.z, a.center.z - a.halfExtents.z);
        max.x = Math.max(max.x, a.center.x + a.halfExtents.x);
        max.y = Math.max(max.y, a.center.y + a.halfExtents.y);
        max.z = Math.max(max.z, a.center.z + a.halfExtents.z);
        anyBox = true;
      });
    });

    const r2 = D.anchorPivotToCenter();
    await wait(800);
    const pivCenter = pivotPos().clone();
    const boxCenter = anyBox
      ? vec((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2)
      : null;

    // 判定：基准点真的离开实体原点，并且落在包围盒内部
    const insideBox = anyBox
      ? (pivCenter.x >= min.x - 0.05 && pivCenter.x <= max.x + 0.05 &&
         pivCenter.y >= min.y - 0.05 && pivCenter.y <= max.y + 0.05 &&
         pivCenter.z >= min.z - 0.05 && pivCenter.z <= max.z + 0.05)
      : null;

    res.anchorCenter = {
      ret: r2,
      pivot: round(pivCenter),
      boxCenter: boxCenter ? round(boxCenter) : null,
      matchesBoxCenter: boxCenter ? near(pivCenter, boxCenter, 0.08) : null,
      insideBox,
      movedAwayFromOrigin: !near(pivCenter, ent.getLocalPosition(), 0.02),
      entityUnmoved: near(ent.getLocalPosition(), vec(4, 0, 0))
    };
    res.req2a = res.anchorCenter.ret === 'ok'
             && res.anchorCenter.entityUnmoved
             && res.anchorCenter.insideBox === true
             && res.anchorCenter.movedAwayFromOrigin === true
             && res.anchorCenter.matchesBoxCenter === true;

    // ---------- 需求 2b：基准点 → 游标点 ----------
    // 故意放一个明显偏离中心的点，后面好验证“绕点旋转”
    D.placeCursor(vec(4, 1.2, 0));
    await wait(500);
    const r3 = D.anchorPivotToCursor();
    await wait(800);

    res.anchorCursor = {
      ret: r3,
      pivot: round(pivotPos()),
      cursor: { x: 4, y: 1.2, z: 0 },
      matches: near(pivotPos(), vec(4, 1.2, 0), 0.08),
      entityUnmoved: near(ent.getLocalPosition(), vec(4, 0, 0))
    };
    res.req2b = res.anchorCursor.ret === 'ok'
             && res.anchorCursor.matches
             && res.anchorCursor.entityUnmoved;

    // ---------- 关键：绕新基准点旋转 ----------
    // 基准点 (4,1.2,0)，模型原点 (4,0,0)，相对偏移 (0,-1.2,0)
    // 绕 Z 轴 90°: (0,-1.2,0) -> (1.2,0,0)，模型原点应到 (5.2,1.2,0)
    const pivot = scene.events.invoke('pivot');
    const TransformClass = pivot.transform.constructor;
    const QuatClass = pivot.transform.rotation.constructor;

    const startPos = pivot.transform.position.clone();
    const startScale = pivot.transform.scale.clone();
    const q = new QuatClass();
    q.setFromEulerAngles(0, 0, 90);

    pivot.start();
    pivot.move(new TransformClass(startPos, q, startScale));
    pivot.end();
    await wait(1000);

    res.rotateAroundAnchor = {
      entity: round(ent.getLocalPosition()),
      expected: { x: 5.2, y: 1.2, z: 0 },
      orbitedAroundPivot: near(ent.getLocalPosition(), vec(5.2, 1.2, 0), 0.15)
    };
    res.req2c = res.rotateAroundAnchor.orbitedAroundPivot;

    // ---------- 定位面板里的按钮确实存在 ----------
    // v26 在定位组加了第三个按钮（重设基准点），所以这里是 3 而不是 2
    res.anchorButtons = document.querySelectorAll('.sd-anchor-btn').length;

    res.pass = res.req1 === true
            && res.req2a === true
            && res.req2b === true
            && res.req2c === true
            && res.undo.bothRestored === true
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
