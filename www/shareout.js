/* ============================================================
 * shareout.js — v63 大文件导出分发
 *
 * 背景：飞书单文件上限 30MB。视频打标包现在能到 40MB（原图进 zip），
 * 直接走 shareFile 发过去会被拒；而且 40MB base64 走到原生桥本身就有 OOM 风险。
 *
 * 策略：
 *   ≤ 30MB  → 沿用 SaveImage.shareFile（现有链路，已实测可用）
 *   > 30MB  → 按 25MB 切卷（飞书留 5MB 余量），逐卷写进 Cache，
 *             再调 SaveImage.sharePaths 一次多选分享（ACTION_SEND_MULTIPLE）
 *
 * 卷名：<原名>.001 / .002 …（与解压中心 ExtractPlugin 的 stripVolume 规则一致，
 *       老板把整卷拖进「解压中心」即可自动拼接还原，无需手工合并）
 *
 * API：
 *   ShareOut.send({ bytes, filename, mime, onProgress })  → Promise<{volumes, mode}>
 *   ShareOut.splitName(name, i, total)                     → 'xxx.zip.001'
 *   ShareOut._setLimits(limit, vol)                        仅测试用
 * ============================================================ */
'use strict';
(function (global) {
    var LIMIT = 30 * 1024 * 1024;   /* 飞书单文件上限 */
    var VOL = 25 * 1024 * 1024;     /* 每卷目标大小，留 5MB 余量 */
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
        /* 单个大文件切卷并分享。bytes 为 Uint8Array */
        send: async function (opt) {
            opt = opt || {};
            var bytes = opt.bytes;
            var filename = opt.filename || 'export.bin';
            var mime = opt.mime || 'application/octet-stream';
            var onProgress = opt.onProgress || function () { };
            if (!bytes || !bytes.length) throw new Error('没有内容可分享');

            var sp = savePlug();
            dlog('send name=' + filename + ' size=' + mb(bytes.length) + ' limit=' + mb(LIMIT) + ' plugin=' + (!!sp));

            /* 小文件走既有 shareFile（base64 直传，链路已实测） */
            if (bytes.length <= LIMIT) {
                if (!sp || !sp.shareFile) throw new Error('SaveImage 插件未就绪');
                onProgress(0.5, '编码…');
                var b64 = bytesToBase64(bytes);
                await sp.shareFile({ data: b64, filename: filename, mime: mime });
                dlog('single shareFile ok ' + mb(bytes.length));
                return { volumes: 1, mode: 'single' };
            }

            /* 大文件：切卷 → 写 Cache → 一次多选分享 */
            var total = Math.ceil(bytes.length / VOL);
            if (!fsPlugin()) {
                /* 没有 Filesystem 时退回逐卷 shareFile：base64 走内存，单卷 25MB 可接受 */
                dlog('no Filesystem plugin -> sequential shareFile (' + total + ' vols)');
                var seqNames = [];
                for (var s0 = 0; s0 < total; s0++) {
                    var st0 = s0 * VOL, en0 = Math.min(st0 + VOL, bytes.length);
                    var nm0 = splitName(filename, s0 + 1, total);
                    seqNames.push(nm0);
                    onProgress((s0 + 1) / total, '分卷 ' + (s0 + 1) + '/' + total);
                    await sp.shareFile({ data: bytesToBase64(bytes.subarray(st0, en0)), filename: nm0, mime: mime });
                }
                return { volumes: total, mode: 'split-sequential', names: seqNames };
            }
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

            if (sp && sp.sharePaths) {
                await sp.sharePaths({ names: names, mime: mime });
                dlog('sharePaths ok volumes=' + names.length);
                return { volumes: names.length, mode: 'split', names: names };
            }
            /* 兜底：逐卷 shareFile（会连续弹多次分享面板） */
            dlog('sharePaths unavailable -> sequential shareFile');
            for (var k = 0; k < names.length; k++) {
                var st = k * VOL, en = Math.min(st + VOL, bytes.length);
                var b64v = bytesToBase64(bytes.subarray(st, en));
                await sp.shareFile({ data: b64v, filename: names[k], mime: mime });
            }
            return { volumes: names.length, mode: 'split-sequential', names: names };
        },
        splitName: splitName,
        limit: function () { return LIMIT; },
        volumeSize: function () { return VOL; },
        _setLimits: function (limit, vol) {
            if (limit) LIMIT = limit;
            if (vol) VOL = vol;
        }
    };

    global.ShareOut = ShareOut;
})(typeof window !== 'undefined' ? window : this);
