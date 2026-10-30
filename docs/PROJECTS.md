# 工程管理（Projects）— 存储、格式与双页 UI

> 版本：v31（2026-10-30） · 维护者：全栈工程师
> 代码：`www/projects.js`（存储与格式）· `www/projects-ui.js`（列表页 / 编辑页 / 对话框 / 等待层）· `www/projects.css`
> 关联：`docs/DIRECTOR.md`（场景快照的来源）· `docs/RELEASE.md`（发版）

## 1. 它解决什么

Android 的 SAF 路径授权**只在一个会话内有效**，工程里只存模型路径的话，重开必然找不到模型（splat-viewer v0.3.x 的真实事故）。所以模型字节必须落在工程内——但 v28 的「自包含 zip」方案在真机上死了：

> 86.4MB 的 GLB 存两份 → 173MB 的 zip → `readFile` 返回 230MB base64 字符串 → WebView 堆 OOM（BACKLOG #2，2026-10-30 已真机验证修复）。

v29 起改为**状态与字节分离 + 内容寻址**：小 JSON 存状态，模型字节按 SHA-1 单独落盘、天然去重，读写全程零 base64 大字符串。

存储落在 **App 私有目录**（Capacitor `Directory.Data`），免存储权限，卸载才丢。

## 2. 目录与索引（v29 布局）

```
Directory.Data/                                  ← App 私有，免权限
  projects/<encodeURIComponent(名字)>/
      project.json                               ← 纯状态（几 KB），v29 主文件
      files/<sha1>.<ext>                          ← 内容寻址的模型/道具字节
      thumb.jpg                                   ← 列表缩略图（320×180 JPEG）
      meta.json                                   ← 自描述记录（名字/时间/有无模型）
      project.svproj                              ← v28- 的自包含 zip，打开时自动迁移后删除

localStorage['ss-registry'] = {"projects":[{name, updatedAt, hasModel}, ...]}
```

- **同一字节只存一份**：两个道具各持一份相同 GLB → 一个 `files/<sha1>.glb`，state 里两条引用指过去。#2 的 173MB 工程迁移后 ≈ 86.4MB。
- **hasModel 口径（v29 修正）**：`!!(snap.model || snap.props.length)`——GLB 道具也算有模型。v28 只认 splat，纯 GLB 工程错标「空工程」。
- **meta.json** 仍是磁盘自描述副本；目录扫描重建列表**仍未实现**（见 §7）。
- 工程名直接做目录名，`validateProjectName()` 禁止 `/ \ : * ? " < > |`，长度 ≤ 50。

## 3. 工程状态格式（`project.json`）

直接来自 `director.projectSnapshot()`：

```json
{
  "version": 1,
  "model": { "name": "scene.ply", "path": "files/<sha1>.ply" },
  "puppets": [{ "name","charId","pos","rot","scale","tint","clip","locked","visible" }],
  "props":   [{ "name","file": "files/<sha1>.glb", "pos","rot","scale","locked","visible" },
              { "name","kind": "box", "boxSize","boxColor","boxBorder", "pos","rot","scale","locked","visible" }],
  "shots":   [{ "id","name","pos","target","fov" }],
  "camera":  { "pos","target","fov" },
  "cursor":  { "pos","on" }
}
```

- **`version` 必须是 `1`**：`restoreProject()` 第一行就是 `if (!t || t.version !== 1) return 'bad-version'`。方块走 `kind:'box'` 扩展字段，**不升版本**（v30 拍板：老快照可读，新快照老代码忽略 box 字段）。
- 机位存**解析后的位姿**（eye/target/fov），不存轨道参数——`sceneRadius` 会随导入模型漂移（见 `docs/DIRECTOR.md` §4.1）。
- `model` 为空表示空工程（`null`）。
- `files/<sha1>` 引用是**存储路由不是用户状态**：脏检查不比它（活动快照的 file 永远是合成的 `props/<i>.<ext>`，直接比必假脏）。

## 4. 三条主流程

### 4.1 新建（v30：+视口重置 +等待层）

```
createProject(name)
  ├─ clearScene()
  ├─ director.resetViewport()            ← v30 #1：相机/基准点/游标/手动裁剪全部归零，
  │                                        不再继承上一个工程的视角
  ├─ write project.json (emptyProjectState)
  ├─ write meta.json · registry.upsert
  ├─ hideWait() → showEditorPage()
  └─ lastSavedSnapshot = snapshotNow()
```

### 4.2 保存（内容寻址落盘）

```
saveProject()
  ├─ showWait('保存工程…')                ← v30 全局等待层，分阶段文字 + 耗时
  ├─ snap = director.projectSnapshot()
  ├─ model.bytes → putContentFile(ext) → files/<sha1>.<ext>   ← 已存在同哈希则跳过（跨保存去重）
  ├─ 每个 prop.bytes → putContentFile()  ← 同一 GLB 放 N 个只落一份；state 里记引用
  ├─ write project.json（纯状态，几 KB）
  ├─ thumb → write thumb.jpg
  ├─ meta.json · registry.upsert
  └─ hideWait() → toast('已保存 … 状态436B · 模型86.4MB · 12.3s')
```

`putContentFile()`：SHA-1 命名（`crypto.subtle`，不可用时 FNV-1a+长度保底）、写后 `stat` 校验字节数，杜绝静默截断。

### 4.3 打开（含旧格式自动迁移）

```
openProject(name)
  ├─ showWait('打开工程：读取数据…')
  ├─ read project.json
  │    ├─ 成功 → v29 工程
  │    ├─ 失败但存在 project.svproj → 流式迁移（见 §4.4），迁移完旧 zip 已删
  │    └─ 失败且无任何文件（v28 空壳注册表残留）→ 按空工程恢复并补写
  ├─ clearScene()
  ├─ setWait('载入模型…')
  ├─ 按引用逐个 readViaUri(files/<sha1>)   ← 按需读，不整体加载
  ├─ importModelBytes() → director.restoreProject(state, files)
  └─ hideWait() → showEditorPage()
```

`restoreProject()` 先销毁现有人偶/道具/机位再重建，**不走撤销栈**。方块道具（`kind:'box'`）直接 `spawnBox` 重建，不查 files。

### 4.4 旧工程流式迁移（`migrateLegacyProject`）

v28- 的 173MB zip 若整包读入必 OOM。管线（任何时刻内存 ≈ 3MB 写盘缓冲 + 几 KB state）：

```
fetch 流 → fflate 流式 Unzip → 条目字节攒缓冲 → 满 3MB append 到
files/.tmp-N.part（增量算 SHA-1）→ 条目流完 rename 成 files/<sha1>.<ext>
（目标已存在且等长 → 删临时件，内容寻址天然去重）
→ 全部迁完写 project.json → 删旧 project.svproj
```

实测要点（`temp/fflate_probe.mjs` 验证过）：
- fflate 必须 **`file.start()`** 才吐数据；`onfile` 是属性赋值，构造回调不触发
- `ondata` 同步回调，一批数据可能连完多个小条目——用「多条目登记表」而不是「单当前条目」
- 首次 flush 前 `write` 空临时文件：建 `files/` 父目录 + 截断上次中断的残尾（**真机 v29 首发翻车点**：`appendFile` 不带 `recursive:true` 不建父目录，桌面 IndexedDB 无目录概念测不出）

## 5. 脏检查

`isDirty(current, saved)` 逐项比对 puppets / props / shots / cursor / model：

- `saved` 为 `null`（从未保存）时：场景里有任何东西才算脏。
- 浮点 `near()`（1e-5）比较。
- **不比 `file` 引用**（§3）：内容替换且同名的极端情形不覆盖——本也没有用户入口能这么干。
- 只比「用户能感知的字段」。

## 6. 存储适配与性能

| 实现 | 何时用 |
|---|---|
| `nativeStore` | 真机：`window.Capacitor.Plugins.Filesystem` |
| `webStore` | 桌面 headless 测试 / 插件未注入：IndexedDB（库 `ss-store`） |

- **不能写 `import('@capacitor/filesystem')`**：`projects.js` 是普通 `<script>`，WebView 解析裸模块名直接抛错。原生代理挂在 `window.Capacitor.Plugins`。
- **写入分块**：3MiB 一块各自 base64（各自 padding），拼接解码与原字节严格一致——**块长不需要 3 的倍数对齐**（v29 实测结论）。所有 `appendFile` 必须带 `recursive:true`（类型定义没写这个字段，但 Kotlin 实现读它；不带就不建父目录）。
- **读取零 base64**：`readViaUri()` = `getUri` + `convertFileSrc` + `fetch(arrayBuffer)`，全程不产生膨胀字符串。流式读用 `readChunks()`（fetch ReadableStream 逐块喂回调，WebView 不给流就一次 push）。
- 原生插件缺失时回退 IndexedDB + `console.warn`，不让保存直接抛错。

## 7. 已知边界

- 列表依赖 `localStorage['ss-registry']`；清缓存后磁盘工程不可见。meta.json 已预留，**目录扫描重建未实现**。
- 未引用的内容文件不清理（删除 prop 后 `files/<sha1>` 仍留在盘上；下次保存不引用也不删）。孤儿文件累积是已知债。
- 打开工程不可撤销；未保存修改靠返回时的脏检查弹窗拦截。
- 删除工程是直接 `rmdir -r`，不进回收站，靠 `confirm()` 拦一道。
- SHA-1 保底路径（无 `crypto.subtle` 时 FNV-1a+长度）有弱碰撞风险，仅极端环境触发。

## 8. 测试

```bash
node tests/project.mjs              # 27 项：新建→导入→摆人偶→保存→校验内容寻址
                                     #        →返回列表→重开还原→脏检查→删除（v29 断言）
node tests/probe-empty-project.mjs  # 9 项：空工程「新建→返回→再打开」闭环
node tests/probe-v29-migrate.mjs    # 13 项：造 legacy zip→流式迁移→去重/字节一致
                                     #         →旧 zip 删除→迁移后工程可打开（v29b）
node tests/probe-v28b.mjs           # 9 项：停靠区避让保存条
```

`project.mjs` 用 `spike/glb-load-test/splat.ply` 作测试模型（跑时拷进 `www/`，结束删除，不进仓库）。测试起 `tools/dev/staticsrv.cjs` + headless Edge（WebGPU/ANGLE），端口各套件错开，跑完自动退出。

> **桌面绿 ≠ 真机过**：v29 首发的 `Missing parent directory` 就是 IndexedDB（无目录概念）测不出来的原生路径问题。原生分支的改动必须真机验一轮。
