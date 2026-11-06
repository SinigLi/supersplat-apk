# 视图导航模式（游戏 / 建模）开发方案

> 版本：v1.0（2026-11-06）· 维护者：全栈工程师
> 关联：`docs/DIRECTOR.md`（相机模型）、`www/dock.js`（视口面板）、`supersplat-main/src/{controllers,camera,scene-config,editor,director}.ts`
> 状态：**已交付（v48e）**。M1–M3 完成，真机待确认手感。

## 1. 背景

老板反馈：3D 导演台的空间移动「有点怪」，具体两条：

1. **放大时变化速率变慢，缩小时速率变快**。
2. 整套手感偏「精细建模」，但实际用途是**粗糙搭建场景**，只想要游戏那种恒定速度。

### 1.1 根因（已核实，非推断）

**缩放** — `supersplat-main/src/controllers.ts:45-47`

```js
const zoom = (amount: number) => {
    camera.setDistance(camera.distance - (camera.distance * 0.999 + 0.001) * amount * zoomSensitivity, 2);
};
```

`Δd ∝ d`（步长正比于当前距离）。相对变化率恒为约 40%/100px，
绝对移动量随距离缩放。实测（每 100px 捏合，R = 场景半径）：

| 当前 d | 世界移动量 | 相对变化 |
|---|---|---|
| 4.0（远） | 2.37 R | −40% |
| 1.0（初始） | 0.59 R | −40% |
| 0.25（近） | 0.148 R | −40% |
| 0.0625（很近） | 0.037 R | −40% |

> ⚠ **此处曾有一个误判（已修正）**：最初把上式读成「放大越慢、缩小越快」，
> 据此认为建模模式是强几何缩放、换成指数就能解决，于是把 `gameZoomRate` 定成了 0.35。
>
> 真机反馈「两模式没区别」推翻了它。实测测量显示：`× 0.999` 这个系数让 `Δd`
> 几乎精确正比于 `d`，**建模模式本身已经接近恒定倍率**（一次 200px 捏合约 0.45 倍）。
> 只有 `d` 极小时 `+ 0.001` 项才占主导，步长才会塌缩。
>
> 教训：不能只看公式形态就下结论，要用真实事件驱动代码测观测值。详见 §11.2。

**缩放边界** — `scene-config.ts:34-35`

```js
minZoom: 1e-6,
maxZoom: 10.0,   // 绝对值，与场景尺寸无关
```

`maxZoom = 10` 换算真实距离约 `14.8 R`，**1.6 次满屏捏合就撞墙**（V1 反馈「缩到一定值就不动」的成因）。

**步进按钮** — `dock.js:674`

```html
<input class="sd-num" data-shot="step" type="number" step="0.01" min="0.001" value="0.1">
```

硬编码 `0.1 米/次`，与场景尺度无关：5m 场景太大、200m 场景没反应。

### 1.2 不需要改的部分

| 交互 | 现状 | 结论 |
|---|---|---|
| 单指拖动旋转 | `controllers.ts:216` `orbit()`，走角度（`orbitSensitivity 0.3`） | 与场景尺寸无关，天然恒定，**不动** |
| 双指同向平移 | `controllers.ts:239` `pan()`，屏幕像素 → 当前视深世界坐标 | 「抓住地面拖」，标准做法，老板认可，**不动** |

## 2. 目标与边界

### 目标
- 新增**游戏模式**（默认）：缩放与步进按场景尺度恒定。
- 保留**建模模式**：完全等于当前行为，随时可切回。
- 步进值随场景变化自动刷新，且不会因放一个道具就抖动。
- 视口面板可查看 / 手动改 / 一键重置。

### 不做
- 不改旋转逻辑。
- 不改双指平移的投影算法。
- 不改机位（shot）系统、渲染输出、裁剪、焦距。
- 不引入新的第三人称角色控制（不是做游戏引擎，只是让导航手感恒定）。

## 3. 核心概念：D_fit

所有参数用**场景自适应基准**表达，不再用绝对值。

```js
// camera.ts:832 已有
fovFactor = sin(fov / 2) = sin(85°/2) = 0.676

// 新概念
D_fit = sceneRadius / fovFactor      // sceneRadius = bound.halfExtents.length()（已有，camera.ts:519）
      ≈ 1.48 × sceneRadius
```

**语义**：相机退到 `D_fit`，整个场景刚好填满画面。当前 `initialZoom = 1.0` 正好等于它，
所以默认视角一直是好的 —— 说明这个基准是对的。

引擎内部用归一化 `d = 世界距离 / (sceneRadius / fovFactor)`（`camera.ts:688`），
所以参数若以 `D_fit` 的倍数给出，**归一化值就是纯数字，天然免场景尺度影响**。

## 4. 参数表

### 4.1 游戏模式

| 参数 | 取值（归一化 d） | 含义 |
|---|---|---|
| 初始 | `1.0` | 保持现状 |
| 最远 | `8.0` | 场景 + 充足余量，够摆新道具 |
| 最近 | `0.02` | 能贴脸看角色，不钻进模型 |
| 一次满屏捏合（≈390px） | `Δd = 1.5 × d` | 恒定速度：每捏一屏退后 1.5 倍距离 |
| 方向按钮步进 | `R / 25`，量化到 1-2-5 | 约 25 步横穿半场 |

不同场景实际值：

| R | D_fit | 一次捏合 | 最远 | 最近 | 步进 |
|---|---|---|---|---|---|
| 5 m | 7.4 m | 11 m | 59 m | 0.15 m | 0.2 m |
| 50 m | 74 m | 111 m | 592 m | 1.5 m | 2 m |
| 200 m | 296 m | 444 m | 2368 m | 5.9 m | 8 m |

从最远到最近约 **5~6 次满屏捏合**，不会觉得累。

### 4.2 建模模式

完全等于现状，一行不改：

```
minZoom = 1e-6 · maxZoom = 10 · initialZoom = 1
zoom: Δd ∝ d（几何缩放）· 步进默认 0.1 米/次（手动）
```

## 5. 缩放公式（游戏模式）

现在的「加法项」`+ 0.001` 是为防 `d = 0` 打的补丁，在游戏模式下应去掉，改成纯比例：

```js
// 游戏模式：一次手势的「倍率」由手势位移决定，与当前 d 无关
const k = Math.exp(-amount * gameZoomSensitivity);   // amount = 双指间距变化，单位 px
camera.setDistance(clampGame(camera.distance * k));
```

关键差异：倍数恒定 → 手感恒定。上下限用第 4.1 节的 `0.02 / 8.0` clamp。

> 实现时 `zoom()` 保持单一入口，内部分派：
> `if (navMode === 'game') { ... } else { 原逻辑 }`。建模模式走原分支，零回归风险。

## 6. 自动刷新与防抖动

### 6.1 挂载点（引擎已有）

`camera.ts:514` `onBoundChanged(bound)` 已经在监听包围盒变化并做距离补偿：

```js
onBoundChanged(bound) {
    const prevDistance = this.distanceTween.value.distance * this.sceneRadius;
    this.sceneRadius = Math.max(1e-03, bound.halfExtents.length());
    this.setDistance(prevDistance / this.sceneRadius, 0);
}
```

在同一处派发 `camera.navMetricsChanged`（新增事件），带上 `{ sceneRadius, dFit }`。

### 6.2 量化到 1-2-5 序列

问题：放一个人偶、删一个道具，包围盒都会变，`R` 随之微调 → 步进值抖动。

解法：

```
stepRaw = sceneRadius / 25
step    = snapTo125(stepRaw)   // 吸附到最近的 …0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50…
```

效果：只有场景尺度**跨档**（5m 级 → 20m 级）才跳一档，中间小改动完全无感。

### 6.3 手动优先

沿用 `thumbsUserOff` 那套模式：

- 用户没手动改过 → 场景变化自动刷新
- 用户手动改过（`navStepUserSet = true`）→ 不再自动覆盖
- 面板「↺ 按场景重置」→ 清标记 + 立即按当前场景重算

## 7. 设置入口与存储

放进现有「视口」面板（`dock.js:532` `buildViewportPanel`），它已有裁剪、焦距两行：

```
视图模式   [ 游戏 ] [ 建模 ]          ← 默认游戏
步进       [ 2.0 ] 米/次   [ ↺ ]
```

**存储：全局偏好，不进工程。**

理由：这是使用习惯，不是场景属性。换工程还重新设会很烦。

沿用 dock 已有的 `localStorage` 模式（参考 `SD_ALPHA_KEY`，`dock.js:20-29`）：

```js
const NAV_MODE_KEY = 'sd-nav-mode';    // 'game' | 'model'
const NAV_STEP_KEY = 'sd-nav-step';    // 数字
const NAV_STEP_USER_KEY = 'sd-nav-step-user';  // '1' = 用户手动设过
```

> 注意：不要写进 `meta`/工程 JSON，避免污染 `moyutai.marks` 与项目存档结构。

## 8. 改动清单

| 文件 | 改动 | 规模 |
|---|---|---|
| `supersplat-main/src/scene-config.ts` | 新增 `navMode`、游戏模式上下限常量 | ~8 行 |
| `supersplat-main/src/controllers.ts` | `zoom()` 内分派；游戏模式走纯比例 + 场景 clamp | ~20 行 |
| `supersplat-main/src/camera.ts` | `onBoundChanged` 派发 `camera.navMetricsChanged`；暴露 `dFit` 与 clamp setter | ~20 行 |
| `supersplat-main/src/editor.ts` | 注册 `camera.navMode` / `camera.navStep` 事件 | ~15 行 |
| `supersplat-apk/www/dock.js` | 视口面板加「视图模式」一行 + 步进输入 + 重置钮；全局偏好读写 | ~60 行 |
| `supersplat-apk/www/dock.css` | 新行的样式（复用 `sd-dir-row` 既有类） | ~10 行 |
| `supersplat-main/dist` | 重新构建并同步到 `www/`（保护 overlay 不被覆盖） | 构建产物 |

**建模模式路径完全不动**，保证随时能切回去对比。

## 9. 里程碑

| 阶段 | 内容 | 验证 |
|---|---|---|
| **M1** | 引擎侧：`navMode` + 游戏模式缩放 + 场景自适应 clamp | 本地 headless 探针：不同 `R` 下 5~6 次捏合走完全程；建模模式数值与改动前逐项比对一致 |
| **M2** | 自动刷新 + 1-2-5 量化 + 手动优先 | 探针：模拟 bound 反复微调，步进值不抖；跨档时正好跳一档 |
| **M3** | 视口面板 UI + 全局偏好持久化 | 探针 + 真机：切模式后行为切换正确；杀进程重进偏好还在 |
| **M4** | 出包交付 + 真机手感确认 | 老板真机试用，确认「放大不再变慢」 |

## 10. 风险

| 风险 | 影响 | 对策 |
|---|---|---|
| 改 `zoom()` 波及桌面鼠标滚轮 | 桌面端手感变化 | 游戏模式默认只作用于触屏双指分支；滚轮保持原逻辑（待确认） |
| `sceneRadius` 在空场景为 1（默认值） | 进空工程时步进值离谱 | `onBoundChanged` 已有 `Math.max(1e-03, ...)`；空场景额外用保守默认值 |
| 归一化与 `fov` 联动 | 改焦距后 `D_fit` 变化，步进跟着变 | 这是**正确行为**（长焦看得更远），但要在面板上实时反映 |
| 机位系统读取相机距离 | 切模式后机位还原可能不一致 | 机位存的是解析后位姿（绝对世界坐标），与 `navMode` 无关，预期无影响；M3 验证 |

## 11. 实施记录（2026-11-06，v48d + v48e）

老板拍板「按你建议的来」，四项取值全部采用本节默认值。已实现、已交付。
其中 `gameZoomRate` 在 v48e 被修正（见 §11.2），最终值是 **0.8** 而非初版的 0.35。

### 实际落地

| 文件 | 改动 |
|---|---|
| `scene-config.ts` | `navMode: 'game'`、`gameZoomMin 0.02`、`gameZoomMax 8.0`、`gameZoomRate 0.8`（v48e 修正，初版 0.35 无效） |
| `camera.ts` | `Camera.clampDistance()` 统一钳制；`get dFit`；`get suggestedStep`（`snap125`）；`onBoundChanged` 派发 `camera.navMetrics` |
| `controllers.ts` | `zoomPinch()`：游戏模式走 `d × exp(-amount × rate)`；**只有触屏双指走这里**，鼠标滚轮保持原逻辑 |
| `editor.ts` | `camera.navMode` / `camera.setNavMode` / `camera.navMetrics` 事件；fov 改动也走 `clampDistance` |
| `director.ts` | `getNavMode()` / `setNavMode()` / `getNavMetrics()` |
| `dock.js` | 视口面板「视图 [游戏][建模]」+「步进 + ↺」+ 场景半径提示；localStorage 全局偏好 |
| `dock.css` | `.sd-nav-btn` 及激活态 |

### 实现中补充的两个决定

1. **步进下限 0.1**：空场景 `sceneRadius` 默认 1，`1/25 = 0.04` 太小，按钮等于没动。
   加 `Math.max(sceneRadius / 25, 0.1)` 兜底，有内容后包围盒接管。
2. **`navBoot` 重试**：面板在 dock 初始化时就构建，那时 `__director` 还没注册，
   一次读取会拿到 undefined 并永久失效。改为每 250ms 重试，最多 120 次。

### 11.1 最终验证数据（v48e，真实事件驱动）

| 项 | 结果 |
|---|---|
| tsc | clean |
| 游戏模式倍率（200px 捏合） | **0.202 × 4，恒定**（d=1.0 与 d=0.2 一致） |
| 建模模式倍率（同条件） | 0.445 → 0.442（按设计缓慢漂移） |
| 收拢（300→100px） | 游戏 4.953 / 建模 2.203 |
| 游戏模式上下限 | 8.0 / 0.02 |
| 建模模式上下限 | 10 / 1e-6 |
| 切模式 re-clamp（model 9.5 → game） | 拉回 8.0 ✓ |
| 步进量化 | R=5→0.2、20→1、50→2、120→5、200→10、500→20 |
| 面板 UI | 按钮切换/持久化/手动锁定/重置全通 |
| 导演台回归 | 16/16 |
| 音视频回归 | 48/48 |

### 11.2 v48e 修正：两个必须记录的缺陷

**缺陷 1：`gameZoomRate 0.35` 等于没改**

初版认为「建模模式是强几何缩放，换成指数就能拉开差距」。实测否决：
`× 0.999` 让 `Δd` 几乎精确正比于 `d`，建模模式本身就是 ~0.45 倍/捏合。
而 `exp(-amount × 0.35)` 算出 ~0.50 倍/捏合 —— **只差 10%，肉眼无法分辨**。

这才是老板反馈「两模式用起来没啥区别」的真实原因。
修正为 `0.8`：游戏模式 **0.20 倍/捏合**，与建模模式 0.45 拉开一倍以上。

> 教训：参数不能凭公式形态拍脑袋，必须量化对比两套方案的实际输出值。

**缺陷 2：`setPointerCapture` 抛错会彻底杀死双指手势**

```js
const pointerdown = (event) => {
    ...
    target.setPointerCapture(event.pointerId);   // ← 可能抛 NotFoundError
    touches.push({ ... });                        // ← 抛错则永远执行不到
};
```

`setPointerCapture` 在「指针 id 不活跃」时抛 `NotFoundError`（合成事件、部分
WebView 实现、指针在派发与处理之间已释放）。一旦抛出，`touches` 永远到不了 2，
双指分支不可达 → **捏合完全无反应**。

修正：包成 `safeCapture()`。指针捕获只是「拖出元素外仍能继续」的优化，
不是手势的前置条件。

**方法论修正（最重要）**

初版的验证方式是**在脚本里复刻公式再算差值**，所以 0.35 那个无效值照样"测试通过"。
改为用 headless Edge 真实派发 pointer 事件、逐帧推进、走完整控制器代码路径，
才同时暴露出上面两个缺陷。此类探针必须断言**观测到的状态**（camera.distance），
而不是断言自己推导出的中间量。

### 11.3 调参入口

| 想改什么 | 改哪里 | 现值 |
|---|---|---|
| 捏合快慢 | `scene-config.ts` `gameZoomRate` | 0.8（调大更快，1.2 会非常"游戏"）|
| 最远范围 | `scene-config.ts` `gameZoomMax` | 8.0（D_fit 的倍数）|
| 最近范围 | `scene-config.ts` `gameZoomMin` | 0.02 |

三者都是单点常量，改完重建引擎 + `sync_dist.cjs` 即可。

## 12. 待确认（老板）—— **已随 v48d 落地**

1. 模式偏好**全局**存储（换工程保留）——本方案已按这个前提写。
2. 游戏模式下方向按钮步进**保留手动改**，默认自适应 + 一键重置。
3. 最远 `8 × D_fit` / 最近 `0.02 × D_fit` 是否合适。若主要做 50~200m 场地，这组数够用；若有极小物件场景，最近值需再放宽。
4. 桌面鼠标滚轮**是否也走游戏模式**（影响 PC 端手感）——建议先只改触屏，滚轮保持原样。
