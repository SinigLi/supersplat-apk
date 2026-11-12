# 角色卡库系统（v59 定稿实装 → v61f 现状）

老板定稿（原型 r3 → 实装）：**多套全局卡组 + 工程引用**，移动端 sheet 交互为后续配置 UI 的标准范式。

## 数据模型（charcards.js v2）

```json
{
  "schema": "moyutai.charcards.v2",
  "descGroups": [                        // 描述词库（组级，不绑角色）
    { "name": "原角色描述", "items": ["粉发少女", "校服"] },
    { "name": "替换角色描述", "items": ["魔法少女装"] },
    { "name": "发型", "items": ["黑长直"] }   // 自定义分组随意加
  ],
  "cards": [
    { "id": "c-xxxxxxxx", "name": "小圆", "tag": "主角",
      "img": "data:image/jpeg;base64,...",      // 头像（256px 圆裁 jpeg）
      "imgFull": "data:image/png;base64,..." }  // 原图（仅内存/导出时有；落盘剥进 IDB）
  ]
}
```

- **v1 兼容只读**：旧 `orig_char_descs/dest_char_descs` 导入时迁入默认两组；卡上多余字段丢弃。不做反向兼容（旧系统未正式使用）。
- 多套卡组存 `localStorage['moyutai-cardgroups-v1']`（cardgroups.js CCG），每套一份 charcards.v2。
- 视频工程 `meta.charGroupRef` 指向引用的组 id；未引用时回退旧 `av-<工程>-chars` 键（只读兼容）。

### 图片存储分工（v60d 起，v61f 补全导出侧）

| 位置 | 存什么 | 谁写 |
|---|---|---|
| `localStorage['moyutai-cardgroups-v1']` | 卡组列表 + 卡（id/name/tag/**img 头像**），**没有 imgFull** | `cardgroups.js` CCG.saveData |
| IndexedDB `moyutai-cg-full` / store `cards` / 键 `groupId::cardId` | **原图 imgFull** | `cardgroups-full.js` CGFull.put（由 stripFull 收集） |

- **只读 localStorage 拿不到原图**——`CCG.list()` / `CCG.get()` 返回的是精简副本。需要原图的地方必须 `await CGFull.all(groupId)`。
- 删除卡组时 `CCG.remove` 会同步 `CGFull.delGroup(id)`，不留孤儿原图。

## UI 形态（原型 prototype/cardgroups-proto.html r3 = 实装标准）

- **底部 sheet 抽屉**（grab 条 + mask + 圆角卡），拇指区操作，触控目标 ≥40px。
- **开始页「🎭 角色卡」**（projects-ui 头部，解压旁）→ cardgroups-ui.js：
  - 组列表（名称/角色数/词条数）→ 点进组编辑
  - 组编辑：改名、角色卡（头像 📷 选图/清图、名称、标签、删除）、添加角色、📖 词库、导出/导入、删除组
  - 词库：分组卡（默认「原角色描述」「替换角色描述」两组 + 自定义），词 chips 逐条删，组内添加行，新建分组
- **视频工程 🎭 按钮**（av-ui）→ 同形态对话框：
  - 标题显示当前组名；📚 切换角色库（选库 sheet：使用中标 ✓）
  - 切换缺角色 → confirm 警告列出缺失名；全命中 → toast「切换角色库成功」
- **导入导出（v61f 现状）**：
  - ZIP 包 = `charcards.json + chars/<角色名>.jpg + chars_full/<角色名>.<ext>`（fflate 打包/解包）。
  - `charcards.json` 里每张卡**同时内嵌** `img` 与 `imgFull`（base64，无体积上限），因此**单独拿这份 JSON 导入也能完整恢复头像和原图**；`imgFile`/`imgFullFile` 路径引用同时保留，ZIP 分支仍可走文件。
  - 导入按魔数判 ZIP（PK 头），不看后缀；`charcards.json` 允许位于任意子目录；`.json/.zip` 都能直接选（`accept=*/*`，避免 Android SAF 过滤）。
  - 缺图的卡会按角色名从**其他卡组借用**（同时借头像与原图，原图走 `CGFull.all`），日志 `[cg] import: borrowed avatars=N originals=M`。
  - 明确拒绝 marks JSON（`marks`+`schema` 但没有 `cards` 数组）；进度浮层走 `window.Prog`，失败/取消都要 hide。

## 打标适配（img-ui.js）

- 描述下拉：`CC.wordsOf(cards, '原角色描述'|'替换角色描述')` 从词库分组取词（v1 的 `tm.cards.orig_char_descs` 直读已废）。
- 角色遮罩链路零改动：`loadTagMaskLayers(ref, cardId)` 按 ref.id 找草稿、层名=角色名匹配——引用组换库后 name 对得上即继续可用。
- 导出遮罩：`masks/<段>/<帧号>/<角色名>.png`（v58 结构保持）。

## 关键文件

| 文件 | 职责 |
|---|---|
| www/charcards.js | v2 数据层（卡/词库 CRUD、迁移、zip 组包计划） |
| www/cardgroups.js | CCG 多套卡组存储 + 迁移（v58 引入，保留） |
| www/cardgroups-full.js | 原图 IndexedDB 存储（put/get/all/delGroup/stripFull） |
| www/cardgroups-ui.js | 开始页管理器（sheet 全套 + 导入导出 + 借图） |
| www/progress.js | 统一进度浮层 `window.Prog`（导出/导入共用） |
| www/av-ui.js | 视频页角色卡对话框 + 选库 + 遮罩导出（v58 链路不变） |
| www/img-ui.js | 打标描述下拉（词库分组） |

## 探针

- `tests/charcards.test.cjs`：v2 数据层 33 项
- `tests/cardgroups.test.cjs`：CCG 19 项
- `tests/probe-v59-impl.cjs`：实装结构 33 项（UI 形态/打标适配/导入导出/版本号）
- 原型轮 `tests/proto-v59.mjs`（32 项）只对 prototype 目录有效
- `tests/probe-v61f.cjs`：原图内嵌无上限 + 借图读 IDB + applyImport 异步化 13 项
- `tests/v61f-dom.mjs`：**真机链路复现** 8 项——卡组原图只在 IDB → 导入只写路径的 JSON → 再导出，断言 `idbFulls=2 / inlineFull=2 / chars_full 两文件`
- `tests/v61b-dom.mjs`（进度浮层 10 项）、`v61c-dom`（无后缀 ZIP 5 项）、`v61d-dom`（内嵌头像 3 项）、`v61e-dom`（内嵌原图 5 项）

## 移动端 UI 规范（后续配置类 UI 按此执行）

老板 2026-11-11 拍板：「后面我们的配置尽量都用这种移动端的交互和 ui 设计」。

1. 底部 sheet 抽屉（不是居中 dialog）；grab 条可视化。
2. 卡片化列表 + 圆头像/图标位；主操作 primary 紫（#7c6cf0），危险红描边。
3. 词/标签用 chips，逐条 ✕ 删除；添加用「输入行 + 按钮」贴在列表尾部。
4. 破坏性操作（删组/删卡）`window.confirm` 确认，文案带对象名。
5. toast 反馈统一右下（`av-toast` / cardgroups-ui 内部实现等价）。
6. 新配置页先出 HTML 原型（`prototype/`，按 ui-prototype-pages 流程 CDP 验证 + Pages 给老板过目）再实装。
