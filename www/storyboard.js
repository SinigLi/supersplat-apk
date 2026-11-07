/* v51 分镜清单适配 —— 纯逻辑层（无 DOM/插件依赖，Node 可测）
 *
 * 老板确认的格式契约：
 * - 文件名固定「分镜清单.csv」，与 clips 目录同级（手机与 PC 目录一致）
 * - 列名固定：「镜号」「多参考图」
 * - 多参考图用分号分隔，帧号 0-based（表格 10 = 显示第 11 帧）
 * - 「镜号」连续 1..N 且 N == 视频数才应用；对不上全部跳过
 */
(function (global) {
    'use strict';

    /* ---------- CSV 解析（引号容忍的简易状态机） ---------- */

    /* 把一整段 CSV 拆成行×列。处理：CRLF/CR、引号内逗号/分号/换行、
     * "" 转义。返回 string[][]。 */
    function parseCsv(text) {
        var rows = [];
        var row = [];
        var cell = '';
        var i = 0, n = text.length;
        var inQuotes = false;
        while (i < n) {
            var ch = text.charAt(i);
            if (inQuotes) {
                if (ch === '"') {
                    if (text.charAt(i + 1) === '"') { cell += '"'; i += 2; continue; }
                    inQuotes = false; i++; continue;
                }
                cell += ch; i++; continue;
            }
            if (ch === '"') { inQuotes = true; i++; continue; }
            if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
            if (ch === '\r') { row.push(cell); cell = ''; rows.push(row); row = []; i++; if (text.charAt(i) === '\n') i++; continue; }
            if (ch === '\n') { row.push(cell); cell = ''; rows.push(row); row = []; i++; continue; }
            cell += ch; i++;
        }
        row.push(cell);
        rows.push(row);
        /* 去掉末尾全空行 */
        while (rows.length) {
            var last = rows[rows.length - 1];
            var empty = true;
            for (var k = 0; k < last.length; k++) { if (String(last[k]).trim() !== '') { empty = false; break; } }
            if (empty) rows.pop(); else break;
        }
        return rows;
    }

    /* 多参考图单元格 → 内部帧号数组（0-based → 1-based 显示口径转换在
     * 这里统一做：表格数字 N 视为 0-based 帧索引，内部亦以 0-based 存
     * （与 multiframe_ref.frames 现约定一致），显示层 +1。
     * 老板口径：表格 10 = 显示第 11 帧 = 内部帧 10。 */
    function parseRefs(cell) {
        var s = String(cell == null ? '' : cell).trim();
        if (!s) return [];
        var parts = s.split(/[;；,，]/);
        var out = [];
        for (var i = 0; i < parts.length; i++) {
            var p = String(parts[i]).trim();
            if (!p) continue;
            var v = Number(p);
            if (!isFinite(v) || v < 0) continue;
            out.push(Math.floor(v));
        }
        out.sort(function (a, b) { return a - b; });
        /* 去重 */
        var dedup = [];
        for (var j = 0; j < out.length; j++) {
            if (j === 0 || out[j] !== out[j - 1]) dedup.push(out[j]);
        }
        return dedup;
    }

    /* 文本 → {ok, rows, error}
     * rows: [{no, refs}]，no 为「镜号」整数（保持 CSV 原值） */
    function parseStoryboardCsv(text) {
        if (typeof text !== 'string' || !text.length) return { ok: false, error: 'CSV 为空' };
        var t = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
        var grid = parseCsv(t);
        if (!grid.length) return { ok: false, error: 'CSV 无内容行' };
        /* 表头：找「镜号」「多参考图」列（子串匹配，容忍全半角/空格差异） */
        var norm = function (s) { return String(s || '').replace(/\s+/g, ''); };
        var head = grid[0].map(norm);
        var noCol = -1, refCol = -1;
        for (var c = 0; c < head.length; c++) {
            if (noCol < 0 && head[c].indexOf('镜号') >= 0) noCol = c;
            if (refCol < 0 && head[c].indexOf('多参考图') >= 0) refCol = c;
        }
        if (noCol < 0) return { ok: false, error: '表头缺少「镜号」列' };
        if (refCol < 0) return { ok: false, error: '表头缺少「多参考图」列' };
        var rows = [];
        for (var r = 1; r < grid.length; r++) {
            var line = grid[r];
            var no = Number(String(line[noCol] == null ? '' : line[noCol]).trim());
            if (!isFinite(no)) continue;   /* 镜号非数字的行忽略 */
            rows.push({ no: Math.floor(no), refs: parseRefs(line[refCol]) });
        }
        if (!rows.length) return { ok: false, error: '没有有效数据行（镜号列为空或非数字）' };
        return { ok: true, rows: rows };
    }

    /* ---------- 编号↔视频匹配 ---------- */

    /* files: [{seq:int|null, name:string}]（av-store.buildFileList 产物）
     * 返回 {ok, reason?, marks:[{seg, frames}]}
     * 严格口径：CSV 镜号集合恰为 1..N 连续，且 N == 有效视频数，
     * 且每个视频文件都带数字标号。 */
    function matchStoryboard(rows, files) {
        var videoCount = files.length;
        var noSet = {};
        var maxNo = 0;
        for (var i = 0; i < rows.length; i++) {
            noSet[rows[i].no] = true;
            if (rows[i].no > maxNo) maxNo = rows[i].no;
        }
        /* 镜号必须恰为 1..maxNo 连续无重复 */
        if (Object.keys(noSet).length !== rows.length) return { ok: false, reason: '镜号有重复' };
        for (var v = 1; v <= maxNo; v++) {
            if (!noSet[v]) return { ok: false, reason: '镜号不连续（缺 ' + v + '）' };
        }
        if (maxNo !== videoCount) return { ok: false, reason: '镜号数量(' + maxNo + ')与视频数(' + videoCount + ')不一致' };
        for (var f = 0; f < files.length; f++) {
            if (files[f].seq == null) return { ok: false, reason: '存在无标号视频文件：' + files[f].name };
        }
        var marks = [];
        for (var k = 0; k < files.length; k++) {
            var row = null;
            for (var m = 0; m < rows.length; m++) { if (rows[m].no === files[k].seq) { row = rows[m]; break; } }
            if (row && row.refs.length) marks.push({ seg: files[k].seq, frames: row.refs.slice() });
        }
        return { ok: true, marks: marks };
    }

    /* ---------- 合并进既有 marks ---------- */

    /* curMarks: S.marks.marks 数组（含 split 等）。把 marks 合入：
     * - 同 seg 已有 multiframe_ref → frames 并集排序（保留原 note 优先）
     * - 否则 push {id, type:'multiframe_ref', seg, frames, note:'分镜清单'}
     * 返回新数组（不修改原数组元素），供调用方校验后替换。 */
    function mergeIntoMarks(curMarks, marks) {
        var out = (curMarks || []).slice();
        for (var i = 0; i < marks.length; i++) {
            var hit = null;
            for (var j = 0; j < out.length; j++) {
                if (out[j].type === 'multiframe_ref' && out[j].seg === marks[i].seg) { hit = out[j]; break; }
            }
            if (hit) {
                var set = {};
                (hit.frames || []).forEach(function (fr) { set[fr] = true; });
                marks[i].frames.forEach(function (fr) { set[fr] = true; });
                var merged = Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
                hit = { id: hit.id, type: 'multiframe_ref', seg: hit.seg, frames: merged, note: hit.note || '分镜清单' };
                out[out.indexOf(hit.srcRef || hit)] = hit;
                for (var q = 0; q < out.length; q++) {
                    if (out[q] === hit || (out[q] && out[q].id === hit.id && out[q].type === 'multiframe_ref')) { out[q] = hit; break; }
                }
            } else {
                out.push({ id: 'sb' + Date.now() + '_' + i, type: 'multiframe_ref', seg: marks[i].seg, frames: marks[i].frames, note: '分镜清单' });
            }
        }
        return out;
    }

    var api = { parseCsv: parseCsv, parseRefs: parseRefs, parseStoryboardCsv: parseStoryboardCsv, matchStoryboard: matchStoryboard, mergeIntoMarks: mergeIntoMarks };
    global.__storyboard = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
