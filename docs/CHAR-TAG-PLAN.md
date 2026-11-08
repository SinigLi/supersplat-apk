# 角色打标（v53）开发计划

> 2026-11-08 12:27 老板确认需求文档 v5 后定稿。对应 `docs/CHAR-TAG.md`（11:54 口径）。
> 原则：每步带测试、提交前全套回归、每里程碑结束推送（CI 即验证），M4 后可装真机。

## 里程碑总览

| 里程碑 | 内容 | 退出标准 |
|---|---|---|
| M1 | charcards.js 纯逻辑 + 单测 | 单测全绿 |
| M2 | av-store：chars 存取 + buildExport 扩展（挂载/zip）+ 兼容单测 | 单测全绿 + 老导出字节级不变 |
| M3 | av-ui：🎭 卡对话框 + 打标按钮 + 目标帧解析 + 列表/时间轴展示 | probe 全绿 |
| M4 | img-ui 打标运行模式（帧底图/层=角色/双描述/确认取消） | probe 全绿 + **真机冒烟** |
| M5 | 导出栅格化链路（抽帧→PNG→sha1→zip）+ probe | zip 结构断言全绿 |
| M6 | 全套回归 + 文档 + v53 交付 | 门禁全绿 + 飞书交付 |

## M1 卡库纯逻辑（约半天）

- 新 `www/charcards.js`（无 DOM 依赖，`global.__charcards` / module.exports）：
  - `emptyCards()` → `{schema:'moyutai.charcards.v1', orig_char_descs:[], dest_char_descs:[], cards:[]}`
  - 卡 CRUD：`addCard / removeCard / renameCard / setTag`（tag 从描述外自由输入或预设池选）
  - 列表管理：`addOrigDesc / removeOrigDesc / addDestDesc / removeDestDesc`（去重）
  - `importCards(json)`：容错解析（非 v1 schema、缺字段整文件拒收）；合并按 id 去重、同名不同 id 保留；描述列表并集去重
  - `exportCards()`：整表序列化
  - 校验：卡名非空、tag 字符串、id 稳定生成（`c-` + 随机）
- `tests/charcards.test.cjs`：CRUD/去重/导入容错/导出往返 ≈ 20 断言

## M2 av-store 扩展（约半天）

- `loadChars/saveChars`（`av-<工程>-chars`）；空库默认结构
- 内部 marks 新类型 `char_ref`：`{ id, type:'char_ref', seg, at, chars:[{cardId,name,orig_char_desc,dest_char_desc,mask}] }`
  - 与 split/multiframe 同栈：撤销/删除/列表/时间轴复用
  - 同帧（seg+frame）唯一：再次打标 = 返回既有 char_ref 编辑（Q6）
- `buildExport` 扩展（**v3 兼容红线：老工程导出字节级不变**）：
  - char_ref@段首帧 → target 节点 `chars`（与 points 同级）；merge_prev 段不产段级 chars
  - char_ref@分割点/多帧点 → 挂对应 point 节点 `chars`
  - mask 路径解析失败/无 mask → 条目缺 mask 字段
- `tests/export-chars.test.cjs`：v3 不变断言（旧 marks 导出与基线 JSON diff = 0）+ 三处挂载 + merge_prev 无段级 chars + 0-based 帧号

## M3 av-ui 交互（约 1 天）

- 顶部 🎭 按钮 → 角色卡对话框：卡列表（name+tag）、添加角色名、两个描述列表管理（增删）、加载本地角色卡（MediaServer.pickCsv 复用为通用 pickFile）、导出角色卡、取消
- 「并入前段」上方 ⚑ 打标按钮：
  1. 无卡 → toast「先设定角色卡」+ 开卡对话框
  2. 目标帧解析：激活分割点 > 激活多帧点 > 当前段首帧；并入前段/无首帧 → toast（Q1）
  3. 可打标 → 打开打标页（M4），带上下文 `{seg, frame, segLabel, pointType}`
- char_ref 展示：时间轴刻度（▦ 复用色系区分）、左列表「🎭 角色标」徽标、点按跳帧
- probe（probe-v53.mjs 新文件）：对话框开关、目标帧解析四分支、无卡引导

## M4 打标页运行模式（约 1~1.5 天）

- `www/img-ui.js` 注入打标模式（不复制页面，`open(projectName, tagMode)` 扩展）：
  - 底图：视频抽帧（canvas，编辑期持有，不落盘）
  - 层语义：一角色一层（层名=角色名），复用 imgmask.v2 笔画存储（key `av-<工程>-tagmask-<markId>-<cardId>`）
  - 底部打标组：角色下拉、原角色描述（orig 列表选+可编辑）、替换角色描述（dest 列表选+可编辑）、启用打标、取消打标
  - 顶部：确认 ✅（chars[] 写回 marks → 关页）/ 取消 ✖（有笔画改动提示）
  - 重开续编：既有 char_ref 全量载入（层/笔画/描述）
  - 存储隔离：打标模式不写 img-meta/img-strokes，不动图片工程
- probe：模式开关、层随角色切换、确认写回、取消丢弃、重开续编
- **真机冒烟**：抽帧清晰度、双描述下拉手感、笔画流畅度

## M5 导出链路（约 1 天）

- 确认不栅格；导出时（视频工程导出按钮）：
  - 逐 char_ref：抽帧 → 逐角色（有笔画者）`buildLayerCanvas` → PNG → sha1 → `files/` 内容寻址 → mask 路径写入导出 JSON
  - 有任一遮罩 → fflate 组 zip（`marks.json` + `masks/<target>/<at_frame>_<cardId>.png`）；无遮罩 → 裸 JSON（现状）
- probe：zip 成员表断言、PNG 白区透底像素抽检、重复导出幂等（同 sha 不重复落盘）

## M6 收尾交付（约半天）

- 全套回归：probe-v53 / probe-v45（63+） / probe-v49 / img-ops / groups / storyboard / director
- 文档：CHAR-TAG.md 补实现记录、RELEASE.md §5 加 v53 行、IMAGE-MODE.md 引用更新
- 交付流水线 v53（复用 deliver 模板，文案显式传入）→ 飞书

## 风险与对策

| 风险 | 对策 |
|---|---|
| img-ui 注入模式破坏图片工程既有行为 | 存储完全隔离 + 图片回归（img-ops 37 项）必跑 |
| 抽帧跨机型兼容（WebCodecs/视频编码差异） | M4 真机冒烟前置；失败降级方案：抽帧走原生 MediaServer（M5 评估） |
| 导出 zip 体积 | 遮罩 PNG 白区压缩率高，预估 KB~MB 级；fflate level 6 |
| 音视频助手消费方 | chars 全为新节点，联调确认「未知节点忽略」；必要时文档注明 |

## 排期

按里程碑顺序串行推进，预计 **3.5~4 个工作日当量**；M2/M3 可部分并行。每个里程碑完成即推送，M4 后有可冒烟包，M6 交付正式 v53。
