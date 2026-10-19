# 构建与发版手册

> 版本：v28c（2026-10-19） · 适用：`supersplat-apk` + `../supersplat-main`
> 相关：`docs/DIRECTOR.md`（导演台）· `docs/PROJECTS.md`（工程管理）· `DOCK.md`（停靠组 UI）

## 0. 两个仓库的分工

| 仓库 | 内容 | 是否需要 push |
|---|---|---|
| `projects/supersplat-main` | SuperSplat 引擎 fork，导演台在 `src/director.ts` | **不需要**（无远端），提交仅作本地历史 |
| `projects/supersplat-apk` | Capacitor 壳 + `www/` 产物 + 原生插件 | 需要，push 触发 CI |

**APK 构建用的是 `supersplat-apk` 里已提交的 `www/index.js`**，不是引擎仓库。所以改了引擎必须经过 §2 的「构建 + 同步」再提交 APK 仓库，否则 CI 打出来的还是旧引擎。

## 1. 环境

- Node ≥ 20.19.0（引擎 `package.json` 的 `engines` 限制）
- Android 侧由 CI 完成（Java 21 / temurin），本机不需要 Android SDK
- Windows 上跑本仓库脚本；PowerShell 引号会破坏内联 `node -e`，**复杂脚本写成 `.cjs` 文件再执行**

## 2. 改引擎后的同步（最容易出错的一步）

```bash
cd ../supersplat-main
npx tsc --noEmit -p tsconfig.json     # 必须 0 错误
npm run build                         # rollup，约 30–40s

cd dist
# 只覆盖构建产物；dock.js / dock.css / mobile.* / index.html 是覆盖层，不能被覆盖
cp index.js index.css manifest.json ../../supersplat-apk/www/
cp spz-*.js ../../supersplat-apk/www/
cp -r static ../../supersplat-apk/www/
```

覆盖层受保护清单（**绝不能**被 `dist` 覆盖）：

```
www/dock.js  www/dock.css  www/mobile.css  www/mobile.js  www/index.html
```

`www/index.html` 是手改过的宿主页，负责注入 `mobile.js`、`dock.js`、`index.js`（module）。若 SS 上游的 `index.html` 有变化，需要手动把这段注入搬过去。

## 3. 验证

### 3.1 headless 回归（提交前必跑）

```bash
cd projects/supersplat-apk      # 必须在仓库根执行，静态服务根 = cwd
node tests/director.mjs         # 期望 === 16/16 passed ===
node tests/v13.mjs              # 期望 === 15/15 passed ===
node tests/project.mjs          # 期望 === 26/26 passed ===（工程管理全流程）
node tests/probe-empty-project.mjs  # 期望 9/9（空工程重开）
node tests/probe-v28b.mjs       # 期望 9/9（停靠区避让保存条）
node tests/probe-v22a.mjs       # 机位相机世界尺寸 + 预览层四按钮
node tests/probe-v22b.mjs       # 相机就近隐藏 + 渲染期间全隐
node tests/probe-v27.mjs        # 黄点屏幕等比 + 抓拍隐藏 + 密度中心
```

脚本自起 `tools/dev/staticsrv.cjs` 与 headless Edge（WebGPU/ANGLE），端口各版本不同（v22 用 4270/4271，CDP 9330/9331）。跑完自动退出，约 30–60s/个。

### 3.2 构建链自检

```bash
node tools/ci/ci-poll.cjs <sha> [timeoutSec]     # 等 CI，输出 run=... status / CI: success
```

## 4. 发版流水线

```bash
# ① 提交并推送（push 触发 .github/workflows/build-apk.yml）
cd projects/supersplat-apk
git add -A && git commit -m "..."
git -c http.proxy=http://127.0.0.1:7890 push origin main

# ② 等 CI
node tools/ci/ci-poll.cjs <sha> 1200

# ③ 下载 artifact（⚠ 先清掉上次的分片，否则会拼接出错误大小）
rm -rf dist/app-debug.apk.parts dist/_unzip dist/app-debug.apk
node tools/ci/dl_artifact.mjs <runId> dist/app-debug.apk

# ④ 解包：CI 产物是「zip 里套一个 app-debug.apk」
node tools/ci/unpack_apk.cjs dist/app-debug.apk dist/supersplat-vNN-debug.apk

# ⑤ 校验
node tools/ci/verify_v14.cjs dist/supersplat-vNN-debug.apk   # web 资源标记 + GLB 体积
node tools/ci/verify_v21.cjs dist/supersplat-vNN-debug.apk   # 原生插件 dex + 清单权限 + web 标记

# ⑥ 打 zip 发飞书（飞书会拦裸 .apk，必须套 zip）
```

## 5. 校验脚本说明

| 脚本 | 检查什么 |
|---|---|
| `verify_v14.cjs` | APK 魔数；`dock.js` 标记（`data-act="import"`、`pickAssets()`、`SPLAT_EXT`、`资产列表`、`sd-tool-yield`）；`index.js` 标记（`importModel`、`listProps`、`measure.debug`、`director-char-`）；四个 GLB 的字节数 |
| `verify_v21.cjs` | dex 里 `Lcom/sinigli/supersplat/SaveImagePlugin;`、`MediaStore`、小写字面量 `relative_path`/`is_pending`；web 侧 `sd-shot-save`/`saveas`/`share`、`Plugins.SaveImage`、`api[method]({`、`filename: r.name` |
| `tools/dev/deadcode.cjs` | 覆盖层死函数扫描（定义次数 vs 全文引用）；不是校验 APK，提交前自查用 |

**GLB 体积基准**（改动资产后要同步更新脚本）：

```
woman.glb    7,679,400 B
male.glb     7,621,552 B
shiba.glb    1,694,584 B
tuxedo.glb     602,496 B
```

### 5.1 校验脚本报 MISS 时先怀疑检查项

同一个坑踩过三次，都是**检查项过期而不是代码错**：

1. `verify_apk.cjs` 硬编码 v12 路径 → 已删除，功能并入 `verify_v14.cjs`
2. Java 的 `String` 静态常量（`MediaStore.RELATIVE_PATH`、`IS_PENDING`）在编译期被**内联**，dex 里只有小写字面量 `relative_path` / `is_pending`
3. `AndroidManifest.xml` 是**二进制 XML，字符串是 UTF-16LE**，用 latin1 扫必然 MISS；且 Capacitor 插件是在代码里 `registerPlugin()` 注册的，**不会出现在清单里**
4. v22 把保存改成 `api[method]({...})` 动态分发并删了 `canSaveNative`，`verify_v21` 仍按 v21 字面量找 → 报 2 个假 MISS

**规矩：改完实现立刻同步改校验脚本；报 MISS 先 diff 实现与检查项。**

## 6. 签名：固定 debug 密钥（v28d 已解决）

**现状**：`android/app/keystore/ss-debug.p12` 与 `android/keystore.properties` 都跟着仓库走，CI 不需要注入任何 secret，每次构建签出同一张证书。新包可以直接覆盖安装旧版，不需要卸载，工程不会丢。

- 证书：`CN=SuperSplat Debug, O=SinigLi, C=CN`
- SHA-256：`A0:6F:71:89:91:E1:51:E1:BB:A4:5F:7E:3F:E8:48:5D:17:3D:8A:9A:0B:10:91:40:2E:59:D6:58:1A:0E:9C:AF`
- `android/app/build.gradle` 的 `signingConfigs.stable` 读 `android/keystore.properties`（`storeFile` 相对模块目录解析，所以是 `keystore/ss-debug.p12`）
- CI 最后一步 `Verify signing certificate` 用 `apksigner --print-certs` 核对指纹：签名一旦退回「每构建一把新钥匙」，构建会直接失败，而不是把一个装不上的包静悄悄发出去

> **安全说明**：这是 **debug 密钥**，公开仓库里放它没有实际风险——它能签的只有 debug 包，任何人拿到也只能伪造 debug 包，装不到正式渠道。真正要保密的是 release 密钥（`*.jks` / `*.keystore`），那些仍然在 `.gitignore` 里。

**历史问题（已不再适用）**：四个 secret（`ANDROID_KEYSTORE_B64` / `..._PASS` / `..._ALIAS` / `..._KEY_PASS`）上传后，只有引用 `ANDROID_KEYSTORE_B64` 的 workflow 会 `startup_failure` 且 0 job；改用字面量、不存在的 secret 名、`GITHUB_TOKEN` 都能正常调度。定位到 secret 条目本身有问题，与 YAML 语法无关。最后没有绕这个坑，改成把密钥随仓库提交。`tools/ci/prepare_signing.sh` 因此已删除。

**过渡：这一次装仍要先卸载旧版**。之前那些包是用 CI 现场生成的临时密钥签的，与本仓库这把不同，所以从旧版升级到 v28d 仍会报「应用未安装」。**从 v28d 之后开始**，所有包签名一致，才能直接覆盖安装。

**换密钥**（例如密钥丢失）：重新生成 p12 并覆盖 `android/app/keystore/ss-debug.p12` + 改 `keystore.properties`，同时更新工作流里的指纹常量。注意：**换了密钥就意味着装过旧版的人必须先卸载**，所以非必要不换。

**为什么 CI 校验用 `grep` 前缀而不是整串**：`apksigner` 输出的指纹是不带冒号的 64 位十六进制，本文件记录的是带冒号的写法，前缀比对已经能覆盖整串，也容忍 apksigner 未来改输出格式。

## 7. 网络

| 场景 | 做法 |
|---|---|
| `git push` | `git -c http.proxy=http://127.0.0.1:7890 push origin main`（直连会 connection reset） |
| artifact 下载 | `tools/ci/dl_artifact.mjs` 分片 + 断点续传；必须用 Clash 代理 |
| token | 运行时从 `F:/openclawhome/openclaw/fullstack_workspace/githubapi.txt` 读第一行，**绝不写进脚本或输出** |
| `curl -L` 下 artifact | 会丢 Authorization 导致拿到损坏 zip，别用 |

## 8. 铁律

- **下新 artifact 前必须删 `.parts` 和 `_unzip`**：残留分片会让大小校验出现假的 MATCH/MISMATCH 混淆。
- **不要把 `dist/` 提交进仓库**（已在 `.gitignore`）。
- **`www/index.js` 是产物**：改代码请改 `supersplat-main/src/`，不要手改 `www/index.js`（它是压缩过的）。
- 长命令用 `*> logfile` 重定向再轮询，避免网关会话回收导致中断。
- 大文件下载/推送中途被打断，可能表现为假的 `401 Bad credentials`——先重试，别急着换 token。

## 9. 原生插件的坑（`SaveImagePlugin`）

- Capacitor 插件必须在 `super.onCreate()` **之前**注册（`BridgeActivity` 在那里 build bridge）。
- Android 10+ 写相册用 MediaStore + `IS_PENDING` 1→0，**不需要权限**；9 及以下需要 `WRITE_EXTERNAL_STORAGE`（清单里 `maxSdkVersion="28"` + 运行时申请）。
- 分享必须走 FileProvider，且路径要在 `res/xml/file_paths.xml` 声明（`cache-path` 已声明）。
- `ACTION_CREATE_DOCUMENT` 的字节要在 launch 与 `@ActivityCallback` 之间存字段，回调里写完再清空。
- 用户取消选择器时应 reject `"cancelled"`，让 UI 显示「已取消」而不是报错。
