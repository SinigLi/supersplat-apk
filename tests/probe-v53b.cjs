/* v53b probe：老板真机反馈五条的回归断言
 * 1 视频页顶部 🎭 角色卡按钮（posEl 内 char-chip）
 * 2 打标页顶部=视频专用按钮（确认/取消），图片模式按钮隐藏（back/save/share/reload/undo）
 * 3 图片模式兼容（tagMode 分支守卫：saveAll 先 return，普通模式照旧 saveStrokes/saveMeta；
 *   finishTag 恢复按钮；back() 守卫只在 tagMode）
 * 4 帧图铺底（baseCv/maskCv 尺寸同步 + bctx.drawImage(frameCanvas)）
 * 5 DebugLog：img-ui dlog 走 Capacitor DebugLog + 关键路径日志（tag: target/capture）
 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}

const av = fs.readFileSync(WS + 'www/av-ui.js', 'utf8');
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');

/* 1 顶部入口 */
check('角色卡 chip 在 posEl 内', av.includes('function mkCharChip()') && av.includes('posEl.appendChild(mkCharChip());'));
check('chip 点击 → openCharDialog', av.includes('e.stopPropagation();') && av.includes('openCharDialog();'));
check('chip 紫色样式', av.includes(`'.av-char-chip { background: rgba(120, 80, 200, 0.5)`));

/* 2 打标页顶栏切换 */
check('进入打标隐藏返回键', img.includes(`if (backBtnEl) backBtnEl.style.display = 'none';`));
check('隐藏保存/分享/换图', img.includes(`if (saveBtnEl) saveBtnEl.style.display = 'none';`) && img.includes(`if (shareBtnEl) shareBtnEl.style.display = 'none';`) && img.includes(`if (reloadBtnEl) reloadBtnEl.style.display = 'none';`));
    /* 断言的是「进打标模式时撤销条被清掉」这个行为，不是某一行字面写法 */
    check('隐藏撤销条', /undoBarEl[\s\S]{0,40}display\s*=\s*'none'/.test(img));
check('显示确认/取消', img.includes(`if (btnTagConfirm) btnTagConfirm.style.display = '';`) && img.includes(`if (btnTagCancel) btnTagCancel.style.display = '';`));
check('finishTag 恢复图片模式按钮', img.includes(`if (backBtnEl) backBtnEl.style.display = '';`) && img.includes(`if (saveBtnEl) saveBtnEl.style.display = '';`));

/* 3 兼容 */
const saveAllBody = img.slice(img.indexOf('function saveAll('), img.indexOf('function saveAll(') + 500);
check('图片模式 saveStrokes 链路保留', saveAllBody.includes('L.saveStrokes(S.project, S.state.layers, S.state.activeId)'));
check('tagMode 分流在先（隔离）', saveAllBody.indexOf('if (S.tagMode)') >= 0 && saveAllBody.indexOf('if (S.tagMode)') < saveAllBody.indexOf('L.saveStrokes'));
check('back() 守卫仅 tagMode', img.includes("if (S.tagMode) { toast('打标模式请用顶部 ✅确认 / ✖取消'); return; }"));

/* 4 帧图铺底（反馈 4 根因） */
check('baseCv 尺寸同步', img.includes('baseCv.width = S.imgW; baseCv.height = S.imgH;'));
check('maskCv 尺寸同步', img.includes('maskCv.width = S.imgW; maskCv.height = S.imgH;'));
check('bctx.drawImage(frameCanvas)', img.includes('bctx.drawImage(ctx.frameCanvas, 0, 0);'));
check('帧图铺底在 showEmpty 前', img.indexOf('bctx.drawImage(ctx.frameCanvas') < img.indexOf("showEmpty(false);\n            /* v53b：顶栏切到打标模式"));

/* 5 DebugLog */
check('img dlog → Capacitor DebugLog', img.includes('cap.Plugins.DebugLog') && img.includes("[img] '"));
check('tag 目标解析日志', av.includes(`dlog('tag: target seg='`));
check('抽帧结果日志', av.includes(`dlog('tag: capture fail '`));
check('帧 canvas 尺寸日志', img.includes(`dlog('tagmode frameCanvas `));

/* 回归红线：既有断言抽查 */
check('确认按钮仍存在', img.includes(`'✅ 确认打标'`) && img.includes('finishTag(true)'));
    /* v69：两段描述改名 全局描述 / 提示词扩写 */
    check('双描述仍在', img.includes('全局描述') && img.includes('提示词扩写'));
check('M5 zip 导出未破坏', av.includes('resolveTagMasks') && av.includes(`mime: 'application/zip'`));

console.log('========================');
console.log('probe-v53b: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
