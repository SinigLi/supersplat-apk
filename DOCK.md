# SuperSplit APK — 移动端分组工具栏（Dock）架构文档

> 版本：v6.5（2026-10-17 定版） · 维护者：全栈工程师 · 上游 fork：SuperSplat 编辑器
> 导演台（人偶/动作/游标/染色）见 `docs/DIRECTOR.md`；仓库总览见 `README.md`

## 1. 它是什么

SuperSplat APK（Capacitor 壳）的移动端 UI 改造层。**不修改 SS 源码**，纯外挂三个文件：

| 文件 | 作用 |
|---|---|
| `www/dock.js`（~23KB） | 建三停靠组、收养 SS 按钮、子面板定位、拖动吸附、全屏层接管 |
| `www/dock.css`（~11KB） | dock 样式、全屏层规则、手势防护 |
| `www/mobile.css` / `mobile.js` | 移动模式标记等小补充（`body.mobile-mode`） |

核心思路：**把 SuperSplat 现有按钮 DOM（含事件）重挂进 dock** —— 功能零重写，只管布局与手势。SS 升级后按钮 id 变了只需改 `GROUPS`/`DOCKS` 配置。

## 2. 运行结构

```
启动流程：waitUI() 等 #bottom-toolbar/#right-toolbar 装配 → buildDock()×3 → hideMenuBar() → watchDialogs() → body.sd-docks-ready
```

**三个停靠组**（均可拖动换边吸附、收缩成球）：

| 组 | 位置 | 内容 |
|---|---|---|
| 菜单组 | 顶 | 文件/编辑/选择/渲染/帮助（收养 SS `#menu` 下的 .menu-panel）+ 场景（开 #scene-panel） |
| 编辑组 | 底 | 选择(6工具)/变换/裁剪/测量 二级面板 + 撤销/重做 |
| 视图组 | 右 | 相机(轨道/飞行)/显示(外观/浮层)/定位(框选/回原点/设置) |

**全屏层（z-index 1300，压过 dock 的 1000）**：

| 元素 | 打开方式 | 处理 |
|---|---|---|
| `#dialog` / `[id$="-dialog"]`（发布/图像/视频/导出等） | SS 菜单行 | v6 全屏列表风 + 绝对定位返回钮（`addCloseBtn`） |
| `#scene-panel` 场景管理器 | 顶栏「场景」按钮（`data-role=scene-toggle`） | sd-sheet-header + 打开时 JS 内联强制全屏 |
| `#appearance-panel` / `#overlays-panel` / `#settings-panel` | SS 原按钮 | sd-sheet-header + MutationObserver 钳位（见红线③） |

## 3. ⚠ 维护红线（历次真机事故，改前必读）

1. **`.pcui-hidden` 优先级**：给 PCUI 组件写 `display:flex` 必须同时加 `.pcui-hidden { display:none !important }` 兜底。→ v6.1 启动鬼影弹窗（发布/图像/视频弹窗隐身占屏压没顶栏）
2. **100% 不是 100vw/vh**：全屏规则用 `100%`，z-index 统一 1300。→ v6.2 场景面板右侧漏缝（100vw 含滚动条差）+ 层叠被 dock 压住
3. **SS 内联锚定钳位**：SS 打开外观/浮层/设置面板时会 JS 写内联 `top`，优先级高于 CSS `inset:0`，必须 MutationObserver 监听 style 变化强制钳位回原点。→ v6.3 面板 top:-376 只剩底部两行
4. **动态按钮用 dataset 定位**：场景按钮等动态生成的按钮，关闭逻辑用 `data-role` 标记，不能按文本匹配。→ v6.4 返回后高亮不灭
5. **名单外面板**：SS 原生随时可能插入新面板；某面板显示异常先查它是否在 dock.js 全屏名单外（设置页就是第 4 个被发现的）。每加一个面板 = dock.js `watchDialogs()` 数组 + dock.css 三处选择器同步加
6. **桌面验证局限**：桌面 headless 正常 ≠ 真机正常（内联样式竞态、100vw 差异只在真机暴露）。每个弹窗/面板必须真机过一遍启动态+打开态

## 4. 开发与发版流程

```bash
# 本地验证（headless + CDP，仓库根目录执行）
node tools/dev/staticsrv.cjs www 4192      # 静态服务 :4192（浏览器手动开页面时用）
node tests/probe-layout.mjs                # 390x844 面板布局量测 + 截图
node tests/probe-bottom.mjs                # 底栏按钮量测 + 截图
node tests/director.mjs                    # 导演台 16 项回归 + 截图
# 启动页检查项：可见弹窗数=0 + 顶栏/底栏/右栏在位；每个面板查 rect 是否全屏

# 提交 → CI 自动出包（GitHub Actions）
git push origin main
node tools/ci/ci-poll.cjs <sha>            # 等 CI（workflow 输出 supersplat-debug-apk artifact）

# 下载 artifact（⚠ 网络不稳时分片下载，见 §5）
node tools/ci/dl_artifact.mjs <runId> dist/app-debug.apk   # artifact 大小字段是 size_in_bytes（不是 size）
node tools/ci/verify_apk.cjs dist/app-debug.apk            # 解包校验 + 标记串检查
# 打 zip 发飞书
```

原型页（交互定稿用）：`prototype/mobile-ui-v7.html` → https://sinigli.github.io/supersplat-apk/prototype/mobile-ui-v7.html
流程：网页原型迭代定稿 → 一次性移植 APK → 真机只做验证，不在 APK 里试错。

## 5. 踩坑备忘（环境类）

- **GitHub artifact 下载**：认证头必须 `Bearer <token>`；列表端点 GET 可用但下载 zip 端点偶发 401 时换签名 URL（302 location）直下；网络差用 1MB 分片（Range 请求落盘 `%TEMP%\ss_vX_parts\pN`，跨会话续跑只补缺片）
- **token 掩码坑**：脚本里写 `"***" + token` 是无效头（401），必须读文件拼真实值
- **CDP 合成事件**：`movementX/Y` 恒 0（拖动判定用坐标增量）；`Runtime.evaluate` 不等 Promise（异步要 `awaitPromise:true` 或拆同步步）
- **pages/api curl**：缺 `User-Agent` 头会 401；`-w redirect_url` 部分端点不生效
- **本地静态服务**：`python -m http.server` 本机绑不上端口，用 `tools/dev/staticsrv.cjs`；服务根 = 启动时 cwd，URL 别带子目录前缀

## 6. 版本史（真机验证节点）

| 版本 | commit | 内容 |
|---|---|---|
| v6.1 | f2eb9a5 | 修启动鬼影弹窗（pcui-hidden 兜底） |
| v6.2 | 1c04269 | 场景面板全屏内联修正 100%/z1300，开面板隐藏 dock |
| v6.3 | cf83335 | 外观/浮层面板钳位+返回头（top:-376 修复） |
| v6.4 | e070ea4 | 场景按钮返回熄灭（data-role 定位）+ 手势防护 |
| v6.5 | 7bc58d3 | 设置面板加入全屏名单。**当前定版** |

## 7. 已知边界 / 待办

- SS 上游升级时：核对 `GROUPS`/`DOCKS`/`MENU_ORDER` 里的按钮 id 与菜单顺序
- 全屏名单目前 4 类：dialog 系列 / scene / appearance+overlays / settings；若新增入口面板照红线⑤加
- 网页原型 v7b 与 APP 交互已对齐，后续 UI 迭代先改原型页定稿
