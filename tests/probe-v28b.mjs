/* tests/probe-v28b.mjs - 停靠区避让保存/返回条（Edge + CDP，390x844）
 *
 * 只验一件事：进入工程后，顶部/左侧/右侧停靠区都要让开左上角的保存/返回条，
 * 而保存/返回按钮自身的位置必须一个像素都不动。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve('www');
const PORT = 4199;
const CDP = 9259;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
let id = 0;
const pending = new Map();

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

async function getWs() {
    for (let i = 0; i < 60; i++) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
            const page = list.find((t) => t.type === 'page');
            if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
        } catch { /* not up yet */ }
        await sleep(500);
    }
    throw new Error('CDP not ready');
}

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + path.join(os.tmpdir(), 'edge_v28b_profile'),
    '--enable-unsafe-webgpu', '--use-angle=d3d11', '--window-size=390,844',
    `http://127.0.0.1:${PORT}/index.html`
], { stdio: 'ignore' });

const rectOf = (sel) => `(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left),
             right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height),
             display: getComputedStyle(el).display };
})()`;

const intersects = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);

try {
    ws = new WebSocket(await getWs());
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

    const ready = await waitFor("document.body && document.body.classList.contains('sd-docks-ready')", 80, 400);
    check('docks ready', ready === true);

    // 工程页 -> 新建工程 -> 编辑器页（保存条显示）
    await evalJs("window.__projects.create('probe-v28b')");
    const barShown = await waitFor("!!document.querySelector('.pj-bar.open')", 40, 250);
    check('save bar visible in editor', barShown === true);
    await sleep(600);

    const bar = await evalJs(rectOf('.pj-bar'));
    const top = await evalJs(rectOf('.sd-dock.sd-top'));
    const left = await evalJs(rectOf('.sd-dock.sd-left'));
    const right = await evalJs(rectOf('.sd-dock.sd-right'));

    console.log('bar ', JSON.stringify(bar));
    console.log('top ', JSON.stringify(top));
    console.log('left', JSON.stringify(left));
    console.log('right', JSON.stringify(right));

    check('save bar pinned at expected spot',
        bar && bar.left === 8 && bar.top === 8,
        `left=${bar?.left} top=${bar?.top}`);

    check('top dock clears the bar', top && bar && top.top >= bar.bottom,
        `dock.top=${top?.top} bar.bottom=${bar?.bottom}`);

    check('top dock does not overlap bar', top && bar && !intersects(top, bar),
        top && bar ? `dock=[${top.left},${top.top},${top.right},${top.bottom}]` : '');

    // 左侧停靠组当前布局里不存在（只有顶/底/右），缺失不算失败；
    // 有的话照样要检查避让。
    if (left) {
        check('left dock clears the bar', left.top >= bar.bottom,
            `dock.top=${left.top} bar.bottom=${bar.bottom}`);
        check('left dock does not overlap bar', !intersects(left, bar));
    } else {
        console.log('SKIP  left dock not configured in this layout');
    }

    if (right) {
        check('right dock clears the bar', right.top >= bar.bottom,
            `dock.top=${right.top} bar.bottom=${bar.bottom}`);
        check('right dock does not overlap bar', !intersects(right, bar));
    } else {
        check('right dock present', false, 'missing .sd-dock.sd-right');
    }

    // 变量确实写进去了
    const barBottomVar = await evalJs("getComputedStyle(document.body).getPropertyValue('--sd-bar-bottom').trim()");
    check('--sd-bar-bottom set', !!barBottomVar && parseFloat(barBottomVar) > 0, `value=${barBottomVar}`);

    // 未进入工程时不应有 sd-has-bar，以免把工程页也撑开
    await evalJs("window.__projects.back()");
    await sleep(500);
    const off = await evalJs("document.body.classList.contains('sd-has-bar')");
    check('sd-has-bar cleared on project list', off === false);

    const failed = results.filter((r) => !r.ok);
    console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
    if (failed.length) process.exitCode = 1;
} catch (err) {
    console.log('ERROR', err.message);
    process.exitCode = 1;
} finally {
    try { edge.kill(); } catch {}
    try { srv.kill(); } catch {}
    await sleep(300);
    process.exit(process.exitCode || 0);
}
