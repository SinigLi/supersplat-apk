# tests/ — 回归与验收探针

全部脚本都在**仓库根目录**执行（`cd projects/supersplat-apk`），因为静态服务根 = 当前工作目录：

```bash
cd projects/supersplat-apk
node tests/<脚本>
```

浏览器类脚本自己起 `tools/dev/staticsrv.cjs` + headless Edge（CDP），跑完自动退出；端口与 CDP 端口按脚本写死，**不要并行跑多个**（端口会撞）。

## 分类

| 类别 | 命名 | 说明 | 什么时候跑 |
|---|---|---|---|
| 纯逻辑单测 | `*.test.cjs` | Node 直跑，不起浏览器，毫秒级 | 改对应模块必跑 |
| 引擎/工程回归 | `director.mjs` `v13.mjs` `project.mjs` | 端到端，覆盖面最广 | 改任何东西都跑 |
| 版本验收探针 | `probe-vXX.cjs` | 静态断言（源码契约），快，适合定位回归 | 改到相关模块时 |
| 版本验收探针（浏览器） | `probe-vXX.mjs` | 真跑页面 + 断言 DOM/渲染 | 改到相关模块时 |
| DOM 冒烟 | `vXX-dom.mjs` | 走真实 UI 链路（点按钮、走 importFile、走导出） | 改交互/导入导出必跑 |
| 一次性诊断 | `archive/` | 排查历史 bug 用，不保证还能跑 | 一般不跑，查历史时参考 |

## 现行必跑清单（提交前）

```bash
# 纯逻辑
node tests/charcards.test.cjs        # 33 项 · 角色卡 v2 数据层
node tests/cardgroups.test.cjs       # 19 项 · 多套卡组存储
node tests/export-chars.test.cjs     # 23 项 · 遮罩导出兼容
node tests/img-ops.test.cjs          # 图片图层操作
node tests/groups.test.cjs           # 工程分组
node tests/storyboard.test.cjs       # 分镜 CSV

# 端到端
node tests/director.mjs              # 16 项
node tests/v13.mjs                   # 15 项
node tests/project.mjs               # 27 项

# 3D / WebGL2（改引擎或导演台必跑）
node tests/probe-v69-webgl2.mjs      # 11 项 · WebGL2 桥：启动/泼溅/排序/导演台
node tests/probe-v71.mjs             # 20 项 · v71：pickSplat/网格坐标轴/转码诊断/clips
```

> ⚠️ **浏览器类脚本不要并行跑**：端口/CDP 端口写死在脚本里，会撞。
> 它们自己起 `tools/dev/staticsrv.cjs` + headless Edge，需要 Edge 已安装。
> `probe-vXX.mjs`（ESM）走 `tests/lib/net-reclaim.mjs` 抢占端口后启动；`probe-vXX.cjs` 端口写死。

## 版本探针索引（按版本倒序）

| 探针 | 项数 | 覆盖 |
|---|---|---|
| `probe-v69-webgl2.mjs` | 11 | **WebGL2 桥**：无 adapter 下启动、泼溅建 GSplatInstance、worldLayer 归属、CPU 排序、样本数据 nan=0、人偶/整层变换 |
| `probe-v71.mjs` | 20 | **v71 四项**：桥层 pickSplat 命中点、drawLine 计数、转码诊断方法、clips/ 布局 hasClips |
| `probe-v69.cjs` | 47 | marks 字段改名双向、旧组名迁移与并集、normalize 丢返回值、原生父目录探测、上一级自动打点 |
| `probe-v68.cjs` | 55 | 场景工作台（摆放+写回）、10bit 探测/转码接线、返回页队列清理、viewer3d 工具 |
| `probe-v67.cjs` | 41 | 3D 只读查看器（方案 B）：viewer.html 接线、spz wasm 转 PLY、projects-ui 路由到查看器 |
| `probe-v66.cjs` | 42 | 三维能力闸门三场景：WebGPU 正常 / adapter null / 无 navigator.gpu |
| `probe-v65.cjs` | 34 | 启动诊断层：boot-diag 首位加载、纯 ES5、startup-error 面板、复制全部 |
| `probe-v64.cjs` | 50 | 分卷阈值 500/450MB + canSplit 三态 |
| `probe-v63.cjs` | 37 | 分卷机制与卷名规则 |
| `probe-v62.cjs` / `v62-dom.mjs` | 27 + 22 | — |
| `probe-v61a..f.cjs` | 各 3–13 | 卡组导入/内嵌头像/内嵌原图/借图读 IDB |
| `probe-v60b..j` / `v60e..j-dom` | 各 5–12 | 打标工作台排布、删除按钮、okbar 定位 |
| `probe-v53b..v53y` | 各 1–5 | 角色打标 M1–M5：卡片 CRUD、char_ref、目标帧、抽帧、遮罩导出 |
| `probe-v49.cjs` | — | 整车回归（禁止全文关键字匹配的由来，见「写新探针的约定」第 1 条） |
| `probe-vXX.mjs`（v22a–v28b） | 各 4–16 | 导演台历代：机位模型、黄点、密度中心、停靠区避让 |
| `probe-navmode.cjs` | — | 视口导航模式（游戏/模型） |
| `probe-empty-project.mjs` | — | 空工程「新建→返回→再打开」闭环 |
| `probe-v30..v45` | 各 8–16 | 各版本 UI/交互验收 |

> 完整清单以 `tests/` 目录为准；上表只列有明确定位意义的部分。

## 卡组 / 导入导出相关（改动这些必跑）

```bash
node tests/probe-v58.cjs         # 卡组引用 + 导出目录结构
node tests/probe-v59-impl.cjs    # v59 实装结构
node tests/probe-v59k.cjs        # 图片文件夹导入契约
node tests/probe-v60c.cjs        # 原图保留 + 停靠栏
node tests/probe-v60d.cjs        # 原图 IDB 契约
node tests/probe-v61b.cjs        # 进度浮层 + 导图回查
node tests/probe-v61c.cjs        # ZIP 魔数 / 子目录 / accept
node tests/probe-v61d.cjs        # 内嵌头像
node tests/probe-v61e.cjs        # 内嵌原图
node tests/probe-v61f.cjs        # 全量内嵌 + 借图读 IDB   ← 现行

node tests/v61b-dom.mjs          # 进度浮层 + zip 往返 10 项
node tests/v61c-dom.mjs          # 无后缀 ZIP 5 项
node tests/v61d-dom.mjs          # 只导 JSON 回头像 3 项
node tests/v61e-dom.mjs          # 只导 JSON 回头像+原图 5 项
node tests/v61f-dom.mjs          # 真机链路复现 8 项         ← 现行
```

## 生产代码里的测试钩子

以下全局对象是为了让 headless 测试能走内部链路而挂上去的，**不是产品功能**，改相关模块时别顺手删：

| 钩子 | 位置 | 用途 |
|---|---|---|
| `window.__cardgroups` | cardgroups-ui.js | 打开卡组 sheet |
| `window.__cardgroupsTest.importForTest(data, imgMap)` | cardgroups-ui.js | 绕过 file input 直接走 `applyImport`（v61f 起返回 Promise） |
| `window.__cardgroupsTest.mergeFulls(data, fulls)` | cardgroups-ui.js | 导出前合并 IDB 原图 |
| `window.CC` / `window.CCG` / `window.CGFull` | charcards.js / cardgroups.js / cardgroups-full.js | 数据层与存储层 |
| `window.__MOYUTAI_DEBUG_LOGS` | cardgroups-ui.js | 卡组导入诊断日志环形缓冲（v61c 起） |
| `window.__projectLogic` | projects.js | 工程存储纯逻辑（新建/保存/读取） |
| `window.__projects` / `window.__projectsToast` | projects-ui.js | 工程列表页入口 / toast 探针 |
| `window.__groups` | groups.js | 工程分组逻辑 |
| `window.__extract` | extract.js | 解压中心 |
| `window.__img` / `window.__imgLogic` / `window.__imgOps` | img-ui.js / img-ops.js | 图片模式 UI / 逻辑 / 图层算子 |
| `window.__av` / `window.__avLogic` | av-ui.js | 视频工作台 UI / 逻辑 |
| `window.__charcards` / `window.__storyboard` | av-ui.js | 卡组与分镜 CSV 的挂载点 |
| `window.__director` | dock.js / projects-ui.js | 导演台主对象（摆人偶/加道具/相机/快照） |
| `window.__renderPuppetList` | dock.js | 强制重绘人偶列表 |
| `window.__engineGate` / `window.__NO_3D` | engine-gate.js / projects-ui.js | 引擎闸门状态 / 无 3D 标记 |
| `window.__NAV_HOOK` | projects-ui.js | 视口导航模式钩子（navmode 探针） |
| `window.__MOYUTAI_RELEASE` | projects-ui.js | 版本号标记（探针核对当前版本） |
| `window.__v3` | viewer3d.js | 独立 3D 查看器入口（v67 方案 B） |

新增钩子请在对应文件的注释里写一句用途，并在本表补一行。

## 写新探针的约定

1. **断言要结构化**，不要全文关键字匹配（注释里出现同样的字会把全绿代码判失败，v49 事故）。
2. **`check(name, cond)` 计数**，末尾打印 `N/M === ALL PASS ===` 或 `=== FAIL ===`，失败 `exit 1`。
3. DOM 冒烟要**走真实入口**（点按钮 / 走 `importFile` / 走导出按钮），别直接调内部函数——内部函数过了、UI 断了才是真机翻车的主因。
4. 新版本探针**只加不改**：旧探针若语义被新版本有意反转，就地更新并在注释写明原因（见 `probe-v61e.cjs` 头）。
5. 一次性排查脚本用完请移到 `archive/`，并在 `archive/README.md` 补一行。
