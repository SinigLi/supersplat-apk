# tests/ — 回归与验收探针

全部脚本都在**仓库根目录**执行（`cd projects/supersplat-apk`），因为静态服务根 = 当前工作目录：

```bash
cd projects/supersplat-apk
node tests/<脚本>
```

浏览器类脚本自己起 `tools/dev/staticsrv.cjs` + headless Edge（CDP），跑完自动退出；端口与 CDP 端口按脚本写死，**不要并行跑多个**（端口会撞）。

## 分类

| 类别 | 命名 | 说明 | 什么时候跑 |
|---|---|---|---|
| 纯逻辑单测 | `*.test.cjs` | Node 直跑，不起浏览器，毫秒级 | 改对应模块必跑 |
| 引擎/工程回归 | `director.mjs` `v13.mjs` `project.mjs` | 端到端，覆盖面最广 | 改任何东西都跑 |
| 版本验收探针 | `probe-vXX.cjs` | 静态断言（源码契约），快，适合定位回归 | 改到相关模块时 |
| 版本验收探针（浏览器） | `probe-vXX.mjs` | 真跑页面 + 断言 DOM/渲染 | 改到相关模块时 |
| DOM 冒烟 | `vXX-dom.mjs` | 走真实 UI 链路（点按钮、走 importFile、走导出） | 改交互/导入导出必跑 |
| 一次性诊断 | `archive/` | 排查历史 bug 用，不保证还能跑 | 一般不跑，查历史时参考 |

## 现行必跑清单（提交前）

```bash
# 纯逻辑
node tests/charcards.test.cjs        # 33 项 · 角色卡 v2 数据层
node tests/cardgroups.test.cjs       # 19 项 · 多套卡组存储
node tests/export-chars.test.cjs     # 23 项 · 遮罩导出兼容
node tests/img-ops.test.cjs          # 图片图层操作
node tests/groups.test.cjs           # 工程分组
node tests/storyboard.test.cjs       # 分镜 CSV

# 端到端
node tests/director.mjs              # 16 项
node tests/v13.mjs                   # 15 项
node tests/project.mjs               # 27 项
```

## 卡组 / 导入导出相关（改动这些必跑）

```bash
node tests/probe-v58.cjs         # 卡组引用 + 导出目录结构
node tests/probe-v59-impl.cjs    # v59 实装结构
node tests/probe-v59k.cjs        # 图片文件夹导入契约
node tests/probe-v60c.cjs        # 原图保留 + 停靠栏
node tests/probe-v60d.cjs        # 原图 IDB 契约
node tests/probe-v61b.cjs        # 进度浮层 + 导图回查
node tests/probe-v61c.cjs        # ZIP 魔数 / 子目录 / accept
node tests/probe-v61d.cjs        # 内嵌头像
node tests/probe-v61e.cjs        # 内嵌原图
node tests/probe-v61f.cjs        # 全量内嵌 + 借图读 IDB   ← 现行

node tests/v61b-dom.mjs          # 进度浮层 + zip 往返 10 项
node tests/v61c-dom.mjs          # 无后缀 ZIP 5 项
node tests/v61d-dom.mjs          # 只导 JSON 回头像 3 项
node tests/v61e-dom.mjs          # 只导 JSON 回头像+原图 5 项
node tests/v61f-dom.mjs          # 真机链路复现 8 项         ← 现行
```

## 写新探针的约定

1. **断言要结构化**，不要全文关键字匹配（注释里出现同样的字会把全绿代码判失败，v49 事故）。
2. **`check(name, cond)` 计数**，末尾打印 `N/M === ALL PASS ===` 或 `=== FAIL ===`，失败 `exit 1`。
3. DOM 冒烟要**走真实入口**（点按钮 / 走 `importFile` / 走导出按钮），别直接调内部函数——内部函数过了、UI 断了才是真机翻车的主因。
4. 新版本探针**只加不改**：旧探针若语义被新版本有意反转，就地更新并在注释写明原因（见 `probe-v61e.cjs` 头）。
5. 一次性排查脚本用完请移到 `archive/`，并在 `archive/README.md` 补一行。
