/* M5 探针升级：resolveTagMasks 逐字符检查 + zip 组包 + 回归
 * 之前 probe-v53-m4 31/31；这次加 M5 结构断言（静态）+ 动态单测（Node 可跑部分）。
 * 动态部分：buildExport 已在 export-chars 测过挂载；这里补「mask 路径进导出」验证。 */
'use strict';
global.localStorage = { _m: {}, getItem(k) { return this._m[k] || null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
global.window = global;
require('../www/av-store.js');
const L = global.__avLogic;

let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}

const fs = require('fs');
const img = fs.readFileSync('F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www/img-ui.js', 'utf8');
const av = fs.readFileSync('F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www/av-ui.js', 'utf8');

/* --- M5 静态结构 --- */
check('img-ui 导出 renderTagMaskCanvas', img.includes('renderTagMaskCanvas: renderTagMaskCanvas'));
check('img-ui 导出 canvasToPngU8', img.includes('canvasToPngU8: canvasToPngU8'));
check('renderTagMaskCanvas 不依赖 S（参数化 layers/w/h）', img.includes('function renderTagMaskCanvas(layers, w, h, layerName)'));
check('白区透底（#fff + drawStrokes）', img.includes("g.fillStyle = '#fff'; g.strokeStyle = '#fff';\n        drawStrokes(g, lay.strokes);"));
check('av-ui resolveTagMasks 存在', av.includes('async function resolveTagMasks()'));
check('pending: 前缀识别', av.includes(`String(c.mask).indexOf('pending:') === 0`));
check('zip 路径规则 masks/<seg>/<frame>_<cardId>.png', av.includes(`'masks/' + ref.seg + '/' + frame + '_' + cardId + '.png'`));
check('tagmask key 与 img-ui 同规则（ref.id）', av.includes(`'av-' + S.project + '-tagmask-' + ref.id`));
check('putContentFile 内容寻址备份', av.includes('putContentFile(pjMod.pathsFor(S.project),'));
check('exportJson 转 async', av.includes('async function exportJson()'));
check('有遮罩 → zip 分享 mime application/zip', av.includes(`mime: 'application/zip'`));
check('fflate zipSync level 0（PNG 已压缩）', av.includes(`window.fflate.zipSync(entries, { level: 0 })`));
check('marks.json 进 zip', av.includes(`'marks.json': window.fflate.strToU8(text)`));
check('无遮罩 → 裸 JSON 原链路保留', av.includes("mime: 'application/json'"));
check('zip 文件名 .zip 后缀', av.includes(`resolved.count > 0 ? '.zip' : '.json'`));

/* --- 动态：mask 路径写入导出 --- */
{
    const meta = { fps: 25, mode: 'video', folderName: 'clip' };
    const files = [{ name: '001.mp4', label: '001', seq: 1 }];
    const marks = { version: 1, marks: [
        { id: 'm2', type: 'multiframe_ref', seg: '001', frames: [40] },
        { id: 'cr9', type: 'char_ref', seg: '001', at: 1.6, chars: [
            { cardId: 'c-a1', name: '女主角', orig_char_desc: '', dest_char_desc: '', mask: 'masks/001/40_c-a1.png' }
        ] }
    ] };
    const out = L.buildExport(meta, marks, files);
    const pt = out.marks[0].points.find(p => p.type === 'multiframe' && p.at_frame === 40);
    check('已解析 mask 路径进导出（挂点级 chars）', !!pt && pt.chars[0].mask === 'masks/001/40_c-a1.png');
}

/* --- 回归：纯逻辑单测重跑等价（此文件里做轻量确认） --- */
const cc = fs.readFileSync('F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www/charcards.js', 'utf8');
check('charcards SCHEMA 不变', cc.includes("'moyutai.charcards.v1'"));

console.log('========================');
console.log('probe-v53-M5: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
