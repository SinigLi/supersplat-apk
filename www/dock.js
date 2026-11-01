/* 摸鱼台（SuperSplat fork）Dock Overhaul — 移动端分组工具栏
 * 当前版本：v11（2026-10-17 交互重构：撤销/重做上顶栏，测量入右栏，底栏五连=选择/游标/删除/变换/导演台，场景入口移入导演台面板）
 *
 * 架构总览（详见仓库 DOCK.md）：
 *   三个停靠组：顶=菜单组（文件/编辑/选择/渲染/帮助/场景） 底=编辑组（选择/变换/裁剪/测量+撤销/重做） 右=视图组（相机/显示/定位）
 *   核心思路：把 SS 原有按钮 DOM（含事件）重挂进 dock —— 功能零重写，只管布局与手势
 *   全屏层（z1300）：所有弹窗（#dialog 系列）+ 场景/外观/浮层/设置面板，统一全屏列表风+左上角返回
 *
 * ⚠ 维护红线（历次真机事故总结，改前必读）：
 *   1. 给 PCUI 组件写 display 时必须同时考虑 .pcui-hidden 态（v6.1 启动鬼影弹窗根因）
 *   2. 全屏规则用 100% 不用 100vw/vh（滚动条差 → 真机右侧漏缝）；z-index 统一 1300
 *   3. SS 打开外观/浮层/设置面板时会内联写 top 锚定定位，必须 MutationObserver 钳位回原点（v6.3 top:-376 根因）
 *   4. 动态生成按钮的关闭逻辑用 dataset 标记定位（data-role），不能靠文本匹配（v6.4 高亮不灭根因）
 *   5. SS 原生可能随时插入新面板：新面板报问题时先查它是否在 dock.js 全屏名单外
 */
(function () {
'use strict';

/* v32：悬浮窗半透明 —— CSS 变量 --sd-alpha 驱动停靠栏/子工具浮层背景，
 * 值存 localStorage（默认 0.6），设置页滑条实时改（同步改 dock.css 三处 rgba） */
const SD_ALPHA_KEY = 'sd-alpha';
const SD_ALPHA_DEFAULT = 0.6;
function applySdAlpha(v) {
  const a = Math.min(1, Math.max(0.2, +v || SD_ALPHA_DEFAULT));
  document.documentElement.style.setProperty('--sd-alpha', String(a));
  try { localStorage.setItem(SD_ALPHA_KEY, String(a)); } catch (e) {}
  return a;
}
try { applySdAlpha(localStorage.getItem(SD_ALPHA_KEY) || SD_ALPHA_DEFAULT); } catch (e) { applySdAlpha(SD_ALPHA_DEFAULT); }

/* ===================== 配置区说明 =====================
 * GROUPS：底栏二级分组（ids 为 SS 原按钮 id，收养后功能不变）
 * DOCKS：三个停靠组；menuOptions=顶栏菜单模式，viewOptions=右栏一级分组模式
 * MENU_ORDER：SS #menu 下 .menu-panel 追加顺序（menu.ts append 顺序，SS 升级需核对）
 */

// 等编辑器 UI 装配完成
function waitUI(cb) {
  let n = 0;
  const t = setInterval(() => {
    n++;
    if (document.getElementById('bottom-toolbar') && document.getElementById('right-toolbar')) { clearInterval(t); cb(); }
    else if (n > 300) clearInterval(t);
  }, 200);
}

waitUI(function () {
  const GROUPS = {
    select: { ico:'🎯', name:'选择', ids:['bottom-toolbar-selection-mode','bottom-toolbar-selection-footprint','bottom-toolbar-picker','bottom-toolbar-brush','bottom-toolbar-polygon','bottom-toolbar-eyedropper','bottom-toolbar-sphere-brush'] },
    xform:  { ico:'🔢', name:'变换', ids:['bottom-toolbar-move','bottom-toolbar-rotate','bottom-toolbar-scale'] },
    shape:  { ico:'✂️', name:'裁剪', ids:['bottom-toolbar-sphere','bottom-toolbar-box'] },
    file:   { ico:'📁', name:'文件', ids:[] },   // v1: 菜单按钮代理
    view:   { ico:'👁', name:'视图', ids:['right-toolbar-appearance','right-toolbar-overlays','right-toolbar-orbit-mode','right-toolbar-fly-mode','right-toolbar-frame-selection','right-toolbar-camera-origin','right-toolbar-settings'] },
  };

  const DOCKS = [
    { id:'file', label:'菜单', pos:'left',   groupIds:[], menuOptions:true,   // v39 #4: 菜单栏默认停靠左上角
      extra:[ {id:'bottom-toolbar-undo', ico:'↶', name:'撤销'}, {id:'bottom-toolbar-redo', ico:'↷', name:'重做'} ] },
    { id:'edit', label:'工具', pos:'bottom', groupIds:['xform'], dirBar:true,
      extra:[] },
    { id:'view', label:'视图', pos:'right',  groupIds:[], viewOptions:true,
      extra:[] },   // v33：测量移入「定位」分组面板
  ];

  // v10 分镜工具定位：泼溅专属菜单（文件/选择/帮助）先隐藏，保留编辑；
  // 被隐藏的 .menu-panel 仍留在 #menu 内但无入口可开（pcui-hidden）
  // v23：老板要求顶栏不再放「渲染」分组按钮，TOP_MENUS 置空。
  // 渲染菜单面板本身仍在 #menu 内，只是没有入口（要恢复就把条目加回来）。
  const MENU_ORDER = ['file','open-recent','import-recent','export','edit','selection','render','video-tutorials','help'];
  const TOP_MENUS = [
  ];

  const btnEl = id => document.getElementById(id);
  const allPanels = new Map();
  const docks = [];

  // 通用工具按钮样式类（借 PCUI 按钮外观，dock 自己的容器样式在 dock.css）
  function makeShell(html, cls) {
    const el = document.createElement('div');
    el.className = cls;
    el.innerHTML = html;
    return el;
  }

  // 顶部菜单组需要名称映射（收养的是 label 按钮）
  const MENU_NAMES = ['文件','编辑','选择','渲染','帮助'];

  /* ===================== dock 构建 ===================== */

  // 把 SS 原按钮搬进容器（保事件）；原按钮可能在 #bottom-toolbar 里
  function adopt(id, container) {
    const el = btnEl(id);
    if (!el) return false;
    el.classList.add('sd-adopted');
    container.appendChild(el);
    return true;
  }

  function makeGroupBtn(gid, dock) {
    const g = GROUPS[gid];
    const btn = makeShell(`<span class="sd-ico">${g.ico}</span><span class="sd-name">${g.name}</span><span class="sd-dot"></span>`, 'sd-grp-btn');
    btn.dataset.grp = gid;

    const wrap = makeShell('', 'sd-sub-wrap');
    wrap.dataset.grp = gid;
    g.ids.forEach(id => adopt(id, wrap));
    document.body.appendChild(wrap);
    allPanels.set(gid, wrap);

    btn.onclick = () => toggleGroup(gid, dock);
    return btn;
  }

  function makeExtraBtn(t, dock) {
    const el = btnEl(t.id);
    if (!el) return null;
    el.classList.add('sd-adopted','sd-extra');
    // 撤销/重做原按钮只有图标，加个名字
    if (!el.querySelector('.sd-name') && !el.textContent.trim()) {
      el.insertAdjacentHTML('beforeend', `<span class="sd-name">${t.name}</span>`);
    }
    return el;
  }

  /* v34：保存/返回并入顶部菜单停靠栏。原 pj-bar 固定在屏幕左上角独占一条，
   * 老板要求并进菜单停靠栏。两个按钮带着原事件搬进 dock（紧贴 ≡ 把手右侧），
   * 原 bar 容器隐藏（display:none），syncEditorBar 量到零矩形会自动清掉避让变量；
   * 显隐仍由 body.sd-has-bar 驱动（工程列表页隐藏、编辑页显示）。
   * projects-ui 的初始化与 waitUI 有竞态，用轮询兜底（同 bindToolWatch 模式）。 */
  function adoptProjectButtons(dock) {
    let n = 0;
    const t = setInterval(() => {
      const bar = document.querySelector('.pj-bar');
      if (bar && bar.children.length) {
        clearInterval(t);
        const btns = Array.from(bar.querySelectorAll('.pj-bar-btn'));
        btns.forEach(b => b.classList.add('sd-adopted', 'sd-pjbtn'));
        btns.reverse().forEach(b => dock.querySelector('.sd-handle').insertAdjacentElement('afterend', b));
        bar.style.display = 'none';
      } else if (++n > 120) clearInterval(t);
    }, 500);
  }

  /* ===== 导演台组（v9）：SS 源码侧 src/director.ts 提供 window.__director，
   * 通过 'director-state' DOM 事件同步状态；本面板只发命令不解析 GLB ===== */
  const DIR_NAME = '导演台';
  // v12：角色下拉（人物库）+ 动作下拉 + 颜色下拉；删除/添加场景移入面板
  const DIR_PANEL_HTML =
    '<div class="sd-dir-row"><select class="sd-dir-chars" title="角色库"></select>' +
    '<button class="sd-dir-btn" data-act="add" title="在 3D 游标处摆放人偶">🧍</button></div>' +
    '<div class="sd-dir-row"><select class="sd-dir-clips" title="动作"></select>' +
    '<button class="sd-dir-btn" data-act="playpause" title="播放/暂停">⏯</button></div>' +
    '<div class="sd-dir-row"><select class="sd-dir-tints" title="颜色"></select></div>' +
    '<div class="sd-dir-row"><button class="sd-dir-btn" data-act="import" title="导入资产（泼溅 / 3D 模型，按后缀自动识别）">📥</button>' +
    '<button class="sd-dir-btn" data-act="delete" title="删除选中对象">🗑</button>' +
    '<button class="sd-dir-btn sd-dir-scene" data-act="scene" data-role="scene-toggle" title="资产列表（人偶/道具/泼溅）">🗂 资产列表</button></div>' +
    '<div class="sd-dir-info">选角色 → 摆放人偶</div>';

  function bindDirectorPanel(panel) {
    const infoEl = panel.querySelector('.sd-dir-info');
    const sel = panel.querySelector('.sd-dir-clips');
    const charSel = panel.querySelector('.sd-dir-chars');
    const tintSel = panel.querySelector('.sd-dir-tints');
    const btns = {};
    panel.querySelectorAll('.sd-dir-btn').forEach(b => { btns[b.dataset.act] = b; });
    const setActive = (act, on) => { if (btns[act]) btns[act].classList.toggle('sd-on', on); };

    // 角色下拉：来自 window.__director.listCharacters()；v31 方块作为模型数据
    // 入选下拉（老板反馈：方块和人偶一样是模型，不该独立按钮）
    function fillChars() {
      const d = window.__director;
      if (!d || charSel.options.length) return;
      d.listCharacters().forEach((c) => {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = c.name;
        charSel.appendChild(o);
      });
      charSel.value = d.currentCharId || 'woman';
    }

    // 颜色下拉：与 Blender 导演台同一套七色
    const TINT_LABELS = [['NONE','原色'],['RED','红'],['ORANGE','橙'],['YELLOW','黄'],
                         ['GREEN','绿'],['BLUE','蓝'],['GRAY','灰'],['PURPLE','紫']];
    TINT_LABELS.forEach(([v, n]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = n;
      tintSel.appendChild(o);
    });

    function fillClips() {
      const d = window.__director;
      if (!d) return;
      const clips = d.listClips();
      const key = clips.map(c => c.index + ':' + c.label).join('|');
      if (sel.dataset.key === key) return;
      sel.dataset.key = key;
      sel.innerHTML = '';
      clips.forEach((c) => {
        const o = document.createElement('option');
        o.value = c.index;
        o.textContent = c.label;
        sel.appendChild(o);
      });
    }

    // v12b：面板打开时立即填充（此前只在 director-state 事件里填，
    // 首次进入导演台、还没任何状态事件 → 角色列表空）
    function refreshAll(preload) {
      fillChars();
      const d = window.__director;
      if (!d) return;
      if (d.info().loaded) {
        fillClips();
      } else if (preload && typeof d.switchCharacter === 'function') {
        // 打开导演台就预加载当前角色，动作下拉不必等第一次摆放
        d.switchCharacter(d.currentCharId || 'woman');
      }
    }
    panel.__sdRefresh = refreshAll;
    refreshAll();
    // 模块可能比面板晚就绪：轮询到 __director 出现后立刻灌一次列表
    let bootTries = 0;
    const bootTimer = setInterval(() => {
      if (window.__director) { refreshAll(true); clearInterval(bootTimer); }
      else if (++bootTries > 120) clearInterval(bootTimer);
    }, 100);

    panel.addEventListener('click', (e) => {
      const b = e.target.closest('.sd-dir-btn');
      if (!b) return;
      e.stopPropagation();
      const d = window.__director;
      if (!d) { showMsg('导演台模块未就绪'); return; }
      const act = b.dataset.act;
      if (act === 'add') {
        // v35：方块也是角色（box.glb，第五个内置角色），统一走人偶摆放入口
        const r = d.addPuppet();
        showMsg(r === 'loading' ? '模型资源加载中…' : (charSel.value === 'box' ? '方块已在游标处生成' : '人偶已在游标处生成'));
      } else if (act === 'move') {
        const r = d.armPlacePuppet();
        showMsg(r === 'loading' ? '人偶资源加载中…' : (r === 'place-puppet' ? '点击画布放置人偶（再点取消）' : '已取消放置'));
      } else if (act === 'import') {
        pickAssets();
      } else if (act === 'delete') {
        const r = d.deleteSelected();
        showMsg(r === 'ok' ? '已删除选中对象（可撤销）' : '没有可删除的对象');
      } else if (act === 'scene') {
        toggleSceneSheet();
      } else if (act === 'playpause') {
        const i = d.info();
        if (i.playing) { d.pause(); showMsg('已暂停'); }
        else { d.play(); showMsg('播放中'); }
      }
    });

    sel.addEventListener('change', () => {
      const d = window.__director;
      // v12：换动作不自动播放，停在新动作第一帧
      if (d) { d.setClip(+sel.value); showMsg('已切换到「' + sel.options[sel.selectedIndex].textContent + '」首帧'); }
    });

    charSel.addEventListener('change', () => {
      const d = window.__director;
      if (!d) return;
      const r = d.switchCharacter(charSel.value);
      showMsg(r === 'loading' ? '角色加载中…' : '已切换角色');
    });

    tintSel.addEventListener('change', () => {
      const d = window.__director;
      if (!d) return;
      // v35：方块已是人偶管线，乘法染色直接生效（黄点/导演台联动同理）
      const r = d.setTint(tintSel.value);
      showMsg(r === 'ok' ? '已换色' : '先选中一个人偶');
    });

    document.addEventListener('director-state', (ev) => {
      const info = ev.detail && ev.detail.info;
      if (!info) return;
      fillChars();
      if (info.loaded) fillClips();
      if (typeof info.clip === 'number' && info.clip >= 0) sel.value = String(info.clip);
      if (info.selectedCharId) charSel.value = info.selectedCharId;
      if (info.selectedTint) tintSel.value = info.selectedTint;
      setActive('move', info.mode === 'place-puppet');
      // v11 底栏导演台动作按钮的 armed 高亮同步（选择/游标）
      document.querySelectorAll('.sd-dir-act[data-act="cursor"]').forEach(x => {
        x.classList.toggle('sd-active', info.mode === 'place-cursor');
      });
      if (info.hasPuppet && info.selectedName) {
        infoEl.textContent = `${info.selectedName} · ${info.clipLabel || '无动作'} ${info.playing ? '▶' : '⏸'}`;
      } else {
        infoEl.textContent = '选角色 → 摆放人偶';
      }
    });
  }

  /* v38 相机面板区：渲染结果预览层 + 视口组（全局相机实时参数）+ 机位组（每机位独立裁剪/焦距）。
   * 机位数据在导演台里（window.__director.shots），这里只做展示与调用。
   */

  /* 渲染结果预览层。
   * 三个动作都走原生：WebView 会静默忽略 <a download>，长按我们自己的浮层
   * 也不会弹系统保存菜单。
   *   保存到相册 → SaveImage.save   （直接进 Pictures/摸鱼台）
   *   另存为     → SaveImage.saveAs （系统文件选择器，用户挑目录）
   *   分享       → SaveImage.share  （系统分享面板）
   */
  function nativeImageApi() {
    var cap = window.Capacitor;
    return (cap && cap.Plugins && cap.Plugins.SaveImage) || null;
  }

  async function callNativeImage(method, r) {
    var api = nativeImageApi();
    if (!api) return { ok: false, reason: "no-native" };
    try {
      const res = await api[method]({
        data: r.dataUrl,
        filename: r.name || "shot.png"
      });
      return { ok: true, res: res || {}, name: (res && res.name) || r.name };
    } catch (e) {
      const detail = (e && (e.message || e.errorMessage)) || String(e);
      // 用户在系统选择器里按了取消：不是错误，别用红字吓人
      if (/cancelled|canceled/i.test(detail)) return { ok: false, cancelled: true };
      return { ok: false, reason: "failed", detail: detail };
    }
  }

  function showShotPreview(r) {
    var old = document.getElementById("sd-shot-preview");
    if (old) old.remove();
    var layer = document.createElement("div");
    layer.id = "sd-shot-preview";
    var img = document.createElement("img");
    img.src = r.dataUrl;
    img.alt = r.name || "机位照片";

    var bar = document.createElement("div");
    bar.className = "sd-shot-bar";
    var tip = document.createElement("span");
    tip.className = "sd-shot-tip";
    tip.textContent = r.name || "照片";

    var btnSave = document.createElement("button");
    btnSave.className = "sd-shot-save";
    btnSave.textContent = "保存到相册";

    var btnSaveAs = document.createElement("button");
    btnSaveAs.className = "sd-shot-saveas";
    btnSaveAs.textContent = "另存为";

    var btnShare = document.createElement("button");
    btnShare.className = "sd-shot-share";
    btnShare.textContent = "分享";

    var btnClose = document.createElement("button");
    btnClose.className = "sd-shot-close";
    btnClose.textContent = "关闭";
    btnClose.onclick = function(ev){ ev.stopPropagation(); layer.remove(); };

    var guard = async function(btn, busyText, okText, failText, method, after) {
      var api = nativeImageApi();
      if (!api) { showMsg("当前环境不支持（仅在 APK 内可用）"); return; }
      btn.disabled = true;
      var label = btn.textContent;
      btn.textContent = busyText;
      const out = await callNativeImage(method, r);
      btn.disabled = false;
      if (out.ok) {
        btn.textContent = okText;
        if (after) after(out);
      } else if (out.cancelled) {
        btn.textContent = label;
        showMsg("已取消");
      } else {
        btn.textContent = label;
        showMsg(failText + "：" + (out.detail || out.reason || "未知"));
      }
    };

    btnSave.onclick = function(ev){
      ev.stopPropagation();
      guard(btnSave, "保存中…", "✓ 已存相册", "保存失败", "save", function(out){
        showMsg("已保存到相册：Pictures/摸鱼台/" + out.name);
      });
    };

    btnSaveAs.onclick = function(ev){
      ev.stopPropagation();
      guard(btnSaveAs, "选择位置…", "✓ 已另存", "另存失败", "saveAs", function(out){
        showMsg("已另存为：" + out.name);
      });
    };

    btnShare.onclick = function(ev){
      ev.stopPropagation();
      guard(btnShare, "打开分享…", "✓ 已分享", "分享失败", "share", function(){
        showMsg("已交给系统分享面板");
      });
    };

    var actions = document.createElement("div");
    actions.className = "sd-shot-actions";
    actions.appendChild(btnSave);
    actions.appendChild(btnSaveAs);
    actions.appendChild(btnShare);
    actions.appendChild(btnClose);

    bar.appendChild(tip);
    bar.appendChild(actions);
    layer.appendChild(img);
    layer.appendChild(bar);
    layer.addEventListener("pointerdown", function(ev){ ev.stopPropagation(); });
    document.body.appendChild(layer);
    return layer;
  }

/* v39 面板代码：按老板 2026-11-01 八条反馈重写（整文件重写规矩）
 * #2 注释置顶/模式钮其下 #3 双击编辑+按住拖动 #5 机位视角模式 #7 三轴步进旋转
 */

  /* ----- v40 通用：数值块（双击就地编辑 + 双击长按拖动粗调） -----
   * #3 防误触：单击不触发；第一击只记时；双击（两击 <320ms）第二击快速松手 → 就地编辑；
   * 第二击按住 ≥260ms → 拖动模式（起算点重锚，避免跳值），松手生效。
   * 单击长按不再触发拖动（老板 v40 反馈：必须双击长按才起效）。
   * pointercancel 按松手处理（真机快速点按常被系统判成滚动而改发 cancel，v5 教训）。
   * v41：touch-action 改 pan-y，上下滑动放行给面板（老板 v41 反馈：数值框不能挡滚动）——
   * 指针捕获推迟到拖动武装时才加；武装后 touchmove preventDefault 锁滚动；
   * 纵向位移 >10px 的取消视为滚动面板，不算第二击。
   */
  function bindDragVal(el, cfg) {
    var startX = 0, startY = 0, startV = 0, dragging = false, armed = false, last = 0, moved = 0, movedY = 0;
    var holdTimer = 0, lastTap = 0, lastX = 0;
    var inp = el.querySelector(".sd-dv-in");
    el.addEventListener("pointerdown", function (e) {
      if (el.__editing) return;
      startX = e.clientX; startY = e.clientY; startV = cfg.get(); lastX = e.clientX;
      dragging = true; armed = false; moved = 0; movedY = 0;
      // v41：down 不再捕获指针（否则整块吃掉面板滚动）；武装时才捕获
      if (Date.now() - lastTap >= 320) return;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(function () {
        if (!dragging || el.__editing) return;
        armed = true;
        startX = lastX; startV = cfg.get();          // 从按住点起算，避免跳值
        try { el.setPointerCapture(e.pointerId); } catch (err) {}
        el.classList.add("sd-dv-drag");
        try { if (navigator.vibrate) navigator.vibrate(20); } catch (err) {}
      }, 260);
    });
    el.addEventListener("pointermove", function (e) {
      if (!dragging || el.__editing) return;
      moved = Math.max(moved, Math.abs(e.clientX - startX));
      movedY = Math.max(movedY, Math.abs(e.clientY - startY));
      lastX = e.clientX;
      if (!armed) return;
      var v = cfg.map(e.clientX - startX, startV);
      v = Math.max(cfg.min, Math.min(cfg.max, v));
      cfg.set(v); last = v; cfg.render();
      e.preventDefault();
    });
    // v41：武装后锁滚动（touch-action 在手势开始时已定，中途只能 preventDefault）
    el.addEventListener("touchmove", function (e) {
      if (dragging && armed) e.preventDefault();
    }, { passive: false });
    var up = function () {
      if (!dragging) return;
      clearTimeout(holdTimer);
      dragging = false; el.classList.remove("sd-dv-drag");
      if (armed) {
        if (moved > 2) cfg.commit(last);             // 拖过才提交；原地按住不动 = 无变化
      } else if (movedY > 10) {
        lastTap = 0;                                  // v41：纵向滑动 = 滚动面板，不算点击
      } else {
        var t = Date.now();
        if (t - lastTap < 320) startEdit();          // 第二击快速松手 → 编辑
        else lastTap = t;                            // 第一击：记时，等第二击
      }
      armed = false;
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", function () {
      // v41：未武装时滑出控件（无指针捕获）按放弃处理，避免残留计时误开编辑
      if (dragging && !armed) { clearTimeout(holdTimer); dragging = false; lastTap = 0; }
    });
    function startEdit() {
      clearTimeout(holdTimer);
      dragging = false; armed = false; el.classList.remove("sd-dv-drag");
      el.__editing = true; el.classList.add("sd-dv-edit");
      inp.value = String(Math.round(cfg.get() * 100) / 100);
      setTimeout(function () { inp.focus(); try { inp.select(); } catch (e) {} }, 40);
    }
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
    });
    inp.addEventListener("blur", function () {
      if (!el.__editing) return;
      el.__editing = false; el.classList.remove("sd-dv-edit");
      var raw = inp.value.trim(), v = Number(raw);
      if (raw === "" || !isFinite(v)) { showMsg("数值无效，已还原"); cfg.render(); return; }
      v = Math.max(cfg.min, Math.min(cfg.max, v));
      cfg.set(v); cfg.render(); cfg.commit(v);
    });
  }
  const DV_CLIP_MAP = (dx, v) => v + (dx / 120) * (2 * v);   // ±2×按下值走满 120px
  const DV_FOCAL_MAP = (dx, v) => v + dx * 2;                // 焦距 1px≈2mm（1–500mm）
  const dvHtml = (id, label, en, cls, rng) =>
    '<span class="sd-dv ' + cls + '" id="' + id + '">' +
      '<span class="sd-dv-t">' + label + ' ' + en + '</span>' +
      '<b class="sd-dv-v"></b>' +
      '<input class="sd-dv-in" type="number" inputmode="decimal" step="any">' +
      (rng ? '<span class="sd-dv-r">' + rng + '</span>' : '') +
    '</span>';
  const f2s = n => (Math.round(n * 100) / 100).toString();
  const f1s = n => (Math.round(n * 10) / 10).toString();
  const shotYawOf = (rec) => {
    const dx = rec.target[0] - rec.pos[0], dz = rec.target[2] - rec.pos[2];
    if (Math.hypot(dx, dz) < 1e-6) return 0;
    return Math.atan2(dx, dz) * 180 / Math.PI;
  };
  const shotPitchOf = (rec) => {
    const dx = rec.target[0] - rec.pos[0], dy = rec.target[1] - rec.pos[1], dz = rec.target[2] - rec.pos[2];
    return Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI;
  };
  const dvBusy = (els) => els.some(el => el && (el.__editing || el.classList.contains("sd-dv-drag")));

  /* ----- v39 视口组：#2 注释置顶，模式四钮在其下 ----- */
  function buildViewportPanel(wrap) {
    wrap.classList.add("sd-dir-panel", "sd-vp-panel");
    wrap.innerHTML =
      '<div class="sd-dir-hint">轨道 = 绕目标转 · 飞行 = 第一人称 · 框选 = 聚焦选中物 · 回原点 = 重置视角</div>' +
      '<div class="sd-dir-row sd-vp-modes"></div>' +
      '<div class="sd-dir-row sd-vp-cliprow">' +
        '<span class="sd-dv-lab">裁剪</span>' +
        '<span class="sd-pill" data-vp="state">自动</span>' +
        dvHtml("vp-near", "近", "NEAR", "sd-dv-near") +
        dvHtml("vp-far", "远", "FAR", "sd-dv-far") +
      '</div>' +
      '<div class="sd-dir-row sd-vp-cliprow">' +
        '<span class="sd-dv-lab">焦距</span>' +
        dvHtml("vp-foc", "焦距", "FOCAL", "sd-dv-foc", "1 – 500") +
      '</div>' +
      '<div class="sd-dir-hint">双击数值输入精确值；双击后第二击按住拖动粗调，松手生效（改动可撤销）；上下滑动不误触</div>' +
      '<div class="sd-dir-row">' +
        '<button class="sd-dir-btn sd-shot-btn" data-vp="restore" title="裁剪回自动 + 焦距回 50mm">↺ 恢复默认</button>' +
      '</div>' +
      '<div class="sd-sect">参数信息（只读 · 实时）</div>' +
      '<div class="sd-kv"><span class="sd-dv-lab">位置</span><span class="sd-kv-v" data-vp="pos"></span></div>' +
      '<div class="sd-kv"><span class="sd-dv-lab">方向</span><span class="sd-kv-v" data-vp="tgt"></span></div>' +
      '<div class="sd-kv"><span class="sd-dv-lab">旋转角</span><span class="sd-kv-v" data-vp="rot"></span></div>';

    const q = s => wrap.querySelector(s);
    const vp = { auto: true, near: 0.1, far: 1000, focal: 50 };
    const elNear = q("#vp-near"), elFar = q("#vp-far"), elFoc = q("#vp-foc");

    function vpRender() {
      elNear.querySelector(".sd-dv-v").textContent = f2s(vp.near);
      elFar.querySelector(".sd-dv-v").textContent = f1s(vp.far);
      elFoc.querySelector(".sd-dv-v").textContent = Math.round(vp.focal) + " mm";
      const st = q('[data-vp="state"]');
      st.textContent = vp.auto ? "自动" : "手动";
      st.className = "sd-pill" + (vp.auto ? "" : " sd-pill-manual");
    }
    function vpInfo() {
      const d = window.__director;
      if (!d || !d.getViewportInfo) return;
      const vi = d.getViewportInfo();
      q('[data-vp="pos"]').textContent = vi.pos.map(f2s).join(", ");
      q('[data-vp="tgt"]').textContent = vi.target.map(f2s).join(", ");
      const roll = vi.roll || 0;
      q('[data-vp="rot"]').textContent = f1s(vi.yaw) + "° / " + (vi.pitch >= 0 ? "+" : "") + f1s(vi.pitch) + "° / " + (roll >= 0 ? "+" : "") + f1s(roll) + "°";
      if (dvBusy([elNear, elFar, elFoc])) return;   // 拖动/编辑中不动数值
      vp.focal = vi.focal;
      const cr = vi.clip;
      if (cr && cr.enabled) { vp.auto = false; vp.near = cr.near; vp.far = cr.far; }
      else { vp.auto = true; vp.near = cr.near; vp.far = cr.far; }
      vpRender();
    }
    const vpSetClip = () => {
      const d = window.__director;
      if (!d || !d.setClipRange) return;
      const near = Math.max(0.01, vp.near);
      const far = Math.max(near * 2, vp.far);
      vp.near = near; vp.far = far;
      d.setClipRange({ enabled: true, near: near, far: far });
      vp.auto = false;
    };
    bindDragVal(elNear, {
      get: () => vp.near, set: v => { vp.near = v; }, map: DV_CLIP_MAP, min: 0.01, max: 1e9, render: vpRender,
      commit: v => { vpSetClip(); vpRender(); showMsg("已生效：近 = " + v.toFixed(2) + "（可撤销）"); }
    });
    bindDragVal(elFar, {
      get: () => vp.far, set: v => { vp.far = v; }, map: DV_CLIP_MAP, min: 0.1, max: 1e9, render: vpRender,
      commit: () => { vpSetClip(); vpRender(); showMsg("已生效：远 = " + vp.far.toFixed(1) + "（可撤销）"); }
    });
    bindDragVal(elFoc, {
      get: () => vp.focal, set: v => { vp.focal = v; }, map: DV_FOCAL_MAP, min: 1, max: 500, render: vpRender,
      commit: v => {
        const d = window.__director;
        if (d && d.setViewportFocal) d.setViewportFocal(v);
        showMsg("已生效：焦距 = " + Math.round(v) + " mm（可撤销）");
      }
    });
    const bRestore = q('[data-vp="restore"]');
    if (bRestore) bRestore.onclick = (e) => {
      e.stopPropagation();
      const d = window.__director;
      if (!d || !d.setClipRange) { showMsg("导演台模块未就绪"); return; }
      if (d.getShotViewId && d.getShotViewId()) { showMsg("机位视角模式中：机位参数用机位组的「恢复默认」"); return; }
      d.setClipRange({ enabled: false });
      if (d.setViewportFocal) d.setViewportFocal(50);
      vp.auto = true; vp.focal = 50;
      vpInfo(); vpRender();
      showMsg("已恢复默认视口：自动裁剪 + 焦距 50mm");
    };
    setInterval(() => { if (wrap.classList.contains("sd-open")) vpInfo(); }, 300);
    wrap.__sdRefresh = () => { vpInfo(); };
    vpInfo();
    return wrap.querySelector(".sd-vp-modes");   // SS 模式按钮收养位
  }

  /* ----- v39 机位组：#5 机位视角模式（查看↔退出、实时生效、恢复默认=进入时参数、
   * 退出保存+还原视口）+ #7 三轴步进旋转（水平/俯仰/倾斜 ±，默认 3°）----- */
  function buildShotPanel(wrap) {
    wrap.classList.add("sd-dir-panel", "sd-shot-panel");
    wrap.innerHTML =
      '<div class="sd-view-banner" data-shot="viewbanner" hidden>🎬 机位模式：<b data-shot="viewname"></b> · 调整即时生效</div>' +
      '<div class="sd-dir-row sd-shot-pick-row">' +
        '<select class="sd-shot-list" title="机位列表"></select>' +
        '<button class="sd-dir-btn sd-shot-btn sd-shot-mini" data-shot="rename" title="重命名选中的机位">✏️</button>' +
        '<button class="sd-dir-btn sd-shot-btn sd-shot-mini" data-shot="add" title="新增机位：记录当前视角（含裁剪/焦距）">＋</button>' +
      '</div>' +
      '<div class="sd-dir-row sd-shot-edit-row" hidden>' +
        '<input class="sd-shot-edit" type="text" maxlength="50" placeholder="机位名称">' +
        '<button class="sd-dir-btn sd-shot-btn sd-shot-mini" data-shot="rename-ok" title="确定">✓</button>' +
        '<button class="sd-dir-btn sd-shot-btn sd-shot-mini" data-shot="rename-no" title="取消">✕</button>' +
      '</div>' +
      '<div class="sd-dir-row">' +
        '<button class="sd-dir-btn sd-shot-btn" data-shot="relocate" title="重定位：把选中的机位移到当前视角（含裁剪/焦距）">📍 重定位</button>' +
        '<button class="sd-dir-btn sd-shot-btn" data-shot="remove" title="移除选中的机位">－ 移除</button>' +
      '</div>' +
      '<div class="sd-dir-row">' +
        '<button class="sd-dir-btn sd-shot-btn" data-shot="goto" title="进入该机位视角（再点退出并保存）">👁 查看</button>' +
        '<button class="sd-dir-btn sd-shot-btn" data-shot="render" title="渲染照片：按所选画幅从机位出 PNG">📷 渲染</button>' +
      '</div>' +
      '<div class="sd-dir-row sd-vp-cliprow">' +
        '<span class="sd-dv-lab">画幅</span>' +
        '<select class="sd-aspect-list" data-shot="aspect" title="照片画幅：视角里的白框即照片范围，白框外不会进照片">' +
          '<option value="21:9">21:9 超宽</option>' +
          '<option value="16:9">16:9 宽屏</option>' +
          '<option value="4:3">4:3</option>' +
          '<option value="1:1">1:1 方形</option>' +
          '<option value="3:4">3:4 竖版</option>' +
          '<option value="9:16">9:16 竖屏</option>' +
          '<option value="9:21">9:21 超竖</option>' +
        '</select>' +
      '</div>' +
      '<div class="sd-dir-row sd-vp-cliprow">' +
        '<span class="sd-dv-lab">裁剪</span>' +
        dvHtml("sv-near", "近", "NEAR", "sd-dv-near") +
        dvHtml("sv-far", "远", "FAR", "sd-dv-far") +
      '</div>' +
      '<div class="sd-dir-row sd-vp-cliprow">' +
        '<span class="sd-dv-lab">焦距</span>' +
        dvHtml("sv-foc", "焦距", "FOCAL", "sd-dv-foc", "1 – 500") +
      '</div>' +
      '<div class="sd-dir-hint" data-shot="edithint">进入视角后才能编辑该机位参数（画面即机位视角）</div>' +
      '<div class="sd-dir-row">' +
        '<button class="sd-dir-btn sd-shot-btn" data-shot="reset" title="回到进入视角时机位的样子">↺ 恢复默认</button>' +
      '</div>' +
      '<div class="sd-sect">步进移动（机身与看向点一起动，朝向不变）</div>' +
      '<div class="sd-dir-row">' +
        '<span class="sd-dv-lab">步进</span>' +
        '<input class="sd-num" data-shot="step" type="number" step="0.01" min="0.001" value="0.1" title="每次点按的移动距离（米）">' +
        '<span class="sd-dv-lab">米/次</span>' +
      '</div>' +
      '<div class="sd-nudge">' +
        '<button class="sd-nudge-btn" data-nudge="left" title="左移">←</button>' +
        '<button class="sd-nudge-btn" data-nudge="right" title="右移">→</button>' +
        '<button class="sd-nudge-btn" data-nudge="up" title="上移">↑</button>' +
        '<button class="sd-nudge-btn" data-nudge="down" title="下移">↓</button>' +
        '<button class="sd-nudge-btn" data-nudge="fwd" title="前移（朝看向方向）">前</button>' +
        '<button class="sd-nudge-btn" data-nudge="back" title="后移">后</button>' +
      '</div>' +
      '<div class="sd-sect">旋转（<input class="sd-num sd-num-mini" data-shot="astep" type="number" step="1" min="0.5" value="3" title="每次点按的旋转角度"> 度/次）</div>' +
      '<div class="sd-rot-grid">' +
        '<span class="sd-dv-lab">水平</span>' +
        '<button class="sd-rot-btn" data-rot="yaw+" title="水平角 +">＋</button>' +
        '<button class="sd-rot-btn" data-rot="yaw-" title="水平角 −">－</button>' +
        '<span class="sd-dv-lab">俯仰</span>' +
        '<button class="sd-rot-btn" data-rot="pitch+" title="俯仰角 +（抬头）">＋</button>' +
        '<button class="sd-rot-btn" data-rot="pitch-" title="俯仰角 −（低头）">－</button>' +
        '<span class="sd-dv-lab">倾斜</span>' +
        '<button class="sd-rot-btn" data-rot="roll+" title="倾斜角 +（画面顺歪）">＋</button>' +
        '<button class="sd-rot-btn" data-rot="roll-" title="倾斜角 −（画面逆歪）">－</button>' +
      '</div>' +
      '<div class="sd-sect">参数信息（只读 · 不常用）</div>' +
      '<div class="sd-kv"><span class="sd-dv-lab">位置</span><span class="sd-kv-v" data-sv="pos"></span></div>' +
      '<div class="sd-kv"><span class="sd-dv-lab">方向</span><span class="sd-kv-v" data-sv="tgt"></span></div>' +
      '<div class="sd-kv"><span class="sd-dv-lab">旋转角</span><span class="sd-kv-v" data-sv="rot"></span></div>';

    const q = s => wrap.querySelector(s);
    const list = q(".sd-shot-list");
    const editRow = q(".sd-shot-edit-row");
    const editInput = q(".sd-shot-edit");
    const btn = act => q('[data-shot="' + act + '"]');
    const elSNear = q("#sv-near"), elSFar = q("#sv-far"), elSFoc = q("#sv-foc");
    const elAspect = q('[data-shot="aspect"]');
    const banner = q('[data-shot="viewbanner"]'), bannerName = q('[data-shot="viewname"]');
    const bGo = btn("goto"), bReset = btn("reset"), stepIn = q('[data-shot="step"]');
    const nudgeGrid = q(".sd-nudge"), rotGrid = q(".sd-rot-grid"), editHint = q('[data-shot="edithint"]');
    const svPreview = { near: null, far: null, foc: null };

    function fill() {
      const d = window.__director;
      if (!d || !list) return;
      const keep = list.value;
      list.textContent = "";
      (d.listShots() || []).forEach(shot => {
        const o = document.createElement("option");
        o.value = String(shot.id);
        o.textContent = shot.name;
        list.appendChild(o);
      });
      if (!list.options.length) {
        const o = document.createElement("option");
        o.value = ""; o.textContent = "（还没有机位）";
        list.appendChild(o);
      } else if (keep && Array.from(list.options).some(o => o.value === keep)) {
        list.value = keep;
      }
      const has = !!list.value;
      ["remove", "render", "relocate"].forEach(a => { const b = btn(a); if (b) b.disabled = !has; });
      svFill();
      syncViewUI();
    }
    const curId = () => { const v = list && list.value; return v ? Number(v) : 0; };
    const curShot = () => (window.__director ? (window.__director.listShots() || []).find(s => s.id === curId()) : null);

    // #5 机位视角模式的 UI 状态：横幅、查看↔退出按钮、编辑门控
    function syncViewUI() {
      const d = window.__director;
      const viewId = d && d.getShotViewId ? d.getShotViewId() : 0;
      const inView = !!viewId;
      const active = inView && viewId === curId();
      banner.hidden = !inView;
      if (inView) {
        const vs = (d.listShots() || []).find(s => s.id === viewId);
        bannerName.textContent = vs ? vs.name : ("机位" + viewId);
      }
      if (bGo) {
        bGo.textContent = active ? "⏹ 退出视角" : "👁 查看";
        bGo.title = active ? "退出机位视角（保存调整并还原视口）" : "进入该机位视角";
        bGo.disabled = !has() && !active;
      }
      // 编辑门控：只有「正在查看的机位」可编辑
      [elSNear, elSFar, elSFoc].forEach(el => el.classList.toggle("sd-off", !active));
      // v42：画幅只需选中机位即可改（不强制先进视角；渲染按机位画幅出图）
      if (elAspect) { elAspect.disabled = !has(); elAspect.classList.toggle("sd-off", !has()); }
      [bReset, nudgeGrid, rotGrid].forEach(el => el.classList.toggle("sd-off", !active));
      if (stepIn) stepIn.disabled = !active;
      if (editHint) editHint.textContent = active
        ? "调整立即生效；「恢复默认」回到进入视角时的参数，退出时自动保存"
        : (inView ? "当前查看的是其他机位，选中它再编辑" : "进入视角后才能编辑该机位参数（画面即机位视角）");
    }
    const has = () => !!list.value;

    function svFill() {
      const d = window.__director;
      const rec = curShot();
      if (!d || !rec) {
        [elSNear, elSFar, elSFoc].forEach(el => { el.querySelector(".sd-dv-v").textContent = "–"; });
        ["pos", "tgt", "rot"].forEach(k => { q('[data-sv="' + k + '"]').textContent = "–"; });
        return;
      }
      q('[data-sv="pos"]').textContent = rec.pos.map(f2s).join(", ");
      q('[data-sv="tgt"]').textContent = rec.target.map(f2s).join(", ");
      const roll = rec.roll || 0;
      q('[data-sv="rot"]').textContent = f1s(shotYawOf(rec)) + "° / " + (shotPitchOf(rec) >= 0 ? "+" : "") + f1s(shotPitchOf(rec)) + "° / " + (roll >= 0 ? "+" : "") + f1s(roll) + "°";
      if (dvBusy([elSNear, elSFar, elSFoc])) return;
      const cr = d.getClipRange ? d.getClipRange() : null;
      const near = svPreview.near != null ? svPreview.near : (rec.clip ? rec.clip.near : (cr ? cr.near : 0.1));
      const far = svPreview.far != null ? svPreview.far : (rec.clip ? rec.clip.far : (cr ? cr.far : 1000));
      const foc = svPreview.foc != null ? svPreview.foc : rec.focal;
      elSNear.querySelector(".sd-dv-v").textContent = f2s(near);
      elSFar.querySelector(".sd-dv-v").textContent = f1s(far);
      elSFoc.querySelector(".sd-dv-v").textContent = Math.round(foc) + " mm";
      if (elAspect) elAspect.value = rec.aspect || "16:9";
    }

    if (list) list.onchange = () => { svFill(); syncViewUI(); showMsg("已选 " + (curShot() ? curShot().name : "")); };

    // v42：画幅切换（机位独立参数，可撤销）；视角模式内即时生效（引擎每帧刷新安全框与显示焦距）
    if (elAspect) elAspect.onchange = () => {
      const d = window.__director; const id = curId();
      if (!d || !id) return;
      const r = d.updateShot(id, { aspect: elAspect.value });
      if (r === "ok") showMsg("画幅已改为 " + elAspect.value + "（视角白框即照片范围，可撤销）");
    };

    // 视角模式内引擎每次变更都广播：面板开着就跟随刷新（所见即所得）
    document.addEventListener("director-state", (ev) => {
      if (ev.detail && ev.detail.what === "shot" && wrap.classList.contains("sd-open")) {
        svPreview.near = svPreview.far = svPreview.foc = null;
        fill();
      }
    });
    // #5 手势锁提醒：模式内尝试自由移动视口 → 文字提醒先退出
    document.addEventListener("director-shotview-blocked", () => {
      showMsg("机位视角模式中：先点「⏹ 退出视角」再操作视口");
    });

    const bAdd = btn("add");
    if (bAdd) bAdd.onclick = (e) => {
      e.stopPropagation();
      const d = window.__director;
      if (!d) { showMsg("导演台模块未就绪"); return; }
      const shot = d.addShot();
      if (shot === "in-view") { showMsg("机位视角模式中：先退出视角再新增"); return; }
      fill();
      if (shot && list) list.value = String(shot.id);
      showMsg("已记录机位：" + (shot ? shot.name : "") + "（含裁剪/焦距）");
    };

    const bDel = btn("remove");
    if (bDel) bDel.onclick = (e) => {
      e.stopPropagation();
      const d = window.__director; const id = curId();
      if (!d || !id) { showMsg("先选一个机位"); return; }
      const r = d.removeShot(id);
      fill();
      showMsg(r === "ok" ? "机位已移除" : "没有这个机位");
    };

    // v32：改名用内联输入行（Android WebView 的 prompt 不可控，v31 教训）
    const bRename = btn("rename");
    if (bRename) bRename.onclick = (e) => {
      e.stopPropagation();
      const d = window.__director; const id = curId();
      if (!d || !id) { showMsg("先选一个机位"); return; }
      const shot = curShot();
      if (editInput) editInput.value = shot ? shot.name : "";
      if (editRow) { editRow.hidden = false; if (editInput) editInput.focus(); }
    };
    const bRenameOk = btn("rename-ok");
    if (bRenameOk) bRenameOk.onclick = (e) => {
      e.stopPropagation();
      const d = window.__director; const id = curId();
      if (!d || !id) { showMsg("先选一个机位"); return; }
      const r = d.renameShot(id, editInput ? editInput.value : "");
      if (editRow) editRow.hidden = true;
      fill();
      if (list) list.value = String(id);
      showMsg(r === "ok" ? "已重命名" : (r === "no-name" ? "名字不能为空" : "没有这个机位"));
    };
    const bRenameNo = btn("rename-no");
    if (bRenameNo) bRenameNo.onclick = (e) => {
      e.stopPropagation();
      if (editRow) editRow.hidden = true;
    };

    const bRelocate = btn("relocate");
    if (bRelocate) bRelocate.onclick = (e) => {
      e.stopPropagation();
      const d = window.__director; const id = curId();
      if (!d || !id) { showMsg("先选一个机位"); return; }
      const r = d.relocateShot(id);
      if (r === "in-view") { showMsg("机位视角模式中：先退出视角再重定位"); return; }
      fill();
      if (list) list.value = String(id);
      showMsg(r === "ok" ? "已把该机位重定位到当前视角（含裁剪/焦距）" : "没有这个机位");
    };

    // #5：查看 = 进入机位视角；正在查看时 = 退出并保存
    if (bGo) bGo.onclick = (e) => {
      e.stopPropagation();
      const d = window.__director; const id = curId();
      if (!d) { showMsg("导演台模块未就绪"); return; }
      if (d.getShotViewId && d.getShotViewId()) {
        if (d.getShotViewId() !== id) { showMsg("先选中正在查看的机位"); return; }
        const r = d.exitShotView(true);
        fill();
        if (list) list.value = String(id);
        showMsg(r === "ok" ? "已退出机位视角（调整已保存，可撤销）" : "已退出机位视角");
        return;
      }
      if (!id) { showMsg("先选一个机位"); return; }
      const r = d.enterShotView(id);
      if (r === "ok") {
        fill();
        if (list) list.value = String(id);
        showMsg("已进入机位视角：调整即时生效，移动视口会被提醒");
      } else showMsg("没有这个机位");
    };

    const bRender = btn("render");
    if (bRender) bRender.onclick = async (e) => {
      e.stopPropagation();
      const d = window.__director; const id = curId();
      if (!d || !id) { showMsg("先选一个机位"); return; }
      showMsg("正在渲染照片…");
      const r = await d.renderShot(id);   // v42：尺寸按机位画幅（长边 1280）
      if (r && r.ok) {
        showShotPreview(r);
        showMsg("已渲染 " + r.name + "（" + r.width + "×" + r.height + "），可保存到相册 / 另存为 / 分享");
      } else {
        showMsg("渲染失败：" + ((r && (r.detail || r.reason)) || "未知"));
      }
    };

    if (bReset) bReset.onclick = (e) => {
      e.stopPropagation();
      const d = window.__director; const id = curId();
      if (!d || !id) { showMsg("先选一个机位"); return; }
      const r = d.resetShot ? d.resetShot(id) : "no-api";
      svPreview.near = svPreview.far = svPreview.foc = null;
      fill();
      if (list) list.value = String(id);
      if (r === "ok") showMsg("已恢复进入视角时的参数（可撤销）");
      else showMsg(r === "no-api" ? "引擎版本过旧，无恢复接口" : "没有这个机位");
    };

    // 本机位裁剪/焦距：拖动=本地预览，提交才 updateShot（可撤销；视角模式内画面即时跟随）
    const svCommitClip = (near, far) => {
      const d = window.__director; const id = curId();
      if (!d || !id || !d.updateShot) { showMsg("导演台模块未就绪"); return; }
      const n = Math.max(0.01, near);
      const f = Math.max(n * 2, far);
      d.updateShot(id, { clip: { near: n, far: f } });
      svPreview.near = svPreview.far = null;
      fill();
      if (list) list.value = String(id);
    };
    bindDragVal(elSNear, {
      get: () => {
        const rec = curShot();
        if (svPreview.near != null) return svPreview.near;
        const cr = window.__director && window.__director.getClipRange ? window.__director.getClipRange() : null;
        return rec ? (rec.clip ? rec.clip.near : (cr ? cr.near : 0.1)) : 0.1;
      },
      set: v => { svPreview.near = v; elSNear.querySelector(".sd-dv-v").textContent = f2s(v); },
      map: DV_CLIP_MAP, min: 0.01, max: 1e9, render: () => {},
      commit: v => {
        const rec = curShot();
        const farNow = (svPreview.far != null ? svPreview.far : (rec && rec.clip ? rec.clip.far : (window.__director && window.__director.getClipRange ? window.__director.getClipRange().far : 1000)));
        svCommitClip(v, Math.max(v * 2, farNow));
        showMsg((rec ? rec.name : "机位") + " 近 = " + v.toFixed(2) + "（可撤销）");
      }
    });
    bindDragVal(elSFar, {
      get: () => {
        const rec = curShot();
        if (svPreview.far != null) return svPreview.far;
        const cr = window.__director && window.__director.getClipRange ? window.__director.getClipRange() : null;
        return rec ? (rec.clip ? rec.clip.far : (cr ? cr.far : 1000)) : 1000;
      },
      set: v => { svPreview.far = v; elSFar.querySelector(".sd-dv-v").textContent = f1s(v); },
      map: DV_CLIP_MAP, min: 0.1, max: 1e9, render: () => {},
      commit: v => {
        const rec = curShot();
        const nearNow = (svPreview.near != null ? svPreview.near : (rec && rec.clip ? rec.clip.near : 0.05));
        svCommitClip(nearNow, v);
        showMsg((rec ? rec.name : "机位") + " 远 = " + Math.max(nearNow * 2, v).toFixed(1) + "（可撤销）");
      }
    });
    bindDragVal(elSFoc, {
      get: () => (svPreview.foc != null ? svPreview.foc : (curShot() ? curShot().focal : 50)),
      set: v => { svPreview.foc = v; elSFoc.querySelector(".sd-dv-v").textContent = Math.round(v) + " mm"; },
      map: DV_FOCAL_MAP, min: 1, max: 500, render: () => {},
      commit: v => {
        const d = window.__director; const id = curId();
        if (!d || !id || !d.updateShot) { showMsg("导演台模块未就绪"); return; }
        d.updateShot(id, { focal: v });
        svPreview.foc = null;
        fill();
        if (list) list.value = String(id);
        showMsg((curShot() ? curShot().name : "机位") + " 焦距 = " + Math.round(v) + " mm（可撤销）");
      }
    });

    // 步进移动：引擎 nudgeShot（机身+看向点一起动，朝向不变）
    wrap.querySelectorAll(".sd-nudge-btn").forEach(b => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const d = window.__director; const id = curId();
        if (!d || !id || !d.nudgeShot) { showMsg("导演台模块未就绪"); return; }
        const step = Math.max(0.001, parseFloat(stepIn.value) || 0.1);
        const r = d.nudgeShot(id, b.dataset.nudge, step);
        const name = curShot() ? curShot().name : "机位";
        const cn = { left: "左移", right: "右移", up: "上移", down: "下移", fwd: "前移", back: "后移" }[b.dataset.nudge];
        showMsg(r === "ok" ? name + " " + cn + " " + step + " 米（可撤销）" : "没有这个机位");
      });
    });

    // #7 三轴步进旋转：水平/俯仰/倾斜 ±（角度步进默认 3°可改）
    wrap.querySelectorAll(".sd-rot-btn").forEach(b => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const d = window.__director; const id = curId();
        if (!d || !id || !d.rotateShotAxis) { showMsg("导演台模块未就绪"); return; }
        const astep = Math.max(0.5, parseFloat(q('[data-shot="astep"]').value) || 3);
        const axis = b.dataset.rot.slice(0, -1);
        const sign = b.dataset.rot.slice(-1) === "+" ? 1 : -1;
        const r = d.rotateShotAxis(id, axis, sign * astep);
        const name = curShot() ? curShot().name : "机位";
        const cn = { yaw: "水平", pitch: "俯仰", roll: "倾斜" }[axis];
        showMsg(r === "ok" ? name + " " + cn + "角 " + (sign > 0 ? "+" : "−") + astep + "°（可撤销）" : "没有这个机位");
      });
    });

    wrap.__sdRefresh = () => { fill(); };
    fill();
    return null;   // 机位组没有要收养的 SS 按钮
  }


  /* v14 统一导入入口：一个按钮，按后缀自动分流
   *   .glb/.gltf            → PlayCanvas container 资产（导演台道具，落在 3D 游标）
   *   .ply/.splat/.sog/.ksplat/.spz/.ssproj/.json/.webp/.txt → SS 原生泼溅导入管线
   * 引擎没有 OBJ 解析器，所以 .obj 不在列表里。
   */
  const SPLAT_EXT = ['.ply', '.splat', '.sog', '.ksplat', '.spz', '.ssproj', '.json', '.webp', '.txt'];
  let assetInput = null;
  function pickAssets() {
    if (!assetInput) {
      assetInput = document.createElement('input');
      assetInput.type = 'file';
      assetInput.multiple = true;
    // 不设置 accept：Android 会把它翻译成 MIME 白名单，.glb/.ply 没有对应 MIME，
    // 混进 .json/.webp/.txt 后会让 glb/ply 在系统选择器里不可选。类型判断放 JS 里做。
      assetInput.style.display = 'none';
      assetInput.addEventListener('change', () => {
        const files = Array.from(assetInput.files || []);
        assetInput.value = '';
        if (!files.length) return;
        files.forEach((f) => {
          const name = (f.name || '').toLowerCase();
          const isModel = name.endsWith('.glb') || name.endsWith('.gltf');
          if (isModel) {
            const d = window.__director;
            if (!d || !d.importModel) { showMsg('导演台模块未就绪'); return; }
            showMsg('正在导入模型 ' + f.name + '…');
            d.importModel(f);
          } else if (SPLAT_EXT.some(ext => name.endsWith(ext))) {
            const sc = window.scene;
            if (!sc || !sc.events) { showMsg('编辑器未就绪'); return; }
            showMsg('正在导入泼溅 ' + f.name + '…');
            sc.events.invoke('import', [{ filename: f.name, contents: f }]);
          } else {
            showMsg('不支持的文件：' + f.name);
          }
        });
      });
      document.body.appendChild(assetInput);
    }
    assetInput.click();
  }

  /* v25：定位组——重设变换基准点
   *   中心：基准点移到模型包围盒中心
   *   游标：基准点移到 3D 游标所在位置
   * 基准点变化后，旋转/缩放都绕新点进行；只动基准点，不动模型。
   */
  function buildAnchorButtons(container) {
    const mk = (ico, title, act, okMsg) => {
      const b = makeShell('<span class="sd-ico">' + ico + '</span>', 'sd-anchor-btn');
      b.title = title;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const d = window.__director;
        if (!d || !d[act]) { showMsg('导演台模块未就绪'); return; }
        const r = d[act]();
        showMsg(
          r === 'ok' ? okMsg :
          r === 'same' ? '基准点已经在那里了' :
          r === 'no-selection' ? '先选中一个人偶或模型' :
          r === 'no-cursor' ? '先点「游标」在场景里定个位置' : '已取消');
      });
      container.appendChild(b);
      return b;
    };
    mk('⊙', '基准点定位到密度中心', 'anchorPivotToCenter', '基准点已移到模型密度中心（可撤销）');
    mk('⌖', '基准点定位到游标点', 'anchorPivotToCursor', '基准点已移到 3D 游标（可撤销）');
    // v26：第三个按钮，把基准点放回模型自己的原点。前两个把基准点挪到别处，
    // 这个负责挪回来，三个一组才对得起“定位”这个名字。
    mk('↺', '重设基准点（回到模型原点）', 'resetPivot', '基准点已重置到模型原点（可撤销）');
  }

  function buildDock(def) {
    const dock = makeShell('', 'sd-dock sd-' + def.pos);
    dock.dataset.dock = def.id;
    document.body.appendChild(dock);

    const handle = makeShell('≡', 'sd-handle');
    const label = makeShell(def.label, 'sd-label');
    const collapse = makeShell('▪', 'sd-collapse');

    if (def.menuOptions) {
      // v11：撤销/重做先挂（左起撤销、重做、渲染）
      (def.extra || []).forEach(t => { const el = makeExtraBtn(t, dock); if (el) dock.appendChild(el); });
      adoptProjectButtons(dock);   // v34：保存/返回收进顶部菜单停靠栏
      // v3：把 SS 五个一级菜单的 .menu-panel 整体搬进各自子面板容器
      // 菜单行点击绑定在行上（stopPropagation），整体搬后功能保留；
      // 行点击后 SS 会隐藏面板，用 MutationObserver 同步关闭我们的 wrap
      const menuRoot = document.getElementById('menu');
      const panels = {};
      let pi = 0;
      document.querySelectorAll('#menu > .menu-panel').forEach(p => { panels[MENU_ORDER[pi++]] = p; });
      TOP_MENUS.forEach(m => {
        const btn = makeShell(`<span class="sd-ico">${m.ico}</span><span class="sd-name">${m.name}</span><span class="sd-dot"></span>`, 'sd-grp-btn sd-menu-grp');
        btn.dataset.grp = 'menu-' + m.key;
        const wrap = makeShell('', 'sd-sub-wrap sd-menu-panel');
        wrap.dataset.menukey = 'menu-' + m.key;
        const p = panels[m.key];
        if (p) {
          wrap.appendChild(p);
          new MutationObserver(() => {
            if (p.classList.contains('pcui-hidden') && st && st.openPanels.has('menu-' + m.key)) {
              st.openPanels.delete('menu-' + m.key);
              wrap.classList.remove('sd-open');
              btn.classList.remove('sd-active');
            }
          }).observe(p, { attributes:true, attributeFilter:['class'] });
        }
        (menuRoot || document.body).appendChild(wrap);
        allPanels.set('menu-' + m.key, wrap);
        btn.onclick = () => toggleNamed('menu-' + m.key, btn, dock);
        dock.appendChild(btn);
      });
      // v11：场景按钮移入导演台子面板（data-role="scene-toggle"），顶栏不再放
    } else if (def.viewOptions) {
      // 右侧：三个一级分组——相机（机位管理）、设置（外观/浮层/设置）、定位（框选/回原点）
      [
        // v38：视口组（全局相机参数，收养四个模式按钮）→ 机位组（每机位独立裁剪/焦距）→ 设置 → 定位
        ["视口", ["right-toolbar-orbit-mode", "right-toolbar-fly-mode", "right-toolbar-frame-selection", "right-toolbar-camera-origin"]],
        ["机位", []],
        ["设置", ["right-toolbar-appearance", "right-toolbar-overlays", "right-toolbar-settings"]],
        ["定位", []]
      ].forEach(function(pair){
        var name = pair[0], ids = pair[1];
        var ico = name === "视口" ? "👁" : (name === "机位" ? "🎥" : (name === "设置" ? "⚙️" : "🎯"));
        var g = makeShell('<span class="sd-ico">' + ico + '</span><span class="sd-name">' + name + '</span><span class="sd-dot"></span>', "sd-grp-btn");
        var wrap = makeShell("", "sd-sub-wrap");
        var modes = null;
        if (name === "视口") modes = buildViewportPanel(wrap);   // v38 全局相机面板（模式按钮收养位在面板顶部）
        else if (name === "机位") buildShotPanel(wrap);          // v38 机位面板（无收养位）
        // 视口组把四个模式按钮收养进面板顶部那行；其余组照旧平铺
        ids.forEach(function(id){ adopt(id, modes || wrap); });
        // v25：定位组追加三个「重设基准点」按钮；v33：测量按钮也收进定位组
        if (name === "定位") { adopt('bottom-toolbar-measure', wrap); buildAnchorButtons(wrap); }
        document.body.appendChild(wrap);
        allPanels.set(name, wrap);
        g.onclick = function(){ toggleNamed(name, g, dock); };
        dock.appendChild(g);
      });
      } else if (def.dirBar) {
      // v12 底栏五连：选择/游标/摆放人偶/变换/导演台（删除已移入导演台面板）
      const gx = GROUPS['xform'];
      const xwrap = makeShell('', 'sd-sub-wrap');
      xwrap.dataset.grp = 'xform';
      gx.ids.forEach(id => adopt(id, xwrap));
      document.body.appendChild(xwrap);
      allPanels.set('xform', xwrap);
      const dwrap2 = makeShell(DIR_PANEL_HTML, 'sd-sub-wrap sd-dir-panel');
      document.body.appendChild(dwrap2);
      allPanels.set(DIR_NAME, dwrap2);
      bindDirectorPanel(dwrap2);
      [
        // v33：游标+移动合并为一组；v34 组名「游标相关」→「游标」（三钮不变）
        { act:'cursorgrp', ico:'🎯', name:'游标' },
        { act:'xform',    ico:'🔢', name:'变换' },
        { act:'director', ico:'🎬', name:DIR_NAME }
      ].forEach(b => {
        const btn = makeShell(`<span class="sd-ico">${b.ico}</span><span class="sd-name">${b.name}</span><span class="sd-dot"></span>`, 'sd-grp-btn sd-dir-act');
        btn.dataset.act = b.act;
        // 注意：dataset 赋值不能作为 if/else 链的首项，否则会吃掉后续所有分支
        if (b.act === 'xform') {
          btn.dataset.grp = 'xform';
          btn.onclick = () => toggleGroup('xform', dock);
        }

        else if (b.act === 'cursorgrp') {
          // v33：游标相关组——三钮带图标+文字（老板指定），替换原「游标」直按+「移动」纯图标组
          const cwrap = makeShell(
            '<button class="sd-dir-btn sd-cur-btn" data-cact="cursor" title="点击画布放置/取消 3D 游标"><span class="sd-ico">🎯</span><span class="sd-txt">设置游标</span></button>' +
            '<button class="sd-dir-btn sd-cur-btn" data-cact="move" title="把选中对象移到 3D 游标"><span class="sd-ico">🧲</span><span class="sd-txt">移动模型</span></button>' +
            '<button class="sd-dir-btn sd-cur-btn" data-cact="copy" title="复制选中对象到 3D 游标"><span class="sd-ico">📋</span><span class="sd-txt">复制模型</span></button>',
            'sd-sub-wrap sd-dir-panel sd-cur-panel');
          cwrap.dataset.grp = 'cursorgrp';
          document.body.appendChild(cwrap);
          allPanels.set('游标', cwrap);
          cwrap.addEventListener('click', (e) => {
            const cb = e.target.closest('[data-cact]');
            if (!cb) return;
            e.stopPropagation();
            const dd = window.__director;
            if (!dd) { showMsg('导演台模块未就绪'); return; }
            if (cb.dataset.cact === 'cursor') {
              const r = dd.armPlaceCursor();
              showMsg(r === 'place-cursor' ? '点击画布放置 3D 游标（再点取消）' : '已取消放置');
            } else if (cb.dataset.cact === 'move') {
              const r = dd.moveSelectedToCursor();
              showMsg(r === 'ok' ? '已移到 3D 游标（可撤销）' :
                      r === 'no-selection' ? '先选中一个对象' :
                      r === 'no-cursor' ? '先点「设置游标」定个位置' : '已取消');
            } else {
              const r = dd.copySelectedToCursor ? dd.copySelectedToCursor() : 'no-api';
              showMsg(r === 'ok' ? '副本已生成在游标处（可撤销）' :
                      r === 'no-selection' ? '先选中一个对象' :
                      r === 'no-cursor' ? '先点「设置游标」定个位置' :
                      r === 'no-api' ? '引擎版本过旧，无复制接口' : '已取消');
            }
            closeAll(docks.find(s => s.dock === dock) || { openPanels: new Set() });
          });
          btn.onclick = () => toggleNamed('游标', btn, dock);
        }
        else btn.onclick = () => toggleNamed(DIR_NAME, btn, dock);
        dock.appendChild(btn);
      });
    } else {
      def.groupIds.forEach(gid => dock.appendChild(makeGroupBtn(gid, dock)));
    }
    (def.extra || []).forEach(t => { const el = makeExtraBtn(t, dock); if (el && el.parentElement !== dock) dock.appendChild(el); });
    dock.appendChild(label);
    dock.appendChild(collapse);
    dock.insertBefore(handle, dock.firstChild);

    const st = { def, dock, handle, pos: def.pos, freePos: null, openPanels: new Set(), collapsed: false };

    // 点 dock 外区域时关闭已开的菜单 wrap（SS 行点击自关由 observer 同步）
    addEventListener('pointerdown', (e) => {
      if (!st.openPanels.size) return;
      if (st.dock.contains(e.target)) return;
      let inWrap = false;
      st.openPanels.forEach(k => { const w = allPanels.get(k); if (w && w.contains(e.target)) inWrap = true; });
      if (inWrap) return;
      closeAll(st);
    }, true);

    function setCollapsed(v) {
      st.collapsed = v;
      dock.classList.toggle('sd-collapsed', v);
      handle.innerHTML = v ? def.label : '≡';
      if (v) closeAll(st); else applyDockPos(st);
    }
    collapse.onclick = (e) => { e.stopPropagation(); setCollapsed(!st.collapsed); };
    handle.addEventListener('click', (e) => {
      if (!st.collapsed) return;
      e.stopPropagation(); setCollapsed(false);
    });

    setupDrag(st);
    docks.push(st);
    applyDockPos(st);
  }

  /* ===================== 子面板开关与定位 =====================
   * 流程：清残留内联 → 按停靠方向设 sd-side/sd-up → 隐藏量真实 rect → 计算钳屏位置 → 双 rAF 校准
   * 多面板同开用 slot 错层（slot*(宽/高+8)）防重叠
   */

  function toggleNamed(name, g, dock) {
    const st = docks.find(s => s.dock === dock);
    const wrap = allPanels.get(name);
    if (!st || !wrap) return;
    if (st.openPanels.has(name)) {
      st.openPanels.delete(name); wrap.classList.remove('sd-open'); g.classList.remove('sd-active');
    } else {
      st.openPanels.add(name); g.classList.add('sd-active');
      const mp = wrap.querySelector('.menu-panel');
      if (mp) mp.classList.remove('pcui-hidden');
      // v12b：导演台面板每次展开都重新灌一次下拉（角色/动作）
      if (wrap.__sdRefresh) wrap.__sdRefresh(true);
      placeNamed(name, g, st);
      wrap.classList.add('sd-open');
      requestAnimationFrame(() => requestAnimationFrame(() => { if (st.openPanels.has(name)) placeNamed(name, g, st); }));
    }
  }

  function placeNamed(name, g, st) {
    const wrap = allPanels.get(name);
    wrap.style.left = ''; wrap.style.top = '';
    const vertical = (st.pos==='left' || st.pos==='right');
    wrap.classList.toggle('sd-side', vertical);
    wrap.classList.toggle('sd-up', !vertical);
    wrap.style.visibility = 'hidden'; wrap.classList.add('sd-open');
    const b = g.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    wrap.style.visibility = '';
    const slot = Array.from(st.openPanels).indexOf(name);
    if (!vertical) {
      const stagger = slot * (w.height + 8);
      let left = Math.max(8, Math.min(b.left + b.width/2 - w.width/2, innerWidth - w.width - 8));
      let top = st.pos==='bottom' ? b.top - w.height - 10 - stagger : b.bottom + 10 + stagger;
      top = Math.max(8, Math.min(top, innerHeight - w.height - 8));
      wrap.style.left = left + 'px'; wrap.style.top = top + 'px';
    } else {
      const stagger = slot * (w.width + 8);
      let top = Math.max(8, Math.min(b.top + b.height/2 - w.height/2, innerHeight - w.height - 8));
      let left = st.pos==='left' ? b.right + 10 + stagger : b.left - w.width - 10 - stagger;
      left = Math.max(8, Math.min(left, innerWidth - w.width - 8));
      wrap.style.left = left + 'px'; wrap.style.top = top + 'px';
    }
  }

  function toggleGroup(gid, dock) {
    const st = docks.find(s => s.def.groupIds.includes(gid));
    const wrap = allPanels.get(gid);
    const btn = dock.querySelector(`[data-grp="${gid}"]`);
    if (!st || !wrap) return;
    if (st.openPanels.has(gid)) {
      st.openPanels.delete(gid); wrap.classList.remove('sd-open'); btn.classList.remove('sd-active');
    } else {
      st.openPanels.add(gid); btn.classList.add('sd-active');
      placeWrap(gid, st);
      wrap.classList.add('sd-open');
      requestAnimationFrame(() => requestAnimationFrame(() => { if (st.openPanels.has(gid)) placeWrap(gid, st); }));
    }
  }

  function closeAll(st) {
    st.openPanels.forEach(gid => {
      allPanels.get(gid).classList.remove('sd-open');
      const b = st.dock.querySelector(`[data-grp="${gid}"]`);
      if (b) b.classList.remove('sd-active');
    });
    st.openPanels.clear();
  }

  // v39 #1: system status-bar height for clamp floors. env() only resolves at
  // used-value time, so measure a probe element instead of reading the var
  // (custom properties return the raw token, parseFloat gives NaN).
  let safeProbe = null;
  function safeTopPx() {
    if (!safeProbe) {
      safeProbe = document.createElement('div');
      safeProbe.style.cssText = 'position:fixed;top:env(safe-area-inset-top,0px);left:0;width:0;height:0;visibility:hidden;pointer-events:none;';
      document.body.appendChild(safeProbe);
    }
    const v = parseFloat(getComputedStyle(safeProbe).top);
    return isFinite(v) && v > 0 ? v : 0;
  }

  function applyDockPos(st) {
    const { dock } = st;
    dock.className = 'sd-dock sd-' + st.pos + (st.collapsed ? ' sd-collapsed' : '');
    dock.style.left=''; dock.style.top=''; dock.style.right=''; dock.style.bottom=''; dock.style.transform='';
    if (!st.freePos) return;
    const r = dock.getBoundingClientRect();
    if (st.pos==='bottom' || st.pos==='top') {
      dock.style.transform = 'none';
      dock.style.left = st.freePos.left + 'px';
    } else {
      dock.style.transform = 'none';
      // v28b: 行内 top 会盖过 dock.css 的避让规则，所以这里也要夹一次：
      // 拖动后的左右停靠区同样不能顶到工程页的保存/返回条。
      const barBottom = parseFloat(getComputedStyle(document.body).getPropertyValue('--sd-bar-bottom')) || 0;
      const minTop = Math.max(barBottom ? barBottom + 6 : 8, safeTopPx());   // v39 #1 避让系统栏
      dock.style.top = Math.max(minTop, st.freePos.top) + 'px';
    }
  }

  function placeWrap(gid, st) {
    const btn = st.dock.querySelector(`[data-grp="${gid}"]`);
    const wrap = allPanels.get(gid);
    wrap.style.left = ''; wrap.style.top = '';
    const vertical = (st.pos==='left' || st.pos==='right');
    wrap.classList.toggle('sd-side', vertical);
    wrap.classList.toggle('sd-up', !vertical);
    wrap.style.visibility = 'hidden'; wrap.classList.add('sd-open');
    const b = btn.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    wrap.style.visibility = '';
    const slot = Array.from(st.openPanels).indexOf(gid);
    if (!vertical) {
      const stagger = slot * (w.height + 8);
      let left = Math.max(8, Math.min(b.left + b.width/2 - w.width/2, innerWidth - w.width - 8));
      let top = st.pos==='bottom' ? b.top - w.height - 10 - stagger : b.bottom + 10 + stagger;
      top = Math.max(8, Math.min(top, innerHeight - w.height - 8));
      wrap.style.left = left + 'px'; wrap.style.top = top + 'px';
    } else {
      const stagger = slot * (w.width + 8);
      let top = Math.max(8, Math.min(b.top + b.height/2 - w.height/2, innerHeight - w.height - 8));
      let left = st.pos==='left' ? b.right + 10 + stagger : b.left - w.width - 10 - stagger;
      left = Math.max(8, Math.min(left, innerWidth - w.width - 8));
      wrap.style.left = left + 'px'; wrap.style.top = top + 'px';
    }
  }

  function nearestEdge(x, y) {
    const dist = { top: y*0.8, bottom: (innerHeight - y)*0.8, left: x, right: innerWidth - x };
    return Object.keys(dist).sort((a,b)=>dist[a]-dist[b])[0];
  }

  /* ===================== 拖动吸附 =====================
   * pointerdown 只记状态不清对边定位（防未拖动永久丢失锚定）；
   * move 用增量判阈值（CDP 合成事件 movementX 恒 0）；上下边距离加权 0.8 更易命中横排
   */
  function setupDrag(st) {
    const { dock, handle } = st;
    let drag = null;
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
      drag = { moved:false, free:null, pid:e.pointerId, lastX:e.clientX, lastY:e.clientY };
      dock.classList.add('sd-dragging');
      document.body.classList.add('sd-drag-any');
    });
    addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.pid) return;
      const mdx = e.clientX - drag.lastX, mdy = e.clientY - drag.lastY;
      drag.lastX = e.clientX; drag.lastY = e.clientY;
      if (!drag.moved && Math.abs(mdx) < 4 && Math.abs(mdy) < 4) return;
      drag.moved = true;
      e.preventDefault();
      if (st.collapsed) return;
      const edge = nearestEdge(e.clientX, e.clientY);
      if (edge !== st.pos) { st.pos = edge; dock.className = 'sd-dock sd-' + edge; dock.offsetHeight; }
      dock.style.right = 'auto'; dock.style.bottom = 'auto';
      const r = dock.getBoundingClientRect();
      const nl = Math.max(6, Math.min(e.clientX - r.width/2,  innerWidth  - r.width  - 6));
      const nt = Math.max(Math.max(6, safeTopPx()), Math.min(e.clientY - r.height/2, innerHeight - r.height - 6));   // v39 #1
      dock.style.transform = 'none';
      dock.style.left = nl + 'px';
      dock.style.top  = nt + 'px';
      drag.free = { left: nl, top: nt };
    }, {passive:false});
    function endDrag(e) {
      if (!drag) return;
      if (e && e.pointerId !== undefined && e.pointerId !== drag.pid) return;
      const moved = drag.moved, free = drag.free;
      dock.classList.remove('sd-dragging');
      document.body.classList.remove('sd-drag-any');
      drag = null;
      if (!moved || !free) return;
      const r = dock.getBoundingClientRect();
      const m = 8;
      if (st.pos==='bottom' || st.pos==='top') st.freePos = { left: Math.max(m, Math.min(free.left, innerWidth - r.width - m)) };
      else st.freePos = { top: Math.max(Math.max(m, safeTopPx()), Math.min(free.top, innerHeight - r.height - m)) };   // v39 #1
      closeAll(st);
      applyDockPos(st);
      dock.offsetHeight;
      showMsg(st.def.label + '组已吸附: ' + ({top:'顶部',bottom:'底部',left:'左侧',right:'右侧'})[st.pos]);
    }
    addEventListener('pointerup', endDrag);
    addEventListener('pointercancel', endDrag);
    addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, {passive:false});
  }

  // v6：弹窗统一改成全屏列表风：左上角返回按钮（替代右上角 ✕）。
  // PCUI 弹窗关闭就是自身 hidden；返回钮用绝对定位盖在 header 左侧
  function addCloseBtn(host, onClick) {
    if (!host || host.querySelector(':scope > .sd-close-btn')) return;
    const b = makeShell('‹ 返回', 'sd-back-btn sd-close-btn');
    b.style.cssText = 'position:absolute;left:0.4rem;top:0.45rem;z-index:20;';
    b.addEventListener('pointerdown', e => e.stopPropagation());
    b.onclick = (e) => { e.stopPropagation(); onClick(); };
    host.appendChild(b);
  }

  /* ===================== 全屏层接管（弹窗/场景/外观/浮层/设置） =====================
   * 弹窗（#dialog 系列）：v6 全屏列表风，返回钮绝对定位盖 header；SS 重开时自会清 hidden
   * 三面板（场景/外观/浮层/设置）：注入 sd-sheet-header + MutationObserver 钳位（见文件头红线 2/3）
   */
  function watchDialogs() {
    const decorate = () => {
      document.querySelectorAll('#dialog, [id$="-dialog"]').forEach(d => {
        if (d.id === 'scene-panel') return;
        addCloseBtn(d, () => { d.classList.add('pcui-hidden'); d.style.display = 'none'; });
        // 重开时恢复可见（SS 自己会移除 hidden/display）
        new MutationObserver(() => {
          if (!d.classList.contains('pcui-hidden') && d.style.display === 'none') d.style.display = '';
        }).observe(d, { attributes:true, attributeFilter:['class','style'] });
      });
      // v6.3：外观/浮层面板——SS 原生打开时会内联写 top 锚定定位，把全屏面板顶出屏幕（真机 top:-376）；
      // 可见时强制钳位回原点，并注入与场景页同款头部（返回钮+标题）
      [['appearance-panel','外观','right-toolbar-appearance','appearancePanel'], ['overlays-panel','浮层','right-toolbar-overlays','overlaysPanel'], ['settings-panel','设置','right-toolbar-settings','settingsPanel']].forEach(function(def){
        var p = document.getElementById(def[0]);
        if (!p || p.querySelector(':scope > .sd-sheet-header')) return;
      // v32：设置面板注入悬浮窗透明度滑条（默认 0.6，存 localStorage）
      if (def[0] === 'settings-panel') (function injectAlpha(){
        if (p.querySelector('#sd-alpha-row')) return;
        const cur = (parseFloat(document.documentElement.style.getPropertyValue('--sd-alpha')) || SD_ALPHA_DEFAULT) * 100;
        const row = makeShell(
          '<span class="sd-alpha-lab">悬浮窗透明度</span>' +
          '<input id="sd-alpha-slider" type="range" min="20" max="100" step="5">' +
          '<span class="sd-alpha-val"></span>', 'sd-alpha-row');
        row.id = 'sd-alpha-row';
        const slider = row.querySelector('#sd-alpha-slider');
        const val = row.querySelector('.sd-alpha-val');
        slider.value = String(Math.round(cur));
        val.textContent = Math.round(cur) + '%';
        slider.addEventListener('pointerdown', function(e){ e.stopPropagation(); });
        slider.addEventListener('input', function(){
          const a = applySdAlpha((+slider.value) / 100);
          val.textContent = Math.round(a * 100) + '%';
        });
        const first = p.querySelector(':scope > .pcui-element');
        p.insertBefore(row, first || null);
      })();
        var hd = makeShell('<span class="sd-back-btn">‹ 返回</span><span class="sd-sheet-title">' + def[1] + '</span>', 'sd-sheet-header');
        p.insertBefore(hd, p.firstChild);
        hd.querySelector('.sd-back-btn').addEventListener('pointerdown', function(e){ e.stopPropagation(); });
        // v19：必须走 SS 事件，不能直接改 DOM。直接改 DOM 会让 SS 内部的
        // this.hidden 停在 false，下次点工具栏按钮时 toggleVisible 只是把
        // 内部状态改成隐藏，界面毫无反应，看起来就是「只能打开一次」。
        hd.querySelector('.sd-back-btn').onclick = function(e){
          e.stopPropagation();
          var sc = window.scene;
          var handled = false;
          if (sc && sc.events && def[3]) {
            try { sc.events.fire(def[3] + '.setVisible', false); handled = true; } catch (err) {}
          }
          if (!handled) {
            p.classList.add('pcui-hidden');
            p.style.display = 'none';
          }
          var tb = document.getElementById(def[2]);
          if (tb && tb.classList) tb.classList.remove('active');
        };
        new MutationObserver(function(){
          if (p.classList.contains('pcui-hidden')) return;
          // 清掉我们自己关面板时留下的内联 display:none。不清的话 computed
          // 永远是 none，下面的钳位永不执行，面板也就再也打不开了。
          if (p.style.display === 'none') p.style.display = '';
          // SS 内联锚定定位钳位：可见时强制全屏原点
          p.style.position = 'fixed'; p.style.left = '0'; p.style.top = '0';
          p.style.right = 'auto'; p.style.bottom = 'auto'; p.style.transform = 'none';
          p.style.width = '100%'; p.style.height = '100%'; p.style.zIndex = '1300';
        }).observe(p, { attributes:true, attributeFilter:['class','style'] });
      });
      const sp = document.getElementById('scene-panel');      if (sp && !sp.querySelector(':scope > .sd-sheet-header')) {
        // v6：全屏风头部——左上角返回 + 标题；原三按钮保留在下方 panel-header 行
        const hd = makeShell('<span class="sd-back-btn">‹ 返回</span><span class="sd-sheet-title">资产列表</span>', 'sd-sheet-header');
        sp.insertBefore(hd, sp.firstChild);
        hd.querySelector('.sd-back-btn').addEventListener('pointerdown', e => e.stopPropagation());
        hd.querySelector('.sd-back-btn').onclick = (e) => {
          e.stopPropagation();
          document.body.classList.remove('sd-scene-open');
          const sb = document.querySelector('[data-role="scene-toggle"]');
          if (sb) sb.classList.remove('sd-active');
        };
        // v10：人偶列表（分镜工具统一对象页）：人偶与泼溅同页管理
        const slc = sp.querySelector('.splat-list-container');
        if (slc && !sp.querySelector('#sd-puppet-list')) {
          const pup = makeShell('', 'sd-puppet-list');
          pup.id = 'sd-puppet-list';
          slc.parentNode.insertBefore(pup, slc);
        }
      }
    };
    decorate();
    new MutationObserver(decorate).observe(document.body, { childList:true, subtree:true });
  }

  // v3：原菜单条隐藏；#menu 搬到 body 下（修复祖先链叠层导致面板被画布压住不可见），
  // checkEvent 用 DOM contains 判断，搬移不影响语义；顶部 dock 挂进 #menu，点按钮不会触发全局隐藏
  function hideMenuBar(menuDock) {
    const bar = document.getElementById('menu-bar');
    if (bar) bar.style.display = 'none';
    const menu = document.getElementById('menu');
    if (menu) {
      menu.classList.add('sd-menu-root');
      document.body.appendChild(menu);
      if (menuDock) menu.appendChild(menuDock);
    }
  }

  let msgTimer, msgEl;
  function showMsg(t) {
    if (!msgEl) { msgEl = document.createElement('div'); msgEl.id='sd-msg'; document.body.appendChild(msgEl); }
    msgEl.textContent = t; msgEl.style.opacity = 1;
    clearTimeout(msgTimer); msgTimer = setTimeout(()=>msgEl.style.opacity=0, 900);
  }

  // v11：场景浮层开关（原顶栏场景按钮逻辑，现由导演台面板的场景按钮调用）
  function toggleSceneSheet() {
    const open = document.body.classList.toggle('sd-scene-open');
    const sb = document.querySelector('[data-role="scene-toggle"]');
    if (sb) sb.classList.toggle('sd-active', open);
    const spPanel = document.getElementById('scene-panel');
    if (spPanel) {
      if (open) {
        spPanel.style.cssText += ';position:fixed!important;left:0!important;top:0!important;width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;inset:0!important;z-index:1300!important;';;
      } else {
        spPanel.style.cssText = spPanel.style.cssText.replace(/;?position:fixed!important;left:0!important[\s\S]*?z-index:1300!important;/g, ';');
      }
    }
    if (open && window.__renderPuppetList) window.__renderPuppetList();
  }

  // v31：打开场景页时隐藏 SS 原生泼溅列表（老板真机反馈：样式不一致、
  // 删除走它的 showPopup 确认框）。我们注入的统一泼溅行已接管展示与删除。
  // 只在面板打开期间隐藏，返回时恢复，不动 SS 源码。
  const styleNativeSplatList = document.createElement('style');
  styleNativeSplatList.textContent =
    'body.sd-scene-open .splat-list-container { display:none !important; }';
  document.head.appendChild(styleNativeSplatList);

  /* ===================== v10 场景页人偶列表 =====================
   * 人偶行：点行选中（进 SS 变换/撤销管线）、眼睛切显隐、锁切禁止选中、垃圾桶删（走 undo）。
   * 数据源 window.__director.listPuppets()；director-state 事件驱动重绘。
   */
  function renderPuppetList() {
    const host = document.getElementById('sd-puppet-list');
    if (!host) return;
    const d = window.__director;
    const list = (d && d.listPuppets) ? d.listPuppets() : [];
    const props = (d && d.listProps) ? d.listProps() : [];
    const splats = (d && d.listSplats) ? d.listSplats() : [];
    host.innerHTML = '';
    if (!list.length && !props.length && !splats.length) return;
    if (list.length) {
      const title = makeShell('<span class="sd-pup-title">人偶</span>', 'sd-pup-head');
      host.appendChild(title);
    }
    list.forEach((p) => {
      const row = makeShell(
        '<span class="sd-pup-name">🧍 ' + p.name + (p.clipLabel ? ' · ' + p.clipLabel : '') + (p.playing ? ' ▶' : '') + '</span>' +
        '<span class="sd-pup-eye" title="显示/隐藏">' + (p.visible ? '👁' : '🚫') + '</span>' +
        '<span class="sd-pup-lock" title="禁止选中">' + (p.locked ? '🔒' : '🔓') + '</span>' +
        '<span class="sd-pup-del" title="删除">🗑</span>',
        'sd-pup-row' + (p.selected ? ' sd-pup-sel' : '') + (p.locked ? ' sd-pup-locked' : ''));
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        const dd = window.__director;
        if (!dd) return;
        if (e.target.classList.contains('sd-pup-eye')) {
          dd.setPuppetVisible(p.id, !p.visible);
        } else if (e.target.classList.contains('sd-pup-lock')) {
          dd.setPuppetLocked(p.id, !p.locked);
        } else if (e.target.classList.contains('sd-pup-del')) {
          dd.deletePuppetById(p.id);
        } else if (p.locked) {
          showMsg('该对象已禁止选中，先解锁');
        } else {
          dd.selectPuppetById(p.id);
        }
        renderPuppetList();
      });
      host.appendChild(row);
    });

    // v13 道具行：与泼溅/人偶同一套点选 + 撤销删除
    if (props.length) {
      const h2 = makeShell('<span class="sd-pup-title">道具</span>', 'sd-pup-head');
      host.appendChild(h2);
      props.forEach((pr) => {
        const row = makeShell(
          '<span class="sd-pup-name">📦 ' + pr.name + '</span>' +
          '<span class="sd-pup-lock" title="禁止选中">' + (pr.locked ? '🔒' : '🔓') + '</span>' +
          '<span class="sd-pup-del" title="删除">🗑</span>',
          'sd-pup-row' + (pr.selected ? ' sd-pup-sel' : '') + (pr.locked ? ' sd-pup-locked' : ''));
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          const dd = window.__director;
          if (!dd) return;
          if (e.target.classList.contains('sd-pup-lock')) dd.setPropLocked(pr.id, !pr.locked);
          else if (e.target.classList.contains('sd-pup-del')) dd.deletePropById(pr.id);
          else if (pr.locked) showMsg('该对象已禁止选中，先解锁');
          else dd.selectPropById(pr.id);
          renderPuppetList();
        });
        host.appendChild(row);
      });
    }

    // v30 #4：泼溅行——与道具/人偶同一套样式；删除直接删（不再弹确认框）
    if (splats.length) {
      const h3 = makeShell('<span class="sd-pup-title">泼溅</span>', 'sd-pup-head');
      host.appendChild(h3);
      splats.forEach((sp) => {
        const row = makeShell(
          '<span class="sd-pup-name">🌫 ' + sp.name + '</span>' +
          '<span class="sd-pup-eye" title="显示/隐藏">' + (sp.visible ? '👁' : '🚫') + '</span>' +
          '<span class="sd-pup-del" title="删除">🗑</span>',
          'sd-pup-row' + (sp.selected ? ' sd-pup-sel' : ''));
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          const dd = window.__director;
          if (!dd) return;
          if (e.target.classList.contains('sd-pup-eye')) {
            dd.setSplatVisibleByIndex(sp.index, !sp.visible);
          } else if (e.target.classList.contains('sd-pup-del')) {
            dd.deleteSplatByIndex(sp.index);
            showMsg('已删除泼溅');
          } else {
            dd.selectSplatByIndex(sp.index);
          }
          renderPuppetList();
        });
        host.appendChild(row);
      });
    }
  }
  document.addEventListener('director-state', () => {
    if (document.body.classList.contains('sd-scene-open')) renderPuppetList();
  });
  // 场景按钮打开时也刷一次（render 由 sceneBtn onclick 触发）
  window.__renderPuppetList = renderPuppetList;

  /* ===================== 工具激活让位（v13） =====================
   * 测量等 SS 工具激活时自带底部工具条（select-toolbar），与我们的底栏抢空间。
   * 监听 tool.activated / tool.deactivated，把底栏整体让位（隐藏），退出工具后恢复；
   * 只影响底栏，顶栏/右栏不动。
   */
  let toolWatchBound = false;
  function bindToolWatch() {
    if (toolWatchBound) return;
    const scene = window.scene;
    if (!scene || !scene.events) return;
    toolWatchBound = true;
    // v16: 只给「真的自带底部工具条」的工具让位（测量/框选/涂抹等）。
    // 移动/旋转/缩放 是纯 gizmo 工具，本来没有底部工具条；以前对它们也让位，
    // 底栏一隐藏，而「变换」按钮就在底栏里 —— 于是再也点不回来。
    const hasBottomToolbar = () => [...document.querySelectorAll('.select-toolbar')].some((el) => {
      if (el.closest('.sd-sub-wrap')) return false;          // 我们自己的浮层不算数
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && el.offsetParent !== null;
    });
    const apply = () => document.body.classList.toggle('sd-tool-yield', hasBottomToolbar());
    // 工具条是工具内部异步显示/隐藏的，补两帧再算一次
    const reapply = () => requestAnimationFrame(() => requestAnimationFrame(apply));
    const sync = () => { apply(); reapply(); };
    scene.events.on('tool.activated', sync);
    scene.events.on('tool.deactivated', sync);
    scene.events.on('tool.deactivate', sync);
  }

  /* ===================== 启动 ===================== */

  addEventListener('resize', () => docks.forEach(st => { st.freePos = null; applyDockPos(st); closeAll(st); }));

  // 启动：先藏原工具条，再建 dock
  const style = document.createElement('style');
  style.textContent = '#bottom-toolbar,#right-toolbar{display:none!important}';
  document.head.appendChild(style);
  DOCKS.forEach(d => buildDock(d));
  hideMenuBar(docks.find(s => s.def.menuOptions)?.dock);
  watchDialogs();
  document.body.classList.add('sd-docks-ready');
  bindToolWatch();
  // 场景对象可能在 dock 构建后才就绪，轮询兜底一次
  if (!toolWatchBound) {
    let n = 0;
    const t = setInterval(() => { bindToolWatch(); if (toolWatchBound || ++n > 60) clearInterval(t); }, 500);
  }
});
})();
