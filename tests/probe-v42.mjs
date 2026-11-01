// probe-v42.mjs — v42：画幅下拉（机位独立/可撤销/旧档兼容）、按画幅渲染、机位视角安全框
// 注：headless WebGPU 的 createBuffer 有实现上限，B 项用 spy 捕获 startOffscreenMode
// 收到的尺寸验证画幅数学（真机渲染路径已有 v21/v22 真机验证背书）。
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('www');
const PORT = 4205;
const CDP = 9265;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
if (!fs.existsSync(EDGE)) { console.error('Edge not found'); process.exit(1); }

const free = port => new Promise(res => {
    const s = net.createServer(); s.once('error', () => res(false));
    s.once('listening', () => s.close(() => res(true))); s.listen(port, '127.0.0.1');
});
if (!(await free(PORT)) || !(await free(CDP))) { console.error('PORT BUSY'); process.exit(1); }

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const prof = path.join(process.env.TEMP, 'edge_v42_' + Date.now());
const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--enable-unsafe-webgpu', '--use-angle=d3d11',
    `--remote-debugging-port=${CDP}`, `--user-data-dir=${prof}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=390,844',
    `http://127.0.0.1:${PORT}/`
], { stdio: 'ignore' });
const cleanup = () => { try { srv.kill(); } catch {} try { edge.kill(); } catch {} };
process.on('exit', cleanup);
srv.on('exit', () => { console.error('TEST ERROR: staticsrv exited early'); process.exit(1); });

let ws = null;
for (let i = 0; i < 30 && !ws; i++) {
    try {
        const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
        const page = list.find(t => t.type === 'page' && (t.url || '').includes(':' + PORT));
        if (page) ws = await new Promise((res, rej) => {
            const w = new WebSocket(page.webSocketDebuggerUrl);
            w.onopen = () => res(w); w.onerror = rej;
            setTimeout(() => rej(new Error('ws timeout')), 5000);
        });
    } catch {}
    if (!ws) await sleep(1000);
}
if (!ws) { console.error('TEST ERROR: CDP not ready'); process.exit(1); }

let wsAlive = true;
ws.onclose = () => { wsAlive = false; };
const pending = new Map();
let msgId = 0;
const logs = [];
ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown')
        logs.push(String(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || 'EXC'));
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m); pending.delete(m.id); }
};
const send = (method, params = {}) => {
    if (!wsAlive) return Promise.reject(new Error('ws closed'));
    return new Promise((resolve, reject) => {
        const id = ++msgId;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
        setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('eval timeout')); } }, 30000);
    });
};
const evalJs = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result?.value;
};
const waitFor = async (expr, tries = 60, gap = 400) => {
    for (let i = 0; i < tries; i++) {
        if (await evalJs(expr).catch(() => false)) return true;
        await sleep(gap);
    }
    return false;
};

const results = [];
const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

try {
    check('editor ready', await waitFor('!!window.scene', 100, 500));
    check('director ready', await waitFor('!!window.__director', 60, 500));
    check('dock ready', await waitFor('document.body.classList.contains("sd-docks-ready")', 60, 500));
    const ver = await evalJs('window.__directorVer || "none"');
    check('engine version gate', ver === 'v42b-frame-bars', 'got=' + ver);
    if (ver !== 'v42b-frame-bars') throw new Error('stale page: ' + ver);

    // 清场
    await evalJs(`(() => { const d = window.__director;
        d.listShots().slice().forEach(s => d.removeShot(s.id));
        return true; })()`);

    // ---- A：画幅下拉存在 + 选中机位才可改 + 机位独立持久 + 可撤销 + 旧档兼容 ----
    const a = await evalJs(`(async () => {
        const d = window.__director, E = window.__directorEvents;
        // 先打开机位面板（fill/syncViewUI 才会跑，门控态才刷新）
        const grp = Array.from(document.querySelectorAll('.sd-grp-btn'))
            .find(b => (((b.querySelector('.sd-name') || {}).textContent) || '').indexOf('机位') >= 0);
        if (!grp) return { err: 'no-shot-group' };
        grp.click();
        await new Promise(r => setTimeout(r, 400));
        document.dispatchEvent(new CustomEvent('director-state', { detail: { what: 'shot' } }));
        await new Promise(r => setTimeout(r, 200));
        const sel = document.querySelector('[data-shot="aspect"]');
        if (!sel) return { err: 'no-aspect-select' };
        const opts = Array.from(sel.options).map(o => o.value);
        const disabledNoShot = sel.disabled;              // 无机位时禁用
        const addBtn = document.querySelector('[data-shot="add"]');
        if (!addBtn) return { err: 'no-add-btn' };
        addBtn.click();                                    // 走面板新增：addShot + fill + 自动选中
        await new Promise(r => setTimeout(r, 400));
        const enabledAfterSelect = !sel.disabled;         // 选中机位后可改
        const list = document.querySelector('.sd-shot-list');
        const shotId = Number(list.value);
        if (!shotId) return { err: 'no-shot-selected', listVal: list.value };
        sel.value = '9:16';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 300));
        const afterSet = d.listShots().find(x => x.id === shotId).aspect;
        E.fire('edit.undo');
        await new Promise(r => setTimeout(r, 400));
        const afterUndo = d.listShots().find(x => x.id === shotId).aspect;
        E.fire('edit.redo');
        await new Promise(r => setTimeout(r, 400));
        const afterRedo = d.listShots().find(x => x.id === shotId).aspect;
        // 旧档兼容：快照删掉 aspect 再恢复 → 默认 16:9
        const snap = d.projectSnapshot();
        delete snap.shots[0].aspect;
        delete snap.shots[0].base.aspect;
        const r2 = await d.restoreProject(snap);
        await new Promise(r => setTimeout(r, 300));
        const rec2 = d.listShots().find(x => x.name && x.name.indexOf('机位') === 0);
        d.listShots().slice().forEach(x => d.removeShot(x.id));
        return { opts, disabledNoShot, enabledAfterSelect, shotId, afterSet, afterUndo, afterRedo,
                 restore: r2, legacyAspect: rec2 ? rec2.aspect : 'gone' };
    })()`);
    check('A aspect dropdown with 7 ratios, gated on shot selection',
        Array.isArray(a.opts) && ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21'].every(k => a.opts.includes(k)) &&
        a.disabledNoShot === true && a.enabledAfterSelect === true,
        JSON.stringify(a.opts || a));
    check('A dock change persists aspect per shot (9:16)',
        a.afterSet === '9:16', JSON.stringify(a));
    check('A aspect edit is undoable (undo→16:9, redo→9:16)',
        a.afterUndo === '16:9' && a.afterRedo === '9:16', JSON.stringify(a));
    check('A legacy project without aspect defaults to 16:9',
        a.restore && a.restore.ok === true && a.legacyAspect === '16:9', JSON.stringify(a));

    // ---- B：渲染按画幅出图（spy 捕获 startOffscreenMode 尺寸；headless GPU 不真渲染）----
    const b = await evalJs(`(async () => {
        const d = window.__director;
        const s = d.addShot();
        const cam = window.scene.camera;
        const seen = [];
        const orig = cam.startOffscreenMode.bind(cam);
        cam.startOffscreenMode = (w, h) => { seen.push([w, h]); throw new Error('spy-stop'); };
        const out = {};
        for (const key of ['16:9', '9:16', '1:1', '21:9', '3:4']) {
            d.updateShot(s.id, { aspect: key });
            await new Promise(r => setTimeout(r, 150));
            await d.renderShot(s.id);
            out[key] = seen[seen.length - 1] || null;
        }
        await d.renderShot(s.id, 640, 480);           // 显式参数仍然优先
        out.explicit = seen[seen.length - 1] || null;
        cam.startOffscreenMode = orig;
        d.listShots().slice().forEach(x => d.removeShot(x.id));
        return out;
    })()`);
    const eq = (v, t) => Array.isArray(v) && v[0] === t[0] && v[1] === t[1];
    check('B renderShot sizes follow shot aspect (long side 1280)',
        eq(b['16:9'], [1280, 720]) && eq(b['9:16'], [720, 1280]) && eq(b['1:1'], [1280, 1280]) &&
        eq(b['21:9'], [1280, 549]) && eq(b['3:4'], [960, 1280]), JSON.stringify(b));
    check('B explicit renderShot args still win (640x480)',
        eq(b.explicit, [640, 480]), JSON.stringify(b));

    // ---- C：机位视角安全框（框几何 = 照片取景范围，按实际视口镜像公式断言）----
    const c = await evalJs(`(async () => {
        const d = window.__director;
        const s = d.addShot();
        const shotFov = d.listShots().find(x => x.id === s.id).fov;
        d.updateShot(s.id, { aspect: '16:9' });
        const ts = window.scene.camera.targetSize;
        const sw = ts.width, sh = ts.height;
        const enterR = d.enterShotView(s.id);
        await new Promise(r2 => setTimeout(r2, 600));
        const el = document.querySelector('.sd-shot-frame3d');
        const grab = () => {
            if (!el || el.style.display === 'none') return null;
            const box = el.querySelector('.sd-sf-box');
            return box ? [box.offsetWidth, box.offsetHeight] : null;
        };
        const f169 = grab();
        const camFov169 = Math.round(window.scene.camera.fov);
        d.updateShot(s.id, { aspect: '9:21' });
        await new Promise(r2 => setTimeout(r2, 400));
        const f921 = grab();
        d.updateShot(s.id, { aspect: '1:1' });
        await new Promise(r2 => setTimeout(r2, 400));
        const f11 = grab();
        const exitR = d.exitShotView(false);
        await new Promise(r2 => setTimeout(r2, 200));
        const gone = !document.querySelector('.sd-shot-frame3d');
        d.listShots().slice().forEach(x => d.removeShot(x.id));
        const bars = ['sd-sf-t', 'sd-sf-b', 'sd-sf-l', 'sd-sf-r'].every(c2 => !!el.querySelector('.' + c2));
        return { enterR, sw, sh, shotFov: Math.round(shotFov), camFov169, f169, f921, f11, exitR, gone, bars };
    })()`);
    const ratioOf = v => Array.isArray(v) && v[1] > 0 ? v[0] / v[1] : -1;
    check('C safe frame 16:9 fills width, bars top/bottom, ratio ≈ 16:9',
        c.enterR === 'ok' && c.bars === true && ratioOf(c.f169) > 16 / 9 - 0.05 && ratioOf(c.f169) < 16 / 9 + 0.05 &&
        c.f169[0] <= c.sw + 2 && c.f169[1] < c.sh - 30, JSON.stringify(c));
    check('C safe frame 9:21 fills height, side bars; 1:1 square-ish',
        ratioOf(c.f921) > 9 / 21 - 0.04 && ratioOf(c.f921) < 9 / 21 + 0.04 &&
        c.f921[1] <= c.sh + 2 && c.f921[0] < c.sw - 30 &&
        Math.abs(ratioOf(c.f11) - 1) < 0.06, JSON.stringify(c));
    check('C display fov widened beyond shot fov; frame removed on exit',
        c.camFov169 > c.shotFov && c.exitR === 'ok-discarded' && c.gone === true,
        `shotFov=${c.shotFov} camFov=${c.camFov169} exitR=${c.exitR} gone=${c.gone}`);

    // ---- 无异常 ----
    const errs = logs.filter(l => /EXC|Uncaught|Cannot read|is not a function/.test(l));
    check('no runtime exceptions', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
    console.error('TEST ERROR:', e.message);
    process.exitCode = 1;
} finally {
    const failed = results.filter(r => !r.ok).length;
    console.log(`\n=== ${results.length - failed}/${results.length} passed ===`);
    setTimeout(() => process.exit(failed || process.exitCode ? 1 : 0), 300);
}
