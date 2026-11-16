# HANDOVER — 交接与当前状态

> 用途：**给刚接手的人**（人或 AI）快速搞清「项目在哪、做到哪、怎么改、怎么验」。
> 更新时间：2026-11-16 · 对应版本 v71
> 姊妹文档：`README.md`（入口）、`docs/RELEASE.md`（版本史）、`tests/README.md`（测试）、
> `docs/KNOWN-ISSUES.md`（疑难问题）、`docs/BACKLOG.md`（真机待办）

---

## 1. 一句话说明项目

把 SuperSplat（网页 3D 高斯泼溅编辑器）装进 Capacitor 壳做成 Android APK「摸鱼台」，
在此之上自研了**导演台**（摆人偶/道具/机位出片）和**图片/视频/音频工作台**。

**最大工程特点**：老板的主力测试机是**华为 M6（无 WebGPU adapter，只有 WebGL2）**，
所以整个 3D 部分是「双路」的——有 WebGPU 走原生编辑器管线，没有则走 **WebGL2 桥**。
所有 3D 改动都必须同时考虑这两条路。

---

## 2. 仓库与目录

```
F:\openclawhome\openclaw\fullstack_workspace\
├── projects\
│   ├── supersplat-apk\     ← 主仓库（APK 壳 + www 覆盖层 + 原生 + 测试）
│   │   ├── www\            前端产物与覆盖层（见 README §2 目录表）
│   │   ├── android\        Capacitor Android 工程 + 原生插件
│   │   ├── tests\          回归与验收探针（见 tests/README.md）
│   │   ├── tools\ci\       CI 轮询 / artifact 下载 / APK 校验
│   │   ├── docs\           项目文档
│   │   └── spike\glb-load-test\   F0 验证页 + 唯一泼溅资产 splat.ply
│   └── supersplat-main\    ← 引擎 fork（SuperSplat 源码，本地无 remote）
└── （其他项目目录）
```

### 两个仓库的关系（**最容易踩**）

| | supersplat-apk | supersplat-main |
|---|---|---|
| 内容 | APK 壳、`www/` 覆盖层、原生插件、测试 | SuperSplat 引擎源码（`src/`，含 `director.ts`） |
| 远端 | `github.com/SinigLi/supersplat-apk` | **无 remote**（纯本地） |
| 与 APK 的关系 | 直接打包 | 需 `npm run build` 出 `dist`，再**手动同步**到 `www/` |

> ⚠️ **引擎仓库当前有未提交的改动**（WebGL2 桥）：12 个修改文件 + 新增 `src/webgl-splat-renderer.ts`，
> 约 +499/-45 行。这些改动**已构建并同步进 `www/index.js`**（APK 有桥），但引擎仓库的 Git 历史
> 还停在 `v48e`。这是**唯一一处「已发布但未提交」**的地方，接手后建议先把它提交掉。

---

## 3. 当前开发状态（v71）

### 3.1 功能完成度

| 模块 | 状态 | 备注 |
|---|---|---|
| 工程管理 | ✅ 完成 | 新建/保存/重开/删除/分组/Folder 迁移 |
| 图片模式 | ✅ 完成 | 双层画布、蒙版分层、缩放平移、导出 |
| 角色卡库 | ✅ 完成 | 多套全局卡组、原图 IndexedDB、ZIP/JSON 导入导出 |
| 角色打标 | ✅ 完成 | 遮罩绘制、ComfyUI 极性导出、marks.v3 |
| 视频工作台 | ✅ 完成 | 分镜 CSV、多帧点、clips/ 自动加载、缩略图 |
| 音频工作台 | ✅ 完成 | — |
| 解压中心 | ✅ 完成 | 分卷合并 |
| 导演台（WebGPU） | ✅ 完成 | 人偶/道具/机位/游标/变换/快照 |
| 导演台（WebGL2 桥） | ⚠️ 大部分 | 见下「能力取舍」 |
| 3D 只读查看器 | ✅ 完成 | WebGPU 不可用时看 3D（v67 方案 B） |

### 3.2 WebGL2 下的能力取舍（**重要**）

没有 WebGPU 的设备（=M6），3D 走桥。**能用的**：显示泼溅、摆人偶/道具、拖动整层、
选中/锁定/删除 gaussian、选点放游标、网格坐标轴、导出 splat。
**不能用的**（依赖 compute，WebGL2 无等价物）：

| 能力 | 状态 |
|---|---|
| 颜色匹配 / 直方图 / 按值筛选 | ❌ 建议禁用 |
| 画笔刷选（footprint select） | ⚠️ 未实现 |

详见 `docs/PLAN-WEBGL2-BRIDGE.md` §5。

### 3.3 未完成 / 待办

| 优先级 | 事项 | 位置 |
|---|---|---|
| 🔴 高 | **10bit H.264 视频打不开** —— 方案待老板拍板（三条备选见文档） | `docs/KNOWN-ISSUES.md` ISS-003 |
| 🟡 中 | 引擎仓库桥改动未提交 | 本文件 §2 |
| 🟡 中 | `docs/KNOWN-ISSUES.md` 部分历史段落乱码（早期 PowerShell 写坏） | — |
| 🟢 低 | 首次进工程缩略图偏慢（体验项） | `KNOWN-ISSUES.md` ISS-002 |
| 🟢 低 | WebGL2 网格为固定跨度线框（无无限延伸/屏幕空间抗锯齿） | `docs/BACKLOG.md` B-2026-11-15-2 |

**待老板确认的 v71 遗留**：
- 转码诊断（长按视频工作台顶栏 🔧）实机结果 —— 决定 10bit 走哪条路。
- WebGL2 网格线是否够用（当前是固定跨度线框，没有无限延伸）。

---

## 4. 开发流程（每天怎么干）

```
1. 改代码
   ├─ www/*.js     → 直接改（注意：改完升 index.html 里的 ?v=）
   ├─ 引擎相关     → 改 ../supersplat-main/src/*.ts，然后 npm run build + 同步 dist
   └─ 原生插件     → 改 android/.../java/...

2. 语法检查
   node --check www/<改的文件>.js

3. 跑回归（见 tests/README.md「现行必跑清单」）
   node tests/director.mjs && node tests/v13.mjs && node tests/project.mjs

4. 提交
   git add -A && git commit -m "feat(vNN): ..."
   git push origin main          ← 走 GitHub REST API（直连 git push 在本机失败）

5. 出包（见 docs/RELEASE.md §4）
   CI 构建 → 下载 artifact → 校验 → 打 zip → 发飞书

6. 真机验证
   老板装 APK 试 → 有问题用 🐞 取日志发回 → 开下个版本
```

### 提交信息规范

`feat(vNN): 摘要` / `fix(vNNx): 摘要` / `docs(vNN): 摘要` / `refactor(vNNx): 摘要`

---

## 5. 测试体系

### 三层

| 层 | 形式 | 特点 | 何时跑 |
|---|---|---|---|
| 纯逻辑单测 | `*.test.cjs` | Node 直跑，毫秒级 | 改对应模块 |
| 端到端回归 | `director.mjs` / `v13.mjs` / `project.mjs` | headless Edge，覆盖面广 | **改任何东西** |
| 版本验收探针 | `probe-vXX.*` / `vXX-dom.mjs` | 断言源码契约或真实 DOM | 改到相关模块 |

### 铁律（都是真机事故换来的）

1. **桌面绿 ≠ 真机过**。headless Edge 全绿也可能真机崩——
   `recursive:true` 缺失、canvas 跨源污染、10bit 解码，全都是桌面测不出来、真机才暴露。
   **改完必须真机验一轮才能说「修好了」。**
2. **断言要结构化，不要全文关键字匹配**。v49 事故：注释里出现的字样把全绿代码判失败。
3. **DOM 冒烟走真实入口**（点按钮 / `importFile` / 导出按钮），别直接调内部函数。
4. **探针只加不改**；语义被有意反转才就地更新并注明原因。
5. **一次性排查脚本用完移进 `tests/archive/`**。

### 测试钩子（`window.__xxx`）

生产代码里挂了一批全局对象供测试用（`window.__director`、`window.__cardgroups` 等），
**不是产品功能，别删**。完整清单和用途见 `tests/README.md`。

---

## 6. 真机环境

| 设备 | Android | GPU | WebGPU | 路径 |
|---|---|---|---|---|
| **HUAWEI SCM-AL09**（华为 M6） | 10 | Mali-G76 | ❌ `requestAdapter()`→null | **WebGL2 桥** |
| 老板其他设备 | — | — | ✅ | 原生管线 |

### M6 的关键事实（决策依据）

- WebGL2 完全正常（`maxTextureSize=8192`），Chrome/WebView 114
- `navigator.gpu` **存在**但 `requestAdapter()` 返回 null —— 不能只看 `navigator.gpu`
- WebGL2 设备**没有** `createBufferImpl` / `getCommandEncoder` → StorageBuffer 无解
- `new Shader({cshader: WGSL})` **创建不报错**，dispatch 才炸 → 不能靠「创建时抛错」兜底

### 取真机日志

App 内 🐞 按钮（`DebugLogPlugin`）导出日志 → 老板飞书发回。
启动崩溃时 `boot-diag.js` 自动弹面板，可「📋 复制全部」。

---

## 7. 交付渠道

| 渠道 | 方式 |
|---|---|
| 飞书 | `F:\openclawhome\openclaw\fullstack_workspace\tools\feishu_send.py`（在工作区根，不在本仓库）；**APK 不能直接发**，必须包进外层 `.zip`；>30MB 自动分卷 |
| GitHub | REST API（blob→tree→commit→ref）；直连 `git push` 在本机失败 |

**发版产物**：`supersplat-vNN.7z`（约 24MB），内含 APK。

---

## 8. 环境与工具链

| 项 | 版本/路径 |
|---|---|
| Node | v24 |
| Shell | Windows PowerShell（**不是 bash**：`grep`/`&&` 部分不可用，用 PowerShell 原生命令） |
| 浏览器（测试） | Edge `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` |
| 静态服务 | `node tools/dev/staticsrv.cjs` |
| 引擎构建 | `cd ../supersplat-main && npm run build`（rollup + typescript） |
| Git 身份 | `SinigLi <sinig@163.com>` |

---

## 9. 文档地图（想找什么看哪里）

| 我想… | 看 |
|---|---|
| 快速跑起来 | `README.md` §5 |
| 查某功能哪个版本加的 | `docs/RELEASE.md` §5 版本历史 |
| 查某个 bug 修没修 | `docs/BACKLOG.md` + `docs/KNOWN-ISSUES.md` |
| 改导演台 | `docs/DIRECTOR.md`（54KB，最全） |
| 改 3D 渲染 / WebGL2 | `docs/PLAN-WEBGL2-BRIDGE.md` |
| 改工程保存 | `docs/PROJECTS.md` |
| 改角色卡 / 打标 | `docs/CARDGROUPS-UI.md` / `docs/CHAR-TAG.md` |
| 改图片模式 | `docs/IMAGE-MODE.md` |
| 改导出分卷 | `docs/SHARE-SPLIT.md` |
| 改停靠 UI | `DOCK.md` |
| 跑测试 / 写探针 | `tests/README.md` |
| 出包 | `docs/RELEASE.md` |
