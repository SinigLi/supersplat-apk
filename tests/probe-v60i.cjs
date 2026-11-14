/* probe-v60i：只建遮罩层不画笔 → 导出 JSON 仍带 name + 两个描述（无 mask）
 * 覆盖：层名命中角色卡 / 层名不匹配角色卡（改名兜底）
 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n); } };

const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');
const store = fs.readFileSync(WS + 'www/av-store.js', 'utf8');

check('tagEntries 逐层生成（不再 filter(Boolean) 丢卡片）', img.includes('(S.state.layers || []).forEach(function (l)') && !img.includes('}).filter(Boolean);\n    }\n\n    function finishTag'));
check('层名不匹配角色卡时用层名兜底', img.includes('layerOnly: true') && img.includes('cardId: l.id'));
check('无笔画 mask 为 null（不写 mask 字段）', img.includes("mask: hasStrokes ? ('pending:' + card.id) : null"));
check('buildExport 无 mask 条目不写 mask 字段', store.includes('if (c.mask) e.mask = c.mask;'));
  /* v69：导出字段改名 global_desc / prompt_extend */
  check('buildExport 保留 name/desc（不因无 mask 跳过）', store.includes("var e = { name: c.name, global_desc: cGlobalDesc(c), prompt_extend: cPromptExtend(c) };"));

/* 行为验证（Node stub） */
global.localStorage = { _m: {}, getItem(k) { return this._m[k] !== undefined ? this._m[k] : null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
global.window = global;
delete require.cache[require.resolve(WS + 'www/av-store.js')];
require(WS + 'www/av-store.js');
const L = global.__avLogic;
const meta = { fps: 25, mode: 'video', folderName: 'clip' };
const files = [{ name: '001.mp4', label: '001', seq: 1 }];

function exp(seg, at, chars, extraMarks) {
  const marks = { version: 1, marks: (extraMarks || []).slice() };
  L.upsertCharRef(marks, seg, at, chars);
  return L.buildExport(meta, marks, files);
}

/* 1) 首帧无遮罩 */
{
  const out = exp('001', 0, [{ cardId: 'c1', name: 'GPT', global_desc: 'A', prompt_extend: 'B', mask: null }]);
  const n = out.marks[0];
  check('首帧无遮罩：target.chars 有 name', !!(n.chars && n.chars[0].name === 'GPT'));
  check('首帧无遮罩：两个描述都在', !!(n.chars[0].global_desc === 'A' && n.chars[0].prompt_extend === 'B'));
  check('首帧无遮罩：无 mask 字段', !('mask' in n.chars[0]));
}
/* 2) multiframe 帧位无遮罩 */
{
  const out = exp('001', 10 / 25, [{ cardId: 'c1', name: 'GPT', global_desc: 'A', prompt_extend: 'B' }],
    [{ id: 'p', type: 'multiframe_ref', seg: '001', frames: [10, 40] }]);
  const pt = out.marks[0].points.filter(p => p.at_frame === 10)[0];
  check('多帧点无遮罩：point.chars 有 name+desc', !!(pt && pt.chars && pt.chars[0].name === 'GPT' && pt.chars[0].global_desc === 'A'));
  check('多帧点无遮罩：无 mask', !!(pt && pt.chars && !('mask' in pt.chars[0])));
}
/* 3) 有遮罩对照 */
{
  const out = exp('001', 0, [{ cardId: 'c1', name: 'GPT', global_desc: 'A', prompt_extend: 'B', mask: 'pending:c1' }]);
  check('有遮罩：mask 输出', out.marks[0].chars[0].mask === 'pending:c1');
}
/* 4) 旧工程无 char_ref 输出不变 */
{
  const base = { version: 1, marks: [{ id: 'm1', type: 'split', seg: '001', at: 3 }] };
  const out = L.buildExport(meta, base, files);
  check('无打标工程：JSON 无 chars', JSON.stringify(out).indexOf('"chars"') < 0);
}

console.log('probe-v60i: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
process.exit(fail ? 1 : 0);
