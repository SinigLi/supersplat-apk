# 角色卡库系统 v59（2026-11-11 定稿实装）

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
      "img": "data:image/jpeg;base64,..." }   // 头像（256px 圆裁 jpeg）
  ]
}
```

- **v1 兼容只读**：旧 `orig_char_descs/dest_char_descs` 导入时迁入默认两组；卡上多余字段丢弃。不做反向兼容（旧系统未正式使用）。
- 多套卡组存 `localStorage['moyutai-cardgroups-v1']`（cardgroups.js CCG），每套一份 charcards.v2。
- 视频工程 `meta.charGroupRef` 指向引用的组 id；未引用时回退旧 `av-<工程>-chars` 键（只读兼容）。

## UI 形态（原型 prototype/cardgroups-proto.html r3 = 实装标准）

- **底部 sheet 抽屉**（grab 条 + mask + 圆角卡），拇指区操作，触控目标 ≥40px。
- **开始页「🎭 角色卡」**（projects-ui 头部，解压旁）→ cardgroups-ui.js：
  - 组列表（名称/角色数/词条数）→ 点进组编辑
  - 组编辑：改名、角色卡（头像 📷 选图/清图、名称、标签、删除）、添加角色、📖 词库、导出/导入、删除组
  - 词库：分组卡（默认「原角色描述」「替换角色描述」两组 + 自定义），词 chips 逐条删，组内添加行，新建分组
- **视频工程 🎭 按钮**（av-ui）→ 同形态对话框：
  - 标题显示当前组名；📚 切换角色库（选库 sheet：使用中标 ✓）
  - 切换缺角色 → confirm 警告列出缺失名；全命中 → toast「切换角色库成功」
- **导入导出**：zip 包 = `charcards.json + chars/<角色名>.jpg`（fflate 打包/解包）；无图退化纯 JSON。`.json/.zip` 双格式导入。

## 打标适配（img-ui.js）

- 描述下拉：`CC.wordsOf(cards, '原角色描述'|'替换角色描述')` 从词库分组取词（v1 的 `tm.cards.orig_char_descs` 直读已废）。
- 角色遮罩链路零改动：`loadTagMaskLayers(ref, cardId)` 按 ref.id 找草稿、层名=角色名匹配——引用组换库后 name 对得上即继续可用。
- 导出遮罩：`masks/<段>/<帧号>/<角色名>.png`（v58 结构保持）。

## 关键文件

| 文件 | 职责 |
|---|---|
| www/charcards.js | v2 数据层（卡/词库 CRUD、迁移、zip 组包计划） |
| www/cardgroups.js | CCG 多套卡组存储 + 迁移（v58 引入，保留） |
| www/cardgroups-ui.js | 开始页管理器（sheet 全套） |
| www/av-ui.js | 视频页角色卡对话框 + 选库 + 遮罩导出（v58 链路不变） |
| www/img-ui.js | 打标描述下拉（词库分组） |

## 探针

- `tests/charcards.test.cjs`：v2 数据层 33 项
- `tests/cardgroups.test.cjs`：CCG 19 项
- `tests/probe-v59-impl.cjs`：实装结构 33 项（UI 形态/打标适配/导入导出/版本号）
- 原型轮 `tests/proto-v59.mjs`（32 项）只对 prototype 目录有效

## 移动端 UI 规范（后续配置类 UI 按此执行）

老板 2026-11-11 拍板：「后面我们的配置尽量都用这种移动端的交互和 ui 设计」。

1. 底部 sheet 抽屉（不是居中 dialog）；grab 条可视化。
2. 卡片化列表 + 圆头像/图标位；主操作 primary 紫（#7c6cf0），危险红描边。
3. 词/标签用 chips，逐条 ✕ 删除；添加用「输入行 + 按钮」贴在列表尾部。
4. 破坏性操作（删组/删卡）`window.confirm` 确认，文案带对象名。
5. toast 反馈统一右下（`av-toast` / cardgroups-ui 内部实现等价）。
6. 新配置页先出 HTML 原型（`prototype/`，按 ui-prototype-pages 流程 CDP 验证 + Pages 给老板过目）再实装。
