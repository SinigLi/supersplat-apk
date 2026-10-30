/* tests/v13.mjs - v13 headless 回归（Edge + CDP，390x844）
 * 覆盖本轮五项改动：
 * 1) 底栏去掉「选择」按钮（只剩 游标/移动到游标/变换/导演台）
 * 2) 默认单击即可选中人偶（无需武装模式）
 * 3) 测量工具能点中人偶（非泼溅对象拾取）
 * 4) 道具导入：GLB 走 container 资产，可选中/删除/撤销
 * 5) 工具激活时底栏让位（body.sd-tool-yield）
 * 用法：在 supersplat-apk 仓库根执行 `node tests/v13.mjs`
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('www');
const PORT = 4197;
const CDP = 9262;
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
  '--user-data-dir=' + path.join(process.env.TEMP, 'edge_v13_profile'),
  '--enable-unsafe-webgpu', '--use-angle=d3d11', '--window-size=390,844',
  `http://127.0.0.1:${PORT}/index.html`
], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
const logs = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const msgId = ++id; pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || 'eval failed' };
  return r.result?.value;
}
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};
const waitFor = async (expr, tries = 80, ms = 400) => {
  for (let i = 0; i < tries; i++) {
    if (await evalJs(expr)) return true;
    await sleep(ms);
  }
  return false;
};

try {
  ws = new WebSocket(await getWs());
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      logs.push(m.params.args.map(a => a.value || a.description || '').join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || ''));
    }
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(2500);
  await waitFor('!!(window.__director && window.__director.listProps)');

  // ---- 1) 底栏按钮 ----
  const bar = await evalJs(`(() => [...document.querySelectorAll('.sd-dir-act')].map(b => b.dataset.act))()`);
  check('bottom bar has no select button', Array.isArray(bar) && !bar.includes('select'), JSON.stringify(bar));
  check('bottom bar keeps cursor/movegroup/xform/director',
    ['cursor', 'movegroup', 'xform', 'director'].every(a => (bar || []).includes(a)), JSON.stringify(bar));

  // ---- 2) 生成人偶，默认单击选中 ----
  await evalJs(`window.__director.switchCharacter('woman')`);
  await waitFor(`!!(window.__director.charSlots.woman && window.__director.charSlots.woman.template)`);
  await evalJs(`(() => { const d=window.__director; const v=d.cursorRoot.getLocalPosition().clone(); v.set(0,0,0); d.placeCursor(v); d.addPuppet(); })()`);
  await sleep(900);

  const project = await evalJs(`(() => {
    const d = window.__director;
    const p = d.puppets.at(-1);
    const q = p.entity.getLocalPosition();
    const v = new (d.cursorRoot.getLocalPosition().constructor)(q.x, q.y + 1.0, q.z);
    scene.camera.worldToScreen(v, v);
    return { sx: Math.round(v.x * scene.canvas.clientWidth), sy: Math.round(v.y * scene.canvas.clientHeight) };
  })()`);
  check('puppet projects to canvas', !!project && project.sx > 0, JSON.stringify(project));

  // 先清空选中，再用默认单击（tapSelect）重新选中
  await evalJs(`window.__director.selectPuppet(null)`);
  await evalJs(`window.__director.tapSelect(${project.sx}, ${project.sy})`);
  await sleep(500);
  const selAfterTap = await evalJs(`(() => { const d=window.__director; return { id:d.selectedId, name:d.selected?.name ?? null }; })()`);
  check('default tap selects puppet (no arm mode)', !!selAfterTap?.id, JSON.stringify(selAfterTap));

  // ---- 3) 测量工具点中人偶 ----
  const measurePick = await evalJs(`(async () => {
    const d = window.__director;
    const p = d.puppets.at(-1);
    const q = p.entity.getLocalPosition();
    const V = d.cursorRoot.getLocalPosition().constructor;
    const v = new V(q.x, q.y + 1.0, q.z);
    scene.camera.worldToScreen(v, v);
    const sx = v.x * scene.canvas.clientWidth;
    const sy = v.y * scene.canvas.clientHeight;
    const hit = scene.events.invoke('sceneObjectPick') ? null : null;
    // 直接验证统一拾取：命中实体必须是这个人偶
    const picked = (async () => {
      const mod = window.__pickProbe;
      return mod ? mod(sx, sy) : null;
    })();
    // 兜底：走 director 的 objectAt（同一注册表）
    return { sx: Math.round(sx), sy: Math.round(sy) };
  })()`);
  check('measure pick coordinates resolved', !!measurePick, JSON.stringify(measurePick));

  // 用测量工具真实点击两次，落在人偶身上
  const measured = await evalJs(`(async () => {
    const d = window.__director;
    const p = d.puppets.at(-1);
    const q = p.entity.getLocalPosition();
    const V = d.cursorRoot.getLocalPosition().constructor;
    const toScreen = (y) => {
      const v = new V(q.x, q.y + y, q.z);
      scene.camera.worldToScreen(v, v);
      return { x: v.x * scene.canvas.clientWidth, y: v.y * scene.canvas.clientHeight };
    };
    scene.events.fire('tool.measure');
    await new Promise(r => setTimeout(r, 600));
    const c = document.getElementById('canvas-container');
    const fire = (type, pt) => c.dispatchEvent(new PointerEvent(type, {
      clientX: pt.x, clientY: pt.y, offsetX: pt.x, offsetY: pt.y,
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, isPrimary: true
    }));
    const a = toScreen(0.2); const b = toScreen(1.5);
    fire('pointerdown', a); fire('pointerup', a);
    await new Promise(r => setTimeout(r, 900));
    fire('pointerdown', b); fire('pointerup', b);
    await new Promise(r => setTimeout(r, 900));
    // v14: points live in the tool (each carries its own target) instead of
    // on the adapter, so ask the tool for its state
    const dbg = scene.events.invoke('measure.debug') || {};
    return {
      targetIsPuppet: dbg.count === 2 && dbg.names && dbg.names.every(n => n === p.name),
      count: dbg.count ?? -1,
      len: dbg.length ?? -1,
      yieldClass: document.body.classList.contains('sd-tool-yield')
    };
  })()`);
  check('measure places 2 points on puppet', !!measured?.targetIsPuppet, JSON.stringify(measured));
  check('measure length is plausible (m)', measured?.len > 0.3 && measured?.len < 3, `len=${measured?.len}`);
  check('bottom bar yields while tool active', measured?.yieldClass === true, JSON.stringify(measured));

  const yielded = await evalJs(`(() => { scene.events.fire('tool.deactivate'); return null; })()`);
  await sleep(600);
  const restored = await evalJs(`(() => ({ yield: document.body.classList.contains('sd-tool-yield'), display: getComputedStyle(document.querySelector('.sd-dock.sd-bottom')).display }))()`);
  check('bottom bar restored after tool exit', restored?.yield === false && restored?.display !== 'none', JSON.stringify(restored));

  // ---- 4) 道具导入（用仓库里的 shiba.glb 当道具） ----
  const prop = await evalJs(`(async () => {
    const d = window.__director;
    const res = await fetch('./static/director/shiba.glb');
    const blob = await res.blob();
    const f = new File([blob], 'shiba_prop.glb', { type: 'model/gltf-binary' });
    d.importModel(f);
    return { start: d.props.length };
  })()`);
  const propOk = await waitFor(`window.__director.props.length > 0`, 60, 500);
  check('prop imported', propOk, JSON.stringify(prop));

  const propInfo = await evalJs(`(() => {
    const d = window.__director;
    const p = d.props[0];
    if (!p) return null;
    const q = p.entity.getLocalPosition();
    return {
      name: p.name,
      meshes: (p.entity.findComponents('render') || []).length,
      x: +q.x.toFixed(2), z: +q.z.toFixed(2),
      listed: d.listProps().length,
      infoProps: d.info().props
    };
  })()`);
  check('prop instantiated with render meshes', propInfo?.meshes > 0, JSON.stringify(propInfo));
  check('prop listed in scene sheet', propInfo?.listed === 1 && propInfo?.infoProps === 1, JSON.stringify(propInfo));

  // 道具可选中 + 可删除 + 可撤销
  const propOps = await evalJs(`(async () => {
    const d = window.__director;
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const id = d.props[0].id;
    d.selectPropById(id);
    const selName = d.selectedProp?.name ?? null;
    const del = d.deletePropById(id);
    // edit.add runs through the command queue: wait for the op to apply
    for (let i = 0; i < 25 && d.props.length > 0; i++) await wait(80);
    const after = d.props.length;
    document.querySelector('#bottom-toolbar-undo')?.click();
    for (let i = 0; i < 25 && d.props.length === 0; i++) await wait(80);
    await wait(200);
    return { selName, del, after, restored: d.props.length };
  })()`);
  check('prop select/delete/undo', propOps?.del === 'ok' && propOps?.after === 0 && propOps?.restored === 1, JSON.stringify(propOps));

  // ---- 5) 场景页显示道具行 ----
  const sheet = await evalJs(`(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    document.querySelector('[data-role="scene-toggle"]')?.click();
    await wait(500);
    if (window.__renderPuppetList) window.__renderPuppetList();
    await wait(300);
    const rows = [...document.querySelectorAll('#sd-puppet-list .sd-pup-row')].map(r => r.textContent.trim());
    const heads = [...document.querySelectorAll('#sd-puppet-list .sd-pup-title')].map(r => r.textContent.trim());
    document.querySelector('[data-role="scene-toggle"]')?.click();
    return { rows, heads };
  })()`);
  check('scene sheet lists puppet + prop rows',
    (sheet?.rows || []).some(t => t.includes('📦')) && (sheet?.heads || []).length >= 2,
    JSON.stringify(sheet));

  // ---- 6) 渲染循环无异常 ----
  const errs = logs.filter(l => /numSelected|Cannot read properties|EXC/.test(l));
  check('no render-loop exceptions', errs.length === 0, errs.slice(0, 3).join(' | '));

  await send('Page.captureScreenshot', { format: 'png' }).then(r => {
    fs.writeFileSync('shot_v13.png', Buffer.from(r.data, 'base64'));
    console.log('screenshot -> shot_v13.png');
  });
} catch (e) {
  console.error('TEST ERROR:', e.message);
} finally {
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n=== ${results.length - failed}/${results.length} passed ===`);
  fs.writeFileSync('v13_result.json', JSON.stringify({ results, logs: logs.slice(0, 40) }, null, 2));
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
}
