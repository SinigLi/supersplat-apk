/* tests/probe-v40.mjs - v40 三项反馈探针（Edge + CDP，390x844）
 *
 * 老板 2026-11-01 12:39 反馈：
 *   A. 控件高度缩小 30%（min-height rem 比值断言）
 *   B. 拖动改「双击长按」：单击长按不再触发拖动；双击第二击按住才拖
 *   C. 自机位白框：近裁剪≈0 时视口附近（<2m）的机位标记必须隐藏（老板：
 *      「就算近裁剪设为 0 也不应该看到当前机位的模型框」）
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve('www');
const PORT = 4204;
const CDP = 9264;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getWs() {
    for (let i = 0; i < 60; i++) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
            const page = list.find(t => t.type === 'page' && (t.url || '').includes(':' + PORT));
            if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
        } catch {}
        await sleep(500);
    }
    throw new Error('CDP not ready');
}

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + path.join(process.env.TEMP, 'edge_v40_' + Date.now()),
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

// 单击长按（无前置点击）：按住 holdMs 后横移再松手；返回拖动类标记与值变化
async function singleHoldDrag(sel, holdMs, dx) {
    return evalJs(`(async () => {
        const el = document.querySelector('${sel}');
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
        const v0 = el.querySelector('.sd-dv-v').textContent;
        el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, clientX: cx, clientY: cy, bubbles: true }));
        await new Promise(r2 => setTimeout(r2, ${holdMs}));
        const clsMid = el.className;
        el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: cx + ${dx}, clientY: cy, bubbles: true }));
        await new Promise(r2 => setTimeout(r2, 40));
        el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: cx + ${dx}, clientY: cy, bubbles: true }));
        await new Promise(r2 => setTimeout(r2, 150));
        return { clsMid, v0, v1: el.querySelector('.sd-dv-v').textContent, editing: !!el.__editing };
    })()`);
}

// 双击第二击按住：第一击轻点 → 第二击按住 holdMs → 横移 → 松手
async function dblHoldDrag(sel, holdMs, dx) {
    return evalJs(`(async () => {
        const el = document.querySelector('${sel}');
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
        const dn = x => el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, clientX: x, clientY: cy, bubbles: true }));
        const up = x => el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: x, clientY: cy, bubbles: true }));
        dn(cx); await new Promise(r2 => setTimeout(r2, 40)); up(cx);
        await new Promise(r2 => setTimeout(r2, 60));
        dn(cx); await new Promise(r2 => setTimeout(r2, ${holdMs}));
        const clsMid = el.className;
        el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: cx + ${dx}, clientY: cy, bubbles: true }));
        await new Promise(r2 => setTimeout(r2, 40));
        up(cx + ${dx});
        await new Promise(r2 => setTimeout(r2, 150));
        return { clsMid };
    })()`);
}

try {
    ws = new WebSocket(await getWs());
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.method === 'Runtime.exceptionThrown') logs.push(String(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || 'EXC'));
        if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result ?? m); pending.delete(m.id); }
    };
    await send('Page.enable');
    check('editor ready', await waitFor('!!window.scene', 100, 500));
    check('director ready', await waitFor('!!window.__director', 60, 500));
    check('dock ready', await waitFor('document.body.classList.contains("sd-docks-ready")', 60, 500));

    // 清场：删掉历史机位
    await evalJs(`(() => { const d = window.__director;
        d.listShots().slice().forEach(s => d.removeShot(s.id));
        d.setClipRange({ enabled: false });
        return true; })()`);

    // ---- A：控件高度（rem 比值锁定 30% 收缩） ----
    const openVp = await evalJs(`(() => {
        const dock = document.querySelector('.sd-dock[data-dock="view"]');
        const g = Array.from(dock.querySelectorAll('.sd-grp-btn')).find(b => (b.querySelector('.sd-name') || {}).textContent === '视口');
        if (g) g.click();
        return true;
    })()`);
    await sleep(500);
    const heights = await evalJs(`(async () => {
        const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
        const ratio = sel => {
            const el = document.querySelector(sel);
            if (!el) return null;
            return +(parseFloat(getComputedStyle(el).minHeight) / root).toFixed(2);
        };
        const css = await fetch('/dock.css').then(r => r.text());
        return {
            num: ratio('.sd-num'),
            nudge: ratio('.sd-shot-panel .sd-nudge-btn'),
            rot: ratio('.sd-shot-panel .sd-rot-btn'),
            base31: css.includes('min-height:31px'),
            vp31: css.includes('min-height:3.1rem'),
            oldGone: !css.includes('min-height:4.5rem') && !css.includes('min-height:4.4rem')
        };
    })()`);
    check('A control heights shrunk ~30% (was 4.4-4.5rem / 44px)',
        heights.num >= 2.6 && heights.num <= 3.0 &&
        heights.nudge >= 3.0 && heights.nudge <= 3.3 &&
        heights.rot >= 2.9 && heights.rot <= 3.3 &&
        heights.base31 === true && heights.vp31 === true && heights.oldGone === true, JSON.stringify(heights));

    // ---- B：单击长按不拖动；双击长按才拖动 ----
    const single = await singleHoldDrag('#vp-near', 500, 60);
    check('B single long-press does NOT arm drag',
        !/sd-dv-drag/.test(single.clsMid) && single.v0 === single.v1 && !single.editing, JSON.stringify(single));
    await sleep(500);   // 冷却：单击用例的 lastTap 还热着，立即双击会被判成双击进编辑
    const dbl = await dblHoldDrag('#vp-near', 400, 60);
    check('B double-tap-hold arms drag', /sd-dv-drag/.test(dbl.clsMid), JSON.stringify(dbl));

    // ---- C：自机位白框隐藏（近裁剪≈0 时 <2m 的机位标记必须隐藏） ----
    // 场景构造：addShot 后 enter→nudge fwd 30→exit（discard）→ 相机停在原点，标记在 30m 外
    const marker = await evalJs(`(async () => {
        const d = window.__director;
        const s = d.addShot();
        d.enterShotView(s.id);            // 相机钉到机位
        d.nudgeShot(s.id, 'fwd', 30);     // 机位推到视线前方 30m
        d.exitShotView(false);            // 丢弃退出：相机回到进入时的位姿（距标记 30m）
        await new Promise(r => setTimeout(r, 300));
        const m = window.scene.app.root.findByName('shot-marker-' + s.id);
        if (!m) return { err: 'no-marker-entity' };
        // 近裁剪≈0：旧逻辑下 30m 外的标记可见
        d.setClipRange({ enabled: true, near: 0.001, far: 100 });
        await new Promise(r => setTimeout(r, 400));
        const farVisible = m.enabled;
        // 拉回 1.5m（<2m）：自机位规则必须隐藏
        d.nudgeShot(s.id, 'back', 28.5);
        await new Promise(r => setTimeout(r, 400));
        const m2 = window.scene.app.root.findByName('shot-marker-' + s.id);
        const nearHidden = !m2.enabled;   // nudge 重建了标记实体，必须重查
        // 清理：删机位、关手动裁剪
        d.removeShot(s.id);
        d.setClipRange({ enabled: false });
        return { farVisible, nearHidden };
    })()`);
    check('C self-shot marker hidden within 2m even at near≈0',
        marker.farVisible === true && marker.nearHidden === true, JSON.stringify(marker));

    // ---- 无异常 ----
    const errs = logs.filter(l => /EXC|Uncaught|Cannot read|is not a function/.test(l));
    check('no runtime exceptions', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
    console.error('TEST ERROR:', e.message);
    process.exitCode = 1;
} finally {
    const failed = results.filter(r => !r.ok).length;
    console.log(`\n=== ${results.length - failed}/${results.length} passed ===`);
    if (!results.length || failed) process.exitCode = 1;
    try { ws?.close(); } catch {}
    edge.kill();
    srv.kill();
    setTimeout(() => process.exit(process.exitCode || 0), 300);
}
