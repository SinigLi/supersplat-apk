/* v69 probe：marks 字段改名 + 默认词库修复 + 上一级分镜清单自动导入
 *
 * 老板 2026-11-15 三条要求：
 *  ① marks.json 用 global_desc / prompt_extend 替代 orig_char_desc / dest_char_desc
 *  ② 默认词组改叫「全局描述」/「提示词扩写」，全局描述组带默认词「启用思考」
 *  ③ 默认词组不显示的 bug（只有新建分组才冒出来两组）
 *  ④ 导入 clips/ 时自动吃上一级的 分镜清单.csv（多帧点自动导入）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
const WWW = WS + 'www/';

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { pass++; console.log('PASS ' + n + (extra ? ' | ' + extra : '')); }
  else { fail++; console.log('FAIL ' + n + (extra ? ' | ' + extra : '')); }
};

const read = (f) => fs.readFileSync(WWW + f, 'utf8');
const cc = read('charcards.js');
const store = read('av-store.js');
const av = read('av-ui.js');
const img = read('img-ui.js');
const cgui = read('cardgroups-ui.js');
const java = fs.readFileSync(WS + 'android/app/src/main/java/com/sinigli/supersplat/MediaServerPlugin.java', 'utf8');

/* ---------- ① marks.json 字段改名 ---------- */
check('av-store 导出用 global_desc', /global_desc:\s*cGlobalDesc\(c\)/.test(store));
check('av-store 导出用 prompt_extend', /prompt_extend:\s*cPromptExtend\(c\)/.test(store));
check('av-store 不再导出 orig_char_desc 字段',
  !/e\s*=\s*\{[^}]*orig_char_desc:/.test(store));
check('av-store 读老数据兼容 orig_char_desc', store.includes("typeof c.orig_char_desc === 'string'"));
check('av-store 读老数据兼容 dest_char_desc', store.includes("typeof c.dest_char_desc === 'string'"));

/* ---------- ② 默认词组改名 + 启用思考 ---------- */
check('默认组名 = 全局描述', cc.includes("GROUP_GLOBAL = '全局描述'"));
check('默认组名 = 提示词扩写', cc.includes("GROUP_PROMPT = '提示词扩写'"));
check('全局描述组带默认词「启用思考」',
  /GROUP_GLOBAL,\s*items:\s*\[WORD_ENABLE_THINK\]/.test(cc) && cc.includes("WORD_ENABLE_THINK = '启用思考'"));
check('老组名映射到新名', /'原角色描述':\s*GROUP_GLOBAL/.test(cc) && /'替换角色描述':\s*GROUP_PROMPT/.test(cc));
check('CC 导出默认组名常量', cc.includes('GROUP_GLOBAL: GROUP_GLOBAL') && cc.includes('GROUP_PROMPT: GROUP_PROMPT'));

/* ---------- ③ 默认词组不显示的根因 ---------- */
check('normalize 就地写回入参（修「丢掉返回值」）',
  /raw\.descGroups = f\.descGroups/.test(cc) && /raw\.cards = f\.cards/.test(cc));
check('openWords 用 normalize 的返回值', /data = window\.CC\.normalize\(data\)/.test(cgui));
check('openWords 回写卡组（补组后落盘）', cgui.includes('window.CCG.saveData(id, data)'));
check('老组名撞车时按名合并词条', cc.includes('hit.items.indexOf(w) < 0'));
check('空全局描述组自动补回默认词', /gg\.items\.length === 0/.test(cc));

/* ---------- ④ 上一级分镜清单 ---------- */
check('原生实现 findSiblingCsv', java.includes('public void findSiblingCsv(PluginCall call)'));
check('原生按 tree rootId 反推父目录',
  java.includes('getTreeDocumentId') && java.indexOf("rootId.lastIndexOf('/')") > -1);
check('原生父目录探测失败返回原因而不是抛错',
  java.includes('父目录不可读') && java.includes('call.resolve(res)'));
check('av-ui 优先走 findSiblingCsv', av.includes('p.findSiblingCsv({') && av.includes("name: '分镜清单.csv'"));
check('找到即自动读 + 打点（不点按钮）',
  /S\.meta\.csvUri = r\.uri/.test(av) && av.includes('applyStoryboard(t && t.text || \'\')'));
check('探不到才弹一次 pickCsv 兜底', /setTimeout\(function \(\)[\s\S]{0,200}p\.pickCsv\(\)/.test(av));
check('记住 csvUri 后零操作直接读',
  /if \(S\.meta\.csvUri\) \{[\s\S]*?applyStoryboard\(r && r\.text \|\| ''\)/.test(av));
check('多帧点走 multiframe_ref', read('storyboard.js').includes('multiframe_ref'));

/* ---------- 字段改名不能漏 UI ---------- */
check('img-ui 打标导出用新字段', img.includes('global_desc: tm.orig[card.id]') && img.includes('prompt_extend: tm.dest[card.id]'));
check('img-ui 层兜底分支也用新字段', img.includes('global_desc: tm.orig[l.id]'));
check('img-ui 回填读新字段优先', img.includes("typeof c.global_desc === 'string'"));
check('img-ui 面板标题 = 全局描述', img.includes("'全局描述（'"));
check('img-ui 面板标题 = 提示词扩写', img.includes("'提示词扩写（'"));
check('img-ui 下拉读新组名', img.includes('window.CC.GROUP_GLOBAL') && img.includes('window.CC.GROUP_PROMPT'));
check('打标页不再出现旧标题', !/img-tag-desc-title',\s*'原角色描述/.test(img));

/* ---------- 运行时行为（用真实 charcards.js 跑） ---------- */
const sandbox = { window: {}, console };
const vm = require('vm');
vm.createContext(sandbox);
vm.runInContext(cc, sandbox);
const CC = sandbox.window.CC;
check('charcards 载入并暴露 CC', !!CC);

const empty = CC.emptyCards();
check('空卡组就有两组默认', empty.descGroups.length === 2
  && empty.descGroups[0].name === '全局描述' && empty.descGroups[1].name === '提示词扩写');
check('空卡组全局描述自带「启用思考」',
  JSON.stringify(CC.wordsOf(empty, '全局描述')) === '["启用思考"]',
  JSON.stringify(CC.wordsOf(empty, '全局描述')));

/* v1 老数据（没有 descGroups）：必须补出两组且能显示 */
const v1 = {
  schema: 'moyutai.charcards.v1',
  orig_char_descs: ['红衣', '红衣', '长发'],
  dest_char_descs: ['和服'],
  cards: [{ id: 'c-1', name: '小圆', tag: '主角' }]
};
const before = v1.descGroups;
const n1 = CC.normalize(v1);   // 故意不要返回值，模拟老代码的调用方式
check('丢掉返回值时 normalize 仍就地补组', Array.isArray(v1.descGroups) && v1.descGroups.length === 2);
check('v1 两数组迁进新组名',
  JSON.stringify(CC.wordsOf(v1, '全局描述')) === '["红衣","长发"]'
  && JSON.stringify(CC.wordsOf(v1, '提示词扩写')) === '["和服"]',
  JSON.stringify(v1.descGroups));
check('返回值与就地结果是同一份', n1.descGroups === v1.descGroups);

/* 老 v2 组名（原角色描述/替换角色描述）要迁到新名，且词不丢 */
const v2 = {
  schema: 'moyutai.charcards.v2',
  descGroups: [{ name: '原角色描述', items: ['甲', '乙'] }, { name: '替换角色描述', items: ['丙'] }],
  cards: []
};
const n2 = CC.normalize(v2);
check('v2 旧组名迁移到新名',
  n2.descGroups[0].name === '全局描述' && n2.descGroups[1].name === '提示词扩写',
  JSON.stringify(n2.descGroups.map((g) => g.name)));
check('迁移后词条保留', JSON.stringify(n2.descGroups[0].items) === '["甲","乙"]'
  && JSON.stringify(n2.descGroups[1].items) === '["丙"]');

/* 新旧组名同时存在：合并，不丢词 */
const v3 = {
  schema: 'moyutai.charcards.v2',
  descGroups: [{ name: '原角色描述', items: ['老词'] }, { name: '全局描述', items: ['新词'] }],
  cards: []
};
const n3 = CC.normalize(v3);
check('新旧同名组合并保留全部词',
  n3.descGroups[0].name === '全局描述'
  && n3.descGroups[0].items.indexOf('老词') >= 0 && n3.descGroups[0].items.indexOf('新词') >= 0,
  JSON.stringify(n3.descGroups[0].items));

/* 用户把全局描述词删光：要补回默认词，但不能塞重复 */
const v4 = { schema: 'moyutai.charcards.v2', descGroups: [{ name: '全局描述', items: [] }], cards: [] };
const n4 = CC.normalize(v4);
check('空全局描述补回「启用思考」', JSON.stringify(n4.descGroups[0].items) === '["启用思考"]',
  JSON.stringify(n4.descGroups[0].items));

/* ---------- 导出链路（av-store 真跑一遍） ---------- */
/* av-store 是浏览器 IIFE，导出挂 window.__avLogic，用 globalThis 兑当；
 * 它读 localStorage，给个最小 stub。 */
const g = global;
g.localStorage = {
  _m: {},
  getItem(k) { return this._m[k] !== undefined ? this._m[k] : null; },
  setItem(k, v) { this._m[k] = String(v); },
  removeItem(k) { delete this._m[k]; }
};
g.window = g;
require(WWW + 'av-store.js');
const L = g.__avLogic;
check('av-store 载入', !!L);

const marks = { version: 1, marks: [] };
L.upsertCharRef(marks, '001', 0, [
  /* 一条新字段、一条老字段，验证兼容 */
  { cardId: 'c-1', name: '女主', global_desc: '红衣女子', prompt_extend: '穿和服' },
  { cardId: 'c-2', name: '男主', orig_char_desc: '白衣书生', dest_char_desc: '黑衣刺客' }
]);
const files = [{ name: '001.mp4', seq: 1, label: '001' }];
const exp = L.buildExport({ name: 'p', mode: 'video' }, marks, files);
/* 导出信封把节点放在 out.marks，段用 target 字段标识（见 export-chars.test.cjs） */
const node0 = (exp.marks || []).find((n) => n.target === '001');
const chars = (node0 && node0.chars) || [];
check('导出节点带 chars', chars.length === 2, JSON.stringify(chars && chars.map(c => c.name)));
check('导出写 global_desc', chars[0] && chars[0].global_desc === '红衣女子', JSON.stringify(chars[0]));
check('导出写 prompt_extend', chars[0] && chars[0].prompt_extend === '穿和服', JSON.stringify(chars[0]));
check('导出不写 orig_char_desc', chars[0] && chars[0].orig_char_desc === undefined);
check('导出不写 dest_char_desc', chars[0] && chars[0].dest_char_desc === undefined);
check('老数据也能导出到新字段（兼容读）',
  chars[1] && chars[1].global_desc === '白衣书生' && chars[1].prompt_extend === '黑衣刺客',
  JSON.stringify(chars[1]));

console.log('\nprobe-v69: ' + pass + '/' + (pass + fail) + ' === ' + (fail ? 'FAILED' : 'ALL PASS') + ' ===');
process.exit(fail ? 1 : 0);
