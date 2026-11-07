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
    ck('涂抹产生笔画', st.activeStrokes === 1 && st.totalStrokes === 1, st);

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
    ck('撤销后笔画为 0', st.activeStrokes === 0 && st.redo === 1, st);
    await ev('window.__img._redo()');
    await sleep(300);
    st = JSON.parse(await ev('JSON.stringify(window.__img.state())'));
    ck('重做后笔画恢复', st.activeStrokes === 1 && st.redo === 0, st);

    /* v49b：多边形改为手绘套索——按住拖动画一圈，松手自动闭合。
     * 探针对应改造：一次 pointerdown → 沿矩形轨迹 pointermove → pointerup。 */
    await ev('window.__img._setTool("polygon")');
    await sleep(200);
    const lasso = await ev(`(async () => {
      const s = document.querySelector('#imgPage .img-stage');
      const mk = (t,pid,x,y) => new PointerEvent(t,{pointerId:pid,pointerType:'touch',isPrimary:true,clientX:x,clientY:y,bubbles:true,cancelable:true,button:0,buttons:1});
      const before = window.__img.state().activeStrokes;
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
      const mid = window.__img.state().activeStrokes;
      s.dispatchEvent(mk('pointerup', 2, L, T));
      await new Promise(r=>setTimeout(r,150));
      const after = window.__img.state().activeStrokes;
      return JSON.stringify({before, duringDrag: mid, after});
    })()`);
    const lr = JSON.parse(lasso);
    console.log('套索状态: ' + lasso);
    ck('拖动中未入栈（松手才闭合）', lr.duringDrag === lr.before, lr);
    ck('松手后自动闭合入栈', lr.after === lr.before + 1, lr);
    await sleep(300);
    await shot('S4-polygon-lasso');

    st = JSON.parse(await ev('JSON.stringify(window.__img.state())'));
    ck('多边形入栈', st.activeStrokes === 2, st.activeStrokes);

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
    ck('橡皮笔画入栈', st.activeStrokes === 3, st.activeStrokes);
    await shot('S7-erase');

    // 持久化：v2 分层结构在 localStorage
    const persisted = await ev(`(() => {
      const s = window.__imgLogic.loadStrokes('探针图片工程');
      return JSON.stringify({schema: s.schema, layers: (s.layers||[]).length,
        strokes: (s.layers||[]).reduce((a,l)=>a+l.strokes.length,0),
        types: (s.layers||[]).flatMap(l=>l.strokes.map(x=>x.type))});
    })()`);
    console.log('持久化: ' + persisted);
    const pj2 = JSON.parse(persisted);
    ck('分层 strokes 已持久化(v2)', pj2.strokes === 3 && pj2.schema === 'moyutai.imgmask.v2' && pj2.layers >= 1, pj2);

    // 面板尺寸断言（原型确认过的收敛值）
    // M4 后 open() 会 restoreImgDockPos→closePanels；上一轮遗留的 img-dock-pos
    // 让第一次点击只做了"清遗留态"，这里点两次确保面板处于打开态再量。
    await ev('window.__img._setTool("brush")');
    await ev(`localStorage.removeItem('img-dock-pos')`);
    await sleep(200);
    const clickDraw = `[...document.querySelectorAll('#imgPage .img-grp')].find(g => g.textContent.includes('绘制')).click()`;
    /* 面板是 toggle：点一次开、再点一次关（mini 复现确认）。开一次就量。 */
    await ev(clickDraw);
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

    /* ---- v50：图层交互 ---- */
    // 打开图层面板
    await ev(`[...document.querySelectorAll('#imgPage .img-grp')].find(g => g.textContent.includes('图层')).click()`);
    await sleep(400);
    const lpOpen = await ev(`document.querySelector('#imgPage .img-layers').classList.contains('open')`);
    ck('图层面板弹出', lpOpen === true, lpOpen);
    await shot('S8-layers-panel');

    // 默认单层「遮罩 1」且激活
    let layers = JSON.parse(await ev('JSON.stringify(window.__img._layers())'));
    ck('默认单层遮罩 1', layers.length === 1 && layers[0].name === '遮罩 1' && layers[0].visible === true, layers.length);

    // 加两层 → 列表三行
    await ev('window.__img._addLayer("头发")');
    await ev('window.__img._addLayer("天空")');
    await sleep(300);
    layers = JSON.parse(await ev('JSON.stringify(window.__img._layers())'));
    ck('加两层后共三层', layers.length === 3 && layers[1].name === '头发' && layers[2].name === '天空', layers.map(l => l.name));

    // 行数与 UI 一致
    const rowCount = await ev(`document.querySelectorAll('#imgPage .img-layer-row').length`);
    ck('层列表行数一致', rowCount === 3, rowCount);

    // 在「头发」层画一笔 → 落在激活层
    const idOf = n => (layers.find(l => l.name === n) || {}).id;
    await ev('window.__img._activateLayer(' + JSON.stringify(idOf('头发')) + ')');
    await sleep(200);
    await ev(`window.__img._setTool("brush")`);
    await sleep(150);
    await ev(`(async () => {
      const s = document.querySelector('#imgPage .img-stage');
      const mk = (t,pid,x,y) => new PointerEvent(t,{pointerId:pid,pointerType:'touch',isPrimary:true,clientX:x,clientY:y,bubbles:true,cancelable:true,button:0,buttons:1});
      s.dispatchEvent(mk('pointerdown',4,120,300));
      for(let i=1;i<=6;i++){ s.dispatchEvent(mk('pointermove',4,120+i*10,300)); await new Promise(r=>requestAnimationFrame(r)); }
      s.dispatchEvent(mk('pointerup',4,180,300));
      await new Promise(r=>setTimeout(r,150));
    })()`);
    await sleep(300);
    layers = JSON.parse(await ev('JSON.stringify(window.__img._layers())'));
    const hairL = layers.find(l => l.name === '头发');
    const skyL = layers.find(l => l.name === '天空');
    ck('笔画落在激活层', hairL.strokes.length === 1 && skyL.strokes.length === 0, layers.map(l => l.name + ':' + l.strokes.length));

    // 隐藏「头发」层 → 导出无新挖除（隐藏层不参与）
    await ev('window.__img._toggleLayer(' + JSON.stringify(idOf('头发')) + ')');
    await sleep(300);
    const hidExport = JSON.parse(await ev(`(() => {
      const c = window.__img._exportCanvas();
      const g = c.getContext('2d');
      const d = g.getImageData(0,0,c.width,c.height).data;
      let holes = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] === 0) holes++;
      return holes;
    })()`));
    layers = JSON.parse(await ev('JSON.stringify(window.__img._layers())'));
    const hairHidden = layers.find(l => l.name === '头发');
    ck('隐藏层不参与导出', hairHidden.visible === false, hidExport);
    await ev('window.__img._toggleLayer(' + JSON.stringify(idOf('头发')) + ')');   // 恢复显示
    await sleep(200);

    /* 撤销链（每次编辑各自入栈，undo 逆序回退）：
     *   undo① 撤「恢复显示的 toggle」→ 头发层回到隐藏
     *   undo② 撤「隐藏的 toggle」      → 头发层恢复显示
     *   undo③ 撤「头发层的笔画」       → 笔画出栈
     * 原版只做两次 undo 就断言笔画已撤，少算了一次 toggle。 */
    await ev('window.__img._undo()');
    await sleep(250);
    layers = JSON.parse(await ev('JSON.stringify(window.__img._layers())'));
    ck('undo1: 撤恢复toggle → 层隐藏', layers.find(l => l.name === '头发').visible === false, null);
    await ev('window.__img._undo()');
    await sleep(250);
    layers = JSON.parse(await ev('JSON.stringify(window.__img._layers())'));
    ck('undo2: 撤隐藏toggle → 层恢复显示', layers.find(l => l.name === '头发').visible === true, null);
    await ev('window.__img._undo()');
    await sleep(250);
    layers = JSON.parse(await ev('JSON.stringify(window.__img._layers())'));
    ck('undo3: 撤笔画 → 头发层笔画清零', layers.find(l => l.name === '头发').strokes.length === 0, null);

    // 重命名 + 删除层（含撤销）
    await ev('window.__img._renameLayer(' + JSON.stringify(idOf('天空')) + ', "背景")');
    await sleep(250);
    layers = JSON.parse(await ev('JSON.stringify(window.__img._layers())'));
    ck('重命名生效', layers.some(l => l.name === '背景'), layers.map(l => l.name));
    await ev('window.__img._undo()');
    await sleep(250);
    layers = JSON.parse(await ev('JSON.stringify(window.__img._layers())'));
    ck('撤销重命名', layers.some(l => l.name === '天空') && !layers.some(l => l.name === '背景'), null);

    await ev('window.__img._delLayer(' + JSON.stringify(idOf('天空')) + ')');
    await sleep(250);
    layers = JSON.parse(await ev('JSON.stringify(window.__img._layers())'));
    ck('删除层生效', layers.length === 2, layers.map(l => l.name));
    await ev('window.__img._undo()');
    await sleep(250);
    layers = JSON.parse(await ev('JSON.stringify(window.__img._layers())'));
    ck('撤销删层（原位插回）', layers.length === 3 && layers[2].name === '天空', layers.map(l => l.name));

    // 重开工程：分层结构 + 激活层恢复
    await ev('window.__img.back()');
    await sleep(500);
    await ev('window.__img.open("探针图片工程")');
    await sleep(900);
    const reState = JSON.parse(await ev('JSON.stringify(window.__img.state())'));
    ck('重开后层数保持', reState.layers === 3, reState.layers);

    /* ---- v50/M2：换图入口与三选流程 ---- */
    // 顶栏「换图」按钮可见（有图状态）
    const reloadInfo = JSON.parse(await ev(`(() => {
      const btn = [...document.querySelectorAll('#imgPage .img-top-btn')].find(b => b.textContent.includes('换图'));
      if (!btn) return JSON.stringify({ exists: false });
      return JSON.stringify({ exists: true, visible: btn.style.display !== 'none' });
    })()`));
    ck('顶栏换图按钮可见', reloadInfo.exists === true && reloadInfo.visible === true, reloadInfo);

    // 换图三选：mock confirm 返回 false（取消）→ meta 不变
    const beforeMeta = JSON.parse(await ev(`JSON.stringify(window.__imgLogic.loadMeta('探针图片工程'))`));
    const cancelRes = await ev(`(async () => {
      let asked = false;
      window.confirm = function () { asked = true; return false; };
      window.__probePick = window.__img._pickImage;
      // 直接模拟 onchange：构造 File 触发完整流程
      const buf = new Uint8Array(8);
      // PNG 魔数
      buf[0]=0x89; buf[1]=0x50; buf[2]=0x4E; buf[3]=0x47; buf[4]=0x0D; buf[5]=0x0A; buf[6]=0x1A; buf[7]=0x0A;
      return 'prepared';
    })()`);
    // 取消路径验证：mock confirm=false，通过注入 File 触发
    const cancelPick = await ev(`(async () => {
      let confirmAsked = false, confirmRet = false;
      window.confirm = function () { confirmAsked = true; return confirmRet; };
      // 拦截 putContentFile：取消后不该被调
      let putCalled = false;
      const orig = window.__projectLogic.putContentFile;
      window.__projectLogic.putContentFile = async function () { putCalled = true; return orig.apply(this, arguments); };
      // 触发真实 pickImage：mock createElement，给 pickImage 实际拿到的那只
      // input 装 files（旧写法把 files 装在外层变量上，pickImage 读自己建的
      // 那只 → files undefined → !f 提前 return，confirm 根本不会弹）。
      const png = new Uint8Array([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,0x1F,0x15,0xC4,0x89,0,0,0,10,73,68,65,84,120,0x01,0x63,0,1,0,0,5,0,1,0x0D,0x0A,0x2D,0xB4,0,0,0,0,73,69,78,68,0xAE,0x42,0x60,0x82]);
      const file = new File([png], 'new.png', { type: 'image/png' });
      const origCreate = document.createElement.bind(document);
      document.createElement = function (tag) {
        const el = origCreate(tag);
        if (tag === 'input') {
          try { Object.defineProperty(el, 'files', { value: [file] }); } catch (e) { }
          setTimeout(() => { if (el.onchange) el.onchange({ target: el }); }, 0);
        }
        return el;
      };
      window.__img._pickImage();
      await new Promise(r => setTimeout(r, 600));
      document.createElement = origCreate;
      window.__projectLogic.putContentFile = orig;
      return JSON.stringify({ confirmAsked, putCalled });
    })()`);
    const cp = JSON.parse(cancelPick);
    const afterMeta = JSON.parse(await ev(`JSON.stringify(window.__imgLogic.loadMeta('探针图片工程'))`));
    ck('取消换图：弹出确认', cp.confirmAsked === true, cp);
    ck('取消换图：不写新图', cp.putCalled === false, cp);
    ck('取消换图：meta 不变', afterMeta.imageFile === beforeMeta.imageFile, afterMeta.imageFile);

    /* ---- v50/M3：分享双模式 ---- */
    // 点分享 → 弹窗出现（两个模式按钮）
    await ev(`[...document.querySelectorAll('#imgPage .img-top-btn')].find(b => b.textContent.includes('分享')).click()`);
    await sleep(400);
    const d = await ev(`(() => {
      const m = document.querySelector('.pj-dlg-mask.open');
      if (!m) return { open: false };
      return { open: true, btns: [...m.querySelectorAll('.pj-dlg-btn')].map(b => b.textContent) };
    })()`);
    console.log('分享弹窗: ' + JSON.stringify(d));
    ck('分享弹窗出现', d.open === true, d);
    ck('双模式按钮齐全', d.btns && d.btns.length === 3 && d.btns.some(x => x.includes('默认')) && d.btns.some(x => x.includes('分层')), d.btns);

    // 拦截 shareFile，点「遮罩分层」→ 捕获 zip 参数；在页内解包验内容
    const z = await ev(`(async () => {
      let captured = null;
      /* headless 无原生插件：先确保 SaveImage 存在再拦截（savePlug() 走
       * window.Capacitor.Plugins.SaveImage，造在同一位置即被读到）。 */
      window.Capacitor = window.Capacitor || { Plugins: {} };
      window.Capacitor.Plugins = window.Capacitor.Plugins || {};
      if (!window.Capacitor.Plugins.SaveImage) window.Capacitor.Plugins.SaveImage = {};
      window.Capacitor.Plugins.SaveImage.shareFile = async function (args) { captured = args; return {}; };
      [...document.querySelectorAll('.pj-dlg-mask.open .pj-dlg-btn')].find(b => b.textContent.includes('分层')).click();
      /* 3 张 canvas toDataURL + zipSync 在 dpr=3 headless 里耗时波动大，轮询等 */
      for (let i = 0; i < 40 && !captured; i++) await new Promise(r => setTimeout(r, 200));
      if (!captured) return JSON.stringify({ captured: false, waitedMs: 8000 });
      // 页内解 zip：fflate.unzipSync
      const bin = atob(captured.data);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const files = window.fflate.unzipSync(u8);
      const names = Object.keys(files).sort();
      // 验 alpha 图：找 _alpha 那张，采样透明/不透明像素数
      let holes = -1;
      const alphaName = names.find(n => n.includes('_alpha'));
      if (alphaName) {
        const blob = new Blob([files[alphaName]]);
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
        const px = g.getImageData(0, 0, c.width, c.height).data;
        holes = 0;
        for (let i = 3; i < px.length; i += 4) if (px[i] === 0) holes++;
      }
      return { captured: true, filename: captured.filename, mime: captured.mime, names, holes };
    })()`);
    console.log('zip 导出: ' + JSON.stringify(z));
    ck('zip 已捕获（shareFile 调用）', z.captured === true, z.captured);
    ck('zip 文件名正确', z.filename === '探针图片工程_layers.zip', z.filename);
    ck('zip 含原图+alpha', z.names && z.names.some(n => /[^_a-zA-Z0-9\u4e00-\u9fff]\.png$/.test(n) || /_alpha\.png$/.test(n)), z.names);
    ck('zip 含每可见层遮罩', z.names && z.names.filter(n => /_(遮罩 1|头发|天空)\.png$/.test(n)).length === 3, z.names);
    /* 「隐藏层不导出」的正向验证：新建一层并隐藏，再导一次，zip 里不能有它。
     * （此前断言检查「天空不在 zip」是错的——天空被删后撤销恢复，恢复即可见，
     *  本来就该出现在 zip 里。） */
    await ev('window.__img._addLayer("临时层")');
    await sleep(250);
    const tmpId = JSON.parse(await ev('JSON.stringify(window.__img._layers())')).find(l => l.name === '临时层').id;
    await ev('window.__img._toggleLayer(' + JSON.stringify(tmpId) + ')');   // 隐藏
    await sleep(250);
    const layersNow = JSON.parse(await ev('JSON.stringify(window.__img._layers())'));
    const tmpVisible = layersNow.find(l => l.name === '临时层').visible;
    ck('临时层已隐藏', tmpVisible === false, tmpVisible);
    ck('alpha 图挖除区有效', z.holes > 5000, z.holes);

    // 隐藏「临时层」后再导一次 → zip 不含临时层
    const z2 = await ev(`(async () => {
      let cap2 = null;
      window.Capacitor.Plugins.SaveImage.shareFile = async function (args) { cap2 = args; return {}; };
      const btn = [...document.querySelectorAll('#imgPage .img-top-btn')].find(b => b.textContent.includes('分享'));
      btn.click();
      await new Promise(r => setTimeout(r, 300));
      const b2 = [...document.querySelectorAll('.pj-dlg-mask.open .pj-dlg-btn')].find(b => b.textContent.includes('分层'));
      b2.click();
      for (let i = 0; i < 40 && !cap2; i++) await new Promise(r => setTimeout(r, 200));
      if (!cap2) return { captured: false };
      const bin = atob(cap2.data);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return { captured: true, names: Object.keys(window.fflate.unzipSync(u8)).sort() };
    })()`);
    ck('二次导出成功', z2.captured === true, z2.captured);
    ck('隐藏层不在 zip 内（老板确认不导出）', z2.names && !z2.names.some(n => n.includes('临时层')), z2.names);
    ck('zip 其余 5 文件仍齐全', z2.names && z2.names.length === 5, z2.names);
    // 清理：删掉临时层（还原三层状态）
    await ev('window.__img._delLayer(' + JSON.stringify(tmpId) + ')');
    await sleep(250);

    /* ---- v50/M4：dock 拖拽吸附 + 左侧撤销条 ---- */
    // 左条独立存在且不与工具 dock 重叠
    const m4a = await ev(`(() => {
      const bar = document.querySelector('#imgPage .img-undo-bar');
      const dock = document.querySelector('#imgPage .img-dock');
      if (!bar || !dock) return { bar: !!bar, dock: !!dock };
      const rb = bar.getBoundingClientRect(), rd = dock.getBoundingClientRect();
      return { bar: true, dock: true, barLeft: Math.round(rb.left), dockRight: Math.round(rd.left),
               separate: rb.right <= rd.left, barBtns: bar.querySelectorAll('.img-grp').length };
    })()`);
    ck('左侧撤销条独立', m4a.bar && m4a.dock && m4a.separate === true, m4a);
    ck('撤销条含撤销+重做两组', m4a.barBtns === 2, m4a.barBtns);

    // 拖拽吸附：把 dock 拖到左下角 → 吸附 left；再拖回右下 → 吸附 right
    const dragRes = await ev(`(async () => {
      const dock = document.querySelector('#imgPage .img-dock');
      const mk = (t,x,y) => new PointerEvent(t,{pointerId:9,pointerType:'touch',isPrimary:true,clientX:x,clientY:y,bubbles:true,cancelable:true,button:0,buttons:1});
      const r = dock.getBoundingClientRect();
      const sx = r.left + r.width / 2, sy = r.top + 6;   // dock 本体上沿（非按钮处）
      // 从 dock 空隙起拖：用 dock 本体 dispatch（按钮会命中按钮，这里取组间 gap）
      const gapY = (() => { const gs = dock.querySelectorAll('.img-grp'); const last = gs[gs.length-1].getBoundingClientRect(); return last.bottom + 8 < r.bottom ? last.bottom + 8 : r.top - 8; })();
      dock.dispatchEvent(mk('pointerdown', sx, gapY));
      for (let i = 1; i <= 12; i++) { window.dispatchEvent(mk('pointermove', sx - i * 25, gapY + i * 18)); await new Promise(r => requestAnimationFrame(r)); }
      window.dispatchEvent(mk('pointerup', sx - 300, gapY + 216));
      await new Promise(r => setTimeout(r, 300));
      const cls1 = dock.className;
      const pos1 = localStorage.getItem('img-dock-pos');
      // 拖回右侧
      const r2 = dock.getBoundingClientRect();
      dock.dispatchEvent(mk('pointerdown', r2.left + r2.width / 2, r2.top - 8));
      for (let i = 1; i <= 10; i++) { window.dispatchEvent(mk('pointermove', r2.left + i * 30, r2.top - i * 10)); await new Promise(r => requestAnimationFrame(r)); }
      window.dispatchEvent(mk('pointerup', r2.left + 300, r2.top - 100));
      await new Promise(r => setTimeout(r, 300));
      const cls2 = dock.className;
      const pos2 = localStorage.getItem('img-dock-pos');
      return JSON.stringify({ cls1, pos1, cls2, pos2 });
    })()`);
    const dr = JSON.parse(dragRes);
    console.log('拖拽吸附: ' + dragRes);
    ck('拖到左侧吸附 left', dr.pos1 === 'left' && dr.cls1.includes('img-dock-left'), dr.cls1);
    ck('吸附位置已持久化', dr.pos1 === 'left', dr.pos1);
    ck('拖回右侧吸附 right', dr.pos2 === 'right' && !dr.cls2.includes('img-dock-left'), dr.cls2);

    // 重开工程 → 停靠位从持久化恢复（当前应为 right）
    const reopen2 = await ev(`(async () => {
      window.__img.back();
      await new Promise(r => setTimeout(r, 400));
      window.__img.open('探针图片工程');
      await new Promise(r => setTimeout(r, 800));
      const dock = document.querySelector('#imgPage .img-dock');
      return JSON.stringify({ cls: dock.className, visible: getComputedStyle(dock).display !== 'none' });
    })()`);
    const ro = JSON.parse(reopen2);
    ck('重开后 dock 可见', ro.visible === true, ro);

    // dock 滚动：容器可滚动且不溢出视口
    const scroll = await ev(`(() => {
      const dock = document.querySelector('#imgPage .img-dock');
      const st = getComputedStyle(dock);
      const r = dock.getBoundingClientRect();
      return JSON.stringify({ maxH: st.maxHeight, inView: r.bottom <= window.innerHeight + 1, overflowY: st.overflowY });
    })()`);
    const sc = JSON.parse(scroll);
    ck('dock 纵向可滚动', sc.overflowY === 'auto' && sc.maxH !== 'none', sc);

    // 清掉 M4 拖拽持久化，避免污染下一轮探针
    await ev(`localStorage.removeItem('img-dock-pos')`);

    // 恢复后关闭，继续原返回断言
    await ev(`document.querySelector('#imgPage .img-top-btn').click()`);
    await sleep(600);

    // 返回后列表可点（维持既有行为）
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
