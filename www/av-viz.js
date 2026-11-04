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

    /* ---------- 绘制 ---------- */
    function drawViz(canvas, mono, sr, opts) {
        opts = opts || {};
        if (!LUT) buildLut();
        var noiseDb = opts.noiseDb === undefined ? -40 : opts.noiseDb;
        var segs = detectSegments(mono, sr, noiseDb);
        var dur = mono.length / sr;
        var env = envelopeDb(mono, sr);
        var spec = stftDb(mono, sr);
        var fmin = 30, fmax = sr / 2;
        var dbFloorSpec = -80, dbFloorWave = -100;

        var dpr = Math.min(2, global.devicePixelRatio || 1);
        var cw = Math.max(320, canvas.clientWidth || 320);
        var chh = Math.max(180, canvas.clientHeight || 180);
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(chh * dpr);
        var ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        var W = cw, H = chh;
        var mL = 52, mR = 12, mT = 14, mB = 22;
        var plotW = W - mL - mR;
        var innerH = H - mT - mB;
        var waveH = Math.round(innerH * 0.40), specH = innerH - waveH;
        var waveTop = mT, specTop = mT + waveH;
        var X = function (t) { return mL + (t / dur) * plotW; };

        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);

        /* --- 波形行 --- */
        ctx.strokeStyle = '#d8d8d8'; ctx.lineWidth = 1;
        ctx.strokeRect(mL, waveTop, plotW, waveH);
        ctx.strokeStyle = '#2E86C1'; ctx.lineWidth = 1.2; ctx.beginPath();
        for (var i = 0; i < env.db.length; i++) {
            var dbv = Math.max(dbFloorWave, Math.min(0, env.db[i]));
            var px = X(env.times[i]);
            var py = waveTop + (1 - (dbv - dbFloorWave) / (0 - dbFloorWave)) * waveH;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
        // 气口阈值红线
        ctx.strokeStyle = '#E74C3C'; ctx.setLineDash([2, 3]); ctx.lineWidth = 1; ctx.beginPath();
        var thY = waveTop + (1 - (noiseDb - dbFloorWave) / (0 - dbFloorWave)) * waveH;
        ctx.moveTo(mL, thY); ctx.lineTo(mL + plotW, thY); ctx.stroke(); ctx.setLineDash([]);
        // 语音段：绿虚线 + 编号
        ctx.strokeStyle = '#27AE60'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
        ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
        for (var s0 = 0; s0 < segs.length; s0++) {
            var x1 = X(segs[s0][0] / sr), x2 = X(segs[s0][1] / sr);
            ctx.beginPath(); ctx.moveTo(x1, waveTop); ctx.lineTo(x1, waveTop + waveH); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x2, waveTop); ctx.lineTo(x2, waveTop + waveH); ctx.stroke();
            if (x2 - x1 > 14) { ctx.fillStyle = '#1E8449'; ctx.fillText(String(s0 + 1), (x1 + x2) / 2, waveTop + 13); }
        }
        ctx.setLineDash([]);
        ctx.fillStyle = '#777777'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
        ctx.fillText('0', mL - 5, waveTop + 9);
        ctx.fillText('-100', mL - 5, waveTop + waveH);

        /* --- 语谱行 --- */
        ctx.strokeStyle = '#d8d8d8'; ctx.strokeRect(mL, specTop, plotW, specH);
        var img = ctx.createImageData(plotW, specH);
        var dd = img.data;
        var fRatio = fmax / fmin;
        for (var px2 = 0; px2 < plotW; px2++) {
            var frame = Math.min(spec.nFrames - 1, Math.floor((px2 / plotW) * spec.nFrames));
            var base = frame * spec.nBins;
            for (var py2 = 0; py2 < specH; py2++) {
                var frac = 1 - py2 / specH;
                var freq = fmin * Math.pow(fRatio, frac);
                var bin = Math.min(spec.nBins - 1, Math.round(freq / fmax * (spec.nBins - 1)));
                var v = spec.db[base + bin];
                var q = ((Math.max(dbFloorSpec, Math.min(0, v)) - dbFloorSpec) / (0 - dbFloorSpec)) * 255;
                var li = (q | 0) * 3;
                var idx = (py2 * plotW + px2) * 4;
                dd[idx] = LUT[li]; dd[idx + 1] = LUT[li + 1]; dd[idx + 2] = LUT[li + 2]; dd[idx + 3] = 255;
            }
        }
        ctx.putImageData(img, mL, specTop);
        // 语谱行的段线（实线，便于读数）
        ctx.strokeStyle = 'rgba(39,174,96,0.85)'; ctx.lineWidth = 1;
        for (s0 = 0; s0 < segs.length; s0++) {
            var xa = X(segs[s0][0] / sr), xb = X(segs[s0][1] / sr);
            ctx.beginPath(); ctx.moveTo(xa, specTop); ctx.lineTo(xa, specTop + specH); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(xb, specTop); ctx.lineTo(xb, specTop + specH); ctx.stroke();
        }
        ctx.fillStyle = '#777777'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(freqLabel(fmax), mL - 5, specTop + 10);
        ctx.fillText(freqLabel(fmin), mL - 5, specTop + specH);

        /* --- 时间轴 --- */
        ctx.fillStyle = '#666666'; ctx.textAlign = 'center';
        var nTicks = dur < 4 ? 4 : (dur < 12 ? 6 : 8);
        for (var tk = 0; tk <= nTicks; tk++) {
            var t = dur * tk / nTicks;
            ctx.fillText(t.toFixed(dur < 10 ? 1 : 0) + 's', X(t), H - 6);
        }
        return { segs: segs, dur: dur };
    }

    global.AudioViz = {
        decodeMono: decodeMono,
        envelopeDb: envelopeDb,
        detectSegments: detectSegments,
        stftDb: stftDb,
        drawViz: drawViz
    };
})(typeof window !== 'undefined' ? window : globalThis);
