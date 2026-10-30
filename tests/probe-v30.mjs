/* tests/probe-v30.mjs - v30 批次端到端探针（Edge + CDP，390x844）
 *
 * 覆盖老板 2026-10-30 「其他的需求你也搞一下」的引擎侧闭环：
 *   #6 方块：生成（程序几何/默认灰）→ 换色 → 快照 kind:box → 删除后 restore 还原
 *   #4 泼溅行：listSplats → 显隐 → 直接删除（无确认框）
 *   #5 显示范围：setClipRange 生效（near/far 钉住）→ 关闭恢复自动
 *   #3 移动模型：复制到游标（人偶副本继承位姿）+ movegroup 面板在 dock.js
 *   #1 视口重置：resetViewport 后 pivot 归零、游标隐藏、手动裁剪清空
 *
 * 用法：仓库根执行 `node tests/probe-v30.mjs`
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('www');
const PORT = 4199;
const CDP = 9259;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PLY_SRC = path.resolve('spike/glb-load-test/splat.ply');
const PLY_DST = path.resolve('www/__test_splat.ply');
let plyCopied = false;

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

if (!fs.existsSync(PLY_SRC)) throw new Error('缺少测试模型: ' + PLY_SRC);
fs.copyFileSync(PLY_SRC, PLY_DST);
plyCopied = true;

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + path.join(process.env.TEMP, 'edge_v30_profile'),
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

try {
    ws = new WebSocket(await getWs());
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && pending.has(m.id)) {
            const p = pending.get(m.id);
            pending.delete(m.id);
            m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
        } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
            logs.push(m.params.args.map(a => a.value || a.description || '').join(' '));
        } else if (m.method === 'Runtime.exceptionThrown') {
            logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || ''));
        }
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await sleep(2500);

    check('editor ready', await waitFor('!!window.scene', 60, 500));
    check('director ready', await waitFor('!!window.__director', 60, 500));
    check('v30 apis present', await evalJs(
        '["copySelectedToCursor","spawnBox","setBoxColor","listSplats","deleteSplatByIndex","setClipRange","resetViewport"].every(k => typeof window.__director[k] === "function")'));

    // ---- 1) #6 方块：生成 + 换色 ----
    await evalJs('window.__director.addBoxAtCursor()');
    check('box spawned (async op)', await waitFor(
        'window.__director.listProps().some(p => p.kind === "box")', 40, 300));
    const boxColor0 = await evalJs(
        'window.__director.listProps().find(p => p.kind === "box").boxColor');
    check('box default color gray', boxColor0 === '#808080', boxColor0);
    const boxId = await evalJs('window.__director.listProps().find(p => p.kind === "box").id');
    await evalJs(`window.__director.setBoxColor(${boxId}, '#0000ff')`);
    const boxColor1 = await evalJs(
        'window.__director.listProps().find(p => p.kind === "box").boxColor');
    check('box recolored blue', boxColor1 === '#0000ff', boxColor1);

    // ---- 2) #6 方块：快照 + 删除后 restore 还原（无 files 依赖）----
    const snapInfo = await evalJs(`(() => {
        const snap = window.__director.projectSnapshot();
        const b = (snap.props || []).find(p => p.kind === 'box');
        return b ? { kind: b.kind, color: b.boxColor, n: snap.props.length } : null;
    })()`);
    check('snapshot records kind:box', !!snapInfo && snapInfo.kind === 'box' && snapInfo.color === '#0000ff',
        JSON.stringify(snapInfo));
    const restored = await evalJs(`(async () => {
        const d = window.__director;
        const snap = d.projectSnapshot();
        d.listProps().slice().forEach(p => d.deletePropById(p.id));
        await new Promise(r => setTimeout(r, 400));
        const afterDel = d.listProps().length;
        await d.restoreProject(snap, {});
        await new Promise(r => setTimeout(r, 600));
        return { afterDel, afterRestore: d.listProps().length,
                 color: (d.listProps().find(p => p.kind === 'box') || {}).boxColor };
    })()`);
    check('box restored from snapshot without files',
        restored?.afterDel === 0 && restored?.afterRestore >= 1 && restored?.color === '#0000ff',
        JSON.stringify(restored));

    // ---- 3) #4 泼溅行：导入 → 列表 → 显隐 → 直接删 ----
    await evalJs(`(async () => {
        const resp = await fetch('__test_splat.ply');
        const buf = await resp.arrayBuffer();
        const file = new File([buf], 'test.ply');
        await window.scene.events.invoke('import', [{ filename: 'test.ply', contents: file }]);
    })()`);
    check('splat imported', await waitFor(
        'window.scene.getElementsByType("splat").length === 1', 60, 500));
    const splatRow = await evalJs('window.__director.listSplats()[0]');
    check('listSplats exposes row', !!splatRow && splatRow.visible === true, JSON.stringify(splatRow));
    await evalJs('window.__director.setSplatVisibleByIndex(0, false)');
    const splatHidden = await evalJs('window.__director.listSplats()[0].visible');
    check('splat hidden via row API', splatHidden === false);
    await evalJs('window.__director.deleteSplatByIndex(0)');
    check('splat deleted without confirm', await waitFor(
        'window.scene.getElementsByType("splat").length === 0', 40, 300));

    // ---- 4) #5 显示范围：手动裁剪生效/关闭 ----
    const clipOn = await evalJs(`(async () => {
        const d = window.__director;
        const r = d.setClipRange({ enabled: true, near: 0.5, far: 50 });
        // 裁剪面在下一渲染帧才被钉住，同步读到的是上一帧的自动值，等两帧再验
        await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
        await new Promise(res => setTimeout(res, 150));
        return { r, near: window.scene.camera.near, far: window.scene.camera.far,
                 get: d.getClipRange() };
    })()`);
    check('manual clip pins near/far',
        clipOn?.r === 'ok' && clipOn?.near === 0.5 && clipOn?.far === 50 && clipOn?.get?.enabled === true,
        JSON.stringify(clipOn));
    const clipOff = await evalJs(`(() => {
        const d = window.__director;
        d.setClipRange({ enabled: false });
        return d.getClipRange();
    })()`);
    check('manual clip disabled restores auto', clipOff?.enabled === false, JSON.stringify(clipOff));

    // ---- 5) #3 移动模型：复制到游标（人偶副本继承位姿）----
    await evalJs('window.__director.addPuppet()');
    check('puppet spawned', await waitFor('window.__director.puppets.length === 1', 120, 500));
    await evalJs(`(() => {
        const V3 = window.scene.app.root.getLocalPosition().constructor;
        window.__director.placeCursor(new V3(1.5, 0, 1.5));
    })()`);
    const copyR = await evalJs('window.__director.copySelectedToCursor()');
    check('copy accepted', copyR === 'ok', String(copyR));
    check('puppet copy appeared', await waitFor('window.__director.puppets.length === 2', 60, 500));
    const copyPos = await evalJs(`(() => {
        const p = window.__director.puppets[1];
        const q = p.entity.getLocalPosition();
        return { x: +q.x.toFixed(2), z: +q.z.toFixed(2) };
    })()`);
    check('copy landed at cursor', copyPos?.x === 1.5 && copyPos?.z === 1.5, JSON.stringify(copyPos));

    // ---- 6) #1 视口重置：pivot 归零 + 游标隐藏 + 手动裁剪清空 ----
    const resetInfo = await evalJs(`(() => {
        const d = window.__director;
        const V3 = window.scene.app.root.getLocalPosition().constructor;
        window.scene.camera.setPose(new V3(6, 4, 6), new V3(2, 0, 2), 0);
        d.setClipRange({ enabled: true, near: 0.3, far: 30 });
        const r = d.resetViewport();
        const pivot = window.scene.events.invoke('pivot');
        return { r, pivot: pivot.transform.position.toArray().map(v => +v.toFixed(3)),
                 cursorOn: d.cursorRoot ? d.cursorRoot.enabled : null,
                 clip: d.getClipRange() };
    })()`);
    check('resetViewport ok', resetInfo?.r === 'ok', JSON.stringify(resetInfo));
    check('pivot back to origin',
        resetInfo?.pivot?.[0] === 0 && resetInfo?.pivot?.[1] === 0 && resetInfo?.pivot?.[2] === 0,
        JSON.stringify(resetInfo?.pivot));
    check('cursor hidden after reset', resetInfo?.cursorOn === false);
    check('manual clip cleared', resetInfo?.clip?.enabled === false);

    // ---- 7) movegroup 面板存在于 dock.js ----
    const movegroup = await evalJs(
        '!!document.querySelector(".sd-sub-wrap[data-grp=\\"movegroup\\"]")');
    check('movegroup panel injected', movegroup === true);

    // ---- 8) 无异常 ----
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
    if (plyCopied) {
        try { fs.unlinkSync(PLY_DST); } catch {}
    }
    setTimeout(() => process.exit(failed ? 1 : 0), 300);
}
