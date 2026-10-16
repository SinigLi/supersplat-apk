/* SuperSplat Dock Overhaul (v1)
 * 交互定稿（2026-10-16 原型 v8）：三停靠组 + 拖动吸附 + 实时换向 + 收缩成球 + 子面板多开
 * 顶=文件组 / 底=编辑组 / 右=视图组
 * 实现：把 SuperSplat 现有按钮 DOM（含事件）重挂进 dock，功能零重写
 */
(function () {
'use strict';

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
    xform:  { ico:'🔢', name:'变换', ids:['bottom-toolbar-move','bottom-toolbar-rotate','bottom-toolbar-scale','bottom-toolbar-orient','bottom-toolbar-coord-space','bottom-toolbar-origin'] },
    shape:  { ico:'✂️', name:'裁剪', ids:['bottom-toolbar-sphere','bottom-toolbar-box'] },
    measure:{ ico:'📐', name:'测量', ids:['bottom-toolbar-measure'] },
    file:   { ico:'📁', name:'文件', ids:[] },   // v1: 菜单按钮代理
    view:   { ico:'👁', name:'视图', ids:['right-toolbar-appearance','right-toolbar-overlays','right-toolbar-orbit-mode','right-toolbar-fly-mode','right-toolbar-frame-selection','right-toolbar-camera-origin','right-toolbar-settings'] },
  };

  const DOCKS = [
    { id:'file', label:'文件', pos:'top',    groupIds:['file'], extra:[] },
    { id:'edit', label:'编辑', pos:'bottom', groupIds:['select','xform','shape','measure'],
      extra:[ {id:'bottom-toolbar-undo', ico:'↶', name:'撤销'}, {id:'bottom-toolbar-redo', ico:'↷', name:'重做'} ] },
    { id:'view', label:'视图', pos:'right',  groupIds:['view'], extra:[] },
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

  function buildDock(def) {
    const dock = makeShell('', 'sd-dock sd-' + def.pos);
    dock.dataset.dock = def.id;
    document.body.appendChild(dock);

    const handle = makeShell('≡', 'sd-handle');
    const label = makeShell(def.label, 'sd-label');
    const collapse = makeShell('▪', 'sd-collapse');

    def.groupIds.forEach(gid => dock.appendChild(makeGroupBtn(gid, dock)));
    (def.extra || []).forEach(t => { const el = makeExtraBtn(t, dock); if (el) dock.appendChild(el); });
    dock.appendChild(label);
    dock.appendChild(collapse);
    dock.insertBefore(handle, dock.firstChild);

    const st = { def, dock, handle, pos: def.pos, freePos: null, openPanels: new Set(), collapsed: false };

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

  // 文件组 v1：单一"菜单"入口，点开弹出 SS 原生菜单（重挂整个菜单根元素）
  function buildFileMenu() {
    const menu = document.querySelector('#menu') || document.querySelector('.pcui-menu');
    const wrap = allPanels.get('file');
    if (!menu || !wrap) return;
    menu.classList.add('sd-adopted');
    // 菜单根通常是横向的菜单条；整体塞进子面板容器
    wrap.appendChild(menu);
  }

  let msgTimer, msgEl;
  function showMsg(t) {
    if (!msgEl) { msgEl = document.createElement('div'); msgEl.id='sd-msg'; document.body.appendChild(msgEl); }
    msgEl.textContent = t; msgEl.style.opacity = 1;
    clearTimeout(msgTimer); msgTimer = setTimeout(()=>msgEl.style.opacity=0, 900);
  }

  addEventListener('resize', () => docks.forEach(st => { st.freePos = null; applyDockPos(st); closeAll(st); }));

  // 启动：先藏原工具条，再建 dock
  const style = document.createElement('style');
  style.textContent = '#bottom-toolbar,#right-toolbar{display:none!important}';
  document.head.appendChild(style);
  DOCKS.forEach(buildDock);
  buildFileMenu();
  document.body.classList.add('sd-docks-ready');
});
})();
