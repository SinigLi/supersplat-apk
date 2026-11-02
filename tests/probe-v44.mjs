/* tests/probe-v44.mjs - v44 解压中心 Web 层探针（390x844 headless Edge）
 * 桌面无原生插件：mock window.Capacitor.Plugins.Extract（pick/extract/addListener）
 * 验证：解压按钮位置（新建左侧）→ 弹层 → 选文件识别分卷 → rar 拒绝 → 开始解压
 *       → progress 更新 → done 结果展示 → 关闭重开状态复位
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('www');
const PORT = 4196;
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
    '--user-data-dir=' + path.join(process.env.TEMP, 'edge_v44_profile'),
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
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result?.value;
}
const results = [];
const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + String(detail).slice(0, 120) : ''}`);
};

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
    await sleep(1500);

    // 1. 工程页默认打开 + extract.js 已加载
    const base = await evalJs(`({pjOpen: document.querySelector('#pjPage')?.classList.contains('open'), ext: !!window.__extract})`);
    check('project page opens / extract loaded', base.pjOpen === true && base.ext === true, JSON.stringify(base));

    // 2. 安装原生 mock（build() 惰性，首次 open 前安装即可）
    await evalJs(`(function(){
        const L = {};
        window.__mockEv = L;
        window.Capacitor = { Plugins: { Extract: {
            pick: async () => ({ files: window.__mockPick || [] }),
            extract: async (args) => {
                window.__mockExtractArgs = args;
                setTimeout(() => (L.progress||[]).forEach(f => f({phase:'copy',done:50,total:100,pct:50})), 40);
                setTimeout(() => (L.progress||[]).forEach(f => f({phase:'extract',done:100,total:100,pct:100})), 90);
                setTimeout(() => (L.done||[]).forEach(f => f({dest:'/storage/emulated/0/Download/摸鱼台/主美_场景资产',files:3,bytes:12345,volumes:2})), 140);
                return { started: true };
            },
            addListener: (ev, cb) => { (L[ev] = L[ev] || []).push(cb); return { remove(){} }; }
        }}};
        return true;
    })()`);

    // 3. 解压按钮在新建左侧
    const pos = await evalJs(`(function(){
        const ext = document.querySelector('.pj-ext-btn');
        const head = document.querySelector('.pj-head');
        const kids = [...head.children].map(e => e.className + ':' + e.textContent.trim());
        return { has: !!ext, kids, idx: kids.findIndex(k => k.includes('pj-ext-btn')), newIdx: kids.findIndex(k => k.includes('pj-new') && !k.includes('pj-ext-btn')) };
    })()`);
    check('extract button left of new', pos.has && pos.idx >= 0 && pos.idx < pos.newIdx, JSON.stringify(pos.kids));
    await evalJs(`document.querySelector('.pj-ext-btn').click()`);
    await sleep(120);
    check('dialog opens', await evalJs(`[...document.querySelectorAll('.pj-dlg-mask')].some(d => d.classList.contains('open'))`));

    // 4. 选文件：两个分卷 → 识别卷组
    await evalJs(`window.__mockPick = [{uri:'u1',name:'主美_场景资产.7z.001',size:1048576},{uri:'u2',name:'主美_场景资产.7z.002',size:524288}]`);
    await evalJs(`[...document.querySelectorAll('.pj-dlg-mask.open .pj-dlg-btn')].find(b => b.textContent.includes('选择文件')).click()`);
    await sleep(150);
    const picked = await evalJs(`(function(){
        const masks = [...document.querySelectorAll('.pj-dlg-mask.open')];
        const hint = masks.map(m => m.querySelector('.pj-dlg-hint')).find(Boolean);
        const go = masks.map(m => [...m.querySelectorAll('.pj-dlg-btn')].find(b => b.textContent.includes('开始解压'))).find(Boolean);
        return { txt: hint ? hint.textContent : '', goDisabled: go ? go.disabled : null };
    })()`);
    check('volumes recognized (2 卷)', /分卷/.test(picked.txt) && /2 卷/.test(picked.txt), picked.txt);
    check('go enabled after pick', picked.goDisabled === false);

    // 5. 开始解压 → progress → done
    await evalJs(`[...document.querySelectorAll('.pj-dlg-mask.open .pj-dlg-btn')].find(b => b.textContent.includes('开始解压')).click()`);
    await sleep(350);
    const done = await evalJs(`(function(){
        const open = [...document.querySelectorAll('.pj-dlg-mask.open')].find(m => m.querySelector('.pj-ext-res'));
        const res = open && open.querySelector('.pj-ext-res');
        const args = window.__mockExtractArgs;
        return { txt: res ? res.textContent : '', cls: res ? res.className : '', uris: args ? args.uris.length : 0, progShown: !!window.__mockEv.progress };
    })()`);
    check('extract called with 2 uris', done.uris === 2, JSON.stringify(done));
    check('progress listeners wired', done.progShown === true);
    check('done banner dest+files+volumes', /Download\/摸鱼台\/主美_场景资产/.test(done.txt) && /3 个文件/.test(done.txt) && /2 卷/.test(done.txt), done.txt);
    check('result class ok', done.cls.includes('ok'));

    // 6. rar 拒绝
    await evalJs(`window.__mockPick = [{uri:'r1',name:'旧资产.rar',size:999}]`);
    await evalJs(`[...document.querySelectorAll('.pj-dlg-mask.open .pj-dlg-btn')].find(b => b.textContent.includes('选择文件')).click()`);
    await sleep(150);
    const rar = await evalJs(`(function(){
        const open = [...document.querySelectorAll('.pj-dlg-mask.open')].find(m => m.querySelector('.pj-dlg-hint'));
        const hint = open ? open.querySelector('.pj-dlg-hint').textContent : '';
        const go = open ? [...open.querySelectorAll('.pj-dlg-btn')].find(b => b.textContent.includes('开始解压')) : null;
        return { hint, goDisabled: go ? go.disabled : null };
    })()`);
    check('rar rejected (btn disabled + warn)', rar.goDisabled === true && /rar 不支持/.test(rar.hint), JSON.stringify(rar));

    // 7. 关闭（busy 已复位）→ 重开状态复位
    await evalJs(`[...document.querySelectorAll('.pj-dlg-mask.open .pj-dlg-btn')].find(b => b.textContent.trim() === '关闭').click()`);
    await sleep(120);
    await evalJs(`document.querySelector('.pj-ext-btn').click()`);
    await sleep(120);
    const reset = await evalJs(`(function(){
        const open = [...document.querySelectorAll('.pj-dlg-mask.open')].find(m => m.querySelector('.pj-dlg-hint'));
        const go = open ? [...open.querySelectorAll('.pj-dlg-btn')].find(b => b.textContent.includes('开始解压')) : null;
        return { hint: open ? open.querySelector('.pj-dlg-hint').textContent : '', goDisabled: go ? go.disabled : null };
    })()`);
    check('reopen resets state', /支持 zip \/ 7z/.test(reset.hint) && reset.goDisabled === true, JSON.stringify(reset));

    // 8. 原生 extract 失败路径（error 事件）
    await evalJs(`(function(){
        const L = window.__mockEv;
        window.Capacitor.Plugins.Extract.extract = async () => {
            setTimeout(() => (L.error||[]).forEach(f => f({message:'分卷不完整或损坏（缺卷/顺序错误？请全选 .001~.NNN）'})), 60);
            return { started: true };
        };
        window.__mockPick = [{uri:'u1',name:'坏卷.7z.001',size:10}];
        return true;
    })()`);
    await evalJs(`[...document.querySelectorAll('.pj-dlg-mask.open .pj-dlg-btn')].find(b => b.textContent.includes('选择文件')).click()`);
    await sleep(120);
    await evalJs(`[...document.querySelectorAll('.pj-dlg-mask.open .pj-dlg-btn')].find(b => b.textContent.includes('开始解压')).click()`);
    await sleep(300);
    const errShown = await evalJs(`(function(){
        const open = [...document.querySelectorAll('.pj-dlg-mask.open')].find(m => m.querySelector('.pj-ext-res'));
        const res = open && open.querySelector('.pj-ext-res');
        return { txt: res ? res.textContent : '', cls: res ? res.className : '' };
    })()`);
    check('error path shows message', /分卷不完整/.test(errShown.txt) && errShown.cls.includes('err'), JSON.stringify(errShown));

    check('no page exceptions', exceptions.length === 0, exceptions.join(' | '));

    const pass = results.filter(r => r.ok).length;
    console.log(`\n=== ${pass}/${results.length} passed ===`);
    process.exitCode = pass === results.length ? 0 : 1;
} catch (e) {
    console.error('FATAL', e.message);
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
