/* tests/probe-v32.mjs - v32 相机面板重排 + 机位改名/重定位 + 悬浮窗透明度探针
 *
 * 老板 2026-10-31 00:58 三条反馈：
 *   1. 相机面板排版：轨道/飞行注释贴到模式按钮旁（不再悬在面板最底部）
 *   2. 机位名称行右侧 ✏️ 改名 / 📍 重定位（重定位 = 把选中机位移到当前视角）
 *   3. 悬浮窗半透明：--sd-alpha 默认 0.6，设置页滑条实时调节 + localStorage
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('www');
const PORT = 4199;
const CDP = 9259;
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
    '--user-data-dir=' + path.join(process.env.TEMP, 'edge_v32_profile'),
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
    check('dock ready', await waitFor('document.body.classList.contains("sd-docks-ready")', 60, 500));

    // 清场：删掉历史机位，从干净状态测
    await evalJs(`(() => { const d = window.__director;
        d.listShots().slice().forEach(s => d.removeShot(s.id)); return true; })()`);

    // ---- 1) 机位面板结构：机位行（下拉+改名+新增）+ 内联改名行默认隐藏（v38：重定位降到底部行） ----
    const row = await evalJs(`(() => {
        const r = document.querySelector('.sd-shot-pick-row');
        if (!r) return null;
        return {
            sel: !!r.querySelector('.sd-shot-list'),
            ren: !!r.querySelector('[data-shot="rename"]'),
            add: !!r.querySelector('[data-shot="add"]'),
            relGone: !r.querySelector('[data-shot="relocate"]')
        };
    })()`);
    check('pick row = dropdown + rename + add (relocate moved out)',
        !!row && row.sel && row.ren && row.add && row.relGone, JSON.stringify(row));
    check('edit row hidden initially', await evalJs(
        '(() => { const e = document.querySelector(".sd-shot-edit-row"); return !!e && e.hidden; })()'));

    // ---- 2) v38：模式按钮+注释在视口组面板顶部，机位组不再有模式行 ----
    const hint = await evalJs(`(() => {
        const modes = document.querySelector('.sd-vp-panel .sd-vp-modes');
        const h = document.querySelector('.sd-vp-panel .sd-dir-hint');
        const shotModes = document.querySelector('.sd-shot-panel .sd-cam-modes');
        if (!modes || !h) return null;
        return { adjacent: h.previousElementSibling === modes,
                 adopted: modes.querySelectorAll('.sd-adopted').length,
                 shotModesRetired: !shotModes };
    })()`);
    check('viewport panel: 4 mode buttons + hint; shot panel modes retired',
        !!hint && hint.adjacent === true && hint.adopted === 4 && hint.shotModesRetired === true, JSON.stringify(hint));

    // ---- 3) 引擎 API：renameShot ----
    const ids = await evalJs(`(() => { const d = window.__director;
        const s1 = d.addShot(); return [s1.id]; })()`);
    const ren = await evalJs(`(() => { const d = window.__director;
        return { ok: d.renameShot(${ids[0]}, '测试机位A'),
                 name: (d.listShots().find(s => s.id === ${ids[0]}) || {}).name,
                 empty: d.renameShot(${ids[0]}, '   '),
                 bad: d.renameShot(99999, 'x') }; })()`);
    check('renameShot renames + guards',
        ren.ok === 'ok' && ren.name === '测试机位A' && ren.empty === 'no-name' && ren.bad === 'none',
        JSON.stringify(ren));

    // ---- 4) 引擎 API：relocateShot（用 fov 差验证“取当前视角”）----
    const rel = await evalJs(`(async () => {
        const d = window.__director;
        // 把编辑器相机 fov 改成 75，relocate 后机位的 fov 应跟着变
        const cam = window.scene.camera;
        if (!cam) return { ok: false, why: 'no-camera-global' };
        cam.fov = 75;
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const r = d.relocateShot(${ids[0]});
        const s = d.listShots().find(x => x.id === ${ids[0]});
        return { r, fov: s && s.fov, bad: d.relocateShot(99999) };
    })()`);
    check('relocateShot captures current view (fov 75) + guard',
        rel.r === 'ok' && Math.abs(rel.fov - 75) < 0.01 && rel.bad === 'none', JSON.stringify(rel));

    // ---- 5) UI 全流程：真实路径建机位（＋新增按钮内部会 fill()）→ 点 ✏️ →
    // 内联行出现并预填 → 改名 → ✓ 生效并收起 → 再开 → ✕ 取消 ----
    const uiFlow = await evalJs(`(async () => {
        const wrap = document.querySelector('.sd-shot-panel');
        wrap.querySelector('[data-shot="add"]').click();
        await new Promise(r => setTimeout(r, 120));
        const sel = wrap.querySelector('.sd-shot-list');
        const newId = Number(sel.value);
        if (!newId) return { shown: false, why: 'no-selection' };
        // 先用 API 改成已知名，保证预填断言稳定（预填读 listShots()，不看下拉文本）
        window.__director.renameShot(newId, '测试机位A');
        wrap.querySelector('[data-shot="rename"]').click();
        const editRow = wrap.querySelector('.sd-shot-edit-row');
        const input = wrap.querySelector('.sd-shot-edit');
        const shown = !editRow.hidden && input.value === '测试机位A';
        input.value = '新名字B';
        wrap.querySelector('[data-shot="rename-ok"]').click();
        await new Promise(r => setTimeout(r, 100));
        const d = window.__director;
        const name = (d.listShots().find(s => s.id === newId) || {}).name;
        // 取消路径：再开（此时应预填新名字）→ ✕ 收起
        wrap.querySelector('[data-shot="rename"]').click();
        const reopened = !editRow.hidden && input.value === '新名字B';
        wrap.querySelector('[data-shot="rename-no"]').click();
        return { shown, name, closed: editRow.hidden, reopened };
    })()`);
    check('UI rename flow (add/open/prefill/apply/cancel)',
        uiFlow.shown === true && uiFlow.name === '新名字B' && uiFlow.closed === true && uiFlow.reopened === true,
        JSON.stringify(uiFlow));

    // ---- 6) 透明度：默认 0.6 + localStorage + 设置页滑条实时调 ----
    const a0 = await evalJs(`(() => ({
        var: document.documentElement.style.getPropertyValue('--sd-alpha'),
        ls: localStorage.getItem('sd-alpha'),
        dockBg: getComputedStyle(document.querySelector('.sd-dock')).backgroundColor
    }))()`);
    check('alpha default 0.6 (var + storage + dock bg)',
        parseFloat(a0['var']) === 0.6 && a0.ls === '0.6' && /rgba\(21, 24, 28, 0\.6\)/.test(a0.dockBg),
        JSON.stringify(a0));

    const slider = await evalJs(`(() => {
        const row = document.querySelector('#sd-alpha-row');
        if (!row) return null;
        return { lab: row.querySelector('.sd-alpha-lab')?.textContent,
                 val: row.querySelector('.sd-alpha-val')?.textContent };
    })()`);
    check('settings alpha slider exists (default 60%)',
        !!slider && /透明度/.test(slider.lab || '') && /60/.test(slider.val || ''), JSON.stringify(slider));

    const a1 = await evalJs(`(() => {
        const s = document.querySelector('#sd-alpha-slider');
        s.value = '80';
        s.dispatchEvent(new Event('input', { bubbles: true }));
        return { var: document.documentElement.style.getPropertyValue('--sd-alpha'),
                 ls: localStorage.getItem('sd-alpha'),
                 val: document.querySelector('#sd-alpha-row .sd-alpha-val').textContent,
                 dockBg: getComputedStyle(document.querySelector('.sd-dock')).backgroundColor };
    })()`);
    check('slider drag → alpha 0.8 everywhere + persisted',
        parseFloat(a1['var']) === 0.8 && a1.ls === '0.8' && /80/.test(a1.val) &&
        /rgba\(21, 24, 28, 0\.8\)/.test(a1.dockBg), JSON.stringify(a1));
    // 恢复默认，不污染后续探针
    await evalJs(`(() => { const s = document.querySelector('#sd-alpha-slider');
        s.value = '60'; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);

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
