# 图片模式 v2：遮罩分层 + 可复用编辑器（v50 开发计划）

> 版本：v1.1（2026-11-07，M1 已实现）· 维护者：全栈工程师
> 状态：**M1 已实现（单测 37 项 + 探针 46 条全绿），M2–M5 待做** · 前置：IMAGE-MODE.md v1.3
> 需求提出：老板 2026-11-07 11:30，两条决策同日 11:42 锁定

## 0. 老板原话需求（5 条）与已锁定决策

| # | 需求 | 决策/澄清 |
|---|---|---|
| 1 | 遮罩分层：层列表按钮 → 悬浮层列表（显示开关 + 名称），单击名称激活层；顶部 添加/删除/重命名；全部支持撤销 | 删除层需确认；每层名称唯一 |
| 2 | 重新加载图片（导入后 currently 无法换图） | **换图弹窗三选一：保留笔画 / 清空笔画 / 取消**（老板 2026-11-07 12:58 确认） |
| 3 | 工具分组栏支持 3D 导演台式拖拽停靠；屏幕不够时滚动 | 对齐 dock.js 交互 |
| 4 | 撤销/重做移到左侧停靠栏上方，独立分组 | 与 #3 同批 |
| 5 | 分享时选输出模式：默认=整图 alpha 挖除 PNG；**遮罩分层=原图 + 原图_alpha + 每层 `原图_遮罩名.png` 打包 zip** | **隐藏的层不导出** |

复用性要求：图片编辑器后续要被**视频工程**以弹窗方式复用（编辑完返回结果），核心逻辑必须与工程系统解耦。

## 1. 架构

### 1.1 分层拆分（M5，功能稳定后执行）

```
www/img-core.js   编辑器本体：canvas 双层渲染、图层模型、op/撤销、工具、导出
                  对外：ImgCore.mount(container, opts) → { export(), setTool(), getLayers(), destroy() }
                  不 import 工程/localStorage；持久化走 opts 钩子（getSnapshot/loadSnapshot）
www/img-page.js   全页壳：工程读写（img-store）、顶栏/返回、meta 同步
www/img-ops.js    纯逻辑：op 生成/应用/求逆（可 node 单测，UMD 兼容）
```

顺序理由：**先功能后拆分**。probe 先把 v49 行为锁住，分层功能全部绿了再做纯重构（拆分不改变任何行为，probe 复跑即验收）。若先拆再改，回归面翻倍。

### 1.2 数据模型：schema `moyutai.imgmask.v2`

```js
// localStorage img-<name>-strokes（键名不变，值升级）
{
  schema: 'moyutai.imgmask.v2',
  layers: [
    { id: 'L1', name: '遮罩 1', visible: true, strokes: [ {type,size,points}, ... ] },
    ...
  ],
  activeId: 'L1'          // 激活层（会话内恢复）
}
```

- **v1 迁移**：`migrateV1({schema:'v1', strokes:[...]}) → v2 单层「遮罩 1」`，纯函数、可单测；打开工程时自动迁移并落盘
- 撤销栈**只在会话内**（与 v49 一致）：持久化存 layers 全量，undo 存内存 op

### 1.3 撤销模型：op + 求逆（`img-ops.js`）

v49 的撤销是「strokes 数组 pop/push」，分层后操作类型变多（笔画/加层/删层/改名/显隐），统一成 op：

| op | do | undo（求逆） |
|---|---|---|
| `stroke` | 层尾追加笔画 | 弹出该层尾笔画 |
| `addLayer` | 指定位次插入新层 | 摘除该层 |
| `delLayer` | 摘除层（记录 index+层对象） | 原位插回 |
| `renameLayer` | 改名（记录旧名） | 改回旧名 |
| `toggleVisible` | 翻转显隐（记录旧值） | 恢复旧值 |

`applyOp(state, op)` / `invertOp(op)` 为**纯函数**，node 单测覆盖每种 op 的 do/undo/redo 往返。层内 erase 语义 = 只擦本层（图层软件惯例），整图补回用关层显隐或反选实现——文档明示，老板验收时确认。

## 2. 渲染与导出

### 2.1 预览（drawMaskInto v2）

自底向上合成：每层先在**独立离屏 canvas** 上画（strokes source-over / erase destination-out），再把可见层依次 `source-over` 贴到蒙版层。v49b 的「笔画 alpha=1、整层 CSS opacity .82」原则不变（opacity 放在蒙版层元素上）。

### 2.2 导出（弹窗二选一）

| 模式 | 产物 |
|---|---|
| 默认 | 整图 PNG，可见层合成蒙版 → `destination-out` 挖除（= v49 行为） |
| 遮罩分层 | zip（fflate，已在依赖内）：`<名>.png`（干净原图）+ `<名>_alpha.png`（默认模式产物）+ 每个可见层 `<名>_<层名>.png`（白笔黑底不透明遮罩图） |

- 层名做文件名消毒（`[\\/:*?"<>|]` → `_`，重名追加序号）——纯函数可单测
- zip 走 `SaveImagePlugin.shareFile`（文件路径版）；若真机该接口只收图片，备选 `share` + dataURL（M3 实施时验证，二选一在门禁里锁定）
- 隐藏层不参与任何导出产物（老板 2026-11-07 12:58 确认不导出）

## 3. 工具栏停靠（M4）

- 每个分组（绘制/橡皮/撤销重做/层列表）可长按拖动，松手吸附四边（上下左右），边缘碰撞钳制
- 撤销/重做独立小组，默认落**左侧上方**
- 屏幕放不下：同侧多组自动堆叠 + 面板内滚动（`.sd-sub-wrap` 同款 max-height + overflow）
- 拖拽实现对齐 dock.js 的 pointer 事件模式；不做中途半透明预览以外的动画

## 4. 换图（M2）

- 空态「导入图片」旁加「重新加载」；有图时空态按钮收进顶栏溢出菜单（或长按标题，实施时定，probe 断言入口存在即可）
- 走现有 file input（无 accept + 魔数校验）
- 已有笔画时弹三选：保留笔画（坐标仍为原图像素系，新图尺寸不同则按比例缩放坐标）/ 清空笔画（一次性 op，可撤销）/ 取消
  - **保留笔画的坐标映射**：笔画存的是原图像素坐标，换图后图片尺寸变了坐标就错位。三选一里的「保留」仅当新图与旧图尺寸相同才有意义；尺寸不同时把「保留」置灰并提示。实施时按此实现。

## 5. 测试策略

| 层 | 方式 | 覆盖 |
|---|---|---|
| `img-ops.js` / `img-store.js` 迁移 | **node 单测**（`tests/img-ops.test.cjs`，UMD shim 加载，不进浏览器） | 5 种 op 的 do/undo/redo 往返、v1→v2 迁移、文件名消毒与重名、可见层过滤 |
| UI 交互 | headless Edge + CDP（probe-v50.cjs，真实 pointer 事件） | 层列表开合/激活/增删改、显隐对预览与导出的像素级断言、换图三选一、分享模式弹窗、zip 产物字节 |
| 回归 | probe-v49（v2 后改造或保留 v49 快照路径）、导演台 16、AV 48 | 不回退 |

## 6. 里程碑

| 里程碑 | 内容 | 验收 | 状态 |
|---|---|---|---|
| M1 图层核心 | img-ops.js + img-store v2 + 迁移 + 层列表 UI + op 化撤销 | node 单测全绿 + probe 层断言 | ✅ `234da5a` img-ops 37/37、probe-v49 46/46 |
| M2 换图 | 顶栏「🔄 换图」（有图才显示）+ 确认弹窗：确定=保留笔画 / 取消=放弃；清空走既有 🗑（可撤销） | probe 驱动真实 pickImage：有笔画必弹确认、取消不落盘、meta 不变 | ✅ probe-v49 **49/49** |
| M3 导出模式 | 分享弹窗 + zip 分层导出（fflate level0 + 分块 base64）+ shareFile(mime=application/zip) | probe 捕获 shareFile 解 zip：5 文件齐全、隐藏层二次导出验证不出现 | ✅ probe-v49 **58/58** |
| M4 停靠 | 拖拽吸附四边 + 左侧撤销条 + 纵向滚动 | probe 拖拽吸附/持久化/恢复 + 手感真机确认 | ✅ probe-v49 **63/63**；setupDockDrag 曾漏接线，探针抓出后接进 build() |
| M5 拆分 | img-core/img-page（纯重构） | probe 全绿不变 | 排队 |
| M6 交付 | 门禁升级（v50 断言入 verify_v49 或新 verify_v50）、CI、真机、飞书 | 全绿 + 老板确认 | 排队 |

### M3 实施记录（2026-11-07）

- **探针抓出真机级 bug**：`btoa(String.fromCharCode.apply(null, zipped))` 在 zip >64KB 时抛 RangeError（apply 参数上限 ~65535），600×400 三层工程正好越线；错误被按钮 catch 成 toast，「分享没反应」。修复为 8KB 分块编码，大小无上限。教训：**大 Uint8Array 转 base64 禁止 apply 全量展开**。
- zip 结构：`<工程名>.png`（干净原图）+ `<工程名>_alpha.png`（挖除图）+ `<工程名>_<层名>.png` ×可见层；fflate `zipSync level 0`（PNG 本身已压缩）。
- MIME 走 `application/zip`（SaveImagePlugin.shareFile 的白名单校验内）；插件不存在时降级 dataURL share。
- 「隐藏层不导出」的验证方式：临时建层→隐藏→二次导出→断言 zip 无该层且其余 5 文件仍在（比检查被删又撤销恢复的天空层更直接）。

### M2 实施记录（与原计划的差异）

原计划「三选一弹窗：保留/清空/取消」实施时简化为**两选 confirm**（确定保留 / 取消放弃），清空引导到既有 🗑 按钮（本来就是按层、可撤销的 op）。理由：清空混进换图弹窗会引入「三按钮 confirm + 三个回调」的自绘对话框工作量，而 🗑 已完整覆盖清空语义且可撤销——一个交互只做一个决定。真机反馈不顺手再升级回三按钮。
