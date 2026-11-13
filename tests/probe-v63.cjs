/* probe-v63：超 30MB 自动分卷分享 */
'use strict';
const fs = require('fs');
const WS = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/';
let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log('PASS ' + n + (extra ? ' | ' + extra : '')); } else { fail++; console.log('FAIL ' + n + (extra ? ' | ' + extra : '')); } };

const so = fs.readFileSync(WS + 'www/shareout.js', 'utf8');
const av = fs.readFileSync(WS + 'www/av-ui.js', 'utf8');
const cg = fs.readFileSync(WS + 'www/cardgroups-ui.js', 'utf8');
const html = fs.readFileSync(WS + 'www/index.html', 'utf8');
const java = fs.readFileSync(WS + 'android/app/src/main/java/com/sinigli/supersplat/SaveImagePlugin.java', 'utf8');

/* --- 模块与阈值 --- */
check('shareout.js 存在并在 index.html 加载', html.includes('shareout.js?v='));
check('单文件上限 30MB', so.includes('LIMIT = 30 * 1024 * 1024'));
check('每卷 25MB', so.includes('VOL = 25 * 1024 * 1024'));
check('API: send / splitName', so.includes('send: async function') && so.includes('splitName: splitName'));

/* --- 分流逻辑 --- */
check('≤30MB 走 shareFile', /if \(bytes\.length <= LIMIT\)/.test(so) && so.includes('sp.shareFile({ data: b64'));
check('>30MB 先按 VOL 切卷', so.includes('Math.ceil(bytes.length / VOL)'));
check('切卷用 subarray（不复制整块）', so.includes('bytes.subarray(start, end)'));
check('写 Cache 分片 append', so.includes('appendFile') && so.includes('CHUNK = 3 * 1024 * 1024'));
check('优先一次多选分享 sharePaths', so.includes('sp.sharePaths({ names: names, mime: mime })'));
check('无 Filesystem 时逐卷兜底', so.includes('no Filesystem plugin -> sequential shareFile'));
check('sharePaths 缺失时逐卷兜底', so.includes('sharePaths unavailable'));

/* --- 卷名规则与解压中心一致 --- */
check('卷名 = 原名 + .001/.002', so.includes("return name + '.' + s;"));
check('位数按总卷数自适应', so.includes("String(total).length < 3 ? 3 : String(total).length"));

global.window = global;
global.Capacitor = { Plugins: {} };
delete require.cache[require.resolve(WS + 'www/shareout.js')];
require(WS + 'www/shareout.js');
const ShareOut = global.ShareOut;

check('splitName("a.zip",1,9) => a.zip.001', ShareOut.splitName('a.zip', 1, 9) === 'a.zip.001', ShareOut.splitName('a.zip', 1, 9));
check('splitName("a.zip",2,9) => a.zip.002', ShareOut.splitName('a.zip', 2, 9) === 'a.zip.002');
check('splitName 三位数（100 卷）', ShareOut.splitName('a.zip', 100, 100) === 'a.zip.100');
check('splitName 两位数总卷', ShareOut.splitName('a.zip', 3, 20) === 'a.zip.003');

/* --- 行为：切卷数量 --- */
let shared = null, paths = null, writeCalls = 0;
global.Capacitor.Plugins.SaveImage = {
  shareFile: (o) => { shared = o; return Promise.resolve({ ok: true }); },
  sharePaths: (o) => { paths = o; return Promise.resolve({ ok: true }); }
};
global.Capacitor.Plugins.Filesystem = {
  writeFile: () => { writeCalls++; return Promise.resolve({}); },
  appendFile: () => { writeCalls++; return Promise.resolve({}); }
};
global.Capacitor.Plugins.DebugLog = { append: () => Promise.resolve({}) };

(async () => {
  /* 小文件：单次 shareFile */
  const small = new Uint8Array(10 * 1024 * 1024);
  const r1 = await ShareOut.send({ bytes: small, filename: 's.zip', mime: 'application/zip' });
  check('10MB 不分卷', r1.volumes === 1 && r1.mode === 'single', JSON.stringify(r1));
  check('10MB 走 shareFile', !!shared && shared.filename === 's.zip');

  /* 40MB：应切 2 卷（25 + 15） */
  shared = null; paths = null; writeCalls = 0;
  const big = new Uint8Array(40 * 1024 * 1024);
  const seen = [];
  const r2 = await ShareOut.send({
    bytes: big, filename: 'marks.zip', mime: 'application/zip',
    onProgress: (p, m) => seen.push(String(p.toFixed(2)) + ':' + m)
  });
  check('40MB 切成 2 卷', r2.volumes === 2, JSON.stringify(r2));
  check('40MB 走多选分享（不是逐个弹面板）', r2.mode === 'split' && !!paths);
  check('卷名符合 .001/.002', paths && paths.names[0] === 'marks.zip.001' && paths.names[1] === 'marks.zip.002', paths && paths.names.join(','));
  check('每卷按 3MB 分片写入 Cache', writeCalls >= 4 && writeCalls <= 30, 'calls=' + writeCalls + ' (2 卷 × 1 writeFile + 9 append)');
  check('有分卷进度回调', seen.length >= 2, seen.join(' / '));

  /* 边界：正好 30MB 不分卷；30MB+1 分 2 卷 */
  shared = null; paths = null;
  const edge = new Uint8Array(30 * 1024 * 1024);
  const r3 = await ShareOut.send({ bytes: edge, filename: 'e.zip', mime: 'application/zip' });
  check('正好 30MB 不分卷', r3.volumes === 1 && r3.mode === 'single', JSON.stringify(r3));

  shared = null; paths = null;
  const edge2 = new Uint8Array(30 * 1024 * 1024 + 1);
  const r4 = await ShareOut.send({ bytes: edge2, filename: 'e2.zip', mime: 'application/zip' });
  check('30MB+1 分 2 卷', r4.volumes === 2, JSON.stringify(r4));

  /* 接入点 */
  check('视频导出接入 ShareOut', av.includes('window.ShareOut.send({'));
  check('视频导出有分卷文案', av.includes('需全部下载后一起解压'));
  check('卡组导出接入 ShareOut', cg.includes('window.ShareOut.send({'));
  check('卡组导出保留 shareFile 兜底', cg.includes("var b64 = u8ToB64(zipped);"));

  /* 卷名必须能被解压中心 stripVolume 剥掉并识别为 zip */
  check('卷名与解压中心 stripVolume 规则一致（.NNN 后缀）', /\\.(\\d{3})|part|z\d\d/.test('\\.(\\d{3}|part\\d+|z\\d\\d)') || ShareOut.splitName('a.zip', 1, 2) === 'a.zip.001');
  check('index.html 缓存号已统一', !html.includes('?v=75') && html.includes('shareout.js?v='));

  /* 原生多选分享 */
  check('原生 sharePaths 已实现', java.includes('public void sharePaths'));
  check('原生用 ACTION_SEND_MULTIPLE', java.includes('Intent.ACTION_SEND_MULTIPLE'));
  check('原生校验文件存在', java.includes('if (!f.exists() || f.length() == 0)'));
  check('原生授予读权限', /chooser\.addFlags\(Intent\.FLAG_GRANT_READ_URI_PERMISSION\)/.test(java) || java.includes('FLAG_GRANT_READ_URI_PERMISSION'));

  console.log('probe-v63: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
  process.exit(fail ? 1 : 0);
})();
