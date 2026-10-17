# SuperSplat APK — 导演台分支（移动端编辑器）

SuperSplat 3.5.2 fork 的 Capacitor 7 Android 壳 + 移动端 UI 改造层 + 内置「导演台」（人偶/动作/游标/染色）。

- 上游源码 fork：`../supersplat-main`（SuperSplat 源码，含 `src/director.ts`）
- 本仓库：APK 壳 + `www/` 产物覆盖层（dock UI、导演台面板、角色资产）
- 发版：push 到 `main` → GitHub Actions 构建 debug APK → 下载 artifact 发飞书

## 目录

```
www/                     Capacitor webDir（编辑器产物 + 覆盖层）
  index.js               supersplat-main 构建产物（SS 编辑器，含 director.ts）
  dock.js / dock.css     移动端三停靠组 UI（外挂层，不改 SS 源码）
  mobile.css / mobile.js body.mobile-mode 标记等小补充
  static/director/       woman / male / shiba / tuxedo 角色 GLB（含 43 clips）
assets_src/              角色资产源：UAL1_Standard.glb（动画库，merge 脚本输入）
tools/
  asset/                 角色 GLB 合并 / 贴图压缩 / GLB 检查
  dev/staticsrv.cjs      本地静态服务（headless 回归用）
  ci/                    CI 轮询、artifact 下载、APK 校验
tests/                   headless（Edge + CDP）回归与布局量测
spike/glb-load-test/     F0 技术验证页（GLB + 泼溅同场景）
prototype/               网页交互原型（定稿后再移植 APK）
docs/DIRECTOR.md         导演台模块架构 / 资产流水线 / 测试 / 发版
DOCK.md                  停靠组 UI 架构与真机事故红线
```

## 快速开始

```bash
# 本地验证（headless，需 Edge）
node tests/director.mjs        # 导演台 16 项回归 + 截图
node tests/probe-layout.mjs    # 390x844 面板布局量测
node tests/probe-bottom.mjs    # 底栏五连按钮量测

# 角色资产重生成（Windows，需 @gltf-transform + sharp）
node tools/asset/merge_woman.cjs
node tools/asset/compress_glb.cjs www/static/director/woman.glb 82 1024
node tools/asset/add_webp_ext.cjs www/static/director/woman.glb

# 发版
git push origin main
node tools/ci/ci-poll.cjs <sha> [timeoutSec]
node tools/ci/dl_artifact.mjs <runId> dist/app-debug.apk
node tools/ci/verify_apk.cjs dist/app-debug.apk
```

详细说明见 `docs/DIRECTOR.md`（导演台）与 `DOCK.md`（停靠组 UI）。
