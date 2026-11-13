# 构建与发版手册

> 版本：v55c（2026-11-10） · 适用：`supersplat-apk` + `../supersplat-main`
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
| v44~v44f | P1 原生解压：ZIP/7z/分卷（`.7z.001~NNN` 自然序拼接），流式写盘+进度+路径穿越防护；输出 `Download/摸鱼台/<同名>/`。修七处：commons-compress 1.26.2 API、`@ActivityCallback` 迁移（Capacitor 7 不再触发旧 `handleOnActivityResult`）、多 DEX 门禁、分卷断号预检、`org.tukaani:xz` 缺失导致的 `NoClassDefFoundError` |
| v45~v45x | **P2 三模式工程框架 + 视频/音频工作台**：新建工程三选一（`model`/`video`/`audio`）；AV 工程只持久化 SAF `folderUri` + 文件清单 + `marks.json`，不复制媒体；内嵌只读 HTTP Range 服务（仅绑 `127.0.0.1` 随机端口）；分割点/并入前段/多帧参考、半帧吸附、帧量化、rVFC fps 估算+手调；导出 `moyutai.marks.v3` 按段号降序 |
| v46 / v46c | 音频时频图（`av-viz.js`：dB 包络/气口检测/magma 语谱/对数频轴）；音频播放改走 WebAudio（`<video>` 对 WAV 直接 `MEDIA_ERR_SRC_NOT_SUPPORTED`）；v46c 语谱与时间轴对齐（统一 `EDGE=26px`，误差 1px）+ 去重模糊底板 + 音频模式深色文字 |
| v47 | **定位修复**：`serveRange` 用 `InputStream.skip()` 定位，provider 给管道流时退化为「读掉 N 字节」，成本 O(偏移)。改 `ParcelFileDescriptor` + `Os.lseek` + `AutoCloseInputStream`：439MB 处 391.2ms → 1.8ms（后半段约 220×）。新增 `SEEK-SLOW`/`SEEK-SUM`/`MEDIA-STATS` 诊断 |
| v48 | 缩略图捕获视频声明 `crossOrigin='anonymous'`（跨源 canvas 污染 → `toDataURL` 抛 `SecurityError` 被吞成 `canvas err`） |
| **v48c** | **ISS-001 关闭**：缩略图三个 JS 缺陷叠加（开关被 `thumbsRev='p1'` 永久关死；`thumbFlush()` 每次列表重建清空解码队列；`thumbApply` 的 `isConnected` 早退误杀缓存命中）。另修 seek 锁死（`_seeking` 只靠 `seeked` 解锁 → 改用 `videoEl.seeking` + 1500ms 看门狗 + 重追上限 2）、同片段不重载、`renderList` 签名短路。probe-v45 48/48、v44 16/16，真机确认 |

| v48d | 视图导航双模式：`navMode` 默认 `game`，缩放走 `exp(-amount × rate)` 且上下限按场景缩放（D_fit 的 0.02/8 倍）；`model` 保留原几何缩放与绝对上下限。配套 `clampDistance`、`dFit`、`suggestedStep`（1-2-5 吸附）、`camera.navMetrics`；dock 视口面板加模式切换 + 自适应步进 + 重置，偏好存 localStorage |
| v48e | 修正 v48d 的两个缺陷：`gameZoomRate` 0.35→0.8（原值与建模模式只差 10%，真机无法分辨）；`setPointerCapture` 包 `safeCapture()`（抛错会中断 `pointerdown`，导致触点记录不了、双指彻底失效）。游戏 0.20 倍/捏合 vs 建模 0.445 |
| v49 | **图片模式（第四工程模式）**：新建工程四选一（`model`/`video`/`audio`/**`image`**）；工作台双层 canvas（图片层只在视图变换重绘、蒙版层只在笔画变化重绘）；涂抹/多边形/橡皮/撤销/重做/反选；笔画以路径数组持久化（`moyutai.imgmask.v1`，每笔一存），图片按内容寻址入 `files/<sha1>.<ext>`；导出按原图尺寸合成 PNG（挖除区 alpha=0）走 `SaveImagePlugin.share`，与 3D 机位同链路，**零新原生插件**。新增 `www/img-store.js` + `www/img-ui.js`，`av-store.js` 不动（其 mode 校验严格，塞 image 会搅动已稳定链路） |
| **v49b** | 图片模式真机三条反馈定稿：① 顶栏避让系统状态栏（`MediaServer.getSafeArea` 物理 px ÷ dpr、超 48 视为旋转脏值归零、延迟重读 + resize/orientationchange 自愈、内联 padding；**必须 `box-sizing:border-box`**，否则 `height` 与 `padding-top` 相加实测 100px）；② 多边形由「逐点点击 + 双击结束」改为**套索**（拖动画一圈、松手自动闭合，拖动中不入撤销栈）；③ 涂抹深浅不一**不是厚度控制而是渲染缺陷**——蒙版每笔 `rgba(...,.82)` 叠加，同处涂 N 遍 = `1-(1-.82)^N`，改为每笔 `alpha=1` + 整层 CSS `opacity:.82`。另修门禁脚本误报：`accept` 缺席检查的正则把解释该约束的注释也匹配了，改结构性断言。探针 21/21 |
| v49c | 图片模式返回按钮失效修复 | 返回前 | `open()` 内联写死 `display:flex`，`back()` 只删 `.open` 类 → 内联样式仍生效、图片页继续盖在列表上，表现为「点返回没反应」；补 `page.style.display = 'none'`（`open()` 失败兜底同补，否则用户被留在半死页面且无返回入口）。探针加 4 条往返断言并把运行时异常计入失败，顺带修掉 `applySafeArea` 延迟重读的 `TypeError`（插件存在性只在入口查一次，定时器回调空手敲门）。`av-ui.js` 无此问题（一直有这行）|
| v49d | 恢复图片模式 mode 契约（v49c 交付时门禁报警） | 提交后 | 整理代码时删除了 `upsertProject`，连带删掉了 `img-store` 里唯一的 mode 校验；`loadMeta` 读侧仍过滤但 `saveMeta` 写侧失守，坏 meta 会变成永远读不出的死数据。校验移到写侧：`saveMeta` 拒收 `mode!=='image'`，`img-ui` 的 `saveStrokes` 兜一层（笔画已落盘不因 meta 契约中断）。门禁断言改为读/写双向检查。另：交付脚本路径替换失误（`temp/` 拼出 `temp/tools/ci/`）导致第二次失败，从断点续做 zip+飞书，未重跑 CI |
| v50 | 982c28b | 图片模式大版本：遮罩分层(moyutai.imgmask.v2，含 v1 自动迁移)、换图确认弹窗、分享双模式(默认 PNG/分层 ZIP，隐藏层不导出)、工具栏四边拖拽停靠+左侧撤销条。坑：String.fromCharCode.apply 超 64KB 参数上限炸大 zip → 分块 base64；setupDockDrag 定义未调用 → 拖拽全失效，探针抓出。 |
| v50b | 061dec5 | 真机反馈修复：图层整行可点激活（原只有名字可点）+ 激活高亮加强；保存改手动（编辑标脏、标题●、返回三选确认）。 |
| v50c | (本次) | 两侧工具组 ⠿ 把手拖拽吸附（右 dock 四边 + 左撤销条四边独立持久化）、左条纵向滚动。 |
| v51 | 分镜清单适配：视频工程关联「分镜清单.csv」（镜号/多参考图），镜号 1..N 连续且数量与视频一致时自动打多参点（CSV 0-based → 显示 1-based）；首次单文件授权持久化，之后全自动；不匹配/缺文件完全跳过。新文件 www/storyboard.js（纯逻辑+27单测）+ MediaServerPlugin.pickCsv/readText。 |
| v51b | 真机反馈：GBK/UTF-8 CSV 编码兼容（BOM 探测→严格 UTF-8→GBK→Latin-1 回退，返回 charset/byte 元数据）；诊断暂走既有 DebugLog |
| v51c | 真机日志定位：自动弹文件选择器被取消 4 次导致从没关联上 CSV。改为手动「📋」按钮关联/换绑 + 打开工程无关联时一次性引导提示；砍掉独立 sb-diag 存储与剪贴板手势，统一走 DebugLog |
| v51d | 多参点不显示根因：storyboard 匹配用数字 seq，UI 严格等值比较字符串 label → 全部失配。applyStoryboard 做 seg→label 归一 + 左列表补「▦ 多帧点」徽标 |
| v52 | 工程列表文件夹式分组：嵌套分组（registry.groups）、面包屑、500ms 长按/右键多选、底部「新建分组/移动到分组」、层级移动校验。新文件 www/groups.js（纯逻辑+27单测） |
| v52b | 真机反馈两 bug 同根因：upsertProject/removeProject 重建 registry 丢 groups 字段 → 分组消失/新工程落根目录；改为全字段保留+新工程落当前分组。分组卡 🗑 三选删除（仅解除分组/完整删除/取消），groups.js 补 dissolve/deleteGroupDeep |
| v52c | 多选体验：长按自动选中 + 卡片左侧 ☐/☑ 复选框引导；空文件夹底部条漂浮根因 = emptyEl 在 DOM 排 gbar 之后被 flex:1 顶起 → 移到 gbar 之前 |
| v53 | 角色打标全链：视频页 🎭 角色卡对话框（工程独立卡库 moyutai.charcards.v1，JSON 导入导出）；⚑ 打标按钮四分支目标帧解析（分割点>多帧点>段首帧，并入前段 toast 拒绝）；复用图片编辑页打标模式（帧截图底图、一角色一层、双描述、顶部确认/取消）；笔画存 av-tagmask-*（imgmask.v2 结构），确认入 marks(char_ref)；导出时栅格化（抽帧→白区透底 PNG→sha1 落 files/）→ 有遮罩 fflate zip（marks.json + masks/<target>/<frame>_<cardId>.png），无遮罩裸 JSON 不变（v3 字节级兼容）。新文件 www/charcards.js（32 单测）+ tests/export-chars（23 测）+ probe-v53 m3/m4/m5（33/31/17） |
| v53b | 真机五条反馈：视频页顶部 🎭 角色卡 chip；打标模式专用顶栏（普通图片编辑受 tagMode 保护）；修当前帧白屏（baseCv/maskCv 同步尺寸+帧画布 blit）；img-ui/av-ui 接入 DebugLog。CI 三连 504 后 Gradle 换腾讯镜像源 |
| v53c | 真机 debug_18 三连：抽帧失败日志引用错变量（`e is not defined`）、tagbar 输入框声明缺失（`tagOrigIn`）、`renderPos()` innerHTML 清空吞掉角色 chip → 失败日志移入 catch + 模块级声明 + `mkCharChip()` 工厂重挂 |
| v53d | 打标底栏重设计：角色改 select 下拉；grp 圆角按钮两行；取消打标清描述+层笔画；tagbar/row/select CSS 注入 `IMG_CSS`（此前裸横排溢出） |
| v53e~v53m | 打标工具条收敛为右上停靠 dock（与左右工具条同视觉、⠿ 拖拽吸附、安全区适配）；确认/取消移入停靠栏、顶部横条隐藏；「隐藏打标」同步图层眼睛；层面板打标态只读 |
| v53t~v53z | 保存/恢复链路骨架日志期：`tag: save/load/redraw` 三段日志（key/layers/strokes/visible/canvas）；debug_18/19 实锤「数据有、画面无」与「最后一笔未落盘」两类根因 |
| v54 | **最后一笔丢失修复**（debug_19：strokes=2 从未落盘）：tagMode 下 applyAndPush 即画即存 `saveTagStrokes()` + finishTag 确认前强制落盘，双保险 |
| v55/v55b | 恢复对齐第一个遮罩层（activeId+下拉）；全部停用确认=移除该点位 char_ref（角标消失、分镜打点保留、双 key 草稿清除） |
| v55c | 下拉/层高亮同步终修：根因 = openTagMode 收尾「默认激活第一个启用角色」无条件覆盖恢复态 + switchTagLayer 从不回写下拉。改为**单一事实源 activeId**：切层统一回写下拉，收尾仅无恢复层时才默认激活。老板 00:21 真机确认 |
| v56 | 角色打标遮罩导出极性修复第一版（黑底+抠洞，未生效一半） |
| v56b | 极性修复完成：离屏白形+单次 destination-out 抠洞（老板 01:40 包实锤） |
| v57 | 导出时旧遮罩自动重打（草稿层存在才重打，防黑图）；导出恢复带 zip |
| v57c | 空笔画层不导出遮罩（防纯黑图混入 zip） |
| v58 | 全局角色卡库+工程引用切换（缺角色警告）；遮罩导出 masks/段/帧号/角色名.png |
| v58b | 切换弹层乱码标签修复 |
| v59 | 角色卡系统 v2（原型 r3 实装）：descGroups 词库两段式分组、头像图片、zip 导入导出（chars/ 文件夹）、开始页/视频页统一移动端 sheet UI；打标描述下拉读词库分组；旧 v1 只读迁移不反向兼容 |
| v59i | 诊断日志全链：开始页角色卡按钮 + cardgroups-ui 全流程（`[pj]`/`[cg]` 走 Capacitor DebugLog），补 JS error / unhandledrejection 捕获（debug_xx 无日志时的定位手段） |
| v59j | 旧 WebView 丢 `inset:0` 简写（Chrome 87+ 语法），cgm-sheet 计算成隐形 → 全部展开为 `top/right/bottom/left`，mask 同步，z-index 120→2000；av-ui / img-ui 同批处理 |
| v59k | 「🖼 导入图片文件夹」批量建卡组；角色库默认空；视频页 🎭 改为纯组选择器（无引用时先选组再开对话框） |
| v59kb | 真机 `No content provider: primary:0/...`：readBytes 改为原生 `docUriForId(tree, docId)` 构造（字符串往返会退化成 docId）；组名取路径末段；cache 提到 v60 |
| v59kb2 | 删组后同名重建误报「角色已存在」：registry 幽灵项自愈 |
| v60b | 三条 UX：默认词库分组固定置顶、导出走原生分享面板、打标顶栏重做 |
| v60c | 原始角色图贯穿导出（`chars_full/` 一并进 ZIP，扩展名按 mime 嗅探）；打标栏停靠化 |
| v60d | **原图迁 IndexedDB**（`moyutai-cg-full` / store `cards` / 键 `groupId::cardId`），localStorage 只留 256 头像——debug_23 的 `QuotaExceededError` 根因是 11 张全尺寸 base64 塞爆 5MB 配额 |
| v60e | 两条打标栏半屏外 / 纵向叠在一起：`.img-dock` 基础 CSS 泄漏进两条 bar |
| v60f | 打标遮罩层可删到 0 层；确认时 0 层 = 清掉该帧角色打标（char_ref 移除，分镜打点保留） |
| v60g | 层面板删除入口收敛：保留顶栏垃圾桶，去掉行内 ✕ |
| v60h | 打标绘制只认「有活动遮罩层」；旧的 per-card enabled 门禁彻底移除（状态唯一事实源 = layers + activeId） |
| v60i | 无遮罩的角色层也把名字 + 描述写进 marks.json（char_ref 保留、mask 缺省） |
| v60j | 首轮打标导出丢遮罩：草稿 key 不匹配（`seg_frame` vs `char_ref.id`） |
| v61a | 视频导出打包引用卡组（复用 `CC.exportPlan`）：marks zip 内附 charcards.json + chars/ + chars_full/ |
| v61b | 统一进度浮层 `www/progress.js`（`window.Prog`：固定深色遮罩 + 渐变条 + 百分比 + 文案，show/set/done/hide），接入图片文件夹导入、卡组 ZIP 导出/导入、视频导出；失败与取消路径都要 hide。卡组图片回查改为 `_lookupImg`（原路径 / 去 chars\_full 前缀 / basename 三档） |
| v61c | 卡组导入必须可靠接受 ZIP：无后缀 ZIP 按 PK 魔数判定、charcards.json 允许在子目录、ArrayBuffer 走 TextDecoder（BOM 剥离）、`accept=*/*` 防 Android SAF 过滤掉 ZIP、明确拒绝 marks JSON |
| v61d | 导出 charcards.json 内嵌头像 `img`，单独拿这份 JSON 导入也有图（原图当时仍只有路径引用） |
| v61e | 再把原图 `imgFull` 也内嵌（当时带 2.5MB 上限，v61f 已删） |
| **v61f** | **「只导 JSON 原图不回来」真因**：导入借图只读 `CCG.list()`，而它返回的是 localStorage 精简副本——原图早在 `CCG.saveData()` 里被 `CGFull.stripFull()` 剥进 IndexedDB，所以永远借不到（日志 `borrowed avatars=11` 但原图 0 张，新组只有头像，再导出自然没有 chars_full）。改为逐组 `await CGFull.all(gid)` 借 img + imgFull（日志 `borrowed avatars=N originals=M`）；`applyImport` 返回 Promise，两处调用都等借用完成才落盘；删除 2.5MB 上限，`exportPlan` 一律内嵌原图；`exportGroup` 抽出 `mergeFulls` 合并 IDB 原图并打印 json 字节数 / inlineFull / images |
| **v62** | **视频导出 92% 闪退**（debug_28：只有一行 toast，无 JS 异常）：不是代码抛错而是 **WebView 渲染进程被 OOM 杀掉**。三重内存放大：① `exportPlan` 内嵌 base64 原图，而视频 ZIP 本就带 `chars_full/` 二进制 → 同一份原图在内存里三份；② `captureTagFrame` 每条 char_ref 新建 4K `<video>`（20 条 = 20 个解码实例 + 每帧 33MB canvas）；③ canvas 不释放、轮次间不让 GC。修法：`exportPlan(f, opts)` 加 `opts.inline`（卡组库导出仍内嵌，视频导出传 `{inline:false}` 只写路径）；抽帧改单例解码器 + 串行队列，遮罩处理完立刻释放；`releaseCanvas` 逐张归零 + `yieldToGC`；b64 改分块。日志：全链路 `mark()` 带耗时与 JS 堆，zip 前打印最大 5 个条目，关键日志 `dlogAw` 等待落盘（闪退也留痕） |
| **v63** | **导出包超限自动分卷**（原阈值 30MB，v64 已上调）：视频打标包带原图后可达 40MB，当时飞书单文件上限 30MB。规则与发版脚本一致——>30MB 按 25MB 一卷切开（留 5MB 余量），≤30MB 沿用原 shareFile。新增 `www/shareout.js`（`window.ShareOut.send`）：切卷用 `subarray`（不复制整块），逐卷 3MB 分片写 `CacheDirectory/shared/`，再 `SaveImage.sharePaths` 一次多选分享（`ACTION_SEND_MULTIPLE`，不逐卷弹面板）；卷名 `<原名>.001/.002`，与解压中心 `stripVolume` 规则一致，丢进「🪓 解压」即可拼回。坑：`putExtra(EXTRA_STREAM, ArrayList<Uri>)` 会匹配 Serializable 重载导致运行时失败，必须 `putParcelableArrayListExtra`；`String.join` 是 API 26+（minSdk 23） |
| **v64** | **分卷阈值随上游上调到 500MB / 450MB**（老板 2026-11-13 把 OpenClaw 侧单文件上限从 30MB 改成 500MB）：`ShareOut` 的 `LIMIT` 500MB、`VOL` 450MB（留 50MB 余量）。新增判据 `canSplit()`——必须同时有 `Filesystem`（能写 Cache）和 `SaveImage.sharePaths`（能一次多选分享）才分卷；否则**不切，整包单发**（`mode: single-oversize`）并提示「超过传输端上限，可能发送失败」。删掉了 v63 的「无 sharePaths 时逐卷 shareFile」兜底：拼不回来的碎片比一个完整的超限文件更糟。UI 文案改为按 `volumeSize()` 实测卷大小拼。缓存号 v77→v78。探针：`tests/probe-v64.cjs` 50 项（含 canSplit 三态与字节级拼回）、`probe-v63.cjs` 37 项同步修断言 |

> v32~v43、v45 各子版的逐条明细在 `docs/DIRECTOR.md` §8「版本记录」。
> v48d/v48e 的完整设计与踩坑记录见 `docs/VIEWPORT-NAV.md`。
> v49/v49b 的设计、决策与验证口径见 `docs/IMAGE-MODE.md`。
> v63 的分卷导出规则与兜底链路见 `docs/SHARE-SPLIT.md`。

## 6. 已知坑（血泪版）
- **门禁脚本必须随仓库走**——v49 门禁最初是 `temp/v49-gate.cjs` 临时文件，整理代码后没人同步它，出现「代码删了函数、门禁还在找函数里的字符串」的假失败。现为 `tools/ci/verify_v49.cjs`，改代码必须同步改门禁。
- **交付脚本改路径别用全局字符串替换**——v49d 事故：把 `v49-gate.cjs` 全局替换成 `tools/ci/verify_v49.cjs`，把 `WS + '/temp/v49-gate.cjs'` 也一起换成了 `WS + '/temp/tools/ci/...'`，路径多一层 `temp/` 直接 MODULE_NOT_FOUND。改路径先打印替换后的完整结果再执行。
- **只删 class 不清内联样式 = 页面关不掉**——v49c 事故：`open()` 为绕开样式表缓存把 `display:flex` 内联写死，`back()` 只 `classList.remove('open')`，内联样式仍然生效，页面继续盖在上面，表现为「点按钮没反应」。凡是内联设过 `style.display` 的容器，关闭时必须显式复位。

- **发版前核对发送路径与 APKBASE 一致**——v30 事故：打包改名了、feishu --file 没改。
- PowerShell `>` 重定向写 UTF-16LE；`cd` 不改 .NET 进程工作目录（`[IO.File]::ReadAllBytes` 要绝对路径）。
- CDP 截图后 WebView 无 preserveDrawingBuffer，隔帧 toDataURL 是黑的。
- 真机 CI 签名：workflow 内 `Verify signing certificate` 步骤已校验固定调试证书（`keystore/ss-debug.p12`），覆盖安装不再报「应用未安装」。
- WMI 启动的后台任务父进程是 WmiPrvSE，不受 exec Job Object 连坐；**不要** WMI+stdout 重定向，日志由脚本自写。
- **门禁断言别用全文关键字匹配**——v49 事故：检查「file input 不带 `accept`」的正则 `/type \*= *['"]file['"][^>]*accept/` 把注释里解释该约束的 `accept` 字样也匹配了，导致全绿代码被判失败、白等一轮 CI。改结构性断言（`!/.accept\s*=/`），或锚定到具体元素的属性。
- **`--registry` 救不了 lock 文件里的 resolved**——v55b 交付事故（2026-11-09）：npmmirror E500（yauzl tgz 表损坏），`npm ci --registry=官方` 照挂——package-lock.json 的 `resolved` 写死了镜像域名，registry 旗标不改变它。workflow 加 `sed` 改写 lockfile 域名兜底（`build-apk.yml`）。诊断套路：CI 挂在依赖安装时先用 jobs API 查失败步骤 + 拉日志原文，别盲目重跑（本次盲目重跑烧掉两轮 CI）。
- **分享/上传前先看目标平台的大小上限**——v63：视频打标包 40MB，飞书拒收 >30MB，用户在分享面板里选完会话才失败，白等一轮。凡是「导出 → 分享给外部」的链路，先在本地判定体积并按目标上限切卷；切卷名必须能被接收方/解压方识别（本项目沿用 `.001/.002` + `ExtractPlugin.stripVolume`）。
- **Capacitor 原生桥别用 `putExtra` 塞 Uri 列表**——`Intent.EXTRA_STREAM` + `ArrayList<Uri>` 会解析到 `putExtra(String, Serializable)` 重载，`Uri` 不是 Serializable，运行时抛异常。多文件分享必须 `putParcelableArrayListExtra`，且 `minSdk 23` 下不能用 `String.join`/`List.of` 这类 API 26+ 的语法糖。
- **进度卡在某百分比、日志戛然而止 = 进程被杀，不是抛错**——v62 事故（2026-11-13）：视频导出在 92% 消失，`DebugLog` 里连 `JS-ERR`/`REJ` 都没有。判断依据：全局 error/unhandledrejection 兜底没记录任何东西 → JS 从未走到抛错分支 → 渲染进程被系统 OOM 杀了。应对：① 关键日志必须 `await` 落盘（`dlog` 是 fire-and-forget，进程一死全丢）；② 排查「同一份二进制在内存里出现几次」——本案例是 base64 字符串 + ZIP 条目 + 最终 zip 三份；③ 4K canvas 33MB/张、每条 ref 一个视频解码器，都是必爆的组合。
- **导出的 JSON 不该重复 ZIP 里的二进制**——v62：`charcards.json` 内嵌 base64 是为了「单独拿 JSON 也能恢复」（卡组库需求），但视频打标包本身已经带 `chars/ + chars_full/`，再内嵌等于把同一份原图在内存里复制三遍。凡是「ZIP 里已有该文件」的导出路径，JSON 只写路径引用。
- **localStorage 里的只是派生副本**——v61e→v61f 连环返工（2026-11-12）：`CGFull.stripFull` 在 saveData 时把 `imgFull` 剥进 IndexedDB，任何只读 `CCG.list()` 的逻辑都拿不到原图。凡是要「复用已有卡组里的原图」，必须 `await CGFull.all(groupId)`；只读 list 的代码能跑、日志也像成功（`borrowed avatars=11`），但原图 0 张——**日志要分别记头像数和原图数**，混在一个数字里会掩盖问题。
- **导出的 JSON 体积随原图线性增长**——v61f 取消了 2.5MB 内嵌上限（老板要求单独导 JSON 就能完整恢复），代价是一套 11 角色 × 原图 2MB 的卡组会导出 ~30MB 的 charcards.json。日常分发仍以 ZIP 为首选（ZIP 里既有内嵌 JSON 也有 chars\_full/ 文件）；卡片数量大的库要提前提醒用户。
- **派生视图必须从事实源回写**——v55/v55b 连环返工（2026-11-09~10）：角色下拉是 activeId 的派生视图，却在恢复段和收尾段各自写一遍，收尾「默认激活」无条件覆盖恢复结果。修法：单一事实源（activeId），任何切层路径统一经 `switchTagLayer` 回写下拉；初始化顺序里"默认值"只允许在"无既有状态"时生效。
- **半透明不要画在 primitive 上**——v49b 事故：预览蒙版每笔 `rgba(...,0.82)` `source-over` 叠加，同一处涂 2 遍变 96.8%、3 遍 99.4%，被当成「厚度控制」。层内叠加 + 层统一半透明的场景，透明度放层上（CSS `opacity`），primitive 一律 `alpha=1`。
- **`height` 与 `padding` 相加**——`box-sizing` 默认 `content-box`，动态设 `height:52+inset` 再加 `padding-top:inset` 会得到 `52+2×inset`。凡是要「内边距从高度里吃」的容器，样式里必须写 `border-box`。
