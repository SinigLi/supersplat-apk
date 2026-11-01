/* proto-av-verify.mjs - v44 原型 CDP 验证（390x844 headless Edge）
 * 用法：repo 根目录 node tests/proto-av-verify.mjs
 * 自起 staticsrv(4194) + Edge CDP(9253)，验证 av-workspace-proto.html 交互并截图。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('prototype');
const PORT = 4194;
const CDP = 9253;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SHOTDIR = process.env.TEMP + '\\proto_av_shots';
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
fs.rmSync(SHOTDIR, { recursive: true, force: true });
fs.mkdirSync(SHOTDIR, { recursive: true });
const edge = spawn(EDGE, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + path.join(process.env.TEMP, 'edge_proto44_profile'),
    '--window-size=390,844',
    `http://127.0.0.1:${PORT}/av-workspace-proto.html`
], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
function send(method, params = {}) {
    return new Promise((resolve, reject) => {
        const msgId = ++id; pending.set(msgId, { resolve, reject });
        ws.send(JSON.stringify({ id: msgId, method, params }));
    });
}
async function evalJs(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed: ' + expr.slice(0, 60));
    return r.result?.value;
}
async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const p = SHOTDIR + '\\' + name + '.png';
    fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
    console.log('SHOT ' + p);
    return p;
}
const results = [];
const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

try {
    ws = new WebSocket(await getWs());
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.id && pending.has(m.id)) {
            const p = pending.get(m.id); pending.delete(m.id);
            m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
        }
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await sleep(1200);

    // 1. 首页加载：解压按钮+新建按钮存在
    const home = await evalJs(`(() => ({
        unz: !!document.querySelector('#b-unz'), neu: !!document.querySelector('#b-new'),
        projs: document.querySelectorAll('.proj').length,
        err: window.__err || null
    }))()`);
    check('home buttons', home.unz && home.neu, JSON.stringify(home));
    check('home project cards', home.projs >= 3, 'count=' + home.projs);
    await shot('01-home');

    // 2. 解压弹层：选文件→进度→完成提示
    await evalJs(`document.querySelector('#b-unz').click()`);
    await evalJs(`document.querySelector('#unz-pick').click()`);
    const unzFile = await evalJs(`document.querySelector('#unz-file').textContent`);
    check('unzip file picked', /7z\.001/.test(unzFile), unzFile.slice(0, 50));
    await evalJs(`document.querySelector('#unz-go').click()`);
    await sleep(1800);
    const unzRes = await evalJs(`({res: document.querySelector('#unz-res').textContent, done: window.__testUnz, disp: getComputedStyle(document.querySelector('#unz-res')).display})`);
    check('unzip done banner', unzRes.done === 'done' && /主美_场景资产\//.test(unzRes.res) && unzRes.disp !== 'none', JSON.stringify(unzRes).slice(0, 120));
    await shot('02-unzip');
    await evalJs(`document.querySelector('#unz-close').click()`);

    // 3. 新建三模式
    await evalJs(`document.querySelector('#b-new').click()`);
    const modes = await evalJs(`document.querySelectorAll('.mode>div').length`);
    check('3 mode cards', modes === 3, 'modes=' + modes);
    await shot('03-new-sheet');
    await evalJs(`document.querySelector('.mode>div[data-m="video"]').click()`);
    await sleep(300);
    const vOn = await evalJs(`document.querySelector('#v-video').classList.contains('on')`);
    check('video workspace opens', vOn);

    // 4. 视频台：加载文件夹→列表 5 项、自动编号标记
    await evalJs(`document.querySelector('#lv-pick').click()`);
    await sleep(200);
    const list = await evalJs(`(() => {
        const items = [...document.querySelectorAll('#files .fitem')];
        return { n: items.length, autos: items.filter(i => i.querySelector('.no.auto')).length,
                 cur0: items[0].classList.contains('cur'), title: document.querySelector('#v-title').textContent };
    })()`);
    check('video list 5 items', list.n === 5, JSON.stringify(list));
    check('auto-numbering marked', list.autos === 1, 'auto=' + list.autos);
    await shot('04-video-list');

    // 5. 打标记：分割点@0 + 拖进度到中段再打并入前段
    await evalJs(`__test.addMark('split')`);
    await evalJs(`__test.switchView('video'); __test.state().loaded && (function(){return true})()`);
    // seek 到 40% 再打 merge_prev
    await evalJs(`(function(){ const c=__test.state(); return true })()`);
    await evalJs(`document.querySelector('#bar').dispatchEvent(new PointerEvent('pointerdown',{clientX: (document.querySelector('#bar').getBoundingClientRect().left + 0.45 * document.querySelector('#bar').getBoundingClientRect().width), buttons:1, bubbles:true}))`);
    const t45 = await evalJs(`__test.state().t`);
    await evalJs(`__test.addMark('merge_prev')`);
    const mk = await evalJs(`__test.state().marks`);
    const marks = Object.values(mk).flat();
    check('marks added 2', marks.length === 2, JSON.stringify(mk).slice(0, 120));
    const mrg = marks.find(m => m.type === 'merge_prev');
    check('merge_prev at ~45%', mrg && Math.abs(mrg.at - t45) < 0.3, 'at=' + mrg?.at + ' seeked=' + t45?.toFixed(2));
    check('time 2-decimals', /^\d+\.\d{2}$/.test(Number(mrg.at).toFixed(2)));

    // 6. 步进：▶ 后 t 增加 1/25=0.04
    await evalJs(`document.querySelector('#v-sup').click()`);
    const t1 = await evalJs(`__test.state().t`);
    await evalJs(`document.querySelector('#v-sup').click()`);
    const t2 = await evalJs(`__test.state().t`);
    check('video step = 1 frame', Math.abs((t2 - t1) - 1 / 25) < 1e-6, 'd=' + (t2 - t1).toFixed(4));
    await shot('05-video-marked');

    // 7. 标记侧栏打开有 2 条、删除 1 条
    await evalJs(`document.querySelector('#mt-marks').click()`);
    await sleep(250);
    let side = await evalJs(`[...document.querySelectorAll('#mlist .mk')].length`);
    check('side panel 2 marks', side === 2, 'n=' + side);
    await shot('06-marks-panel');
    await evalJs(`document.querySelector('#mlist .mk .del').click()`);
    side = await evalJs(`({n: [...document.querySelectorAll('#mlist .mk')].length, all: Object.values(__test.state().marks).flat().length})`);
    check('delete mark works', side.all === 1, JSON.stringify(side));
    await evalJs(`document.querySelector('#mk-close').click()`);

    // 8. 列表收起/展开
    await evalJs(`document.querySelector('#mt-fold').click()`);
    const hid = await evalJs(`window.__listHidden()`);
    await evalJs(`document.querySelector('#mt-fold').click()`);
    const shown = await evalJs(`!window.__listHidden()`);
    check('list collapse/expand', hid && shown);

    // 9. 导出 JSON 结构（schema/降序/at_frame/seg 自动编号）
    await evalJs(`__test.switchView('video')`);
    await sleep(150);
    const json = await evalJs(`__test.buildJson()`);
    check('schema v1', json.schema === 'moyutai.marks.v1', json.schema);
    check('json mode video', json.mode === 'video' && json.fps === 25);
    const act = json.actions;
    check('actions desc order', act.length >= 1 && act.every((a, i) => i === 0 || act[i - 1].list_index >= a.list_index), JSON.stringify(act.map(a => [a.list_index, a.at_seconds])));
    check('at_frame present for video', act.every(a => a.action !== 'split' || Number.isInteger(a.at_frame)));
    check('seg auto naming', json.files.some(f => f.seg_is_auto && /^auto-/.test(f.seg)));
    await evalJs(`__test.openExport()`);
    await sleep(200);
    const expVisible = await evalJs(`document.querySelector('#exp').classList.contains('on')`);
    check('export sheet opens', expVisible);
    await shot('07-export-json');
    await evalJs(`document.querySelector('#exp-close').click()`);

    // 10. 音频台：切换、加载、步进 0.05、时频图 canvas 有内容
    await evalJs(`__test.switchView('audio')`);
    await sleep(200);
    await evalJs(`document.querySelector('#al-pick').click()`);
    await sleep(200);
    const aList = await evalJs(`document.querySelectorAll('#files2 .fitem').length`);
    check('audio list 4 items', aList === 4, 'n=' + aList);
    await evalJs(`document.querySelector('#a-sup').click()`);
    const a1 = await evalJs(`__test.state().t`);
    await evalJs(`document.querySelector('#a-sup').click()`);
    const a2 = await evalJs(`__test.state().t`);
    check('audio step 0.05s', Math.abs((a2 - a1) - 0.05) < 1e-6, 'd=' + (a2 - a1).toFixed(4));
    const px = await evalJs(`(function(){ const cv=document.querySelector('#a-canvas'); const g=cv.getContext('2d'); const d=g.getImageData(0,40,cv.width,200).data; let n=0; for(let i=3;i<d.length;i+=4*997) if(d[i]>8) n++; return n; })()`);
    check('spectrogram painted', px > 50, 'nonblackSamples=' + px);
    await evalJs(`__test.addMark('split')`);
    const aJson = await evalJs(`__test.buildJson()`);
    check('audio json no fps', aJson.mode === 'audio' && aJson.fps === undefined);
    check('audio actions seconds only', aJson.actions.every(a => a.at_frame === undefined && typeof a.at_seconds === 'number'));
    await shot('08-audio-workspace');

    // 11. 播放推进
    await evalJs(`document.querySelector('#a-play').click()`);
    await sleep(900);
    const at = await evalJs(`__test.state().t`);
    check('audio playback advances', at > 0.3, 't=' + at?.toFixed(2));

    const pass = results.filter(r => r.ok).length;
    console.log(`\\n=== ${pass}/${results.length} passed ===`);
    process.exitCode = pass === results.length ? 0 : 1;
} catch (e) {
    console.error('FATAL', e.message);
    try { await shot('99-fatal'); } catch {}
    process.exitCode = 1;
} finally {
    try { srv.kill(); edge.kill(); } catch {}
    await sleep(300);
    try {
        const { execSync } = await import('node:child_process');
        const out = execSync('netstat -ano', { shell: 'cmd.exe' }).toString();
        const pids = new Set();
        out.split(/\r?\n/).forEach(l => {
            if ((l.includes(':' + PORT) || l.includes(':' + CDP)) && /LISTENING/.test(l)) {
                const pid = l.trim().split(/\s+/).pop();
                if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid);
            }
        });
        pids.forEach(pid => { try { execSync('taskkill /PID ' + pid + ' /T /F'); } catch {} });
    } catch {}
}
