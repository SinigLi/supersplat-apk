/* 决定性测试：正确模拟带时间间隔的双指捏合（让 midlen 逐帧更新）。
 * 对比游戏 vs 建模在「放大」和「缩小」两个方向的累计效果。 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const WWW = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www';
const PORT = 4303;
const CDP_PORT = 9293;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };
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
  const profile = 'F:/openclawhome/openclaw/fullstack_workspace/temp/probe-navmode-profile';
  fs.rmSync(profile, { recursive: true, force: true });
  const edge = spawn(EDGE, [
    '--headless=new', '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu', '--use-angle=d3d11',
    '--window-size=1200,900', 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  let targets = null;
  for (let i = 0; i < 60; i++) {
    await sleep(400);
    try { targets = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list')).json(); if (targets?.length) break; } catch (e) { }
  }
  const target = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

  let id = 0; const pending = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evalJs = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' });

  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try { if (await evalJs('!!(window.__director && window.__director.setNavMode)')) break; } catch (e) { }
  }
  console.log('ready');

  // 在页面里装一个「真实节奏」的双指捏合执行器，逐帧抖动，带 rAF 间隔
  const result = await evalJs(`(async () => {
    const d = window.__director;
    const cam = d.scene.camera;
    const c = document.getElementById('canvas-container');
    const r = c.getBoundingClientRect();
    const out = {};

    const mk = (type, pid, x, y) => {
      const e = new PointerEvent(type, {
        pointerId: pid, pointerType: 'touch', isPrimary: pid === 11,
        clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: 1
      });
      Object.defineProperty(e, 'offsetX', { value: x - r.left, configurable: true });
      Object.defineProperty(e, 'offsetY', { value: y - r.top, configurable: true });
      return e;
    };

    const frame = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));

    // 逐帧捏合：每帧两根手指各移动一点
    const pinch = async (s0, s1, frames) => {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      c.dispatchEvent(mk('pointerdown', 11, cx - s0 / 2, cy));
      c.dispatchEvent(mk('pointerdown', 12, cx + s0 / 2, cy));
      await frame();
      for (let i = 1; i <= frames; i++) {
        const s = s0 + (s1 - s0) * (i / frames);
        c.dispatchEvent(mk('pointermove', 11, cx - s / 2, cy));
        c.dispatchEvent(mk('pointermove', 12, cx + s / 2, cy));
        await frame();
      }
      c.dispatchEvent(mk('pointerup', 11, cx - s1 / 2, cy));
      c.dispatchEvent(mk('pointerup', 12, cx + s1 / 2, cy));
      // 等阻尼收敛
      for (let i = 0; i < 20; i++) await frame();
    };

    const run = async (mode, startDist, s0, s1) => {
      d.setNavMode(mode);
      cam.setDistance(startDist, 0);
      for (let i = 0; i < 10; i++) await frame();
      const before = cam.distance;
      await pinch(s0, s1, 16);
      const after = cam.distance;
      return { before: +before.toFixed(4), after: +after.toFixed(4), ratio: +(after / before).toFixed(3) };
    };

    // 放大（张开：100 -> 300）
    out.gameZoomIn = await run('game', 1.0, 100, 300);
    out.modelZoomIn = await run('model', 1.0, 100, 300);

    // 缩小（收拢：300 -> 100）
    out.gameZoomOut = await run('game', 1.0, 300, 100);
    out.modelZoomOut = await run('model', 1.0, 300, 100);

    // 近距离放大（用户抱怨的场景）
    out.gameNearIn = await run('game', 0.2, 100, 300);
    out.modelNearIn = await run('model', 0.2, 100, 300);

    // 连做 3 次放大，看游戏模式是否保持恒定倍率。
    // 从 4.0 起、每次约 0.2x，三次后约 0.032，仍在 gameZoomMin 0.02 之上；
    // 第四次会触底被 clamp，那个倍率不再代表公式行为，故只做三次。
    d.setNavMode('game');
    cam.setDistance(4.0, 0);
    for (let i = 0; i < 10; i++) await frame();
    const seq = [];
    for (let k = 0; k < 3; k++) {
      const b = cam.distance;
      await pinch(100, 300, 16);
      seq.push(+(cam.distance / b).toFixed(3));
    }
    out.gameRepeatRatios = seq;
    out.gameFloorClamped = cam.distance <= 0.0201;

    // 建模模式同样连做 4 次
    d.setNavMode('model');
    cam.setDistance(4.0, 0);
    for (let i = 0; i < 10; i++) await frame();
      const seq2 = [];
      for (let k = 0; k < 4; k++) {
        const b = cam.distance;
        await pinch(100, 300, 16);
        seq2.push(+(cam.distance / b).toFixed(3));
      }
      out.modelRepeatRatios = seq2;

    d.setNavMode('game');
    return JSON.stringify(out);
  })()`);

  const r = JSON.parse(result);
  console.log('\n=== 单次捏合对比（100->300 张开 = 放大/靠近）===');
  console.log('  远(d=1.0) 游戏: ' + JSON.stringify(r.gameZoomIn));
  console.log('  远(d=1.0) 建模: ' + JSON.stringify(r.modelZoomIn));
  console.log('  近(d=0.2) 游戏: ' + JSON.stringify(r.gameNearIn));
  console.log('  近(d=0.2) 建模: ' + JSON.stringify(r.modelNearIn));

  console.log('\n=== 收拢（300->100 = 缩小/拉远）===');
  console.log('  游戏: ' + JSON.stringify(r.gameZoomOut));
  console.log('  建模: ' + JSON.stringify(r.modelZoomOut));

  console.log('\n=== 连续 4 次捏合的倍率序列（关键：是否恒定）===');
  console.log('  游戏: ' + JSON.stringify(r.gameRepeatRatios));
  console.log('  建模: ' + JSON.stringify(r.modelRepeatRatios));

  let bad = 0;
  const ck = (n, ok, x) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!ok) bad++; };

  console.log('\n=== 判定 ===');
  ck('游戏模式捏合有反应', Math.abs(r.gameZoomIn.ratio - 1) > 0.05, r.gameZoomIn.ratio);
  ck('建模模式捏合有反应', Math.abs(r.modelZoomIn.ratio - 1) > 0.05, r.modelZoomIn.ratio);
  ck('远距离两模式不同', Math.abs(r.gameZoomIn.ratio - r.modelZoomIn.ratio) > 0.05,
    { game: r.gameZoomIn.ratio, model: r.modelZoomIn.ratio });
  ck('游戏模式倍率恒定', new Set(r.gameRepeatRatios).size === 1, r.gameRepeatRatios);
  ck('游戏模式未在序列中途触底', !r.gameRepeatRatios.some(x => x > 1), r.gameRepeatRatios);
  ck('建模模式倍率递减', r.modelRepeatRatios[0] > r.modelRepeatRatios[3],
    r.modelRepeatRatios);

  console.log(bad === 0 ? '\n=== 结论：两模式确实不同 ===' : '\n=== 仍有问题(' + bad + ') ===');

  try { ws.close(); } catch (e) { }
  try { edge.kill(); } catch (e) { }
  server.close();
  process.exit(0);
})().catch(e => { console.error('FATAL ' + e.message); try { server.close(); } catch (x) { } process.exit(1); });
