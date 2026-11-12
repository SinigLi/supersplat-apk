/* probe-v61b：进度条模块 + 导入图片丢图修复（静态+行为） */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n); } };

const prog = fs.readFileSync(WS + 'www/progress.js', 'utf8');
const cc = fs.readFileSync(WS + 'www/charcards.js', 'utf8');
const cui = fs.readFileSync(WS + 'www/cardgroups-ui.js', 'utf8');
const av = fs.readFileSync(WS + 'www/av-ui.js', 'utf8');
const html = fs.readFileSync(WS + 'www/index.html', 'utf8');

check('progress.js 存在且挂 window.Prog', prog.includes('global.Prog = Prog') && prog.includes('Prog.show'));
check('index.html 已引入 progress.js', html.includes('progress.js'));
check('进度条四态 API', ['show:', 'set:', 'done:', 'hide:'].every(k => prog.includes(k)));

check('图片文件夹导入有进度（show/set/done）', cui.includes('Prog.show') && cui.includes("Prog.set((idx - 1) / total") && cui.includes("Prog.done('"));
check('卡组导出有进度', cui.includes("window.Prog.show('") && cui.includes('0.95,'));
check('卡组导入有进度 + 失败隐藏', cui.includes("Prog.show('") && cui.includes('Prog.hide()'));
check('视频导出有进度', av.includes("window.Prog.show('") && av.includes('window.Prog.done('));

check('importFromParts 三种 key 兜底', cc.includes('function _lookupImg') && cc.includes("split('/').pop()"));
check('imgFile 用 _lookupImg（不再直接查）', cc.includes('var hit = _lookupImg(imgMap, cc.imgFile)'));
check('imgFullFile 用 _lookupImg', cc.includes('var fullHit = _lookupImg(imgMap, cc.imgFullFile)'));

/* 行为：往返导入图片全部回来 */
global.window = global;
delete require.cache[require.resolve(WS + 'www/charcards.js')];
require(WS + 'www/charcards.js');
const CC = global.CC;
const jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const data = CC.normalize({ schema: 'moyutai.charcards.v1', orig_char_descs: [], dest_char_descs: [],
  cards: [{ id: 'c1', name: 'GPT', tag: '', img: jpg }, { id: 'c2', name: '小圆 日常', tag: '', img: jpg, imgFull: png }] });
const plan = CC.exportPlan(data);
/* 复刻 importFile 的 imgMap（去前缀 basename） */
const imgMap = {};
plan.images.forEach(im => { imgMap[im.file.replace(/^chars(_full)?\//, '')] = im.dataUrl; });
const back = CC.importFromParts(JSON.parse(JSON.stringify(plan.json)), imgMap);
check('往返后两张卡都有图', back.cards.length === 2 && back.cards.every(c => !!c.img));
check('带空格的名字也有图', back.cards.find(c => c.name === '小圆 日常').img);

console.log('probe-v61b: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
process.exit(fail ? 1 : 0);
