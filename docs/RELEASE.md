# 构建与发版手册

> 版本：v31（2026-10-30） · 适用：`supersplat-apk` + `../supersplat-main`
> 相关：`docs/DIRECTOR.md`（导演台）· `docs/PROJECTS.md`（工程管理）· `docs/BACKLOG.md`（问题清单）

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
- git push 走代理 `http://127.0.0.1:7890`；凭据失效时用显式 URL（token 从 `githubapi.txt` 运行时读、不回显，见 `F:\openclawhome\openclaw\fullstack_workspace\temp\push-v29.ps1` 模板）

## 2. 改引擎后的同步（最容易出错的一步）

```bash
cd ../supersplat-main
npm run build                         # rollup，约 30–40s；TS 错误看输出（cullMode 等 d.ts 缺字段用 as any 断言）
node tools/ci/sync_dist.cjs           # 在 apk 仓库根执行：镜像 dist → www，覆盖层受保护
```

**不要手动 `cp`**：`sync_dist.cjs` 带覆盖层保护清单（`www/dock.js` / `dock.css` / `mobile.*` / `index.html` / `projects.*` / `fflate.js`），并输出引擎标记自检（`gizmo.drag` 等在 `index.js` 里是否 FOUND）。

同步后**必须确认 `www/index.js` 含新 API 标记**再提交（v31 教训：改了引擎忘同步 = CI 打出旧引擎的包）：

```bash
node -e "const t=require('fs').readFileSync('www/index.js','utf8');
['copySelectedToCursor','spawnBox','listSplats','setClipRange','resetViewport']
.forEach(m=>console.log(t.includes(m)?'ok '+m:'MISS '+m))"
```

## 3. 验证
### 3.1 headless 回归（提交前必跑）

```bash
cd projects/supersplat-apk      # 必须在仓库根执行，静态服务根 = cwd
node tests/director.mjs         # 期望 === 16/16 passed ===
node tests/v13.mjs              # 期望 === 15/15 passed ===
node tests/project.mjs          # 期望 === 27/27 passed ===（v29 内容寻址断言）
node tests/probe-empty-project.mjs   # 9/9
node tests/probe-v29-migrate.mjs     # 13/13（legacy zip 流式迁移）
node tests/probe-v30.mjs        # 24/24（方块/泼溅行/裁剪/复制/视口重置）
node tests/probe-v31.mjs        # 13/13（方块入下拉/纯图标/原生列表隐藏/滑轨）
```

脚本自起 `tools/dev/staticsrv.cjs` 与 headless Edge（WebGPU/ANGLE），端口各套件错开（4197–4200 / CDP 9257–9260）。跑完自动退出，约 30–60s/个。

**注意**：桌面 headless 走 IndexedDB，没有目录概念——原生分支（Capacitor 路径、appendFile/父目录）的改动桌面测不出，必须真机验一轮。

### 3.2 构建链自检

```bash
node tools/ci/ci-poll.cjs <sha> [timeoutSec]     # 等 CI，输出 run=... status / CI: success
```

## 4. 发版流水线（省钱模式：后台一条龙）

推送后「等 CI → 下 artifact → 解包 → verify → 打 zip → 发飞书」整链写成
`F:\openclawhome\openclaw\fullstack_workspace\temp\deliver-v29\run.cjs`（改 APKBASE/文案即复用），WMI 启动：

```powershell
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine = 'cmd /c cd /d "F:\openclawhome\openclaw\fullstack_workspace" && node "temp\deliver-v29\run.cjs" <sha>'
}
```

流水线步骤（每步写日志 `temp/deliver-v29/run.log`，失败自动发飞书告警）：

1. 等 CI（最长 40 分钟，20s 轮询 GitHub API，token 运行时读 `githubapi.txt`）
2. `dl_artifact.mjs` 分片下载（**先清残留 `.parts/`**；下载输出路径必须在已存在的目录，ENOENT 教训 ×2）
3. `unpack_apk.cjs` 取出真 APK
4. `verify_v14.cjs` + 版本标记核验：
   - v29：`projects.js` 含 `migrateLegacyProject`
   - v30：`index.js` 含 5 个引擎 API
   - v31：`dock.js` 含 4 个 UI 标记（`__box` / `sd-clip-slider` / 原生列表隐藏 / `sd-mv-btn`）
   - **缺任何标记直接拒发**（v30 发错包事故的制度化修复：当时发送路径没跟着 APKBASE 改，把旧包重发了一遍）
5. `tar -a -cf media/supersplat-vXX.zip` 外层 zip（飞书拒收 .apk）
6. `python tools/feishu_send.py --file … --text …`（发送 + 文案；30MB 自动 7z/分卷）

发完后读日志确认 `msg=om_...` 回执即完成。

## 5. 版本历史（v29+）

| 版本 | 内容 |
|---|---|
| v29 | #2 根治：内容寻址存储（project.json + files/<sha1>）、去重、零 base64 读写、旧工程流式迁移 |
| v29b | 真机 `Missing parent directory` 修复：appendFile 带 recursive、迁移先建档 |
| v30 | 全局等待进度条；#1 新建重置视口；#3 移动模型分组+复制到游标；#4 泼溅行统一+直接删除；#5 手动裁剪；#6 方块（独立按钮版） |
| v31 | 老板真机反馈四条：方块入角色下拉、两钮纯图标+组名改「移动」、场景页隐藏 SS 原生泼溅列表（REMOVE SPLAT 弹窗根因）、双头滑轨（对数映射） |

## 6. 已知坑（血泪版）

- **发版前核对发送路径与 APKBASE 一致**——v30 事故：打包改名了、feishu --file 没改。
- PowerShell `>` 重定向写 UTF-16LE；`cd` 不改 .NET 进程工作目录（`[IO.File]::ReadAllBytes` 要绝对路径）。
- CDP 截图后 WebView 无 preserveDrawingBuffer，隔帧 toDataURL 是黑的。
- 真机 CI 签名：workflow 内 `Verify signing certificate` 步骤已校验固定调试证书（`keystore/ss-debug.p12`），覆盖安装不再报「应用未安装」。
- WMI 启动的后台任务父进程是 WmiPrvSE，不受 exec Job Object 连坐；**不要** WMI+stdout 重定向，日志由脚本自写。
