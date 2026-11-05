# 视图导航模式（游戏 / 建模）开发方案 v0.1

> 版本：v0.1（2026-11-05）· 维护者：全栈工程师
> 关联：`docs/DIRECTOR.md`（相机模型）、`www/dock.js`（视口面板）、`supersplat-main/src/{controllers,camera,scene-config}.ts`
> 状态：**方案待拍板，未开工**

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

`Δd ∝ d`（步长正比于当前距离）→ **几何缩放**。相对变化率恒为约 40%/100px，
但绝对移动量随距离塌缩。实测（每 100px 捏合，R = 场景半径）：

| 当前 d | 世界移动量 | 相对变化 |
|---|---|---|
| 4.0（远） | 2.37 R | −40% |
| 1.0（初始） | 0.59 R | −40% |
| 0.25（近） | 0.148 R | −40% |
| 0.0625（很近） | 0.037 R | −40% |

→ 缩小（d 变大）越来越快，放大（d 变小）越来越慢。**与老板描述完全一致**。

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

## 11. 待确认（老板）

1. 模式偏好**全局**存储（换工程保留）——本方案已按这个前提写。
2. 游戏模式下方向按钮步进**保留手动改**，默认自适应 + 一键重置。
3. 最远 `8 × D_fit` / 最近 `0.02 × D_fit` 是否合适。若主要做 50~200m 场地，这组数够用；若有极小物件场景，最近值需再放宽。
4. 桌面鼠标滚轮**是否也走游戏模式**（影响 PC 端手感）——建议先只改触屏，滚轮保持原样。
