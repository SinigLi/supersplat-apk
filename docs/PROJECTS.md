# 工程管理（Projects）— 存储、格式与双页 UI

> 版本：v28c（2026-10-19） · 维护者：全栈工程师
> 代码：`www/projects.js`（存储与格式）· `www/projects-ui.js`（列表页 / 编辑页 / 对话框）· `www/projects.css`
> 关联：`docs/DIRECTOR.md`（场景快照的来源）· `docs/RELEASE.md`（发版）

## 1. 它解决什么

Android 的 SAF 路径授权**只在一个会话内有效**，工程里只存模型路径的话，重开必然找不到模型（splat-viewer v0.3.x 的真实事故）。所以工程文件是**自包含 zip**：模型原始字节、道具 GLB 全部内嵌，代价是工程文件≈模型体积。

存储落在 **App 私有目录**（Capacitor `Directory.Data`），免存储权限，卸载才丢。

## 2. 目录与索引

```
Directory.Data/                                  ← App 私有，免权限
  projects/<encodeURIComponent(名字)>/
      project.svproj                             ← 自包含 zip（主体）
      thumb.jpg                                  ← 列表缩略图（320×180 JPEG）
      meta.json                                  ← 自描述记录（名字/时间/有无模型）

localStorage['ss-registry'] = {"projects":[{name, updatedAt, hasModel}, ...]}
```

**为什么还要 meta.json**：注册表在 `localStorage`，清缓存/换 WebView 实现会丢。meta.json 是磁盘上的自描述副本，理论上可用来重建列表。**当前版本还没有实现这个重建扫描**（见 §7 已知边界），列表完全依赖注册表。

工程名直接做目录名，所以 `validateProjectName()` 禁止 `/ \ : * ? " < > |`，长度 ≤ 50。

## 3. 工程文件格式（`project.svproj`）

zip，`level 0`（模型本身已是压缩格式，再压只烧 CPU）：

| 条目 | 内容 |
|---|---|
| `state.json` | 导演台快照，见 §3.1 |
| `model.<ext>` | 主泼溅模型原始字节，`state.model.path` 指向它 |
| `props/<i>.<ext>` | 每个 GLB 道具的源字节，`state.props[i].file` 指向它 |

### 3.1 state.json

直接来自 `director.projectSnapshot()`：

```json
{
  "version": 1,
  "model": { "name": "scene.ply", "path": "model.ply" },
  "puppets": [{ "name","charId","pos","rot","scale","tint","clip","locked","visible" }],
  "props":   [{ "name","file","pos","rot","scale","locked","visible" }],
  "shots":   [{ "id","name","pos","target","fov" }],
  "camera":  { "pos","target","fov" },
  "cursor":  { "pos","on" }
}
```

- **`version` 必须是 `1`**：`restoreProject()` 第一行就是 `if (!t || t.version !== 1) return 'bad-version'`。新建空工程也要带上，否则自己写的文件自己读不回来。
- 机位存**解析后的位姿**（eye/target/fov），不存轨道参数——`sceneRadius` 会随导入模型漂移，存轨道参数跳转会偏（详见 `docs/DIRECTOR.md` §4.1）。
- `model` 为空表示空工程（`null`），不是缺字段。

## 4. 三条主流程

### 4.1 新建

```
createProject(name)
  ├─ clearScene()                        ← 清掉上一个工程的场景
  ├─ buildProjectZip(emptyProjectState(), {})
  ├─ write project.svproj                ← 关键：必须立即落盘
  ├─ write meta.json
  ├─ registry.upsert
  ├─ showEditorPage()
  └─ lastSavedSnapshot = snapshotNow()   ← 让新工程算「干净」，返回时不弹未保存确认
```

> **v28c 修复**：早期版本这一步只写注册表、不落盘工程文件，于是「新建 → 什么都不做 → 返回 → 再点开」必然读不到文件，报「打开失败」。任何建了没保存的工程都永久打不开。

### 4.2 保存

```
saveProject()
  ├─ snap = director.projectSnapshot()
  ├─ director.projectModel() → {name, bytes}   ← 原始字节，内嵌
  ├─ director.projectPropFiles() → [{path, bytes}]
  ├─ zip = buildProjectZip(snap, files)        ← level 0
  ├─ write project.svproj
  ├─ thumb = scene.events.invoke('render.offscreen', 320, 180) → JPEG
  ├─ write meta.json
  ├─ registry.upsert
  └─ lastSavedSnapshot = snap
```

缩略图走 `render.offscreen`、同一帧读像素（WebGL 没开 `preserveDrawingBuffer`，隔帧截会是黑的）。

### 4.3 打开

```
openProject(name)
  ├─ read project.svproj → parseProjectFile()
  │    └─ 文件不存在？ → 按空工程恢复，并把空文件补写回去（v28c）
  │       文件损坏？   → 直接报错，绝不覆盖（覆盖=丢了用户的活）
  ├─ clearScene()
  ├─ importModelBytes()     ← 必须先重建模型：人偶摆在模型上，相机包围盒也依赖它
  ├─ director.restoreProject(state, files)
  └─ lastSavedSnapshot = snapshotNow()
```

`restoreProject()` 内部先销毁现有人偶/道具/机位再重建，**不走撤销栈**（不产生 op）。所以「打开工程」不是一个可撤销动作。

## 5. 脏检查

`isDirty(current, saved)` 逐项比对 puppets / props / shots / cursor / model：

- `saved` 为 `null`（从未保存）时：场景里有任何东西才算脏，空场景不脏。
- 浮点用 `near()`（1e-5）比较，避免矩阵往返的尾差误判。
- 只比「用户能感知的字段」，不比 id 之类内部字段。

## 6. 存储适配与性能

| 实现 | 何时用 |
|---|---|
| `nativeStore` | 真机：`window.Capacitor.Plugins.Filesystem` |
| `webStore` | 桌面 headless 测试 / 插件未注入：IndexedDB（库 `ss-store`） |

**不能写 `import('@capacitor/filesystem')`**：`projects.js` 是普通 `<script>`，不是打包产物，WebView 解析裸模块名会直接抛 `Failed to resolve module specifier`。原生代理挂在 `window.Capacitor.Plugins` 上，由桥注入。

**大文件分块**：模型 20MB+，base64 后更大，一次性过桥会撑爆 WebView 的消息通道（整串 30MB+ JSON）。`nativeStore.write()` 对超过 2MB 的内容先建空文件、再 `appendFile` 分块追加。

原生插件缺失时**回退 IndexedDB 并 `console.warn`**，而不是让保存直接抛错——宁可存在 WebView 里，也别丢用户的操作。

## 7. 已知边界

- 列表依赖 `localStorage['ss-registry']`；清缓存后磁盘上的工程不可见。meta.json 已预留，但**目录扫描重建列表未实现**。
- 工程文件≈模型体积，多个大场景会快速吃掉内部存储；没有容量提示与清理入口。
- 打开工程不可撤销；未保存修改靠返回时的脏检查弹窗拦截。
- 缩略图只在 `hasModel` 为真时才读：空工程显示占位图标。
- 删除是直接 `rmdir -r`，不进回收站，靠 `confirm()` 拦一道。

## 8. 测试

```bash
node tests/project.mjs              # 26 项：新建 → 导入 → 摆人偶 → 保存 → 校验 zip
                                    #        → 返回列表 → 重开还原 → 脏检查 → 删除
node tests/probe-empty-project.mjs  # 9 项：空工程「新建 → 返回 → 再打开」闭环（v28c）
node tests/probe-v28b.mjs           # 9 项：停靠区避让保存条，且按钮位置不动（v28b）
```

`project.mjs` 用 `spike/glb-load-test/splat.ply` 作测试模型（跑时拷进 `www/`，结束删除，不进仓库）。
