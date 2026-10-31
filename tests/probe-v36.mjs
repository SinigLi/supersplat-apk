/* tests/probe-v36.mjs - v36 白色外包盒探针（Edge + CDP，390x844）
 *
 * 老板 2026-10-31：选中对象加白色外包盒边线显示（黄点有时看不清），
 * 泼溅和模型都要有，相机渲染时不要渲染出来。
 *
 * 覆盖：
 *   1) 选中人偶/道具/泼溅 → 白盒出现且中心贴合对象
 *   2) 移动对象 → 白盒逐帧跟随
 *   3) 取消选中 → 白盒隐藏
 *   4) 机位渲染（capturing）→ 渲染正常、渲染后白盒状态恢复
 *
 * 用法：仓库根执行 `node tests/probe-v36.mjs`
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('www');
const PORT = 4206;
const CDP = 9266;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PLY_SRC = path.resolve('spike/glb-load-test/splat.ply');
const PLY_DST = path.resolve('www/__test_splat.ply');
let plyCopied = false;

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + path.join(process.env.TEMP, 'edge_v36_profile'),
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
const results = [];
function check(name, ok, detail) {
    results.push({ ok: !!ok });
    if (ok) { pass++; console.log(`ok ${pass} - ${name}`); }
    else { fail++; console.log(`FAIL ${fail} - ${name}${detail ? ' | ' + detail : ''}`); }
}

process.on('exit', () => {
    try { srv.kill(); edge.kill(); } catch {}
    if (plyCopied) { try { fs.unlinkSync(PLY_DST); } catch {} }
});

try {
    if (!fs.existsSync(PLY_SRC)) throw new Error('缺少测试模型: ' + PLY_SRC);
    fs.copyFileSync(PLY_SRC, PLY_DST);
    plyCopied = true;

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

    const boxEntity = `window.scene.app.root.findByName("selection-box-marker")`;
    check('selection box entity exists', await evalJs(`!!${boxEntity}`));
    check('box has 12 edges', await evalJs(`${boxEntity}.children.length === 12`));
    check('box hidden before any selection', await evalJs(`!${boxEntity}.enabled`));

    // ---- 1) 人偶选中 → 白盒出现、中心贴合 ----
    await evalJs(`window.__director.switchCharacter("box")`);
    check('box character loads', await waitFor(
        'window.__director.info().chars.find(c => c.id === "box").loaded', 60, 500));
    await evalJs('window.__director.addPuppet()');
    check('box puppet spawned+selected', await waitFor(
        'window.__director.puppets.length === 1 && !!window.__director.selected', 40, 300));
    check('outline box enabled on puppet', await evalJs(`!!${boxEntity}.enabled`));
    const fit1 = await evalJs(`(() => {
        const b = ${boxEntity}.getPosition(), p = window.__director.selected.entity.getPosition();
        return Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z) < 0.6;
    })()`);
    check('outline box centered on puppet', fit1);

    // ---- 2) 移动人偶 → 白盒跟随 ----
    await evalJs(`(() => {
        const V3 = window.scene.app.root.getLocalPosition().constructor;
        window.__director.placeCursor(new V3(1.5, 0, 1.5));
        window.__director.moveSelectedToCursor();
    })()`);
    const followed = await waitFor(`(() => {
        const b = ${boxEntity}.getPosition(), p = window.__director.selected.entity.getPosition();
        return Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z) < 0.3;
    })()`, 30, 250);
    check('outline box follows moved puppet', followed);

    // ---- 3) 取消选中 → 白盒隐藏 ----
    await evalJs('window.__director.selectPuppetById(null)');
    check('outline box hidden after deselect', await waitFor(`!${boxEntity}.enabled`, 10, 200));

    // ---- 4) 道具导入（自动选中）→ 白盒出现 ----
    await evalJs(`(async () => {
        const resp = await fetch('static/director/box.glb');
        const buf = await resp.arrayBuffer();
        await window.__director.importModel(new File([buf], 'prop-box.glb'));
    })()`);
    check('prop imported+selected', await waitFor(
        'window.__director.listProps().length === 1 && !!window.__director.selectedProp', 40, 300));
    check('outline box enabled on prop', await evalJs(`!!${boxEntity}.enabled`));

    // ---- 5) 泼溅选中 → 白盒出现 ----
    await evalJs(`(async () => {
        const resp = await fetch('__test_splat.ply');
        const buf = await resp.arrayBuffer();
        await window.scene.events.invoke('import', [{ filename: 'test.ply', contents: new File([buf], 'test.ply') }]);
    })()`);
    check('splat imported', await waitFor(
        'window.scene.getElementsByType("splat").length === 1', 60, 500));
    await evalJs('window.__director.selectSplatByIndex(0)');
    check('outline box enabled on splat', await waitFor(`!!${boxEntity}.enabled`, 20, 250));

    // ---- 6) 机位渲染：渲染成功 + 白盒状态恢复（capturing 期间隐藏是同一条被 v21-v27 验证过的链路） ----
    await evalJs('window.__director.addShot()');
    const shotId = await evalJs('window.__director.listShots()[0].id');
    const rr = await evalJs(`window.__director.renderShot(${shotId})`);
    check('renderShot ok', !!rr && rr.ok === true, JSON.stringify(rr ? { ok: rr.ok, reason: rr.reason } : null));
    check('outline box restored after render', await evalJs(`!!${boxEntity}.enabled`));

    const errs = logs.filter(l => /EXC|Uncaught|Cannot read|is not a function/.test(l));
    check('no runtime exceptions', errs.length === 0, errs.slice(0, 3).join(' | '));

    console.log(`\n=== ${pass}/${pass + fail} passed ===`);
    try { ws?.close(); } catch {}
    edge.kill();
    srv.kill();
    setTimeout(() => process.exit(fail ? 1 : 0), 300);
} catch (e) {
    console.error('probe-v36 fatal:', e.message);
    console.log(`=== ${pass}/${pass + fail} passed ===`);
    process.exit(1);
}
