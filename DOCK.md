# 移动端分组工具栏（Dock）架构文档

> 版本：v22（2026-10-18） · 维护者：全栈工程师 · 上游：SuperSplat 3.5.2 fork
> `www/dock.js` 50.9KB / 1065 行 · `www/dock.css` 17.7KB / 245 行
> 相关：`docs/DIRECTOR.md`（导演台）· `docs/RELEASE.md`（构建发版）· `README.md`（仓库总览）

## 1. 它是什么

SuperSplat APK（Capacitor 壳）的移动端 UI 改造层。**不修改 SS 源码**，纯外挂：

| 文件 | 作用 |
|---|---|
| `www/dock.js` | 建三停靠组、收养 SS 按钮、子面板定位、拖动吸附、全屏层接管、导演台/机位面板 |
| `www/dock.css` | dock 样式、全屏层规则、手势防护 |
| `www/mobile.css` / `www/mobile.js` | `body.mobile-mode` 标记等小补充 |

核心思路：**把 SuperSplat 现有按钮 DOM（含事件）重挂进 dock**——功能零重写，只管布局与手势。SS 升级后按钮 id 变了只需改 `GROUPS` / `DOCKS` / `MENU_ORDER` 配置。

## 2. 启动流程

```
waitUI()  轮询等 #bottom-toolbar 与 #right-toolbar 出现（200ms × 300 次上限）
  ↓
注入 <style>#bottom-toolbar,#right-toolbar{display:none!important}</style>   藏掉 SS 原生条
  ↓
buildDock() × 3          建三个停靠组
  ↓
hideMenuBar()            隐藏 SS 顶部菜单栏（.menu-panel 已被收养进菜单组）
  ↓
watchDialogs()           全屏层装饰 + 内联样式钳位
  ↓
body.sd-docks-ready      回归脚本等的就是这个标记
  ↓
bindToolWatch()          工具让位监听（失败则 500ms × 60 次轮询兜底）
```

## 3. 三个停靠组

均可拖动换边吸附、收缩成球（球上带分组名）。

| 组（`DOCKS`） | 位置 | 模式 | 内容 |
|---|---|---|---|
| `file` 菜单 | 顶 | `menuOptions` | 撤销 ↶ / 重做 ↷ / 渲染 🎬；SS 的 `.menu-panel` 被整体搬进子面板 |
| `edit` 工具 | 底 | `dirBar` | **游标 / 移动到游标 / 变换 / 导演台** 四连 + 变换二级面板 |
| `view` 视图 | 右 | `viewOptions` | 相机（机位面板）/ 设置 / 定位 三组 + 测量 📐 |

### 3.1 右侧三组展开后的内容

| 组 | 收养的 SS 按钮 id | 说明 |
|---|---|---|
| 相机 🎥 | `right-toolbar-orbit-mode`、`right-toolbar-fly-mode` | 面板主体是**机位列表**（新增/移除/查看/渲染），两个模式按钮被塞进面板底部一行（轨道=绕目标转，飞行=第一人称） |
| 设置 ⚙️ | `right-toolbar-appearance`、`right-toolbar-overlays`、`right-toolbar-settings` | 外观 / 浮层 / 设置，三者都是全屏层 |
| 定位 🎯 | `right-toolbar-frame-selection`、`right-toolbar-camera-origin` | 框选 / 回原点 |

### 3.2 底栏四连

| 按钮 | 行为 |
|---|---|
| 🎯 游标 | 武装放置 3D 游标；再点取消 |
| 🧲 移动到游标 | 把选中的人偶/道具移到游标（走 undo） |
| 🔢 变换 | 展开 move/rotate/scale 三工具；再点收起 |
| 🎬 导演台 | 展开导演台面板（角色、动作、染色、道具、删除、场景入口） |

> v13 起**去掉**了「选择」按钮：直接平点画布即可选中人偶/道具/泼溅。

### 3.3 `GROUPS` 配置

```js
const GROUPS = {
  select:  { ids:['bottom-toolbar-selection-mode', '...-footprint', '...-picker',
                  '...-brush', '...-polygon', '...-eyedropper', '...-sphere-brush'] },
  xform:   { ids:['bottom-toolbar-move', 'bottom-toolbar-rotate', 'bottom-toolbar-scale'] },
  shape:   { ids:['bottom-toolbar-sphere', 'bottom-toolbar-box'] },
  measure: { ids:['bottom-toolbar-measure'] },
  file:    { ids:[] },   // 菜单代理
  view:    { ids:['right-toolbar-appearance', '...-overlays', '...-orbit-mode',
                  '...-fly-mode', '...-frame-selection', '...-camera-origin', '...-settings'] },
};
```

## 4. 全屏层

z-index 统一 **1300**（压过 dock 的 1000）。

| 元素 | 打开方式 | 处理 |
|---|---|---|
| `#dialog`、`[id$="-dialog"]` | SS 菜单行 | 全屏列表风 + 左上角返回钮；`scene-panel` 除外 |
| `#scene-panel`（资产列表） | 导演台面板里的场景按钮（`data-role="scene-toggle"`） | `sd-sheet-header` + 打开时强制全屏 + 人偶列表注入 |
| `#appearance-panel` | SS 原按钮 | 头部 + MutationObserver 钳位 |
| `#overlays-panel` | SS 原按钮 | 同上 |
| `#settings-panel` | SS 原按钮 | 同上（v6.5 加入） |

## 5. ⚠ 维护红线（历次真机事故，改前必读）

1. **`.pcui-hidden` 优先级**：给 PCUI 组件写 `display:flex` 必须同时加 `.pcui-hidden { display:none !important }` 兜底。→ v6.1 启动鬼影弹窗（发布/图像/视频弹窗隐身占屏，压没顶栏）
2. **`100%` 不是 `100vw/vh`**：全屏规则用 `100%`，z-index 统一 1300。→ v6.2 场景面板右侧漏缝（100vw 含滚动条差）+ 层叠被 dock 压住
3. **SS 内联锚定要钳位**：SS 打开外观/浮层/设置时会用 JS 写内联 `top`，优先级高于 CSS `inset:0`，必须用 MutationObserver 监听 style 变化强制钳位回原点。→ v6.3 面板 `top:-376`，只剩底部两行
4. **动态按钮用 `data-role` 定位**：不能按文本匹配。→ v6.4 返回后高亮不灭
5. **关面板必须走 SS 事件**：v19 之前的返回钮直接改 DOM，导致 SS 内部 `this.hidden` 仍为 false，下次点工具栏只是把内部状态改成隐藏——界面毫无反应，表现为「面板只能打开一次」。现在发 `scene.events.fire('<name>Panel.setVisible', false)`，并在 observer 里清掉我们自己留下的内联 `display:none`（否则 computed 恒为 none，钳位永不执行，面板再也打不开）。
6. **名单外面板**：SS 随时可能插入新面板。某面板显示异常，先查它是否在 `watchDialogs()` 名单外。每加一个面板 = `watchDialogs()` 数组 + dock.css 三处选择器同步加。
7. **桌面 headless 正常 ≠ 真机正常**：内联样式竞态、100vw 差异只在真机暴露。每个弹窗/面板必须真机过一遍启动态 + 打开态。

## 6. 工具让位（`sd-tool-yield`）

某些 SS 工具（测量、框选、涂抹）自带底部工具条，会与我们的底栏重叠。`bindToolWatch()` 监听 `tool.activated` / `tool.deactivated` / `tool.deactivate`，给 `body` 加 `sd-tool-yield` 隐藏底栏。

**关键判定（v16 修复）**：只在**真的存在可见 `.select-toolbar`** 时才让位。

```js
const hasBottomToolbar = () => [...document.querySelectorAll('.select-toolbar')].some((el) => {
  if (el.closest('.sd-sub-wrap')) return false;   // 我们自己的浮层不算
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden' && el.offsetParent !== null;
});
```

移动/旋转/缩放是纯 gizmo 工具，本来没有底部工具条。早期对它们也让位，于是底栏一消失、「变换」按钮又在底栏里——**再也点不回来**。工具条是异步显示/隐藏的，所以还要 `requestAnimationFrame` 套两层再算一次。

## 7. 开发与验证

```bash
# headless + CDP，仓库根执行（自带静态服务与 Edge）
node tests/director.mjs        # 导演台 16 项回归
node tests/v13.mjs             # v13 起行为回归 15 项
node tests/probe-layout.mjs    # 390x844 面板布局量测 + 截图
node tests/probe-bottom.mjs    # 底栏按钮量测 + 截图

# 手动看页面（另开终端）
node tools/dev/staticsrv.cjs . 4225
# 浏览器开 http://127.0.0.1:4225/www/index.html
```

启动页检查项：可见弹窗数 = 0；顶栏/底栏/右栏在位；每个面板查 rect 是否全屏。

原型页（交互定稿用）：`prototype/mobile-ui-v7.html` → https://sinigli.github.io/supersplat-apk/prototype/mobile-ui-v7.html
流程：网页原型迭代定稿 → 一次性移植 APK → 真机只做验证，不在 APK 里试错。

## 8. 版本史（真机验证节点）

| 版本 | commit | 内容 |
|---|---|---|
| v6.1 | f2eb9a5 | 修启动鬼影弹窗（pcui-hidden 兜底） |
| v6.2 | 1c04269 | 场景面板全屏内联修正 100% / z1300，开面板隐藏 dock |
| v6.3 | cf83335 | 外观/浮层面板钳位 + 返回头（top:-376 修复） |
| v6.4 | e070ea4 | 场景按钮返回熄灭（data-role 定位）+ 手势防护 |
| v6.5 | 7bc58d3 | 设置面板加入全屏名单 |
| v11 | d95fa5a | 撤销/重做移到顶栏、测量进右栏、底栏五连 |
| v13 | bae4f35 | 底栏去掉「选择」（平点选中）、工具让位、统一导入入口 |
| v16 | 394402e | 工具让位不再对 gizmo 工具生效（自锁死修复） |
| v19 | ed5f0a6 | 面板返回钮改走 SS 事件（重开修复） |
| v20–v22 | cd777e9…65952f7 | 相机组变机位面板、机位相机模型、预览层保存/另存为/分享 |

## 9. 已知边界 / 待办

- SS 上游升级时：核对 `GROUPS` / `DOCKS` / `MENU_ORDER` 里的按钮 id 与菜单顺序。
- 全屏名单目前 4 类：dialog 系列 / scene / appearance+overlays / settings。新增入口面板照红线⑥加。
- 网页原型 v7 与 APP 交互已基本对齐；后续 UI 迭代先改原型页定稿。
- `MENU_ORDER` 仍按 SS 原有顺序索引 `.menu-panel`，若上游增删菜单项需同步。
