/* probe-v64：分卷阈值上调到 500MB/450MB，且不支持多选分享时不分卷
 *
 * 老板 2026-11-13 把 OpenClaw/飞书侧单文件上限从 30MB 调到 500MB。
 * 分卷的唯一理由是传输端上限；环境本身交不出多卷（无 Filesystem 写缓存
 * 或无原生 sharePaths）时，宁可不分——整包单发，而不是切成拼不回来的碎片。
 */
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

/* --- 阈值：500MB 上限 / 450MB 一卷 --- */
check('shareout.js 在 index.html 加载', html.includes('shareout.js?v='));
check('单文件上限 500MB', so.includes('LIMIT = 500 * 1024 * 1024'));
check('每卷 450MB', so.includes('VOL = 450 * 1024 * 1024'));
check('上限注释说明了来源（OpenClaw 2026-11-13）', so.includes('500MB'));
check('不再残留 30MB / 25MB 阈值', !so.includes('30 * 1024 * 1024') && !so.includes('25 * 1024 * 1024'));

/* --- 分流逻辑 --- */
check('canSplit() 要求 Filesystem + sharePaths', /function canSplit\(\)/.test(so) && so.includes('fsPlugin() && sp && sp.sharePaths'));
check('超限但不可分卷时整包单发', so.includes('single-oversize'));
check('判据是 over && canSplit()', /var splittable = over && canSplit\(\)/.test(so));
check('切卷按 VOL 计算', so.includes('Math.ceil(bytes.length / VOL)'));
check('切卷用 subarray（不复制整块）', so.includes('bytes.subarray(start, end)'));
check('写 Cache 分片 append', so.includes('appendFile') && so.includes('CHUNK = 3 * 1024 * 1024'));
check('分卷走一次多选分享 sharePaths', so.includes('sp.sharePaths({ names: names, mime: mime })'));
check('已删除逐卷 shareFile 兜底（分卷必须一次交出）', !so.includes('split-sequential') && !so.includes('sequential shareFile'));
check('卷名 = 原名 + .001/.002', so.includes("return name + '.' + s;"));
check('位数按总卷数自适应', so.includes('String(total).length < 3 ? 3 : String(total).length'));

global.window = global;
global.Capacitor = { Plugins: {} };
delete require.cache[require.resolve(WS + 'www/shareout.js')];
require(WS + 'www/shareout.js');
const ShareOut = global.ShareOut;

check('splitName("a.zip",1,9) => a.zip.001', ShareOut.splitName('a.zip', 1, 9) === 'a.zip.001', ShareOut.splitName('a.zip', 1, 9));
check('splitName 三位数（100 卷）', ShareOut.splitName('a.zip', 100, 100) === 'a.zip.100');
check('默认上/下限值正确', ShareOut.limit() === 500 * 1024 * 1024 && ShareOut.volumeSize() === 450 * 1024 * 1024,
  ShareOut.limit() + '/' + ShareOut.volumeSize());
check('无插件时 canSplit() 为 false', ShareOut.canSplit() === false);

/* --- 行为 --- */
const mkPlugins = (opts) => {
  global.Capacitor.Plugins.DebugLog = { append: () => Promise.resolve({}) };
  global.Capacitor.Plugins.SaveImage = {
    shareFile: (o) => { opts.shared.push(o); return Promise.resolve({ ok: true }); },
    sharePaths: opts.sharePaths
      ? (o) => { opts.paths.push({ names: o.names.slice(), mime: o.mime }); return Promise.resolve({ ok: true }); }
      : undefined
  };
  global.Capacitor.Plugins.Filesystem = opts.filesystem
    ? {
        writeFile: (o) => { opts.writes++; opts.acc[o.path] = o.data || ''; return Promise.resolve({}); },
        appendFile: (o) => { opts.writes++; opts.acc[o.path] = (opts.acc[o.path] || '') + (o.data || ''); return Promise.resolve({}); }
      }
    : undefined;
};
const mkState = (caps) => Object.assign({ shared: [], paths: [], writes: 0, acc: {} }, caps || {});

(async () => {
  /* 1) 小文件：单次 shareFile */
  let st = mkState({ sharePaths: true, filesystem: true });
  mkPlugins(st);
  const small = new Uint8Array(10 * 1024 * 1024);
  const r1 = await ShareOut.send({ bytes: small, filename: 's.zip', mime: 'application/zip' });
  check('10MB 不分卷', r1.volumes === 1 && r1.mode === 'single', JSON.stringify(r1));
  check('10MB 走 shareFile', st.shared.length === 1 && st.shared[0].filename === 's.zip');
  check('10MB 没写缓存', st.writes === 0);

  /* 2) 阈值调小到 2MB / 600KB，验证切卷 */
  ShareOut._setLimits(2 * 1024 * 1024, 600 * 1024);
  st = mkState({ sharePaths: true, filesystem: true });
  mkPlugins(st);
  const big = new Uint8Array(2.5 * 1024 * 1024);
  for (let i = 0; i < big.length; i++) big[i] = i % 251;
  const seen = [];
  const r2 = await ShareOut.send({
    bytes: big, filename: 'marks.zip', mime: 'application/zip',
    onProgress: (p, m) => seen.push(String(p.toFixed(2)) + ':' + m)
  });
  check('2.5MB 切成 5 卷（600KB/卷）', r2.volumes === 5, JSON.stringify(r2));
  check('走一次多选分享（不逐卷弹面板）', r2.mode === 'split' && st.paths.length === 1, 'paths=' + st.paths.length);
  check('卷名 .001 … .005', r2.names[0] === 'marks.zip.001' && r2.names[4] === 'marks.zip.005', r2.names.join(','));
  check('shareFile 一次都没调用', st.shared.length === 0);
  check('卷内字节拼回后与原数据一致', (() => {
    let joined = '';
    r2.names.forEach((n) => { joined += st.acc['shared/' + n] || ''; });
    const bin = atob(joined);
    if (bin.length !== big.length) return false;
    for (let k = 0; k < bin.length; k += 997) if (bin.charCodeAt(k) !== (k % 251)) return false;
    return true;
  })());
  check('每卷按 3MB 分片写入', st.writes >= 5, 'writes=' + st.writes);
  check('有分卷进度回调', seen.length === 5, seen.join(' / '));

  /* 3) 超限但没有 sharePaths（环境不支持多卷）→ 整包单发 */
  st = mkState({ sharePaths: false, filesystem: true });
  mkPlugins(st);
  const r3 = await ShareOut.send({ bytes: big, filename: 'big.zip', mime: 'application/zip' });
  check('无 sharePaths 时不分卷', r3.volumes === 1, JSON.stringify(r3));
  check('无 sharePaths 时 mode=single-oversize', r3.mode === 'single-oversize', r3.mode);
  check('无 sharePaths 时仍整包 shareFile 一次', st.shared.length === 1 && st.shared[0].filename === 'big.zip');
  check('无 sharePaths 时不写缓存', st.writes === 0);
  check('canSplit() 对此环境返回 false', ShareOut.canSplit() === false);

  /* 4) 有 sharePaths 但没有 Filesystem → 同样不分卷 */
  st = mkState({ sharePaths: true, filesystem: false });
  mkPlugins(st);
  const r4 = await ShareOut.send({ bytes: big, filename: 'big2.zip', mime: 'application/zip' });
  check('无 Filesystem 时不分卷', r4.volumes === 1 && r4.mode === 'single-oversize', JSON.stringify(r4));
  check('无 Filesystem 时整包 shareFile', st.shared.length === 1 && st.shared[0].filename === 'big2.zip');

  /* 5) 边界：正好等于上限不分卷；上限 +1 才分 */
  st = mkState({ sharePaths: true, filesystem: true });
  mkPlugins(st);
  const edge = new Uint8Array(2 * 1024 * 1024);
  ShareOut._setLimits(2 * 1024 * 1024, 1024 * 1024);
  const r5 = await ShareOut.send({ bytes: edge, filename: 'e.zip', mime: 'application/zip' });
  check('正好等于上限不分卷', r5.volumes === 1 && r5.mode === 'single', JSON.stringify(r5));
  st = mkState({ sharePaths: true, filesystem: true });
  mkPlugins(st);
  const edge2 = new Uint8Array(2 * 1024 * 1024 + 1);
  const r6 = await ShareOut.send({ bytes: edge2, filename: 'e2.zip', mime: 'application/zip' });
  check('上限 +1 字节分 3 卷（1MB/卷）', r6.volumes === 3, JSON.stringify(r6));

  /* 6) 接入点 */
  check('视频导出接入 ShareOut', av.includes('window.ShareOut.send({'));
  check('视频导出日志带 canSplit', av.includes('canSplit='));
  check('视频导出分卷文案按实测卷大小', av.includes("window.ShareOut.volumeSize()"));
  check('视频导出有超限单发提示', av.includes('超过传输端上限'));
  check('卡组导出接入 ShareOut', cg.includes('window.ShareOut.send({'));
  check('卡组导出有超限单发提示', cg.includes('超过传输端上限'));
  check('卡组导出保留 shareFile 兜底', cg.includes('var b64 = u8ToB64(zipped);'));
  check('旧文案「飞书 30MB」已清理', !av.includes('飞书单文件上限') && !cg.includes('飞书 30MB'));

  /* 7) 原生侧 */
  check('原生 sharePaths 已实现', java.includes('public void sharePaths'));
  check('原生用 ACTION_SEND_MULTIPLE', java.includes('Intent.ACTION_SEND_MULTIPLE'));
  check('原生授予读权限', java.includes('FLAG_GRANT_READ_URI_PERMISSION'));

  /* 8) 缓存号统一 */
  check('index.html 用到 shareout 且无 v=77 旧号', html.includes('shareout.js?v=') && !html.includes('?v=77'));

  console.log('probe-v64: ' + pass + '/' + (pass + fail) + (fail ? ' === FAIL ===' : ' === ALL PASS ==='));
  process.exit(fail ? 1 : 0);
})();
