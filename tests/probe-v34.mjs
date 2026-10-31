/* tests/probe-v34.mjs - v34 老板 2026-10-31 10:54 四条反馈探针
 *
 *   1. 保存/返回并入顶部菜单停靠栏（原左上角 pj-bar 容器隐藏；编辑页显示、工程页/折叠态隐藏）
 *   2. 顶部停靠栏默认位置 = 屏幕左上（left:10px，不再水平居中）
 *   3. 机位下拉右侧小按钮缩小一倍（7.5rem → 3.75rem ≈ 60px）
 *   4. 「游标相关」组名改「游标」（act 仍为 cursorgrp，三钮不变）
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('www');
const PORT = 4196;
const CDP = 9256;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getWs() {
    for (let i = 0; i < 60; i++) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
            const page = list.find(t => t.type === 'page');
            if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
        } catch {}
        await sleep(500);
    }
    throw new Error('CDP not ready');
}

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + path.join(process.env.TEMP, 'edge_v34_profile'),
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
            const p = pending.get(m.id); pending.delete(m.id);
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
    // adoptProjectButtons 是轮询兜底（500ms 间隔），多等几轮
    check('pj buttons adopted', await waitFor(
        '!!document.querySelector(\'.sd-dock[data-dock="file"] .pj-bar-btn\')', 30, 500));

    // ---- 1) 保存/返回并入顶部菜单停靠栏 ----
    // 无头环境不走「打开工程」流程，pj-bar 没有 .open（没开工程本就不该显示保存/返回）；
    // 模拟 showEditorPage 后的显隐信号再断言
    const adopt = await evalJs(`(async () => {
        document.querySelector('.pj-bar').classList.add('open');
        window.dispatchEvent(new Event('resize'));
        await new Promise(r => setTimeout(r, 120));
        const topDock = document.querySelector('.sd-dock[data-dock="file"]');
        const bar = document.querySelector('.pj-bar');
        const btns = topDock ? Array.from(topDock.querySelectorAll('.pj-bar-btn')) : [];
        const cs = bar ? getComputedStyle(bar) : null;
        const handle = topDock ? topDock.querySelector('.sd-handle') : null;
        return {
            barDisplay: cs ? cs.display : 'missing',
            n: btns.length,
            afterHandle: handle ? btns.every(b => handle.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) : false,
            order: btns.map(b => b.textContent.trim()),
            visibleNow: btns.length ? getComputedStyle(btns[0]).display !== 'none' : false,
            hasBarSignal: document.body.classList.contains('sd-has-bar')
        };
    })()`);
    check('save/back live in top dock, bar hidden, buttons visible in editor',
        adopt.barDisplay === 'none' && adopt.n === 2 && adopt.afterHandle === true &&
        adopt.order[0] === '💾 保存' && adopt.visibleNow === true && adopt.hasBarSignal === true,
        JSON.stringify(adopt));

    // 折叠态：保存/返回必须藏住（!important 与 .sd-collapsed 的对抗）
    const fold = await evalJs(`(() => {
        const topDock = document.querySelector('.sd-dock[data-dock="file"]');
        const collapse = topDock.querySelector('.sd-collapse');
        collapse.click();
        return new Promise(res => setTimeout(() => {
            const b = topDock.querySelector('.pj-bar-btn');
            const collapsed = topDock.classList.contains('sd-collapsed');
            const btnHidden = b && getComputedStyle(b).display === 'none';
            collapse.click(); // 展开还原
            setTimeout(() => res({ collapsed, btnHidden }), 100);
        }, 150));
    })()`);
    check('pj buttons hidden while dock collapsed', fold.collapsed === true && fold.btnHidden === true, JSON.stringify(fold));

    // 还原：模拟回到工程页（清掉 sd-has-bar，不污染后续断言）
    await evalJs(`(() => { document.querySelector('.pj-bar').classList.remove('open');
        window.dispatchEvent(new Event('resize')); return true; })()`);

    // ---- 2) 顶部停靠栏默认左上（不居中）----
    const topPos = await evalJs(`(() => {
        const d = document.querySelector('.sd-dock[data-dock="file"]');
        const cs = getComputedStyle(d);
        return { left: cs.left, transform: cs.transform };
    })()`);
    check('top dock default at left edge (10px, no centering)',
        topPos.left === '10px' && (topPos.transform === 'none' || topPos.transform === 'matrix(1, 0, 0, 1, 0, 0)'),
        JSON.stringify(topPos));

    // ---- 3) 机位小按钮缩小一倍（>= 56px 且 < 100px）----
    const sizes = await evalJs(`(async () => {
        const d = window.__director;
        if (!d.listShots().length) d.addShot();
        const wrap = document.querySelector('.sd-shot-panel');
        const list = wrap.querySelector('.sd-shot-list');
        list.value = String(d.listShots()[0].id);
        wrap.querySelector('[data-shot="rename"]').click();
        await new Promise(r => setTimeout(r, 80));
        const pick = sel => { const b = document.querySelector(sel); return b ? getComputedStyle(b).width : '0'; };
        return { rename: parseFloat(pick('[data-shot="rename"]')),
                 ok: parseFloat(pick('[data-shot="rename-ok"]')) };
    })()`);
    check('mini buttons halved (56-100px)',
        sizes.rename >= 56 && sizes.rename < 100 && sizes.ok >= 56 && sizes.ok < 100, JSON.stringify(sizes));

    // ---- 4) 组名「游标」（act 不变）----
    const grp = await evalJs(`(() => {
        const btn = document.querySelector('.sd-dir-act[data-act="cursorgrp"] .sd-name');
        const wrap = document.querySelector('.sd-sub-wrap[data-grp="cursorgrp"]');
        const btns = wrap ? wrap.querySelectorAll('.sd-cur-btn').length : 0;
        return { label: btn ? btn.textContent : null, btns };
    })()`);
    check('group renamed to 游标 (3 buttons intact)',
        grp.label === '游标' && grp.btns === 3, JSON.stringify(grp));

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
