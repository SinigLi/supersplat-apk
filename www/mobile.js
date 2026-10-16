// SuperSplat Mobile Override Layer (v0.1)
// 断点检测挂 body.mobile-mode + hover 菜单转点击 (rule: hover-vs-tap)
(function () {
    'use strict';

    function isMobile() {
        return window.innerWidth < 900 || (navigator.maxTouchPoints > 1 && window.innerWidth < 1200);
    }

    function apply() {
        const m = isMobile();
        document.body.classList.toggle('mobile-mode', m);
        // viewport 高度变化 (地址栏收起) 时保持正确
        document.documentElement.style.setProperty('--vvh', window.innerHeight + 'px');
    }

    // 等 PCUI DOM 挂完再挂类
    function boot() {
        apply();
        window.addEventListener('resize', apply);
        window.addEventListener('orientationchange', () => setTimeout(apply, 300));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        // index.js 是 module (defer 语义), 我们先执行; 轮询等 body 有内容
        let n = 0;
        const t = setInterval(() => {
            n++;
            if (document.body && document.body.children.length > 0) { clearInterval(t); boot(); }
            else if (n > 100) { clearInterval(t); boot(); }
        }, 100);
    }

    // hover 菜单 → 点击展开: 触屏上 pointerenter 不可靠, PCUI 菜单监听 mouseenter/mouseleave
    // 触屏浏览器 tap 会派发 mouseenter, 但子面板 hover 关闭逻辑会立即收起 → 拦截 mouseleave
    document.addEventListener('mouseleave', function (e) {
        if (!document.body.classList.contains('mobile-mode')) return;
        e.stopImmediatePropagation();
    }, true);

    // 防止双击缩放干扰编辑器手势 (rule: gesture-conflicts)
    let lastTouchEnd = 0;
    document.addEventListener('touchend', function (e) {
        const now = Date.now();
        if (now - lastTouchEnd < 300) e.preventDefault();
        lastTouchEnd = now;
    }, { passive: false });
})();
