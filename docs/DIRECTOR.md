# 导演台模块（Director Console）— 移动端架构与开发手册

> 版本：v28c（2026-10-19） · 维护者：全栈工程师
> 代码：`supersplat-main/src/director.ts`（85.8KB / 2198 行）· 面板 UI：`supersplat-apk/www/dock.js`
> 关联：`DOCK.md`（停靠组 UI）· `docs/PROJECTS.md`（工程存档与恢复）· `docs/RELEASE.md`（构建发版）· `../splat-viewer/docs/MOBILE_DIRECTOR_CONSOLE_PLAN.md`（移植路线）

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
| `selectPuppet(p)` / `selectPuppetById(id)` | `'ok' \| 'locked'` | 选中；`id` 传 null 表示取消选中（v24） |
| `selectAtScreen(sx, sy)` | — | 屏幕坐标选中（人偶优先，其次泼溅） |
| `setPuppetVisible(id, v)` | — | 显隐 |
| `setPuppetLocked(id, v)` | `'ok' \| 'none'` | **v24**：禁止选中（点不中、直接选也拒绝）；锁当前选中对象会先取消选中 |
| `listPuppets()` | 数组 | 场景面板人偶列表（含 `locked`） |

### 2.2 手势武装（点击放置）

武装后下一次点击落到场景，然后自动解除。再点一次同一按钮 = 取消。

| 方法 | 说明 |
|---|---|
| `armPlacePuppet()` | 下一次点击摆放人偶 |
| `armPlaceCursor()` | 下一次点击移动 3D 游标 |
| `armSelect()` | 保留接口；v13 起**平点即选中**，已不需要武装 |
| `moveSelectedToCursor()` | `'ok' \| 'no-selection' \| 'no-cursor'`，走 undo |
| `copySelectedToCursor()` | **v30**：复制选中到游标（同上返回值），走 undo |
| `disarm()` | 手动解除 |

### 2.3 动作与染色

| 方法 | 说明 |
|---|---|
| `listClips()` | 当前角色的动作列表 |
| `setClip(i, target?)` | 切换动作并**冻结在首帧**（不自动播） |
| `play(target?)` / `pause(target?)` | 播放控制 |
| `playClip(i, target?)` | 切动作并播放 |
| `setTint(tint)` / `setTintById(id, tint)` | 八色 multiply 染色；`tint` 见 `info().tints` |

### 2.4 道具（GLB 导入 / 程序方块）

| 方法 | 说明 |
|---|---|
| `importModel(file)` | `File` → PlayCanvas container，落在 3D 游标，走 undo；**导入后自动选中**（v24） |
| `listProps()` | 道具列表（含 `kind:'glb'\|'box'`、`boxColor`，v30） |
| `selectProp(p)` / `selectPropById(id)` | 选中；`id` 传 null 表示取消选中（v24） |
| `setPropLocked(id, v)` | **v24**：禁止选中（同人偶） |
| `deletePropById(id)` | 删除（走 undo） |

### 2.4a 方块原语（v30/v31，拍板 2026-10-29）

程序生成的占位几何：`Entity` + box render + StandardMaterial，反相外壳描边（front-cull 放大 6%）。**入口在角色下拉的「方块」选项**（v31 老板反馈：方块是和人偶同级的模型数据，不设独立按钮）；选中后颜色下拉换色（固定 8 色板 → diffuse 直改，不吃 multiply 染色）。

| 方法 | 说明 |
|---|---|
| `addBoxAtCursor(colorHex?)` | 在游标处生成方块（走 undo）；默认灰 `#808080`、尺寸≈礼服猫（0.4） |
| `spawnBox(pos, {size,color})` | 内部/恢复工程用 |
| `setBoxColor(id, hex)` | 换 diffuse 色 |
| `copySelectedToCursor()` | **v30 #3**：复制选中对象到游标（人偶继承姿态/动作/颜色，方块继承尺寸/颜色/变换，GLB 复用常驻 template+源字节） |

存盘：`kind:'box'` 只记 size/color/transform，零字节开销（`docs/PROJECTS.md` §3）；快照 version 仍为 1。

### 2.4b 基准点（v25–v27）

基准点就是 SS 的 pivot：gizmo 挂在那里，旋转/缩放绕它进行。三个按钮都在右栏「定位」组，全部走 undo。

| 方法 | 返回 | 说明 |
|---|---|---|
| `anchorPivotToCenter()` | `'ok' \| 'same' \| 'no-selection'` | 移到对象中心。**v27 起为高斯密度中心**（所有高斯点位置均值），不再用包围盒中心 |
| `anchorPivotToCursor()` | 同上 + `'no-cursor'` | 移到 3D 游标；游标未放置时返回 `'no-cursor'` |
| `resetPivot()` | 同上 | 回到对象自身原点（默认基准点），前两个的反向操作（v26） |

人偶/道具走 `EntityAdapter.pivotOffset`（实体局部空间，`PivotAnchorOp` 入历史）；泼溅走原生 `Splat.setLocalFrame` + `SetLocalFrameOp`——两条通道都是「真的改了锚点」，不是只挪 gizmo 显示。

`'same'` 表示基准点已经在该位置，此时不往撤销栈塞空记录。

### 2.5 机位（v20+）与显示范围（v30）

| 方法 | 返回 | 说明 |
|---|---|---|
| `listShots()` | `[{id,name,pos,target,fov}]` | 机位列表 |
| `addShot(name?)` | `Shot` | 记录当前视角为新机位，并在该处生成相机模型 |
| `removeShot(id)` | `'ok' \| 'none'` | 删除机位（连同相机模型） |
| `renameShot(id, name)` | `'ok' \| 'none' \| 'no-name'` | **v32**：机位改名（trim 后最多 50 字），3D 机身同步重建 |
| `relocateShot(id)` | `'ok' \| 'none'` | **v32**：把选中机位的 pos/target/fov 覆写为当前视角，机身跳到新位置 |
| `gotoShot(id)` | `'ok' \| 'none'` | 视口跳到该机位 |
| `renderShot(id, w?, h?)` | `{ok, name, bytes, width, height, dataUrl}` | 从该机位渲染 PNG（默认 1280×720），返回 **data URL** |
| `setClipRange({enabled,near,far})` | `'ok' \| 'no-camera'` | **v30/v31**：手动近/远裁剪；启用后 `camera.ts` 停用自动 fit，钉住两平面。UI 为主交互：双头滑轨（近蓝/远绿）对数映射拖动实时生效，数字输入精调 |
| `getClipRange()` | `{enabled,near,far}` | 读当前裁剪状态（未启用时返回自动值） |
| `resetViewport()` | `'ok'` | **v30 #1**：camera.reset + 基准点归零 + 游标隐藏 + 手动裁剪清除（新建工程的干净默认视口） |

### 2.5b 工程存档（v28）

这四个方法只负责“场景状态 ↔ 普通 JS 对象”的转换，不碰文件系统。存到哪、怎么打包由 `www/projects.js` 决定（见 `docs/PROJECTS.md`）。

| 方法 | 说明 |
|---|---|
| `projectSnapshot()` | 当前场景快照：`{version:1, model, puppets, props, shots, camera, cursor}` |
| `restoreProject(state, files)` | 清空现有场景后按快照重建；返回 `{ok}` 或 `{ok:false, failed:[名字]}`；`version !== 1` 返回 `'bad-version'` |
| `projectModel()` | 主泼溅模型的 `{name, bytes}`（原始字节），无模型返回 `null` |
| `projectPropFiles()` | 道具源字节 `[{path, bytes}]`，路径形如 `props/0.glb` |

两个实现细节：

- **模型字节靠 `sourceBytes` 留存**：导入/加载时把原始字节存在 splat 元素上（`sourceName` / `sourceBytes`），否则存盘时只能拿到解码后的高斯数据，写不回 PLY。
- **恢复不走撤销栈**：`restoreProject` 直接销毁重建，不产生 op。所以“打开工程”不可撤销，脏检查由 UI 层负责（`isDirty`）。

### 2.5c 泼溅行 API（v30/v31，资产列表统一化）

SS 原生 SplatList（PCUI）在移动端样式不统一、删除走英文 showPopup 确认框（老板两张截图的同根因）。v31 起场景页打开期间隐藏原生列表，由 dock.js 注入的统一行接管（人偶/道具/泼溅同款：点行选中、👁 显隐、🗑 直接删除）。

| 方法 | 返回 | 说明 |
|---|---|---|
| `listSplats()` | `[{index,name,visible,selected}]` | 泼溅行数据（index 是渲染时序号，仅在列表刷新周期内稳定） |
| `selectSplatByIndex(i)` | `'ok' \| 'none'` | 选中（fire selection，进 SS 变换/撤销管线） |
| `setSplatVisibleByIndex(i, v)` | `'ok' \| 'none'` | 显隐 |
| `deleteSplatByIndex(i)` | `'ok' \| 'none'` | **直接销毁**（同 SS 场景面板删除语义，不可撤销；scene.elementRemoved 会清 op 历史引用） |



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
7. **拾取走注册表射线，不是屏幕距离**（v27 整理时修正本条）：`tapSelect` 先 `objectAt` → `pickSceneObject`（`scene-objects.ts`：对 `registerPickable` 注册的实体做 AABB 射线求交，人偶用胶囊细化、道具用 `nearestMeshHit` 贴到真实表面），没命中再走 SS 深度拾取 `camera.intersect` 选泼溅。早期版本曾用脚/胸/头三点 `worldToScreen` 距离判定（`SELECT_RADIUS`/`PUPPET_PROBE_Y`），v24 统一拾取后这两个常量已无人引用，v27 删除。
8. **染色 = multiply**：克隆材质后给 `diffuse` 赋值，等价 Blender 的 MULTIPLY 混色节点（`TINT_COLORS` 与 Blender 侧一致）。
9. **灯光要自己加**：SS 场景没有灯。导演台加一盏方向性太阳 + 环境光 `(0.45, 0.45, 0.5)`。
10. **模型被近裁剪切掉**：`scene.ts` 的 `boundContributors` 注册表把新增实体纳入场景包围盒，`camera.ts` 的 `fitClippingPlanes` 用该 AABB 的 8 个角投影算远平面（v16）。新增会改包围盒的实体时**必须注册**。
11. **WGSL 分支条件必须是标量**（v27 踩到）：`select(a, b, cond)` 允许 `vec3<bool>` 按分量挑，但 `if` 只吃标量 bool。写成 `if (finite)`（`finite` 是 `vec3<bool>`）会让**整个 compute pipeline 编译失败**，而且不抛异常——同一 pipeline 里的包围盒计算一起归零，界面只表现为「没反应」。用 `all(finite)` 折叠。教训：GPU 计算失败是静默的，必须用正向断言（"密度中心必须 ≠ 包围盒中心"）才抓得到。
12. **显隐由状态反推时，恢复顺序会咬人**（v27 踩到）：黄点可见性 = `f(capturing)`，抓拍前置 `capturing = true` 再刷新，等于「关掉但没记录原值」。恢复时必须显式存旧值、先 `capturing = false` 再还原并重新刷新，否则拍一次照黄点就永久消失。

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
# 核心回归（改任何东西都要跑）
node tests/director.mjs      # 16 项：API 就绪 / 4 角色 / woman 43 clips / 材质+蒙皮 /
                             # 摆放 / 移动游标可撤销 / 三个下拉预填充 / 底栏四连 / 无渲染循环异常
node tests/v13.mjs           # 15 项：v13 起的行为回归（无选择按钮 / 平点选中 / 道具导入等）

# 按版本存档的验收探针（每个都覆盖当时那一轮的需求，改了相关模块要重跑）
node tests/probe-v22a.mjs    # 机位相机模型尺寸 + 预览层按钮
node tests/probe-v22b.mjs    # 就近隐藏 + 渲染期间全部隐藏
node tests/probe-v23a.mjs    # 顶栏无渲染入口 + 视角立方体常驻
node tests/probe-v23b.mjs    # 视角立方体六个轴与 SS camera.align 的映射
node tests/probe-v24c.mjs    # 导入自动选中 / 平点切换 / 锁对象
node tests/probe-v25.mjs     # 移动到游标带基准点 + 三个基准点按钮
node tests/probe-v26.mjs     # 三种对象都有黄点 + 泼溅基准点 + 重设
node tests/probe-v27.mjs     # 黄点屏幕等比 + 抓拍隐藏 + 黄点跟随基准点 + 密度中心

# 工程存档 + 新功能（v28–v31）
node tests/project.mjs       # 27 项：新建 → 导入 → 摆人偶 → 保存 → 校验内容寻址 → 重开还原 → 脏检查 → 删除
node tests/probe-empty-project.mjs  # 9 项：空工程闭环
node tests/probe-v29-migrate.mjs    # 13 项：legacy zip 流式迁移/去重/重开（v29b）
node tests/probe-v30.mjs     # 24 项：方块/泼溅行/手动裁剪/复制到游标/视口重置
node tests/probe-v31.mjs     # 13 项：方块入下拉/纯图标/原生列表隐藏/滑轨拖动
node tests/probe-v32.mjs     # 13 项：面板重排/改名重定位/透明度滑条
node tests/probe-v33.mjs     # 12 项：按钮加大/测量挪组/二级页半透明/游标相关组/相机组四钮
node tests/probe-v34.mjs     # 10 项：保存返回入菜单栏/顶栏左上/小钮减半/组名游标
node tests/probe-empty-project.mjs  # 9 项：空工程「新建 → 返回 → 再打开」闭环

# 布局量测（会截图，非断言型）
node tests/probe-layout.mjs  # 面板行布局量测 + 截图
node tests/probe-bottom.mjs  # 底栏按钮量测 + 截图
```

脚本自起静态服务（`tools/dev/staticsrv.cjs`）与 Edge，退出前打印 `N/M passed`；探针输出 JSON（含 `pass` 字段）。

> 探针会随设计变化而失效，这属于正常情况。改设计后先看断言是否还在描述新行为，别把「断言过期」当成「功能回归」——v26 探针在 v27 改单黄点模型后就属于这一类。
>
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
| v22 | c6ad615 | 65952f7 | 相机模型改固定世界尺寸、就近隐藏、另存为 + 分享 |
| v23 | — | 87578f6 | 顶栏去掉「渲染」分组按钮；恢复右上角视角立方体 |
| v24 | f385586 | 4c61967 | 导入 GLB 自动选中（gizmo 立刻可见）；变换工具下点击切换选中；场景管理器「禁止选中」锁；人偶实体命名修复；`selectXById(null)` 取消选中 |
| v25 | e0b6d23 | 80edc6f | 「移动到游标」带基准点一起走（一次 undo 全还原）；定位组加两个基准点按钮（外边中心 / 游标点） |
| v26 | 30c1ba5 | cecf13d | GLB 与泼溅也有黄点；泼溅基准点打通原生 `SetLocalFrameOp`；加「重设基准点」按钮 |
| v27 | 109b308 | 2437d99 | 黄点改场景根单体 + 屏幕等比（26px）；抓拍隐藏游标与黄点；黄点改跟随基准点；中心改用高斯密度中心 |
| v28 | 995c18e | e8d8c9d | 工程存档 API：`projectSnapshot` / `restoreProject` / `projectModel` / `projectPropFiles`；导入时留存源字节 |
| v29 | （未随引擎出包） | 9fe1cec | #2 根治：内容寻址存储（project.json + files/<sha1>）、同字节去重、零 base64 读写、旧工程流式迁移 |
| v29b | — | 5cc3efe | 真机 `Missing parent directory` 修复：appendFile 带 recursive、迁移先建档截断残尾 |
| v30 | 8cd29dc | 4ac2df9 | 全局等待进度条；#1 新建重置视口；#3 移动模型分组+`copySelectedToCursor`；#4 泼溅行统一+直接删除；#5 手动裁剪；#6 方块原语（`spawnBox`/`BoxAddOp`） |
| v31 | 8cd29dc（同上） | 02bfdbd | 真机反馈四条：方块入角色下拉（`__box`）、两钮纯图标+组名改「移动」、场景页隐藏 SS 原生泼溅列表（REMOVE SPLAT 弹窗根因）、双头滑轨（对数映射实时生效） |
| v32 | 02b2b7e | PENDING | 相机面板重排（注释贴模式按钮旁）、机位改名/重定位（`renameShot`/`relocateShot`）、悬浮窗半透明 `--sd-alpha` + 设置页滑条（默认 0.6） |
| v33 | —（纯 UI） | bc8a0ac | 反馈五条：四钮加大 3 倍（135px 见方）、测量入定位组、二级页面/弹窗半透明（--sd-alpha）、底栏合并「游标相关」三钮（图文）、框选/回原点入相机组+注释补全 |
| v34 | —（纯 UI） | fd3450c | 反馈四条：保存/返回入顶部菜单停靠栏（sd-pjbtn）、顶栏默认左上角、机位小钮减半（3.75rem）、组名「游标相关」→「游标」。**当前** |

## 9. 已知边界 / 待办

- 动画库只保留 `assets_src/UAL1_Standard.glb` 一份；`spike/glb-load-test/index.html` 按 `../../assets_src/UAL1_Standard.glb` 加载。
- 人偶数量上限、LOD/降采样未做（真机帧率待大场景实测，见移植计划 §5）。
- 属性面板（坐标/缩放数值输入）仍用 SS 变换工具，未做移动端专用面板。
- 分镜序列（机位排序 + 转场播放）为 F2 阶段，未开始。
- 真实大场景（1–3M splats）遮挡与帧率复验未做。
- 测量结果在退出测量工具后仍保留（是否改为退出即清空，待产品确认）。
- **密度中心是纯位置均值**，不做不透明度加权、不做离群点截断。扫描类场景若带大量背景噪点，中心会被噪点拉偏；真机遇到再考虑加权重或分位数截断。
- **黄点屏幕尺寸固定，不看遮挡**：被模型挡住时不会变暗或透视显示，这是有意的（作为定位锚点必须随时可见）。
