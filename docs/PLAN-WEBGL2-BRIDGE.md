# 3D 场景 WebGL2 桥接可行性（Plan C）调研报告

> 起因：老板 2026-11-15 提出「不能偷偷在后面搭个类似渲染桥把接口引到适配的版本吗？这样就不用重新写一套」。
> 结论先说：**纯 shim 不可行，接口桥非常可行**——后者能复用 86% 的编辑器代码，`viewer3d.js` 可以删掉。
> 本报告只调研，未改任何代码。

## 0. 现状基线

| 项 | 数字 |
|---|---|
| 编辑器源码 `projects/supersplat-main/src` | 158 个 ts 文件 / **39,222 行** |
| 其中与 WebGPU 强耦合 | 31 个文件 / **5,583 行（14%）** |
| 其余（场景图、导演台、相机、编辑命令、时间线、拾取） | 127 个文件 / **33,639 行（86%）** |
| 现在 App 里的 `www/viewer3d.js` | 1,015 行 / 47 KB（**独立实现，与编辑器零共享**） |

WebGPU 专属代码的分布（按行数）：

| 模块 | 行数 | 用了什么 |
|---|---|---|
| `projected-splat-renderer.ts` | 1,210 | StorageBuffer ×30、compute projector、indirect draw |
| `shaders/projected-splat-projector-shader.ts` | 512 | WGSL `@compute` + `atomicAdd` |
| `gaussian-instances.ts` | 465 | 3 个 StorageBuffer（源行 / 标志 / 调色板） |
| `data-processor/intersect.ts` | 397 | compute |
| `shaders/projected-splat-shader.ts` | 337 | WGSL，`var<storage, read>` 读排序索引 |
| 其余 data-processor + shaders | ~2,600 | 全部 WGSL compute |

## 1. 为什么「纯渲染桥 / shim」不可行（决定性事实）

桥的想法是：把 `StorageBuffer` 这类 WebGPU 接口在背后转发到一个 WebGL2 适配层，编辑器源码一行不改。

这条路断在三个硬性能力缺口上，**都不是性能问题，是 API 不存在**：

1. **WebGL2 没有 compute shader。** WebGL2 = GLES 3.0；compute 和 SSBO 都是 GLES 3.1+ 才有。所以
   `@compute @workgroup_size(...)` 不可能被翻译成跑得起来的东西——没有阶段可挂。
2. **WebGL2 没有 StorageBuffer（SSBO）。** 编辑器的 projector shader 直接 `var<storage, read> sortedIndices`、
   `atomicAdd` 累加。WebGL2 只能给 R32UI 纹理，尺寸/带宽/原子语义全都对不上。
3. **WebGL2 没有 indirect draw。** `projected-splat-indirect-args-shader` 用 compute 写 draw args，CPU 不知道要画几个。

所以「让 WGSL 在 WebGL2 上跑」这一层根本不存在，**没有可以偷偷接的适配版本**。这也是 v66 那会儿
`requestAdapter()=null → 回退 WebGL2 device → StorageBuffer 报 createBufferImpl is not a function` 的真因。

## 2. 好消息：耦合面极窄，桥的位置很清楚

把全仓 `scene.projectedSplatRenderer.*` 的访问全部抓出来，**只有 10 个方法**，没有任何属性读取：

```
add / remove / replace / render / renderSortedForPick
preparePick / finishPick / reduceDepth / reportStochasticFrame / footprintIntersect
```

`Splat` 传进去的数据契约也只有 7 个字段：`instances / resource / transformPalette / colorPalette / entity / visible / uid`。

也就是说：**编辑器 86% 的代码只认这 10 个方法**。把这 10 个方法在 WebGL2 上重新实现一遍，
上面那 33.6k 行（含 3,198 行的导演台 `director.ts`、相机、编辑命令、时间线、拾取、变换手柄）**一行都不用改**。

### PlayCanvas 2.23 自己就有 WebGL2 的泼溅渲染路径

引擎里已有两套，都不是我们写的：

| 路径 | WebGL2 支持 | 关键证据 |
|---|---|---|
| 旧版 `gsplat` 组件 | ✅ | `gsplat-instance.js:29` `if (device.isWebGPU) orderBuffer = StorageBuffer else orderTexture = R32U`；排序走 `GSplatSorter` + Web Worker CPU 排序 |
| `gsplat-unified` 四叉渲染 | ✅ 自动降级 | `gsplat-params.js:89` `AUTO → isWebGPU ? GPU_SORT : CPU_SORT`；`:91` 显式请求 GPU_SORT 但设备是 WebGL2 时**强制回落 CPU_SORT** |
| `projected-splat-renderer`（编辑器现用） | ❌ | 全 WGSL compute |

即：**显示泼溅这件事，引擎层面 WebGL2 早就有了**（v67 已验证过：legacy gsplat 在 WebGL2 上跑出 267 帧、像素统计正常）。

## 3. 真正的缺口：per-gaussian 编辑语义，引擎的 WebGL2 路径没有

引擎 WebGL2 路径（`containerPackedRead` 等 GLSL 块）是从**数据流**里读 transform 的，
它没有编辑器需要的东西：

- 实例级 **transform palette**（每个 gaussian 独立变换，用于「选中一块泼溅然后拖动」）
- **color palette**（调色）
- **selection / locked / deleted 标志位**（选中高亮、锁定、删除）

编辑器把这三样都做成了 StorageBuffer。WebGL2 下要换成「per-instance 索引纹理 + 顶点着色器取样」。
这是桥必须自己补的那部分，也是我建议的做法：

> 拿引擎的 GLSL 泼溅着色器打底，往里注入 `uTransformPalette` / `uColorPalette` / `uFlags` 三张纹理，
> 按 `instanceId → sourceRow → paletteIndex` 取值。相当于把引擎 WGSL 里那段取变换改写成纹理取。

顺便：引擎 `gsplatWorkBufferGeometry` 已经在 GLSL 里用 `uWorkBufferTransformA` 纹理做 per-instance 变换了
——说明「纹理当 palette」在 WebGL2 上是引擎自己就在用的手法，不是我们需要发明的东西。

## 4. 桥要补的四件事（含已知的真阻塞点）

| # | 事项 | 规模 | 说明 |
|---|---|---|---|
| 1 | `WebGLSplatRenderer`：实现那 10 个方法 | **~900–1,300 行** | 主体是 GLSL 着色器 + 索引纹理上传 + CPU 排序复用引擎 Worker |
| 2 | `GaussianInstances` 的三个 StorageBuffer 换成 CPU 数组 + flush 上传纹理 | ~80 行 | `sourceRow/flags/palette` **本来就是普通 TypedArray**，只有 3 个 GPU 镜像要改 |
| 3 | `DataProcessor` 在无 WebGPU 时**优雅降级**而不是抛异常 | ~60 行 | 见下面的真阻塞点 |
| 4 | 渲染后处理链的 GLSL 版（blit / underlay / outline） | ~150–250 行 | 现在是 WGSL，`copyRt` 每帧都调 |

### ⚠ 真阻塞点：启动路径依赖一个 compute pass

`splat.ts:404` 的 `updateLocalBounds()` 在 `add()` 里被 `await`，内部调 `dataProcessor.calcBound()` —— **compute**。
如果它抛异常，泼溅根本加不进场景，App 起不来。所以桥**必须**提供一个不依赖 compute 的 `calcBound`：

> CPU 遍历 `numRows` 取 AABB + 密度中心。几百万点在手机上一次约 50–200ms，只在加载时跑一次，可接受。

这是整个方案里唯一的「不补就起不来」的点，也是我判断可行性的关键依据。

## 5. 编辑能力在 WebGL2 下的取舍（必须老板拍板）

桥能保住**摆放/构图**全部能力，但 per-gaussian 编辑里这几项依赖 compute，WebGL2 下没有等价物：

| 能力 | WebGL2 桥下 | 影响 |
|---|---|---|
| 摆放泼溅层 / 人偶 / 道具 / 相机 / 分镜 | ✅ 完整 | 导演台核心，39k 行里的 6k 行纯变换代码，零耦合 |
| 拖动整层泼溅、整体变换 | ✅ | transform palette 走纹理 |
| 选中高亮 / 锁定 / 删除 gaussian | ✅ | flags 走纹理 |
| 画笔刷选（footprint select） | ⚠ 需另做（CPU 或 readback） | `editor.ts:483` `footprintIntersect` |
| 颜色匹配 / 直方图 / 按值筛选 | ❌ 建议禁用 | `colorMatch`/`calcHistogram`/`selectByRange` 全 compute |
| 导出 splat（PLY/SOG） | ✅ | `splat-serialize.ts`，不碰 compute |

## 6. 三个选项

| | 方案 | 新增/改动代码 | 复用率 | 维护量 |
|---|---|---|---|---|
| A | 维持现状（`viewer3d.js` 独立一套） | 已有 1,015 行 | 0% | 编辑器每加一个导演台功能，要手抄一遍 |
| B | **接口桥**（推荐） | ~1,200–1,700 行（多数是着色器） | **86%** | 导演台/相机/编辑命令/时间线自动跟着走 |
| C | 把 14% 全量移植到 WebGL2 | ~5,500 行 | 100% | 每 2 周跟一次上游，且 compute 类功能要另做等价实现 |

**推荐 B。** 理由：工作量与 A 同一量级（B 稍多），但**维护量差一个数量级**——B 之后 `viewer3d.js` 可以删，
`www` 少一套并行实现；未来老板在导演台加功能，PC 和手机自动一致。

## 7. 建议的落地步骤（先做验证性 spike，不改正式代码）

1. **Spike 1（半天）**：在 fork 里加一个最小 `WebGLSplatRenderer` 骨架 + CPU `calcBound`，
   证明「泼溅能在 WebGL2 上经由编辑器自己的 `Scene` 加进来并渲染」。
2. **Spike 2（半天）**：把 palette/flags 三张纹理接进去，
   证明「整层拖动 + 选中高亮」在 WebGL2 下成立。
3. **Spike 3（一天）**：`main.ts` 加 `deviceTypes: ['webgl2']` 兜底，
   跑通「首页 → 打开 3D 工程 → 导演台摆人偶 → 保存」全链，用 `probe-v70` 断言。
4. 通过后再决定是否删 `viewer3d.js`、是否保留画笔刷选。

风险点已列全：起不来的只有 `calcBound`，编辑能力缺失的只有 compute 那 5 个算子。
