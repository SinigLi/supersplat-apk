/* ============================================================
 * shareout.js — v64 大文件导出分发
 *
 * 背景（v64 修订）：v63 时飞书/OpenClaw 单文件上限是 30MB，所以按 25MB 切卷。
 * 2026-11-13 老板把 OpenClaw 侧上限调到 500MB，切卷阈值随之上调：
 *   ≤ 500MB → 直接单个文件发出（绝大多数情况）
 *   > 500MB → 按 450MB 一卷切开（留 50MB 余量）
 *
 * 切卷的**唯一**原因是传输端（飞书 / OpenClaw）的单文件上限。
 * 如果当前运行环境根本没法一次交出多个文件（没有 Filesystem 插件写缓存，
 * 或原生没有 sharePaths 多选分享），那就不切了——直接整包单发。
 * 分卷发不出去比整包发不出去更糟：收件方拼不回来。
 *
 * 卷名：<原名>.001 / .002 …（与解压中心 ExtractPlugin 的 stripVolume 规则一致，
 *       把整卷拖进「解压中心」即可自动拼接还原，无需手工合并）
 *
 * API：
 *   ShareOut.send({ bytes, filename, mime, onProgress })  → Promise<{volumes, mode, names?}>
 *   ShareOut.splitName(name, i, total)                     → 'xxx.zip.001'
 *   ShareOut.canSplit()                                    → boolean（当前环境能否多选分享）
 *   ShareOut.limit() / volumeSize()
 *   ShareOut._setLimits(limit, vol)                        仅测试用
 * ============================================================ */
'use strict';
(function (global) {
    var LIMIT = 500 * 1024 * 1024;  /* 传输端单文件上限（OpenClaw 2026-11-13 调到 500MB） */
    var VOL = 450 * 1024 * 1024;    /* 每卷目标大小，留 50MB 余量 */
    var CACHE_DIR = 'shared';       /* CacheDirectory/shared，与原生一致 */
    var CHUNK = 3 * 1024 * 1024;    /* 写盘分片（base64 后 ~4MB/片） */

    function fsPlugin() {
        var cap = window.Capacitor;
        return (cap && cap.Plugins && cap.Plugins.Filesystem) || null;
    }
    function savePlug() {
        var cap = window.Capacitor;
        return (cap && cap.Plugins && cap.Plugins.SaveImage) || null;
    }
    /* 能不能真正"分卷发"：需要①写缓存的能力 ②一次多选分享的能力。缺一就不分。 */
    function canSplit() {
        var sp = savePlug();
        return !!(fsPlugin() && sp && sp.sharePaths);
    }
    function dlog(msg) {
        try {
            var cap = window.Capacitor;
            var p = cap && cap.Plugins && cap.Plugins.DebugLog;
            if (p && p.append) {
                var r = p.append({ text: '[share] ' + msg });
                if (r && r.catch) r.catch(function () { });
            }
        } catch (e) { }
    }
    function mb(n) { return (n / 1048576).toFixed(1) + 'MB'; }

    function bytesToBase64(u8) {
        var out = '', CH = 8192;
        for (var i = 0; i < u8.length; i += CH) {
            out += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
        }
        return btoa(out);
    }

    function splitName(name, i, total) {
        var digits = String(total).length < 3 ? 3 : String(total).length;
        var s = String(i);
        while (s.length < digits) s = '0' + s;
        return name + '.' + s;
    }

    /* 写 CacheDirectory/shared/<name>，分片 append（与 projects.js nativeStore.write 同法） */
    async function writeCache(name, u8) {
        var p = fsPlugin();
        if (!p) throw new Error('Filesystem 插件未就绪');
        var path = CACHE_DIR + '/' + name;
        /* 先建空文件（清掉上一次同名残留） */
        await p.writeFile({ path: path, data: '', directory: 'CACHE', recursive: true });
        for (var i = 0; i < u8.length; i += CHUNK) {
            var end = Math.min(i + CHUNK, u8.length);
            await p.appendFile({
                path: path,
                data: bytesToBase64(u8.subarray(i, end)),
                directory: 'CACHE',
                recursive: true
            });
        }
        return path;
    }

    var ShareOut = {
        /* 分享一份二进制。bytes 为 Uint8Array */
        send: async function (opt) {
            opt = opt || {};
            var bytes = opt.bytes;
            var filename = opt.filename || 'export.bin';
            var mime = opt.mime || 'application/octet-stream';
            var onProgress = opt.onProgress || function () { };
            if (!bytes || !bytes.length) throw new Error('没有内容可分享');

            var sp = savePlug();
            if (!sp || !sp.shareFile) throw new Error('SaveImage 插件未就绪');

            var over = bytes.length > LIMIT;
            var splittable = over && canSplit();
            dlog('send name=' + filename + ' size=' + mb(bytes.length) +
                ' limit=' + mb(LIMIT) + ' vol=' + mb(VOL) +
                ' split=' + (splittable ? 'yes' : (over ? 'no(unsupported)' : 'n/a')));

            /* 不超限，或者环境发不了多卷 → 整包单发 */
            if (!splittable) {
                onProgress(0.5, '编码…');
                var b64 = bytesToBase64(bytes);
                await sp.shareFile({ data: b64, filename: filename, mime: mime });
                if (over) {
                    dlog('single shareFile ok (oversize, split unsupported) ' + mb(bytes.length));
                    return { volumes: 1, mode: 'single-oversize', names: [filename] };
                }
                dlog('single shareFile ok ' + mb(bytes.length));
                return { volumes: 1, mode: 'single', names: [filename] };
            }

            /* 超限且环境支持多卷：切卷 → 写 Cache → 一次多选分享 */
            var total = Math.ceil(bytes.length / VOL);
            dlog('split into ' + total + ' volumes of ' + mb(VOL));
            var names = [];
            for (var i = 0; i < total; i++) {
                var start = i * VOL;
                var end = Math.min(start + VOL, bytes.length);
                var part = bytes.subarray(start, end);
                var nm = splitName(filename, i + 1, total);
                await writeCache(nm, part);
                names.push(nm);
                dlog('volume ' + (i + 1) + '/' + total + ' ' + nm + ' ' + mb(part.length));
                onProgress((i + 1) / total, '分卷 ' + (i + 1) + '/' + total);
            }
            await sp.sharePaths({ names: names, mime: mime });
            dlog('sharePaths ok volumes=' + names.length);
            return { volumes: names.length, mode: 'split', names: names };
        },
        splitName: splitName,
        canSplit: canSplit,
        limit: function () { return LIMIT; },
        volumeSize: function () { return VOL; },
        _setLimits: function (limit, vol) {
            if (limit) LIMIT = limit;
            if (vol) VOL = vol;
        }
    };

    global.ShareOut = ShareOut;
})(typeof window !== 'undefined' ? window : this);
