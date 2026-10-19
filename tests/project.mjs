/* tests/project.mjs - 工程管理端到端回归（Edge + CDP，390x844）
 *
 * 覆盖 v28 工程管理的完整闭环：
 *   新建工程 → 导入泼溅模型 → 摆人偶（位置/颜色/动作）→ 保存
 *   → 校验 zip 内容（state.json + 内嵌模型）→ 返回列表（缩略图/标记）
 *   → 重新打开 → 场景还原（人偶/模型/相机）→ 脏检查为干净
 *   → 删除工程
 *
 * 用法：在 supersplat-apk 仓库根执行 `node tests/project.mjs`
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('www');
const PORT = 4197;
const CDP = 9257;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 测试用泼溅模型：从 spike 借一份，跑完删掉，不进仓库
const PLY_SRC = path.resolve('spike/glb-load-test/splat.ply');
const PLY_DST = path.resolve('www/__test_splat.ply');
let plyCopied = false;

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

if (!fs.existsSync(PLY_SRC)) throw new Error('缺少测试模型: ' + PLY_SRC);
fs.copyFileSync(PLY_SRC, PLY_DST);
plyCopied = true;

const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore' });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + path.join(process.env.TEMP, 'edge_v28_profile'),
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

    // ---- 0) 模块就位 ----
    check('editor ready', await waitFor('!!(window.__director && window.scene && window.scene.events)', 80));
    check('project logic loaded', await evalJs('!!window.__projectLogic'));
    check('project ui loaded', await evalJs('!!window.__projects'));
    check('fflate loaded', await evalJs('!!window.fflate'));

    // ---- 1) 启动落在工程页 ----
    const startPage = await evalJs(`(() => ({
        pageOpen: document.getElementById('pjPage').classList.contains('open'),
        barOpen: document.querySelector('.pj-bar').classList.contains('open')
    }))()`);
    check('starts on project page', startPage.pageOpen === true && startPage.barOpen === false,
        JSON.stringify(startPage));

    // 清掉上一次跑残留
    await evalJs(`(async () => {
        const L = window.__projectLogic;
        for (const p of (L.loadRegistry().projects || [])) {
            await L.store().remove(L.pathsFor(p.name).dir).catch(() => {});
        }
        L.saveRegistry({ projects: [] });
        window.__projects.list();
    })()`);
    await sleep(300);

    // ---- 2) 新建工程 ----
    const NAME = '测试工程A';
    await evalJs(`window.__projects.create(${JSON.stringify(NAME)})`);
    await sleep(600);
    const afterCreate = await evalJs(`(() => ({
        cur: window.__projects.current(),
        pageOpen: document.getElementById('pjPage').classList.contains('open'),
        barOpen: document.querySelector('.pj-bar').classList.contains('open')
    }))()`);
    check('project created + editor shown', afterCreate.cur === NAME && afterCreate.pageOpen === false && afterCreate.barOpen === true,
        JSON.stringify(afterCreate));

    // ---- 3) 导入泼溅模型 ----
    const modelName = await evalJs(`(async () => {
        const buf = await (await fetch('/__test_splat.ply')).arrayBuffer();
        const f = new File([buf], 'test.ply');
        await window.scene.events.invoke('import', [{ filename: 'test.ply', contents: f }]);
        return 'ok';
    })()`);
    check('model imported', modelName === 'ok');

    const splatReady = await waitFor(`(() => {
        // ElementType 是字符串枚举：splat = 'splat'（不是数字下标）
        try { return window.scene.getElementsByType('splat').length > 0; } catch (e) { return false; }
    })()`, 80, 500);
    check('splat element in scene', splatReady);

    const kept = await evalJs(`(() => {
        const s = window.__director.projectModel();
        return s ? { name: s.name, bytes: s.bytes.length } : null;
    })()`);
    check('source bytes retained', !!kept && kept.bytes > 1000000, JSON.stringify(kept));

    // ---- 4) 摆人偶并改状态 ----
    const CHAR = 'shiba';
    await evalJs(`window.__director.switchCharacter(${JSON.stringify(CHAR)})`);
    await waitFor(`!!(window.__director.charSlots.${CHAR} && window.__director.charSlots.${CHAR}.template)`, 60, 400);
    await evalJs(`(() => {
        const d = window.__director;
        const v = d.cursorRoot.getLocalPosition().clone();
        v.set(1.2, 0, -0.8);
        d.placeCursor(v);
        d.addPuppet();
    })()`);
    await sleep(800);

    const posed = await evalJs(`(() => {
        const d = window.__director;
        const p = d.puppets.at(-1);
        if (!p) return null;
        d.selectPuppet(p);
        d.setTintById(p.id, 'RED');
        d.setClip(2, p);
        p.entity.setLocalPosition(1.25, 0, -0.75);
        const q = p.entity.getLocalPosition();
        return { name: p.name, charId: p.charId, x: +q.x.toFixed(2), z: +q.z.toFixed(2), tint: p.tint, clip: p.clip };
    })()`);
    check('puppet posed (tint/clip/pos)', !!posed && posed.tint === 'RED' && posed.clip === 2,
        JSON.stringify(posed));

    // ---- 5) 保存 ----
    const saved = await evalJs(`window.__projects.save()`);
    check('save returned ok', saved === true);

    const zipInfo = await evalJs(`(async () => {
        const L = window.__projectLogic;
        const p = L.pathsFor(${JSON.stringify(NAME)});
        const bytes = await L.store().read(p.proj);
        const parsed = L.parseProjectFile(bytes);
        const st = parsed.state;
        return {
            size: bytes.length,
            magic: String.fromCharCode(bytes[0], bytes[1]),
            version: st.version,
            puppets: (st.puppets || []).length,
            hasModel: !!st.model,
            modelPath: st.model && st.model.path,
            fileKeys: Object.keys(parsed.files || {}),
            modelBytes: st.model && parsed.files[st.model.path] ? parsed.files[st.model.path].length : 0,
            firstPuppet: (st.puppets || [])[0] || null
        };
    })()`);
    check('zip is a real zip', zipInfo?.magic === 'PK', JSON.stringify({ magic: zipInfo?.magic, size: zipInfo?.size }));
    check('state.json version 1', zipInfo?.version === 1);
    check('puppet recorded', zipInfo?.puppets === 1, `n=${zipInfo?.puppets}`);
    check('model embedded in archive', zipInfo?.hasModel === true && zipInfo?.modelBytes > 1000000,
        JSON.stringify({ path: zipInfo?.modelPath, bytes: zipInfo?.modelBytes }));
    check('puppet state persisted', zipInfo?.firstPuppet?.tint === 'RED' && zipInfo?.firstPuppet?.clip === 2,
        JSON.stringify(zipInfo?.firstPuppet));

    // 缩略图
    const thumb = await evalJs(`(async () => {
        const L = window.__projectLogic;
        try {
            const b = await L.store().read(L.pathsFor(${JSON.stringify(NAME)}).thumb);
            return { bytes: b.length, jpeg: b[0] === 0xFF && b[1] === 0xD8 };
        } catch (e) { return { err: String(e && e.message || e) }; }
    })()`);
    check('thumbnail written', !!thumb && thumb.jpeg === true, JSON.stringify(thumb));

    // ---- 6) 返回列表 ----
    await evalJs(`window.__projects.back()`);
    await sleep(600);
    const listState = await evalJs(`(() => {
        const reg = window.__projectLogic.loadRegistry();
        const cards = document.querySelectorAll('.pj-card');
        const item = (reg.projects || []).find(p => p.name === ${JSON.stringify(NAME)});
        return { cards: cards.length, hasModel: !!(item && item.hasModel), updatedAt: item && item.updatedAt };
    })()`);
    check('project listed with model flag', listState.cards === 1 && listState.hasModel === true,
        JSON.stringify(listState));

    // ---- 7) 重新打开并验证还原 ----
    await evalJs(`window.__projects.open(${JSON.stringify(NAME)})`);
    const reopened = await waitFor(`window.__projects.current() === ${JSON.stringify(NAME)}`, 80, 500);
    check('project reopened', reopened === true);

    const restored = await evalJs(`(() => {
        const d = window.__director;
        const p = d.puppets.at(-1);
        // ElementType 是字符串枚举，不依赖会被压缩的类名
        let splats = 0;
        try { splats = window.scene.getElementsByType('splat').length; } catch (e) { splats = -1; }
        const model = d.projectModel ? d.projectModel() : null;
        const q = p ? p.entity.getLocalPosition() : null;
        return {
            puppets: d.puppets.length,
            splats: splats,
            modelBytes: model ? model.bytes.length : 0,
            modelName: model ? model.name : null,
            charId: p && p.charId,
            name: p && p.name,
            tint: p && p.tint,
            clip: p && p.clip,
            x: q ? +q.x.toFixed(2) : null,
            z: q ? +q.z.toFixed(2) : null
        };
    })()`);
    check('puppet restored', restored?.puppets === 1 && restored?.charId === CHAR, JSON.stringify(restored));
    check('puppet transform/state restored',
        restored?.x === 1.25 && restored?.z === -0.75 && restored?.tint === 'RED' && restored?.clip === 2,
        JSON.stringify(restored));
    check('model restored in scene', restored?.splats === 1 && restored?.modelBytes > 1000000,
        JSON.stringify({ splats: restored?.splats, bytes: restored?.modelBytes }));

    // ---- 8) 刚开完不该是脏的 ----
    const clean = await evalJs(`(() => {
        const L = window.__projectLogic;
        const snap = window.__director.projectSnapshot();
        return { dirty: L.isDirty(snap, snap) };
    })()`);
    check('freshly opened project is clean', clean?.dirty === false, JSON.stringify(clean));

    const dirtyAfterMove = await evalJs(`(() => {
        const L = window.__projectLogic;
        const before = window.__director.projectSnapshot();
        const p = window.__director.puppets.at(-1);
        p.entity.setLocalPosition(9, 0, 9);
        const after = window.__director.projectSnapshot();
        return L.isDirty(after, before);
    })()`);
    check('moving a puppet registers as dirty', dirtyAfterMove === true);

    // ---- 9) 删除工程 ----
    const cleaned = await evalJs(`(async () => {
        const L = window.__projectLogic;
        await L.store().remove(L.pathsFor(${JSON.stringify(NAME)}).dir);
        L.saveRegistry(L.removeProject(L.loadRegistry(), ${JSON.stringify(NAME)}));
        return (L.loadRegistry().projects || []).length;
    })()`);
    check('project deleted', cleaned === 0, `remaining=${cleaned}`);

    // ---- 10) 无异常 ----
    const errs = logs.filter(l => /EXC|Uncaught|Cannot read|is not a function/.test(l));
    check('no runtime exceptions', errs.length === 0, errs.slice(0, 3).join(' | '));

    await send('Page.captureScreenshot', { format: 'png' }).then(r => {
        fs.writeFileSync('shot_v28_project.png', Buffer.from(r.data, 'base64'));
        console.log('screenshot -> shot_v28_project.png');
    }).catch(() => {});
} catch (e) {
    console.error('TEST ERROR:', e.message);
} finally {
    const failed = results.filter(r => !r.ok).length;
    console.log(`\n=== ${results.length - failed}/${results.length} passed ===`);
    fs.writeFileSync('v28_result.json', JSON.stringify({ results, logs: logs.slice(0, 40) }, null, 2));
    try { ws?.close(); } catch {}
    edge.kill();
    srv.kill();
    if (plyCopied) {
        try { fs.unlinkSync(PLY_DST); } catch {}
    }
    setTimeout(() => process.exit(failed ? 1 : 0), 300);
}
