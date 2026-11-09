/* v53u probe：层列表越开越窄（bottom 锚定 + placePanel top 叠加） */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); }
}
const img = fs.readFileSync(WS + 'www/img-ui.js', 'utf8');

check('打开面板前清 bottom 锚定（enable）', /layersPanel\.style\.bottom = 'auto';\s*\n\s*layersPanel\.style\.height = 'auto';\s*\n\s*placePanel\(layersPanel, g1\);/.test(img));
check('打开面板前清 bottom 锚定（disable）', /placePanel\(layersPanel, g2\);/.test(img) && (img.match(/layersPanel\.style\.bottom = 'auto';/g) || []).length >= 2);
check('面板改 fixed 定位（脱离 absolute+bottom:76px）', (img.match(/layersPanel\.style\.position = 'fixed';/g) || []).length >= 2);
check('finishTag 清理含 bottom/height/position', img.includes(`layersPanel.style.bottom = ''; layersPanel.style.height = ''; layersPanel.style.position = '';`));
/* 回归 */
check('finishTag 回视频页（v53t）', !/pjPage\.classList/.test(img.slice(img.indexOf('function finishTag'), img.indexOf('function buildTagBar'))));
check('placePanel 复用（v53s）', img.includes('placePanel(layersPanel, g1);'));

console.log('========================');
console.log('probe-v53u: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' === ALL PASS ===' : ' === FAIL ==='));
process.exit(fail === 0 ? 0 : 1);
