/* tests/probe-v38.mjs - v38 相机面板重排实装探针
 *
 * 老板 2026-11-01 定稿（prototype/cam-panel-proto.html v5）：
 *   1. 视口组（全局相机实时参数）：模式四钮收养在面板顶部，裁剪近/远 + 焦距数值块
 *      （单击就地编辑 + 长按拖动粗调），恢复默认（自动裁剪 + 焦距 50mm），底部只读参数信息
 *   2. 机位组：每机位独立裁剪/焦距（updateShot），步进移动六钮（nudgeShot），
 *      旋转角输入（rotateShot），恢复默认（resetShot 回保存值），新增/重定位含裁剪焦距
 *   3. 引擎：Shot 加 clip/base 字段，gotoShot 应用机位裁剪，旧存档兼容（无 clip = 自动）
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve('www');
const PORT = 4202;
const CDP = 9262;
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
    '--user-data-dir=' + path.join(process.env.TEMP, 'edge_v38_profile'),
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

// 与引擎一致：50mm ↔ 85°（编辑器默认视口）
const FOCAL_REF = 50 * Math.tan(85 * Math.PI / 360);
const focalToFov = mm => 2 * Math.atan(FOCAL_REF / Math.min(500, Math.max(1, mm))) * 180 / Math.PI;

// 数值块拖动：按住 300ms 后横移 dx 再松手（引擎 commit 路径）
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
        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map(a => a.value).join(' '));
        if (m.method === 'Runtime.exceptionThrown') logs.push(String(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || 'EXC'));
        if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result ?? m); pending.delete(m.id); }
    };
    await send('Page.enable');
    check('editor ready', await waitFor('!!window.scene', 100, 500));
    check('director ready', await waitFor('!!window.__director', 60, 500));
    check('dock ready', await waitFor('document.body.classList.contains("sd-docks-ready")', 60, 500));

    // 清场：删掉历史机位，从干净状态测
    await evalJs(`(() => { const d = window.__director;
        d.listShots().slice().forEach(s => d.removeShot(s.id)); return true; })()`);
    // 视口回自动裁剪（前序套件可能留了手动值）
    await evalJs(`(() => { const d = window.__director; d.setClipRange({ enabled: false }); return true; })()`);

    // ---- 1) 右栏分组：视口/机位/设置/定位（相机组更名退役） ----
    const groups = await evalJs(`(() => {
        const dock = document.querySelector('.sd-dock[data-dock="view"]');
        return dock ? Array.from(dock.querySelectorAll('.sd-name')).map(e => e.textContent) : null;
    })()`);
    check('view dock groups = 视口/机位/设置/定位',
        JSON.stringify(groups) === JSON.stringify(['视口', '机位', '设置', '定位']), JSON.stringify(groups));

    // ---- 2) 视口面板结构：模式四钮收养 + 数值块三件套 + 恢复默认 + 参数信息 ----
    const vp = await evalJs(`(() => {
        const w = document.querySelector('.sd-vp-panel');
        if (!w) return null;
        const modes = w.querySelector('.sd-vp-modes');
        return {
            adopted: modes ? modes.querySelectorAll('.sd-adopted').length : -1,
            near: !!w.querySelector('#vp-near'), far: !!w.querySelector('#vp-far'), foc: !!w.querySelector('#vp-foc'),
            state: (w.querySelector('[data-vp="state"]') || {}).textContent,
            restore: !!w.querySelector('[data-vp="restore"]'),
            pos: !!w.querySelector('[data-vp="pos"]'), rot: !!w.querySelector('[data-vp="rot"]'),
            slidersGone: !w.querySelector('.sd-clip-slider')
        };
    })()`);
    check('viewport panel: 4 mode btns + 3 value blocks + restore + info',
        !!vp && vp.adopted === 4 && vp.near && vp.far && vp.foc && vp.restore && vp.pos && vp.rot && vp.slidersGone,
        JSON.stringify(vp));

    // ---- 3) 视口焦距拖动：引擎 fov 跟着换算 ----
    const fovBefore = await evalJs(`window.scene.camera.fov`);
    await dragBlock('#vp-foc', 40);   // +40px ≈ +80mm → 130mm
    const foc1 = await evalJs(`(() => { const vi = window.__director.getViewportInfo(); return { focal: vi.focal, fov: window.scene.camera.fov }; })()`);
    check('viewport focal drag -> engine fov converted (130mm)',
        foc1 && Math.abs(foc1.focal - 130) < 15 && Math.abs(foc1.fov - focalToFov(130)) < 2.5,
        `before=${fovBefore} after=${JSON.stringify(foc1)} want=${focalToFov(130).toFixed(1)}`);

    // ---- 4) 视口近裁剪拖动：先展开视口面板（同步自动值）再拖，进手动模式且值变化 ----
    await evalJs(`(() => {
        const dock = document.querySelector('.sd-dock[data-dock="view"]');
        const g = Array.from(dock.querySelectorAll('.sd-grp-btn')).find(b => (b.querySelector('.sd-name') || {}).textContent === '视口');
        if (g) g.click();
        return true;
    })()`);
    await new Promise(r => setTimeout(r, 700));   // 等 300ms 同步拍把自动值灌进面板
    const clip1 = await evalJs(`window.__director.getClipRange()`);
    await dragBlock('#vp-near', 60);
    const clip2 = await evalJs(`window.__director.getClipRange()`);
    check('viewport near drag -> manual clip enabled + changed',
        clip2.enabled === true && clip2.near > clip1.near * 1.5,
        `before=${JSON.stringify(clip1)} after=${JSON.stringify(clip2)}`);

    // ---- 5) 恢复默认：裁剪回自动 + 焦距回 50mm（fov 85） ----
    await evalJs(`document.querySelector('[data-vp="restore"]').click()`);
    await new Promise(r => setTimeout(r, 150));
    const vpReset = await evalJs(`(() => {
        const d = window.__director;
        return { clip: d.getClipRange(), fov: window.scene.camera.fov,
                 pill: document.querySelector('[data-vp="state"]').textContent };
    })()`);
    check('viewport restore default: auto clip + focal 50 (fov 85)',
        vpReset.clip.enabled === false && Math.abs(vpReset.fov - 85) < 1 && vpReset.pill === '自动',
        JSON.stringify(vpReset));

    // ---- 6) 新增机位吸收当前裁剪/焦距；updateShot 改机位自己的值 ----
    const shotFlow = await evalJs(`(async () => {
        const d = window.__director;
        // 先设一个已知手动裁剪，再新增机位
        d.setClipRange({ enabled: true, near: 0.5, far: 60 });
        const s = d.addShot();
        const rec1 = d.listShots().find(x => x.id === s.id);
        const okMirror = rec1 && rec1.clip && Math.abs(rec1.clip.near - 0.5) < 0.01 && Math.abs(rec1.clip.far - 60) < 0.01;
        // 改机位自己的焦距/裁剪（不动视口）
        d.updateShot(s.id, { focal: 100 });
        d.updateShot(s.id, { clip: { near: 0.2, far: 30 } });
        const rec2 = d.listShots().find(x => x.id === s.id);
        const vpFov = window.scene.camera.fov;   // 视口 fov 不应被 updateShot 改动
        // 恢复默认（回保存值）
        d.resetShot(s.id);
        const rec3 = d.listShots().find(x => x.id === s.id);
        return { okMirror, rec2, vpFov, rec3 };
    })()`);
    check('addShot mirrors clip/focal; updateShot edits shot only; resetShot reverts',
        shotFlow.okMirror === true &&
        Math.abs(shotFlow.rec2.focal - 100) < 0.5 && Math.abs(shotFlow.rec2.clip.near - 0.2) < 0.01 &&
        Math.abs(shotFlow.vpFov - 85) < 1.5 &&
        Math.abs(shotFlow.rec3.focal - 50) < 0.5 && Math.abs(shotFlow.rec3.clip.near - 0.5) < 0.01,
        JSON.stringify(shotFlow));

    // ---- 7) gotoShot 应用机位裁剪；机位无 clip 时回自动 ----
    const gotoFlow = await evalJs(`(async () => {
        const d = window.__director;
        const s = d.listShots()[0];
        // 把机位设为已知裁剪 → 视口回自动 → goto → 视口应带机位裁剪
        d.updateShot(s.id, { clip: { near: 0.3, far: 40 } });
        d.setClipRange({ enabled: false });
        const auto1 = d.getClipRange();
        d.gotoShot(s.id);
        const manual = d.getClipRange();
        // 旧式机位（无 clip）：手工构造一个 clip 为 null 的机位（updateShot clip:null）
        d.updateShot(s.id, { clip: null });
        const rec = d.listShots().find(x => x.id === s.id);
        d.gotoShot(s.id);
        const auto2 = d.getClipRange();
        return { auto1enabled: auto1.enabled, manual, recClipNull: rec.clip === null, auto2enabled: auto2.enabled };
    })()`);
    check('gotoShot applies shot clip; null-clip shot falls back to auto',
        gotoFlow.manual.enabled === true && Math.abs(gotoFlow.manual.near - 0.3) < 0.01 &&
        gotoFlow.recClipNull === true && gotoFlow.auto2enabled === false,
        JSON.stringify(gotoFlow));

    // ---- 8) 步进移动：pos/target 等距平移，朝向不变 ----
    const nudge = await evalJs(`(() => {
        const d = window.__director;
        const s = d.listShots()[0];
        const p0 = s.pos.slice(), t0 = s.target.slice();
        d.nudgeShot(s.id, 'fwd', 0.5);
        const s1 = d.listShots().find(x => x.id === s.id);
        const dp = s1.pos.map((v, i) => +(v - p0[i]).toFixed(4));
        const dt = s1.target.map((v, i) => +(v - t0[i]).toFixed(4));
        const mag = Math.hypot(...dp);
        const same = JSON.stringify(dp) === JSON.stringify(dt);
        d.nudgeShot(s.id, 'left', 0.5);
        const s2 = d.listShots().find(x => x.id === s.id);
        const dp2 = Math.hypot(...s2.pos.map((v, i) => v - s1.pos[i]));
        return { mag, same, dp2, bad: d.nudgeShot(99999, 'fwd', 0.1) };
    })()`);
    check('nudgeShot: rig translated by step, heading unchanged + guard',
        nudge && Math.abs(nudge.mag - 0.5) < 0.01 && nudge.same === true &&
        Math.abs(nudge.dp2 - 0.5) < 0.01 && nudge.bad === 'none', JSON.stringify(nudge));

    // ---- 9) 旋转：水平朝向到位，俯仰/距离保持 ----
    const rot = await evalJs(`(() => {
        const d = window.__director;
        const s = d.listShots()[0];
        const yawOf = r => Math.atan2(r.target[0] - r.pos[0], r.target[2] - r.pos[2]) * 180 / Math.PI;
        const dist = Math.hypot(s.target[0] - s.pos[0], s.target[1] - s.pos[1], s.target[2] - s.pos[2]);
        d.rotateShot(s.id, 45);
        const s1 = d.listShots().find(x => x.id === s.id);
        const dist1 = Math.hypot(s1.target[0] - s1.pos[0], s1.target[1] - s1.pos[1], s1.target[2] - s1.pos[2]);
        let yaw = yawOf(s1);
        if (yaw < 0) yaw += 360;
        return { yaw, dist, dist1, bad: d.rotateShot(99999, 10) };
    })()`);
    check('rotateShot: yaw 45 set, target distance preserved + guard',
        rot && Math.abs(rot.yaw - 45) < 0.5 && Math.abs(rot.dist1 - rot.dist) < 0.01 && rot.bad === 'none',
        JSON.stringify(rot));

    // ---- 10) 机位面板 UI：数值块 + 六钮 + 旋转行 + 参数信息；sv 焦距提交走 updateShot ----
    const ui = await evalJs(`(async () => {
        // 先展开机位组面板（fill() 会灌下拉并选中第一个机位，否则 curId()=0 提交被守卫拦下）
        const dock = document.querySelector('.sd-dock[data-dock="view"]');
        const g = Array.from(dock.querySelectorAll('.sd-grp-btn')).find(b => (b.querySelector('.sd-name') || {}).textContent === '机位');
        if (g) g.click();
        await new Promise(r => setTimeout(r, 400));
        // v39：机位参数编辑门控在视角模式内，先进入再拖
        window.__director.enterShotView(window.__director.listShots()[0].id);
        await new Promise(r => setTimeout(r, 200));
        const w = document.querySelector('.sd-shot-panel');
        const nudgeN = w.querySelectorAll('.sd-nudge-btn').length;
        const has = {
            step: !!w.querySelector('[data-shot="step"]'),
            rotGrid: w.querySelectorAll('.sd-rot-btn').length === 6,   // v39：三轴旋转取代旧 yaw 文本框
            astep: !!w.querySelector('[data-shot="astep"]'),
            reset: !!w.querySelector('[data-shot="reset"]'),
            near: !!w.querySelector('#sv-near'), foc: !!w.querySelector('#sv-foc'),
            pos: !!w.querySelector('[data-sv="pos"]'),
            relocateRow: !!w.querySelector('[data-shot="relocate"]')
        };
        // sv 焦距就地编辑：拖动 sv-foc 后机位 focal 应变化
        const d = window.__director;
        const id = d.listShots()[0].id;
        const el = w.querySelector('#sv-foc');
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.x + r.width / 2) || 40, cy = Math.round(r.y + r.height / 2) || 40;
        const f0 = d.listShots().find(x => x.id === id).focal;
        el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 8, clientX: cx, clientY: cy, bubbles: true }));
        await new Promise(r2 => setTimeout(r2, 300));
        el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 8, clientX: cx + 25, clientY: cy, bubbles: true }));
        await new Promise(r2 => setTimeout(r2, 40));
        el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 8, clientX: cx + 25, clientY: cy, bubbles: true }));
        await new Promise(r2 => setTimeout(r2, 200));
        const f1 = d.listShots().find(x => x.id === id).focal;
        d.exitShotView(true);   // v39：退出并保存，还原视口供后续套件
        await new Promise(r => setTimeout(r, 200));
        return { nudgeN, has, focalChanged: Math.abs(f1 - f0) > 10, f0: Math.round(f0), f1: Math.round(f1) };
    })()`);
    check('shot panel UI complete (v39 rot grid) + sv focal drag updates shot',
        ui && ui.nudgeN === 6 && ui.has.step && ui.has.rotGrid && ui.has.astep && ui.has.reset &&
        ui.has.near && ui.has.foc && ui.has.pos && ui.has.relocateRow && ui.focalChanged,
        JSON.stringify(ui));

    // ---- 11) 存档快照：机位带 clip/base，restoreProject 后可用 ----
    const snap = await evalJs(`(() => {
        const d = window.__director;
        const s = d.projectSnapshot();
        const shot = (s.shots || [])[0] || {};
        return { hasClipField: 'clip' in shot, hasBaseField: 'base' in shot,
                 cameraHasClip: 'clip' in (s.camera || {}) };
    })()`);
    check('projectSnapshot carries shot clip/base + viewport clip',
        snap.hasClipField && snap.hasBaseField && snap.cameraHasClip, JSON.stringify(snap));

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
