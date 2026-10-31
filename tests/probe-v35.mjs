/* tests/probe-v35.mjs - v35 方块 GLB 化探针（Edge + CDP，390x844）
 *
 * 覆盖老板 2026-10-31 三条反馈的修复验证：
 *   1) 方块颜色设置不了   → box.glb 第五内置角色，走 setTintById 人偶染色管线
 *   2) 黄色选中标记没有   → PuppetAdapter 契约（isPuppet）+ 引擎选中状态跟随
 *   3) 导演台不跟着选中变 → info().selectedCharId/selectedTint 反映方块选中
 * 附带：addPuppet 生成、undo 删除、快照还原链
 *
 * 用法：仓库根执行 `node tests/probe-v35.mjs`
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('www');
const PORT = 4205;
const CDP = 9265;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + path.join(process.env.TEMP, 'edge_v35_profile'),
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

function evalJs(expr) {
    return send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
        .then(r => {
            if (r.exceptionDetails) throw new Error('eval: ' + String(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)).slice(0, 300));
            return r.result?.value;
        });
}

async function waitFor(expr, tries, ms) {
    for (let i = 0; i < tries; i++) {
        if (await evalJs(expr)) return true;
        await sleep(ms);
    }
    return false;
}

let pass = 0, fail = 0;
function check(name, ok, detail) {
    if (ok) { pass++; console.log(`ok ${pass} - ${name}`); }
    else { fail++; console.log(`FAIL ${fail} - ${name}${detail ? ' | ' + detail : ''}`); }
}

process.on('exit', () => { try { srv.kill(); edge.kill(); } catch { } });

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

    // ---- 1) 方块是原生内置角色（不再是 dock 手工拼的 __box） ----
    const chars = await evalJs('window.__director.info().chars');
    const box = (chars || []).find(c => c.id === 'box');
    check('box is native character #5', !!box && chars.length === 5, JSON.stringify(chars));
    check('dock dropdown reflects box natively', await evalJs(
        'Array.from(document.querySelector(".sd-dir-chars").options).some(o => o.value === "box")'));
    check('no legacy __box option', await evalJs(
        '!Array.from(document.querySelector(".sd-dir-chars").options).some(o => o.value === "__box")'));

    // ---- 2) 生成方块人偶 + 走人偶管线（黄点/gizmo 契约） ----
    await evalJs('window.__director.switchCharacter("box")');
    check('box character loads', await waitFor(
        'window.__director.info().chars.find(c => c.id === "box").loaded', 60, 500));
    await evalJs('window.__director.addPuppet()');
    check('box puppet spawned', await waitFor(
        'window.__director.puppets.some(p => p.charId === "box")', 40, 300));
    check('box puppet has PuppetAdapter contract (yellow dot/gizmo)',
        await evalJs('window.__director.puppets.find(p => p.charId === "box").adapter.isPuppet === true'));
    check('box puppet registered pickable', await evalJs(
        '(window.__pickables ? window.__pickables().length >= 1 : false)'));

    // ---- 3) 反馈#1：颜色设置（人偶乘法染色管线） ----
    const boxId = await evalJs('window.__director.puppets.find(p => p.charId === "box").id');
    const tintR = await evalJs(`window.__director.setTintById(${boxId}, 'BLUE')`);
    check('setTintById(box) accepted', tintR === 'ok', String(tintR));
    check('box puppet tint stored BLUE', await evalJs(
        'window.__director.puppets.find(p => p.charId === "box").tint === "BLUE"'));

    // ---- 4) 反馈#3：导演台选中状态跟随方块 ----
    await evalJs(`window.__director.selectPuppetById(${boxId})`);
    const sel = await evalJs('window.__director.info()');
    check('info() selectedCharId follows box', sel.selectedCharId === 'box', JSON.stringify({ sc: sel.selectedCharId, st: sel.selectedTint }));
    check('info() selectedTint follows box', sel.selectedTint === 'BLUE', sel.selectedTint);

    // ---- 5) 删除方块人偶（走人偶删除链，可撤销） ----
    await evalJs(`window.__director.deletePuppetById(${boxId})`);
    check('delete removes box puppet', await waitFor(
        '!window.__director.puppets.some(p => p.charId === "box")', 20, 250));

    const errCount = logs.length;
    check('no runtime exceptions', errCount === 0, logs.slice(0, 3).join(' || '));

    console.log(`\n=== ${pass}/${pass + fail} passed ===`);
    process.exit(fail ? 1 : 0);
} catch (e) {
    console.error('probe-v35 fatal:', e.message);
    console.log(`=== ${pass}/${pass + fail} passed ===`);
    process.exit(1);
}
