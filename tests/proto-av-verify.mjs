/* proto-av-verify.mjs - v44 原型 r2 CDP 验证（390x844 headless Edge）
 * r2 新增验证：并入前段开关语义（标记在开头）、剪切点上下文切换+吸附、多帧标记、沉浸模式、音频播放条完整性
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('prototype');
const PORT = 4194;
const CDP = 9253;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SHOTDIR = process.env.TEMP + '\\proto_av_shots2';
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
    '--user-data-dir=' + path.join(process.env.TEMP, 'edge_proto44r2_profile'),
    '--window-size=390,844',
    `http://127.0.0.1:${PORT}/av-workspace-proto.html`
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
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed: ' + expr.slice(0, 60));
    return r.result?.value;
}
async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const p = SHOTDIR + '\\' + name + '.png';
    fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
    console.log('SHOT ' + name);
    return p;
}
const results = [];
const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};
const click = sel => evalJs(`document.querySelector('${sel}').click()`);
/* 用 pointerdown 在播放条 fraction 处 seek（触发吸附） */
const seekBar = (barSel, frac) => evalJs(`(function(){ const b=document.querySelector('${barSel}'); const r=b.getBoundingClientRect(); b.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.left+r.width*${frac},buttons:1,bubbles:true})); return __test.state().t; })()`);

try {
    ws = new WebSocket(await getWs());
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params.exceptionDetails;
            exceptions.push((d.exception?.description || d.text).slice(0, 160));
        }
        if (m.id && pending.has(m.id)) {
            const p = pending.get(m.id); pending.delete(m.id);
            m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
        }
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await sleep(1200);

    /* 1. 首页 */
    const home = await evalJs(`({unz:!!document.querySelector('#b-unz'),neu:!!document.querySelector('#b-new'),projs:document.querySelectorAll('.proj').length})`);
    check('home buttons', home.unz && home.neu, JSON.stringify(home));
    check('home project cards', home.projs >= 3);
    await shot('01-home');

    /* 2. 解压 */
    await click('#b-unz'); await click('#unz-pick');
    const unzFile = await evalJs(`document.querySelector('#unz-file').textContent`);
    check('unzip volume detect', /7z\.001.*\.002~\.004/.test(unzFile));
    await click('#unz-go'); await sleep(1800);
    const unzRes = await evalJs(`({done:window.__testUnz,res:document.querySelector('#unz-res').textContent})`);
    check('unzip _exp banner', unzRes.done === 'done' && /_exp/.test(unzRes.res));
    await shot('02-unzip');
    await click('#unz-close');

    /* 3. 新建 → 视频台 */
    await click('#b-new');
    check('3 mode cards', await evalJs(`document.querySelectorAll('.mode>div').length`) === 3);
    await shot('03-new-sheet');
    await click('.mode>div[data-m="video"]'); await sleep(250);
    check('video workspace opens', await evalJs(`document.querySelector('#v-video').classList.contains('on')`));
    await click('#lv-pick'); await sleep(200);
    const list = await evalJs(`(() => { const it=[...document.querySelectorAll('#files .fitem')]; return {n:it.length,autos:it.filter(i=>i.querySelector('.no.auto')).length}; })()`);
    check('video list 5 items / 1 auto', list.n === 5 && list.autos === 1, JSON.stringify(list));
    await shot('04-video-list');

    /* 4. 分割点：加 → 上下文切换 → 移除 */
    await evalJs(`__test.toggleSplit()`);
    let mk = await evalJs(`__test.state().marks`);
    let arr = Object.values(mk).flat();
    check('split added', arr.length === 1 && arr[0].type === 'split' && arr[0].at === 0, JSON.stringify(arr[0]));
    /* seek 精确落在标记上（吸附）→ 按钮变移除 */
    const tSnap = await seekBar('#bar', 0);   // 0 处即标记处
    check('snap onto mark', Math.abs(tSnap - 0) < 0.001, 't=' + tSnap);
    const cutTxt = await evalJs(`document.querySelector('#v-cut').textContent`);
    check('button context → remove', cutTxt.includes('移除剪切点'), cutTxt);
    await shot('05-context-remove');
    await click('#v-cut');
    arr = Object.values(await evalJs(`__test.state().marks`)).flat();
    check('toggle removes split', arr.length === 0, 'n=' + arr.length);
    const cutTxt2 = await evalJs(`document.querySelector('#v-cut').textContent`);
    check('button back to add', cutTxt2.includes('分割点'), cutTxt2);

    /* 5. 吸附：先加标记@~30%，再在附近点按 → 自动吸附 */
    await seekBar('#bar', 0.30);
    await evalJs(`__test.toggleSplit()`);
    arr = Object.values(await evalJs(`__test.state().marks`)).flat();
    const markAt = arr[0].at;
    const tNear = await seekBar('#bar', (markAt + 0.35) / 8.4);
    check('snap nearby click', Math.abs(tNear - markAt) < 0.01, 'mark=' + markAt + ' snapped=' + tNear.toFixed(3));

    /* 6. 并入前段：开关语义 + 标记在开头 */
    await click('#v-mrg');
    const mrgTxt = await evalJs(`document.querySelector('#v-mrg').textContent`);
    check('merge button → 解除', mrgTxt.includes('解除并入前段'), mrgTxt);
    const mrgMark = await evalJs(`(() => { const f=(__test.state().marks); const a=Object.values(f).flat().find(m=>m.type==='merge_prev'); const el=document.querySelector('#trackmarks .tm.mrg'); return {at:a&&a.at, styleLeft:el?el.style.left:null}; })()`);
    check('merge mark at head (at=0,left=0)', mrgMark.at === 0 && (mrgMark.styleLeft === '0%' || mrgMark.styleLeft === '0px'), JSON.stringify(mrgMark));
    const j1 = await evalJs(`__test.buildJson()`);
    check('json files[].merge_prev', j1.files.some(f => f.merge_prev === true));
    await shot('06-merge-marked');
    await click('#v-mrg');
    const mrgTxt2 = await evalJs(`document.querySelector('#v-mrg').textContent`);
    check('merge toggle off', mrgTxt2.includes('并入前段') && !mrgTxt2.includes('解除'), mrgTxt2);
    const j2 = await evalJs(`__test.buildJson()`);
    check('json merge_prev cleared', j2.files.every(f => !f.merge_prev));

    /* 7. 多帧标记：加/移除 + 紫色标线 */
    await seekBar('#bar', 0.55);
    await click('#v-mf');
    arr = Object.values(await evalJs(`__test.state().marks`)).flat();
    const mf = arr.find(m => m.type === 'multiframe');
    check('multiframe added', !!mf && Number.isInteger(mf.frame), JSON.stringify(mf));
    const mfLine = await evalJs(`(() => { const el=document.querySelector('#trackmarks .tm.mf'); return el ? getComputedStyle(el).backgroundColor : null; })()`);
    check('multiframe purple line', mfLine && mfLine.includes('178'), mfLine);
    const mfTxt = await evalJs(`document.querySelector('#v-mf').textContent`);
    check('mf button context', mfTxt.includes('移除多帧点'), mfTxt);
    await shot('07-multiframe');
    await click('#v-mf');
    arr = Object.values(await evalJs(`__test.state().marks`)).flat();
    check('multiframe removed', !arr.some(m => m.type === 'multiframe'));

    /* 8. 帧步进 */
    const t1 = await evalJs(`(__test.state().t)`);
    await click('#v-sup'); const ta = await evalJs(`__test.state().t`);
    await click('#v-sup'); const tb = await evalJs(`__test.state().t`);
    check('video step = 1 frame', Math.abs((tb - ta) - 1 / 25) < 1e-6, 'd=' + (tb - ta).toFixed(4));

    /* 9. 沉浸模式 */
    await click('#mt-immerse'); await sleep(150);
    const imm = await evalJs(`({on:document.querySelector('#v-video').classList.contains('immerse'),tools:getComputedStyle(document.querySelector('#v-tools')).display,bar:getComputedStyle(document.querySelector('#v-playbar')).display})`);
    check('immerse hides overlays', imm.on && imm.tools === 'none' && imm.bar === 'none', JSON.stringify(imm));
    await shot('08-immerse');
    await click('#mt-immerse');
    const imm2 = await evalJs(`getComputedStyle(document.querySelector('#v-tools')).display`);
    check('immerse off restores', imm2 !== 'none', imm2);

    /* 10. 导出 JSON（含 split，降序） */
    const json = await evalJs(`__test.buildJson()`);
    check('schema v1 / mode video / fps 25', json.schema === 'moyutai.marks.v1' && json.mode === 'video' && json.fps === 25);
    const act = json.actions;
    check('actions desc order', act.length >= 1 && act.every((a, i) => i === 0 || act[i - 1].list_index >= a.list_index), JSON.stringify(act.map(a => [a.list_index, a.at_seconds])));
    check('split has at_frame', act.filter(a => a.action === 'split').every(a => Number.isInteger(a.at_frame)));
    await evalJs(`__test.openExport()`); await sleep(200);
    check('export sheet opens', await evalJs(`document.querySelector('#exp').classList.contains('on')`));
    await shot('09-export-json');
    await click('#exp-close');

    /* 11. 标记侧栏（1 条 split） */
    await click('#mt-marks'); await sleep(250);
    const side = await evalJs(`[...document.querySelectorAll('#mlist .mk')].length`);
    check('side panel 1 split', side === 1, 'n=' + side);
    await shot('10-marks-panel');
    await click('#mk-close');

    /* 12. 音频台 */
    await evalJs(`__test.switchView('audio')`); await sleep(200);
    await click('#al-pick'); await sleep(200);
    check('audio list 4 items', await evalJs(`document.querySelectorAll('#files2 .fitem').length`) === 4);
    await click('#a-sup'); const a1 = await evalJs(`__test.state().t`);
    await click('#a-sup'); const a2 = await evalJs(`__test.state().t`);
    check('audio step 0.05s', Math.abs((a2 - a1) - 0.05) < 1e-6, 'd=' + (a2 - a1).toFixed(4));
    const px = await evalJs(`(function(){ const cv=document.querySelector('#a-canvas'); const g=cv.getContext('2d'); const d=g.getImageData(0,40,cv.width,200).data; let n=0; for(let i=3;i<d.length;i+=4*997) if(d[i]>8) n++; return n; })()`);
    check('spectrogram painted', px > 50, 'n=' + px);
    /* 13. 音频播放条完整性（r2 修复项） */
    const fit = await evalJs(`(() => { const r=document.querySelector('#bar2').getBoundingClientRect(); const bs=['#a-prev','#a-play','#a-next'].map(s=>{const x=document.querySelector(s).getBoundingClientRect();return {w:Math.round(x.width),r:Math.round(x.right)};}); return {bw:Math.round(r.width),br:Math.round(r.right),vw:window.innerWidth,bs}; })()`);
    check('audio playbar fits viewport', fit.bw > 60 && fit.br <= fit.vw && fit.bs.every(b => b.w > 20 && b.r <= fit.vw + 1), JSON.stringify(fit));
    check('audio merge button exists', await evalJs(`!!document.querySelector('#a-mrg')`));
    await evalJs(`__test.toggleMerge()`);
    const aMrg = await evalJs(`document.querySelector('#a-mrg').textContent`);
    check('audio merge context', aMrg.includes('解除并入前段'), aMrg);
    const aJson = await evalJs(`__test.buildJson()`);
    check('audio json: no fps + merge in files', aJson.mode === 'audio' && aJson.fps === undefined && aJson.files.some(f => f.merge_prev));
    await click('#a-mrg');
    await click('#a-play'); await sleep(900);
    const at = await evalJs(`__test.state().t`);
    check('audio playback advances', at > 0.3, 't=' + at?.toFixed(2));
    await shot('11-audio-workspace');

    /* 异常检查 */
    check('no page exceptions', exceptions.length === 0, exceptions.join(' | ').slice(0, 160));

    const pass = results.filter(r => r.ok).length;
    console.log(`\n=== ${pass}/${results.length} passed ===`);
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
