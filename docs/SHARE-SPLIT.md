# 大文件导出：分卷规则（v64，阈值 500MB / 450MB）

> 2026-11-13 老板把限制来源改成 OpenClaw 侧：单文件上限从 30MB 调到 **500MB**。
> 所以切卷阈值随之上调，并且明确一条原则：**分卷只是为了绕过传输端的上限；
> 如果当前环境根本交不出多个文件，就不分卷，整包单发。**

## 规则

| 体积 | 行为 |
|---|---|
| ≤ 500MB | 单文件，走 `SaveImage.shareFile`（绝大多数情况走这条） |
| > 500MB **且** 环境支持多选分享 | 按 **450MB/卷** 切开（留 50MB 余量） |
| > 500MB **但** 环境不支持多选分享 | 不分卷，整包单发，提示「可能发送失败」 |

阈值来源：OpenClaw/飞书单文件上限 500MB（2026-11-13 老板调整）。

「环境支持多选分享」= `canSplit()`，要求同时具备：

1. `Capacitor.Plugins.Filesystem`（能写 `CacheDirectory/shared/`）
2. `SaveImage.sharePaths`（原生 `ACTION_SEND_MULTIPLE`）

缺任何一个都不切卷。理由：分卷后必须**一次**把全部卷交给收件方，
否则用户要点 N 次分享面板，还可能发到不同会话里，收件方拼不回来——
拼不回来的碎片比一个超限但完整的文件更糟。

## 卷名

```
marks-第八集01-20261113194123.zip.001
marks-第八集01-20261113194123.zip.002
```

后缀 `.001/.002` 与解压中心 `ExtractPlugin.stripVolume()` 的识别规则一致
（`\.(\d{3}|part\d+|z\d\d)$`），把整组卷拖进「🪓 解压」页会自动拼接还原，
不需要手工合并。位数按总卷数自适应，最少三位。

## 链路

```
exportJson() / exportGroup()
    └── ShareOut.send({ bytes, filename, mime, onProgress })
            ├── 未超限 / canSplit()=false
            │       → SaveImage.shareFile(data=b64)          // mode: single / single-oversize
            └── 超限且 canSplit()=true
                    → 切卷（subarray，不复制整块）
                    → 逐卷 3MB 分片写 CacheDirectory/shared/
                    → SaveImage.sharePaths({ names })        // ACTION_SEND_MULTIPLE, mode: split
```

## 返回值

| mode | 含义 |
|---|---|
| `single` | 未超限，单文件发出 |
| `single-oversize` | 超限但环境不支持多卷，仍然单文件发出（可能被传输端拒收） |
| `split` | 超限且已分卷，`names` 里是各卷文件名 |

UI 会按 mode 给不同 toast：`split` 提示「需全部下载后一起解压」，
`single-oversize` 提示「超过传输端上限，可能发送失败」。

## 原生实现要点

`SaveImagePlugin.sharePaths`：

- 文件已由 Web 层写进 `CacheDirectory/shared/`，原生只做校验 + 分享
- **必须 `putParcelableArrayListExtra`**：`putExtra(EXTRA_STREAM, ArrayList<Uri>)` 会匹配
  `putExtra(String, Serializable)` 重载，`Uri` 不是 `Serializable`，运行时抛异常
- `minSdk 23`：不能用 `String.join`（API 26+），用本地 `joinComma`
- 缺文件跳过并在返回值里列 `missing`，不整体失败

## 探针

- `tests/probe-v64.cjs`（50 项）：500MB/450MB 阈值、`canSplit()` 三态
  （有/无 Filesystem、有/无 sharePaths）、超限不可分时整包单发、
  卷名规则、字节级拼回、接入点、原生契约
- `tests/probe-v63.cjs`（37 项）：分卷机制本身（阈值用 `_setLimits` 临时调小）
- `tests/v63-dom.mjs`（13 项）：headless 里把阈值调成 1MB/600KB，跑真实
  `ShareOut.send` 和真实导出按钮，断言**各卷拼回后与原 zip 字节完全一致**

## 已知边界

- 500MB 已经很难触达：当前视频打标包带原图也就 40MB 量级。
  真正的瓶颈不是传输上限，而是 WebView 里造 500MB 的 `Uint8Array` 和 base64 字符串
  （各自都是整块内存）。真要导出这个量级，先看 `av-ui.js` 的 OOM 防护链是否够。
- 分卷后总大小略大于原文件（每卷独立 base64 与缓存开销可忽略）。
- 卷必须在**同一个会话里全部下载**才能解压；缺卷时解压中心会报「缺少分卷 .00X」（v44 已实现预检）。
