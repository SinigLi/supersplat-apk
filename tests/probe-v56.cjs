/* v56 探针：
 * ① 静态断言：renderTagMaskCanvas 改为黑底 + destination-out 抠洞
 * ② 极性基准：用老板给的 ComfyUI 正确样本 gpt_fixed.png 的口径做对照——
 *    黑底不透明 (alpha=255)，形状透明 (alpha=0)，无纯白形状像素
 * ③ 回归锚：v53x/v53y/v54/v55 系列语义未被破坏 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');
const seg = img.slice(img.indexOf('function renderTagMaskCanvas'), img.indexOf('function renderTagMaskCanvas') + 1400);

/* ① 新口径 */
check('黑底填充', seg.includes(`g.fillStyle = '#000';`) && seg.includes(`g.fillRect(0, 0, w, h);`));
check('离屏白形（笔画引擎不碰主画布 composite）', seg.includes('var off = document.createElement') && seg.includes('drawStrokes(og, lay.strokes)'));
check('单次 destination-out 抠洞（drawImage 而非逐笔）', new RegExp("globalCompositeOperation\\s*=\\s*'destination-out'[\\s\\S]{0,120}g\\.drawImage\\(off, 0, 0\\)").test(seg));
check('黑底填充在抠洞之前', seg.indexOf('fillRect') >= 0 && seg.indexOf('fillRect') < seg.indexOf("g.globalCompositeOperation = 'destination-out'"));
check('结束后恢复 source-over', new RegExp("g\\.globalCompositeOperation\\s*=\\s*'source-over'").test(seg.slice(seg.indexOf('drawImage(off'))));

/* ② ComfyUI 样本极性（老板 11-11 提供的 gpt_fixed.png = 正确口径） */
try {
    const { execSync } = require('child_process');
    const py = fs.readFileSync('F:/openclawhome/openclaw/fullstack_workspace/temp/v56-basis.py', 'utf8');
    fs.writeFileSync('F:/openclawhome/openclaw/fullstack_workspace/temp/v56-basis-run.py', py.replace('__FILE__', 'v56-gpt-fixed.png'));
    const out = execSync('E:/miniconda3/python.exe F:/openclawhome/openclaw/fullstack_workspace/temp/v56-basis-run.py', { encoding: 'utf8' });
    const j = JSON.parse(out.trim());
    check('样本口径：背景不透明黑(alpha=255占比>90%)', j.bgOpaqueRatio > 0.9);
    check('样本口径：形状透明(alpha=0像素>0)', j.transparentPx > 0);
    check('样本口径：可见区白色占比<0.05%（主体为黑）', j.whiteVisiblePx / j.total < 0.0005);
} catch (e) {
    check('ComfyUI 样本可达（跳过口径比对）', false);
}

/* ③ 回归锚 */
check('即画即存保留（v54）', img.includes(`if (S.tagMode) saveTagStrokes();`));
/* v55c 的「切层回写下拉」在 v60b 被主动去掉了：tag 模式改成层列表，
 * 激活态由 .img-layer-row.active 表达（lay.id === S.state.activeId），
 * 不再有 select 控件。所以这里改为断言当前的不变量——切换层必须重画层列表
 * 并让 activeId 单点生效，而不是钉一个已经不存在的字符串。 */
check('切层高亮由 activeId 驱动（v60b 起取代下拉）',
  img.includes(`'img-layer-row' + (lay.id === S.state.activeId ? ' active' : '')`));
check('骨架日志保留（v53y/z）', img.includes(`dlog('tag: redraw layers=`));
check('图片模式导出链不受影响（buildLayerCanvas 独立）', img.includes('function buildLayerCanvas'));

console.log('========================');
console.log('probe-v56: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
