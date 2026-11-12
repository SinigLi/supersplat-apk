/* probe-v61c：导入弹性（魔数 zip、子目录 charcards.json、双键 imgMap、accept 放行） */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n); } };

const cui = fs.readFileSync(WS + 'www/cardgroups-ui.js', 'utf8');
const cc = fs.readFileSync(WS + 'www/charcards.js', 'utf8');

check('accept 放行为任意类型', cui.includes("inp.accept = '*/*'"));
check('按 ZIP 魔数识别（PK）', cui.includes('head[0] === 0x50 && head[1] === 0x4B'));
check('一律 readAsArrayBuffer 再判定', cui.includes('rd.readAsArrayBuffer(f)'));
check('charcards.json 允许子目录', cui.includes('(^|\\/)charcards\\.json$'));
check('imgMap 同时放带前缀与纯文件名键', cui.includes('imgMap[k.replace(/^chars(_full)?\\//i') && cui.includes('imgMap[k] = du'));
check('JSON 分支先解码 ArrayBuffer', cui.includes("new TextDecoder('utf-8').decode(u8.subarray(s0))"));
check('误入打标 JSON 时明确提示', cui.includes('jd.marks') || cui.includes('isMarks'));
check('导入链路有 dlog', cui.includes("dlog('import: file=") && cui.includes("dlog('import: zip entries="));
check('没有角色卡时拒绝并提示', cui.includes('!Array.isArray(jd.cards)'));

console.log('probe-v61c: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
process.exit(fail ? 1 : 0);
