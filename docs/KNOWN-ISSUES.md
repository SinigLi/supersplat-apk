# KNOWN-ISSUES — 已知未解决问题

## ISS-001：真机视频列表缩略图不显示（未解决，已暂停）

- **状态**：暂停（2026-11-04，老板决定先开发其他功能）
- **影响**：视频工作台左侧列表条目无首帧缩略图，仅显示播放箭头占位。不影响播放、标记、导出等核心功能。
- **最后交付版本**：v45x（284e494，2026-11-04 15:33 发飞书）——**此版的自适应快道路径未经真机验证**（交付 13 分钟后老板决定暂停）。

### 症状
- 桌面 headless 探针（mock 环境）48/48 全绿，缩略图正常出图。
- 真机（Android，4K 3840x2160 @23.976fps 片段）：缩略图开关为「开」，任务链路全通（mkThumb 33 次调用、队列正常），但列表无图。
- 原生解码每文件约 45~90 秒后报「无法解码首帧」；播放同一批文件完全正常。

### 已确证事实（真机日志实证，非猜测）
1. fps 检测已修复且稳定：min/max 跨度算法，真机连续 19 次读出 23.976（v45u 日志）。
2. 播放解码栈正常：同一批 4K 片段播放无问题 → `<video>` 元素在本机 WebView 可解码这些文件。
3. 桥线程饿死已修复（v45r）：thumb 解码在独立线程池 `moyutai-thumb`。
4. 插件注册地雷已修复（v45r-2）：`Executors.newSingleThreadExecutor()` 返回包装类不可强转 ThreadPoolExecutor（会 ClassCastException 导致 Capacitor 静默摘除整个插件）；现懒加载直建。
5. 原生 MMR 缩略图解码在本机对这批 4K 片段必然失败：官方 `getScaledFrameAtTime`（API27+）与 `getFrameAtTime` 全帧路径均失败（v45u/v45w 日志）。
6. 缩略图任务链路本身完好：mkThumb → 入队 → drain → 原生调用全部执行（v45v 诊断日志：mkCalls=33、jobs=31、live=2）。
7. v45s 起缩略图结果有会话级缓存与汇总日志（`thumbs done ok=N fail=M`）。

### 已尝试方案（时间序，全部已推送）
| 版本 | 提交 | 方案 | 结果 |
|---|---|---|---|
| v45o | 1528253 | 原生 MMR 首帧 JPEG base64 直出 | 桌面通过；真机无图 |
| v45r | 567ab0f | 独立解码线程池 + JS 泵；修 isConnected 早退吞任务（实锤 bug） | 桥不再堵；真机仍无图 |
| v45r-2 | 7a4412c | 修插件注册地雷（强转）+ fps min/max 跨度法 | fps 稳定 23.976；插件复活 |
| v45s | 10424f1 | 会话缓存 + 队列治理 + 汇总日志 | 日志不再刷屏 |
| v45t | c554d24 | 失败取证日志 + 原生时间阶梯 | 失败可见但原因仍是「无法解码首帧」 |
| v45u | 50e1865 | 官方 getScaledFrameAtTime（Android 8.1+ 标准做法） | 真机仍失败（零缩略图日志） |
| v45v | e0b3de8 | 入队级诊断 | 证明任务链路全通，断点在原生解码 |
| v45w | b54868c | 页面内视频捕获降级（隐藏 video + canvas 截帧，与播放同栈） | 降级触发有日志；捕获结果未在真机确认 |
| v45x | 284e494 | 自适应通道：2 次原生失败判死 → 直走捕获；判死记忆 3 天；15s 看门狗 | 未获真机验证即暂停 |

### 主要嫌疑（按优先级，未验证）
1. **视频捕获通道本身在本机失败但无日志佐证**：v45w/x 的捕获阶段（loadeddata → seek → canvas.toDataURL）没有任何一条真机日志证明其执行或成功。老板设备上可能 `<video>` 播放可用但 canvas 截帧受编解码/版权保护限制（4K H.265 SecureDecoder 输出不可绘制 → canvas 抛异常或黑帧）。
2. **等待时长不足**：v45w 时代每个文件原生阶段拖 45~90s，老板单次会话仅停留 30~60s，捕获队列根本没轮到跑就退出了。v45x 的快道（跳过原生）已消除此问题但未被验证。
3. **缓存未生效感知**：老板可能未二次进入同一工程（第二次进入会命中缓存秒出）。

### 如果重启此问题，建议切入点
1. 装 v45x 真机验证一次：进工程等 90 秒 → 导出日志。看三个标志：`native thumb disabled`（判死生效）、`thumbs done ok=N`（通道结果）、有无 `video capture fail`。
2. 若捕获也失败：给 videoThumbPump 的每个事件（loadeddata/seeked/error/canvas）加真机日志，确认卡在哪一步；用一段 720p 测试片对比；检查是否 H.265（MediaInfo 或 probeMeta 加 codec 字段）。
3. 考虑绕过 canvas：`captureStream()` + `VideoFrame`，或 Media3 ImageRenderer，或降采样到 96px 目标。
4. 终极兜底：缩略图持久化到工程目录（sidecar JPEG），一次成功终身受益；或接受无缩略图（现状可用）。
5. 方法论教训（对齐老板批评）：应当在第一轮就建立真机 ground truth（最小复现 APK / adb logcat / 逐层探针），而不是在桌面 mock 环境反复迭代 10+ 版。

### 2026-11-05 复查：两处具体代码缺陷（缺陷 A 已本地实证）

老板要求「有空再看看有没有解决方法」。本轮**不靠桌面 mock 猜**，直接读真机跑的那份代码，
找到两处必然成立的缺陷。两者独立，任一个都足以让缩略图全灭。

#### 缺陷 A：捕获通道 canvas 被污染（JS，`www/av-ui.js` videoThumbPump）

```js
v.muted = true;
v.playsInline = true;
v.preload = 'auto';
v.src = 'http://127.0.0.1:' + S.serverPort + '/' + encodeURIComponent(job.name);
// ← 缺 v.crossOrigin = 'anonymous'
...
c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
var jpeg = c.toDataURL('image/jpeg', 0.7).split(',')[1];
```

- 视频来自 `http://127.0.0.1:<随机端口>`，页面来自 Capacitor 的 `http(s)://localhost` / `capacitor://localhost` —— **跨源**。
- 跨源视频未声明 `crossOrigin` 时，`drawImage` 会**污染 canvas**，随后 `toDataURL()` 抛 `SecurityError`。
- 该异常被 `catch` 吞成 `finish(null, 'canvas err: ...')`，表现为「捕获也失败」，与「播放正常但截帧出不来」完全吻合。
- MediaServer 已返回 `Access-Control-Allow-Origin: *`（第 440/481/506 行），所以**只差前端声明 `crossOrigin`**。
- 这解释了 ISS-001 嫌疑 1（「canvas 截帧受限」）的具体机制，无需 SecureDecoder 假设。


#### 缺陷 A 的本地实证（2026-11-05，headless Edge）

用真实 4K 片段（`第八集片段_无字幕_shot038.mp4`）搭最小复现：页面起在 `:4981`，视频起在 `:4982`（模拟 Capacitor 页面源 vs 127.0.0.1 媒体服务），媒体服务按 MediaServerPlugin 的方式返回 `Access-Control-Allow-Origin: *` 与 Range：

| 条件 | 结果 |
|---|---|
| 不加 `crossOrigin` | `{"tainted":true,"errName":"SecurityError","errMsg":"Tainted canvases may not be exported."}` |
| 加 `crossOrigin='anonymous'` | `{"tainted":false,"jpegLen":1180,"w":192,"h":108}` |

**结论**：缺陷 A 从「推断」升级为「已证实」。画面能正常解码、seek 也成功，唯独 `toDataURL` 因画布被跨源视频污染而抛 SecurityError，被 `catch` 吞成 `canvas err`。这与「播放正常但缩略图不出」的真机表现完全一致，且**不需要**假设 SecureDecoder 或硬件限制。

> 注：实证脚本 `temp/thumb-taint-test.mjs` 为一次性诊断产物，未入库。
#### 缺陷 B：原生阶梯的超时放弃会毒化后续所有尝试（Java，`MediaServerPlugin.thumb`）

```java
class Run {
    Bitmap withTimeout(Callable<Bitmap> task) {
        Future<Bitmap> f = null;
        try {
            f = java.util.concurrent.Executors.newSingleThreadExecutor().submit(task);  // 每步新建、从不 shutdown
            return f.get(5, TimeUnit.SECONDS);
        } catch (Exception e) { return null; }
        finally { if (f != null) f.cancel(true); }   // 中断对 native 解码无效
    }
}
```

三层问题：

1. **retriever 被并发复用**：`cancel(true)` 只是设置中断标志，`MediaMetadataRetriever` 的原生解码不响应中断。
   被放弃的那次调用**仍在 `r` 上跑**，而阶梯紧接着用**同一个 `r`** 发起下一步 —— MMR 明确非线程安全，
   第一步一旦超时，后续每一步都在「另一个线程正在用同一个 retriever」的坏状态下执行，必定失败。
2. **释放悬空**：`finally { r.release(); }` 在仍有被放弃的原生调用持有 `r` 时执行 → use-after-free 风险。
3. **线程池泄漏**：每步 `newSingleThreadExecutor()` 且从不 `shutdown()`；58 个文件 × 最多 8 步，线程堆积。

**与真机症状的数值对账**：阶梯最坏 3（scaled：0/100ms/1s）+ 4（full：0/100ms/500ms/1s）+ 1（full OPTION_CLOSEST 重试）= **8 步 × 5s = 40s**，加上 metadata 提取、线程池创建、JPEG 编码开销 → **45~90 秒**。老板日志里「每文件拖 45~90 秒后报无法解码首帧」正好落在这个区间，
说明**每一步都超时了**，而第一步超时即毒化后续全部 —— 因此设备上从未成功出过一帧。这与「桌面测试全绿（mock 直接返回 jpeg）」不矛盾。

#### 建议修复（若获批准执行）

1. JS：`v.crossOrigin = 'anonymous'`（一行），让捕获通道的 canvas 可读；失败时把 `e.name` 一并记日志。
2. Java：改为**每次尝试新建独立 retriever + 独立 PFD**，超时即整体放弃并**不释放、不复用**该实例（交给 GC），
   彻底切断「放弃的调用污染后续」；同时 `pfd.close()`（现在只在 finally 释放 retriever，PFD 从未关闭，属真实 FD 泄漏），
   并把 `setDataSource(fd)` 换成官方推荐的三参 `setDataSource(fd, offset, length)`。
3. 若仍失败，退回「缩略图 sidecar 持久化」兜底。

> 状态：分析已完成（缺陷 A 已实证）；**缩略图修复未执行**。同源的定位缺陷已在 v47 修复（见下）。
> 修复量估计：缺陷 A 一行（`v.crossOrigin = "'anonymous'"`），缺陷 B 约 40 行 Java 重写；两者可分别灰度验证。

### 2026-11-05 v47：发现同源缺陷（线性 skip 定位），可能同时解释缩略图失败

排查老板新反馈「长视频按帧移动越到后半段越慢」时，定位到 MediaServer 的 Range 定位实现：

- `serveRange` 用 `InputStream.skip()` 循环跳到偏移；当 provider 返回的是管道流（不可 seek）时，
  `skip()` 退化为「顺序读掉 N 字节再丢弃」，成本 **O(偏移)**。
- 实测（461MB / 166s 真实 4K 片段，单次 256KB Range，服务端首字节）：

| 偏移 | 旧 skip | 新 lseek |
|---|---|---|
| 0 MB | 1.5 ms | 1.5 ms |
| 115 MB | 111.2 ms | 1.4 ms |
| 231 MB | 227.8 ms | 5.0 ms |
| 346 MB | 324.0 ms | 1.9 ms |
| 439 MB | 391.2 ms | 1.8 ms |

**与 ISS-001 的关系**：v45w/x 的缩略图捕获通道（隐藏 `<video>` + 本地 Range 服务 + canvas 截帧）
走的正是这条 `serveRange` 路径。虽然缩略图 seek 的目标只有 0.4s（偏移小，skip 代价有限），
但 `openDoc` 失败/串行阻塞仍会放大慢感；v47 的 lseek 改造**消除了服务端这一层的不确定性**。

**结论**：v47 不直接修复 ISS-001（缺陷 A 的 canvas 污染才是主因，已实证），
但它是同一条数据链路上的第二个真实缺陷，已一并修掉。ISS-001 仍待缺陷 A 的一行修复验证。

### 关联文档
- `docs/DIRECTOR.md` v45o~v45x 各行（每版详情）
- `memory/2026-11-03.md`、`memory/2026-11-04.md`（事故链、桥饿死、插件地雷）
- 诊断脚本存档：`temp/archive-v45/`（含 v45r-diag.mjs 真实浏览器复现、gen-*.cjs 各版变换脚本、orchestrate 交付流水线）
