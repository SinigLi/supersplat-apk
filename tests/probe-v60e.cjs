/* probe-v60e：静态断言固化本轮修复（CSS + JS 契约） */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n); } };

const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');

check('img-tagbar-bottom 完整停靠规则（fixed+top:auto+row+bottom safe-area）',
  img.includes('.img-tagbar-bottom{position:fixed;left:50%;right:auto;top:auto;bottom:calc(env(safe-area-inset-bottom, 0px) + 10px);transform:translateX(-50%);flex-direction:row'));
check('img-tagbar-bottom 防溢出（max-width+overflow-x）', img.includes('max-width:calc(100vw - 24px);overflow-x:auto;overflow-y:hidden}'));
check('okbar transform:none（CSS）', img.includes('.img-tag-okbar{position:fixed;z-index:1601;transform:none;'));
check('okbar transform:none（JS inline）', img.includes("okBar.style.transform = 'none';"));
check('okbar 横排 flex-direction:row', img.includes('display:flex;flex-direction:row;gap:8px'));

console.log('probe-v60e: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
process.exit(fail ? 1 : 0);
