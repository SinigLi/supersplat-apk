/* tests/probe-v45.mjs — v45 AV 工作台 Web 层探针（390x844 headless Edge）
 *
 * 桌面无原生插件：mock window.Capacitor.Plugins.MediaServer（pickFolder/listFiles/start/stop）
 * 与 SaveImage.shareFile；验证：
 *  1. av-store 纯逻辑：清单构建（自然序/标号解析/auto-N）、标记增删、吸附、量化、导出降序
 *  2. 新建对话框模式三选一出现且默认 3D
 *  3. AV 工程创建 → 工作台打开（不进 3D 编辑器）
 *  4. 加载文件夹（mock）→ 列表渲染 → 选段播放（video src 指向 127.0.0.1:mock 端口）
 *  5. fps 手动设定 → 帧显示/步进/帧精确归档
 *  6. ✂ 分割点：添加 → 吸附命中变移除（F2/G1）
 *  7. ⤴ 并入前段：开关 + 每段一个（F1）
 *  8. ▦ 多帧参考：加/删帧（F3）
 *  9. 沉浸切换（G2）
 * 10. 导出 JSON：结构 + 降序 + merge/split/multiframe 映射（R10）
 * 11. 保存/返回：marks.json 持久 + 工程页恢复
 * 12. 既有回归不受影响：工程列表卡片渲染正常（含模式角标）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { reclaimPorts } from './lib/net-reclaim.mjs';

const ROOT = path.resolve('www');
const PORT = 4216;
// 每次随机 CDP 端口：固定端口会附到上一轮未死透的旧 Edge 页面（v45b 验证时踩过，四个假失败同源）
const CDP = 9300 + Math.floor(Math.random() * 300);
await reclaimPorts([PORT, CDP]);   // v46d: 先回收上次残留，绝不与上一套撞车
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
// 每次独立 profile：避免 Edge 磁盘缓存服务旧版 av-ui（v45b 修复验证时踩过）
const PROFILE = path.join(process.env.TEMP, 'edge_v45_profile_' + Date.now());
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + PROFILE,
    '--window-size=390,844',
    `http://127.0.0.1:${PORT}/index.html`
], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
const exceptions = [];
function send(method, params = {}) {
    return new Promise((resolve, reject) => {
        const msgId = ++id; pending.set(msgId, { resolve, reject });
        ws.send(JSON.stringify({ id: msgId, method, params }));
    });
}
async function evalJs(expr) {
    const r = await send('Runtime.evaluate', {
        expression: expr, awaitPromise: true, returnByValue: true
    });
    if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        const txt = d.exception?.description || d.text || 'eval error';
        exceptions.push(txt);
        throw new Error('PAGE-EXC: ' + txt.split('\n')[0]);
    }
    return r.result?.value;
}

const results = [];
function check(name, ok, extra) {
    results.push({ name, ok: !!ok, extra: extra || '' });
    console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' | ' + extra : ''));
}

let logBuf = '';
function onMsg(raw) {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        p.resolve(m.result || {});
    } else if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        exceptions.push(d.exception?.description || d.text);
    } else if (m.method === 'Runtime.consoleAPICalled') {
        const args = (m.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
        logBuf += args + '\n';
    }
}

const tests = `
(async () => {
    const out = {};
    localStorage.clear();   // 重跑安全：清掉上次探针留下的工程/标记
    const A = window.__avLogic, AV = window.__av;
    out.hasLogic = !!A;
    out.hasUI = !!AV;

    // ---- 1. 纯逻辑：清单构建 ----
    const files = A.buildFileList([
        'shot10.mp4', 'shot2.mp4', 'shot003.mp4', 'notes.txt', '封面.jpg', 'part.wav', 'seg12.mp3'
    ], 'video');
    out.fileList = files.map(f => f.name);
    out.labels = files.map(f => f.label);
    // 期望：视频扩展过滤（mp4/wav?? — wav 不在 VIDEO_EXT）→ shot003/shot2/shot10 + seg12(mp3 不在) 
    // VIDEO_EXT = mp4/webm/mkv/mov/m4v → 只剩 3 个 mp4，自然序 shot2 < shot003 < shot10
    out.fileListOk = JSON.stringify(out.fileList) === JSON.stringify(['shot2.mp4', 'shot003.mp4', 'shot10.mp4']);
    out.labelsOk = JSON.stringify(out.labels) === JSON.stringify(['2', '3', '10']);

    // auto-N
    const files2 = A.buildFileList(['a.mp4', 'b.mp4'], 'video');
    out.autoLabels = files2.map(f => f.label).join(',');
    out.autoOk = out.autoLabels === 'auto-1,auto-2';

    // 音频过滤
    const af = A.buildFileList(['x.wav', 'y.mp4', 'z.flac'], 'audio');
    out.audioOk = af.length === 2 && af[0].name === 'x.wav';

    // ---- 2. 标记操作 ----
    A.saveRegistry(A.upsertProject(A.loadRegistry(), { name: 'v45probe', mode: 'video' }));
    A.saveMeta(A.emptyMeta('v45probe', 'video'));
    const marks = A.emptyMarks();
    marks.marks.push({ id: 'm1', type: 'split', seg: '2', at: 1.5, note: '' });
    marks.marks.push({ id: 'm2', type: 'merge_prev', seg: '3', note: '' });
    A.saveMarks('v45probe', marks);
    const back = A.loadMarks('v45probe');
    out.marksOk = back.marks.length === 2 && back.marks[0].at === 1.5;

    // 吸附（fps=25 → 半帧 0.02s）
    const snapped = A.snapT(1.51, back.marks, 25);
    out.snapOk = Math.abs(snapped - 1.5) < 1e-9;   // 1.51 距 1.5 = 0.01 < 0.02 → 吸附
    const noSnap = A.snapT(1.6, back.marks, 25);
    out.noSnapOk = noSnap === 1.6;                 // 0.1 > 0.02 → 不吸附

    // 帧量化
    out.frameOk = A.frameAt(1.5, 25) === 38 && Math.abs(A.secAtFrame(38, 25) - 1.52) < 1e-9;

    // merge 互斥查找
    out.mergeOk = A.normalizeMerge(back, '3')?.seg === '3' && A.normalizeMerge(back, '2') == null;

    // ---- 3. 导出（降序 + 结构） ----
    marks.marks.push({ id: 'm3', type: 'split', seg: '10', at: 2.04, note: 'test' });
    marks.marks.push({ id: 'm4', type: 'multiframe_ref', seg: '2', frames: [5, 9], note: '' });
    marks.marks.push({ id: 'm5', type: 'multiframe_ref', seg: '10', frames: [51, 77], note: '' });   // v45m：帧 51 与分割点冲突 → 导出应剔除
    const meta = A.loadMeta('v45probe');
    meta.fps = 25;
    meta.folderName = 'test_split';
    const exp = A.buildExport(meta, marks, files);
    out.exportTargets = exp.marks.map(m => m.target).join(',');
    // 降序：shot10(10) → shot003(3) → shot2(2)；同段内 split 先于 merge? 需求只说按段降序
    out.exportSchema = exp.schema === 'moyutai.marks.v3' && exp.mode === 'video' && exp.fps === 25;
    out.exportFrame = exp.marks.find(m => m.target === 'shot10')?.points?.find(pt => pt.type === 'split')?.at_frame === 51; // 2.04*25=51
    out.exportSec = exp.marks.find(m => m.target === 'shot10')?.points?.find(pt => pt.type === 'split')?.at_seconds === 2.04;
    out.exportMulti = exp.marks.find(m => m.target === 'shot2')?.points?.filter(pt => pt.type === 'multiframe').map(pt => pt.at_frame).join(',') === '5,9';
    out.exportMutex = exp.marks.find(m => m.target === 'shot10')?.points?.filter(pt => pt.type === 'multiframe').map(pt => pt.at_frame).join(',') === '77';   // 帧51因分割点被剔除
    out.exportOk = out.exportTargets === 'shot10,shot003,shot2' && out.exportSchema && out.exportFrame && out.exportMulti && out.exportSec;   // v45n：v3 点列表

    // merge_prev 的 target 也在导出里
    out.mergeExport = exp.marks.some(m => m.target === 'shot003' && m.merge_prev === true);
    return out;
})()
`;

const uiTests = `
(async () => {
    const out = {};
    // ---- 4. 新建对话框：模式三选一 ----
    const newBtn = document.querySelector('.pj-new:not(.pj-ext-btn)');
    newBtn.click();
    await new Promise(r => setTimeout(r, 150));
    const modeBtns = [...document.querySelectorAll('.pj-mode')];
    out.modeCount = modeBtns.length;
    out.modeDefault = modeBtns.findIndex(b => b.classList.contains('on'));
    // 选视频
    modeBtns[1].click();
    await new Promise(r => setTimeout(r, 50));
    out.videoSelected = modeBtns[1].classList.contains('on');
    // 填名 + 创建（新建对话框 = .pj-input 所在的那个）
    const input = document.querySelector('.pj-input');
    input.value = 'v45ui';
    input.closest('.pj-dlg').querySelector('.pj-primary').click();
    await new Promise(r => setTimeout(r, 600));
    // 工作台应打开
    const avPage = document.getElementById('avPage');
    out.avOpen = !!avPage && avPage.classList.contains('open');
    out.uiState = JSON.stringify(window.__av.state());
    // 3D 编辑器不应打开
    out.editorHidden = !document.querySelector('.pj-bar').classList.contains('open');
    return out;
})()
`;

const wsUrl = await getWs();
ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => onMsg(typeof ev.data === 'string' ? ev.data : ev.data.toString());
await send('Runtime.enable');
await send('Page.enable');
// 就绪等待：脚本执行完 + 工程页按钮出现（冷启动时序，固定 sleep 会翻车）
for (let i = 0; i < 40; i++) {
    const rd = await evalJs(`({l:!!window.__avLogic,u:!!window.__av,b:!!document.querySelector('.pj-new')})`);
    if (rd && rd.l && rd.u && rd.b) break;
    await sleep(500);
}
await sleep(300);

try {
    // 基础加载
    const logic = await evalJs(tests);
    check('S1 纯逻辑清单构建', logic.fileListOk, JSON.stringify(logic.fileList));
    check('S2 标号解析标签', logic.labelsOk, logic.labels.join(','));
    check('S3 auto-N 无标号', logic.autoOk, logic.autoLabels);
    check('S4 音频扩展过滤', logic.audioOk);
    check('S5 标记持久化', logic.marksOk);
    check('S6 吸附命中(±半帧)', logic.snapOk, '1.51→1.5');
    check('S7 不误吸附', logic.noSnapOk);
    check('S8 帧/秒互转', logic.frameOk);
    check('S9 merge 互斥查找', logic.mergeOk);
    check('S10 导出降序+结构', logic.exportOk, logic.exportTargets);   // 4 条按段降序，同段稳定序：10→3→2(split)→2(multi)
    check('S11 merge_prev 进导出', logic.mergeExport);
    check('S12 同帧互斥剔除(v45m)', logic.exportMutex);

    // UI 流程
    const ui = await evalJs(uiTests);
    check('U1 模式四选一(v49)', ui.modeCount === 4);
    check('U2 默认 3D 高亮', ui.modeDefault === 0);
    check('U3 视频可选', ui.videoSelected);
    check('U4 AV 工程打开工作台', ui.avOpen, ui.uiState);
    check('U5 不进 3D 编辑器', ui.editorHidden);

    // mock 插件后续验证（文件夹加载）
    const folder = await evalJs(`
        (async () => {
            const out = {};
            // mock MediaServer
            const calls = [];
            window.Capacitor = window.Capacitor || { Plugins: {} };
            window.Capacitor.Plugins.MediaServer = {
        thumb: (args) => Promise.resolve({ jpeg: '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDIzNP/AABEIAAEAAQMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscHRJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/aAAwDAQACEQMRAD8A9/oooooA//9k=', width: 96, height: 54 }),
        probeMeta: (args) => Promise.resolve({ ok: true, fps: 25, width: 1280, height: 720, rotation: 0 }),
                pickFolder: async () => { calls.push('pick'); return { uri: 'content://tree/x', name: 'mock_split' }; },
                listFiles: async () => ({ files: [
                    { name: 'shot2.mp4', size: 1000, docId: 'd2' },
                    { name: 'shot003.mp4', size: 2000, docId: 'd3' },
                    { name: 'shot10.mp4', size: 3000, docId: 'd10' }
                ]}),
                start: async () => { calls.push('start'); return { port: 45999, count: 3 }; },
                stop: async () => { calls.push('stop'); },
                // v45d：模拟原生物理 px（脏值 top/left 超限应钐 0，right/bottom 正常换算）
                getSafeArea: async () => ({ top: 720, left: 420, right: 30, bottom: 9 })
            };
            window.__av._S.meta.folderUri = 'content://tree/x';
            // 预置授权目录进 localStorage，再走 open() 的恢复路径
            const meta0 = window.__avLogic.loadMeta('v45ui');
            meta0.folderUri = 'content://tree/x';
            meta0.folderName = 'mock_split';
            window.__avLogic.saveMeta(meta0);
            window.__av.open('v45ui');
            await new Promise(r => setTimeout(r, 600));
            const st = window.__av.state();
            out.files = st.files;
            out.folder = st.folderName;
            out.port = st.port;
            out.cur = st.cur;
            out.mode = st.mode;
            out.listItems = document.querySelectorAll('.av-item').length;
            out.videoSrc = (document.querySelector('.av-video') || {}).src || '';
            out.topTitle = (document.querySelector('.av-top-title') || {}).textContent || '';
            // v45d 安全区换算/钐制断言（物理 px→CSS，超 48 视为脏值归零）
            const pg = document.getElementById('avPage');
            const cs = getComputedStyle(pg);
            const dpr = window.devicePixelRatio || 1;
            const cv = v => { v = (v || 0) / dpr; return (v < 0 || v > 48) ? 0 : Math.round(v); };
            out.expRight = cv(30) + 'px';
            out.expBottom = cv(9) + 'px';
            out.safeTop = pg.style.getPropertyValue('--av-safe-top');
            out.safeRight = pg.style.getPropertyValue('--av-safe-right');
            out.safeBottom = pg.style.getPropertyValue('--av-safe-bottom');
            out.padTop = cs.paddingTop;
            out.padRight = cs.paddingRight;
            out.padBottom = cs.paddingBottom;
            return out;
        })()
    `);
    check('V1 文件夹清单恢复', folder.files === 3, `cur=${folder.cur} mode=${folder.mode}`);
    check('V2 列表渲染', folder.listItems === 3);
    check('V3 流端口获取', folder.port === 45999);
    check('V4 video.src 指向本地流', folder.videoSrc.includes('127.0.0.1:45999'), folder.videoSrc);
    check('V5 顶栏显示目录', folder.topTitle.includes('mock_split'), folder.topTitle);
    check('C3 安全区脏值钐制+物理px换算(v45d)', folder.safeTop === '0px' && folder.safeRight === folder.expRight && folder.safeBottom === folder.expBottom && folder.padTop === '0px', `t=${folder.safeTop} r=${folder.safeRight}(期望${folder.expRight}) padT=${folder.padTop}`);

    // 标记交互（F1/F2/F3）
    const markTests = await evalJs(`
        (async () => {
            const out = {};
            const v = document.querySelector('.av-video');
            // 模拟时长与时间（headless 无真实媒体，直接覆写属性）
            Object.defineProperty(v, 'duration', { value: 4.0, configurable: true });
            let cur = 0;
            Object.defineProperty(v, 'currentTime', {
                get: () => cur, set: (t) => { cur = t; }, configurable: true
            });
            window.__av._setFps(25);
            window.__av._setVideoTime(1.52);
            window.__av._markSplit();          // 加分割点 @1.52（量化到帧 38 → 1.52）
            let marks = window.__av.marks().marks;
            out.added = marks.filter(m => m.type === 'split' && m.seg === '2').length;
            out.atQuant = marks.find(m => m.type === 'split' && m.seg === '2')?.at;
            // 再点同位置（±半帧）→ 移除（F2）
            window.__av._setVideoTime(1.53);
            window.__av._markSplit();
            marks = window.__av.marks().marks;
            out.removed = marks.filter(m => m.type === 'split' && m.seg === '2').length;
            // merge 开关（F1）
            window.__av._toggleMerge();
            marks = window.__av.marks().marks;
            out.mergeOn = marks.some(m => m.type === 'merge_prev' && m.seg === '2');
            // 再点 → 解除
            window.__av._toggleMerge();
            marks = window.__av.marks().marks;
            out.mergeOff = !marks.some(m => m.type === 'merge_prev' && m.seg === '2');
            // 多帧（F3）
            window.__av._toggleMulti();   // 帧 38 加
            window.__av._setVideoTime(2.0);
            window.__av._toggleMulti();   // 帧 50 加
            marks = window.__av.marks().marks;
            const mf = marks.find(m => m.type === 'multiframe_ref');
            out.multi = mf ? mf.frames.join(',') : '';
            // v45c #6：stage-hit 已删（单击视频不再切全屏）；#1：右侧竖排控制栏存在
            out.noStageHit = !document.querySelector('.av-stage-hit');
            out.railExists = !!document.querySelector('.av-rail');
            out.railBigBtns = document.querySelectorAll('.av-rail .av-ovl-btn.av-big').length;   // ⏮⏯⏭◀▶ 5 个
            // #3：时间标签悬浮右上角（.av-pos-top）
            out.posTop = !!document.querySelector('.av-pos-top');
            // v45l：fps 芯片进右上角信息条；工具行横排且不再含 fps 输入框
            const pos2 = document.querySelector('.av-pos-top');
            out.fpsChip = !!pos2 && !!pos2.querySelector('.av-fps-chip');
            const ovl2 = document.querySelector('.av-ovl');
            out.ovlNoFps = !ovl2 || !ovl2.querySelector('.av-fps');
            out.ovlRow = !!ovl2 && getComputedStyle(ovl2).flexDirection === 'row';
            out.thumbCount = document.querySelectorAll('.av-thumb').length;   // v45m：首帧缩略图容器
            return out;
        })()
    `);
    check('M1 分割点添加+帧量化', markTests.added === 1, String(markTests.atQuant));
    check('M2 命中变移除(F2)', markTests.removed === 0);
    check('M3 merge 开(F1)', markTests.mergeOn);
    check('M4 merge 解除', markTests.mergeOff);
    check('M5 多帧参考(F3)', markTests.multi === '38,50', markTests.multi);
    check('M6 全屏层已删(反馈#6)', markTests.noStageHit);

    const toggleTests = await evalJs(`
        (async () => {
            const out = {};
            const chipEl = document.querySelector('.av-thumb-toggle');
            out.chip = !!chipEl;
            if (chipEl) {
                chipEl.click();
                await new Promise(r => setTimeout(r, 120));
                out.off = document.querySelectorAll('.av-thumb').length;
                const chip2 = document.querySelector('.av-thumb-toggle');   // renderPos 重建过 DOM，必须重取
                if (chip2) chip2.click();   // 恢复开启
                // v45r：缩略图改为异步泵，轮询等 img 上墙（最长 6s）
                for (let z = 0; z < 40 && document.querySelectorAll('.av-thumb-img').length === 0; z++) {
                    await new Promise(r => setTimeout(r, 150));
                }
                out.state = window.__av._S.meta.thumbs;
                out.thumbImg = document.querySelectorAll('.av-thumb-img').length; out.q = (window.__av && window.__av._thumbState ? JSON.stringify(window.__av._thumbState()) : 'n/a');
                out.noColl = !document.querySelector('.av-side-coll');
                var listEl0 = document.querySelector('.av-list');
                var sideEl0 = document.querySelector('.av-side');
                out.listOverflowY = listEl0 ? getComputedStyle(listEl0).overflowY : 'missing';
                out.sideDisplay = sideEl0 ? getComputedStyle(sideEl0).display : 'missing';
                out.hasListCss = !!(window.__av && window.__av._css && window.__av._css.includes('.av-list {'));
            }
            return out;
        })()
    `);

    // v45b 真机反馈修复专项
    const fixTests = await evalJs(`
        (async () => {
            const out = {};
            // F-#2 播放按钮存在且在播放条行内
            const play = document.querySelector('.av-rail .av-play');   // v45c：播放按钮在右侧竖排栏
            out.playBtn = !!play;
            // 点击不抛异常（无真实流 → toast 兑底路径）
            if (play) play.click();
            await new Promise(r => setTimeout(r, 120));
            // F-#4 游标命中已有标记 → 按钮变红「移除」态
            window.__av._setFps(25);
            window.__av._setVideoTime(2.0);
            window.__av._markSplit();          // @帧50 加分割点
            const bs = document.querySelector('.av-ovl-btn.av-accent');
            out.dangerOn = bs.classList.contains('av-danger') && bs.textContent.includes('移除');
            // 移走 → 恢复「分割点」态
            window.__av._setVideoTime(3.0);
            out.dangerOff = !bs.classList.contains('av-danger') && bs.textContent.includes('分割点');
            // F-#5 无 fps 时多帧可用（effFps 兑底 25）
            window.__av._setVideoTime(2.5);
            window.__av._S.fps = null; window.__av._S.meta.fps = null; window.__av._S.meta.fpsSource = null;
            window.__av._toggleMulti();
            const mf2 = window.__av.marks().marks.find(m => m.type === 'multiframe_ref');
            out.multiNoFps = !!mf2 && mf2.frames.length >= 1 && mf2.frames.includes(63);   // 2.5*25=62.5→round=63？frameAt=round→63？ floor(2.5*25)+? → frameAt 用 round(62.5)=63？看实现
            // F-#1 强制横屏：open 后 page open（桌面无 orientation API 不抛错即过）
            out.pageOpen = document.getElementById('avPage').classList.contains('open');
            return out;
        })()
    `);
    check('X1 播放按钮(反馈#2)', fixTests.playBtn);
    check('X2 命中变移除态(反馈#4)', fixTests.dangerOn);
    check('X3 移开恢复常态', fixTests.dangerOff);
    check('X4 无fps多帧可用(反馈#5)', fixTests.multiNoFps);
    check('X5 横屏调用不抛错(反馈#1)', fixTests.pageOpen);
    check('C1 右侧竖排控制栏(v45c#1)', markTests.railExists && markTests.railBigBtns === 5, 'big=' + markTests.railBigBtns);
    check('C2 时间标签右上角(v45c#3)', markTests.posTop);
    check('L1 fps 芯片右上角(v45l)', markTests.fpsChip);
    check('L2 工具行横排无fps输入(v45l)', markTests.ovlNoFps && markTests.ovlRow);
    check('L3 列表缩略图容器(v45m)', markTests.thumbCount === 3, String(markTests.thumbCount));
    check('N1 🖼 开关关闭即清空(v45n)', toggleTests.off === 0, 'off=' + toggleTests.off);
    check('N2 🖼 开关chip存在(v45n)', toggleTests.chip === true);
    check('N3 收起按钮已移除(v45o)', toggleTests.noColl === true);
    check('N4 原生缩略图直出(v45o)', toggleTests.thumbImg >= 1, 'img=' + toggleTests.thumbImg + ' q=' + toggleTests.q + ' state=' + toggleTests.state);
    check('N5 列表可滚动布局(v45p)', toggleTests.listOverflowY === 'auto' && toggleTests.sideDisplay === 'flex', toggleTests.listOverflowY + '/' + toggleTests.sideDisplay);

    // 持久化 + 返回
    const persist = await evalJs(`
        (async () => {
            const out = {};
            // 保存再读
            window.__av._markSplit();   // 当前 2.0 → 帧 50 → 加回一个分割点
            const saved = localStorage.getItem('av-v45ui-marks');
            out.saved = !!saved && saved.includes('multiframe_ref');
            // 导出结构最终检查
            const exp = window.__av._exportJson();
            out.schema = exp.schema === 'moyutai.marks.v3';
            out.desc = exp.marks.map(m => m.target).join(',');
            // 返回
            window.__av.back();
            await new Promise(r => setTimeout(r, 200));
            out.backToList = document.getElementById('pjPage').classList.contains('open');
            out.avClosed = !document.getElementById('avPage').classList.contains('open');
            // 工程卡片出现且带视频角标
            const cards = [...document.querySelectorAll('.pj-card')];
            out.cardCount = cards.length;
            out.cardMode = cards.some(c => c.textContent.includes('🎬 视频'));
            return out;
        })()
    `);
    check('P1 marks.json 持久', persist.saved);
    check('P2 导出 schema', persist.schema, persist.desc);
    check('P3 返回工程列表', persist.backToList && persist.avClosed);
    check('P4 卡片显示视频模式', persist.cardMode, `cards=${persist.cardCount}`);

    /* ---- v51：分镜清单自动打点 ----
     * csvAsked 是 av-ui 模块级变量（一次会话只弹一次），前段流程已把
     * v45ui 打开过 → 弹窗预算已用。因此 reload 复位后分三步验证。 */
    {
        await evalJs('location.reload(); 1');
        await sleep(1200);
        const mk = `
            window.Capacitor = window.Capacitor || { Plugins: {} };
            let pickCalls = 0;
            window.Capacitor.Plugins.MediaServer = {
                thumb: async () => ({ jpeg: '', width: 96, height: 54 }),
                probeMeta: async () => ({ ok: true, fps: 25, width: 1280, height: 720, rotation: 0 }),
                pickFolder: async () => ({ uri: 'content://tree/x', name: 'sb' }),
                listFiles: async () => ({ files: [
                    { name: 'clip_01.mp4', size: 1000, docId: 'c1' },
                    { name: 'clip_02.mp4', size: 1000, docId: 'c2' },
                    { name: 'clip_03.mp4', size: 1000, docId: 'c3' },
                    { name: 'clip_04.mp4', size: 1000, docId: 'c4' },
                    { name: 'clip_05.mp4', size: 1000, docId: 'c5' }
                ]}),
                start: async () => ({ port: 45990, count: 5 }),
                stop: async () => {},
                getSafeArea: async () => ({ top: 30, left: 0, right: 0, bottom: 9 }),
                pickCsv: async () => { pickCalls++; return { uri: 'content://document/csv', name: '分镜清单.csv' }; },
                readText: async (args) => ({ charset: args.uri.includes('bad') ? 'GBK' : 'UTF-8', bytes: 128, text: args.uri.includes('bad')
                    ? '镜号,多参考图\\n1,10\\n2,\\n3,\\n4,\\n'
                    : '镜号,镜头描述,多参考图\\n1,开场,10;20\\n2,变身,\\n3,战斗,\\n4,特写,\\n5,决战,20\\n' })
            };
            window.__sbPickCalls = () => pickCalls;
        `;
        /* V51-1/2/3：预置 csvUri 的工程，open 即自动读取比对 */
        const r1 = JSON.parse(await evalJs(`
        (async () => {
            ${mk}
            window.__avLogic.saveMeta({ name: 'v51sb', mode: 'video', folderUri: 'content://tree/x', folderName: 'sb Clips', fps: 25, csvUri: 'content://document/csv' });
            window.__av.open('v51sb');
            await new Promise(r => setTimeout(r, 800));
            const mf = window.__av._S.marks.marks.filter(m => m.type === 'multiframe_ref');
            return JSON.stringify({ files: document.querySelectorAll('#avPage .av-item').length, marks: mf.map(m => ({ seg: m.seg, frames: m.frames })), csvUri: (window.__avLogic.loadMeta('v51sb').csvUri || '') });
        })()`));
        check('V51-1 清单5视频2组mark', r1.files === 5 && r1.marks.length === 2, r1);
        check('V51-2 seg(label)=[10,20]/[20]', JSON.stringify(r1.marks) === '[{"seg":"1","frames":[10,20]},{"seg":"5","frames":[20]}]', r1.marks);
        check('V51-3 csvUri 已持久化', r1.csvUri.includes('csv'), r1.csvUri);

        /* V51-4：v51c 无 csvUri 时不再自动弹选择器 → 顶栏 📋 手动关联 */
        const r2 = JSON.parse(await evalJs(`
        (async () => {
            let pickCalls2 = 0;
            window.Capacitor.Plugins.MediaServer.pickCsv = async () => { pickCalls2++; return { uri: 'content://document/csv', name: '分镜清单.csv' }; };
            window.__avLogic.saveMeta({ name: 'v51pick', mode: 'video', folderUri: 'content://tree/x', folderName: 'sb Clips', fps: 25 });
            window.__av.open('v51pick');
            await new Promise(r => setTimeout(r, 800));
            const autoCalls = pickCalls2;   // open 过程不应弹
            const btn = [...document.querySelectorAll('#avPage .av-top-btn')].find(b => b.textContent.includes('📋'));
            if (btn) btn.click();
            await new Promise(r => setTimeout(r, 800));
            const btnCalls = pickCalls2;
            const mf1 = window.__av._S.marks.marks.filter(m => m.type === 'multiframe_ref').length;
            return JSON.stringify({ autoCalls, btnCalls, mf1, hasBtn: !!btn });
        })()`));
        check('V51-4 打开不弹窗+点📋关联打点', r2.autoCalls === 0 && r2.btnCalls === 1 && r2.mf1 === 2 && r2.hasBtn, r2);

        /* V51-5：不匹配清单 → 全跳过 */
        const r3 = JSON.parse(await evalJs(`
        (async () => {
            window.__avLogic.saveMeta({ name: 'v51bad', mode: 'video', folderUri: 'content://tree/x', folderName: 'sb Clips', fps: 25, csvUri: 'content://document/bad' });
            window.__av.open('v51bad');
            await new Promise(r => setTimeout(r, 800));
            const mf = window.__av._S.marks.marks.filter(m => m.type === 'multiframe_ref');
            return JSON.stringify({ count: mf.length });
        })()`));
        check('V51-5 不匹配跳过（0 mark）', r3.count === 0, r3);

        const r4 = JSON.parse(await evalJs(`
        (async () => {
            const cap = window.Capacitor;
            cap.Plugins.DebugLog = { lines: [], append: async (a) => { cap.Plugins.DebugLog.lines.push(a.text || ''); return { ok: true }; } };
            window.__avLogic.saveMeta({ name: 'v51diag', mode: 'video', folderUri: 'content://tree/x', folderName: 'sb Clips', fps: 25, csvUri: 'content://document/csv' });
            window.__av.open('v51diag');
            await new Promise(r => setTimeout(r, 800));
            return JSON.stringify({ sb: cap.Plugins.DebugLog.lines.filter(l => l.includes('sb:')).length });
        })()`));
        check('V51-6 诊断日志进 DebugLog', r4.sb >= 2, r4);

        /* V51-7：播放条刻度 + 列表 ▦ 徽标（seg 用 label 与手动标记一致） */
        const r5 = JSON.parse(await evalJs(`
        (async () => {
            window.__av.open('v51sb');
            await new Promise(r => setTimeout(r, 800));
            /* 选中 seg=1 的视频（列表第 1 项）后播放条应有 2 个 multi 刻度 */
            const items = document.querySelectorAll('#avPage .av-item');
            items[0].click();
            await new Promise(r => setTimeout(r, 600));
            /* mock 环境视频加载不出真 duration → 覆盖后补发 loadedmetadata
             * 走真实 renderTicks 路径 */
            const v = document.querySelector('#avPage video');
            if (v) {
                try { Object.defineProperty(v, 'duration', { configurable: true, get: () => 100 }); } catch (e) { }
                v.dispatchEvent(new Event('loadedmetadata'));
                await new Promise(r => setTimeout(r, 400));
            }
            const ticks = document.querySelectorAll('#avPage .av-tick-multi').length;
            const badge = items[0].textContent.includes('▦');
            const marks = window.__av._S.marks.marks.filter(m => m.type === 'multiframe_ref').map(m => ({ seg: m.seg, frames: m.frames }));
            return JSON.stringify({ ticks, badge, marks });
        })()`));
        check('V51-7 播放条刻度+列表▦徽标', r5.ticks === 2 && r5.badge && r5.marks.length === 2 && r5.marks[0].seg === '1', r5);
    }

    /* ---- v52：工程列表分组管理 ---- */
    {
        const r1 = JSON.parse(await evalJs(`
        (async () => {
            const reg0 = window.__projectLogic.loadRegistry();
            reg0.projects = [
                { name: 'v52a', mode: 'model', updatedAt: '2026-11-07T10:00:00', hasModel: false },
                { name: 'v52b', mode: 'video', updatedAt: '2026-11-07T09:00:00', hasModel: false },
                { name: 'v52c', mode: 'image', updatedAt: '2026-11-07T08:00:00', hasModel: false }
            ];
            reg0.groups = [];
            window.__projectLogic.saveRegistry(reg0);
            window.__projects.list();
            await new Promise(r => setTimeout(r, 200));
            const cards = document.querySelectorAll('.pj-card');
            const gbar = document.querySelector('.pj-gbar');
            const cancel = document.querySelector('.pj-cancel');
            return JSON.stringify({ cards: cards.length, gbar: !!gbar, cancelHidden: cancel && cancel.style.display === 'none', hasGroups: !!window.__groups });
        })()`));
        console.log('V52D1 ' + JSON.stringify(r1));
        check('V52-1 底部条+列表就绪', r1.cards === 3 && r1.gbar && r1.cancelHidden && r1.hasGroups, r1);

        const r2 = JSON.parse(await evalJs(`
        (async () => {
            const card = document.querySelectorAll('.pj-card')[0];
            card.dispatchEvent(new Event('contextmenu', { cancelable: true }));
            await new Promise(r => setTimeout(r, 300));
            const cancel = document.querySelector('.pj-cancel');
            const selCard = document.querySelector('.pj-card.sel');
            return JSON.stringify({ cancelShown: cancel && cancel.style.display === 'flex', sel: !!selCard, selName: selCard ? selCard.querySelector('.pj-name').textContent : '' });
        })()`));
        console.log('V52D2 ' + JSON.stringify(r2));
        check('V52-2 长按进入多选+选中', r2.cancelShown && r2.sel && r2.selName === 'v52a', r2);

        const r3 = JSON.parse(await evalJs(`
        (async () => {
            const dbgPre = window.__projects._dbg();
            /* 把另外 2 个工程也选上（重查 DOM） */
            const names = ['v52b', 'v52c'];
            names.forEach(n => {
                const c = [...document.querySelectorAll('.pj-card')].find(x => x.querySelector('.pj-name') && x.querySelector('.pj-name').textContent === n);
                if (c) c.click();
            });
            const dbgMid = window.__projects._dbg();
            let promptCalled = 0;
            window.prompt = function () { promptCalled++; return '今日精选'; };
            const gbtn = [...document.querySelectorAll('.pj-gbar-btn')].find(b => b.textContent.includes('新建分组'));
            let btnClicked = 0;
            gbtn.addEventListener('click', function () { btnClicked++; });
            gbtn.click();   /* 真实路径：click → onGroupNewClick → prompt → 建组 */
            await new Promise(r => setTimeout(r, 400));
            const reg = window.__projectLogic.loadRegistry();
            const grp = (reg.groups || []).find(g => g.name === '今日精选');
            return JSON.stringify({ groups: (reg.groups || []).length, inGroup: grp ? window.__groups.projectsIn(reg, grp.id).length : 0, multiOff: document.querySelector('.pj-cancel').style.display === 'none', promptCalled: promptCalled, btnClicked: btnClicked });
        })()`));
        console.log('V52D3 ' + JSON.stringify(r3));
        check('V52-3 新建分组并放入选中', r3.groups === 1 && r3.inGroup === 3 && r3.multiOff, r3);

        const r4 = JSON.parse(await evalJs(`
        (async () => {
            /* 进入分组（非多选点分组卡）→ 长按选 1 工程 → 移动到根 */
            /* V52-3 结束时可能仍在多选（multiOff 断言可豁免），先确保退出 */
            const cancelBtn = document.querySelector('.pj-cancel');
            if (cancelBtn.style.display !== 'none') cancelBtn.click();
            await new Promise(r => setTimeout(r, 200));
            const gcard = [...document.querySelectorAll('.pj-card')].find(x => x.classList.contains('pj-gcard'));
            if (!gcard) return JSON.stringify({ err: 'no gcard' });
            gcard.click();
            await new Promise(r => setTimeout(r, 250));
            const crumb = document.querySelector('.pj-crumb');
            const crumbShown = crumb && crumb.style.display === 'flex';
            const card = document.querySelector('.pj-card:not(.pj-gcard)');
            if (!card) return JSON.stringify({ err: 'no proj card', crumbShown });
            card.dispatchEvent(new Event('contextmenu', { cancelable: true }));
            await new Promise(r => setTimeout(r, 250));
            const sel2 = document.querySelector('.pj-card.sel');
            if (sel2) sel2.click();  /* contextmenu 已 toggle 一次，再点会取消 → 修正：这里不点 */
            /* 上面误操作会取消选中——改为若已选中则不点 */
            const stillSel = document.querySelector('.pj-card.sel');
            if (!stillSel) { card.dispatchEvent(new Event('contextmenu', { cancelable: true })); }
            [...document.querySelectorAll('.pj-gbar-btn')].find(b => b.textContent.includes('移动到分组')).click();
            await new Promise(r => setTimeout(r, 250));
            const upItem = document.querySelector('.pj-move-item');
            if (upItem) upItem.click();
            await new Promise(r => setTimeout(r, 150));
            const okBtn = [...document.querySelectorAll('.pj-move-btn')].find(b => b.textContent.includes('移动到这里'));
            if (okBtn) okBtn.click();
            await new Promise(r => setTimeout(r, 300));
            const reg = window.__projectLogic.loadRegistry();
            const inRoot = window.__groups.projectsIn(reg, '').length;
            const grp2 = (reg.groups || []).find(g => g.name === '今日精选');
            const inGroup = grp2 ? window.__groups.projectsIn(reg, grp2.id).length : -1;
            return JSON.stringify({ crumbShown, inRoot, inGroup });
        })()`));
        console.log('V52D4 ' + JSON.stringify(r4));
        check('V52-4 移动到分组（子层→根）', r4.crumbShown && r4.inRoot === 1 && r4.inGroup === 2, r4);

        const r5 = JSON.parse(await evalJs(`
        (async () => {
            [...document.querySelectorAll('.pj-gbar-btn')].find(b => b.textContent.includes('新建分组')).click();
            await new Promise(r => setTimeout(r, 150));
            const cancel = document.querySelector('.pj-cancel');
            const shown = cancel.style.display === 'flex';
            cancel.click();
            await new Promise(r => setTimeout(r, 150));
            return JSON.stringify({ autoMulti: shown, backNormal: cancel.style.display === 'none' });
        })()`));
        console.log('V52D5 ' + JSON.stringify(r5));
        check('V52-5 点按钮自动进多选+取消退出', r5.autoMulti && r5.backNormal, r5);
    }

    /* ---- v52b：分组删除 + 新建工程落当前分组 ---- */
    {
        const r6 = JSON.parse(await evalJs(`
        (async () => {
            /* V52-4 结束时还停在分组内 → 回到根层 */
            const crumbBtn = document.querySelector('.pj-crumb-btn');
            if (crumbBtn) { crumbBtn.click(); await new Promise(r => setTimeout(r, 250)); }
            const reg = window.__projectLogic.loadRegistry();
            /* 分组卡应有 🗑 删除按钮 */
            const gcard = [...document.querySelectorAll('.pj-card')].find(x => x.classList.contains('pj-gcard'));
            const hasDel = gcard && [...gcard.querySelectorAll('button')].some(b => b.textContent.includes('🗑'));
            /* upsertProject 保留 groups */
            const testReg = { projects: [{ name: 'v52a', mode: 'model', group: 'zz' }], groups: [{ id: 'zz', name: 'Z', parent: '' }] };
            const out = window.__projectLogic.upsertProject(testReg, { name: 'v52w', mode: 'image', updatedAt: 'x', hasModel: false });
            const groupsKept = Array.isArray(out.groups) && out.groups.length === 1;
            const newEntry = out.projects.find(p => p.name === 'v52w');
            return JSON.stringify({ hasDel, groupsKept, newGroup: newEntry ? (newEntry.group || '') : null });
        })()`));
        check('V52-6 分组卡有删除按钮', r6.hasDel, r6);
        check('V52-7 upsert 保留 groups', r6.groupsKept, r6);

        /* 三选弹窗：点 gcard 🗑 → 弹窗出现 → 仅解除分组 */
        const r7 = JSON.parse(await evalJs(`
        (async () => {
            const gcard = [...document.querySelectorAll('.pj-card')].find(x => x.classList.contains('pj-gcard'));
            const delBtn = [...gcard.querySelectorAll('button')].find(b => b.textContent.includes('🗑'));
            delBtn.click();
            await new Promise(r => setTimeout(r, 250));
            const dlg = document.querySelector('.pj-move-dlg.open');
            const btns = dlg ? [...dlg.querySelectorAll('.pj-move-btn')].map(b => b.textContent) : [];
            /* 点「仅解除分组」 */
            const loose = [...dlg.querySelectorAll('.pj-move-btn')].find(b => b.textContent === '仅解除分组');
            if (loose) loose.click();
            await new Promise(r => setTimeout(r, 300));
            const reg = window.__projectLogic.loadRegistry();
            return JSON.stringify({ btns, dlgClosed: !dlg || !dlg.classList.contains('open'), groupsLeft: (reg.groups || []).length });
        })()`));
        check('V52-8 三选弹窗+仅解除分组', r7.btns.join().includes('仅解除分组') && r7.btns.join().includes('完整删除') && r7.btns.join().includes('取消') && r7.groupsLeft === 0, r7);
    }

    /* ---- v52c：复选框引导 + 空文件夹底部条贴底 ---- */
    {
        /* 长按后左侧复选框可见且选中 */
        const r8 = JSON.parse(await evalJs(`
        (async () => {
            const card = document.querySelectorAll('.pj-card')[0];
            card.dispatchEvent(new Event('contextmenu', { cancelable: true }));
            await new Promise(r => setTimeout(r, 300));
            const sel = document.querySelector('.pj-card.sel');
            const check = sel ? sel.querySelector('.pj-check') : null;
            const cs = check ? getComputedStyle(check) : null;
            const checkVisible = !!cs && cs.display !== 'none' && check.textContent === '✓';
            document.querySelector('.pj-cancel').click();
            await new Promise(r => setTimeout(r, 200));
            const checkHidden = getComputedStyle(document.querySelector('.pj-card .pj-check')).display === 'none';
            return JSON.stringify({ checkVisible, checkHidden });
        })()`));
        check('V52-9 长按选中+左侧复选框✓', r8.checkVisible && r8.checkHidden, r8);

        /* 空分组：gbar 贴底（bottom 与视口底距离 < 80px） */
        const r9 = JSON.parse(await evalJs(`
        (async () => {
            const reg = window.__projectLogic.loadRegistry();
            const g = window.__groups.createGroup(reg, '空组', '');
            window.__projectLogic.saveRegistry(reg);
            window.__projects.list();
            await new Promise(r => setTimeout(r, 200));
            [...document.querySelectorAll('.pj-card')].find(x => x.classList.contains('pj-gcard')).click();
            await new Promise(r => setTimeout(r, 300));
            const gbar = document.querySelector('.pj-gbar').getBoundingClientRect();
            const empty = document.querySelector('.pj-empty');
            const emptyShown = empty && getComputedStyle(empty).display !== 'none';
            const gap = innerHeight - gbar.bottom;
            return JSON.stringify({ emptyShown, gap: Math.round(gap) });
        })()`));
        check('V52-10 空分组底部条贴底', r9.emptyShown && r9.gap >= 0 && r9.gap < 80, r9);
    }





} catch (e) {
    check('EXCEPTION', false, String(e.message || e).slice(0, 160));
}

const pass = results.filter(r => r.ok).length;
console.log('========================');
console.log(`probe-v45: ${pass}/${results.length} passed`);
if (exceptions.length) {
    console.log('PAGE EXCEPTIONS:');
    exceptions.slice(0, 5).forEach(e => console.log('  ' + e.split('\n')[0].slice(0, 140)));
}
edge.kill();
srv.kill();
process.exit(pass === results.length && exceptions.length === 0 ? 0 : 1);
