# 导演台模块（Director Console）— 移动端架构与开发手册

> 版本：v28c（2026-10-19） · 维护者：全栈工程师
> 代码：`supersplat-main/src/director.ts`（85.8KB / 2198 行）· 面板 UI：`supersplat-apk/www/dock.js`
> 关联：`DOCK.md`（停靠组 UI）· `docs/PROJECTS.md`（工程存档与恢复）· `docs/RELEASE.md`（构建发版）· `../splat-viewer/docs/MOBILE_DIRECTOR_CONSOLE_PLAN.md`（移植路线）

- v50（982c28b）：图片工作台四项大更新（分层/换图/分享双模式/停靠），导演台本身无改动1. 它是什么

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

### 2.4 道具（GLB 导入）

| 方法 | 说明 |
|---|---|
| `importModel(file)` | `File` → PlayCanvas container，落在 3D 游标，走 undo；**导入后自动选中**（v24） |
| `listProps()` | 道具列表（v35 起纯 GLB，方块也是人偶不再走道具） |
| `selectProp(p)` / `selectPropById(id)` | 选中；`id` 传 null 表示取消选中（v24） |
| `setPropLocked(id, v)` | **v24**：禁止选中（同人偶） |
| `deletePropById(id)` | 删除（走 undo） |

### 2.4a 方块（v35 重构：第五内置角色 box.glb）

**老板拍板 2026-10-31：废弃程序几何，方块改为真 GLB 模型**（`static/director/box.glb`，白底 PBR 立方体，随包内置）。注册为 `CHARACTERS` 第五个内置角色（id `box`，scale 0.4 ≈ 礼服猫体型），**走和人偶完全相同的管线**：PuppetAdapter（黄点选中标记、gizmo、进 SS 变换/撤销）、`setTintById` 八色 multiply 染色、`info()` 选中联动、存档按 `charId` 记录还原、`copySelectedToCursor` 继承位姿/颜色。入口即角色下拉的「方块」选项（选角色→摆放）。

旧版程序方块的兼容：旧工程存档里 `kind:'box'` 的道具记录（无 `file` 字段）在打开时自动按 box 角色重建为方块人偶（位姿/缩放保留；颜色因染色机制不同不迁移）。程序方块三个 API（`spawnBox`/`addBoxAtCursor`/`setBoxColor`）已删除。

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
node tests/probe-v35.mjs     # 16 项：方块 GLB 化（第五角色/人偶管线染色/选中联动/删除）
node tests/probe-v36.mjs     # 19 项：白色外包盒（人偶/道具/泼溅显示、跟随、取消隐藏、截图豁免、v37 可遮拁）
node tests/probe-v38.mjs     # 15 项：v38 视口/机位面板（模式钮收养、数值块拖动+就地编辑、updateShot/nudgeShot/rotateShot/resetShot、goto 应用机位裁剪、存档兼容）
node tests/probe-v39.mjs     # 18 项：v39 八条反馈（安全区钳位/左上停靠/双击+按住拖动/视角模式全流程/撤销/三轴旋转/UI 门控）
node tests/probe-v40.mjs     # 9 项：v41 三项反馈（2.4rem 档控件/双击长按拖动/机身在视角后方 + 版本门禁）
node tests/probe-v42.mjs     # 14 项：画幅下拉（七种比例/机位独立/可撤销/旧档兼容）、按画幅渲染尺寸（spy 捕获）、机位视角安全框几何与显示 FOV 拉远
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
| v32 | 02b2b7e | a669d71 | 相机面板重排（注释贴模式按钮旁）、机位改名/重定位（`renameShot`/`relocateShot`）、悬浮窗半透明 `--sd-alpha` + 设置页滑条（默认 0.6） |
| v33 | —（纯 UI） | bc8a0ac | 反馈五条：四钮加大 3 倍（135px 见方）、测量入定位组、二级页面/弹窗半透明（--sd-alpha）、底栏合并「游标相关」三钮（图文）、框选/回原点入相机组+注释补全 |
| v34 | —（纯 UI） | fd3450c | 反馈四条：保存/返回入顶部菜单停靠栏（sd-pjbtn）、顶栏默认左上角、机位小钮减半（3.75rem）、组名「游标相关」→「游标」 |
| v35 | b603b7a | 21e844e | 方块 GLB 化：`box.glb` 第五内置角色，人偶管线全量继承（染色/黄点/选中联动/存档还原/复制）；删除程序方块三 API；旧存档 `kind:'box'` 自动转为方块人偶 |
| v36 | 68f1287 | ba56d16 | 选中对象白色外包盒边线（12 棱线框）：人偶/道具/泼溅都显示，逐帧跟随移动/动画，取消选中隐藏，机位截图不拍摄（capturing 链路）；命名 `selection-box-marker` 避开吸附/测量射线 |
| v37 | fbe75ce | 44e1f69 | 真机反馈：外包盒改为**可被模型遮挡**（depthTest 开、深度只读不写）——不透明 GLB 网格挡住身后的盒线，泼溅不写深度不遮挡；修复「盒线穿透所有模型」的悬浮感 |
| v38 | 1c6e327 | 51e9def | 相机面板重排：右栏新增「视口」组（全局相机实时参数+模式四钮+焦距 1–500mm+恢复默认），「机位」组每机位独立裁剪/焦距（updateShot/nudgeShot/rotateShot/resetShot，步进六钮+旋转角输入），gotoShot 应用机位裁剪，旧存档无 clip 回退自动 |
| v39 | f474fe9 | 8022bd0 | 老板八条反馈：停靠钳位避让系统栏（viewport-fit=cover）、菜单栏默认停靠左上角、数值块改**双击编辑+按住拖动**（防误触）、**机位视角模式**（查看=进入第一人称，调参即时生效，退出自动保存+还原视口，模式内自由视口手势被吞+文字提醒）、机位/视口编辑可撤销、三轴步进旋转（水平/俯仰/倾斜 ±，默认 3°，滚转入存档） |
| v40 | 08c0a92 | b9d4cc9 | 老板真机反馈：控件高度整体缩 30%（按钮/数值块/步进/旋转钮）；数值块拖动改**双击长按**（单击长按不再触发，双击编辑保留）；自机位白框修复——视口所站机位（2m 内最近）的相机体标记始终隐藏，近裁剪为 0 也不再入画 |
| v41 | e510d2c | 207a544 | 老板反馈三项：机位白框整体移到**机位视角后方**（`vis` 后置组，视角内永远不挡视线，退役按距离隐藏）；机位面板控件再缩一档（2.4rem 档）+ 禁用 WebView 字体放大（真机文字不再被系统撑大）；数值块 `touch-action: pan-y` + 捕获推迟到拖动武装时——上下滑动面板不再被数值框吃掉 |
| v42 | e402b00 | 958c503 | 老板定案 B：机位视角与渲染照片取景差异修复——机位新增**画幅**（16:9/21:9/9:16/9:21/4:3/3:4/1:1 下拉，机位独立存储可撤销，旧档默认 16:9）；渲染按画幅出图（长边 1280，长边保持机位 FOV）；机位视角把显示 FOV 自动拉远使取景完整入屏 + **安全框外压暗**（框内即照片所得，getViewportInfo 增 displayFov/aspect；模式内渲染捕获期临时换回真实 FOV） |
| v42b | e1b2d89 | ab49f90 | 真机反馈「看不到白框」：安全框由 1px 线+9999px 巨影（Android WebView GPU 路径会跳过）改为**四条实体暗条 + 2px 黑描边白框**；框尺寸基准改窗口 CSS 像素（DPR 免疫）；版本标记 v42b-frame-bars |
| v43 | ef8839f | 5ab1742 | 应用更名**摸鱼台**：桌面名/PWA/网页标题/关于弹窗/启动页/错误提示全量替换（引擎+覆盖层+原生 strings）；相册目录 Pictures/SuperSplat → Pictures/摸鱼台；导出查看器启动页标题同步；包名与仓库内部名保持不变（覆盖安装兼容），版本标记 v43-moyutai |
| v44 | —（原生插件） | 1df14dd | 解压中心 P1：ExtractPlugin（SAF 多选分卷→自然序拼接→commons-compress 流式解压→MediaStore Downloads/摸鱼台/<名>[_expN]）；工程页新建左侧「🗜️ 解压」按钮 + extract.js 弹层（进度/完成/错误）；rar 明确拒绝；probe-v44 13 项（mock 原生） |
| v44b | —（修复） | 3e1bfc2 | 真机「选完无反应」根因修复：pick 改 C7 @ActivityCallback（旧 handleOnActivityResult 不触发）；新增 DebugLog 插件 + 「🐞 日志」调试按钮（查看/清空/SAF 导出，release 隐藏）+ ExtractPlugin 全程原生日记；probe-v44 扩 16 项 |
| v44c | —（体验） | 4c92f83 | 分卷缺卷预检（.NNN 序列断号直接报缺哪卷）+ header 越界错误翻译成人话（真机案例：MOOD_-37.7z 缺 .005）|
| v44d | —（稳定） | 096d0a4 | 真机 218MB 9卷档解压中途闪退对策：解压线程 MIN_PRIORITY + 单飞行锁防并发互踩 + 唯一临时文件 + 逐条目日记（闪退点可从日志直接看到最后解出的条目）|
| v44e | —（根因） | 3399bba | 7z 闪退根因=OOM：LZMA 字典分配超默认堆上限，Error 未被 catch(Exception) 接住→线程静默死（debug3 日志 16:00/16:01 铁证：拼接完成后 48/72ms 无声退出）。修复 largeHeap + catch(Throwable) 给人话 + 内存状态日记 |
| v44f | —（真因） | a020837 | 7z 无声闪退真因=XZ 库缺失（NoClassDefFoundError: LZMA2Options，commons-compress 可选依赖未带入；debug3 日志堆内存充足 4MB/512MB 排除 OOM）→ gradle 补 org.tukaani:xz:1.9。v44e 的 catch(Throwable)+类名日记立功定位 |
| v45 | P2 视频工作台 | 9a415df | 三模式新建（R4：3D/视频/音频，AV 工程媒体不进包）；av-store/av-ui Web 层（清单自然序+标号解析 auto-N、标记 split/merge_prev/multiframe_ref、吸附±半帧、帧量化、fps rVFC 自动估算+手动修正、导出 moyutai.marks.v1 降序）；MediaServerPlugin 原生层（SAF 目录授权+持久化、127.0.0.1 随机端口 HTTP Range 流服务器、路径索引防穿越、MIME 白名单）；network_security_config 仅放行 loopback 明文；SaveImage.shareFile（JSON 导出走系统分享）；probe-v45 31 项全过 |
| v45b | 真机反馈 6 条 | 5f00cf9 | ①进工作台强制横屏（MediaServer.lockLandscape 原生 Activity 级+JS 兑底，返回解锁）②补 ⏯ 播放按钮（v45 漏实现，也是 fps 采不到的根因）③帧数常显（fps 未估算按 25）④游标命中 ±半帧按钮变红「移除」态+播放条点选吸附 ⑤多帧不再被 fps 阻塞 ⑥布局照抄 r6 原型（工具行单行+播放条 ⏮⏯⏭）。probe-v45 扩到 36 项；修探针假失败：随机 CDP 端口+独立 profile+孤儿进程清理 |
| v45c | 真机反馈二轮 7 条 | d3c18bf | ①⏮⏯⏭+◀步进▶ 移右侧中间竖排栏（av-rail，按钮放大 50%）②标记刻度挪进进度条同层（av-range-wrap 内缩对齐）③时间/帧数悬浮播放器右上角（av-pos-top）④原生 getSafeArea（WindowInsetsCompat）→CSS 变量四向避让系统栏/挖孔（Android 15 edge-to-edge env() 不可靠）⑤工具行顺序 ⤴并入/✂分割/▦多帧/fps ⑥删单击视频切全屏（stage-hit）⑦按钮放大。probe-v45 扩 38 项 |
| v45d | 热修：整页大黑边 | 155086d | 老板 23:18 截图：工作台内容被挤到右下角、顶部/左侧大黑带、控件堆叠。根因=v45c getSafeArea 直接把原生物理 px 当 CSS px 用（未 ÷ devicePixelRatio，放大 2~3 倍）且旋转过渡期读到竖屏旧值（top≈460 物理px）。修：换算 DPR + 超 48css px 视为脏值归零 + 400/1000/2000ms 延迟重读 + resize/orientationchange 自愈 + 内层元素不再重复消费安全区变量（统一 .av-page padding）。probe-v45 39 项（C3 换算/钳制断言）|
| v45e | 热修：视频工程打不开 | 78f2016 | 老板 07:21 反馈：点视频工程只横屏、界面不出。桌面探针 39/39 全绿但真机静默失败 → 按既定排障链路：①open()/路由全链路 DebugLog 埋点（route AV/open meta/page open/listFiles/folder ERR/open FAIL）②全局 error/unhandledrejection 钩子落日志（静默失败终结者）③open 包 try/catch：异常时 toast 具体错误+退回工程列表，不再黑横屏 ④MediaServer.load() 在 Activity 重建时重置方向（进程未死重开 App 残留横屏请求的嫌疑消除）。下一轮老板复现后🐞导日志即可精确定位 |
| v45f | 热修：日志空行+空态入口 | 08a84e6 | 老板 07:46 回报仍打不开。日志文件 8 行全空 → v45e 埋点传参错误：DebugLog.append 应传 {text:...} 而非裸字符串，原生 getString 全落空。修复：dlog/路由埋点改 {text:} 形态；toast 全部落日志；视频 error 事件落日志；空态加「重新授权目录」按钮（隔夜 SAF 授权失效为头号嫌疑）。38+39 探针全绿 |
| v45g | 空态引导强化 | 3ee6554 | 老板 08:23 日志确诊：v45f 流程全通（route AV/open/page open 无错误、埋点有内容），folderUri=false = 工程从未绑定过视频文件夹，工作台已打开但停在空态（v45f 空态 block 布局把按钮顶到左上角不显眼，看起来像没反应）。v45g：空态改 flex 居中欢迎层（标题+说明+大按钮），区分「未关联文件夹」/「授权失效需重选」两种文案，pickFolder 选择→拿到 uri→刷新全程落日志。39/39 探针过 |
| v45h | 真机证据双修 | ca2d8e1 | 老板 08:57 两张截图+完整日志坐实两个真机 bug：①「打开工程：读取数据…」转圈永久卡死（存储读取挂起→busy 死锁）→ 看门狗 6s 强制解锁+toast+storeTimeout 超时护栏；②日志 class 已加但屏幕仍是工程列表（.av-page 层叠未生效）→ open 时内联样式兜底（fixed/inset0/z1550/flex）+ 120ms 渲染取证日志（display/z/rect/sheets）。39/39 探针过 |
| v45i | 样式表局部生效根治 | b4799d5 | 老板 10:35 截图：工作台已能打开（v45h 内联兜底生效）但 av.css 只剩零碎规则起作用——顶栏跑到画面中间、左列表悬半空、空态文字飘在视频上、右侧竖排栏叠着工具行。根因判断：WebView 对本地 av.css 用了旧缓存（无版本号引用，service worker 已清但 HTTP 缓存仍在）。三重防御：①applyLayoutGuard 结构布局全部内联写死 ②每次打开 fetch av.css?v=时间戳 no-store，内容一致才内联为覆盖 style ③空态显隐改 JS 控制+取证日志加 top/side rect。39/39 探针过 |
| v45j | 避让内联 | b830724 | 老板 10:36 确认能进去但布局乱+顶部未避让（坐实 v45i 旧缓存样式表判断）。追补：getSafeArea 回调里避让 padding 同步内联写入（cvt 换算/脏值钳制后直接 page.style.padding*），不再依赖样式表消费 --av-safe-* 变量。39/39 探针过 |
| v45k | 内联兜底真正生效 | c10124f | 老板 12:08/12:28 两张截图：58 段数据链路全通但布局横排乱铺（顶栏竖条居左内容垂直居中/列表贴右缘/右侧控件全叠）。根因（自查出）：v45i 的 applyLayoutGuard 用 style.setProperty(驼峰键)——setProperty 只认 kebab-case，驼峰键静默无效 → 兜底从未生效，flex-direction 缺省 row 即截图形态；且 fetch av.css?v= 在 Capacitor 本地服务不可靠（缓存自愈两轮无效果的原因）。修：①布局兜底改 style.xxx IDL 赋值 ②av.css 全量内嵌 AV_CSS 常量，打开时移除旧 link+注入 style（换版必带新样式，缓存变量消灭）③探针 39/39 |
| v45l | fps 容器真值+布局微调 | 5b87515 | 老板 19:00 三条：①fps 不该手改——新增 MediaServer.probeMeta（MediaExtractor 读容器 KEY_FRAME_RATE，毫秒级），打开文件即取真值并落库，来源标『原生』；仍保留手填（部分容器无此字段/网页采样估错时兜底），手填与原生冲突会提示 ②工具行(并入/分割/多帧)横排移到进度条左上角，避开右侧竖排按钮 ③fps 移到右上角信息条与帧/时间同排，点芯片编辑；probe-v45 41/41 |
| v45m | 首帧缩略图+导出 v2+同帧互斥 | b5b0339 | 老板 20:01 四条：①列表选中视频画首帧缩略图（隐藏 video 画到 0.1s 截帧，失败留占位）②导出改一视频一节点：{target, split_at_frame/split_at_seconds, multiframe_refs[], merge_prev, note}，schema 升 moyutai.marks.v2，仍按段号降序 ③分割点与多帧点同帧互斥（UI 互吸：分割吃掉同帧多帧参考、多帧点吃掉同帧分割）④导出层兜底剔除与分割同帧的参考帧；probe-v45 43/43 |
| v45n | 导出 v3 定稿+首帧上屏+🖼开关 | 0631e86 | 老板 20:39 定格式、20:47 澄清：①导出 moyutai.marks.v3：一视频一节点 {target, merge_prev?, points[]}，points 为统一点列表（split/multiframe 同级同构 type 区分，split 多带 at_seconds），帧升序、段号降序、同帧互斥兜底 ②澄清需求是播放区：选中视频后 loadedmetadata 即 seek 微量触发第一帧上屏，不再需要点播放/下一帧才见画面 ③列表缩略图顺带修正为真第 1 帧（旧版 seek 0.1s 画的是第 3 帧），右上角加 🖼 开关（持久化，默认开）④probe-v45 45/45 |
| v45o | 原生首帧缩略图+精确fps+列表净化 | 81baf44 | 老板 21:31 三条+fps 求证：①缩略图不显示根治：WebView 视频管线不可靠 → MediaServer.thumb 用 MediaMetadataRetriever 原生解码首帧 JPEG base64 直出 ②fps 真相：老板 clips 全批 ffprobe 实证 23.976fps（24000/1001），KEY_FRAME_RATE 整数截断显示 23 → probeMeta 改样本迭代精确计算 + JS 侧吸附 COMMON_FPS（23.976 不再报 23 与手填冲突）③删「加载文件夹」旁收起按钮及悬浮把手 ④文件名横向滚动看全名（滚动条隐藏）⑤一次事故：thumb 块替换吞掉 renderList 等 5 个函数（探针 28/42 抓住），git restore 后用精确锚点重做；probe-v45 47/47 |
| v45p | v45o 事故修复+fps 中位delta | 20719ba | 老板 22:22 报三炸（列表滚动失效挤成一坨/fps 乱跳 29.97·25/缩略图仍无）。根因：gen 脚本 cut() 语义错误——把结束锚点 '.av-list {' 选择器连同 coll 规则一起切除，规则成孤儿多出一个 }，.av-list 失去 flex/overflow → 列表挤坨滚动失效；教训：结构性删除必须 keep-end 语义+平衡断言（此为第二次被 end-anchor 咬，v16 删除事故同类）。修复：CSS 从健康版 316b34b 全量重建（仅 5 处预定改动，63/63 平衡）+ diff hunk 审计（5 个 hunk 全部落点校验）+ N5 计算样式门禁（overflow-y=auto && display=flex）。fps：first/last 相除法对 B 帧乱序流完全失真 → 改排序 PTS 相邻间隔中位数 + 吸附 6%→2.5%，防乱值被错误吸附成 29.97/25。缩略图本版不动（老板：没改好就算了），待真机日志定位。probe-v45 48/48 |
| v45s | 缩略图缓存+队列治理 | 10424f1 | 老板 08:25 日志：thumb fail 刷屏根因=无缓存（每次 renderList 重入队反复解码）+退出不清队（服务停后空转）。修复：会话缓存 name→jpeg、back/renderList thumbFlush、汇总日志（ok=N fail=M）、原生帧0失败退 1s 兜底。probe-v45 48/48 |
| v45t | 缩略图失败取证 | c554d24 | 老板 08:41 日志 thumbs ok=0 fail=2 但原因被 v45s 裁掉的日志吞掉（失误：诊断信息不该省）。修复：逐条失败原因（前3条带文件名）、汇总带样例、失败文件会话不重试、原生 0/100ms/500ms/1s 阶梯、open() 日志打构建版本号 |
| v45u | 官方 scaled 解码路径 | 50e1865 | 老板指示先查通用实现。官方文档（Android 8.1+）：getScaledFrameAtTime 直接解码到缩略图尺寸，getFrameAtTime 全帧解码是文档点名反模式（浪费内存，4K 片段解码失败根因）。已按官方标准重写，旧 API 走老路径兜底。老板 10:27 日志：fps 19×23.976 全对、横屏/避让/列表正常，但缩略图零日志（任务未跑） |
| v45v | 入队级诊断 | e0b3de8 | 老板确认开关常开仍无图。诊断版：mkThumb 计数、renderList gate 实况、队列状态。老板 12:14 日志破案：mkCalls=33 全调、队列正常 → 断点在原生解码本身（每文件~45s 报无法解码首帧），但播放正常 → 播放栈可用、缩略图栈不可用 |
| v45w | 页面内视频捕获降级 | b54868c | 原生解不出 → 自动降级隐藏 video 走本地 Range 服务（与播放同栈）seek 0.4s canvas 截 192px。流水线 probe-v42 13/14 偶发（测试基建：grab 捕获的 overlay 容器引用在 updateShot 重建后脱离文档读旧值；fresh-query+waitForStable 轮询+bars 可见期采样根治）+ GitHub 下载限速 15min 超时（分块断点续传 resume） |
| v45x | 自适应通道治理 | 284e494 | 老板 14:48 日志定案：降级已触发但原生每文件拖 45~90s 才认输，视频捕获排长队末尾、退出后残留空转。修复：①会话自适应连续 2 次原生失败判死→其余直走视频捕获 ②跨会话记忆 localStorage 3 天 ③JS 15s 看门狗（v45v 版因 stamp 锚点失配从未写入——gen 脚本必须 fail-fast 教训）④Java 步超时 5s+退出即拒 ⑤捕获结果先入缓存。18/18 回归、CI 41790271677 success、15:33 飞书发出（26,119,037B，resume 续传交付） |
| v45r | 桥线程饿死修复（四图定位） | 9cfc2b6 | 老板 23:36 四图：日志(空)、转圈圈(读取数据…)、缩略图不出、操作超时 toast。真相三合一：v45p thumb() 在 Capacitor 桥共享线程上串行跑 58 个 MMR 整帧解码（每个几百 ms），日志/存储/媒体服务调用全部排队 → 日志空+重开转圈+6s 看门狗超时。另抓到独立 bug：thumbDrain 出队 isConnected 早退检查在容器挂 DOM 前必 false → 任务整批被吞（复现 containers=3/jobs=0/imgs=0 实锤「开关开着也不出图」）。修复：①thumb 移到 moyutai-thumb 独立单线程池+队列>12 快速拒绝 ②192px 缩小+JPEG70 ③JS 泵并发2+30ms+去掉出队早退（连接性只在结果回调时查）④AV 路由 hideWait+busy=false 消灭假超时 toast。诊断基建：__av._thumbState/_refreshFolder 调试口+真实浏览器复现脚本 temp/v45r-diag.mjs（键名 av-<name>-meta 教训：loadMeta 校验 name 字段）。probe-v45 48/48（N4 img=3 实证出图） |
| v45k | 本地资源缓存击穿 | d383828 | 老板 12:28 截图实锤缓存病根：标题/列表数据全对（58 段）但顶栏飘中间、列表贴右缘——新 DOM+旧样式的缝合体，且每版表现都不同（新 DOM 每版变、旧 CSS 固定）。根因：index.html 引用本地资源无版本号，WebView 跨版本安装持续吃 HTTP 缓存。修：所有本地 js/css 引用加 ?v=45k（发版即换键）+ refreshCriticalCss 打开时物理删除旧 av.css link 再内联注入最新。39/39 探针过 |
| v46 | 音频工作台时频图 | 2ae84ec | 老板确认 audio_viz 样张后实装：`www/av-viz.js`（audio_viz.py 的 JS 移植——dB 包络 / 气口检测 / magma 语谱 / 对数频轴，seg018 检出段数与 Python 版一致）；音频「多帧点」改存秒（`secs`，按 stepAudio 量化）不再产无意义帧号，分割点同理，导出 `moyutai.marks.v3` 音频只写 `at_seconds`。另修两处隐患：①音频播放改走 WebAudio 引擎（实测 `<video>`/`<audio>` 对 WAV 直接 `MEDIA_ERR_SRC_NOT_SUPPORTED`，连 1 秒正弦波都失败，而 `decodeAudioData` 三个文件全通过）②WAV 自解析文件头保原始采样率（`decodeAudioData` 会重采样到 48k，令频率轴偏 8.8%）。E2E 20/20 |
| v46c | 时频图对齐 + 遮挡治理 | cac412a | 老板 22:54 两条反馈：①**图与时间轴对不上**——绘图左边距 52px 与进度条轨道（16px + 刻度内缩 10px = 26px）各写各的；统一为 `EDGE=26`，0s/末尾刻度与进度条两端实测误差 1px，并新增红色播放头（拖动/步进/播放实时跟随，误差 0px；静态层按尺寸缓存，只重绘播放头）②**按钮包围圈太实挡视野**（视频工程同样存在）——删除 `.av-rail` 的 padding 10px + blur 4px 大毛玻璃底板，按钮 0.38→0.28、工具行 0.55→0.14、时间条 0.55→0.18、进度条 0.25→0.16、模糊 4→0/2，共用样式两模式同时生效。附带必修：音频页纯白底下原浅色字不可见（根因 `applyLayoutGuard()` 内联 `color:#eee` 优先级高于类选择器，故 `applyStageMode` 同步改内联值）；画布下沿留 56px 不再被进度条压住。E2E 24/24（含对齐/播放头/亮度断言）|
| v46d | 回归端口确定性回收 | 85c906c | **纯测试基建，产品代码零改动**。probe-v42 偶发 13/14 的真因：上一套残留的 staticsrv/Edge 占着 4205/9265，v42 静默连到旧页面读到旧 DOM，安全框数值永不变化。三层缺陷：①套内端口重号（4199 被 v30/v32/v28b 共用，4205+9265 被 v35/v42 共用）②守卫只报忙不回收 ③编排 `killStale` 只扫 9xxx 从不碰 4xxx。新增 `tests/lib/net-reclaim.mjs`（`isFree`/`reclaimPort` 按监听 PID `taskkill /T /F` 并轮询到真释放/`reclaimPorts`/`ephemeralPorts`，**跳过自身 PID** 防自杀）；30 个测试全部 `await reclaimPorts([PORT, CDP])` 前置并分配唯一端口（30/30 唯一）；编排每套前后全量回收 + 失败自动重跑一次以区分抖动与真回归。实证：杀 2 个外部监听 5.2s 内双端口释放；18/18 全绿，每套 `freed=59/59` |
| v47 | 定位修复（长视频按帧卡顿） | c63719a | 老板反馈「播放较长的视频按帧移动画面跟不上，尤其后半段，开头还好」。**根因**：`serveRange` 用 `InputStream.skip()` 循环定位；SAF provider 给的是管道流时 skip 退化为「读掉 N 字节再丢弃」，成本 O(偏移)，越往后越慢。同一条 Range 路径也在拖缩略图捕获通道（v45w/x）。**实测**（461MB/166s 真实 4K，单次 256KB Range 首字节）：0MB 1.5ms → 439MB 391.2ms（**265 倍**）；改 `Os.lseek` 后同条件 1.5ms → 1.8ms（**1.2 倍**），后半段提速 220 倍。实现用 `ParcelFileDescriptor` + `Os.lseek` + `AutoCloseInputStream`（该流拥有 fd，避免双重关闭竞态）；provider 返回不可定位流时 lseek 抛错自动退回 skip 兜底。**诊断**（按老板「定位不到就先打日志」要求）：Java 新增 `stats()` 暴露 ranges/lseek/skipFallback/seekMsAvg/Max；JS 新增 `SEEK-SLOW`（>400ms 带位置比例）与 `SEEK-SUM`（每 20 次 p50/p90/max），打开/退出工程打 `MEDIA-STATS`。AV E2E 24/24 绿 |

| v48 | 缩略图捕获跨源污染（ISS-001 缺陷A） | 7b4bc54 | `videoThumbPump` 的捕获 `<video>` 未声明 `crossOrigin`。服务在 `127.0.0.1:<port>`，页面在 Capacitor 源，属跨源；未声明则 `drawImage` 污染 canvas，`toDataURL` 抛 `SecurityError`，被 catch 吞成 `canvas err`，与「播放正常但截帧出不来」完全吻合。本地实证（4K 片段，页面 :4981 / 媒体 :4982）：不加 → `SecurityError: Tainted canvases may not be exported.`；加 `crossOrigin='anonymous'` → 1180 字节 JPEG 192x108。必须在赋 `v.src` 之前设置。MediaServer 已返回 `ACAO:*`，服务端无需改。另加逐文件 `THUMB-CAP-FAIL` 日志 |
| v48c | 缩略图三缺陷 + seek 锁死 | f28d0dc | **缩略图三个叠加缺陷**（均 JS 层，每一个都足以全灭）：①开关被永久关死——旧一次性恢复用 `thumbsRev='p1'` 去重，写过 p1 后永不再恢复，真机日志 `thumbs=false` 铁证；改为除非用户手动关（`thumbsUserOff`）就恢复 ②解码队列被反复清空——`thumbFlush()` 每次 renderList 清 `thumbJobs`，而列表真机每 3~5 秒重建，队列永远排不完；改为 `thumbBoxes` 按文件名登记容器，结果晚到也铺到新容器 ③缓存命中被误杀——`thumbApply` 判 `!box.isConnected` 早退，但 `mkThumb` 作为 `appendChild` 实参调用时 box 尚未入文档，每次命中都静默丢弃。**seek 锁死**（“按帧不跟手”根因）：`_seeking` 仅靠 `seeked` 解锁，解码器不派发时（同位/重载中/无真实媒体）永久卡 true，后续 seek 全被吞；改用 `videoEl.seeking` 判真在途 + 未进入 seeking 当场解锁 + 1500ms 看门狗 + 重追上限 2 次。另：同片段不重复装源（`_loadedSrc`，4K 不再重解 GOP）、`renderList` 签名短路。**门禁**：probe-v45 48/48（N4 img=0→3）、v44 16/16；真机老板确认「缩略图也出来了」 |

## 9. 已知边界 / 待办

- 动画库只保留 `assets_src/UAL1_Standard.glb` 一份；`spike/glb-load-test/index.html` 按 `../../assets_src/UAL1_Standard.glb` 加载。
- 人偶数量上限、LOD/降采样未做（真机帧率待大场景实测，见移植计划 §5）。
- 属性面板（坐标/缩放数值输入）仍用 SS 变换工具，未做移动端专用面板。
- 分镜序列（机位排序 + 转场播放）为 F2 阶段，未开始。
- 真实大场景（1–3M splats）遮挡与帧率复验未做。
- 测量结果在退出测量工具后仍保留（是否改为退出即清空，待产品确认）。
- **密度中心是纯位置均值**，不做不透明度加权、不做离群点截断。扫描类场景若带大量背景噪点，中心会被噪点拉偏；真机遇到再考虑加权重或分位数截断。
- **黄点屏幕尺寸固定，不看遮挡**：被模型挡住时不会变暗或透视显示，这是有意的（作为定位锚点必须随时可见）。
- **白色外包盒（v36，v37 改可遮挡）补充黄点**：选中任何人偶/道具/泼溅时绘制 12 条白色棱线框，中心贴合对象包围盒；黄点仍负责精确定位基准点。棱线粗细随对象尺寸伸缩（下限 0.01），包围盒尚不可用时（蒙皮首帧前）退化为标准人形盒。v37 起开深度测试（只读不写）：模型能挡住身后的盒线，符合 DCC 选中框直觉；泼溅不写深度所以不会遮挡盒线。


> ✅ **ISS-001 已关闭（2026-11-05，v48c）**：真机缩略图正常。根因不在解码栈（不是 SecureDecoder、不是 canvas 污染、不是原生阶梯毒化——`mkCalls` 全程不变证明相关代码根本没执行），而是**三个 JS 层缺陷叠加**：开关被 `thumbsRev='p1'` 永久关死、`thumbFlush()` 每次列表重建清空解码队列、`thumbApply` 的 `isConnected` 早退误杀每次缓存命中。v48c 一并修掉，老板真机确认。完整定案见 docs/KNOWN-ISSUES.md ISS-001 文末。
>
> 遗留体验项 **ISS-002**：首次进入 58 段 4K 工程时缩略图要排一会儿（并发上限 2 × 4K 首帧解码，属真实解码成本，老板明确可接受）。优化方向见 KNOWN-ISSUES。
**门禁**：probe-v45 48/48（N4 img=0→3）、v44 16/16；真机老板确认「缩略图也出来了」 |
| v48d | 视图导航双模式（游戏/建模） | b638310 | 老板反馈缩放「放大越慢、缩小越快」，要游戏式恒定手感。新增 `navMode`，默认 `game`：缩放改用 `d × exp(-amount × rate)`，上下限按场景缩放（`gameZoomMin/Max` = D_fit 的 0.02/8 倍，D_fit = sceneRadius / sin(fov/2)，即刚好装下场景的距离），5 m 小场景与 200 m 大场地都够用；`model` 保留原始几何缩放与绝对上下限，一行未改随时可切回。配套：`Camera.clampDistance()` 统一钳制、`dFit`/`suggestedStep` 场景派生指标（步进 = sceneRadius/25 吸附 1-2-5 档，防放道具时抖动，空场景下限 0.1）、`onBoundChanged` 派发 `camera.navMetrics`。dock 视口面板加「视图 [游戏][建模]」+ 步进 + ↺ 重置 + 场景半径提示，偏好存 localStorage（全局，不进工程）。仅触屏双指走新路径，鼠标滚轮保持原样 |
| v48e | 双模式无区别 + 双指可致失效 | b89488a | **真机反馈「两模式用起来没啥区别」，两个独立缺陷**：①`gameZoomRate 0.35` 等于没改——原判断「建模是强几何缩放」错误，`× 0.999` 让 `Δd` 几乎精确正比于 `d`，建模本身即 ~0.45 倍/捏合，而 `exp(-amount × 0.35)` 算出 ~0.50 倍，**只差 10% 肉眼不可分辨**；改为 `0.8` → 游戏 **0.20 倍/捏合**，拉开一倍以上 ②`setPointerCapture` 抛 `NotFoundError` 时（合成事件/部分 WebView/指针对已释放）中断 `pointerdown`，`touches.push` 不执行 → 触点永远到不了 2，双指分支不可达，**捏合完全无反应**；改为 `safeCapture()` 包 try/catch，捕获只是「拖出元素外仍可继续」的优化而非手势前置条件。**方法论修正**：初版在脚本里复刻公式算差值，故 0.35 那个无效值照样"测试通过"；改为 headless Edge 真实派发 pointer 逐帧走完整控制器路径，才同时暴露两者。实测 游戏 0.202×4 恒定 / 建模 0.445→0.442 漂移；导演台 16/16、AV 48/48 |
| v49 | 图片模式（第四工程） | b463a15 | 新建工程四选一加 image；img-store.js（moyutai.imgmask.v1 笔画数组 + meta，独立于 av-store 以免搅动其 mode 严格校验）+ img-ui.js（双层 canvas：图片层仅视图变换重绘、蒙版层仅笔画变化重绘）；单一渲染器 drawMaskInto 供预览与导出共用（brush/polygon source-over、erase destination-out）；导出按原图尺寸合成 PNG、挖除区 alpha=0，走 SaveImagePlugin.share 与机位同链路，零新原生插件；图片按内容寻址入 files/<sha1>.<ext> |
| **v49b** | 图片模式真机三反馈定稿 | d8f0a7c | ①顶栏避让系统状态栏（getSafeArea 物理px÷dpr、超 SAFE_MAX 48 归零、延迟重读+resize 自愈、内联 padding；配 box-sizing:border-box，否则 height 与 padding 相加实测 100px）②多边形改套索（拖动画轮廓松手闭合，拖动中不入撤销栈）③涂抹深浅不一系渲染缺陷非厚度控制（每笔 .82 叠加 → 1-(1-.82)^N，改每笔 alpha=1 + 整层 opacity:.82）。探针 21/21 |
