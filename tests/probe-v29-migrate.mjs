/* tests/probe-v29-migrate.mjs - legacy 工程流式迁移端到端探针（Edge + CDP）
 *
 * 真机 v29 首开 173MB 旧工程报 "Missing parent directory"（appendFile 建不了
 * files/ 父目录）后加的回归：在浏览器里造一个 v28 自包含 zip（state.json +
 * model.ply + 两个同字节 GLB 道具），直接调 migrateLegacyProject，验证
 *   1) project.json 落盘且引用指向 files/<sha1>
 *   2) 同字节条目去重（3 个引用 → 1 个文件）
 *   3) 字节数与原条目一致
 *   4) 旧 project.svproj 已删
 * 原生层父目录问题桌面测不到（web store 无目录概念），由代码审查 +
 * 插件 Kotlin 源码验证（appendFile→writeFile→getWriteFileOptions 读 recursive）。
 *
 * 用法：仓库根执行 `node tests/probe-v29-migrate.mjs`
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('www');
const PORT = 4198;
const CDP = 9258;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
    '--user-data-dir=' + path.join(process.env.TEMP, 'edge_v29mig_profile'),
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

const NAME = '迁移测试';

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
    check('project logic loaded', await evalJs('!!window.__projectLogic'));
    check('fflate has zipSync', await evalJs('typeof window.fflate.zipSync === "function"'));

    // ---- 1) 造 v28 legacy 工程并写进 store ----
    const seeded = await evalJs(`(async () => {
        const L = window.__projectLogic;
        const resp = await fetch('__test_splat.ply');
        const bytes = new Uint8Array(await resp.arrayBuffer());
        const state = {
            version: 1,
            model: { name: 'test.ply', path: 'model.ply' },
            puppets: [],
            props: [
                { name: 'p0', file: 'props/0.ply', pos: [0, 0, 0], rot: [0, 0, 0, 1] },
                { name: 'p1', file: 'props/1.ply', pos: [1, 0, 0], rot: [0, 0, 0, 1] }
            ],
            shots: [], camera: null, cursor: null
        };
        const zip = fflate.zipSync({
            'state.json': fflate.strToU8(JSON.stringify(state)),
            'model.ply': bytes,
            'props/0.ply': bytes,
            'props/1.ply': bytes
        }, { level: 0 });
        const p = L.pathsFor(${JSON.stringify(NAME)});
        await L.store().remove(p.dir).catch(() => {});
        await L.store().write(p.proj, zip);
        L.saveRegistry(L.upsertProject(L.loadRegistry(),
            { name: ${JSON.stringify(NAME)}, updatedAt: new Date().toISOString(), hasModel: true }));
        return { zipBytes: zip.length, modelLen: bytes.length };
    })()`);
    check('legacy zip seeded', seeded?.zipBytes > 2 * seeded?.modelLen,
        JSON.stringify(seeded));

    // ---- 2) 直接调流式迁移 ----
    const mig = await evalJs(`(async () => {
        const L = window.__projectLogic;
        const p = L.pathsFor(${JSON.stringify(NAME)});
        const state = await L.migrateLegacyProject(p);
        const refs = [];
        if (state.model && state.model.path) refs.push(state.model.path);
        (state.props || []).forEach(r => refs.push(r.file));
        const sizes = {};
        for (const ref of [...new Set(refs)]) {
            const u8 = await L.store().read(p.dir + '/' + ref);
            sizes[ref] = u8.length;
        }
        const legacy = await L.store().stat(p.proj);
        const stateStat = await L.store().stat(p.state);
        // files/ 下真实条目（.tmp 残留也算进去，迁移正常应无）
        return {
            modelPath: state.model && state.model.path,
            propRefs: (state.props || []).map(r => r.file),
            sizes: sizes,
            legacyStillThere: !!legacy && legacy.size > 0,
            stateWritten: !!stateStat && stateStat.size > 0
        };
    })()`);
    check('migration state written', mig?.stateWritten === true, JSON.stringify(mig?.sizes));
    check('model ref is content-addressed', String(mig?.modelPath || '').startsWith('files/'),
        mig?.modelPath);
    check('both props dedup to same file',
        mig?.propRefs?.length === 2 && mig.propRefs[0] === mig.propRefs[1] &&
        String(mig.propRefs[0]).startsWith('files/'),
        JSON.stringify(mig?.propRefs));
    check('model and prop bytes identical (dedup)',
        mig?.sizes && Object.keys(mig.sizes).length === 1 &&
        Object.values(mig.sizes)[0] === seeded?.modelLen,
        JSON.stringify(mig?.sizes));
    check('legacy zip removed after migration', mig?.legacyStillThere === false);

    // ---- 3) 迁移后的工程能正常打开（state + files 布局复用 open 流程）----
    await evalJs(`window.__projects.open(${JSON.stringify(NAME)})`);
    const opened = await waitFor(`window.__projects.current() === ${JSON.stringify(NAME)}`, 60, 500);
    check('migrated project opens', opened === true);
    const scene = await evalJs(`(() => {
        try { return { splats: window.scene.getElementsByType('splat').length }; }
        catch (e) { return { splats: -1, err: String(e) }; }
    })()`);
    check('model restored from migrated files', scene?.splats === 1, JSON.stringify(scene));

    // ---- 4) 清理 ----
    const cleaned = await evalJs(`(async () => {
        const L = window.__projectLogic;
        await L.store().remove(L.pathsFor(${JSON.stringify(NAME)}).dir);
        L.saveRegistry(L.removeProject(L.loadRegistry(), ${JSON.stringify(NAME)}));
        return (L.loadRegistry().projects || []).filter(p => p.name === ${JSON.stringify(NAME)}).length;
    })()`);
    check('cleaned up', cleaned === 0);

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
    if (plyCopied) {
        try { fs.unlinkSync(PLY_DST); } catch {}
    }
    setTimeout(() => process.exit(failed ? 1 : 0), 300);
}
