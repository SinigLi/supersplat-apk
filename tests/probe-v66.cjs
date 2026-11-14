/* v66 probe：三维能力闸门 + 无 3D 时 App 仍然可用
 *
 * 三种场景（都注入 requestAdapter 覆写，不动引擎）：
 *   A. WebGPU 正常（不覆写）   → 引擎加载，无 banner
 *   B. adapter 返回 null       → 引擎不加载，App 首页可用，banner 显示，3D 工程被拒
 *   C. navigator.gpu 不存在    → 同上，提示语不同
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
const WWW = WS + 'www/';
const PORT = 4301;
const CDP = 9396;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { pass++; console.log('PASS ' + n + (extra ? ' | ' + extra : '')); }
  else { fail++; console.log('FAIL ' + n + (extra ? ' | ' + extra : '')); }
};

/* ---------- 静态断言 ---------- */
const html = fs.readFileSync(WWW + 'index.html', 'utf8');
const gateSrc = fs.readFileSync(WWW + 'engine-gate.js', 'utf8');
const diagSrc = fs.readFileSync(WWW + 'boot-diag.js', 'utf8');
const pjSrc = fs.readFileSync(WWW + 'projects-ui.js', 'utf8');
const cssSrc = fs.readFileSync(WWW + 'projects.css', 'utf8');

check('index.html 引入 engine-gate.js', /engine-gate\.js\?v=/.test(html));
check('index.html 不再静态引入 index.js', !/<script[^>]*type="module"[^>]*src="\.\/index\.js/.test(html));
check('闸门先从 boot-diag 之后、业务脚本之前', html.indexOf('boot-diag.js') < html.indexOf('engine-gate.js') &&
  html.indexOf('engine-gate.js') < html.indexOf('projects.js'));
check('闸门用动态 import 加载引擎', /import\(ENGINE_SRC\)/.test(gateSrc));
check('闸门有超时乐观放行', gateSrc.includes('PROBE_TIMEOUT') && gateSrc.includes('乐观'));
check('闸门暴露 window.__engineGate', gateSrc.includes('window.__engineGate'));
check('闸门设置 window.__NO_3D', gateSrc.includes('window.__NO_3D'));
check('boot-diag 拦下 body.replaceChildren(#startup-error)', diagSrc.includes("first.id === 'startup-error'"));
check('boot-diag 监听 engine-failed', diagSrc.includes("'engine-failed'"));
check('projects-ui 有 no3d() 判定', pjSrc.includes('function no3d()'));
/* v68 变更意图：3D 工程在无 WebGPU 机器上从「禁止创建」改为「创建后进场景工作台」
 * （编辑器要 WebGPU，但建工程+摆放人偶/道具+存盘只需 WebGL2）。
 * 这一条改成断言新行为，别让旧断言挡住真需求。 */
check('v68 新建 3D 改为进场景工作台', pjSrc.includes('openSceneWorkbench(name)'));
check('v68 不再以无 WebGPU 拒绝建 3D', !pjSrc.includes("newMode === 'model' && no3d()"));
check('打开 3D 工程被拦', pjSrc.includes('projectModeOf(name)'));
check('首页有三维不可用徒标', pjSrc.includes('function syncGateBadge'));
check('卡片带 data-mode', pjSrc.includes("card.setAttribute('data-mode'"));
check('CSS 有 pj-card-off / pj-mode-off', cssSrc.includes('.pj-card.pj-card-off') && cssSrc.includes('.pj-mode.pj-mode-off'));

/* ---------- 动态行为 ---------- */
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(WWW, p === '/' ? '/index.html' : p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  const ext = path.extname(f);
  const type = ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css'
    : ext === '.json' ? 'application/json' : ext === '.html' ? 'text/html' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(f).pipe(res);
});

const PATCH_NULL = `(function(){
  var g = navigator.gpu;
  if (!g) return;
  try {
    Object.defineProperty(g, 'requestAdapter', {
      value: function(){ return Promise.resolve(null); }, configurable: true
    });
    window.__PATCHED = 'null-adapter';
  } catch(e) { window.__PATCH_ERR = String(e); }
})();`;

const PATCH_NOGPU = `(function(){
  try {
    Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
    window.__PATCHED = 'no-gpu';
  } catch(e) { window.__PATCH_ERR = String(e); }
})();`;

async function scenario(label, patch, expectEngine) {
  const e = spawn(EDGE, [
    '--remote-debugging-port=' + CDP, '--headless=new', '--no-first-run',
    '--no-default-browser-check', '--user-data-dir=' + process.env.TEMP + '/edge_v66_' + label,
    '--enable-unsafe-webgpu', '--use-angle=d3d11', '--window-size=900,700', 'about:blank'
  ], { stdio: 'ignore' });

  let ws = null, id = 0;
  const pend = new Map();
  const excs = [];
  try {
    let list;
    for (let i = 0; i < 60; i++) {
      try {
        list = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json();
        if (list.find((t) => t.type === 'page')) break;
      } catch (err) { }
      await new Promise((r) => setTimeout(r, 300));
    }
    const pg = (list || []).find((t) => t.type === 'page');
    ws = new WebSocket(pg.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') {
        excs.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text || '');
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
    if (patch) await send('Page.addScriptToEvaluateOnNewDocument', { source: patch });
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' });

    // 给闸门 + 引擎充足时间
    await new Promise((r) => setTimeout(r, expectEngine ? 16000 : 9000));

    const st = await q(`(function(){
      var g = window.__engineGate || null;
      var badge = document.querySelector('.pj-gate-badge');
      var pj = document.getElementById('pjPage');
      return JSON.stringify({
        gate: g ? { probed: g.probed, supported: g.supported, engineState: g.engineState,
                    reason: (g.reason||'').slice(0,60) } : null,
        patched: window.__PATCHED || null,
        no3d: !!window.__NO_3D,
        hasScene: !!window.scene,
        hasSse: !!(window.sse && window.sse.options),
        startupError: document.getElementById('startup-error') ? 1 : 0,
        bodyKids: document.body.children.length,
        pjPagePresent: !!pj,
        pjPageOpen: !!(pj && pj.classList.contains('open')),
        badgeVisible: !!(badge && badge.style.display !== 'none'),
        badgeText: badge ? badge.textContent.slice(0,80) : null,
        diagVisible: (function(){ var d=document.getElementById('diag-panel'); return !!(d && d.style.display !== 'none'); })()
      });
    })()`);

    let s = null;
    try { s = JSON.parse(st); } catch (err) { s = null; }
    console.log('\n### ' + label + ' ###');
    console.log(st);
    if (!s) { check(label + ' 状态可解析', false); return; }

    if (expectEngine) {
      check(label + ': 引擎已加载', s.gate && s.gate.engineState === 'loaded');
      check(label + ': 页面有 scene', s.hasScene === true);
      check(label + ': 无三维不可用徒标', s.badgeVisible === false);
      check(label + ': 无启动失败提示', s.startupError === 0);
    } else {
      check(label + ': 闸门判定不支持', s.gate && s.gate.probed === true && s.gate.supported === false);
      check(label + ': 引擎被跳过', s.gate && s.gate.engineState === 'skipped');
      check(label + ': 没有加载 scene', s.hasScene === false);
      check(label + ': 无 startup-error（未被抹掉）', s.startupError === 0);
      check(label + ': App 首页仍在', s.pjPagePresent === true);
      check(label + ': 首页可见', s.pjPageOpen === true);
      check(label + ': 三维不可用徒标已显示', s.badgeVisible === true, s.badgeText || '');
      check(label + ': 徒标文案提到图片视频音频', (s.badgeText || '').indexOf('图片') > -1);
      check(label + ': __NO_3D 已置位', s.no3d === true);
      check(label + ': body 未被清空', s.bodyKids > 3, 'kids=' + s.bodyKids);
    }

    /* v68：无 3D 场景的行为变了 —— 新建 3D 不再被拒，而是建好后导航到场景工作台。
     * 用 window.__NAV_HOOK 拦下真实跳转，才能在不丢页面的情况下断言路由目标，
     * 后面的图片/视频工作台断言也才跑得下去（之前 location.href 一跳就全丢）。 */
    if (!expectEngine) {
      await q(`window.__NAV_HOOK = function (u) { window.__NAV = u; };`);
      const n1 = await q(`(function(){
        window.__projects && window.__projects.create('闸门测试3D', 'model');
        return 'called';
      })()`);
      await new Promise((r) => setTimeout(r, 900));
      const after3d = await q(`(function(){
        var t = document.querySelector('.pj-toast');
        return JSON.stringify({ toast: t ? t.textContent.slice(0,90) : null,
                                cur: window.__projects ? window.__projects.current() : 'x',
                                nav: window.__NAV || null });
      })()`);
      let a3 = null; try { a3 = JSON.parse(after3d); } catch (err) { }
      check(label + ': 新建 3D 成功并进入工作台', a3 && a3.cur === '闸门测试3D', after3d);
      check(label + ': 路由到场景工作台（viewer.html）',
        a3 && typeof a3.nav === 'string' && a3.nav.indexOf('viewer.html') > -1
        && a3.nav.indexOf(encodeURIComponent('闸门测试3D')) > -1, a3 ? (a3.nav || '') : '');
      await q(`window.__NAV_HOOK = null; window.__NAV = null;`);

      const imgRun = await q(`(function(){
        if (!window.__img) return 'no-img-ui';
        return 'img-ui-present';
      })()`);
      check(label + ': 图片工作台模块已加载', imgRun === 'img-ui-present');
      const avRun = await q(`window.__av ? 'av-ui-present' : 'no-av-ui'`);
      check(label + ': 视频/音频工作台模块已加载', avRun === 'av-ui-present');
      const exRun = await q(`window.__extract ? 'extract-present' : 'no-extract'`);
      check(label + ': 解压中心已加载', exRun === 'extract-present');
      const cardRun = await q(`window.__cardgroups ? 'cardgroups-present' : 'no-cardgroups'`);
      check(label + ': 角色卡库已加载', cardRun === 'cardgroups-present');

      /* 真建一个图片工程并打开工作台：无 3D 不能影响图片链路 */
      await q(`window.__projects.create('无3D图片工程', 'image')`);
      await new Promise((r) => setTimeout(r, 1600));
      const imgState = await q(`(function(){
        var pg = document.getElementById('imgPage');
        return JSON.stringify({
          exists: !!pg,
          open: !!(pg && pg.classList.contains('open')),
          title: pg ? (pg.textContent||'').indexOf('无3D图片工程') > -1 : false
        });
      })()`);
      let is = null; try { is = JSON.parse(imgState); } catch (err) { }
      check(label + ': 图片工程可创建并打开工作台', is && is.exists === true && is.open === true, imgState);
      check(label + ': 图片工作台标题正确', is && is.title === true);

      /* 关掉图片工作台，再验视频工程 */
      await q(`(function(){ if (window.__img && window.__img.back) window.__img.back(); return 1; })()`);
      await new Promise((r) => setTimeout(r, 900));
      await q(`window.__projects.create('无3D视频工程', 'video')`);
      await new Promise((r) => setTimeout(r, 1600));
      const avState = await q(`(function(){
        var pg = document.getElementById('avPage');
        return JSON.stringify({ exists: !!pg, open: !!(pg && pg.classList.contains('open')) });
      })()`);
      let as2 = null; try { as2 = JSON.parse(avState); } catch (err) { }
      check(label + ': 视频工程可创建并打开工作台', as2 && as2.exists === true && as2.open === true, avState);
    }

    const severe = excs.filter((x) => /createBufferImpl|WebGPU adapter/.test(x));
    check(label + ': 无致命引擎异常', severe.length === 0, severe.slice(0, 2).join(' | ').slice(0, 140));

  } catch (err) {
    check(label + ' 执行异常', false, (err && err.message) || String(err));
  } finally {
    try { ws && ws.close(); } catch (e2) { }
    try { e.kill(); } catch (e2) { }
    await new Promise((r) => setTimeout(r, 800));
  }
}

(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  await scenario('A-webgpu-ok', null, true);
  await scenario('B-null-adapter', PATCH_NULL, false);
  await scenario('C-no-gpu', PATCH_NOGPU, false);
  try { server.close(); } catch (e) { }
  console.log('\nprobe-v66: ' + pass + '/' + (pass + fail) +
    (fail === 0 ? ' === ALL PASS ===' : ' === HAS FAILURES ==='));
  process.exit(fail === 0 ? 0 : 1);
})();
