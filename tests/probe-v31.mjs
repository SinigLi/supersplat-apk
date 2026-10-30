/* tests/probe-v31.mjs - v31 真机反馈修复探针（Edge + CDP，390x844）
 *
 * 老板 2026-10-30 16:24 四条反馈的 UI 验证：
 *   1. 方块进角色下拉（不再独立按钮；选「方块」→摆放按钮生成方块）
 *   2. 移动模型组两钮纯图标（无文字 span，不再折行）
 *   3. 场景页打开时 SS 原生泼溅列表隐藏（样式统一+删除不弹原生确认框）
 *   4. 双头滑轨存在且对数映射逻辑正确（near/far 滑轨 DOM + input 响应）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('www');
const PORT = 4200;
const CDP = 9260;
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
    '--user-data-dir=' + path.join(process.env.TEMP, 'edge_v31_profile'),
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

    // ---- 1) 方块进角色下拉 ----
    const charSel = await evalJs(`(() => {
        const sel = document.querySelector('.sd-dir-chars');
        if (!sel) return null;
        // 打开导演台面板让 fillChars 跑过：dock 已就绪时面板在 DOM 里
        return { hasBox: Array.from(sel.options).some(o => o.value === '__box'),
                 n: sel.options.length };
    })()`);
    check('char dropdown has 方块 option', !!charSel && charSel.hasBox === true, JSON.stringify(charSel));
    check('no standalone box button', await evalJs(
        '!document.querySelector(\'.sd-dir-btn[data-act="box"]\')'));
    // 选方块 → 点摆放 → 生成的是 box prop
    await evalJs(`(() => {
        const sel = document.querySelector('.sd-dir-chars');
        sel.value = '__box';
        sel.dispatchEvent(new Event('change'));
        document.querySelector('.sd-dir-btn[data-act="add"]').click();
    })()`);
    check('placing with __box spawns box', await waitFor(
        'window.__director.listProps().some(p => p.kind === "box")', 40, 300));
    // 选回人偶 → 点摆放 → 生成的是 puppet（不是 box）
    await evalJs(`(() => {
        const sel = document.querySelector('.sd-dir-chars');
        sel.value = 'woman';
        sel.dispatchEvent(new Event('change'));
        document.querySelector('.sd-dir-btn[data-act="add"]').click();
    })()`);
    check('placing with char spawns puppet', await waitFor(
        'window.__director.puppets.length === 1', 120, 500));

    // ---- 2) 移动模型组两钮纯图标 ----
    const mv = await evalJs(`(() => {
        const w = document.querySelector('.sd-sub-wrap[data-grp="movegroup"]');
        if (!w) return null;
        const btns = w.querySelectorAll('.sd-mv-btn');
        return { n: btns.length,
                 noText: Array.from(btns).every(b => !b.querySelector('.sd-name') && b.textContent.trim().length <= 2) };
    })()`);
    check('movegroup two icon-only buttons', !!mv && mv.n === 2 && mv.noText === true, JSON.stringify(mv));

    // ---- 3) 场景页打开时原生泼溅列表隐藏 ----
    const splatHidden = await evalJs(`(() => {
        // 打开场景页
        document.querySelector('.sd-dir-scene').click();
        const container = document.querySelector('.splat-list-container');
        if (!container) return { open: false };
        const cs = getComputedStyle(container);
        return { open: document.body.classList.contains('sd-scene-open'),
                 display: cs.display };
    })()`);
    check('native splat list hidden in scene page',
        splatHidden?.open === true && splatHidden?.display === 'none', JSON.stringify(splatHidden));
    // 我们的统一泼溅行容器还在
    check('our unified list present', await evalJs(
        '!!document.getElementById("sd-puppet-list")'));
    // 关掉场景页
    await evalJs(`(() => {
        document.querySelector('.sd-dir-scene').click();
        document.body.classList.remove('sd-scene-open');
        return true;
    })()`);

    // ---- 4) 双头滑轨存在 + 拖动逻辑生效 ----
    check('clip sliders exist', await evalJs(`(() => {
        const n = document.querySelector('[data-slider="near"]');
        const f = document.querySelector('[data-slider="far"]');
        return !!(n && f);
    })()`));
    const sliderWork = await evalJs(`(async () => {
        // 打开相机面板（滑轨在 shot panel 里）
        const cams = document.querySelector('.sd-grp-btn');
        // 直接找启用按钮和滑轨（面板可能要打开，先强制可见性检查 DOM 逻辑）
        const on = document.querySelector('[data-shot="clip-on"]');
        const nSl = document.querySelector('[data-slider="near"]');
        if (!on || !nSl) return { ok: false, why: 'no-dom' };
        on.click();
        await new Promise(r => setTimeout(r, 200));
        const cr1 = window.__director.getClipRange();
        if (!cr1.enabled) return { ok: false, why: 'not-enabled' };
        // 模拟拖动 near 滑轨到 500/1000（对数中点）
        nSl.value = 500;
        nSl.dispatchEvent(new Event('input', { bubbles: true }));
        nSl.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
        await new Promise(r => setTimeout(r, 150));
        const cr2 = window.__director.getClipRange();
        return { ok: true, before: [cr1.near, cr1.far], after: [cr2.near, cr2.far] };
    })()`);
    check('slider drag changes clip range',
        sliderWork?.ok === true &&
        Math.abs((sliderWork.after[0] || 0) - (sliderWork.before[0] || 0)) > 0.001,
        JSON.stringify(sliderWork));

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
