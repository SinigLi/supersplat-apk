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
    measure:{ ico:'📐', name:'测量', ids:['bottom-toolbar-measure'] },
    file:   { ico:'📁', name:'文件', ids:[] },   // v1: 菜单按钮代理
    view:   { ico:'👁', name:'视图', ids:['right-toolbar-appearance','right-toolbar-overlays','right-toolbar-orbit-mode','right-toolbar-fly-mode','right-toolbar-frame-selection','right-toolbar-camera-origin','right-toolbar-settings'] },
  };

  const DOCKS = [
    { id:'file', label:'菜单', pos:'top',    groupIds:[], menuOptions:true,
      extra:[ {id:'bottom-toolbar-undo', ico:'↶', name:'撤销'}, {id:'bottom-toolbar-redo', ico:'↷', name:'重做'} ] },
    { id:'edit', label:'工具', pos:'bottom', groupIds:['xform'], dirBar:true,
      extra:[] },
    { id:'view', label:'视图', pos:'right',  groupIds:[], viewOptions:true,
      extra:[ {id:'bottom-toolbar-measure', ico:'📐', name:'测量'} ] },
  ];

  // v10 分镜工具定位：泼溅专属菜单（文件/选择/帮助）先隐藏，保留编辑/渲染；
  // 被隐藏的 .menu-panel 仍留在 #menu 内但无入口可开（pcui-hidden）
  const MENU_ORDER = ['file','open-recent','import-recent','export','edit','selection','render','video-tutorials','help'];
  const TOP_MENUS = [
    { key:'render',    name:'渲染', ico:'🎬' },
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

    // 角色下拉：来自 window.__director.listCharacters()
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
        const r = d.addPuppet();
        showMsg(r === 'loading' ? '人偶资源加载中…' : '人偶已在游标处生成');
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
      assetInput.accept = '.glb,.gltf,' + SPLAT_EXT.join(',');
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
      // 右侧：视图组按一级分组——相机模式（轨道/飞行）、设置（外观/浮层/设置面板）、定位（框选/回原点）
      [['相机', ['right-toolbar-orbit-mode','right-toolbar-fly-mode']],
       ['设置', ['right-toolbar-appearance','right-toolbar-overlays','right-toolbar-settings']],
       ['定位', ['right-toolbar-frame-selection','right-toolbar-camera-origin']]
      ].forEach(([name, ids]) => {
        const g = makeShell(`<span class="sd-ico">${name==='相机'?'🎥':name==='设置'?'⚙️':'🎯'}</span><span class="sd-name">${name}</span><span class="sd-dot"></span>`, 'sd-grp-btn');
        const wrap = makeShell('', 'sd-sub-wrap');
        ids.forEach(id => adopt(id, wrap));
        document.body.appendChild(wrap);
        allPanels.set(name, wrap);
        g.onclick = () => toggleNamed(name, g, dock);
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
        { act:'cursor',   ico:'🎯', name:'游标' },
        { act:'movetocursor', ico:'🧲', name:'移动到游标' },
        { act:'xform',    ico:'🔢', name:'变换' },
        { act:'director', ico:'🎬', name:DIR_NAME }
      ].forEach(b => {
        const btn = makeShell(`<span class="sd-ico">${b.ico}</span><span class="sd-name">${b.name}</span><span class="sd-dot"></span>`, 'sd-grp-btn sd-dir-act');
        btn.dataset.act = b.act;
        if (b.act === 'xform') btn.dataset.grp = 'xform';

        else if (b.act === 'cursor') btn.onclick = () => { const d=window.__director; if(!d){showMsg('导演台模块未就绪');return;} const r=d.armPlaceCursor(); showMsg(r==='place-cursor'?'点击画布放置 3D 游标（再点取消）':'已取消放置'); };
        else if (b.act === 'movetocursor') btn.onclick = () => {
          const d=window.__director; if(!d){showMsg('导演台模块未就绪');return;}
          const r=d.moveSelectedToCursor();
          showMsg(r==='ok'?'人偶已移到 3D 游标（可撤销）':
                  r==='no-selection'?'先选中一个人偶':
                  r==='no-cursor'?'先点「游标」在场景里定个位置':'已取消');
        };
        else if (b.act === 'xform') btn.onclick = () => toggleGroup('xform', dock);
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
      dock.style.top = st.freePos.top + 'px';
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
      [['appearance-panel','外观','right-toolbar-appearance'], ['overlays-panel','浮层','right-toolbar-overlays'], ['settings-panel','设置','right-toolbar-settings']].forEach(function(def){
        var p = document.getElementById(def[0]);
        if (!p || p.querySelector(':scope > .sd-sheet-header')) return;
        var hd = makeShell('<span class="sd-back-btn">‹ 返回</span><span class="sd-sheet-title">' + def[1] + '</span>', 'sd-sheet-header');
        p.insertBefore(hd, p.firstChild);
        hd.querySelector('.sd-back-btn').addEventListener('pointerdown', function(e){ e.stopPropagation(); });
        hd.querySelector('.sd-back-btn').onclick = function(e){
          e.stopPropagation();
          p.classList.add('pcui-hidden');
          p.style.display = 'none';
          var tb = document.getElementById(def[2]);
          if (tb && tb.classList) tb.classList.remove('active');
        };
        new MutationObserver(function(){
          if (p.classList.contains('pcui-hidden')) return;
          var cs = getComputedStyle(p);
          if (cs.display === 'none') return;
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

  /* ===================== v10 场景页人偶列表 =====================
   * 人偶行：点行选中（进 SS 变换/撤销管线）、眼睛切显隐、垃圾桶删（走 undo）。
   * 数据源 window.__director.listPuppets()；director-state 事件驱动重绘。
   */
  function renderPuppetList() {
    const host = document.getElementById('sd-puppet-list');
    if (!host) return;
    const d = window.__director;
    const list = (d && d.listPuppets) ? d.listPuppets() : [];
    const props = (d && d.listProps) ? d.listProps() : [];
    host.innerHTML = '';
    if (!list.length && !props.length) return;
    if (list.length) {
      const title = makeShell('<span class="sd-pup-title">人偶</span>', 'sd-pup-head');
      host.appendChild(title);
    }
    list.forEach((p) => {
      const row = makeShell(
        '<span class="sd-pup-name">🧍 ' + p.name + (p.clipLabel ? ' · ' + p.clipLabel : '') + (p.playing ? ' ▶' : '') + '</span>' +
        '<span class="sd-pup-eye">' + (p.visible ? '👁' : '🚫') + '</span>' +
        '<span class="sd-pup-del">🗑</span>', 'sd-pup-row' + (p.selected ? ' sd-pup-sel' : ''));
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        const dd = window.__director;
        if (!dd) return;
        if (e.target.classList.contains('sd-pup-eye')) {
          dd.setPuppetVisible(p.id, !p.visible);
        } else if (e.target.classList.contains('sd-pup-del')) {
          dd.deletePuppetById(p.id);
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
          '<span class="sd-pup-del">🗑</span>', 'sd-pup-row' + (pr.selected ? ' sd-pup-sel' : ''));
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          const dd = window.__director;
          if (!dd) return;
          if (e.target.classList.contains('sd-pup-del')) dd.deletePropById(pr.id);
          else dd.selectPropById(pr.id);
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
    const apply = (active) => document.body.classList.toggle('sd-tool-yield', !!active);
    scene.events.on('tool.activated', (name) => apply(!!name));
    scene.events.on('tool.deactivated', () => apply(false));
    scene.events.on('tool.deactivate', () => apply(false));
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
