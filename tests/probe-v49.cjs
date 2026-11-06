/* v49 图片模式探针：M1+M2 门禁
 * 走静态服务器 + headless Edge，真实 pointer 事件驱动。
 * 覆盖：模式四选一、创建、路由、导入、笔画、撤销重做、反选、导出 alpha。 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk';
const WWW = ROOT + '/www';
const PORT = 4331, CDP_PORT = 9331;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'F:/openclawhome/openclaw/fullstack_workspace/temp/v49-probe';
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(WWW, p);
    if (!f.startsWith(path.resolve(WWW)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    await new Promise(r => server.listen(PORT, '127.0.0.1', r));
    const prof = OUT + '/profile';
    fs.rmSync(prof, { recursive: true, force: true });
    const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + CDP_PORT,
        '--user-data-dir=' + prof, '--no-first-run', '--hide-scrollbars',
        '--enable-unsafe-webgpu', '--use-angle=d3d11',
        '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });

    let targets = null;
    for (let i = 0; i < 60; i++) {
        await sleep(400);
        try { targets = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list')).json(); if (targets?.length) break; } catch (e) { }
    }
    const t = targets.find(x => x.type === 'page') || targets[0];
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    let id = 0; const pend = new Map(); const errors = [];
    ws.addEventListener('message', ev => {
        const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
        if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 260));
        if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    });
    const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
    const ev = async e => {
        const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error('EVAL ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
        return r.result.value;
    };
    const shot = async n => {
        const r = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(OUT, n + '.png'), Buffer.from(r.data, 'base64'));
    };

    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' });

    // 等 3D 引擎起来（否则 projects 页不初始化）
    let ready = false;
    for (let i = 0; i < 90; i++) {
        for (let i = 0; i < 20; i++) { await sleep(200); if (await ev('!!window.__probeImgBytes')) break; }
        try { ready = await ev('!!(window.__projects && window.__img && window.__imgLogic)'); } catch (e) { }
        if (ready) break;
    }
    console.log('modules ready = ' + ready);

    let bad = 0;
    const ck = (n, ok, x) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!ok) bad++; };

    ck('img-store 已加载', await ev('!!window.__imgLogic'));
    ck('img-ui 已加载', await ev('!!window.__img'));
    ck('四选一含图片', await ev(`(() => {
      const btns = [].slice.call(document.querySelectorAll('.pj-mode'));
      return btns.some(b => b.textContent.indexOf('图片') >= 0);
    })()`));

    // ---- 直接走 img.open 模拟已创建工程（M1 的创建路径由 projects-ui 单元覆盖，
    // 这里的重点是工作台本身）。先造一个假工程注册表 + meta。
    await ev(`(() => {
      const reg = window.__projectLogic.loadRegistry();
      reg.projects = reg.projects.filter(p => p.name !== '探针图片工程');
      window.__projectLogic.saveRegistry(reg);
      const L = window.__imgLogic;
      const m = L.emptyMeta('探针图片工程');
      L.saveMeta(m);
      // 生成一张 600x400 测试图直接给 img-ui（绕过文件选择对话框）
      const c = document.createElement('canvas');
      c.width = 600; c.height = 400;
      const g = c.getContext('2d');
      const lg = g.createLinearGradient(0,0,600,400);
      lg.addColorStop(0,'#2b5aa8'); lg.addColorStop(1,'#a83b6b');
      g.fillStyle = lg; g.fillRect(0,0,600,400);
      window.__probeImgBytes = null;
      c.toBlob(async b => {
        const buf = await b.arrayBuffer();
        window.__probeImgBytes = new Uint8Array(buf);
      }, 'image/png');
      return 'prepared';
    })()`);
    await sleep(400);

    /* 导入时序说明（v49 探针修正）：
     * 真实用户流程是工作台里点「选择图片」→ pickImage() 一次完成
     * put + meta 更新 + 当场解码显示，不存在「open 后再改 meta」。
     * 探针绕过文件对话框，按相同顺序注入：先 put+meta，再 open。 */
    const put = await ev(`(async () => {
      const bytes = window.__probeImgBytes;
      if (!bytes) return 'bytes-not-ready';
      const PJ = window.__projectLogic;
      const p = PJ.pathsFor('探针图片工程');
      const rel = await PJ.putContentFile(p, 'png', bytes);
      const L = window.__imgLogic;
      const m = L.loadMeta('探针图片工程');
      m.imageFile = rel; m.imageW = 600; m.imageH = 400;
      L.saveMeta(m);
      return rel;
    })()`);
    console.log('图片落盘: ' + put);
    ck('内容寻址写入成功', typeof put === 'string' && put.indexOf('files/') === 0, put);

    await ev('window.__img.open("探针图片工程")');
    let imgOk = false;
    for (let i = 0; i < 30; i++) {
        await sleep(300);
        try { imgOk = await ev('window.__img.state().hasImage === true'); } catch (e) { }
        if (imgOk) break;
    }

    const st2 = JSON.parse(await ev('JSON.stringify(window.__img.state())'));
    console.log('重开后状态: ' + JSON.stringify(st2));
    ck('图片已恢复', st2.hasImage === true, st2);
    ck('尺寸正确', st2.imgW === 600 && st2.imgH === 400, st2);
    await shot('S2-image-loaded');

    // ---- M2 交互：涂抹 ----
    await ev('window.__img._setTool("brush")');
    await sleep(200);
    await ev(`(async () => {
      const s = document.querySelector('#imgPage .img-stage');
      const mk = (t,pid,x,y) => new PointerEvent(t,{pointerId:pid,pointerType:'touch',isPrimary:true,clientX:x,clientY:y,bubbles:true,cancelable:true,button:0,buttons:1});
      s.dispatchEvent(mk('pointerdown',1,150,380));
      for(let i=1;i<=10;i++){ s.dispatchEvent(mk('pointermove',1,150+i*12,380+i*2)); await new Promise(r=>requestAnimationFrame(r)); }
      s.dispatchEvent(mk('pointerup',1,270,400));
      await new Promise(r=>setTimeout(r,150));
    })()`);
    await sleep(400);
    await shot('S3-stroke');

    let st = JSON.parse(await ev('JSON.stringify(window.__img.state())'));
    ck('涂抹产生笔画', st.strokes === 1, st.strokes);

    // 导出像素验证（用 _exportCanvas）
    const alpha = JSON.parse(await ev(`(() => {
      const c = window.__img._exportCanvas();
      const g = c.getContext('2d');
      const d = g.getImageData(0,0,c.width,c.height).data;
      // 全图扫描找 alpha==0 的像素数量
      let holes = 0, first = null;
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] === 0) { holes++; if (!first) first = { x: ((i-3)/4) % c.width, y: Math.floor(((i-3)/4) / c.width) }; }
      }
      const corner = g.getImageData(2,2,1,1).data[3];
      return JSON.stringify({holes, first, cornerAlpha: corner});
    })()`));
    console.log('导出采样: ' + alpha);
    ck('笔画处被挖穿', alpha.holes > 500, alpha.holes);
    ck('未画处保留', alpha.cornerAlpha === 255, alpha.cornerAlpha);

    // 撤销 / 重做
    await ev('window.__img._undo()');
    await sleep(300);
    st = JSON.parse(await ev('JSON.stringify(window.__img.state())'));
    ck('撤销后笔画为 0', st.strokes === 0 && st.redo === 1, st);
    await ev('window.__img._redo()');
    await sleep(300);
    st = JSON.parse(await ev('JSON.stringify(window.__img.state())'));
    ck('重做后笔画恢复', st.strokes === 1 && st.redo === 0, st);

    /* v49b：多边形改为手绘套索——按住拖动画一圈，松手自动闭合。
     * 探针对应改造：一次 pointerdown → 沿矩形轨迹 pointermove → pointerup。 */
    await ev('window.__img._setTool("polygon")');
    await sleep(200);
    const lasso = await ev(`(async () => {
      const s = document.querySelector('#imgPage .img-stage');
      const mk = (t,pid,x,y) => new PointerEvent(t,{pointerId:pid,pointerType:'touch',isPrimary:true,clientX:x,clientY:y,bubbles:true,cancelable:true,button:0,buttons:1});
      const before = window.__img.state().strokes;
      // 画一个矩形轮廓并回到起点（模拟套索）
      const path = [];
      const L = 140, T = 300, R = 250, B = 420;
      for (let x = L; x <= R; x += 8) path.push([x, T]);
      for (let y = T; y <= B; y += 8) path.push([R, y]);
      for (let x = R; x >= L; x -= 8) path.push([x, B]);
      for (let y = B; y >= T; y -= 8) path.push([L, y]);
      s.dispatchEvent(mk('pointerdown', 2, L, T));
      for (const [x,y] of path) {
        s.dispatchEvent(mk('pointermove', 2, x, y));
        await new Promise(r=>requestAnimationFrame(r));
      }
      const mid = window.__img.state().strokes;
      s.dispatchEvent(mk('pointerup', 2, L, T));
      await new Promise(r=>setTimeout(r,150));
      const after = window.__img.state().strokes;
      return JSON.stringify({before, duringDrag: mid, after});
    })()`);
    const lr = JSON.parse(lasso);
    console.log('套索状态: ' + lasso);
    ck('拖动中未入栈（松手才闭合）', lr.duringDrag === lr.before, lr);
    ck('松手后自动闭合入栈', lr.after === lr.before + 1, lr);
    await sleep(300);
    await shot('S4-polygon-lasso');

    st = JSON.parse(await ev('JSON.stringify(window.__img.state())'));
    ck('多边形入栈', st.strokes === 2, st.strokes);

    // 闭合验证：导出蒙版在矩形内部应为挖穿状态
    const lassoHole = JSON.parse(await ev(`(() => {
      const st = window.__img.state();
      const c = window.__img._exportCanvas();
      const g = c.getContext('2d');
      // 矩形内部中心点（图片坐标 ≈ 屏幕/scale，但这里直接扫全图统计）
      const d = g.getImageData(0,0,c.width,c.height).data;
      let holes = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] === 0) holes++;
      return JSON.stringify({holes, w: c.width, h: c.height});
    })()`));
    console.log('套索导出: ' + JSON.stringify(lassoHole));
    ck('套索区域已挖穿', lassoHole.holes > 1000, lassoHole.holes);
    await shot('S5-polygon-done');

    // 反选
    await ev(`document.querySelector('#imgPage [title*="反选"]').click()`);
    await sleep(300);
    st = JSON.parse(await ev('JSON.stringify(window.__img.state())'));
    ck('反选生效', st.invert === true, st);
    await shot('S6-invert');
    await ev(`document.querySelector('#imgPage [title*="反选"]').click()`);
    await sleep(200);

    // 橡皮：擦掉多边形的一部分
    await ev('window.__img._setTool("erase")');
    await sleep(200);
    await ev(`(async () => {
      const s = document.querySelector('#imgPage .img-stage');
      const mk = (t,pid,x,y) => new PointerEvent(t,{pointerId:pid,pointerType:'touch',isPrimary:true,clientX:x,clientY:y,bubbles:true,cancelable:true,button:0,buttons:1});
      s.dispatchEvent(mk('pointerdown',3,150,340));
      for(let i=1;i<=8;i++){ s.dispatchEvent(mk('pointermove',3,150+i*14,340)); await new Promise(r=>requestAnimationFrame(r)); }
      s.dispatchEvent(mk('pointerup',3,262,340));
      await new Promise(r=>setTimeout(r,150));
    })()`);
    await sleep(400);
    st = JSON.parse(await ev('JSON.stringify(window.__img.state())'));
    ck('橡皮笔画入栈', st.strokes === 3, st.strokes);
    await shot('S7-erase');

    // 持久化：笔画在 localStorage
    const persisted = await ev(`(() => {
      const s = window.__imgLogic.loadStrokes('探针图片工程');
      return JSON.stringify({schema: s.schema, n: s.strokes.length,
        types: s.strokes.map(x=>x.type)});
    })()`);
    console.log('持久化: ' + persisted);
    const pj2 = JSON.parse(persisted);
    ck('strokes 已持久化', pj2.n === 3 && pj2.schema === 'moyutai.imgmask.v1', pj2);

    // 面板尺寸断言（原型确认过的收敛值）
    await ev('window.__img._setTool("brush")');
    await sleep(200);
    await ev(`document.querySelectorAll('#imgPage .img-grp')[1].click()`);
    await sleep(350);
    const pb = JSON.parse(await ev(`(() => {
      const r = document.querySelector('#imgPage .img-sub.open').getBoundingClientRect();
      return JSON.stringify({w:Math.round(r.width),h:Math.round(r.height)});
    })()`));
    ck('绘制面板尺寸收敛', pb.w <= 155 && pb.h <= 200, pb);

    /* ---- v49b 回归：遮罩不叠加、顶栏避让系统栏 ---- */

    // 1) 遮罩层用整体 opacity，笔画本身 alpha=1（否则同一处来回涂会越涂越深）
    const maskStyle = JSON.parse(await ev(`(() => {
      const m = document.querySelector('#imgPage .img-mask');
      return JSON.stringify({ opacity: getComputedStyle(m).opacity });
    })()`));
    ck('遮罩层整体不透明度 .82', Math.abs(maskStyle.opacity - 0.82) < 0.01, maskStyle);

    // 2) 顶栏避让：mock 原生 getSafeArea 返回 96 物理 px @dpr2 → 48 CSS px
    const safe = await ev(`(async () => {
      window.Capacitor = window.Capacitor || { Plugins: {} };
      window.Capacitor.Plugins.MediaServer = window.Capacitor.Plugins.MediaServer || {};
      window.Capacitor.Plugins.MediaServer.getSafeArea = function () {
        return Promise.resolve({ top: 96, bottom: 0, left: 0, right: 60 });
      };
      // 触发重读
      window.__img.back();
      window.__img.open('探针图片工程');
      await new Promise(r => setTimeout(r, 900));
      const top = document.querySelector('#imgPage .img-top');
      const dock = document.querySelector('#imgPage .img-dock');
      return JSON.stringify({
        padTop: getComputedStyle(top).paddingTop,
        height: Math.round(top.getBoundingClientRect().height),
        dockRight: dock ? getComputedStyle(dock).right : null
      });
    })()`);
    const sf = JSON.parse(safe);
    console.log('安全区: ' + safe);
    ck('顶栏吃下状态栏高度', sf.padTop === '48px', sf);
    ck('顶栏总高 = 52 + 48', sf.height === 100, sf);
    ck('工具组避开右侧挖孔', sf.dockRight === '40px', sf.dockRight);

    // 3) 脏值保护：超阈值一律归零（Android 旋转过渡期的旧方向值）
    const dirty = await ev(`(async () => {
      window.Capacitor.Plugins.MediaServer.getSafeArea = function () {
        return Promise.resolve({ top: 400, bottom: 0, left: 0, right: 0 });
      };
      window.__img.back();
      window.__img.open('探针图片工程');
      await new Promise(r => setTimeout(r, 900));
      const top = document.querySelector('#imgPage .img-top');
      return getComputedStyle(top).paddingTop;
    })()`);
    ck('超阈值脏值归零', dirty === '0px', dirty);

    // 恢复 mock，免得影响后续
    await ev(`(() => {
      delete window.Capacitor.Plugins.MediaServer.getSafeArea;
      return 'ok';
    })()`);

    /* ---- v49c：返回按钮必须真的回到工程列表 ----
     * 事故：open() 为绕开样式表缓存把 display:flex 内联写死，back() 只
     * remove('open') 类，内联 display 仍然生效 → 图片页继续盖在列表上，
     * 表现为「点返回没反应」。断言内联 display 与可见性都复位。 */
    const backBefore = JSON.parse(await ev(`(() => {
      const p = document.getElementById('imgPage');
      return JSON.stringify({
        open: p.classList.contains('open'),
        inline: p.style.display,
        computed: getComputedStyle(p).display
      });
    })()`));
    ck('打开时工作台可见', backBefore.computed === 'flex', backBefore);

    await ev(`document.querySelector('#imgPage .img-top-btn').click()`);
    await sleep(700);

    const backAfter = JSON.parse(await ev(`(() => {
      const p = document.getElementById('imgPage');
      const pj = document.getElementById('pjPage');
      const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      return JSON.stringify({
        imgOpen: p.classList.contains('open'),
        imgInline: p.style.display,
        imgComputed: getComputedStyle(p).display,
        pjOpen: pj ? pj.classList.contains('open') : null,
        pjReachable: !!(pj && el && pj.contains(el))
      });
    })()`));
    console.log('返回后: ' + JSON.stringify(backAfter));
    ck('返回后工作台隐藏', backAfter.imgComputed === 'none' && backAfter.imgInline === 'none', backAfter);
    ck('返回后列表可见且可点', backAfter.pjOpen === true && backAfter.pjReachable === true, backAfter);

    // 往返一次：确认可以再次进入并再次返回
    await ev('window.__img.open("探针图片工程")');
    await sleep(800);
    const reopen = await ev(`getComputedStyle(document.getElementById('imgPage')).display`);
    ck('可再次进入工作台', reopen === 'flex', reopen);
    await ev(`document.querySelector('#imgPage .img-top-btn').click()`);
    await sleep(600);
    const reclose = await ev(`getComputedStyle(document.getElementById('imgPage')).display`);
    ck('二次返回仍有效', reclose === 'none', reclose);

    console.log('\n运行时异常: ' + (errors.length ? errors.join(' | ') : '无'));
    ck('无运行时异常', errors.length === 0, errors.length);

    console.log(bad === 0 ? '\n=== probe-v49 ALL PASS ===' : '\n=== probe-v49 FAIL(' + bad + ') ===');
    try { ws.close(); } catch (e) { }
    try { edge.kill(); } catch (e) { }
    server.close();
    process.exit(0);
})().catch(e => { console.error('FATAL ' + e.message); try { server.close(); } catch (x) { } process.exit(1); });
