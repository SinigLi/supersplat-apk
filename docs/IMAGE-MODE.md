# 图片模式（第四工程模式）开发方案

> 版本：v1.0（2026-11-06）· 维护者：全栈工程师
> 交互原型：`prototype/image-mode-proto.html`（老板 2026-11-06 12:46 确认「就这个样子」）
> 关联：`docs/DIRECTOR.md`（分享链路）、`docs/PROJECTS.md`（工程存储）、`www/projects-ui.js`（模式选择）

## 1. 背景

现有三种工程模式（3D 模型 / 视频 / 音频）。新增第四种：**图片**。

导入一张图片 → 缩放平移查看 → 在画面上画遮罩（涂抹 / 多边形）→ 分享时按遮罩把对应区域 alpha 置 0，导出 PNG。

用途：抠图。画哪里挖哪里。

## 2. 已锁定决策（原型验证 + 老板确认）

| # | 决策项 | 取值 |
|---|---|---|
| 1 | 遮罩语义 | **画 = 挖除**（导出时该区域 alpha=0） |
| 2 | 橡皮作用对象 | **改蒙版**，不改图片像素；笔画顺序携带语义（先画后擦=补回，先擦后画=仍挖） |
| 3 | 笔画宽度 | 画笔 / 橡皮**共用一个值**（抠图修边需要同宽；jspaint 分离式不采用） |
| 4 | 多边形结束 | **双击** 或 **再点一次多边形按钮**，两者都保留（触屏双击易误触缩放） |
| 5 | 缩放/平移 | 单指平移、双指缩放，**固定手感**，不做游戏/建模双模式（图片无 3D 尺度问题） |
| 6 | 图片数量 | **单张**（多张列表不做，见 §8） |
| 7 | 反选 | **保留**（⇄ 按钮，画背景比画主体省事） |
| 8 | 存储形态 | **笔画路径数组**，不存位图（撤销=弹栈；工程文件小） |
| 9 | 框架 | **不引入 fabric.js / Konva**，手写 canvas（理由见 §9） |
| 10 | 撤销粒度 | 一笔 = 一个撤销单元（通用约定） |

## 3. 复用清单（已核实）

| 能力 | 位置 | 用法 |
|---|---|---|
| 分享/保存/另存为 | `SaveImagePlugin` `share`/`save`/`saveAs` | 导出 PNG 走 `share({data, filename})`，与 3D 机位同链路 |
| 工程存储 | `projects.js` `projects/<名>/project.json + files/<sha1>.<ext>` | 图片字节按内容寻址入 files/；笔画数据进 project.json |
| 模式选择 | `projects-ui.js:130` 三选一 | 扩成四选一，默认仍 3D |
| 模式角标 | `projects-ui.js:296` | 加 `图片` 分支 |
| 工程路由 | `projects-ui.js` `modeTxt` 分流 | `image` → 图片工作台 |
| 样式令牌 | `dock.css` `--sd-btn/--sd-alpha/.sd-grp-btn/.sd-sub-wrap` | 工具栏照搬，视觉与 3D 一致 |
| 撤销栈 | 自管（图片工作台独立于引擎 edit-history） | 笔画数组天然适合弹栈 |

**不需要新原生插件**：导入用无 `accept` 属性的 file input（已知约束：accept 会映射 MIME 白名单挡掉非常规扩展），导出走现成 SaveImage。

## 4. 新增模块

| 文件 | 职责 | 规模估计 |
|---|---|---|
| `www/img-store.js` | 图片工程 meta + 笔画持久化（schema `moyutai.imgmask.v1`） | ~150 行 |
| `www/img-ui.js` | 图片工作台：双层 canvas、手势、工具面板、撤销重做、导出 | ~900 行（原型逻辑移植 + 工程接线） |
| `projects.js` | mode `'image'` 注册 + 打开分流 | ~20 行 |
| `projects-ui.js` | 四选一弹窗、角标、路由 | ~40 行 |
| `tests/probe-v49.cjs` | 门禁探针 | ~200 行 |

`av-store.js` **不动**——它只认 video/audio，强行塞 image 会破坏现有校验（`模式无效` 异常在 `av-store.js:31`）。图片走独立的 img-store，避免牵连已稳定的 AV 链路。

## 5. 数据结构

**meta（localStorage `img-<名>-meta`，与 av-store 同风格）**

```json
{
  "version": 1,
  "name": "示例",
  "mode": "image",
  "imageFile": "files/a1b2c3....png",
  "imageW": 1200, "imageH": 900,
  "invert": false
}
```

**笔画（project.json 内嵌或独立文件，随工程 zip 走）**

```json
{
  "schema": "moyutai.imgmask.v1",
  "strokes": [
    { "type": "brush",   "size": 24, "points": [[x,y], ...] },
    { "type": "polygon", "size": 24, "points": [[x,y], ...] },
    { "type": "erase",   "size": 24, "points": [[x,y], ...] }
  ]
}
```

- 坐标一律**原图像素**，与视图变换无关（原型已验证：变换后笔画不错位）
- `invert` 反选只存标志位，渲染/导出时对蒙版整体求反

## 6. 渲染与导出（原型的核心机制，直接移植）

**单一渲染器 `drawMaskInto(ctx, {alpha, rgb, showAids})`**——屏幕预览与导出共用，杜绝两套顺序语义：

```
brush / polygon → source-over      （往蒙版上盖 = 要挖的区域）
erase           → destination-out  （从蒙版抹掉 = 补回）
```

**导出**：蒙版画到离屏 canvas（alpha=1）→ 原图 `destination-out` 蒙版 → `toDataURL('image/png')` → SaveImage 分享。

**双层 canvas**：底层图片只在视图变换时重绘，上层蒙版只在笔画变化时重绘。大图（4000×3000）绘制不卡的关键。

## 7. 里程碑

| 里程碑 | 内容 | 验收 |
|---|---|---|
| **M1 模式接入** | 四选一弹窗、image 角标、路由分流、图片导入（file input → files/<sha1>）、meta 持久化 | 新建图片工程 → 列表出现 → 重进不丢 |
| **M2 工作台** | 双层 canvas、平移缩放手势、移动/绘制/橡皮组、笔画面板、撤销重做、反选 | probe：真实 pointer 事件画/擦/撤销后蒙版像素符合预期 |
| **M3 导出与分享** | drawMaskInto 合成 PNG、SaveImage 分享/保存、工程保存（strokes 落盘）、返回按钮 | 分享出的 PNG 挖除区 alpha=0、保留区 255（CDP 采样断言） |
| **M4 门禁交付** | probe-v49、全量回归、CI、真机验证、飞书 | 全绿 + 老板真机确认 |

预计总量 ~1300 行，一天内可完成 M1–M3，M4 走既有流水线。

## 8. 明确不做（本轮）

- 多张图片列表（同工程多图切换）
- 多边形顶点拖拽编辑
- 画笔/橡皮宽度分离
- 选区、羽化、笔刷形状、透明度调节
- 撤销跨会话合并（按笔画原样存）

## 9. 技术依据（调研结论）

| 项目 | stars | 结论 |
|---|---|---|
| tui.image-editor | 6.7k | mask 模块**只支持上传外部遮罩图，不提供绘制** → 不能直接抄 |
| jspaint | 9.1k | 画笔/橡皮宽度分离（MS Paint 惯例）→ 本场景不采用 |
| IOPaint | 32.9k | 前端遮罩 UI 仅一个组件文件 → 证明手写 canvas 足够 |
| fabric.js / Konva | 31.5k / 14.9k | 对象模型/SVG 解析用不上；项目现有代码零依赖手写，引 300KB 框架破坏一致性 |

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| 大图内存：双层 4000×3000 canvas ≈ 92MB | M2 先按原图跑；真机 OOM 则长边钳到 4096（meta 记录处理尺寸） |
| file input 无 accept 约束 | 与 v44 同方案，选错文件由 img-store 校验魔数（PNG/JPEG/WebP） |
| WebView destination-out 兼容性 | 原型 + CDP 像素采样已在桌面验证；真机 M3 复验 |
| 撤销栈与工程保存时序 | 保存时整体序列化 strokes；undo 只动内存数组 |
