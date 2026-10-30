/* tests/probe-empty-project.mjs - 新建空工程 → 返回 → 再打开
 *
 * 复现用户报的问题：新建空工程啥都不做就返回，再点这个工程会“打开失败”。
 * 根因是 createProject 只写注册表、没落盘 project.svproj，openProject 读不到文件。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve('www');
const PORT = 4201;
const CDP = 9261;
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
        } catch { /* not up */ }
        await sleep(500);
    }
    throw new Error('CDP not ready');
}

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + path.join(os.tmpdir(), 'edge_empty_proj'),
    '--enable-unsafe-webgpu', '--use-angle=d3d11', '--window-size=390,844',
    `http://127.0.0.1:${PORT}/index.html`
], { stdio: 'ignore' });

const NAME = '空工程测试';

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
    check('project layer loaded', await evalJs('!!window.__projects') === true);

    // 干净起点
    await evalJs('indexedDB.deleteDatabase("ss-store")');
    await evalJs('localStorage.removeItem("ss-registry")');

    // 1) 新建空工程
    await evalJs(`window.__projects.create(${JSON.stringify(NAME)})`);
    await sleep(1200);
    check('created project is current', await evalJs('window.__projects.current()') === NAME);

    // 2) 什么都不做，直接返回
    await evalJs('window.__projects.back()');
    await sleep(900);
    const onList = await evalJs("document.querySelector('.pj-page').classList.contains('open')");
    check('back returns to project list (no dirty dialog)', onList === true,
        'open=' + onList);

    // 3) 再点开这个工程 —— 这就是原来报“打开失败”的地方
    await evalJs(`window.__projects.open(${JSON.stringify(NAME)})`);
    await sleep(2000);

    const cur = await evalJs('window.__projects.current()');
    check('reopened without failure', cur === NAME, 'current=' + JSON.stringify(cur));

    const inEditor = await evalJs("!document.querySelector('.pj-page').classList.contains('open')");
    check('landed in the editor', inEditor === true);

    // 4) 确认空工程文件真的落盘了（再读一次能解析）
    const stored = await evalJs(`(async () => {
        const L = window.__projectLogic;
        const p = L.pathsFor(${JSON.stringify(NAME)});
        try {
            // v29：空工程就是几 KB 的纯状态 project.json
            const bytes = await L.store().read(p.state);
            const st = JSON.parse(new TextDecoder().decode(bytes));
            return { ok: true, version: st.version,
                     puppets: (st.puppets||[]).length,
                     model: !!st.model, bytes: bytes.length };
        } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
    })()`);
    check('project file exists and parses', stored && stored.ok === true,
        JSON.stringify(stored));
    if (stored && stored.ok) {
        check('empty state has version 1', stored.version === 1, 'version=' + stored.version);
    }

    // 5) 空工程不该被判成脏
    const dirty = await evalJs('(() => { const d = window.__director; return null; })()');
    await evalJs('window.__projects.back()');
    await sleep(800);
    const listAgain = await evalJs("document.querySelector('.pj-page').classList.contains('open')");
    check('empty project stays clean on second back', listAgain === true);

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
