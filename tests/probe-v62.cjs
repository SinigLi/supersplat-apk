/* probe-v62：导出内存治理 + 详细日志契约 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log('PASS ' + n + (extra ? ' | ' + extra : '')); } else { fail++; console.log('FAIL ' + n + (extra ? ' | ' + extra : '')); } };

const cc = fs.readFileSync(WS + 'www/charcards.js', 'utf8');
const av = fs.readFileSync(WS + 'www/av-ui.js', 'utf8');

/* --- exportPlan inline 开关 --- */
check('exportPlan 支持 opts', /function exportPlan\(f, opts\)/.test(cc));
check('默认 inline（卡组库导出仍内嵌）', cc.includes("var inline = !opts || opts.inline !== false;"));
check('inline=false 时不写 img', /if \(inline\) cc\.img = c\.img;/.test(cc));
check('inline=false 时不写 imgFull', /if \(inline\) cc\.imgFull = c\.imgFull;/.test(cc));
check('路径引用始终保留', cc.includes("cc.imgFullFile = 'chars_full/'"));

/* --- 视频导出不再内嵌 --- */
check('视频导出传 inline:false', av.includes('exportPlan(slim, { inline: false })'));

/* --- 详细日志 --- */
check('全程 mark 打点（含耗时+内存）', av.includes("' + (Date.now() - T0) + 'ms ' + memInfo()"));
check('START 记录工程/marks/files/fflate', av.includes("export: START project=") && av.includes("' fflate='"));
check('遮罩阶段统计', av.includes('tagmask: START refs=') && av.includes('tagmask: DONE count='));
check('每张遮罩记录尺寸与字节', av.includes("'tagmask: png ' + path + ' ' + canvas.width"));
check('抽帧记录尺寸', av.includes("'tagmask: frame captured '"));
check('zip 前后记录条目与体积', av.includes("await mark('zip start'") && av.includes('top=') && av.includes("await mark('zip done'"));
check('shareFile 前后打点', av.includes("await mark('shareFile call'") && av.includes("mark('shareFile ok')"));
check('关键日志等待落盘（闪退也留痕）', av.includes('function dlogAw') && (av.match(/await mark\(/g) || []).length >= 6);

/* --- 内存治理 --- */
check('抽帧共用单个 video', av.includes('var _cfVideo = null') && av.includes('function _cfEnsureVideo'));
check('抽帧串行队列', av.includes('_cfChain'));
check('抽帧后释放解码器', av.includes('function _cfReleaseVideo') && av.includes('_cfReleaseVideo();'));
check('每轮释放 frameCanvas', /releaseCanvas\(frameCanvas\)/.test(av));
check('每张遮罩释放 canvas', /releaseCanvas\(canvas\);/.test(av));
check('轮次之间让出事件循环', av.includes('await yieldToGC()'));
check('canvas 释放是真归零', av.includes('c.width = 0; c.height = 0;'));

/* --- base64 分块 --- */
check('b64 分块编码', av.includes('function u8ToB64Chunked') && av.includes('u8ToB64Chunked(zipped)'));

/* --- 行为：exportPlan inline 语义 --- */
global.window = global;
delete require.cache[require.resolve(WS + 'www/charcards.js')];
require(WS + 'www/charcards.js');
const CC = global.CC;
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const big = 'data:image/png;base64,' + 'A'.repeat(200000);   /* 模拟一张真实原图 */
const d = CC.normalize({ schema: 'moyutai.charcards.v1', orig_char_descs: [], dest_char_descs: [],
  cards: [{ id: 'c1', name: '小圆', tag: '', img: png, imgFull: big }] });
const withInline = CC.exportPlan(d);
const noInline = CC.exportPlan(d, { inline: false });
check('默认导出内嵌 img/imgFull', !!withInline.json.cards[0].img && !!withInline.json.cards[0].imgFull);
check('inline:false 只留路径', !noInline.json.cards[0].img && !noInline.json.cards[0].imgFull);
check('inline:false 仍有 imgFile/imgFullFile', !!noInline.json.cards[0].imgFile && !!noInline.json.cards[0].imgFullFile);
check('两种模式 images 都含二进制条目', withInline.images.length === 2 && noInline.images.length === 2);
const slimJson = JSON.stringify(noInline.json).length;
const fullJson = JSON.stringify(withInline.json).length;
check('inline:false 显著减小 JSON', slimJson * 10 < fullJson, 'slim=' + slimJson + 'B full=' + fullJson + 'B');

console.log('probe-v62: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
process.exit(fail ? 1 : 0);
