# 导演台模块（Director Console）— 移动端架构与开发手册

> 版本：v22（2026-10-18） · 维护者：全栈工程师
> 代码：`supersplat-main/src/director.ts`（56KB / 1563 行）· 面板 UI：`supersplat-apk/www/dock.js`
> 关联：`docs/DOCK.md`（停靠组 UI）· `docs/RELEASE.md`（构建发版）· `../splat-viewer/docs/MOBILE_DIRECTOR_CONSOLE_PLAN.md`（移植路线）

## 1. 它是什么

把 Blender 导演台的「人偶摆放 / 动作切换 / 3D 游标 / 染色 / 机位」搬进 SuperSplat 编辑器（PlayCanvas）。

核心设计：**人偶是场景一等公民**。每个人偶和道具都包一层 Splat 形状的适配器（`PuppetAdapter` / `PropAdapter`），于是 SS 自带的变换 gizmo、pivot 管线、撤销/重做（`EntityTransformOp`）直接作用于它们，**SS 工具代码零改动**。

```
UI（www/dock.js 面板）
   │  命令（window.__director.xxx()）
   ▼
Director 实例 ── 人偶 / 道具 / 游标 / 机位 / 灯光
   │
   └── 'director-state' DOM CustomEvent（info() 快照）
                    │
                    ▼  面板监听后刷新下拉与文案
```

面板只发命令、只读快照，不解析 GLB。加载/动画/材质全在 `director.ts`。

## 2. 对外 API（`window.__director`）

启动时 `registerDirector()` 把实例挂到 `window.__director`，另挂两个诊断钩子：

| 全局 | 说明 |
|---|---|
| `window.__director` | Director 实例 |
| `window.__directorInfo()` | `info()` 快照，调试用 |
| `window.__pickables()` | 当前拾取注册表（诊断） |

### 2.1 角色与人偶

| 方法 | 返回 | 说明 |
|---|---|---|
| `listCharacters()` | `[{id,name,loaded}]` | 角色库 |
| `switchCharacter(id)` | `'ok' \| 'loading' \| 'unknown'` | 切换后续摆放用的角色；未加载则异步加载 |
| `addPuppet()` | `Puppet \| null \| 'loading'` | 在 3D 游标处摆放（走 undo） |
| `spawnPuppet(pos, charId?, name?)` | `Puppet \| null` | 指定位置摆放（内部/测试用） |
| `deleteSelected()` | `'ok' \| 'none'` | 删除选中对象（走 undo） |
| `deletePuppetById(id)` | `'ok' \| 'none'` | 按 id 删除（走 undo） |
| `selectPuppet(p)` / `selectPuppetById(id)` | — | 选中 |
| `selectAtScreen(sx, sy)` | — | 屏幕坐标选中（人偶优先，其次泼溅） |
| `setPuppetVisible(id, v)` | — | 显隐 |
| `listPuppets()` | 数组 | 场景面板人偶列表 |

### 2.2 手势武装（点击放置）

武装后下一次点击落到场景，然后自动解除。再点一次同一按钮 = 取消。

| 方法 | 说明 |
|---|---|
| `armPlacePuppet()` | 下一次点击摆放人偶 |
| `armPlaceCursor()` | 下一次点击移动 3D 游标 |
| `armSelect()` | 保留接口；v13 起**平点即选中**，已不需要武装 |
| `moveSelectedToCursor()` | `'ok' \| 'no-selection' \| 'no-cursor'`，走 undo |
| `disarm()` | 手动解除 |

### 2.3 动作与染色

| 方法 | 说明 |
|---|---|
| `listClips()` | 当前角色的动作列表 |
| `setClip(i, target?)` | 切换动作并**冻结在首帧**（不自动播） |
| `play(target?)` / `pause(target?)` | 播放控制 |
| `playClip(i, target?)` | 切动作并播放 |
| `setTint(tint)` / `setTintById(id, tint)` | 八色 multiply 染色；`tint` 见 `info().tints` |

### 2.4 道具（GLB 导入）

| 方法 | 说明 |
|---|---|
| `importModel(file)` | `File` → PlayCanvas container，落在 3D 游标，走 undo |
| `listProps()` | 道具列表 |
| `selectProp(p)` / `selectPropById(id)` | 选中 |
| `deletePropById(id)` | 删除（走 undo） |

### 2.5 机位（v20+）

| 方法 | 返回 | 说明 |
|---|---|---|
| `listShots()` | `[{id,name,pos,target,fov}]` | 机位列表 |
| `addShot(name?)` | `Shot` | 记录当前视角为新机位，并在该处生成相机模型 |
| `removeShot(id)` | `'ok' \| 'none'` | 删除机位（连同相机模型） |
| `gotoShot(id)` | `'ok' \| 'none'` | 视口跳到该机位 |
| `renderShot(id, w?, h?)` | `{ok, name, bytes, width, height, dataUrl}` | 从该机位渲染 PNG（默认 1280×720），返回 **data URL** |

### 2.6 状态快照

| 方法 | 说明 |
|---|---|
| `info()` | 当前角色/选中/游标/模式/角色库/调色板 快照 |
| `notify(what)`（私有） | 变更后派发 `director-state` |

每次变更：`document.dispatchEvent(new CustomEvent('director-state', { detail: { what, info } }))`。

## 3. 关键实现点（踩过的坑）

1. **适配器必须齐全 SS 读的字段**：`projected-splat-renderer` 每帧读 `selectedSplat.instances.numSelected`。适配器缺 `instances` 会让渲染循环每秒抛 60 次错 → 选中人偶时黑屏、泼溅不可选（v10 事故 5efbe3b）。`localBound` 在首帧/隐藏实体上可能没有 `aabb`，必须 null-guard（v12）。
2. **GLB 实例化不带动画组件**：`container.resource.instantiateRenderEntity()` 后要手动 `addComponent('anim', { rootBone: ent })`，再 `anim.assignAnimation(state, track, 'Base')`。
3. **AnimTrack 在 `.resource`**，不在 `.data`；传错类型 `assignAnimation` **静默返回**（不报错但骨骼不动）。
4. **动作切换要停住**：`anim.speed = 0` + `baseLayer.play(state)` + `activeStateCurrentTime = 0`，冻结在首帧。
5. **点击手势在捕获阶段吞掉**：武装模式下 `pointerdown/up` 用 capture 且 `stopPropagation`；位移 > 8px 或 > 600ms 视为拖动，保持武装（`TAP_MAX_MS=600`、`TAP_MAX_DIST=8`）。
6. **落点吸附优先级**（v17 起）：① 场景对象网格（`nearestMeshHit` 逐 meshInstance 做 AABB 射线求交）→ ② SS 深度拾取（泼溅表面）→ ③ y=0 地面 → ④ 射线平行地面时退化到视平面。
7. **屏幕空间选人偶**：脚/胸/头三点 `worldToScreen` 距离判定（`SELECT_RADIUS=0.15`，探测高度 `[0.15, 1.0, 1.6]`），没命中人偶再走泼溅拾取。
8. **染色 = multiply**：克隆材质后给 `diffuse` 赋值，等价 Blender 的 MULTIPLY 混色节点（`TINT_COLORS` 与 Blender 侧一致）。
9. **灯光要自己加**：SS 场景没有灯。导演台加一盏方向性太阳 + 环境光 `(0.45, 0.45, 0.5)`。
10. **模型被近裁剪切掉**：`scene.ts` 的 `boundContributors` 注册表把新增实体纳入场景包围盒，`camera.ts` 的 `fitClippingPlanes` 用该 AABB 的 8 个角投影算远平面（v16）。新增会改包围盒的实体时**必须注册**。

## 4. 机位与相机模型（v20–v22）

### 4.1 为什么存解析后的位姿

SS 的相机是个带缓动的轨道机位，`sceneRadius` 会随导入模型变化而漂移。所以机位存**解析后的真实位姿**（eye / target / fov），恢复时走 `setPose`，由引擎反推 azim/elev/distance。早期若存轨道参数，导入模型后跳转就会偏。

### 4.2 相机模型尺寸（v22 修正）

v21 沿用 3D 游标的「恒定屏幕像素」做法，结果相机模型看起来像贴在屏幕上的 HUD 图标，和其他角色不成一体。v22 改为**固定世界尺寸**：

```ts
const SHOT_MARKER_SCALE = 1.4;   // 世界单位，与猫狗人偶同量级
```

每帧不再重算缩放。表现和普通物体一致：近大远小。

### 4.3 就近隐藏

相机模型正好站在机位的眼睛位置，点「查看」会把视口塞进机身内部。规则：

```ts
// 距离 < SHOT_MARKER_SCALE * 0.62 就隐藏该 marker（同第一人称游戏隐藏自己身体）
```

渲染照片期间用 `capturing` 标志接管可见性，避免每帧的就近规则把「渲染时全部隐藏」覆盖回来。

### 4.4 渲染照片

`renderShot()` 流程：`gotoShot` → 等 150ms 让相机落位 → 隐藏所有相机模型 → `events.invoke('render.offscreen', w, h)` → `encodePng` → base64（0x8000 分块，避免 `String.fromCharCode` 爆栈）→ `finally` 恢复可见性。

返回 **data URL 而不是触发下载**：Android WebView 会静默忽略 `<a download>`，长按自定义浮层上的 `<img>` 也不会弹系统保存菜单（v21 真机反馈已确认）。保存由 APK 外壳的原生插件负责，见 §5。

## 5. 照片输出（原生桥）

`director.ts` 只负责产出 PNG；写到哪由 APK 壳的原生插件处理：

`android/app/src/main/java/com/sinigli/supersplat/SaveImagePlugin.java`

| 方法 | 行为 |
|---|---|
| `save` | MediaStore 直接写入 `Pictures/SuperSplat`。Android 10+ 免权限；9 及以下按需申请 `WRITE_EXTERNAL_STORAGE` |
| `saveAs` | `ACTION_CREATE_DOCUMENT` 系统文件选择器，用户自选目录，结果经 `@ActivityCallback` 回传 |
| `share` | 写 `cacheDir/shared` → FileProvider URI → `ACTION_SEND` 系统分享面板 |

三个方法都接收 `{ data: <dataURL>, filename }`。取消另存为时 reject `"cancelled"`，UI 显示「已取消」而不是报错。

**为什么不让 WebView 做**：`<a download>` 被静默忽略、长按不出系统菜单——两条路在真机上都验证过不行。

## 6. 角色资产流水线

角色 GLB 放在 `www/static/director/`，由 `tools/asset/` 从上游资产合成：

```
game_artist_workspace/tools/3D-models/blender-addon/
  characters/Superhero_Female_FullBody.gltf (+bin+png)   ← 网格/骨骼/贴图
  characters/Superhero_Male_FullBody.gltf
  pose-library/UAL1/UAL1_Standard.glb                    ← 43 clips / 65 关节
        │
        ├─ 拷贝到 assets_src/UAL1_Standard.glb（本仓库留档）
        │
        ▼  tools/asset/merge_woman.cjs / merge_male.cjs
   mergeDocuments → 通道重定向到目标骨骼 → 丢掉动画库自带人偶 → prune
        ▼
   www/static/director/woman.glb / male.glb
        ▼  compress_glb.cjs（逐贴图转 WebP，quality 82 / 长边 1024）
        ▼  add_webp_ext.cjs（补 EXT_texture_webp 声明，PlayCanvas 才认）
```

- 骨骼必须**同名同序**（脚本会校验，不匹配直接 FATAL 退出）。
- `shiba.glb` / `tuxedo.glb` 为宠物角色，直接来自 pose-library，未走合并；缩放 0.225 / 0.19（v20 减半）。
- 落地体积：woman 7,679,400 B · male 7,621,552 B · shiba 1,694,584 B · tuxedo 602,496 B。`tools/ci/verify_v14.cjs` 会核对这四个数。
- 新增角色：改 `director.ts` 的 `CHARACTERS` 数组（id/name/url/scale）+ 资产入 `www/static/director/`，面板下拉自动出现。

## 7. 测试

headless Edge（WebGPU / ANGLE）+ CDP，390×844：

```bash
node tests/director.mjs      # 16 项：API 就绪 / 4 角色 / woman 43 clips / 材质+蒙皮 /
                             # 摆放 / 移动游标可撤销 / 三个下拉预填充 / 底栏五连 / 无渲染循环异常
node tests/v13.mjs           # 15 项：v13 起的行为回归（无选择按钮 / 平点选中 / 道具导入等）
node tests/probe-v22a.mjs    # 机位相机模型尺寸 + 预览层按钮
node tests/probe-v22b.mjs    # 就近隐藏 + 渲染期间全部隐藏
node tests/probe-layout.mjs  # 面板行布局量测 + 截图
node tests/probe-bottom.mjs  # 底栏按钮量测 + 截图
```

脚本自起静态服务（`tools/dev/staticsrv.cjs`）与 Edge，退出前打印 `N/M passed`。

> 历史探针（v13–v21 的一次性验证脚本）已在 v22 整理时归档删除；需要复现某版问题时从 git 历史取回。

## 8. 版本史

| 版本 | 引擎 commit | APK commit | 内容 |
|---|---|---|---|
| v9 | — | 0972824 | 编辑器内导演台：人偶 + 43 clips + 点击放置 + 3D 游标 + 灯光 |
| v9b/v9c | — | 7a3a5d5 / f993704 | 多人偶管理；Blender 式游标（球+十字+环）、三级吸附、屏幕空间选中 |
| v10 | e487e1f | 5a7a01c | 人偶接入 SS 选择/变换/撤销管线（Splat 适配器） |
| — | 5efbe3b | 3dbfe0e | 修选中人偶时渲染循环崩溃（`instances` 桩） |
| v11 | c33ca16 | d95fa5a | 摆放即冻结在默认动作首帧；底栏五连 |
| v12 | a26ff26 | 849f0c8 | 四角色、游标处生成、切动作冻结、八色染色、WebP 贴图 |
| v12b | 7007591 | a0b4c07 | 真女性角色 woman.glb；移动到游标；面板分行重排 |
| v13 | b7146d2 | bae4f35 | 统一场景对象拾取、人偶/道具可测量、平点选中、GLB 道具导入 |
| v14 | 136a41a | 6e18096 | 测量工具锁死修复、跨模型测量、统一导入入口 |
| v15 | — | 783c9cb | 变换按钮失效修复、导入不再按 accept 过滤 |
| v16 | 338da79 | 394402e | 模型被近裁剪切掉（包围盒注册表）、工具让位不再自锁 |
| v17 | 8bda450 | eb598d0 | 游标/测量打不到真实表面、移动游标压平到 y=0 |
| v18 | dc551fa | 498adfb | 合并 GLB 的三角形精测、游标改恒定像素 |
| v19 | 06c08c8 | ed5f0a6 | 设置面板重开、人偶按真实光标高度生成、游标减半 |
| v20 | e693a4e | cd777e9 | 机位列表（新增/移除/查看/渲染）、猫狗缩放减半 |
| v21 | 721cdbb | 5873c4c + 013bcdd | 每个机位生成相机模型、渲染时隐藏相机、原生存相册 |
| v22 | c6ad615 | 65952f7 | 相机模型改固定世界尺寸、就近隐藏、另存为 + 分享。**当前** |

## 9. 已知边界 / 待办

- 动画库只保留 `assets_src/UAL1_Standard.glb` 一份；`spike/glb-load-test/index.html` 按 `../../assets_src/UAL1_Standard.glb` 加载。
- 人偶数量上限、LOD/降采样未做（真机帧率待大场景实测，见移植计划 §5）。
- 属性面板（坐标/缩放数值输入）仍用 SS 变换工具，未做移动端专用面板。
- 分镜序列（机位排序 + 转场播放）为 F2 阶段，未开始。
- 真实大场景（1–3M splats）遮挡与帧率复验未做。
- 测量结果在退出测量工具后仍保留（是否改为退出即清空，待产品确认）。
