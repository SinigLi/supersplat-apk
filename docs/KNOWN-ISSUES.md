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

### 关联文档
- `docs/DIRECTOR.md` v45o~v45x 各行（每版详情）
- `memory/2026-11-03.md`、`memory/2026-11-04.md`（事故链、桥饿死、插件地雷）
- 诊断脚本存档：`temp/archive-v45/`（含 v45r-diag.mjs 真实浏览器复现、gen-*.cjs 各版变换脚本、orchestrate 交付流水线）
