/* v68 probe：场景工作台（摆放 + 写回） + 10bit 素材探测/转码接线 + 返回页队列清理
 *
 * 静态：
 *   - ffmpeg-kit AAR 只带 arm64、体积可控、已进 build.gradle（abiFilters）
 *   - MediaTranscodePlugin 的 API 与 ffmpeg-kit 实际方法名对齐
 *   - protobuf 探测字段（probeMeta 回传 profile/bitDepth/decodable）
 *   - av-ui 有 codec 闸门 / 转码入口 / back() 清队列
 *   - projects-ui 不再以「无 WebGPU」拒绝建 3D
 *   - viewer3d 有摆放工具栏 + 快照写回 + worldToScreen 正确用法
 *
 * 动态（headless Edge，禁用 navigator.gpu = M6 环境）：
 *   A. 空场景：网格 + 无工具栏（只读）
 *   B. 打开工程：泼溅/道具/人偶都在，工具栏出现
 *   C. 点选人偶（不是道具）→ 拖动 → 保存 → 重开位置还在
 *   D. 添加道具 → 保存 → 文件进 files/ 且 rec.file 有值
 *   E. 删除 → 标记为脏
 *   F. 首帧画面真有内容（像素统计，不是黑屏）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const http = require('http');
const { spawn } = require('child_process');

const WS = 'F:/openclawhome/openclaw/fullstack_workspace/';
const REPO = WS + 'projects/supersplat-apk/';
const WWW = REPO + 'www/';
const SPLAT = WS + 'temp/test-splat-bin.ply';
const PORT = 4370, CDP = 9470;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { pass++; console.log('PASS ' + n + (extra ? ' | ' + extra : '')); }
  else { fail++; console.log('FAIL ' + n + (extra ? ' | ' + extra : '')); }
};

/* ---------- 静态 ---------- */
const pj = fs.readFileSync(WWW + 'projects-ui.js', 'utf8');
const av = fs.readFileSync(WWW + 'av-ui.js', 'utf8');
const v3 = fs.readFileSync(WWW + 'viewer3d.js', 'utf8');
const vh = fs.readFileSync(WWW + 'viewer.html', 'utf8');
const java = fs.readFileSync(REPO + 'android/app/src/main/java/com/sinigli/supersplat/MediaTranscodePlugin.java', 'utf8');
const msJava = fs.readFileSync(REPO + 'android/app/src/main/java/com/sinigli/supersplat/MediaServerPlugin.java', 'utf8');
const gradle = fs.readFileSync(REPO + 'android/app/build.gradle', 'utf8');

check('viewer.html 挂载摆放工具栏', vh.includes('id="v3-tools"') && vh.includes('id="v3-save"'));
check('viewer.html 载入 projects.js（工作台要读工程）', vh.includes('./projects.js'));
check('viewer3d 有摆放控制器', v3.includes('function attachEditor'));
check('viewer3d 按快照写回 project.json', v3.includes('buildSnapshot') && v3.includes('paths.state'));
check('viewer3d 更新注册表 hasModel', v3.includes('upsertProject'));
check('viewer3d 支持导入泼溅模型（空工程可用）', v3.includes('function importModel'));
check('viewer3d worldToScreen 用 CameraComponent 顺序', /comp\.worldToScreen\(w, new pc\.Vec3\(\)/.test(v3));
/* 注释里提到过这个坑，断言只看代码：先剥注释再查 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
check('viewer3d 不再误用 getPosition(w)', !/\.getPosition\(w\)/.test(stripComments(v3)));
check('viewer3d 地面网格排除在取景之外', v3.includes("entity.name === 'viewer-grid'"));

check('projects-ui 无 WebGPU 也允许建 3D', !pj.includes("newMode === 'model' && no3d()"));
check('projects-ui 创建后进场景工作台', pj.includes('openSceneWorkbench(name)'));
check('projects-ui 打开 3D 工程进工作台', /openSceneWorkbench\(name\);\s*\n\s*return;[\s\S]*?\}\s*\n\s*busy = true/.test(pj));
check('projects-ui 跳转可被探针拦截', pj.includes('window.__NAV_HOOK'));

check('probeMeta 回传 profile', msJava.includes('KEY_PROFILE') && msJava.includes('"profile"'));
check('probeMeta 回传 bitDepth', msJava.includes('"bitDepth"'));
check('probeMeta 回传 decodable', msJava.includes('"decodable"'));
check('FFmpegKit 用 SessionState 枚举（无 isCompleted 方法）', java.includes('SessionState.COMPLETED') && !java.includes('.isCompleted()'));
check('FFmpegKit 用 ReturnCode.isSuccess', java.includes('ReturnCode.isSuccess('));
check('转码输出到 8bit/ 子目录（不动原素材）', java.includes('OUT_DIR = "8bit"'));
check('转码用硬件编码 + yuv420p', /-c:v", "h264_mediacodec"/.test(java) && /-pix_fmt", "yuv420p"/.test(java));
check('写权限单独申请（pickWriteFolder 带 WRITE flag）',
  java.includes('pickWriteFolder') && java.includes('FLAG_GRANT_WRITE_URI_PERMISSION'));
check('MainActivity 注册转码插件',
  fs.readFileSync(REPO + 'android/app/src/main/java/com/sinigli/supersplat/MainActivity.java', 'utf8')
    .includes('MediaTranscodePlugin.class'));

check('gradle 只打 arm64-v8a', /abiFilters 'arm64-v8a'/.test(gradle));
const aarPath = REPO + 'android/app/libs/ffmpeg-kit-video-6.0.LTS.aar';
const { unzipSync } = require(REPO + 'node_modules/fflate');
const aar = unzipSync(fs.readFileSync(aarPath));
const abis = new Set(Object.keys(aar).filter((n) => /^jni\/[^/]+\/.+/.test(n)).map((n) => n.split('/')[1]));
check('AAR 只剩 arm64-v8a', abis.size === 1 && abis.has('arm64-v8a'), [...abis].join(','));
check('AAR 体积 < 15MB', fs.statSync(aarPath).size < 15 * 1024 * 1024,
  (fs.statSync(aarPath).size / 1048576).toFixed(1) + 'MB');

check('av-ui 有 codec 探测（probeCodec）', av.includes('function probeCodec'));
check('av-ui 不可解时给明白话', av.includes('function showCodecBlocked') && av.includes('10bit'));
check('av-ui 有转码入口按钮', av.includes("id = 'avTxBtn'"));
check('av-ui 批量转码队列', av.includes('function runTranscodeQueue'));
check('av-ui back() 清缩略图任务队列', /thumbJobs\.length = 0/.test(av) && /thumbPending\)\.forEach/.test(av));
check('index.html 的 av-ui / projects-ui 缓存号已升', fs.readFileSync(WWW + 'index.html', 'utf8')
  .includes('./av-ui.js?v=81'));

/* ---------- 动态 ---------- */
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html',
  '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.ply': 'application/octet-stream', '.png': 'image/png', '.spz': 'application/octet-stream' };

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

/* PNG 解码 + 像素统计（判定「真画出来了」而不是黑屏） */
function stats(png) {
  let w = 0, h = 0, colorType = 0, bitDepth = 8;
  const idat = [];
  let p = 8;
  while (p < png.length) {
    const len = png.readUInt32BE(p);
    const type = png.toString('ascii', p + 4, p + 8);
    const data = png.slice(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
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
  let n = 0, nonBg = 0, colorful = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * stride + x * bpp;
      const r = out[i], g = out[i + 1], b = out[i + 2];
      n++;
      if (r > 40 || g > 40 || b > 40) nonBg++;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 24) colorful++;
    }
  }
  return { n, nonBg, colorful, w, h };
}

const NO_GPU = `(function(){try{Object.defineProperty(navigator,'gpu',{value:undefined,configurable:true});}catch(e){}})();`;

(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const edge = spawn(EDGE, ['--remote-debugging-port=' + CDP, '--headless=new', '--no-first-run',
    '--no-default-browser-check', '--user-data-dir=' + process.env.TEMP + '/edge_v68probe',
    '--window-size=880,680', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });

  let ws = null;
  try {
    let list;
    for (let i = 0; i < 60; i++) {
      try {
        list = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json();
        if (list.find((t) => t.type === 'page')) break;
      } catch (e) { }
      await new Promise((r) => setTimeout(r, 400));
    }
    const pg = (list || []).find((t) => t.type === 'page');
    ws = new WebSocket(pg.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let id = 0; const pend = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
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

    await send('Runtime.enable'); await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: NO_GPU });

    const goto = async (url, waitMs) => {
      await send('Page.navigate', { url });
      const total = waitMs || 40000;
      for (let i = 0; i < Math.ceil(total / 700); i++) {
        await new Promise((r) => setTimeout(r, 700));
        const st = await q(`(function(){
          var e=document.getElementById('v3-error');
          var s=document.getElementById('v3-status');
          var c=document.querySelector('#v3-stage canvas');
          return JSON.stringify({
            err: e&&!e.hidden?e.textContent:null,
            status: s&&!s.hidden?s.textContent:null,
            canvas: c?(c.width+'x'+c.height):null,
            frames: window.__v3?window.__v3.app.frame:0,
            tools: document.getElementById('v3-tools')?!document.getElementById('v3-tools').hidden:false
          });
        })()`);
        let o = null; try { o = JSON.parse(st); } catch (e) { }
        if (o && (o.err || (o.canvas && o.status === null && o.frames > 4))) return o;
      }
      return null;
    };

    const shot = async (name) => {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      if (!s || !s.data) return null;
      const buf = Buffer.from(s.data, 'base64');
      fs.writeFileSync(WS + 'temp/v68-' + name + '.png', buf);
      return stats(buf);
    };

    /* A. 空场景 */
    const A = await goto('http://127.0.0.1:' + PORT + '/viewer.html', 40000);
    check('A 空场景无错误', A && !A.err, A && A.err || '');
    check('A canvas 撑满（非 300x150）', A && A.canvas && A.canvas !== '300x150', A && A.canvas);
    check('A 引擎在跑', A && A.frames > 4, A && ('frames=' + A.frames));
    check('A 无工程时不给摆放工具栏（只读兜底）', A && A.tools === false);

    /* 造工程：泼溅 + 道具 + 人偶 */
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/viewer.html' });
    await new Promise((r) => setTimeout(r, 2500));
    const seed = await q(`(async function(){
      try {
        var L = window.__projectLogic;
        var p = L.pathsFor('摆放工程');
        var state = { version:1, model:{ name:'model.ply', path:'files/m.ply' },
          puppets:[ { name:'女人', charId:'woman', pos:[0,0,0], rot:[0,0,0,1], scale:[1,1,1],
                      tint:'NONE', clip:0, locked:false, visible:true } ],
          props:[ { name:'方块', file:'files/p.glb', pos:[-1.5,0,0.3], rot:[0,0,0,1],
                    scale:[0.4,0.4,0.4], locked:false, visible:true } ],
          shots:[], camera:null, cursor:null };
        await L.store().write(p.state, new TextEncoder().encode(JSON.stringify(state)));
        var ply = await (await fetch('/test-model.ply')).arrayBuffer();
        await L.store().write(p.dir + '/files/m.ply', new Uint8Array(ply));
        var glb = await (await fetch('/static/director/box.glb')).arrayBuffer();
        await L.store().write(p.dir + '/files/p.glb', new Uint8Array(glb));
        L.saveRegistry(L.upsertProject(L.loadRegistry(), { name:'摆放工程', mode:'model',
          updatedAt:new Date().toISOString(), hasModel:true }));
        return 'ok';
      } catch(e) { return 'ERR ' + (e && (e.stack||e.message) || e); }
    })()`);
    check('B 造工程', seed === 'ok', String(seed).slice(0, 180));

    /* B. 打开工程 */
    const B = await goto('http://127.0.0.1:' + PORT + '/viewer.html?project=' + encodeURIComponent('摆放工程'), 60000);
    const bState = await q(`(function(){
      var v = window.__v3;
      if (!v) return JSON.stringify({none:true});
      return JSON.stringify({
        puppets: v.recs.puppets.length, props: v.recs.props.length,
        cands: v.editor.state.candidates.length,
        tools: !document.getElementById('v3-tools').hidden,
        grid: !!v.app.root.findByName('viewer-grid'),
        gsplats: (function(){ var n=0; var walk=function(e){ if(e.gsplat)n++; (e.children||[]).forEach(walk); }; walk(v.app.root); return n; })()
      });
    })()`);
    let bo = null; try { bo = JSON.parse(bState); } catch (e) { }
    check('B 打开无错误', B && !B.err, B && B.err || '');
    check('B 泼溅已载入', bo && bo.gsplats >= 1, bo && ('gsplats=' + bo.gsplats));
    check('B 人偶 + 道具都在候选', bo && bo.puppets === 1 && bo.props === 1, bState);
    check('B 摆放工具栏可见', bo && bo.tools === true);
    check('B 地面网格存在', bo && bo.grid === true);

    const bs = await shot('scene');
    check('B 画面真有内容（不是黑屏）', bs && bs.nonBg / bs.n > 0.15,
      bs && JSON.stringify({ nonBg: bs.nonBg, colorful: bs.colorful, n: bs.n }));

    /* C. 点选 + 拖动 + 保存 */
    const pick = await q(`(function(){
      var v = window.__v3, ed = v.editor;
      var canvas = document.querySelector('#v3-stage canvas');
      var r = canvas.getBoundingClientRect();
      var p = v.recs.puppets[0];
      var out = v.camera.camera.worldToScreen(p.ent.getPosition(), new (p.ent.getPosition().constructor)(), r.width, r.height);
      var x = r.left + out.x, y = r.top + out.y;
      function fire(type, id, cx, cy) {
        canvas.dispatchEvent(new PointerEvent(type, { pointerId:id, pointerType:'touch',
          clientX:cx, clientY:cy, bubbles:true, cancelable:true, buttons:1, isPrimary:true }));
      }
      fire('pointerdown', 11, x, y);
      var sel = ed.state.selected;
      fire('pointermove', 11, x + 90, y);
      fire('pointerup', 11, x + 90, y);
      return JSON.stringify({
        picked: !!sel, kind: sel ? sel.kind : null, name: sel ? sel.ent.name : null,
        pos: p.ent.getPosition().toArray().map(function(n){ return +n.toFixed(2); })
      });
    })()`);
    let po = null; try { po = JSON.parse(pick); } catch (e) { }
    check('C 点人偶选中人偶（不是旁边的道具）', po && po.picked && po.kind === 'puppet', pick);
    check('C 拖动改变了位置', po && Math.abs(po.pos[0]) > 0.1, po && JSON.stringify(po.pos));

    const saved = await q(`(async function(){
      try { await window.__v3.save(); return JSON.stringify({ dirty: window.__v3.dirtyRef() }); }
      catch(e) { return 'ERR ' + ((e && e.message) || e); }
    })()`);
    check('C 保存成功且清零脏标记', /"dirty":false/.test(String(saved)), String(saved).slice(0, 160));

    const C2 = await goto('http://127.0.0.1:' + PORT + '/viewer.html?project=' + encodeURIComponent('摆放工程'), 60000);
    const rePos = await q(`(function(){
      var v = window.__v3; if (!v) return 'no v3';
      var p = v.recs.puppets[0];
      return JSON.stringify({ pos: p.ent.getPosition().toArray().map(function(n){return +n.toFixed(2);}),
        count: v.recs.puppets.length });
    })()`);
    let ro = null; try { ro = JSON.parse(rePos); } catch (e) { }
    check('C 重开后位置真的写回了', ro && Math.abs(ro.pos[0]) > 0.1, rePos);
    check('C 重开后人偶数量不变', ro && ro.count === 1, rePos);

    /* D. 添加道具 → 保存 → 字节进 files/ */
    const addProp = await q(`(async function(){
      try {
        var v = window.__v3;
        var buf = await (await fetch('/static/director/shiba.glb')).arrayBuffer();
        var file = new File([buf], 'shiba_prop.glb', { type:'model/gltf-binary' });
        await v._addProp(file);
        await v.save();
        var last = v.recs.props[v.recs.props.length - 1];
        return JSON.stringify({ props: v.recs.props.length, file: last.rec.file,
          dirty: v.dirtyRef() });
      } catch(e) { return 'ERR ' + ((e && e.stack) || e); }
    })()`);
    let ao = null; try { ao = JSON.parse(addProp); } catch (e) { }
    check('D 新道具字节进 files/ 并拿到引用',
      ao && typeof ao.file === 'string' && ao.file.indexOf('files/') === 0, addProp.slice(0, 220));
    check('D 加完道具后保存清零脏标记', ao && ao.dirty === false, addProp.slice(0, 120));

    /* E. 删除 */
    const del = await q(`(function(){
      var v = window.__v3, ed = v.editor;
      var c = ed.state.candidates.filter(function(x){ return x.kind === 'prop'; })[0];
      if (!c) return 'no prop cand';
      ed.state.selected = c;
      var r = ed.deleteSelected();
      v.recs.props = v.recs.props.filter(function(x){ return x.rec !== r; });
      return JSON.stringify({ removed: !!r, left: v.recs.props.length, dirty: v.dirtyRef() });
    })()`);
    let de = null; try { de = JSON.parse(del); } catch (e) { }
    check('E 删除道具成功', de && de.removed, del);
    check('E 删除后标脏', de && de.dirty, del);

    const ds = await shot('edited');
    check('E 编辑后画面仍在（没被删空）', ds && ds.nonBg / ds.n > 0.1,
      ds && JSON.stringify({ nonBg: ds.nonBg, colorful: ds.colorful }));

    /* G. 首页路由（无 WebGPU 时建 3D 进工作台，不再拒绝） */
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' });
    await new Promise((r) => setTimeout(r, 3500));
    const gateState = await q(`(function(){
      return JSON.stringify({ no3d: !!window.__NO_3D,
        pjPresent: !!document.getElementById('pjPage'),
        startupError: document.querySelectorAll('#startup-error').length });
    })()`);
    let gs = null; try { gs = JSON.parse(gateState); } catch (e) { }
    check('G 无 WebGPU 首页仍可用（未白屏）', gs && gs.pjPresent && gs.startupError === 0, gateState);

    const nav = await q(`(async function(){
      try {
        window.__NAV_HOOK = function (u) { window.__NAV = u; };
        await window.__projects.create('v68工作台工程', 'model');
        var u = window.__NAV || '';
        window.__NAV_HOOK = null;
        return JSON.stringify({ nav: u, cur: window.__projects.current() });
      } catch(e) { return 'ERR ' + ((e && e.message) || e); }
    })()`);
    let no = null; try { no = JSON.parse(nav); } catch (e) { }
    check('G 新建 3D 成功并路由到工作台', no && no.nav && no.nav.indexOf('viewer.html') > -1, nav.slice(0, 200));

    const codec = await q(`(function(){
      if (!window.__av || !window.__av._codecState) return 'no __av codec';
      var s = window.__av._codecState();
      return JSON.stringify({ has: !!s, blocked: s.blocked, cache: s.cache.length });
    })()`);
    check('G av 工作台暴露 codec 状态（测得到、可断言）', /"has":true/.test(String(codec)), String(codec));
  } catch (err) {
    console.log('ERROR ' + ((err && err.stack) || err));
    fail++;
  } finally {
    try { ws && ws.close(); } catch (e) { }
    try { edge.kill(); } catch (e) { }
    try { server.close(); } catch (e) { }
    console.log('\nprobe-v68: ' + pass + '/' + (pass + fail) + ' === ' + (fail ? 'FAILED' : 'ALL PASS') + ' ===');
    process.exit(fail ? 1 : 0);
  }
})();
