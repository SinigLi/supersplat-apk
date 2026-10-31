/* SuperSplat Dock Overhaul — 移动端分组工具栏
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
    { id:'file', label:'菜单', pos:'top',    groupIds:[], menuOptions:true,
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
      const bo = document.createElement('option');
      bo.value = '__box';
      bo.textContent = '方块';
      charSel.appendChild(bo);
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

    // v30 #6：方块固定色板（拍板沿用固定色板，不吃 multiply 染色，直接换 diffuse）
    const BOX_HEX = { NONE:'#808080', RED:'#bf1414', ORANGE:'#e56b14', YELLOW:'#f2d41f',
                      GREEN:'#26b333', BLUE:'#1f59e6', GRAY:'#808080', PURPLE:'#8026cc' };

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
        // v31：选「方块」时摆放的是方块模型（同一人偶入口）
        if (charSel.value === '__box') {
          if (d.addBoxAtCursor) {
            d.addBoxAtCursor(BOX_HEX[tintSel.value] || BOX_HEX.GRAY);
            showMsg('方块已生成（可撤销），选中后点颜色下拉换色');
          } else {
            showMsg('引擎无方块接口');
          }
        } else {
          const r = d.addPuppet();
          showMsg(r === 'loading' ? '人偶资源加载中…' : '人偶已在游标处生成');
        }
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
      // v30 #6：选中的是方块时走 setBoxColor（方块不吃 multiply 染色）
      const props = (d.listProps && d.listProps()) || [];
      const box = props.find(function (p) { return p.selected && p.kind === 'box'; });
      if (box) {
        const hex = BOX_HEX[tintSel.value] || BOX_HEX.GRAY;
        const r = d.setBoxColor(box.id, hex);
        showMsg(r === 'ok' ? '方块已换色' : '换色失败');
        return;
      }
      const r = d.setTint(tintSel.value);
      showMsg(r === 'ok' ? '已换色' : '先选中一个人偶或方块');
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

  /* v20 机位面板：列出机位 / 新增 / 移除 / 查看 / 渲染照片
   * 机位数据在导演台里（window.__director.shots），这里只做展示与调用。
   * 相机分组原本的两个按钮是「轨道相机 / 飞行相机」操控模式，保留在底部一行。
   */

  /* 渲染结果预览层。
   * 三个动作都走原生：WebView 会静默忽略 <a download>，长按我们自己的浮层
   * 也不会弹系统保存菜单。
   *   保存到相册 → SaveImage.save   （直接进 Pictures/SuperSplat）
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
        showMsg("已保存到相册：Pictures/SuperSplat/" + out.name);
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

  function buildShotPanel(wrap) {
    wrap.classList.add("sd-dir-panel", "sd-shot-panel");
    wrap.innerHTML =
      '<div class="sd-dir-row sd-shot-pick-row">' +
        '<select class="sd-shot-list" title="机位列表"></select>' +
        '<button class="sd-dir-btn sd-shot-btn sd-shot-mini" data-shot="rename" title="重命名选中的机位">✏️</button>' +
        '<button class="sd-dir-btn sd-shot-btn sd-shot-mini" data-shot="relocate" title="重定位：把选中的机位移到当前视角">📍</button>' +
      '</div>' +
      '<div class="sd-dir-row sd-shot-edit-row" hidden>' +
        '<input class="sd-shot-edit" type="text" maxlength="50" placeholder="机位名称">' +
        '<button class="sd-dir-btn sd-shot-btn sd-shot-mini" data-shot="rename-ok" title="确定">✓</button>' +
        '<button class="sd-dir-btn sd-shot-btn sd-shot-mini" data-shot="rename-no" title="取消">✕</button>' +
      '</div>' +
      '<div class="sd-dir-row">' +
        '<button class="sd-dir-btn sd-shot-btn" data-shot="add" title="新增机位：记录当前视角">＋ 新增</button>' +
        '<button class="sd-dir-btn sd-shot-btn" data-shot="remove" title="移除选中的机位">－ 移除</button>' +
      '</div>' +
      '<div class="sd-dir-row">' +
        '<button class="sd-dir-btn sd-shot-btn" data-shot="goto" title="查看机位：跳到选中机位">👁 查看</button>' +
        '<button class="sd-dir-btn sd-shot-btn" data-shot="render" title="渲染照片：从选中机位出 PNG">📷 渲染</button>' +
      '</div>' +
      '<div class="sd-dir-row sd-cam-modes"></div>' +
      '<div class="sd-dir-hint sd-mode-hint">轨道 = 绕目标转 · 飞行 = 第一人称 · 框选 = 聚焦选中物 · 回原点 = 重置视角</div>' +
      '<div class="sd-dir-row sd-clip-row">' +
        '<span class="sd-clip-lab">近</span><input class="sd-clip-num" data-clip="near" type="number" min="0.01" step="0.1" title="近裁剪距离（比它近的不画）">' +
        '<span class="sd-clip-lab">远</span><input class="sd-clip-num" data-clip="far" type="number" min="0.1" step="1" title="远裁剪距离（比它远的不画）">' +
      '</div>' +
      '<div class="sd-dir-row">' +
        '<button class="sd-dir-btn sd-shot-btn" data-shot="clip-on" title="启用显示范围：只渲染近/远之间的内容（Blender 式）">📏 启用范围</button>' +
        '<button class="sd-dir-btn sd-shot-btn" data-shot="clip-off" title="关闭手动范围，恢复自动裁剪">✕ 自动</button>' +
      '</div>' +
      '<div class="sd-dir-row sd-clip-slider-row">' +
        '<input class="sd-clip-slider" data-slider="near" type="range" min="0" max="1000" step="1" title="近裁剪（拖动按比例取值）">' +
        '<input class="sd-clip-slider" data-slider="far" type="range" min="0" max="1000" step="1" title="远裁剪（拖动按比例取值）">' +
      '</div>';

    const list = wrap.querySelector(".sd-shot-list");
    const modes = wrap.querySelector(".sd-cam-modes");
    const btn = act => wrap.querySelector('.sd-shot-btn[data-shot="' + act + '"]');

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
      ["remove", "goto", "render"].forEach(a => { const b = btn(a); if (b) b.disabled = !has; });
    }

    const curId = () => { const v = list && list.value; return v ? Number(v) : 0; };

    const bAdd = btn("add");
    if (bAdd) bAdd.onclick = (e) => {
      e.stopPropagation();
      const d = window.__director;
      if (!d) { showMsg("导演台模块未就绪"); return; }
      const shot = d.addShot();
      fill();
      if (shot && list) list.value = String(shot.id);
      showMsg("已记录机位：" + (shot ? shot.name : ""));
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

    // v32：改名 + 重定位（下拉右侧两个小图标钮）。
    // 改名用内联输入行，不用 window.prompt —— Android WebView 的 prompt 弹窗
    // 行为不可控（v31 教训：桌面过的真机未必过）。
    const editRow = wrap.querySelector(".sd-shot-edit-row");
    const editInput = wrap.querySelector(".sd-shot-edit");
    const bRename = btn("rename");
    if (bRename) bRename.onclick = (e) => {
      e.stopPropagation();
      const d = window.__director; const id = curId();
      if (!d || !id) { showMsg("先选一个机位"); return; }
      const shot = (d.listShots() || []).find(s => s.id === id);
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
      fill();
      if (list) list.value = String(id);
      showMsg(r === "ok" ? "已把该机位重定位到当前视角" : "没有这个机位");
    };

    const bGo = btn("goto");
    if (bGo) bGo.onclick = (e) => {
      e.stopPropagation();
      const d = window.__director; const id = curId();
      if (!d || !id) { showMsg("先选一个机位"); return; }
      const r = d.gotoShot(id);
      showMsg(r === "ok" ? "已切换到该机位" : "没有这个机位");
    };

    const bRender = btn("render");
    if (bRender) bRender.onclick = async (e) => {
      e.stopPropagation();
      const d = window.__director; const id = curId();
      if (!d || !id) { showMsg("先选一个机位"); return; }
      showMsg("正在渲染照片…");
      const r = await d.renderShot(id, 1280, 720);
      if (r && r.ok) {
        showShotPreview(r);
        showMsg("已渲染 " + r.name + "，可保存到相册 / 另存为 / 分享");
      } else {
        showMsg("渲染失败：" + ((r && (r.detail || r.reason)) || "未知"));
      }
    };

    // v30 #5 / v31 反馈：显示范围控制（手动近/远裁剪，像 Blender）
    // v31：数字输入保留为精确设置，双头滑轨为主交互——拖动按对数比例
    // 取真实值（近端密度高，远端跨度大），松手即生效。
    // 滑轨语义：min/max 是用户设的「范围两端」，拖到 0 = 取最小值，1000 = 取最大值
    const CLIP_MIN_DEFAULT = 0.05;
    const CLIP_MAX_DEFAULT = 2000;
    const clipState = { min: CLIP_MIN_DEFAULT, max: CLIP_MAX_DEFAULT, enabled: false, near: 0.1, far: 1000 };

    // 对数映射：slider [0..1000] ↔ 值域 [min..max]（两端都可为 0 时退化线性）
    const sliderToVal = (t, min, max) => {
        if (max <= min) return min;
        if (min > 0) return min * Math.pow(max / min, t / 1000);
        return min + (max - min) * (t / 1000);
    };
    const valToSlider = (v, min, max) => {
        if (max <= min) return 0;
        if (min > 0 && v > 0) return Math.round(1000 * Math.log(v / min) / Math.log(max / min));
        return Math.round(1000 * (v - min) / (max - min));
    };

    const clipFill = () => {
      const d = window.__director;
      if (!d || !d.getClipRange) return;
      const cr = d.getClipRange();
      const nEl = wrap.querySelector('[data-clip="near"]');
      const fEl = wrap.querySelector('[data-clip="far"]');
      const nSl = wrap.querySelector('[data-slider="near"]');
      const fSl = wrap.querySelector('[data-slider="far"]');
      if (cr.enabled) { clipState.near = cr.near; clipState.far = cr.far; }
      if (nEl && document.activeElement !== nEl) nEl.value = (+clipState.near).toFixed(2);
      if (fEl && document.activeElement !== fEl) fEl.value = Math.round(clipState.far);
      if (nSl) nSl.value = valToSlider(clipState.near, clipState.min, clipState.far);
      if (fSl) fSl.value = valToSlider(clipState.far, clipState.near, clipState.max);
      const on = wrap.querySelector('[data-shot="clip-on"]');
      if (on) on.classList.toggle('sd-on', !!cr.enabled);
    };

    // 应用当前值（滑轨拖动实时调；数字输入变更也走这里）
    const clipApply = (live) => {
      const d = window.__director;
      if (!d || !d.setClipRange) return;
      if (!clipState.enabled) return;
      const near = Math.max(0.01, +clipState.near);
      let far = Math.max(near * 2, +clipState.far);
      clipState.far = far;
      d.setClipRange({ enabled: true, near: near, far: far });
      if (!live) clipFill();
    };

    ['near', 'far'].forEach((key) => {
      const sl = wrap.querySelector('[data-slider="' + key + '"]');
      if (!sl) return;
      sl.addEventListener('input', () => {
        const t = +sl.value;
        const lo = key === 'near' ? clipState.min : clipState.near;
        const hi = key === 'far' ? clipState.max : clipState.far;
        const v = sliderToVal(t, lo, hi);
        if (key === 'near') clipState.near = Math.min(v, clipState.far / 2);
        else clipState.far = Math.max(v, clipState.near * 2);
        clipApply(true);
        const nEl = wrap.querySelector('[data-clip="near"]');
        const fEl = wrap.querySelector('[data-clip="far"]');
        if (nEl) nEl.value = (+clipState.near).toFixed(2);
        if (fEl) fEl.value = Math.round(clipState.far);
      });
      sl.addEventListener('change', () => clipApply(false));
    });

    const bClipOn = btn("clip-on");
    if (bClipOn) bClipOn.onclick = (e) => {
      e.stopPropagation();
      const d = window.__director;
      if (!d || !d.setClipRange) { showMsg("导演台模块未就绪"); return; }
      clipState.enabled = true;
      // 首次启用：若还没设过值，用当前自动裁剪值作起点（拖滑轨调的就是它）
      const cr = d.getClipRange ? d.getClipRange() : null;
      if (cr && !cr.enabled) {
        if (!clipState.touched) { clipState.near = Math.max(0.05, cr.near); clipState.far = Math.max(clipState.near * 2, cr.far); }
      }
      clipApply(false);
      showMsg('已启用显示范围（近 ' + (+clipState.near).toFixed(2) + ' / 远 ' + Math.round(clipState.far) + '），拖滑轨微调');
    };
    const bClipOff = btn("clip-off");
    if (bClipOff) bClipOff.onclick = (e) => {
      e.stopPropagation();
      const d = window.__director;
      if (!d || !d.setClipRange) { showMsg("导演台模块未就绪"); return; }
      clipState.enabled = false;
      d.setClipRange({ enabled: false });
      showMsg('已恢复自动裁剪');
      clipFill();
    };
    // 数字输入仍可精确设置（回车/失焦生效）
    ['near', 'far'].forEach((key) => {
      const numEl = wrap.querySelector('[data-clip="' + key + '"]');
      if (!numEl) return;
      const applyNum = () => {
        const v = parseFloat(numEl.value);
        if (!(v > 0)) return;
        if (key === 'near') clipState.near = Math.min(v, clipState.far / 2);
        else clipState.far = Math.max(v, clipState.near * 2);
        clipState.touched = true;
        clipApply(false);
      };
      numEl.addEventListener('change', applyNum);
    });
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.sd-clip-slider')) clipState.touched = true;
    });

    // 每次展开都刷新（新增/删除后外部也可能变化）
    wrap.__sdRefresh = () => { fill(); clipFill(); };
    fill();
    clipFill();
    return modes;
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
        // v33：框选/回原点移入相机组（轨道/飞行旁），定位组只留基准点三钮+测量
        ["相机", ["right-toolbar-orbit-mode", "right-toolbar-fly-mode", "right-toolbar-frame-selection", "right-toolbar-camera-origin"]],
        ["设置", ["right-toolbar-appearance", "right-toolbar-overlays", "right-toolbar-settings"]],
        ["定位", []]
      ].forEach(function(pair){
        var name = pair[0], ids = pair[1];
        var ico = name === "相机" ? "🎥" : (name === "设置" ? "⚙️" : "🎯");
        var g = makeShell('<span class="sd-ico">' + ico + '</span><span class="sd-name">' + name + '</span><span class="sd-dot"></span>', "sd-grp-btn");
        var wrap = makeShell("", "sd-sub-wrap");
        var modes = null;
        if (name === "相机") modes = buildShotPanel(wrap);   // v20 机位面板
        // 相机组把两个模式按钮塞进面板底部那行；其余组照旧平铺
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
      const minTop = barBottom ? barBottom + 6 : 8;
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
      const nt = Math.max(6, Math.min(e.clientY - r.height/2, innerHeight - r.height - 6));
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
      else st.freePos = { top: Math.max(m, Math.min(free.top, innerHeight - r.height - m)) };
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
