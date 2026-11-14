/* v65 probe：启动诊断层 —— 静态检查 + 真实 DOM 行为（headless Edge + CDP）
 *
 * 关键行为：
 *  1) boot-diag.js 是 <body> 里第一个脚本（必须抢在引擎之前接管 console/onerror）
 *  2) 纯 ES5：没有 const/let/箭头函数/模板串（老 WebView 自己不能崩）
 *  3) 引擎兜底 div（#startup-error）出现时，面板自动弹出
 *  4) 「复制全部」产出的文本含 UA/WebGL2/structuredClone/日志段
 *  5) 面板挂在 <html> 上，不会被 body.replaceChildren() 抹掉
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
const WWW = WS + 'www/';
const PORT = 4298;
const CDP = 9388;
let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name); }
};

/* ---------- A. 静态检查 ---------- */

const html = fs.readFileSync(WWW + 'index.html', 'utf8');
const src = fs.readFileSync(WWW + 'boot-diag.js', 'utf8');

check('boot-diag.js 存在', fs.existsSync(WWW + 'boot-diag.js'));
check('index.html 加载 boot-diag.js', html.includes('boot-diag.js?v='));

// 必须排在所有其他脚本之前
const bodyIdx = html.indexOf('<body>');
const diagIdx = html.indexOf('boot-diag.js');
const firstOther = ['fflate.js', 'projects.js', 'av-ui.js', 'index.js']
  .map((f) => html.indexOf(f)).filter((i) => i > -1).sort((a, b) => a - b)[0];
check('boot-diag 在 body 内且是第一个脚本', bodyIdx > -1 && diagIdx > bodyIdx && diagIdx < firstOther);

// 纯 ES5：逐行剔除注释与字符串后再查关键字，避免误报
const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ')
  .replace(/'(?:\\.|[^'\\])*'/g, "''")
  .replace(/"(?:\\.|[^"\\])*"/g, '""');
check('无 const 声明', !/\bconst\s/.test(codeOnly));
check('无 let 声明', !/\blet\s/.test(codeOnly));
check('无箭头函数', !/=>/.test(codeOnly));
check('无模板字符串', !/`/.test(src));
check('无 class 语法', !/\bclass\s+\w/.test(codeOnly));
check('无可选链 ?.', !/\?\./.test(codeOnly));

// 关键能力都在
check('接管 console.error', /console\[name\]\s*=/.test(src) || /console\.error\s*=/.test(src));
check('监听 unhandledrejection', src.includes('unhandledrejection'));
check('监听 error 捕获资源失败', src.includes("addEventListener('error'"));
check('探测 WebGL2', src.includes("tryCanvas('webgl2')"));
check('探测 navigator.gpu requestAdapter', src.includes('requestAdapter'));
check('探测 structuredClone', src.includes('structuredClone'));
check('剪贴板有降级路径', src.includes('execCommand') && src.includes('navigator.clipboard'));
check('面板挂到 documentElement（不被 body.replaceChildren 抹掉）',
  src.includes('document.documentElement.appendChild(panel)'));
check('面板可关闭', src.includes("panel.style.display = 'none'"));
check('暴露 window.__diag 调试入口', src.includes('window.__diag'));
check('正常启动不显示 UI（只有失败/显式参数才 show）',
  !/rec\('\[diag\]','boot-diag 已就绪[\s\S]{0,80}show\(\)/.test(src));

/* ---------- B. 真实 DOM 行为 ---------- */

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(WWW, p);
  if (!f.startsWith(path.normalize(WWW)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); res.end('nf'); return;
  }
  const ext = path.extname(f);
  const type = ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css'
    : ext === '.html' ? 'text/html' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(f).pipe(res);
});

/* 只加载 boot-diag 的测试页：不引引擎，避免 WebGPU 干扰 */
const HARNESS = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<script src="/boot-diag.js"></script>
<script>
  window.__h = { ready: true };
  console.error('MARKER-ENGINE-BOOM', new Error('模拟引擎崩溃'));
  setTimeout(function(){
    // 复刻 index.js 的兜底：replaceChildren 掉 body
    var d = document.createElement('div');
    d.id = 'startup-error';
    d.textContent = 'SuperSplat 启动失败。详情请查看浏览器控制台。';
    document.body.replaceChildren(d);
  }, 60);
</script>
</body></html>`;

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

  const edge = spawn(EDGE, [
    '--remote-debugging-port=' + CDP, '--headless=new', '--no-first-run',
    '--no-default-browser-check', '--disable-gpu-sandbox',
    '--user-data-dir=' + process.env.TEMP + '/edge_v65diag', 'about:blank'
  ], { stdio: 'ignore' });

  let ws = null, id = 0;
  const pend = new Map();
  try {
    let list = null;
    for (let i = 0; i < 60; i++) {
      try {
        list = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json();
        if (list.find((t) => t.type === 'page')) break;
      } catch (e) { }
      await new Promise((r) => setTimeout(r, 300));
    }
    const pg = (list || []).find((t) => t.type === 'page');
    if (!pg) throw new Error('no page target');

    ws = new WebSocket(pg.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
    };
    const send = (method, params = {}) => new Promise((res) => {
      const mid = ++id; pend.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

    await send('Runtime.enable');
    await send('Page.enable');

    // 用 data URL 不便于相对路径，所以走自定义路由
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/harness.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(HARNESS);
        return;
      }
      const f = path.join(WWW, p === '/' ? '/index.html' : p);
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
      fs.createReadStream(f).pipe(res);
    });

    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/harness.html' });
    await new Promise((r) => setTimeout(r, 2500));

    const evalJson = async (expr) => {
      const r = await send('Runtime.evaluate', {
        expression: expr, returnByValue: true, awaitPromise: true
      });
      if (r && r.exceptionDetails) return { __err: JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text) };
      return r && r.result ? r.result.value : undefined;
    };

    const ready = await evalJson('!!(window.__h && window.__h.ready)');
    check('诊断层加载后业务脚本仍能执行', ready === true);

    const panelOnHtml = await evalJson(
      "!!(document.documentElement.querySelector('#diag-panel') && !document.body.querySelector('#diag-panel'))");
    check('面板挂在 <html> 上（body.replaceChildren 抹不掉）', panelOnHtml === true);

    const visible = await evalJson(
      "var p=document.documentElement.querySelector('#diag-panel'); !!p && p.style.display!=='none'");
    check('#startup-error 出现后面板自动弹出', visible === true);

    const hasJson = await evalJson('!!window.__diag && typeof window.__diag.text==="function"');
    check('window.__diag.text() 可用', hasJson === true);

    const txt = await evalJson('window.__diag ? window.__diag.text() : ""');
    check('诊断文本含 UA 段', typeof txt === 'string' && txt.indexOf('userAgent:') > -1);
    check('诊断文本含 WebGL2 体检', typeof txt === 'string' && txt.indexOf('WebGL2 可用:') > -1);
    check('诊断文本含 structuredClone 体检', typeof txt === 'string' && txt.indexOf('structuredClone:') > -1);
    check('诊断文本含 WebGPU 探测结果', typeof txt === 'string' && txt.indexOf('WebGPU requestAdapter:') > -1);
    check('诊断文本捕获到 console.error 内容', typeof txt === 'string' && txt.indexOf('MARKER-ENGINE-BOOM') > -1);
    check('诊断文本记录了引擎兜底文案', typeof txt === 'string' && txt.indexOf('SuperSplat 启动失败') > -1);
    check('诊断文本带日志条数', typeof txt === 'string' && /--- 日志 \(\d+ 条\) ---/.test(txt));

    // 「复制全部」按钮：无头环境无剪贴板权限，应走降级 textarea 而不是静默失败
    const copyFlow = await evalJson(`(function(){
      var btns = document.documentElement.querySelectorAll('#diag-panel button');
      var copyBtn = null;
      for (var i=0;i<btns.length;i++) if (btns[i].textContent.indexOf('复制') > -1) copyBtn = btns[i];
      if (!copyBtn) return 'no-button';
      copyBtn.click();
      return 'clicked';
    })()`);
    check('面板有「复制全部」按钮且可点击', copyFlow === 'clicked');

    await new Promise((r) => setTimeout(r, 800));
    const fallback = await evalJson(`(function(){
      var ta = document.documentElement.querySelector('#diag-panel textarea');
      if (!ta) return 'no-ta';
      return (ta.value.length > 200) ? 'filled:' + ta.value.length : 'empty:' + ta.value.length;
    })()`);
    check('复制被拒时降级 textarea 已填满内容', typeof fallback === 'string' && fallback.indexOf('filled:') === 0);

  } catch (e) {
    console.log('FAIL 浏览器测试异常: ' + ((e && e.message) || e));
    fail++;
  } finally {
    try { ws && ws.close(); } catch (e) { }
    try { edge.kill(); } catch (e) { }
    try { server.close(); } catch (e) { }
    console.log('\nprobe-v65: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === HAS FAILURES ==='));
    process.exit(fail === 0 ? 0 : 1);
  }
})();
