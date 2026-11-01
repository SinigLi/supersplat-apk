/* tests/probe-v39.mjs - v39 八条反馈探针
 *
 * 老板 2026-11-01 08:53/09:19 两批反馈：
 *   #1 停靠钳位避让系统栏（viewport-fit=cover + safeTopPx 探针元素）
 *   #2 视口组注释置顶、模式四钮其下
 *   #3 数值块双击编辑 + 按住拖动（单击不再触发）
 *   #4 菜单栏默认停靠左上角（左侧栏上部）
 *   #5 机位视角模式：进入/退出保存/恢复默认=进入时参数/手势锁提醒/实时生效
 *   #6 机位与视口编辑可撤销
 *   #7 三轴步进旋转（水平/俯仰/倾斜 ±，默认 3°）
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('www');
const PORT = 4203;
const CDP = 9263;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getWs() {
    for (let i = 0; i < 60; i++) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
            const page = list.find(t => t.type === 'page');
            if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
        } catch { /* 还没起来 */ }
        await sleep(500);
    }
    throw new Error('CDP not ready');
}

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + path.join(process.env.TEMP, 'edge_v39_profile'),
    '--enable-unsafe-webgpu', '--use-angle=d3d11', '--window-size=390,844',
    `http://127.0.0.1:${PORT}/index.html`
], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
const logs = [];

function send(method, params = {}) {
    return new Promise((resolve, reject) => {
        const msgId = ++id;
        pending.set(msgId, { resolve, reject });
        ws.send(JSON.stringify({ id: msgId, method, params }));
    });
}

async function evalJs(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result?.value;
}

const results = [];
const check = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

async function waitFor(expr, tries = 60, gap = 400) {
    for (let i = 0; i < tries; i++) {
        if (await evalJs(expr).catch(() => false)) return true;
        await sleep(gap);
    }
    return false;
}

// 拖动数值块：按住 300ms（>260 阈值）后横移 dx 再松手
async function dragBlock(sel, dx) {
    return evalJs(`(async () => {
        const el = document.querySelector('${sel}');
        if (!el) return { ok: false, why: 'no-dom' };
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.x + r.width / 2) || 40, cy = Math.round(r.y + r.height / 2) || 40;
        el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, clientX: cx, clientY: cy, bubbles: true }));
        await new Promise(r2 => setTimeout(r2, 300));
        el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: cx + ${dx}, clientY: cy, bubbles: true }));
        await new Promise(r2 => setTimeout(r2, 40));
        el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: cx + ${dx}, clientY: cy, bubbles: true }));
        await new Promise(r2 => setTimeout(r2, 150));
        return { ok: true };
    })()`);
}

try {
    ws = new WebSocket(await getWs());
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.method === 'Runtime.exceptionThrown') logs.push(String(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || 'EXC'));
        if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result ?? m); pending.delete(m.id); }
    };
    await send('Page.enable');
    check('editor ready', await waitFor('!!window.scene', 100, 500));
    check('director ready', await waitFor('!!window.__director && !!window.__directorEvents', 60, 500));
    check('dock ready', await waitFor('document.body.classList.contains("sd-docks-ready")', 60, 500));

    // 清场
    await evalJs(`(() => { const d = window.__director;
        d.listShots().slice().forEach(s => d.removeShot(s.id));
        d.setClipRange({ enabled: false });
        return true; })()`);

    // ---- #1 + #4：静态标记（viewport-fit/钳位/左上停靠）+ 菜单栏实际位置 ----
    const statics = await evalJs(`(async () => {
        const html = await fetch('/index.html').then(r => r.text());
        const js = await fetch('/dock.js').then(r => r.text());
        return {
            cover: html.includes('viewport-fit=cover'),
            safeTopRefs: (js.match(/safeTopPx\\(/g) || []).length,
            menuLeft: js.includes("label:'菜单', pos:'left'")
        };
    })()`);
    check('#1 viewport-fit=cover + safeTopPx clamps',
        statics.cover === true && statics.safeTopRefs >= 4, JSON.stringify(statics));
    const menuPos = await evalJs(`(() => {
        const el = document.querySelector('.sd-dock[data-dock="file"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { cls: el.className.includes('sd-left'), left: +r.left.toFixed(1), top: +r.top.toFixed(1) };
    })()`);
    check('#4 menu dock defaults to left-top corner',
        menuPos && menuPos.cls === true && menuPos.left < 60 && menuPos.top < 120, JSON.stringify(menuPos));

    // ---- #2：视口组注释置顶、模式钮其下 ----
    const vpOrder = await evalJs(`(() => {
        const w = document.querySelector('.sd-vp-panel');
        if (!w) return null;
        return { first: w.firstElementChild.className,
                 second: w.children[1] ? w.children[1].className : null,
                 adopted: w.querySelectorAll('.sd-vp-modes .sd-adopted').length };
    })()`);
    check('#2 viewport: hint first, modes row second, 4 adopted',
        vpOrder && /sd-dir-hint/.test(vpOrder.first) && /sd-vp-modes/.test(vpOrder.second) && vpOrder.adopted === 4,
        JSON.stringify(vpOrder));

    // ---- #3：单击不编辑、双击编辑、按住拖动生效 ----
    const openVp = await evalJs(`(() => {
        const dock = document.querySelector('.sd-dock[data-dock="view"]');
        const g = Array.from(dock.querySelectorAll('.sd-grp-btn')).find(b => (b.querySelector('.sd-name') || {}).textContent === '视口');
        if (g) g.click();
        return true;
    })()`);
    await sleep(600);
    const dbl = await evalJs(`(async () => {
        const el = document.querySelector('#vp-foc');
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.x + r.width / 2) || 40, cy = Math.round(r.y + r.height / 2) || 40;
        const tap = (t, px, py, pid) => el.dispatchEvent(new PointerEvent(t, { pointerId: pid, clientX: px, clientY: py, bubbles: true }));
        // 单击一次：不应进入编辑
        tap('pointerdown', cx, cy, 3); await new Promise(r2 => setTimeout(r2, 60));
        tap('pointerup', cx, cy, 3); await new Promise(r2 => setTimeout(r2, 120));
        const afterSingle = el.classList.contains('sd-dv-edit');
        // 320ms 内第二击：应进入编辑
        tap('pointerdown', cx, cy, 4); await new Promise(r2 => setTimeout(r2, 60));
        tap('pointerup', cx, cy, 4); await new Promise(r2 => setTimeout(r2, 60));
        tap('pointerdown', cx, cy, 5); await new Promise(r2 => setTimeout(r2, 60));
        const afterDouble = el.classList.contains('sd-dv-edit');
        const focused = document.activeElement === el.querySelector('.sd-dv-in');
        el.querySelector('.sd-dv-in').blur();   // 收起（blur 还原）
        await new Promise(r2 => setTimeout(r2, 60));
        return { afterSingle, afterDouble, focused };
    })()`);
    check('#3 single tap no-edit; double tap edits',
        dbl.afterSingle === false && dbl.afterDouble === true && dbl.focused === true, JSON.stringify(dbl));
    const dragFoc = await evalJs(`(() => { const vi = window.__director.getViewportInfo(); return Math.round(vi.focal); })()`);
    await dragBlock('#vp-foc', 30);
    const dragFoc2 = await evalJs(`(() => { const vi = window.__director.getViewportInfo(); return Math.round(vi.focal); })()`);
    check('#3 hold-drag still works after single/double-tap change',
        Math.abs(dragFoc2 - dragFoc) > 40, `before=${dragFoc} after=${dragFoc2}`);

    // ---- #6a：视口焦距编辑可撤销（edit.undo 走异步队列，读值前等一拍） ----
    const undoVp = await evalJs(`(async () => {
        const d = window.__director, E = window.__directorEvents;
        const f0 = d.getViewportInfo().focal;
        d.setViewportFocal(200);
        const f1 = d.getViewportInfo().focal;
        E.fire('edit.undo');
        await new Promise(r => setTimeout(r, 200));
        const f2 = d.getViewportInfo().focal;
        return { f0: Math.round(f0), f1: Math.round(f1), f2: Math.round(f2) };
    })()`);
    check('#6 viewport focal edit is undoable',
        Math.abs(undoVp.f1 - 200) < 6 && Math.abs(undoVp.f2 - undoVp.f0) < 6, JSON.stringify(undoVp));

    // ---- #5：机位视角模式全流程 ----
    const view = await evalJs(`(async () => {
        const d = window.__director, E = window.__directorEvents;
        const s = d.addShot();
        d.renameShot(s.id, '视角机A');
        // 固定一个已知机位姿态
        d.updateShot(s.id, { focal: 80 });
        d.rotateShotAxis(s.id, 'yaw', 30);
        const rec = d.listShots().find(x => x.id === s.id);
        // 进入视角
        const r1 = d.enterShotView(s.id);
        await new Promise(r2 => setTimeout(r2, 400));   // 等一帧应用 poseOverride
        const cam = window.scene.camera.mainCamera.getPosition();
        const pinned = Math.hypot(cam.x - rec.pos[0], cam.y - rec.pos[1], cam.z - rec.pos[2]) < 0.05;
        const viewId = d.getShotViewId();
        // 模式内改焦距：立即反映到相机 fov（poseOverride.fov）
        d.updateShot(s.id, { focal: 120 });
        await new Promise(r2 => setTimeout(r2, 200));
        const fovLive = window.scene.camera.fov;
        const recLive = d.listShots().find(x => x.id === s.id);
        // 手势锁：pointerdown 被吞 + 提醒事件
        let blocked = false;
        const h = () => { blocked = true; };
        document.addEventListener('director-shotview-blocked', h);
        const container = document.getElementById('canvas-container');
        container.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 21, clientX: 100, clientY: 200, bubbles: true }));
        await new Promise(r2 => setTimeout(r2, 80));
        document.removeEventListener('director-shotview-blocked', h);
        // 恢复默认 = 回进入时参数（focal 80）
        d.resetShot(s.id);
        await new Promise(r2 => setTimeout(r2, 150));
        const recReset = d.listShots().find(x => x.id === s.id);
        // 退出前再改一次，让退出保存真正产生差异（#6b 撤销验证用）
        d.updateShot(s.id, { focal: 140 });
        // 退出保存 + 视口还原
        const exitR = d.exitShotView(true);
        await new Promise(r2 => setTimeout(r2, 200));
        const recExit = d.listShots().find(x => x.id === s.id);
        return { r1, pinned, viewId, fovLive: Math.round(fovLive), recLiveFocal: Math.round(recLive.focal),
                 blocked, resetFocal: Math.round(recReset.focal), resetRoll: recReset.roll,
                 exitR, exitFocal: Math.round(recExit.focal), exitViewId: d.getShotViewId() };
    })()`);
    check('#5 enter pins camera to shot pose',
        view.r1 === 'ok' && view.pinned === true && view.viewId > 0, JSON.stringify(view));
    check('#5 live edit: focal 120 applies to pinned camera fov',
        Math.abs(view.fovLive - 2 * Math.atan((50 * Math.tan(85 * Math.PI / 360)) / 120) * 180 / Math.PI) < 1.5,
        `fovLive=${view.fovLive}`);
    check('#5 free-camera gesture swallowed + reminder fired',
        view.blocked === true, JSON.stringify(view.blocked));
    check('#5 resetShot returns to enter-time params (focal 80, roll 0)',
        Math.abs(view.resetFocal - 80) < 0.5 && view.resetRoll === 0,
        `focal=${view.resetFocal} roll=${view.resetRoll}`);
    check('#5 exit saves adjusted params + leaves view mode',
        view.exitR === 'ok' && view.exitViewId === 0 && Math.abs(view.exitFocal - 140) < 0.5,
        `exitR=${view.exitR} focal=${view.exitFocal}`);

    // ---- #6b：退出保存的机位参数可撤销（undo → 回进入时 80；redo → 回 140） ----
    const undoShot = await evalJs(`(async () => {
        const d = window.__director, E = window.__directorEvents;
        const s = d.listShots()[0];
        const before = Math.round(s.focal);
        E.fire('edit.undo');   // 撤销退出保存那步
        await new Promise(r => setTimeout(r, 200));
        const s2 = d.listShots().find(x => x.id === s.id);
        const after = Math.round(s2.focal);
        E.fire('edit.redo');
        await new Promise(r => setTimeout(r, 200));
        const s3 = d.listShots().find(x => x.id === s.id);
        return { before, after, redone: Math.round(s3.focal) };
    })()`);
    check('#6 exit-save is undoable/redoable',
        undoShot.after !== undoShot.before && undoShot.redone === undoShot.before, JSON.stringify(undoShot));

    // ---- #7：三轴步进旋转 ----
    const rot = await evalJs(`(() => {
        const d = window.__director;
        const s = d.listShots()[0];
        const yawOf = r => Math.atan2(r.target[0] - r.pos[0], r.target[2] - r.pos[2]) * 180 / Math.PI;
        const pitchOf = r => Math.atan2(r.target[1] - r.pos[1], Math.hypot(r.target[0] - r.pos[0], r.target[2] - r.pos[2])) * 180 / Math.PI;
        const y0 = yawOf(s), p0 = pitchOf(s), roll0 = s.roll;
        d.rotateShotAxis(s.id, 'yaw', 3);
        d.rotateShotAxis(s.id, 'pitch', 3);
        d.rotateShotAxis(s.id, 'roll', 3);
        const s1 = d.listShots().find(x => x.id === s.id);
        const dy = yawOf(s1) - y0, dp = pitchOf(s1) - p0, dr = s1.roll - roll0;
        // 俯仰钳位边界
        for (let i = 0; i < 40; i++) d.rotateShotAxis(s.id, 'pitch', -3);
        const s2 = d.listShots().find(x => x.id === s.id);
        return { dy: +dy.toFixed(2), dp: +dp.toFixed(2), dr: +dr.toFixed(2), pitchClamped: pitchOf(s2) >= -89 };
    })()`);
    check('#7 stepped yaw/pitch/roll (+3° each, pitch clamps)',
        Math.abs(rot.dy - 3) < 0.2 && Math.abs(rot.dp - 3) < 0.2 && Math.abs(rot.dr - 3) < 0.01 && rot.pitchClamped,
        JSON.stringify(rot));

    // ---- 面板 UI：横幅/退出按钮/门控置灰（进视角后） ----
    const uiGate = await evalJs(`(async () => {
        const d = window.__director;
        const dock = document.querySelector('.sd-dock[data-dock="view"]');
        const g = Array.from(dock.querySelectorAll('.sd-grp-btn')).find(b => (b.querySelector('.sd-name') || {}).textContent === '机位');
        if (g) g.click();
        await new Promise(r => setTimeout(r, 300));
        const w = document.querySelector('.sd-shot-panel');
        const d2 = window.__director;
        d2.enterShotView(d2.listShots()[0].id);
        await new Promise(r => setTimeout(r, 250));
        const bannerVisible = !w.querySelector('[data-shot="viewbanner"]').hidden;
        const goText = w.querySelector('[data-shot="goto"]').textContent;
        const svOff = w.querySelector('#sv-foc').classList.contains('sd-off');
        // 退出（按钮路径）
        w.querySelector('[data-shot="goto"]').click();
        await new Promise(r => setTimeout(r, 200));
        const goText2 = w.querySelector('[data-shot="goto"]').textContent;
        const bannerHidden2 = w.querySelector('[data-shot="viewbanner"]').hidden;
        return { bannerVisible, goText, svOff, goText2, bannerHidden2 };
    })()`);
    check('#5 UI: banner shows, goto flips to exit, gate unlocks in view',
        uiGate.bannerVisible === true && /退出/.test(uiGate.goText) && uiGate.svOff === false &&
        /查看/.test(uiGate.goText2) && uiGate.bannerHidden2 === true, JSON.stringify(uiGate));

    // ---- 无异常 ----
    const errs = logs.filter(l => /EXC|Uncaught|Cannot read|is not a function/.test(l));
    check('no runtime exceptions', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
    console.error('TEST ERROR:', e.message);
} finally {
    const failed = results.filter(r => !r.ok).length;
    console.log(`\n=== ${results.length - failed}/${results.length} passed ===`);
    try { ws?.close(); } catch {}
    edge.kill();
    srv.kill();
    setTimeout(() => process.exit(failed ? 1 : 0), 300);
}
