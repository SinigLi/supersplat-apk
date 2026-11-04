/* av-viz.js —— 音频时频图（audio_viz.py 的 JS 移植，v46）
 *
 * 设计要点：
 *  - 与 av_workspace/tools/音频处理/audio_viz.py 同算法同布局：
 *      白底；上层蓝色 dB 包络（红点线 = 气口阈值 -40dB，绿虚线 = 检测到的语音段 + 编号）；
 *      下层 magma 语谱图，对数频率轴（30Hz → 采样率/2）；
 *      共享时间轴刻度。
 *  - APK 内无 Python，故全部用 WebAudio 解码 + Canvas 2D 绘制。
 *  - 大文件降采样：语谱帧数封顶 ~3000，避免长音频卡死主线程。
 *  - 绘制在 setTimeout 分片后进行，先出包络再补语谱，避免白屏。
 */
(function (global) {
    'use strict';

    /* ---------- WAV 头解析：拿真实采样率，避免 AudioContext 重采样 ---------- */
    function parseWavHeader(buf) {
        if (buf.byteLength < 44) return null;
        var dv = new DataView(buf);
        var tag = function (o) {
            return String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
        };
        if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
        var off = 12, fmt = null, dataOff = -1, dataLen = 0;
        while (off + 8 <= buf.byteLength) {
            var id = tag(off), sz = dv.getUint32(off + 4, true);
            if (id === 'fmt ') {
                fmt = {
                    format: dv.getUint16(off + 8, true),
                    channels: dv.getUint16(off + 10, true),
                    sampleRate: dv.getUint32(off + 12, true),
                    bits: dv.getUint16(off + 22, true)
                };
            } else if (id === 'data') {
                dataOff = off + 8;
                dataLen = Math.min(sz, buf.byteLength - dataOff);
                break;
            }
            off += 8 + sz + (sz % 2);
        }
        if (!fmt || dataOff < 0 || !fmt.sampleRate || !fmt.channels) return null;
        return { fmt: fmt, dataOff: dataOff, dataLen: dataLen };
    }

    /* PCM / float WAV 直接解，保持原始采样率 */
    function decodeWavDirect(buf) {
        var h = parseWavHeader(buf);
        if (!h) return null;
        var f = h.fmt;
        var bytesPer = f.bits >> 3;
        if (bytesPer < 1) return null;
        var frameBytes = bytesPer * f.channels;
        if (!frameBytes) return null;
        var n = Math.floor(h.dataLen / frameBytes);
        if (!n) return null;
        var dv = new DataView(buf);
        var mono = new Float32Array(n);
        var isFloat = (f.format === 3);
        var i, c, base, s;
        for (i = 0; i < n; i++) {
            s = 0;
            base = h.dataOff + i * frameBytes;
            for (c = 0; c < f.channels; c++) {
                var o = base + c * bytesPer;
                if (isFloat && f.bits === 32) s += dv.getFloat32(o, true);
                else if (f.bits === 16) s += dv.getInt16(o, true) / 32768;
                else if (f.bits === 8) s += (dv.getUint8(o) - 128) / 128;
                else if (f.bits === 24) {
                    var b0 = dv.getUint8(o), b1 = dv.getUint8(o + 1), b2 = dv.getInt8(o + 2);
                    s += ((b2 << 16) | (b1 << 8) | b0) / 8388608;
                } else if (f.bits === 32) s += dv.getInt32(o, true) / 2147483648;
                else return null;
            }
            mono[i] = s / f.channels;
        }
        return { mono: mono, sr: f.sampleRate, dur: n / f.sampleRate, channels: f.channels };
    }

    /* ---------- 解码入口：WAV 走直解（保真采样率），其余走 WebAudio ---------- */
    function decodeMono(arrayBuffer) {
        var direct = null;
        try { direct = decodeWavDirect(arrayBuffer); } catch (e) { direct = null; }
        if (direct && direct.mono.length) return Promise.resolve(direct);

        var AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return Promise.reject(new Error('AudioContext 不可用'));
        var ctx = new AC();
        return new Promise(function (resolve, reject) {
            var done = false;
            var ok = function (b) { if (!done) { done = true; resolve(b); } };
            var bad = function (e) { if (!done) { done = true; reject(e || new Error('decode failed')); } };
            // 老 WebView 只支持回调式
            var p = ctx.decodeAudioData(arrayBuffer, ok, bad);
            if (p && p.then) p.then(ok, bad);
        }).then(function (buf) {
            var ch = buf.numberOfChannels;
            var n = buf.length;
            var mono = new Float32Array(n);
            for (var c = 0; c < ch; c++) {
                var d = buf.getChannelData(c);
                for (var i = 0; i < n; i++) mono[i] += d[i] / ch;
            }
            var sr = buf.sampleRate;
            try { ctx.close(); } catch (e) { }
            return { mono: mono, sr: sr, dur: n / sr, channels: ch };
        });
    }

    /* ---------- dB 包络（10ms 窗，对齐 audio_viz.envelope） ---------- */
    function envelopeDb(mono, sr, winMs) {
        winMs = winMs || 10.0;
        var hop = Math.max(1, Math.round(sr * winMs / 1000));
        var n = Math.floor(mono.length / hop);
        var times = new Float32Array(n), db = new Float32Array(n);
        for (var i = 0; i < n; i++) {
            var s = 0, off = i * hop;
            for (var j = 0; j < hop; j++) { var v = mono[off + j]; s += v * v; }
            times[i] = off / sr;
            db[i] = 20 * Math.log10(Math.sqrt(s / hop) + 1e-20);
        }
        return { times: times, db: db };
    }

    /* ---------- 气口检测（audio_align.detect_segments 移植） ---------- */
    function detectSegments(mono, sr, noiseDb, minSilence, minSpeech) {
        noiseDb = noiseDb === undefined ? -40 : noiseDb;
        minSilence = minSilence === undefined ? 0.15 : minSilence;
        minSpeech = minSpeech === undefined ? 0.08 : minSpeech;
        if (!mono.length) return [];
        var hop = Math.max(1, Math.round(sr * 0.01));
        var n = Math.floor(mono.length / hop);
        if (!n) return [[0, mono.length]];
        var db = new Float32Array(n);
        for (var i = 0; i < n; i++) {
            var s = 0, off = i * hop;
            for (var j = 0; j < hop; j++) { var v = mono[off + j]; s += v * v; }
            db[i] = 20 * Math.log10(Math.sqrt(s / hop) + 1e-20);
        }
        var voiced = new Uint8Array(n);
        for (i = 0; i < n; i++) voiced[i] = db[i] > noiseDb ? 1 : 0;
        var minSilFrames = Math.max(1, Math.round(minSilence * sr / hop));
        var runs = [], cur = !!voiced[0], start = 0;
        for (i = 1; i < n; i++) {
            var vv = !!voiced[i];
            if (vv !== cur) { runs.push([cur, start, i]); start = i; cur = vv; }
        }
        runs.push([cur, start, n]);
        var merged = [];
        for (var k = 0; k < runs.length; k++) {
            var r = runs[k];
            var isEdge = (k === 0 || k === runs.length - 1);
            merged.push(!r[0] && (r[2] - r[1]) < minSilFrames && !isEdge ? [true, r[1], r[2]] : [r[0], r[1], r[2]]);
        }
        var runs2 = [];
        for (k = 0; k < merged.length; k++) {
            r = merged[k];
            if (runs2.length && runs2[runs2.length - 1][0] === r[0]) runs2[runs2.length - 1][2] = r[2];
            else runs2.push([r[0], r[1], r[2]]);
        }
        var segs = [];
        for (k = 0; k < runs2.length; k++) {
            if (runs2[k][0]) segs.push([runs2[k][1] * hop, Math.min(runs2[k][2] * hop, mono.length)]);
        }
        var minSpFrames = Math.max(1, Math.round(minSpeech * sr / hop));
        var cleaned = [];
        for (k = 0; k < segs.length; k++) {
            var sg = segs[k];
            if (cleaned.length && (sg[1] - sg[0]) < minSpFrames * hop) cleaned[cleaned.length - 1][1] = sg[1];
            else cleaned.push([sg[0], sg[1]]);
        }
        return cleaned;
    }

    /* ---------- FFT（radix-2 原位） ---------- */
    function fft(re, im) {
        var n = re.length, i, j, bit, len;
        for (i = 1, j = 0; i < n; i++) {
            bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
                var t0 = re[i]; re[i] = re[j]; re[j] = t0;
                var t1 = im[i]; im[i] = im[j]; im[j] = t1;
            }
        }
        for (len = 2; len <= n; len <<= 1) {
            var ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
            for (i = 0; i < n; i += len) {
                var cwr = 1, cwi = 0;
                for (var k2 = 0; k2 < half; k2++) {
                    var a = i + k2, b = a + half;
                    var ur = re[a], ui = im[a];
                    var vr = re[b] * cwr - im[b] * cwi;
                    var vi = re[b] * cwi + im[b] * cwr;
                    re[a] = ur + vr; im[a] = ui + vi;
                    re[b] = ur - vr; im[b] = ui - vi;
                    var nwr = cwr * wr - cwi * wi;
                    cwi = cwr * wi + cwi * wr; cwr = nwr;
                }
            }
        }
    }

    /* ---------- STFT（hann，帧数封顶） ---------- */
    function stftDb(mono, sr, nfft, hop, maxFrames) {
        nfft = nfft || (sr >= 32000 ? 1024 : 512);
        hop = hop || (nfft >> 2);
        maxFrames = maxFrames || 3000;
        var nBins = (nfft >> 1) + 1;
        var total = Math.max(1, Math.floor((mono.length - nfft) / hop) + 1);
        // 超长音频：抽帧而非改 hop，保持频率分辨率
        var stride = Math.max(1, Math.ceil(total / maxFrames));
        var nFrames = Math.ceil(total / stride);
        var win = new Float32Array(nfft);
        for (var i = 0; i < nfft; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (nfft - 1));
        var mags = new Float32Array(nFrames * nBins);
        var re = new Float32Array(nfft), im = new Float32Array(nfft);
        var maxMag = 1e-10;
        for (var f = 0; f < nFrames; f++) {
            re.fill(0); im.fill(0);
            var off = f * stride * hop;
            for (i = 0; i < nfft; i++) re[i] = (mono[off + i] || 0) * win[i];
            fft(re, im);
            for (var k = 0; k < nBins; k++) {
                var m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
                mags[f * nBins + k] = m;
                if (m > maxMag) maxMag = m;
            }
        }
        var db = new Float32Array(mags.length);
        for (i = 0; i < db.length; i++) db[i] = 20 * Math.log10(mags[i] / maxMag + 1e-10);
        return { db: db, nFrames: nFrames, nBins: nBins, hop: hop * stride, stride: stride };
    }

    /* ---------- magma 色带 ---------- */
    var MAGMA = [
        [0.001462, 0.000466, 0.013866], [0.113807, 0.065491, 0.258866], [0.316754, 0.07169, 0.48538],
        [0.479566, 0.111583, 0.557518], [0.643624, 0.177427, 0.539374], [0.806483, 0.27519, 0.480689],
        [0.927017, 0.429913, 0.394767], [0.977505, 0.601438, 0.309798], [0.986417, 0.778486, 0.274767],
        [0.986736, 0.921545, 0.422388], [0.987053, 0.991438, 0.749504]
    ];
    var LUT = null;
    function buildLut() {
        LUT = new Uint8Array(256 * 3);
        for (var i = 0; i < 256; i++) {
            var x = (i / 255) * (MAGMA.length - 1), i0 = Math.floor(x), fr = x - i0;
            var a = MAGMA[i0], b = MAGMA[Math.min(i0 + 1, MAGMA.length - 1)];
            LUT[i * 3] = Math.round(255 * (a[0] + (b[0] - a[0]) * fr));
            LUT[i * 3 + 1] = Math.round(255 * (a[1] + (b[1] - a[1]) * fr));
            LUT[i * 3 + 2] = Math.round(255 * (a[2] + (b[2] - a[2]) * fr));
        }
    }

    /* 频率轴标签：>=1000 用 kHz，否则 Hz */
    function freqLabel(hz) {
        if (hz >= 1000) {
            var k = hz / 1000;
            return (k >= 10 ? Math.round(k) : Math.round(k * 10) / 10) + 'k';
        }
        return String(Math.round(hz));
    }

    /* 频率轴标签：>=1000 用 kHz，否则 Hz */
    function freqLabel(hz) {
        if (hz >= 1000) {
            var k = hz / 1000;
            return (k >= 10 ? Math.round(k) : Math.round(k * 10) / 10) + 'k';
        }
        return String(Math.round(hz));
    }

    /* ---------- 预分析：包络 + 语谱 + 气口分段，只算一次 ---------- */
    function prepare(mono, sr, opts) {
        opts = opts || {};
        var noiseDb = opts.noiseDb === undefined ? -40 : opts.noiseDb;
        return {
            dur: mono.length / sr,
            sr: sr,
            noiseDb: noiseDb,
            fmin: opts.fmin || 30,
            fmax: sr / 2,
            dbFloorSpec: opts.dbFloorSpec === undefined ? -80 : opts.dbFloorSpec,
            dbFloorWave: opts.dbFloorWave === undefined ? -100 : opts.dbFloorWave,
            env: envelopeDb(mono, sr),
            spec: stftDb(mono, sr),
            segs: detectSegments(mono, sr, noiseDb),
            scene: null
        };
    }

    /* 绘图边距：与播放条轨道严格对齐
     * 播放条 .av-tl-wrap 左右各 16px，轨道 .av-tl-ticks 再内缩 10px（半个拇指宽），
     * 所以刻度 0% 位于主区左边缘 +26px、100% 位于右边缘 -26px。
     * 波段/语谱的绘图区必须用同样的 26px，时间才能和进度条严丝合缝对上。 */
    var EDGE = 26;

    function buildScene(prep, cw, chh, dpr) {
        var mL = EDGE, mR = EDGE, mT = 10, mB = 22;
        var plotW = cw - mL - mR;
        var innerH = chh - mT - mB;
        if (plotW < 40 || innerH < 60) { plotW = Math.max(40, cw - mL - mR); innerH = Math.max(60, chh - mT - mB); }
        var waveH = Math.max(28, Math.round(innerH * 0.40));
        var specH = Math.max(24, innerH - waveH);
        var waveTop = mT, specTop = mT + waveH;
        var X = function (t) { return mL + (t / prep.dur) * plotW; };

        // 波形折线点（CSS px，一次算好，重绘只描线）
        var pts = [], i;
        for (i = 0; i < prep.env.db.length; i++) {
            var dbv = Math.max(prep.dbFloorWave, Math.min(0, prep.env.db[i]));
            pts.push({
                x: X(prep.env.times[i]),
                y: waveTop + (1 - (dbv - prep.dbFloorWave) / (0 - prep.dbFloorWave)) * waveH
            });
        }

        // 语谱位图：putImageData 不吃 transform，必须按设备像素建
        var imgW = Math.max(1, Math.round(plotW * dpr));
        var imgH = Math.max(1, Math.round(specH * dpr));
        var img = null;
        try { img = new ImageData(imgW, imgH); } catch (e) { img = null; }
        if (img && img.data) {
            var dd = img.data, sp = prep.spec, fRatio = prep.fmax / prep.fmin;
            var span = 0 - prep.dbFloorSpec;
            for (var px = 0; px < imgW; px++) {
                var frame = Math.min(sp.nFrames - 1, Math.floor((px / imgW) * sp.nFrames));
                var base = frame * sp.nBins;
                for (var py = 0; py < imgH; py++) {
                    var frac = 1 - py / imgH;
                    var freq = prep.fmin * Math.pow(fRatio, frac);
                    var bin = Math.min(sp.nBins - 1, Math.round(freq / prep.fmax * (sp.nBins - 1)));
                    var v = sp.db[base + bin];
                    var q = ((Math.max(prep.dbFloorSpec, Math.min(0, v)) - prep.dbFloorSpec) / span) * 255;
                    var li = (q | 0) * 3;
                    var o = (py * imgW + px) * 4;
                    dd[o] = LUT[li]; dd[o + 1] = LUT[li + 1]; dd[o + 2] = LUT[li + 2]; dd[o + 3] = 255;
                }
            }
        }

        // 分段线位置（CSS px）
        var segX = [];
        for (i = 0; i < prep.segs.length; i++) {
            segX.push([X(prep.segs[i][0] / prep.sr), X(prep.segs[i][1] / prep.sr)]);
        }

        return {
            cw: cw, chh: chh, dpr: dpr,
            mL: mL, mR: mR, mT: mT, mB: mB,
            plotW: plotW, innerH: innerH, waveH: waveH, specH: specH,
            waveTop: waveTop, specTop: specTop,
            X: X, pts: pts, img: img, imgW: imgW, imgH: imgH, segX: segX
        };
    }

    /* ---------- 绘制：静态层（白底/波形/语谱/标签/分段） + 播放头 ---------- */
    function render(canvas, prep, time, opts) {
        if (!canvas || !prep) return null;
        opts = opts || {};
        if (!LUT) buildLut();

        var cw = Math.max(240, Math.round(canvas.clientWidth || canvas.getBoundingClientRect().width || 320));
        var chh = Math.max(150, Math.round(canvas.clientHeight || canvas.getBoundingClientRect().height || 180));
        var dpr = Math.min(2, global.devicePixelRatio || 1);
        var sc = prep.scene;
        if (!sc || sc.cw !== cw || sc.chh !== chh || sc.dpr !== dpr) {
            sc = prep.scene = buildScene(prep, cw, chh, dpr);
        }

        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(chh * dpr);
        var ctx = canvas.getContext('2d');

        // 白底（设备像素，先 reset transform）
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 语谱位图（设备像素贴图，天然对齐）
        if (sc.img) {
            try { ctx.putImageData(sc.img, Math.round(sc.mL * dpr), Math.round(sc.specTop * dpr)); } catch (e) { }
        }

        // 以下全部用 CSS px 坐标
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        var i;

        /* 波形区：边框 + 蓝色包络 */
        ctx.strokeStyle = 'rgba(120,120,130,0.45)';
        ctx.lineWidth = 1;
        ctx.strokeRect(sc.mL + 0.5, sc.waveTop + 0.5, sc.plotW - 1, sc.waveH - 1);
        if (sc.pts.length > 1) {
            ctx.strokeStyle = '#2E86C1';
            ctx.lineWidth = 1.2;
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(sc.pts[0].x, sc.pts[0].y);
            for (i = 1; i < sc.pts.length; i++) ctx.lineTo(sc.pts[i].x, sc.pts[i].y);
            ctx.stroke();
        }

        /* 气口阈值线（红点线） */
        var thY = sc.waveTop + (1 - (prep.noiseDb - prep.dbFloorWave) / (0 - prep.dbFloorWave)) * sc.waveH;
        ctx.strokeStyle = 'rgba(231,76,60,0.85)';
        ctx.setLineDash([2, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sc.mL, thY); ctx.lineTo(sc.mL + sc.plotW, thY); ctx.stroke();
        ctx.setLineDash([]);

        /* 语音段：绿虚线贯穿波形区 + 编号 */
        ctx.strokeStyle = 'rgba(39,174,96,0.75)';
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1;
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        for (i = 0; i < sc.segX.length; i++) {
            var x1 = sc.segX[i][0], x2 = sc.segX[i][1];
            ctx.beginPath(); ctx.moveTo(x1, sc.waveTop); ctx.lineTo(x1, sc.waveTop + sc.waveH); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x2, sc.waveTop); ctx.lineTo(x2, sc.waveTop + sc.waveH); ctx.stroke();
            if (x2 - x1 > 15) {
                ctx.fillStyle = '#1E8449';
                ctx.fillText(String(i + 1), (x1 + x2) / 2, sc.waveTop + 13);
            }
        }
        ctx.setLineDash([]);

        /* 语谱区段线（实线） */
        ctx.strokeStyle = 'rgba(39,174,96,0.85)';
        ctx.lineWidth = 1;
        for (i = 0; i < sc.segX.length; i++) {
            var xa = sc.segX[i][0], xb = sc.segX[i][1];
            ctx.beginPath(); ctx.moveTo(xa, sc.specTop); ctx.lineTo(xa, sc.specTop + sc.specH); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(xb, sc.specTop); ctx.lineTo(xb, sc.specTop + sc.specH); ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(120,120,130,0.45)';
        ctx.strokeRect(sc.mL + 0.5, sc.specTop + 0.5, sc.plotW - 1, sc.specH - 1);

        /* 坐标标签：全部贴在绘图区内部，外面不再留白，才能和进度条对齐 */
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 2.4;
        var topLbl = freqLabel(prep.fmax), botLbl = freqLabel(prep.fmin);
        ctx.strokeText(topLbl, sc.mL + 4, sc.specTop + 11);
        ctx.fillText(topLbl, sc.mL + 4, sc.specTop + 11);
        ctx.strokeText(botLbl, sc.mL + 4, sc.specTop + sc.specH - 3);
        ctx.fillText(botLbl, sc.mL + 4, sc.specTop + sc.specH - 3);

        /* 时间轴刻度（与进度条同一 X 映射） */
        ctx.textAlign = 'center';
        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#7a7a84';
        var nTicks = prep.dur < 4 ? 4 : (prep.dur < 12 ? 6 : 8);
        for (var tk = 0; tk <= nTicks; tk++) {
            var tt = prep.dur * tk / nTicks;
            var tx = sc.mL + (tt / prep.dur) * sc.plotW;
            ctx.fillText(tt.toFixed(prep.dur < 10 ? 1 : 0) + 's', tx, sc.chh - 6);
        }

        /* 播放头 */
        if (time != null && isFinite(time) && prep.dur > 0) {
            var hp = sc.mL + Math.max(0, Math.min(time, prep.dur)) / prep.dur * sc.plotW;
            ctx.strokeStyle = 'rgba(255,86,86,0.95)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(hp, sc.waveTop);
            ctx.lineTo(hp, sc.specTop + sc.specH);
            ctx.stroke();
            ctx.fillStyle = 'rgba(255,86,86,0.95)';
            ctx.beginPath();
            ctx.moveTo(hp - 4.5, sc.waveTop - 1);
            ctx.lineTo(hp + 4.5, sc.waveTop - 1);
            ctx.lineTo(hp, sc.waveTop + 5);
            ctx.closePath();
            ctx.fill();
        }
        return sc;
    }

    /* 兼容旧接口：一次画完（无缓存） */
    function drawViz(canvas, mono, sr, opts) {
        var prep = prepare(mono, sr, opts);
        render(canvas, prep, (opts && opts.time) || null, opts);
        return { segs: prep.segs, dur: prep.dur, prep: prep };
    }

    global.AudioViz = {
        decodeMono: decodeMono,
        envelopeDb: envelopeDb,
        detectSegments: detectSegments,
        stftDb: stftDb,
        prepare: prepare,
        render: render,
        drawViz: drawViz,
        freqLabel: freqLabel
    };
})(typeof window !== 'undefined' ? window : globalThis);
