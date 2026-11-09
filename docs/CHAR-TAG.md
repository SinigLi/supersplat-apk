# 角色打标（v53）需求分析 · 定稿 v4

> 2026-11-08 定稿 · **2026-11-10 更新：已实现并交付（v53 ~ v55c，老板真机确认）**。实现记录见 §8。
> 修订史：10:35 拍板 Q1~Q6 → 10:47 JSON 只增不改 + 通用备注库 → 11:25 角色卡文件带版本声明、取消独立 char_tag 类型（chars 挂 split/multiframe 节点 + 片段级 chars）、帧号 0-based 口径确认 → 11:34 nodes[]=全局标签池、每卡单个 tag 字符串 → **11:48 取消朝向/备注，改为原角色描述/替换角色描述**。
> 相关：`docs/IMAGE-MODE.md`（遮罩 v2）、`docs/RELEASE.md` §5（marks.v3）、`www/av-store.js`、`www/img-ui.js`。

## 1. 一句话目标

视频模式下给「某一帧」挂角色标签：角色（来自角色卡）、原角色描述、替换角色描述、可选手绘遮罩。角色卡按工程独立管理，可 JSON 导入导出；导出时角色信息挂进标记 JSON 的既有节点，有遮罩则升级 zip 包（JSON + 遮罩 PNG）。

## 2. 已拍板决策

| # | 决策 |
|---|---|
| Q1 | 未选中可标记帧（并入前段 / 无激活点）→ 直接 toast 提醒，不弹窗（「并入前段」= 该段首帧已并入前段，不能再打标） |
| Q2 | ~~朝向（正/侧/背）~~ → **11:48 取消**。改为「原角色描述 / 替换角色描述」两个属性（见 §3） |
| Q3 | 角色卡库**每个视频工程独立**（不全局共享） |
| Q4 | JSON 兼容 = **只新增节点、不改既有字段**（老板 10:47 定稿）。marks.v3 的 split/multiframe/merge_prev 结构一字不动，chars 是挂上去的新节点 |
| Q5 | 遮罩 PNG 规格：与图片模式现有导出一致——单层画布白笔不透明、底透明（复用 `buildLayerCanvas`） |
| Q6 | 同帧再打标 = 展示之前状态继续编辑；遮罩中间态只存笔画，**视频导出时才栅格化输出** |
| 11:25 | 角色卡文件带版本声明节点；**不新增 char_tag point 类型**——chars 直接挂 split/multiframe 节点；每个片段 target 节点加与 points 同级的 chars（= 首帧打标），merge_prev:true 的片段没有段级 chars |
| 11:34 | nodes[] 与 schema 同级 = 全局标签池（打标快速备选）；每张卡只有一个字符串标签 tag |
| 11:48 | 取消 dir/note 两节点；新增 **orig_char_descs / dest_char_descs 两个默认列表**（卡页面可增删）；打标角色条目改为这两种描述（先从列表选、选完可编辑） |

## 3. 数据模型

### 3.1 角色卡文件（charcards.demo.json）

```json
{
  "schema": "moyutai.charcards.v1",
  "nodes": ["主角", "配角", "路人", "群演"],
  "orig_char_descs": ["红衣女子", "站着的男人"],
  "dest_char_descs": ["穿和服的女人", "白衣侠客"],
  "cards": [
    { "id": "c-a1b2c3d4", "name": "女主角", "tag": "主角" },
    { "id": "c-e5f6a7b8", "name": "男配角", "tag": "配角" }
  ]
}
```

- `nodes[]`：**定稿时有、实现时砍掉**（www/charcards.js 不含 nodes，卡仅保留 tag 字符串字段）——打标流程实际不需要全局标签池。
- `orig_char_descs[]` / `dest_char_descs[]`：两个默认描述列表，角色卡页面可增删。
- 每张卡：`id`（稳定引用）+ `name`（显示名）+ `tag`（单个字符串标签，从 nodes 选）。
- 存储：localStorage `av-<工程>-chars`（av-store 管）；导入合并按 id 去重、列表去重。

### 3.2 打标数据（挂进 marks，不新增 point 类型）

```json
{ "name": "女主角", "orig_char_desc": "红衣女子", "dest_char_desc": "穿和服的女人",
  "mask": "masks/001/40_c-a1b2c3d4.png" }
```

- 挂载位置（三处，均按需出现）：
  1. **片段级** `target` 节点上加 `"chars": [...]`（与 points 同级）→ 该段**首帧**的打标；`merge_prev:true` 的片段没有段级 chars；
  2. **multiframe 节点**上挂 `chars` → 该多帧点帧的打标；
  3. **split 节点**上挂 `chars` → 该分割点帧的打标（切分时刻同时有角色打标是合法的）。
- 描述值从 3.1 两个列表选（选完可编辑）；`mask` 缺省 = 没画遮罩（只启用/描述）。
- 内部 marks 存储：`{ id, type:'char_ref', seg, at, chars:[...] }` 走 marks 既有链路，导出时按上面三处挂载展开。

### 3.3 遮罩中间态（笔画存储，Q6）

- key：`av-<工程>-tagmask-<点位id>`（`tagMaskKey()`：有既有 char_ref 用其 mark id，否则 `seg_frame` 兜底）→ `moyutai.imgmask.v2` 结构。**同一点位所有角色共用一个 key**，角色区分在 layers[].name（层名=角色名），activeId 指向当前编辑层（v55c 起下拉/高亮/落笔统一以它为事实源）。
- 编辑期底图 = 该帧截图（canvas 抽帧，仅编辑用，不落盘不导出）。
- 只有视频导出时才逐角色栅格化为 PNG（复用 `buildLayerCanvas`：白笔不透明、底透明、帧原尺寸）。

## 4. 交互流程

### 4.1 角色卡对话框（视频页顶部 🎭 按钮）

加载本地角色卡 / 卡名列表（显示 name + tag）/ **原角色描述列表管理（增删）** / **替换角色描述列表管理（增删）** / 添加角色名（从 nodes 选或新输入）/ 导出角色卡 / 取消。

### 4.2 打标入口（「并入前段」按钮上方新按钮）

1. 游标激活分割点 → 该分割点帧；
2. 游标激活多帧点 → 该多帧点帧；
3. 默认 → 当前片段首帧（写到片段级 chars）；
4. 并入前段 / 无有效首帧 → 仅 toast 提醒（Q1）。

前置：无角色卡 → toast「先设定角色卡」并打开卡对话框。

### 4.3 打标页（复用图片编辑页运行模式）

- 底部追加「打标工具组」：角色下拉（本工程卡库）、**原角色描述（从 orig_char_descs 选、可编辑）**、**替换角色描述（从 dest_char_descs 选、可编辑）**、启用打标、取消打标。
- 选中角色 → 自动建/切该角色遮罩层 → 画笔/多边形/橡皮照常；可只启用不画（只填描述），也可都不填纯启用。
- 顶部：确认 ✅ / 取消 ✖。确认 → chars[]（快照 + mask 引用）写回 marks；取消 → 丢弃（有笔画改动时提示）。
- 同帧已有打标 → 载入既有角色/笔画/描述继续编辑（Q6）。
- 一帧可挂多个角色（多角色 = 多层，逐个选中绘制）。

## 5. 导出与兼容

### 5.1 JSON 结构

- 无打标工程：导出**与现在字节级一致**（不产生任何新节点）。
- 有打标：既有 split/multiframe/merge_prev 字段原样，仅在对应节点挂 `chars`：
  - 段级（首帧）：`{ "target": "001", "chars": [...], "points": [...] }`
  - 点级：`{ "type": "multiframe", "at_frame": 40, "chars": [...] }`
- 有遮罩 → **zip 包**：`marks.json` + `masks/<target>/<at_frame>_<cardId>.png`（白区透底、帧原尺寸）；无遮罩导出仍是裸 JSON。

### 5.2 消费方兼容

- 老解析器读老字段不受影响（chars 是新增节点）；联调时与音视频助手确认「未知节点忽略」即可。
- 导入容错：老 marks.json 照常导入；chars 解析缺字段时整条丢弃不崩溃。

## 6. 技术改造点

| 模块 | 改动 |
|---|---|
| 新 `www/charcards.js` | 卡库纯逻辑（CRUD/导入导出合并/校验/标签池与两个描述列表管理）+ 单测 |
| `www/av-store.js` | chars 存取；char_ref 内部 mark；buildExport 扩展（三处挂载 + zip 分支） |
| `www/av-ui.js` | 🎭 按钮+卡对话框；打标按钮+目标帧解析+toast；chars 在时间轴/列表展示 |
| `www/img-ui.js` | 注入式「打标运行模式」：帧截图底图、层=角色、底部打标组（双描述选择）、顶部确认/取消、存储回调化 |
| 栅格化 | 导出时抽帧→逐角色 buildLayerCanvas→PNG→sha1→files/→zip 组包（fflate） |
| 测试 | charcards 单测；导出兼容单测（v3 不变 / 三处挂载 / zip）；probe：对话框、目标帧解析、打标页往返、zip 结构 |

## 7. 明确不做（本期）

- 骨骼/姿态级标注、遮罩自动生成；不改图片工程 imgmask.v2 schema；音频模式无打标入口。

## 8. 实现记录（v53 ~ v55c，2026-11-10 整理）

### 8.1 模块落点

| 文件 | 内容 |
|---|---|
| `www/charcards.js` | 卡库纯逻辑：CRUD/tag/双描述列表/导入合并（id 去重、列表并集）/校验/快照；charcards 单测 32 |
| `www/av-store.js` | `loadChars/saveChars/upsertCharRef/findCharRefAt/removeCharRef`；导出三处挂载 + 孤儿帧 `target.chars+at_frame`；export-chars 单测 23 |
| `www/av-ui.js` | 顶部 🎭 chip + 卡对话框；「角色打标」按钮与目标帧解析；本地流抽帧（原分辨率、12s 超时）；char_ref 时间轴刻度与列表徽标（`hasCharRef` 按 mark 存在判断，chars=[] 已随 v55b 移除） |
| `www/img-ui.js` | `openTagMode` 注入式打标模式：帧画布底图、层=角色、右上停靠打标条（角色下拉/启用/隐藏/取消/描述面板/确认取消）、`tagMaskKey()` 笔画存取、层日志骨架（save/load/redraw） |

### 8.2 保存/恢复时序（v54+v55c 后的最终语义）

1. 画一笔 → `applyAndPush` → **tagMode 立即落盘**（v54，不再等确认）；
2. 确认 → `finishTag` 强制再存一次（双保险）→ chars 收集：
   - 有角色 → `upsertCharRef`（同点位替换）；
   - **全部停用** → `removeCharRef` + 清双 key 草稿（v55b；分镜打点保留、角标消失）；
3. 重进 → `loadTagStrokes` 命中草稿 → **无条件对齐第一个遮罩层**（v55b），
   下拉/层高亮/落笔由 `switchTagLayer` 统一回写（v55c，单一事实源=activeId），
   收尾「默认激活第一个启用角色」仅在无恢复层时生效（v55c）。

### 8.3 探针与回归口径

`probe-v55c 9/9 · probe-v55(b) 9/9 · probe-v54 8/8 · probe-v53-M4 31/31 · probe-v53-M5 17/17 · charcards 32/32 · export-chars 23/23 · img-ops 全绿`。
改 `img-ui.js` 打标段必须复跑 v55c/v55/v54 三个探针（保存语义 + 同步语义 + 回归锚）。

### 8.4 排查案例（值得记住）

- **「数据恢复了但画面没有」**（v53y/z 期）：先分三层查——恢复层是否为空（load 日志）→ 渲染是否被调（redraw 日志）→ 是否最后一笔根本没落盘（save 日志）。debug_19 实锤是第三种：确认流程只收描述不存笔画。骨架日志（`tag: save/load/redraw`）从此保留为常驻诊断。
- **「修好又坏」的真正原因**（v55c）：v55 修在下拉上、v55b 修在恢复段上，都没动「收尾默认激活」这个后执行的覆盖者。多处写同一状态的 bug，要把**所有写入点**列全再定事实源，而不是逐个补丁。
