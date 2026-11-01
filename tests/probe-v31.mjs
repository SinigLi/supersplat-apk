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
            const page = list.find(t => t.type === 'page' && (t.url || '').includes(':' + PORT));
            if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
        } catch { /* 还没起来 */ }
        await sleep(500);
    }
    throw new Error('CDP not ready');
}

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + path.join(process.env.TEMP, 'edge_v31_' + Date.now()),
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

    // ---- 1) 方块进角色下拉（v35：box 是第五个内置角色，走人偶管线） ----
    const charSel = await evalJs(`(() => {
        const sel = document.querySelector('.sd-dir-chars');
        if (!sel) return null;
        // 打开导演台面板让 fillChars 跑过：dock 已就绪时面板在 DOM 里
        return { hasBox: Array.from(sel.options).some(o => o.value === 'box'),
                 n: sel.options.length };
    })()`);
    check('char dropdown has 方块 option', !!charSel && charSel.hasBox === true, JSON.stringify(charSel));
    check('no standalone box button', await evalJs(
        '!document.querySelector(\'.sd-dir-btn[data-act="box"]\')'));
    // 选方块 → 点摆放 → 生成的是 box 人偶（puppet 管线）
    await evalJs(`(() => {
        const sel = document.querySelector('.sd-dir-chars');
        sel.value = 'box';
        sel.dispatchEvent(new Event('change'));
        document.querySelector('.sd-dir-btn[data-act="add"]').click();
    })()`);
    check('placing with box spawns box puppet', await waitFor(
        'window.__director.puppets.some(p => p.charId === "box")', 40, 300));
    // 选回人偶 → 点摆放 → 生成的是女人偶
    await evalJs(`(() => {
        const sel = document.querySelector('.sd-dir-chars');
        sel.value = 'woman';
        sel.dispatchEvent(new Event('change'));
        document.querySelector('.sd-dir-btn[data-act="add"]').click();
    })()`);
    check('placing with char spawns puppet', await waitFor(
        'window.__director.puppets.some(p => p.charId === "woman")', 120, 500));

    // ---- 2) 游标相关组三钮带图标+文字（v33：游标+移动合并，老板指定图文并列） ----
    const mv = await evalJs(`(() => {
        const w = document.querySelector('.sd-sub-wrap[data-grp="cursorgrp"]');
        if (!w) return null;
        const btns = w.querySelectorAll('.sd-cur-btn');
        const txts = Array.from(btns).map(b => b.querySelector('.sd-txt')?.textContent || '');
        return { n: btns.length, txts,
                 withText: txts.every(t => t.length >= 2) };
    })()`);
    check('cursorgrp three buttons with icon+text', !!mv && mv.n === 3 && mv.withText === true,
        JSON.stringify(mv));

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

    // ---- 4) v38 数值块存在 + 拖动逻辑生效（旧双头滑轨已退役） ----
    check('clip drag blocks exist', await evalJs(`(() => {
        const n = document.querySelector('#vp-near');
        const f = document.querySelector('#vp-far');
        return !!(n && f);
    })()`));
    const sliderWork = await evalJs(`(async () => {
        // v38：先展开视口组面板（同步自动值），再拖 vp-near 走 ±2× 按下值映射
        const dock = document.querySelector('.sd-dock[data-dock="view"]');
        const g = Array.from(dock.querySelectorAll('.sd-grp-btn')).find(b => (b.querySelector('.sd-name') || {}).textContent === '视口');
        if (g) g.click();
        await new Promise(r => setTimeout(r, 700));
        const el = document.querySelector('#vp-near');
        if (!el) return { ok: false, why: 'no-dom' };
        const cr1 = window.__director.getClipRange();
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
        const dn = x => el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, clientX: x, clientY: cy, bubbles: true }));
        const upE = x => el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: x, clientY: cy, bubbles: true }));
        dn(cx); await new Promise(r2 => setTimeout(r2, 40)); upE(cx);   // v40：第一击轻点只记时
        await new Promise(r2 => setTimeout(r2, 60));
        dn(cx); await new Promise(r2 => setTimeout(r2, 400));           // 第二击按住 ≥260ms → 拖动模式
        el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: cx + 60, clientY: cy, bubbles: true }));
        await new Promise(r2 => setTimeout(r2, 40));
        upE(cx + 60);
        await new Promise(r2 => setTimeout(r2, 150));
        const cr2 = window.__director.getClipRange();
        return { ok: true, before: [cr1.near, cr1.far], after: [cr2.near, cr2.far] };
    })()`);
    check('drag changes clip range (manual mode on)',
        sliderWork?.ok === true &&
        !!sliderWork.after && sliderWork.after[0] !== sliderWork.before[0],
        JSON.stringify(sliderWork));

    // ---- 无异常 ----
    const errs = logs.filter(l => /EXC|Uncaught|Cannot read|is not a function/.test(l));
    check('no runtime exceptions', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
    console.error('TEST ERROR:', e.message);
    globalThis.__hadError = true;
} finally {
    const failed = results.filter(r => !r.ok).length;
    console.log(`\n=== ${results.length - failed}/${results.length} passed ===`);
    try { ws?.close(); } catch {}
    edge.kill();
    srv.kill();
    setTimeout(() => process.exit(failed || globalThis.__hadError ? 1 : 0), 300);
}
