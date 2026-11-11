/* v58：全局角色卡库管理（开始页入口）
 * 极简管理：列表（名称+角色数）/ 新建空组 / 从工程导入 / 重命名 / 删除 / 导出组 JSON
 * 卡的增删改用 av-ui 里的对话框（在视频工程内完成），这里管“套”这一层。
 */
(function () {
    var dlgEl = null;

    function el(tag, cls, txt) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (txt != null) e.textContent = txt;
        return e;
    }

    function close() { if (dlgEl && dlgEl.parentNode) dlgEl.parentNode.removeChild(dlgEl); dlgEl = null; }

    function refresh() {
        var list = dlgEl.querySelector('.cg-list');
        list.innerHTML = '';
        var groups = window.CCG.list();
        if (!groups.length) { list.appendChild(el('div', 'av-chardlg-empty', '（暂无卡组。可从工程自动迁移，或点「新建空组」）')); return; }
        groups.forEach(function (g) {
            var row = el('div', 'cg-item');
            row.appendChild(el('span', 'cg-name', g.name + ' · ' + (g.data.cards || []).length + ' 角色'));
            var ops = el('span', 'cg-ops');
            var ren = el('button', 'av-chardlg-btn', '改名');
            ren.addEventListener('click', function () {
                var nm = window.prompt('新名称：', g.name);
                if (!nm || !window.CCG.rename(g.id, nm.trim())) toast(nm ? '改名失败（重名？）' : '取消');
                else refresh();
            });
            var exp = el('button', 'av-chardlg-btn', '导出');
            exp.addEventListener('click', function () {
                var blob = new Blob([JSON.stringify(g.data, null, 2)], { type: 'application/json' });
                var a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'charcards-' + g.name + '.json';
                a.click();
            });
            var del = el('button', 'av-chardlg-btn av-chardlg-del', '删除');
            del.addEventListener('click', function () {
                if (window.confirm('删除卡组「' + g.name + '」？（工程引用不会自动清理，切换时会提示缺失）')) { window.CCG.remove(g.id); refresh(); }
            });
            ops.appendChild(ren); ops.appendChild(exp); ops.appendChild(del);
            row.appendChild(ops);
            list.appendChild(row);
        });
    }

    function open() {
        if (!window.CCG) { toast('卡组模块未加载', true); return; }
        if (dlgEl) return;
        dlgEl = el('div', 'av-chardlg open');
        dlgEl.innerHTML =
            '<div class="av-chardlg-mask"></div>' +
            '<div class="av-chardlg-card">' +
            '<div class="av-chardlg-title">🎭 全局角色卡库</div>' +
            '<div class="cg-list"></div>' +
            '<div class="av-chardlg-row">' +
            '<button class="av-chardlg-btn cg-new">新建空组</button>' +
            '<button class="av-chardlg-btn cg-imp">导入 JSON</button>' +
            '<button class="av-chardlg-btn cg-fromproj">从工程生成</button>' +
            '<button class="av-chardlg-btn av-closedlg">关闭</button>' +
            '</div></div></div>';
        document.body.appendChild(dlgEl);
        dlgEl.querySelector('.av-chardlg-mask').addEventListener('click', close);
        dlgEl.querySelector('.av-closedlg').addEventListener('click', close);
        dlgEl.querySelector('.cg-new').addEventListener('click', function () {
            var nm = window.prompt('新卡组名称：');
            if (!nm) return;
            var r = window.CCG.create(nm.trim());
            if (!r) { toast('名称已存在'); return; }
            refresh();
        });
        dlgEl.querySelector('.cg-imp').addEventListener('click', function () {
            var inp = document.createElement('input');
            inp.type = 'file'; inp.accept = 'application/json,.json';
            inp.addEventListener('change', function () {
                var f = inp.files && inp.files[0];
                if (!f) return;
                var rd = new FileReader();
                rd.onload = function () {
                    try {
                        var data = JSON.parse(rd.result);
                        var nm = f.name.replace(/\.json$/i, '').replace(/^charcards-/, '');
                        var r = window.CCG.importPack(nm, data);
                        if (r) { toast(r.existed ? '已覆写同名卡组' : '已导入'); refresh(); }
                        else toast('JSON 格式不符（需 charcards.v1）', true);
                    } catch (e) { toast('解析失败：' + e.message, true); }
                };
                rd.readAsText(f);
            });
            inp.click();
        });
        dlgEl.querySelector('.cg-fromproj').addEventListener('click', function () {
            var n = window.CCG.migrateIfNeeded();
            toast(n > 0 ? '已从工程生成 ' + n + ' 套卡组' : '没有需要迁移的工程卡');
            refresh();
        });
        refresh();
    }

    function toast(msg, isErr) {
        var t = el('div', 'av-toast' + (isErr ? ' av-toast-err' : ''), msg);
        document.body.appendChild(t);
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
    }

    window.__cardgroups = { open: open };
})();
