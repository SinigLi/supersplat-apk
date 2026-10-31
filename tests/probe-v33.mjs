/* tests/probe-v33.mjs - v33 老板 2026-10-31 08:08 五条反馈探针
 *
 *   1. 机位改名/重定位/确定/取消按钮加大 3 倍（2.5rem → 7.5rem）
 *   2. 测量按钮收进「定位」分组面板（视图栏不再有）
 *   3. 弹窗/二级页面（场景/外观/浮层/设置/对话框）半透明 --sd-alpha
 *   4. 底栏「游标」+「移动」合并为「游标相关」组（三钮：设置游标/移动模型/复制模型，图文并列）
 *   5. 框选/回原点移入相机分组（轨道/飞行旁），注释补充语义
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('www');
const PORT = 4197;
const CDP = 9257;
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
    '--user-data-dir=' + path.join(process.env.TEMP, 'edge_v33_profile'),
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

    // ---- 1) mini 按钮尺寸（v34 老板反馈太大减半：预期 56–100px）；先建机位并打开改名行，否则确定/取消钮 display:none 量不到 ----
    const sizes = await evalJs(`(async () => {
        const d = window.__director;
        if (!d.listShots().length) d.addShot();
        const wrap = document.querySelector('.sd-shot-panel');
        const list = wrap.querySelector('.sd-shot-list');
        list.value = String(d.listShots()[0].id);
        wrap.querySelector('[data-shot="rename"]').click();
        await new Promise(r => setTimeout(r, 80));
        const pick = (sel) => { const b = document.querySelector(sel); return b ? getComputedStyle(b).width : null; };
        return {
            rename: pick('[data-shot="rename"]'),
            relocate: pick('[data-shot="relocate"]'),
            ok: pick('[data-shot="rename-ok"]'),
            no: pick('[data-shot="rename-no"]')
        };
    })()`);
    const px = v => v ? parseFloat(v) : 0;
    check('rename/relocate/ok/no buttons halved (56-100px)',
        [sizes.rename, sizes.relocate, sizes.ok, sizes.no].every(v => px(v) >= 56 && px(v) < 100), JSON.stringify(sizes));

    // ---- 2) 测量按钮在定位组面板里，视图栏没有 ----
    const measure = await evalJs(`(() => {
        const mb = document.getElementById('bottom-toolbar-measure');
        if (!mb) return { exists: false };
        const anchorWrap = Array.from(document.querySelectorAll('.sd-sub-wrap')).find(w => w.querySelector('.sd-anchor-btn'));
        return { exists: true,
                 inAnchorPanel: !!(anchorWrap && anchorWrap.contains(mb)),
                 inViewDock: !!document.querySelector('.sd-dock[data-dock="view"]') && Array.from(document.querySelectorAll('.sd-dock[data-dock="view"] *')).some(el => el === mb) };
    })()`);
    check('measure lives in anchor panel, not view dock',
        measure.exists === true && measure.inAnchorPanel === true && measure.inViewDock === false, JSON.stringify(measure));

    // ---- 3) 二级页面半透明（场景页要先打开，否则基础规则不匹配）----
    const translucent = await evalJs(`(() => {
        document.querySelector('.sd-dir-scene')?.click();
        const bg = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).backgroundColor : 'missing'; };
        const out = { scene: bg('#scene-panel'), settings: bg('#settings-panel'),
                      appearance: bg('#appearance-panel'), dialog: bg('#dialog') };
        document.querySelector('.sd-dir-scene')?.click();
        document.body.classList.remove('sd-scene-open');
        return out;
    })()`);
    const isTranslucent = v => /rgba\(24, 27, 31, 0\.6\)/.test(v);
    const isDialogT = v => /rgba\(27, 30, 35, 0\.6\)/.test(v);
    check('scene/settings/appearance panels translucent (alpha .6)',
        isTranslucent(translucent.scene) && isTranslucent(translucent.settings) && isTranslucent(translucent.appearance),
        JSON.stringify(translucent));
    check('dialog translucent (alpha .6)', isDialogT(translucent.dialog), translucent.dialog);

    // ---- 4) 底栏游标相关组合并 ----
    const bar = await evalJs(`(() => [...document.querySelectorAll('.sd-dir-act')].map(b => b.dataset.act))()`);
    check('bottom bar = cursorgrp/xform/director (old cursor & movegroup gone)',
        JSON.stringify(bar) === JSON.stringify(['cursorgrp', 'xform', 'director']), JSON.stringify(bar));
    const cur = await evalJs(`(() => {
        const w = document.querySelector('.sd-sub-wrap[data-grp="cursorgrp"]');
        if (!w) return null;
        const btns = Array.from(w.querySelectorAll('.sd-cur-btn'));
        return { n: btns.length,
                 texts: btns.map(b => (b.querySelector('.sd-txt')||{}).textContent),
                 hasIco: btns.every(b => !!b.querySelector('.sd-ico')) };
    })()`);
    check('cursorgrp: 3 buttons icon+text (设置游标/移动模型/复制模型)',
        !!cur && cur.n === 3 && cur.hasIco === true &&
        JSON.stringify(cur.texts) === JSON.stringify(['设置游标', '移动模型', '复制模型']), JSON.stringify(cur));
    // 三钮功能冒烟：armPlaceCursor 直接调 API 验证拨动语义（首次 place-cursor，再次非 place-cursor = 取消）
    const cursorArm = await evalJs(`(() => {
        const d = window.__director;
        const r1 = d.armPlaceCursor();
        const r2 = d.armPlaceCursor();
        return { r1, r2 };
    })()`);
    check('cursor arm toggles (place-cursor -> cancel)',
        cursorArm?.r1 === 'place-cursor' && cursorArm?.r2 !== 'place-cursor', JSON.stringify(cursorArm));

    // ---- 5) 相机组四钮（轨道/飞行/框选/回原点）+ 注释 ----
    const cam = await evalJs(`(() => {
        const modes = document.querySelector('.sd-shot-panel .sd-cam-modes');
        const hint = document.querySelector('.sd-shot-panel .sd-mode-hint');
        return { adopted: modes ? modes.querySelectorAll('.sd-adopted').length : -1,
                 hint: hint ? hint.textContent : null };
    })()`);
    check('camera panel: 4 adopted mode buttons + extended hint',
        cam.adopted === 4 && /框选/.test(cam.hint || '') && /回原点/.test(cam.hint || ''), JSON.stringify(cam));

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
