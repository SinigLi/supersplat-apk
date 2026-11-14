/* M4 probe：打标运行模式结构断言 + 单测兜底
 * 覆盖：
 * 1. img-ui: openTagMode 存在且导出；saveAll tagMode 分流（img-* 隔离红线）
 * 2. tagmask key 规则（av-<proj>-tagmask-<markId|seg_frame>）+ imgmask.v2 结构
 * 3. 顶部确认/取消 + back 守卫 + 底部打标组（角色勾选/双描述/启用取消）
 * 4. av-ui: captureTagFrame 原分辨率抽帧 + async 接线 + openTagMode ctx 传 frameCanvas
 * 5. onDone → upsertCharRef；既有 chars 回填（重开续编）
 * 6. 隔离：tagMode 分支不调 L.saveStrokes/L.saveMeta
 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}

const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');
const av = fs.readFileSync(WS + 'www/av-ui.js', 'utf8');

/* 1 导出与分流 */
check('img-ui 导出 openTagMode', img.includes('openTagMode: openTagMode'));
check('saveAll tagMode 分流', img.includes('if (S.tagMode) { saveTagStrokes(); S.dirty = false; return; }'));
const saveAllIdx = img.indexOf('function saveAll(');
const branchIdx = img.indexOf('if (S.tagMode) { saveTagStrokes()');
check('分流在 saveAll 首行（隔离红线）', branchIdx > saveAllIdx && branchIdx < saveAllIdx + 400);
check('分流后仍走 L.saveStrokes（普通图片模式不受影响）', img.includes('L.saveStrokes(S.project, S.state.layers, S.state.activeId)'));

/* 2 tagmask */
check('tagmask key 前缀', img.includes(`'av-' + tm.project + '-tagmask-'`));
check('existing 用 markId', img.includes(`(tm.existing ? tm.existing.id : tm.seg + '_' + tm.frame)`));
check('tagmask 结构 imgmask.v2', img.includes(`JSON.stringify({ schema: 'moyutai.imgmask.v2', layers: S.state.layers, activeId: S.state.activeId })`));
check('loadTagStrokes 校验 v2', img.includes(`o.schema === 'moyutai.imgmask.v2' && Array.isArray(o.layers)`));

/* 3 UI */
check('顶部确认打标按钮', img.includes(`'✅ 确认打标'`) && img.includes('finishTag(true)'));
check('顶部取消按钮 + 脏确认', img.includes(`'✖ 取消'`) && img.includes('有未确认的笔画改动'));
check('back() tagMode 守卫', img.includes("if (S.tagMode) { toast('打标模式请用顶部 ✅确认 / ✖取消'); return; }"));
    /* v60b 起打标条改成层列表，不再有 select 下拉；v69 同步到当前不变量 */
    check('底部打标组：层列表（v60b 起取代下拉）', img.includes('img-grp-tag') && img.includes('img-layer-row'));
    /* v69：默认组改名为 全局描述 / 提示词扩写（老板 2026-11-15） */
    check('描述面板下拉读词库分组（v59）', img.includes('window.CC.GROUP_GLOBAL') && img.includes('window.CC.GROUP_PROMPT'));
check('描述绑定活动角色', img.includes('function setCurDesc(') && img.includes('S.tagMode[kind][c.id] = val'));
check('层=角色 switchTagLayer', img.includes('function switchTagLayer(') && img.includes(`layers.push({ id:`));
check('finishTag 清运行态 + 关页', img.includes('function finishTag(') && img.includes('S.tagMode = null'));
check('tagEntries mask pending 标记', img.includes(`'pending:' + card.id`));

/* 4 av-ui 抽帧与接线 */
check('captureTagFrame 原分辨率', av.includes('c.width = v.videoWidth || 640'));
check('seek 到目标帧（secAtFrame）', av.includes('var tSec = L.secAtFrame(frame, fps || effFps())'));
check('抽帧失败 toast 不开打标页', av.includes(`'抽帧失败：' + (e && e.message || e)`));
check('openTagMode ctx 带 frameCanvas', av.includes('frameCanvas: frameCanvas'));
check('抽帧先行 toast', av.includes(`'正在抽帧…'`));

/* 5 回写与续编 */
check('onDone → upsertCharRef', av.includes('L.upsertCharRef(S.marks, tgt.seg, tgt.at, entries)'));
check('onDone 后 refresh 展示', av.includes('renderTicks(); renderList(); renderPos()'));
check('existing.chars 回填 enabled', img.includes(`(ctx.existing && ctx.existing.chars || []).map(function (c) { return c.cardId; })`));
    /* v69：回填读新字段 global_desc / prompt_extend，老字段兜底 */
    check('existing 描述回填 orig/dest', img.includes('typeof c.global_desc') && img.includes('typeof c.prompt_extend'));
check('重开读 tagmask 草稿', img.includes('var draft = loadTagStrokes()'));

/* 6 隔离红线：tagMode 下不得触碰 img-meta / img-strokes */
{
    const saveAllBody = img.slice(img.indexOf('function saveAll('), img.indexOf('function saveAll(') + 1200);
    check('tagMode 分支先 return（不落 saveStrokes）', saveAllBody.indexOf('if (S.tagMode)') < saveAllBody.indexOf('L.saveStrokes'));
    check('tagMode 不写 saveMeta（分流 return 在 saveMeta 前）', saveAllBody.indexOf('return;') < saveAllBody.indexOf('saveMeta'));
}

/* 7 视频帧语义 */
check('打标页标题带帧号（0-based 显示 +1）', img.includes(`' · 角色打标 · 第 ' + (ctx.frame + 1) + ' 帧'`));
check('音频模式拒绝在 resolveTagTarget', av.includes(`'音频模式无帧概念，不支持角色打标'`));

console.log('========================');
console.log('probe-v53-M4: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
