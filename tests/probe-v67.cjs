/* v67 probe：3D 只读查看器（方案 B）
 *
 * 静态：viewer.html / viewer3d.js 接线、不加载编辑器引擎、只请求 WebGL2、
 *       角色表与导演台一致、spz 走 wasm 转 PLY、projects-ui 路由到查看器。
 * 动态（headless Edge，注入「没有 navigator.gpu」= M6 环境）：
 *   A. ?file= 载入泼溅            → 有 gsplat、画面非空（PNG 解码统计彩色像素）
 *   B. ?project= 泼溅+道具+人偶   → 三类都在、取景包住人偶
 *   C. ?project= .spz 工程        → spz 解码后能渲染
 *   D. ?project= 不支持的格式     → 明确报错，不白屏不说话
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const http = require('http');
const { spawn } = require('child_process');

const WS = 'F:/openclawhome/openclaw/fullstack_workspace/';
const APK = WS + 'projects/supersplat-apk/';
const WWW = APK + 'www/';
const SPLAT = WS + 'temp/test-splat-bin.ply';
const PORT = 4344;
const CDP = 9440;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { pass++; console.log('PASS ' + n + (extra ? ' | ' + extra : '')); }
  else { fail++; console.log('FAIL ' + n + (extra ? ' | ' + extra : '')); }
};

/* ---------------- 静态断言 ---------------- */

const viewerHtml = fs.readFileSync(WWW + 'viewer.html', 'utf8');
const v3 = fs.readFileSync(WWW + 'viewer3d.js', 'utf8');
const pj = fs.readFileSync(WWW + 'projects-ui.js', 'utf8');
const idxHtml = fs.readFileSync(WWW + 'index.html', 'utf8');

check('viewer.html 存在', viewerHtml.length > 500);
check('viewer.html 以模块方式加载 viewer3d.js', /type="module"[^>]*src="\.\/viewer3d\.js/.test(viewerHtml));
check('viewer.html 不加载编辑器引擎 index.js', !/src="\.\/index\.js/.test(viewerHtml));
check('viewer.html 不加载 engine-gate.js（查看器不依赖 WebGPU）', !viewerHtml.includes('engine-gate.js'));
check('viewer.html 带工程层 projects.js', viewerHtml.includes('projects.js'));
check('viewer3d 只请求 WebGL2（deviceTypes 为空）', v3.includes('deviceTypes: []'));
check('viewer3d 从本地 pc.min.mjs 引入 playcanvas', /from\s*'\.\/pc\.min\.mjs'/.test(v3));
check('pc.min.mjs 已随包', fs.existsSync(WWW + 'pc.min.mjs') && fs.statSync(WWW + 'pc.min.mjs').size > 2000000);
const pcm = fs.readFileSync(WWW + 'pc.min.mjs', 'utf8');
check('pc.min.mjs 无外部依赖（可直接部署）', !/from\s*["']/.test(pcm.slice(0, 4000)));
check('viewer3d 用 legacy gsplat 组件', v3.includes("addComponent('gsplat'"));
check('viewer3d 用 container 组件载入 GLB', v3.includes("'container'"));
check('viewer3d 设了 canvas fill mode（否则 300x150）', v3.includes('FILLMODE_FILL_WINDOW'));
check('viewer3d 支持 spz → PLY 转换', v3.includes('spzToPly') && v3.includes('cloudToPly'));
check('viewer3d 用官方 spz wasm 模块', v3.includes('spz-DEYRea_v-BKWZnoXF.js'));
check('viewer3d 角色表与导演台一致（5 个内置角色）',
  ['woman', 'man', 'shiba', 'tuxedo', 'box'].every((k) => v3.includes(k + ':')) &&
  v3.includes('static/director/'));
check('viewer3d 默认姿态与导演台一致', v3.includes("idle_loop") && v3.includes('idlenorm'));
check('viewer3d 取景遍历所有 meshInstance（不只泼溅）', v3.includes('computeSceneBox'));
check('viewer3d 有轨道/双指控制', v3.includes('pointerdown') && v3.includes('wheel'));
check('viewer3d 泼溅导入朝向 180°（与编辑器一致）', v3.includes('setLocalEulerAngles(0, 0, 180)'));
check('projects-ui 3D 工程路由到只读查看器', pj.includes('openReadonlyViewer') && pj.includes('./viewer.html?project='));
check('projects-ui 仍不再拦住 3D 工程', !/toast\(no3dReason\(\) \+ '；这个 3D 工程无法在本机打开'/.test(pj));
check('首页主干 index.html 未被改动（仍由 engine-gate 拦引擎）',
  idxHtml.includes('engine-gate.js') && !idxHtml.includes('viewer3d.js'));

/* ---------------- PNG 解码（用来客观判断画面有没有东西） ---------------- */

function decodePng(buf) {
  let p = 8; // 跳过签名
  let w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.slice(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) return null;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let o = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[o++];
    const line = raw.slice(o, o + stride); o += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = (prev && x >= bpp) ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, bpp, data: out };
}

/* 统计「非背景 + 彩色」像素：背景是 #101214 附近的纯色 */
function stats(png) {
  const img = decodePng(png);
  if (!img) return null;
  let nonBg = 0, colorful = 0, n = 0;
  for (let y = 0; y < img.h; y += 4) {
    for (let x = 0; x < img.w; x += 4) {
      const i = (y * img.w + x) * img.bpp;
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      n++;
      if (Math.abs(r - 0x10) + Math.abs(g - 0x11) + Math.abs(b - 0x13) > 24) nonBg++;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx - mn > 40 && mx > 60) colorful++;
    }
  }
  return { n, nonBg, colorful, w: img.w, h: img.h };
}

/* ---------------- 服务器 ---------------- */

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html',
  '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.ply': 'application/octet-stream', '.png': 'image/png', '.wasm': 'application/wasm' };

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/test-model.ply') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    fs.createReadStream(SPLAT).pipe(res); return;
  }
  const f = path.join(WWW, p === '/' ? 'index.html' : p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

const NO_GPU = `(function(){try{Object.defineProperty(navigator,'gpu',{value:undefined,configurable:true});}catch(e){}})();`;

(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const edge = spawn(EDGE, ['--remote-debugging-port=' + CDP, '--headless=new', '--no-first-run',
    '--no-default-browser-check', '--user-data-dir=' + process.env.TEMP + '/edge_probe_v67',
    '--window-size=880,660', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });

  let ws = null;
  try {
    let list;
    for (let i = 0; i < 60; i++) {
      try { list = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json();
        if (list.find((t) => t.type === 'page')) break; } catch (e) { }
      await new Promise((r) => setTimeout(r, 400));
    }
    const pg = (list || []).find((t) => t.type === 'page');
    ws = new WebSocket(pg.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let id = 0; const pend = new Map();
    const logs = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.consoleAPICalled') {
        logs.push((m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 200));
      }
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
    };
    const send = (method, params = {}) => new Promise((res) => {
      const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params }));
    });
    const q = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r && r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description };
      return r && r.result ? r.result.value : undefined;
    };

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: NO_GPU });

    const waitReady = async (ms) => {
      for (let i = 0; i < Math.ceil(ms / 700); i++) {
        await new Promise((r) => setTimeout(r, 700));
        const st = await q(`(function(){
          var e = document.getElementById('v3-error');
          var s = document.getElementById('v3-status');
          var c = document.querySelector('#v3-stage canvas');
          return JSON.stringify({
            err: e && !e.hidden ? e.textContent : null,
            status: s && !s.hidden ? s.textContent : null,
            canvas: c ? (c.width + 'x' + c.height) : null,
            frames: window.__v3 ? window.__v3.app.frame : 0,
            gsplats: window.__v3 ? (function(){
              var n = 0; window.__v3.app.root.forEach(function(e){ if (e.gsplat && e.gsplat.enabled) n++; }); return n; })() : 0,
            containers: window.__v3 ? (function(){
              var n = 0; window.__v3.app.root.forEach(function(e){ if (e.render) n++; }); return n; })() : 0,
            box: window.__v3 ? JSON.stringify((function(){
              var b = window.__v3.computeSceneBox(); return b ? { c: b.center.toArray(), h: b.halfExtents.toArray() } : null; })()) : null
          });
        })()`);
        let o = null;
        try { o = JSON.parse(st); } catch (e) { o = null; }
        if (o && (o.err || (o.canvas && o.status === null && o.frames > 5))) return o;
      }
      return null;
    };

    /* ---------- A: ?file= ---------- */
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/viewer.html?file=/test-model.ply' });
    const A = await waitReady(45000);
    const shotA = await send('Page.captureScreenshot', { format: 'png' });
    const pngA = shotA && shotA.data ? Buffer.from(shotA.data, 'base64') : null;
    const sA = pngA ? stats(pngA) : null;
    if (pngA) fs.writeFileSync(WS + 'temp/v67-probe-a.png', pngA);
    check('A file: 查看器启动无错误', A && !A.err, A && A.err ? A.err : '');
    check('A file: canvas 铺满窗口（不是 300x150）', A && A.canvas && !A.canvas.startsWith('300x150'), A && A.canvas);
    check('A file: 泼溅实体已建立', A && A.gsplats >= 1, A && ('gsplats=' + A.gsplats));
    check('A file: 引擎在跑（frame>5）', A && A.frames > 5, A && ('frames=' + A.frames));
    check('A file: 画面有彩色像素（泼溅真的画出来了）', sA && sA.colorful > 200, sA && JSON.stringify(sA));

    /* ---------- 造工程：泼溅 + 道具 + 人偶 ---------- */
    const seed1 = await q(`(async function(){
      try {
        var L = window.__projectLogic;
        var p = L.pathsFor('查看器工程');
        var state = { version: 1,
          model: { name: 'model.ply', path: 'files/m.ply' },
          puppets: [
            { name: '女人', charId: 'woman', pos: [0,0,0], rot: [0,0,0,1], scale: [1,1,1],
              tint: 'NONE', clip: 0, locked: false, visible: true },
            { name: '方块人', charId: 'box', pos: [1.6,0,0], rot: [0,0,0,1], scale: [0.4,0.4,0.4],
              tint: 'NONE', clip: 0, locked: false, visible: true }
          ],
          props: [ { name: '方块道具', file: 'files/p.glb', pos: [-1.6,0,0], rot: [0,0,0,1],
                     scale: [0.4,0.4,0.4], locked: false, visible: true } ],
          shots: [], camera: null, cursor: null };
        await L.store().write(p.state, new TextEncoder().encode(JSON.stringify(state)));
        var ply = await (await fetch('/test-model.ply')).arrayBuffer();
        await L.store().write(p.dir + '/files/m.ply', new Uint8Array(ply));
        var glb = await (await fetch('/static/director/box.glb')).arrayBuffer();
        await L.store().write(p.dir + '/files/p.glb', new Uint8Array(glb));
        return 'ok';
      } catch (e) { return 'ERR ' + (e && (e.stack || e.message) || e); }
    })()`);
    check('B 造工程（泼溅+道具+2人偶）', seed1 === 'ok', String(seed1).slice(0, 160));

    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/viewer.html?project=' + encodeURIComponent('查看器工程') });
    const B = await waitReady(60000);
    const shotB = await send('Page.captureScreenshot', { format: 'png' });
    const pngB = shotB && shotB.data ? Buffer.from(shotB.data, 'base64') : null;
    const sB = pngB ? stats(pngB) : null;
    if (pngB) fs.writeFileSync(WS + 'temp/v67-probe-b.png', pngB);
    check('B project: 无错误', B && !B.err, B && B.err ? B.err : '');
    check('B project: 泼溅已载入', B && B.gsplats >= 1, B && ('gsplats=' + B.gsplats));
    check('B project: 道具/人偶都实例化（>=3 个 render 实体）', B && B.containers >= 3, B && ('render=' + B.containers));
    check('B project: 场景包围盒覆盖到人偶（半高 > 0.8）',
      B && B.box && JSON.parse(B.box).h[1] > 0.8, B && B.box);
    check('B project: 画面有彩色像素', sB && sB.colorful > 200, sB && JSON.stringify(sB));
    check('B project: 画面有大量非背景像素（模型真的占屏）', sB && sB.nonBg > 500, sB && JSON.stringify(sB));

    /* ---------- C: .spz 工程 ---------- */
    const seed2 = await q(`(async function(){
      try {
        var L = window.__projectLogic;
        var mod = await import('./spz-DEYRea_v-BKWZnoXF.js');
        var spz = await mod.default();
        var N = 700;
        var P = new Float32Array(N*3), S = new Float32Array(N*3), R = new Float32Array(N*4),
            A = new Float32Array(N), C = new Float32Array(N*3);
        for (var i = 0; i < N; i++) {
          var t = (i/N)*Math.PI*2, pp = Math.acos(1-2*((i%149)/149));
          P[i*3] = Math.sin(pp)*Math.cos(t); P[i*3+1] = Math.cos(pp); P[i*3+2] = Math.sin(pp)*Math.sin(t);
          S[i*3] = S[i*3+1] = S[i*3+2] = -3.3; R[i*4+3] = 1; A[i] = 1;
          C[i*3] = 0.5+0.5*Math.cos(i*0.31); C[i*3+1] = 0.5+0.5*Math.sin(i*0.17); C[i*3+2] = 0.5+0.5*Math.cos(i*0.09+2.1);
        }
        var bytes = spz.saveSpzToBuffer({ numPoints: N, shDegree: 0, antialiased: false, extensions: [],
          positions: P, scales: S, rotations: R, alphas: A, colors: C, sh: new Float32Array(0) },
          { version: spz.LATEST_SPZ_HEADER_VERSION, from: spz.CoordinateSystem.UNSPECIFIED,
            sh1Bits: 5, shRestBits: 4 });
        var p = L.pathsFor('SPZ查看工程');
        await L.store().write(p.state, new TextEncoder().encode(JSON.stringify({
          version: 1, model: { name: 'model.spz', path: 'files/s.spz' },
          puppets: [], props: [], shots: [], camera: null, cursor: null })));
        await L.store().write(p.dir + '/files/s.spz', new Uint8Array(bytes));
        return 'ok ' + bytes.byteLength;
      } catch (e) { return 'ERR ' + (e && (e.stack || e.message) || e); }
    })()`);
    check('C 造 spz 工程', String(seed2).startsWith('ok'), String(seed2).slice(0, 160));

    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/viewer.html?project=' + encodeURIComponent('SPZ查看工程') });
    const C = await waitReady(60000);
    const shotC = await send('Page.captureScreenshot', { format: 'png' });
    const pngC = shotC && shotC.data ? Buffer.from(shotC.data, 'base64') : null;
    const sC = pngC ? stats(pngC) : null;
    if (pngC) fs.writeFileSync(WS + 'temp/v67-probe-c.png', pngC);
    check('C spz: 无错误', C && !C.err, C && C.err ? C.err : '');
    check('C spz: spz 转 PLY 后泼溅已建立', C && C.gsplats >= 1, C && ('gsplats=' + C.gsplats));
    check('C spz: 画面有彩色像素', sC && sC.colorful > 200, sC && JSON.stringify(sC));

    /* ---------- D: 不支持的格式要报错 ---------- */
    const seed3 = await q(`(async function(){
      try {
        var L = window.__projectLogic;
        var p = L.pathsFor('坏格式工程');
        await L.store().write(p.state, new TextEncoder().encode(JSON.stringify({
          version: 1, model: { name: 'model.ksplat', path: 'files/x.ksplat' },
          puppets: [], props: [], shots: [], camera: null, cursor: null })));
        await L.store().write(p.dir + '/files/x.ksplat', new Uint8Array([1,2,3,4,5,6,7,8]));
        return 'ok';
      } catch (e) { return 'ERR ' + (e && e.message || e); }
    })()`);
    check('D 造坏格式工程', seed3 === 'ok', String(seed3).slice(0, 120));

    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/viewer.html?project=' + encodeURIComponent('坏格式工程') });
    let D = null;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 600));
      const st = await q(`(function(){
        var e = document.getElementById('v3-error');
        return JSON.stringify({ err: e && !e.hidden ? e.textContent : null });
      })()`);
      try { D = JSON.parse(st); } catch (e) { D = null; }
      if (D && D.err) break;
    }
    check('D 不支持的格式给出明确提示', D && D.err && D.err.indexOf('不支持') > -1, D && D.err);

    /* ---------- E: 首页仍在（返回按钮的目标页能打开） ---------- */
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' });
    await new Promise((r) => setTimeout(r, 3000));
    const E = await q(`(function(){
      return JSON.stringify({
        no3d: !!window.__NO_3D,
        projectsOpen: !!(window.__projects),
        bodyKids: document.body.children.length,
        startupError: document.querySelectorAll('#startup-error').length
      });
    })()`);
    let Eo = null; try { Eo = JSON.parse(E); } catch (e) { }
    check('E 返回首页仍正常（无 3D 也不白屏）', Eo && Eo.no3d && Eo.bodyKids > 10 && Eo.startupError === 0, E);
  } catch (err) {
    console.log('ERROR ' + ((err && err.stack) || err));
    fail++;
  } finally {
    try { ws && ws.close(); } catch (a) { }
    try { edge.kill(); } catch (a) { }
    try { server.close(); } catch (a) { }
    console.log('\nprobe-v67: ' + pass + '/' + (pass + fail) + ' === ' + (fail ? 'FAILED' : 'ALL PASS') + ' ===');
    process.exit(fail ? 1 : 0);
  }
})();
