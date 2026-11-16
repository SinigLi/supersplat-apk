# 摸鱼台（Moyutai）· supersplat-apk

> 3D 高斯泼溅的移动端导演台。基于 PlayCanvas SuperSplat 3.5.2 深度改造：
> 机位系统、人偶动画、画幅取景、角色打标、图片/视频/音频工作台均为自研扩展。
> Android 包名 `com.sinigli.supersplat`（保持覆盖安装兼容），应用显示名「摸鱼台」。

**当前版本 v71**（2026-11-16）· 分支 `main` · 仓库 `github.com/SinigLi/supersplat-apk`

---

## 0. 给新接手的人（先读这段）

### 这是什么

一个 **Android APK**，把 SuperSplat（网页版 3D 高斯泼溅编辑器）包进 Capacitor 壳，
再在 `www/` 上盖一层移动端 UI，做成能**摆放、构图、出片**的「导演台」。

### 三条最容易踩的坑

| 坑 | 说明 |
|---|---|
| **桌面绿 ≠ 真机过** | 无头 Edge + CDP 全绿也可能真机崩。历史事故：`recursive:true` 缺失只在 Android 报错、canvas 跨源污染只在真机崩、10bit 解码桌面永远测不出来。**改完必须真机验一轮**。 |
| **`www/index.js` 是构建产物** | 6.7MB，由 `../supersplat-main` 构建后同步过来。**不要在 `www/index.js` 里改代码**——改了下次同步就没了。改引擎请去 `../supersplat-main/src`。 |
| **改 JS 记得升 `?v=` 缓存戳** | `index.html` 里每个脚本都带 `?v=NN`。不升戳，真机会一直拿旧文件（v69 就因为漏升 `engine-gate.js?v=66` 白查半天）。 |

### 三分钟跑起来

```bash
# 1. 浏览器里直接看（不用装 APK）—— 起本地静态服务
node tools/dev/staticsrv.cjs          # 然后浏览器开 http://127.0.0.1:8080/www/index.html

# 2. 跑一遍核心回归，确认环境没问题
node tests/director.mjs                # 16 项
node tests/v13.mjs                     # 15 项
node tests/project.mjs                 # 27 项
```

浏览器类测试需要 **Edge**（脚本自己起 headless Edge + CDP，不用手动开）。

### 出包

按 `docs/RELEASE.md` 走；一句话版本：

```
改代码 → node --check → 跑回归 → commit/push main
      → GitHub Actions 构建 APK → 下载 artifact → 校验 → 打 zip → 发飞书
```

---

## 1. 双仓库关系（重要）

本项目由**两个仓库**组成，别搞混：

| 仓库 | 路径 | 作用 | 是否受 Git 管理 |
|---|---|---|---|
| **supersplat-apk** | `projects/supersplat-apk` | APK 壳 + `www/` 覆盖层 + 原生插件 + 测试 | ✅ 远端 `github.com/SinigLi/supersplat-apk` |
| **supersplat-main** | `projects/supersplat-main` | 上游引擎 fork（SuperSplat 源码，含 `src/director.ts`） | ⚠️ **本地仓库，没有 remote**；改动只在本地 |

引擎改动**不会自动**进 APK，必须：

```bash
cd projects/supersplat-main && npm run build     # 产出 dist
# 然后按 docs/RELEASE.md §2 把 dist 同步到 ../supersplat-apk/www
```

> ⚠️ 引擎仓库当前有**未提交**的 WebGL2 桥改动（12 个改动文件 + 新增 `src/webgl-splat-renderer.ts`，
> 约 +499/-45 行）。这些改动**已经构建并同步进 `www/index.js`**，所以 APK 里有桥，
> 但引擎仓库自身的 Git 历史还停在 v48e。接手时请注意这个「已发布但未提交」的状态。

---

## 2. 目录

```
www/                       Capacitor webDir（引擎构建产物 + 覆盖层）
  index.js                 ★ 构建产物（6.7MB，含 director.ts + WebGL2 桥）—— 不要手改
  index.css/index.html     样式与宿主页（index.html 按序注入全部覆盖层脚本）
  engine-gate.js           引擎能力闸门：探 WebGPU，没有但有 WebGL2 则照常加载走桥
  boot-diag.js             启动诊断层（v65）：抢在引擎前接管 console/onerror，崩溃时弹面板

  ── 工程与存储 ──
  projects.js              .svproj 存储与格式（纯逻辑，无 DOM）
  projects-ui.js           工程列表页 / 编辑页 / 新建-退出对话框
  groups.js                工程分组
  extract.js               解压中心

  ── 图片模式 ──
  img-ui.js / img-ops.js / img-store.js     双层画布、蒙版分层、导出

  ── 视频 / 音频工作台 ──
  av-ui.js (157KB)         视频工作台主体
  av-store.js              视频工程存储
  av-viz.js                波形/可视化
  storyboard.js            分镜清单 CSV 解析（镜号 ↔ 帧 ↔ 多参考图）

  ── 角色卡 / 打标 ──
  charcards.js             角色卡 v2 数据层（卡/词库 CRUD）
  cardgroups.js            多套全局卡组存储（CCG）
  cardgroups-full.js       原图 IndexedDB 存储（CGFull；localStorage 只留头像）
  cardgroups-ui.js         开始页卡组管理器（sheet + 导入导出 + 借图）

  ── 导演台 UI 层 ──
  dock.js (96KB)           移动端三停靠组 UI + 导演台/机位面板（外挂层，不改引擎源码）
  mobile.js / mobile.css   body.mobile-mode 等小补充

  ── 3D 兜底查看器（WebGPU 不可用时）──
  viewer.html / viewer3d.js / viewer3d.css   只读 3D 查看器（v67，方案 B）

  ── 通用 ──
  progress.js              统一进度浮层（window.Prog）
  shareout.js              大文件导出分发（>500MB 且可多选才切 450MB 分卷）
  fflate.js                zip 读写
  pc.min.mjs               PlayCanvas 运行时
  static/director/         woman / male / shiba / tuxedo / box 角色 GLB（含 43 clips）

android/app/src/main/java/com/sinigli/supersplat/
  MainActivity.java        插件注册
  SaveImagePlugin.java     照片输出：相册 / 另存为 / 分享
  MediaServerPlugin.java   本地 HTTP 服务：SAF 目录索引、Range 服务、clips/ 子目录、CSV 探测
  MediaTranscodePlugin.java ffmpeg-kit 转码 + 编解码器诊断
  ExtractPlugin.java       解压
  DebugLogPlugin.java      真机日志回传

assets_src/                角色资产源（动画库 GLB，merge 脚本输入）
tools/asset/               角色 GLB 合并 / 贴图压缩 / GLB 检查
tools/dev/staticsrv.cjs    本地静态服务（headless 测试用）
tools/ci/                  CI 轮询、artifact 下载、APK 解包与校验
tests/                     headless（Edge + CDP）回归与验收探针 —— 见 tests/README.md
spike/glb-load-test/       F0 技术验证页（GLB + 泼溅同场景）+ 仓库唯一泼溅资产 splat.ply
prototype/                 网页交互原型（定稿后再移植 APK）

docs/                      项目文档（下面有索引）
DOCK.md                    停靠组 UI 架构与真机事故红线
```

---

## 3. 文档索引

| 文档 | 内容 | 什么时候看 |
|---|---|---|
| **README.md**（本文） | 新人入口、双仓库、快速开始 | 第一天 |
| **docs/HANDOVER.md** | **交接与当前状态**：仓库关系、开发/测试流程、未完成项、真机环境 | **接手第一份读这个** |
| **docs/RELEASE.md** | 构建与发版手册、逐版本变更史（v1→v71） | 出包前 / 查「某功能哪个版本加的」 |
| **docs/BACKLOG.md** | 真机 Bug 与优化清单、老板原始描述、处理状态 | 接手待办前 |
| **docs/KNOWN-ISSUES.md** | 未解决/已解决疑难问题（ISS-001 缩略图、ISS-003 10bit） | 遇到怪问题时先查 |
| **docs/DIRECTOR.md** | 导演台架构 / API / 资产流水线 / 版本史（54KB，最全） | 改导演台 |
| **docs/PROJECTS.md** | 工程管理：存储布局 / .svproj 格式 / 双页 UI / 脏检查 | 改工程/保存 |
| **docs/PLAN-WEBGL2-BRIDGE.md** | WebGL2 桥可行性调研 + Spike1/2 实测结果 | 改 3D 渲染前必读 |
| **docs/CARDGROUPS-UI.md** | 角色卡库：数据模型 / 图片存储分工 / 导入导出契约 | 改卡组 |
| **docs/IMAGE-MODE.md** | 图片模式：双层画布 / 蒙版分层 / 导出 | 改图片 |
| **docs/CHAR-TAG.md** | 角色打标：遮罩链路 / 导出格式 | 改打标 |
| **docs/SHARE-SPLIT.md** | 导出分卷规则 / 卷名约定 / canSplit 判据 | 改导出 |
| **docs/VIEWPORT-NAV.md** | 视口导航模式（游戏/模型） | 改相机操作 |
| **docs/开发方案及计划.md** | 早期整体方案 | 了解历史背景 |
| **tests/README.md** | 测试分类、必跑清单、测试钩子、写探针约定 | **改任何代码前读一遍** |
| **DOCK.md** | 停靠组 UI 架构 + 真机事故红线 | 改 UI 布局 |

---

## 4. 当前状态（v71，2026-11-16）

### 已交付并验证

| 模块 | 状态 |
|---|---|
| 工程管理（新建/保存/重开/删除/分组） | ✅ 稳定 |
| 图片模式（双层画布、蒙版分层、导入导出） | ✅ 稳定 |
| 角色卡（多套全局卡组、原图 IDB、ZIP/JSON 导入导出） | ✅ 稳定 |
| 角色打标（遮罩绘制、ComfyUI 格式导出） | ✅ 稳定 |
| 视频工作台（分镜 CSV、多帧点、clips/ 自动加载） | ✅ v71 修完 |
| 音频工作台 | ✅ 可用 |
| 导演台（人偶/道具/机位/游标/变换） | ✅ WebGPU 设备完整可用 |
| **WebGL2 兜底（M6 等无 WebGPU 设备）** | ✅ v71 起可摆人偶、拖动整层、选点放游标（能力有取舍，见下） |

### 已知限制 / 未完成

| 项 | 说明 | 详见 |
|---|---|---|
| **10bit H.264 视频打不开** | M6 硬件解码器不支持 High10；ffmpeg-kit LGPL 包无 libx264，软件编码这条路不存在。v71 已加诊断，**方案待老板拍板** | `KNOWN-ISSUES.md` ISS-003 |
| **WebGL2 下缺部分编辑能力** | 颜色匹配 / 直方图 / 按值筛选（全依赖 compute）—— 取舍见 PLAN 文档 §5 | `PLAN-WEBGL2-BRIDGE.md` |
| **画笔刷选（footprint select）** | WebGL2 下未实现 | 同上 |
| **引擎仓库改动未提交** | 12 文件 + 1 新文件仍在工作区 | 见本文 §1 |
| 首次进工程缩略图偏慢 | 4K 片段解码慢（体验项） | `KNOWN-ISSUES.md` ISS-002 |
| `KNOWN-ISSUES.md` 部分历史段落乱码 | 早期 PowerShell 重定向写坏，内容可从 RELEASE.md 复原 | — |

### 真机测试机

| 设备 | 关键能力 |
|---|---|
| HUAWEI SCM-AL09（华为 M6，Android 10，Kirin 980，Mali-G76） | WebGL2 ✅ / `navigator.gpu` 存在但 **`requestAdapter()` 返回 null** → 走 WebGL2 桥 |
| 老板其他设备 / 桌面 Edge | 有 WebGPU → 走原生管线 |

> **M6 是主力「难机型」**：所有 3D 兜底逻辑都以它为准。没有 WebGPU 的设备一律按它推演。

---

## 5. 快速开始（详细）

```bash
cd projects/supersplat-apk

# ── 本地验证（headless Edge，脚本自起静态服务）──

# 核心回归 —— 改任何东西都要跑
node tests/director.mjs          # 导演台 16 项
node tests/v13.mjs               # v13 起行为回归 15 项
node tests/project.mjs           # 工程管理 27 项

# 纯逻辑单测（毫秒级）
node tests/charcards.test.cjs    # 角色卡 v2 数据层
node tests/cardgroups.test.cjs   # 卡组存储
node tests/export-chars.test.cjs # 遮罩导出兼容
node tests/img-ops.test.cjs      # 图片图层操作
node tests/groups.test.cjs       # 工程分组
node tests/storyboard.test.cjs   # 分镜 CSV

# 3D / WebGL2 相关（改引擎后必跑）
node tests/probe-v69-webgl2.mjs  # WebGL2 桥验收 11 项
node tests/probe-v71.mjs         # v71 四项修复验收

# 完整清单见 tests/README.md

# ── 改引擎后：构建 + 同步 ──
cd ../supersplat-main && npm run build
# 再按 docs/RELEASE.md §2 同步 dist → www（别手写，用工具）

# ── 角色资产重生成（Windows，需 @gltf-transform + sharp）──
node tools/asset/merge_woman.cjs
node tools/asset/compress_glb.cjs www/static/director/woman.glb 82 1024
node tools/asset/add_webp_ext.cjs www/static/director/woman.glb
```

---

## 6. 接手须知（工程约定）

### 版本号规则

一版一提交，提交信息 `feat(vNN): ...` / `fix(vNNx): ...`。
小修补走 `vNNb`、`vNNc`…；文档单独提交用 `docs(vNN): ...`。

### 提交前必做

1. `node --check <改的每个 .js>`（`www/` 下都是 classic script）
2. 跑 `tests/README.md` 的「现行必跑清单」
3. 改了 `index.html` 引用的文件 → **升 `?v=`**
4. 改了引擎 → 重新 build + 同步 dist

### 不要做的事

- ❌ 手改 `www/index.js`（构建产物）
- ❌ 手改 `www/pc.min.mjs`（PlayCanvas 运行时）
- ❌ 删 `tests/README.md` 里列的**测试钩子**（`window.__cardgroups` 等）—— 那是测试入口
- ❌ 把原图 Base64 塞进 localStorage（必触发 `QuotaExceededError`，原图必须走 IndexedDB）
- ❌ 在 WebGL2 上 `new` compute 相关对象（创建是惰性的、不报错，dispatch 时才炸）

### 真机验证渠道

真机日志用 🐞（`DebugLogPlugin`）取，老板飞书发回。**没有真机就别声称修好了**——
本项目历史上最大的时间浪费全在「桌面全绿、真机全崩」（见 `docs/KNOWN-ISSUES.md` ISS-001 教训）。

---

## 7. 外部依赖

| 依赖 | 用途 | 备注 |
|---|---|---|
| PlayCanvas 2.23.0 | 3D 引擎运行时 | `www/pc.min.mjs` |
| SuperSplat 3.5.2 | 编辑器源码基线 | `../supersplat-main` |
| Capacitor 7 | Android 容器 | `@capacitor/*` ^7.6.9 |
| fflate | zip 读写 | `www/fflate.js` |
| ffmpeg-kit-video 6.0.LTS | 视频转码 | ⚠️ LGPL 变体，**无 libx264** |
| Edge（开发机） | headless 测试 | 路径写死在测试脚本里 |

---

发版流程见 `docs/RELEASE.md`；测试见 `tests/README.md`；导演台细节见 `docs/DIRECTOR.md`。
