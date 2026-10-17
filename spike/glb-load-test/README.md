# GLB + 泼溅同场景 Spike（F0）

对应 `projects/splat-viewer/docs/MOBILE_DIRECTOR_CONSOLE_PLAN.md` v0.5 节 F0 剩余项。

## 验证目标

1. playcanvas 引擎加载骨骼 GLB（pose-library 资产）
2. GLB mesh 与泼溅实体同场景渲染，排序/深度无冲突
3. pc.AnimComponent 播放 GLB 内嵌动画 clip

## 用法

```bash
# 1. 默认加载 ../../assets_src/UAL1_Standard.glb（43 clips，仓库内唯一副本，无冗余）
#    换其他模型：把 glb 放进本目录，用 ?glb=文件名 指定
# 2. 起静态服务（根=仓库根目录，因为要读 ../../assets_src/）
#    在 supersplat-apk 仓库根执行：
node tools/dev/staticsrv.cjs . 4192        # :4192
# 3. headless 或真机浏览器打开
http://127.0.0.1:4192/spike/glb-load-test/index.html
```

页面 HUD 实时输出加载/播放日志；按钮：clip 0/1/2 切动作、泼溅显隐、骨架显隐。
手势：单指旋转、滚轮/双指捏合缩放（SS 同款最小验证集）。

## 状态

- [x] 脚手架（2026-10-17）
- [x] **真资产验证通过（2026-10-17）**：UAL1_Standard.glb（女人角色包，43 clips）加载 + instantiateRenderEntity 实例化 + Idle_Loop 自动播放，pelvis 骨骼采样确认在动
- [x] **真泼溅混渲验证通过（2026-10-17）**：合成 3DGS PLY（gen_splat_ply.mjs → splat.ply，85k 高斯点：地面盘+彩色球壳+背景墙）经引擎内置 gsplat 管线加载（GSplatResource），与骨骼角色同场景渲染
  - 遮挡双向验证：角色挡球（mesh 在前）✓ / 球挡角色（泼溅在前，半透明叠加）✓，无排序错误
  - 性能：headless 桌面 GPU ~80fps（85k splats + 骨骼动画，390x844）；真机帧率待实测
  - 引擎直用 gsplat 管线 = SS 同一条渲染路（SS 的 ply/spz loader 最终也喂 GSplatComponentSystem），结论直接迁移到 fork 集成
- [ ] fork 集成复验：把角色实体挂进 SS 编辑器场景图（真实大场景 1-3M splats 时重测遮挡与帧率）

## pc 2.9 API 坑（S1 开发必读）

1. **启动**：`new pc.Application(canvas, { graphicsDevice })`（Application 封装自动组装组件系统+资源 handlers；手动 `AppBase.init` 会漏 resourceHandles，加载全瘸）；设备先 `await pc.createGraphicsDevice(canvas)`
2. **GLB 实例化**：`container.resource.instantiateRenderEntity()`（旧 `instantiate()` 已废）；**不带 anim 组件，需手动 `addComponent('anim', {rootBone: ent})`**
3. **动画播放**：组件级 `play()` 已移除。姿势 = `anim.assignAnimation(state, track, 'Base')` 建状态 + `anim.baseLayer.play(state)` 切换；AnimTrack 在子资产的 `.resource`（不是 `.data`），传错 layer.assignAnimation **静默返回**（不报错但骨骼不动）
4. **骨骼命名**：本资产是 UE 风格（pelvis/spine_01，非 mixamorig:Hips）；动画轨道路径含顶层节点名，rootBone 必须指向实例化根

## 注意

- 引擎从 unpkg CDN 引（playcanvas@2.9.0），离线环境需先 `npm i playcanvas` 改本地引用
- 真泼溅验证不做在 spike 页——SS 的泼溅管线（spz 解码/排序 worker）在 dist 产物里，复验方式见上
