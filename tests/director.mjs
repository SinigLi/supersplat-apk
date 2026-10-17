/* tests/director.mjs - 导演台 headless 回归（Edge + CDP，390x844）
 * 用法：在 supersplat-apk 仓库根执行 `node tests/director.mjs`（自动起静态服务 + Edge）
 * 覆盖 v12b 关键修复：
 * 1) woman.glb is the real female character (meshes/materials/textures/43 clips)
 * 2) moveSelectedToCursor moves the puppet to the cursor (undoable)
 * 3) director panel dropdowns fill on open without any prior state event
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('www');   // run from repo root
const PORT = 4193;
const CDP = 9252;
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
  '--user-data-dir=' + path.join(process.env.TEMP, 'edge_v12b_profile'),
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result?.value;
}
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
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
  for (let i = 0; i < 80; i++) {
    if (await evalJs('!!(window.__director && window.__editor)').catch(() => false)) break;
    await sleep(400);
  }
  check('window.__director ready', await evalJs('!!window.__director'));

  // ---- 1) woman asset identity ----
  const chars = await evalJs('window.__director.listCharacters()');
  check('4 characters listed', chars?.length === 4, JSON.stringify(chars?.map(c => c.name)));

  await evalJs(`window.__director.switchCharacter('woman')`);
  let wOk = false;
  for (let i = 0; i < 60; i++) {
    wOk = await evalJs(`!!(window.__director.charSlots.woman && window.__director.charSlots.woman.template)`);
    if (wOk) break;
    await sleep(400);
  }
  check('woman.glb loaded', wOk);

  const womanClips = await evalJs(`window.__director.charSlots.woman.clips.length`);
  check('woman 43 clips', womanClips === 43, `clips=${womanClips}`);

  // ---- 2) spawn then move-to-cursor ----
  await evalJs(`(() => { const d = window.__director; const v = d.cursorRoot.getLocalPosition().clone(); v.set(0.5, 0, -1); d.placeCursor(v); })()`);
  await evalJs('window.__director.addPuppet()');
  await sleep(700);
  const spawned = await evalJs(`(() => { const p = window.__director.puppets.at(-1); const q = p.entity.getLocalPosition(); return { charId: p.charId, x:+q.x.toFixed(2), z:+q.z.toFixed(2), n: window.__director.puppets.length }; })()`);
  check('puppet spawned as woman', spawned?.charId === 'woman', JSON.stringify(spawned));

  // identity of the spawned mesh: female materials + skinned instances
  const ident = await evalJs(`(() => {
    const p = window.__director.puppets.at(-1);
    const mats = new Set(); let skinned = 0;
    const walk = (e) => {
      const r = e.render;
      if (r) (r.meshInstances||[]).forEach(mi => {
        if (mi.material) mats.add(mi.material.name);
        if (mi.skinInstance) skinned++;
      });
      (e.children||[]).forEach(walk);
    };
    walk(p.entity);
    return { mats: [...mats], skinned };
  })()`);
  check('woman puppet uses female materials', (ident?.mats || []).includes('MI_Superhero_Female') && !(ident?.mats || []).includes('MI_Superhero_Male'), (ident?.mats || []).join(','));
  check('woman puppet is skinned (3 skinned meshes)', ident?.skinned === 3, `skinned=${ident?.skinned}`);

  const move = await evalJs(`(() => {
    const d = window.__director;
    const v = d.cursorRoot.getLocalPosition().clone(); v.set(2.5, 0, 1.5); d.placeCursor(v);
    const p = d.puppets.at(-1);
    d.selectPuppet(p);
    const before = p.entity.getLocalPosition().clone();
    const r = d.moveSelectedToCursor();
    const after = p.entity.getLocalPosition().clone();
    return { r, before: { x:+before.x.toFixed(2), z:+before.z.toFixed(2) }, after: { x:+after.x.toFixed(2), z:+after.z.toFixed(2) } };
  })()`);
  check('moveSelectedToCursor ok', move?.r === 'ok', JSON.stringify(move));
  check('puppet moved to cursor', Math.abs(move.after.x - 2.5) < 0.05 && Math.abs(move.after.z - 1.5) < 0.05, JSON.stringify(move.after));

  const clicked = await evalJs(`(() => {
    const btn = document.getElementById('bottom-toolbar-undo');
    if (!btn) return 'no-button';
    btn.click();
    return 'clicked';
  })()`);
  await sleep(700);
  const undo = await evalJs(`(() => {
    const p = window.__director.puppets.at(-1);
    const q = p.entity.getLocalPosition();
    return { x:+q.x.toFixed(2), z:+q.z.toFixed(2) };
  })()`);
  check('move is undoable', Math.abs(undo.x - 0.5) < 0.15 && Math.abs(undo.z + 1) < 0.15,
    JSON.stringify({ clicked, pos: undo }));

  // ---- 3) panel dropdowns fill with no prior state event ----
  const panel = await evalJs(`(() => {
    const p = document.querySelector('.sd-dir-panel');
    if (!p) return { err: 'no panel' };
    const chars = p.querySelector('.sd-dir-chars');
    const tints = p.querySelector('.sd-dir-tints');
    const clips = p.querySelector('.sd-dir-clips');
    return {
      charOpts: chars ? chars.options.length : -1,
      tintOpts: tints ? tints.options.length : -1,
      clipOpts: clips ? clips.options.length : -1,
      hasMoveBtn: !!document.querySelector('.sd-dir-act[data-act="movetocursor"]'),
      hasAddInBar: !!document.querySelector('.sd-dir-act[data-act="add"]'),
      panelAdd: !!p.querySelector('.sd-dir-btn[data-act="add"]')
    };
  })()`);
  check('character dropdown pre-filled', panel?.charOpts === 4, `opts=${panel?.charOpts}`);
  check('tint dropdown pre-filled', panel?.tintOpts === 8, `opts=${panel?.tintOpts}`);
  check('clip dropdown pre-filled', (panel?.clipOpts || 0) > 0, `opts=${panel?.clipOpts}`);
  check('bottom bar has 移动到游标 (not 摆放人偶)', panel?.hasMoveBtn === true && panel?.hasAddInBar === false,
    JSON.stringify({ move: panel?.hasMoveBtn, oldAdd: panel?.hasAddInBar }));
  check('panel has 摆放人偶 button', panel?.panelAdd === true);

  const errs = logs.filter(l => /numSelected|Cannot read properties|EXC/.test(l));
  check('no render-loop exceptions', errs.length === 0, errs.slice(0, 3).join(' | '));

  await send('Page.captureScreenshot', { format: 'png' }).then(r => {
    fs.writeFileSync('shot_v12b.png', Buffer.from(r.data, 'base64'));
    console.log('screenshot -> shot_v12b.png');
  }).catch(() => {});
} catch (e) {
  console.error('TEST ERROR:', e.message);
} finally {
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n=== ${results.length - failed}/${results.length} passed ===`);
  fs.writeFileSync('v12b_result.json', JSON.stringify({ results, logs: logs.slice(0, 40) }, null, 2));
  try { ws?.close(); } catch {}
  edge.kill(); srv.kill();
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
}
