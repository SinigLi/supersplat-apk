# 导演台模块（Director Console）— 移动端架构与开发手册

> 版本：v12b（2026-10-17 定版） · 维护者：全栈工程师
> 代码位置：`supersplat-main/src/director.ts`（38KB，1065 行） · 面板 UI：`supersplat-apk/www/dock.js`
> 关联文档：`docs/DOCK.md`（停靠组 UI）· `projects/splat-viewer/docs/MOBILE_DIRECTOR_CONSOLE_PLAN.md`（移植路线）

## 1. 它是什么

把 Blender 导演台的「人偶摆放 / 动作切换 / 3D 游标 / 染色」搬进 SuperSplat 编辑器（playcanvas 2.9）。

核心设计：**人偶是场景一等公民**。每个人偶包一层 Splat 形状的适配器（`PuppetAdapter`），于是 SS 自带的变换 gizmo、pivot 管线、撤销/重做（`EntityTransformOp`）直接作用于人偶，**SS 工具代码零改动**。

```
UI（www/dock.js 面板）  ──命令──▶  window.__director（Director 实例）
        ▲                              │
        └──── 'director-state' DOM 事件（info() 快照）────┘
```

面板只发命令、只读快照，**不解析 GLB**。GLB 加载/动画/材质全在 `director.ts` 内。

## 2. 对外 API（`window.__director`）

| 方法 | 返回 | 说明 |
|---|---|---|
| `listCharacters()` | `[{id,name,loaded}]` | 角色库（woman/man/shiba/tuxedo） |
| `switchCharacter(id)` | `'ok' \| 'loading' \| 'unknown'` | 切换后续摆放用的角色；未加载则异步加载 |
| `addPuppet()` | `Puppet \| null \| 'loading'` | 在 3D 游标处摆放（走 undo） |
| `armPlacePuppet()` / `armPlaceCursor()` / `armSelect()` | mode 字符串 | 武装点击手势（再点取消） |
| `moveSelectedToCursor()` | `'ok' \| 'no-selection' \| 'no-cursor'` | 选中人偶移到游标（v12b，走 undo） |
| `deleteSelected()` / `deletePuppetById(id)` | `'ok' \| 'none'` | 删除（走 undo） |
| `setClip(i)` / `play()` / `pause()` | — | 动作切换/播放控制 |
| `setTint(tint)` / `setTintById(id,tint)` | `'ok' \| 'none'` | 八色 multiply 染色 |
| `setPuppetVisible(id, v)` | — | 显隐 |
| `listPuppets()` | 数组 | 场景面板人偶列表 |
| `listClips()` / `info()` | 数组 / 快照 | 动作列表 / 状态快照（驱动 UI） |

状态同步：每次变更 `document.dispatchEvent(new CustomEvent('director-state', { detail:{what, info} }))`，面板监听后刷新下拉与文案。

## 3. 关键实现点（踩过的坑）

1. **适配器必须齐全 SS 读的字段**：`projected-splat-renderer` 每帧读 `selectedSplat.instances.numSelected`；适配器缺 `instances` 会让渲染循环 60 次/秒抛错 → 选中人偶时黑屏、泼溅不可选（v10 事故 5efbe3b）。同理 `localBound` 在首帧/隐藏实体上可能没有 `aabb`，必须 null-guard（v12b）。
2. **GLB 实例化不带动画组件**：`container.resource.instantiateRenderEntity()` 后要手动 `addComponent('anim', { rootBone: ent })`，再 `anim.assignAnimation(state, track, 'Base')`。
3. **AnimTrack 在 `.resource`**，不在 `.data`；传错类型 `assignAnimation` **静默返回**（不抛错但骨骼不动）。
4. **动作切换要停住**：切 clip 不能自动播。用 `anim.speed = 0` + `baseLayer.play(state)` + `activeStateCurrentTime = 0` 冻结在首帧（v11/v12 需求）。
5. **点击手势在捕获阶段吞掉**：武装模式下 `pointerdown/up` 用 capture 且 `stopPropagation`，整段手势不进 SS 相机/选择工具；位移 > 8px 或 > 600ms 视为拖动，保持武装。
6. **落点三级吸附（Blender 规则）**：① SS 深度拾取（泼溅表面）→ ② y=0 地面 → ③ 射线平行地面时退化到视平面最近点。
7. **屏幕空间选人偶**：脚/胸/头三点 `worldToScreen` 距离判定（`SELECT_RADIUS=0.15`），没命中人偶再走 SS 泼溅拾取 —— 一个「选择」工具同时选人偶和泼溅。
8. **染色 = multiply**：克隆材质后给 `diffuse` 赋值，等价 Blender 的 MULTIPLY 混色节点（`TINT_COLORS` 与 Blender 侧完全一致，8 色）。

## 4. 角色资产流水线

角色 GLB 放在 `www/static/director/`，全部由 `tools/asset/` 脚本从上游资产合成：

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
   www/static/director/woman.glb / male.glb（~7.6MB）
        ▼  compress_glb.cjs（逐贴图转 WebP + 限长边）
        ▼  add_webp_ext.cjs（补 EXT_texture_webp 声明，playcanvas 才认）
```

- 骨骼必须**同名同序**（脚本会校验，不匹配直接 FATAL 退出）。
- `shiba.glb` / `tuxedo.glb` 为宠物角色，直接来自 pose-library，未走合并。
- 贴图压缩：quality 82、长边 1024，woman 30MB→7.6MB、male 21MB→7.3MB。
- 新增角色：改 `director.ts` 的 `CHARACTERS` 数组（id/name/url/scale）+ 资产入 `www/static/director/`，面板下拉自动出现。

## 5. 测试

headless Edge（WebGPU/ANGLE）+ CDP，跑在 390x844：

```bash
node tests/director.mjs        # 16 项回归：__director 就绪 / 4 角色 / woman 43 clips /
                               # 女性材质+3 蒙皮网格 / 摆放 / 移动游标可撤销 /
                               # 三个下拉预填充 / 底栏五连 / 无渲染循环异常
node tests/probe-layout.mjs    # 面板行布局量测 + 截图
node tests/probe-bottom.mjs    # 底栏按钮量测 + 截图
```

脚本自起静态服务（`tools/dev/staticsrv.cjs`）与 Edge，退出前打印 `N/M passed`，失败断言直接给出实际值。

## 6. 版本史

| 版本 | fork commit | APK commit | 内容 |
|---|---|---|---|
| v9 | 8d44f6a | 0972824 | 编辑器内导演台模块：人偶 + 43 clips + 点击放置 + 3D 游标 + 灯光 |
| v9b/v9c | e5e58b7 / 151275c | 7a3a5d5 / f993704 | 多人偶管理；Blender 式游标（球+十字+环）、三级吸附、屏幕空间选中 |
| v10 | e487e1f | 5a7a01c | 人偶接入 SS 选择/变换/撤销管线（Splat 适配器）；分镜工具布局裁剪 |
| — | 5efbe3b | 3dbfe0e | 修选中人偶渲染循环崩溃（instances 桩） |
| v11 | c33ca16 | d95fa5a | 摆放即冻结在默认动作首帧；底栏五连（选择/游标/删除/变换/导演台） |
| v12 | a26ff26 | 849f0c8 | 角色库四角色、游标处生成、切动作冻结、八色染色；WebP 贴图 |
| v12b | 7007591 | a0b4c07 | 真女性角色 woman.glb（Superhero_Female + UAL1 clips）；移动到游标按钮；面板分行重排；下拉展开即填充。**当前定版** |

## 7. 待办 / 已知边界

- 动画库只保留 `assets_src/UAL1_Standard.glb` 一份（7.6MB）；`spike/glb-load-test/index.html` 默认按 `../../assets_src/UAL1_Standard.glb` 加载，spike 目录内不再放副本。
- 人偶数量上限、LOD/降采样未做（真机帧率待大场景实测，见移植计划 §5）。
- 属性面板（坐标/缩放数值输入）仍用 SS 变换工具，未做移动端专用面板。
- 分镜序列（机位排序 + 转场播放）为 F2 阶段，未开始。
- 真实大场景（1–3M splats）遮挡与帧率复验未做。
