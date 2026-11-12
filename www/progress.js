/* ============================================================
 * progress.js — v61b 统一进度条浮层
 *   Prog.show(title)          显示（默认 0%）
 *   Prog.set(pct, msg)        更新 0..1 或 0..100（>1 视为百分比）
 *   Prog.done(msg, holdMs)    满格 + 短暂停留后自动隐藏
 *   Prog.hide()               立即隐藏
 * 特性：重复 show 不会叠层；异常中断也能 hide。
 * ============================================================ */
'use strict';
(function (global) {
    var mask = null, box = null, bar = null, ttl = null, sub = null, hideTimer = null;

    var CSS = [
        '.prog-mask{position:fixed;left:0;top:0;right:0;bottom:0;z-index:2000;display:flex;align-items:center;justify-content:center;',
        '  background:rgba(6,8,14,.55);backdrop-filter:blur(2px);}',
        '.prog-box{min-width:240px;max-width:76vw;padding:16px 18px;border-radius:16px;background:rgba(22,25,34,.97);',
        '  border:1px solid #2c3040;box-shadow:0 12px 40px rgba(0,0,0,.55);}',
        '.prog-ttl{font-size:14px;color:#e8eaf2;margin-bottom:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
        '.prog-track{height:8px;border-radius:5px;background:#232734;overflow:hidden;}',
        '.prog-bar{height:100%;width:0%;border-radius:5px;background:linear-gradient(90deg,#3b82f6,#22d3ee);transition:width .18s ease;}',
        '.prog-sub{margin-top:9px;font-size:12px;color:#9aa6b4;min-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
        '.prog-sub.ok{color:#5dd39e}',
        '.prog-pct{float:right;font-size:12px;color:#9fd0ff;margin-left:12px;font-variant-numeric:tabular-nums;}'
    ].join('\n');

    function ensureStyle() {
        if (document.getElementById('prog-style')) return;
        var st = document.createElement('style');
        st.id = 'prog-style';
        st.textContent = CSS;
        document.head.appendChild(st);
    }

    function ensureDom() {
        if (mask) return;
        ensureStyle();
        mask = document.createElement('div');
        mask.className = 'prog-mask';
        box = document.createElement('div');
        box.className = 'prog-box';
        ttl = document.createElement('div');
        ttl.className = 'prog-ttl';
        var pct = document.createElement('span');
        pct.className = 'prog-pct';
        ttl.appendChild(pct);
        ttl._pct = pct;
        var track = document.createElement('div');
        track.className = 'prog-track';
        bar = document.createElement('div');
        bar.className = 'prog-bar';
        track.appendChild(bar);
        sub = document.createElement('div');
        sub.className = 'prog-sub';
        box.appendChild(ttl); box.appendChild(track); box.appendChild(sub);
        mask.appendChild(box);
        document.body.appendChild(mask);
    }

    var Prog = {
        show: function (title) {
            ensureDom();
            if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
            ttl.firstChild && (ttl.firstChild.nodeValue = String(title || '处理中…'));
            if (!ttl.firstChild || ttl.firstChild.nodeType !== 3) {
                ttl.insertBefore(document.createTextNode(String(title || '处理中…')), ttl.firstChild);
            }
            ttl._pct.textContent = '0%';
            bar.style.width = '0%';
            sub.textContent = '';
            sub.classList.remove('ok');
            mask.style.display = 'flex';
            return Prog;
        },
        set: function (pct, msg) {
            if (!mask) ensureDom();
            if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
            mask.style.display = 'flex';
            var p = Number(pct);
            if (!isFinite(p) || p < 0) p = 0;
            if (p > 1) p = p / 100;
            if (p > 1) p = 1;
            bar.style.width = (p * 100).toFixed(1) + '%';
            ttl._pct.textContent = Math.round(p * 100) + '%';
            if (msg != null) sub.textContent = String(msg);
            return Prog;
        },
        done: function (msg, holdMs) {
            if (!mask) ensureDom();
            Prog.set(1, msg || '');
            sub.classList.add('ok');
            hideTimer = setTimeout(function () { Prog.hide(); }, holdMs == null ? 700 : holdMs);
            return Prog;
        },
        hide: function () {
            if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
            if (mask) mask.style.display = 'none';
            return Prog;
        },
        isOpen: function () { return !!(mask && mask.style.display !== 'none'); }
    };

    global.Prog = Prog;
})(typeof window !== 'undefined' ? window : this);
