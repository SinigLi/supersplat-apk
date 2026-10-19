# SuperSplat APK — 导演台分支（移动端编辑器）

SuperSplat 3.5.2 fork 的 Capacitor 7 Android 壳 + 移动端 UI 改造层 + 内置「导演台」（人偶 / 动作 / 3D 游标 / 染色 / 机位）。

- 上游源码 fork：`../supersplat-main`（SuperSplat 源码，含 `src/director.ts`）
- 本仓库：APK 壳 + `www/` 产物覆盖层（dock UI、导演台面板、角色资产）
- 发版：push 到 `main` → GitHub Actions 构建 debug APK → 下载 artifact → 打 zip 发飞书

**当前版本 v28c**（2026-10-19）

## 目录

```
www/                     Capacitor webDir（编辑器产物 + 覆盖层）
  index.js               supersplat-main 构建产物（6.7MB，含 director.ts）
  index.css / index.html SS 样式与宿主页（index.html 注入全部覆盖层脚本）
  dock.js / dock.css     移动端三停靠组 UI + 导演台/机位面板（外挂层，不改 SS 源码）
  projects.js            工程存储与 .svproj 格式（纯逻辑，无 DOM）
  projects-ui.js         工程列表页 / 编辑页 / 新建-退出对话框
  projects.css           工程双页 UI 样式
  fflate.js              zip 读写（工程文件自包含，不走 SS 的 .ssproj）
  mobile.css / mobile.js body.mobile-mode 标记等小补充
  static/director/       woman / male / shiba / tuxedo 角色 GLB（含 43 clips）
android/                 Capacitor Android 工程
  app/src/main/java/com/sinigli/supersplat/
    MainActivity.java    注册原生插件
    SaveImagePlugin.java 照片输出：保存到相册 / 另存为 / 分享
assets_src/              角色资产源：UAL1_Standard.glb（动画库，merge 脚本输入）
tools/
  asset/                 角色 GLB 合并 / 贴图压缩 / GLB 检查
  dev/staticsrv.cjs      本地静态服务（headless 回归用）
  ci/                    CI 轮询、artifact 下载、APK 解包与校验
tests/                   headless（Edge + CDP）回归与布局量测
spike/glb-load-test/     F0 技术验证页（GLB + 泼溅同场景）
prototype/               网页交互原型（定稿后再移植 APK）
docs/DIRECTOR.md         导演台模块架构 / API / 资产流水线 / 版本史
docs/PROJECTS.md         工程管理：存储布局 / .svproj 格式 / 双页 UI / 脏检查
docs/RELEASE.md          构建与发版手册
DOCK.md                  停靠组 UI 架构与真机事故红线
```

## 快速开始

```bash
# 本地验证（headless，需 Edge；脚本自起静态服务）
# 核心回归 —— 改任何东西都要跑
node tests/director.mjs        # 导演台 16 项回归
node tests/v13.mjs             # v13 起行为回归 15 项
node tests/project.mjs         # 工程管理 26 项（新建/保存/重开/删除）

# 按版本存档的验收探针 —— 改了相关模块时重跑
node tests/probe-v22a.mjs      # 机位相机模型 + 预览层按钮
node tests/probe-v22b.mjs      # 相机就近隐藏
node tests/probe-v23a.mjs      # 顶栏无渲染入口 + 视角立方体常驻
node tests/probe-v23b.mjs      # 视角立方体六轴映射
node tests/probe-v24c.mjs      # 导入自动选中 / 平点切换 / 锁对象
node tests/probe-v25.mjs       # 移动到游标带基准点 + 基准点按钮
node tests/probe-v26.mjs       # 三种对象黄点 + 泼溅基准点 + 重设
node tests/probe-v27.mjs       # 黄点屏幕等比 + 抓拍隐藏 + 跟随基准点 + 密度中心
node tests/probe-v28b.mjs      # 停靠区避让保存条（按钮位置不动）
node tests/probe-empty-project.mjs  # 空工程「新建→返回→再打开」闭环

# 布局量测（截图，非断言）
node tests/probe-layout.mjs    # 390x844 面板布局量测
node tests/probe-bottom.mjs    # 底栏按钮量测

# 改引擎后：构建 + 同步产物
cd ../supersplat-main && npm run build
# 然后按 docs/RELEASE.md §2 同步 dist → www

# 角色资产重生成（Windows，需 @gltf-transform + sharp）
node tools/asset/merge_woman.cjs
node tools/asset/compress_glb.cjs www/static/director/woman.glb 82 1024
node tools/asset/add_webp_ext.cjs www/static/director/woman.glb
```

发版流程见 `docs/RELEASE.md`；导演台细节见 `docs/DIRECTOR.md`；工程管理见 `docs/PROJECTS.md`；停靠组 UI 见 `DOCK.md`。
