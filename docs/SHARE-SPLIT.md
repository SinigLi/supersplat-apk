# 大文件导出：超 30MB 自动分卷（v63）

> 老板 2026-11-13：视频打标包到 40MB，飞书拒收。要求「超过 30MB 自动分段压缩输出」，
> 参考发版脚本 `tools/feishu_send.py` 的做法：>30MB 自动 7z 压缩，压完仍超就 25MB 一卷分卷发送。

## 规则

| 体积 | 行为 |
|---|---|
| ≤ 30MB | 单文件，走 `SaveImage.shareFile`（原链路，未改） |
| > 30MB | 按 **25MB/卷** 切开（留 5MB 余量给飞书），一次多选分享 |

阈值来源：飞书单文件上限 30MB；每卷 25MB 是 `feishu_send.py` 的 `VOL_SIZE_DEFAULT`。

## 卷名

```
marks-第八集01-20261113194123.zip.001
marks-第八集01-20261113194123.zip.002
```

后缀 `.001/.002` 与解压中心 `ExtractPlugin.stripVolume()` 的识别规则一致
（`\.(\d{3}|part\d+|z\d\d)$`），老板把整组卷拖进「🪓 解压」页会自动拼接还原，
不需要手工合并。

## 链路

```
exportJson() / exportGroup()
    └── ShareOut.send({ bytes, filename, mime, onProgress })
            ├── <= 30MB → SaveImage.shareFile(data=b64)
            └── >  30MB → 切卷（subarray，不复制整块）
                           → 逐卷 3MB 分片写 CacheDirectory/shared/
                           → SaveImage.sharePaths({ names })  // ACTION_SEND_MULTIPLE
```

一次性多选分享而不是逐卷调 `shareFile`：逐卷会连弹 N 次分享面板，用户得点 N 次，
而且第二卷依赖第一次的会话选择，容易发到不同会话里。

## 兜底

| 场景 | 行为 |
|---|---|
| 缺 `Filesystem` 插件 | 逐卷 `shareFile`（每卷 25MB base64，内存可接受） |
| 缺 `sharePaths`（旧 APK） | 同上 |
| 单个卷写盘失败 | 抛错 → 进度条 hide + toast 失败原因（不静默） |

## 原生实现要点

`SaveImagePlugin.sharePaths`：

- 文件已由 Web 层写进 `CacheDirectory/shared/`，原生只做校验 + 分享
- **必须 `putParcelableArrayListExtra`**：`putExtra(EXTRA_STREAM, ArrayList<Uri>)` 会匹配
  `putExtra(String, Serializable)` 重载，`Uri` 不是 `Serializable`，运行时抛异常
- `minSdk 23`：不能用 `String.join`（API 26+），用本地 `joinComma`
- 缺文件跳过并在返回值里列 `missing`，不整体失败

## 探针

- `tests/probe-v63.cjs`（36 项）：阈值常量、切卷算法、卷名规则、40MB→2 卷、
  2.5MB→5 卷、字节级拼回校验、两种兜底、原生契约
- `tests/v63-dom.mjs`（13 项）：headless 里把阈值调成 1MB/600KB，跑真实 `ShareOut.send`
  和真实导出按钮，断言**各卷拼回后与原 zip 字节完全一致**

## 已知边界

- 分卷后总大小略大于原文件（每卷独立 base64 与缓存开销可忽略，但仍建议导出前先删掉用不到的遮罩）
- 飞书对多文件消息有数量限制，卷数特别多（>20）时建议改用 7z 先压再分
- 卷必须在**同一个会话里全部下载**才能解压；缺卷时解压中心会报「缺少分卷 .00X」（v44 已实现预检）
