# tests/archive — 一次性排查脚本归档

这里放的是**当时为了定位某一个具体 bug 临时写的**脚本，问题解决后就不再进回归清单。
保留它们是因为里面的复现步骤和日志钩子在以后遇到同类问题时能直接抄。

| 脚本 | 用途 | 结案 |
|---|---|---|
| `v59h-click.mjs` | 开始页「🎭 角色卡」按钮点了不弹 sheet，枚举页面按钮逐个点 | v59h（缓存版本号没跟上） |
| `v59h-diag2.mjs` | 页面脚本根本没跑起来，查 headless 实际 URL / DOM 状态 | v59h |
| `v59h-diag3.mjs` | 语法 OK 但 `__cardgroups` undefined → IIFE 运行时抛错，手动 eval 抓异常 | v59h |
| `v59h-repro.mjs` | v59h 真机回归复现（点按钮应弹 sheet 并抓页面异常） | v59h |
| `proto-r3-diag.mjs` | 原型 r3 页面异常 + DOM 状态诊断 | v59 定稿 |
| `proto-v59-shot.mjs` | 原型截图 | v59 定稿 |
| `proto-v59-srvtest.mjs` | 静态服务 URL 200 + 手动看 title | v59 定稿 |
| `proto-av-verify.mjs` | 视频页原型验收 | v59 定稿 |
| `v60e-dom2.mjs` | 打标栏 `okbar`/`tagbar` 都不在 DOM，查 `buildTagBar` 是否被 catch 吞掉 | v60e |
| `v60e-dom3.mjs` | `okbar` y=-20，查 `inline top:10px` 与 safe-area CSS 冲突 | v60e |
| `v60f-dom3.mjs` | 删除按钮点击无效果（`removed=0`），查 `.img-layer-rm` 选择器与真实容器 | v60f |

## 约定

- 归档脚本**不保证能直接跑**（可能引用了已改名的私有钩子、或用固定端口）。
- 只用来「查历史怎么定位的」，不进 CI、不进 `docs/RELEASE.md` 的必跑清单。
- 需要长期保留的行为断言，请写成 `tests/probe-vXX.cjs` 或 `tests/vXX-dom.mjs` 并加进必跑清单。
