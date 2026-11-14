package com.sinigli.supersplat;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.DocumentsContract;

import androidx.activity.result.ActivityResult;

import com.arthenica.ffmpegkit.FFmpegKit;
import com.arthenica.ffmpegkit.FFmpegSession;
import com.arthenica.ffmpegkit.ReturnCode;
import com.arthenica.ffmpegkit.Statistics;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * v68 MediaTranscodePlugin — 10bit H.264 素材的本机转码（ffmpeg-kit + MediaCodec）
 *
 * 背景（2026-11-14 真机日志）：老板的 94 个分镜片段全部是 H.264 High 10 /
 * yuv420p10le / 3840x2160。Android 硬件 AVC 解码器只保证 Baseline/Main/High(8bit)，
 * MediaCodec 直接拒绝 → WebView <video> 报 MEDIA_ERR_SRC_NOT_SUPPORTED (code=4)，
 * 连 42KB / 1 秒的片段也放不出来（所以不是性能或网络问题）。
 *
 * 两条路：
 *   1. probeCodec  只读探测，明确告诉 JS「这段是 10bit，本机解不了」，避免反复重试
 *   2. transcode   真转码：ffmpeg 软件 H.264 解码（能吃 10bit）→ MediaCodec 硬件
 *                  H.264 编码（8bit）→ 写进同目录下的 8bit/ 子文件夹
 *
 * 为什么用 ffmpeg-kit-video（LGPL）而不是 min-gpl（GPL）：
 *   - libx264 是 GPL，打进商业包要整包开源；MediaCodec 硬编没有这个约束
 *   - video 变体自带 h264/hevc 解码器源码 + mp4 复用器 + swscale，够用
 *   - 只保留 arm64-v8a（abiFilters），体积 20.3MB
 *
 * 输出位置：为什么写 8bit/ 子目录而不是原地替换
 *   原地替换等于销毁原始素材，且 SAF 覆盖写要看 provider 脸色；新建子目录
 *   既不动原文件，也能让老板直接把该目录当工程目录打开。
 */
@CapacitorPlugin(name = "MediaTranscode")
public class MediaTranscodePlugin extends Plugin {

    private static final int BUF = 1 << 16;
    /** 8bit 输出子目录名 */
    private static final String OUT_DIR = "8bit";

    /** name → SAF document URI（由 JS 传 uri 时填充；transcode 只认已登记的名字） */
    private final Map<String, Uri> index = new ConcurrentHashMap<>();
    private volatile Uri treeUri;
    private final AtomicInteger running = new AtomicInteger(0);
    private volatile String cancelFlag = null;

    private ContentResolver cr() { return getContext().getContentResolver(); }
    private Activity act() { return getActivity(); }

    /* ===================== 0) 写权限 ===================== */

    /**
     * pickWriteFolder() — 重新选一次同一个目录，这次要读+写。
     *
     * 为什么必须重选：v45 的 pickFolder 只申请了 FLAG_GRANT_READ_URI_PERMISSION，
     * 已持久化的 tree 上没有任何写权限，DocumentsContract.createDocument 必失败。
     * Android 的 SAF 授权是「按 grant 记」的，不能事后追加，只能重新走一次选择器。
     * JS 侧拿到返回的 uri 后覆盖 meta.folderUri 即可（同一个目录，路径不变）。
     */
    @PluginMethod
    public void pickWriteFolder(PluginCall call) {
        Activity activity = act();
        if (activity == null) { call.reject("Activity 不可用"); return; }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "pickWriteFolderResult");
    }

    @ActivityCallback
    private void pickWriteFolderResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK
                || result.getData() == null || result.getData().getData() == null) {
            call.resolve();      // 用户取消：null（JS 侧不当作错误）
            return;
        }
        Uri uri = result.getData().getData();
        boolean wrote = false;
        try {
            cr().takePersistableUriPermission(uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            wrote = true;
        } catch (Exception ignore) { }
        this.treeUri = uri;
        index.clear();           // 换了授权，旧索引可能失效
        JSObject ret = new JSObject();
        ret.put("uri", uri.toString());
        ret.put("writable", wrote);
        call.resolve(ret);
    }

    /* ===================== 1) 探测 ===================== */

    /**
     * probeCodec({uri}) — 读容器轨道信息，判断能不能被硬件解码器吃下。
     * uri 可以是 tree（目录）也可以是 document（单文件）。
     *
     * 返回：{ok, codec, width, height, fps, profile, profileName, bitDepth, decodable}
     *   decodable=false 时 JS 直接给明白话，不再让 <video> 去撞 code=4
     */
    @PluginMethod
    public void probeCodec(PluginCall call) {
        String uriStr = call.getString("uri");
        String name = call.getString("name");
        if (uriStr == null || uriStr.isEmpty()) { call.reject("缺 uri"); return; }
        Uri doc;
        try {
            doc = resolveDoc(uriStr, name);
        } catch (Exception e) {
            call.reject("定位文件失败: " + e.getMessage());
            return;
        }
        MediaExtractor ex = new MediaExtractor();
        android.os.ParcelFileDescriptor pfd = null;
        try {
            pfd = cr().openFileDescriptor(doc, "r");
            if (pfd == null) { call.reject("文件不可读"); return; }
            ex.setDataSource(pfd.getFileDescriptor());

            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("profile", -1);
            res.put("profileName", "unknown");
            res.put("bitDepth", 8);
            res.put("decodable", true);

            int n = ex.getTrackCount();
            for (int i = 0; i < n; i++) {
                MediaFormat f = ex.getTrackFormat(i);
                String mime = f.getString(MediaFormat.KEY_MIME);
                if (mime == null || !mime.startsWith("video/")) continue;

                res.put("ok", true);
                res.put("codec", mime);
                if (f.containsKey(MediaFormat.KEY_WIDTH)) res.put("width", f.getInteger(MediaFormat.KEY_WIDTH));
                if (f.containsKey(MediaFormat.KEY_HEIGHT)) res.put("height", f.getInteger(MediaFormat.KEY_HEIGHT));
                if (f.containsKey("rotation-degrees")) res.put("rotation", f.getInteger("rotation-degrees"));

                /* profile：MediaFormat 用的是 MediaCodecInfo.CodecProfileLevel 常量，
                 * 不是码流里的 profile_idc。High10 = 0x10 = 16。 */
                int profile = -1;
                try {
                    if (f.containsKey(MediaFormat.KEY_PROFILE)) profile = f.getInteger(MediaFormat.KEY_PROFILE);
                } catch (Exception ignore) { }

                /* bit-depth：API 24+ 才有；拿不到就按 profile 推断 */
                int bitDepth = 8;
                try {
                    if (f.containsKey("bit-depth")) bitDepth = f.getInteger("bit-depth");
                } catch (Exception ignore) { }

                String profileName = profileNameOf(profile, bitDepth);
                if (bitDepth == 8 && (profile == 0x10 || profile == 0x20 || profile == 0x40)) bitDepth = 10;
                if (profile == 0x20) bitDepth = 10;

                res.put("profile", profile);
                res.put("profileName", profileName);
                res.put("bitDepth", bitDepth);

                /* 10bit / 4:2:2 / 4:4:4 的 AVC 不在 Android 要求的 profile 集合里 */
                boolean decodable = !(profile == 0x10 || profile == 0x20 || profile == 0x40) && bitDepth <= 8;
                res.put("decodable", decodable);

                /* 时长/帧率顺带给出，省一次 probeMeta */
                if (f.containsKey(MediaFormat.KEY_DURATION)) {
                    res.put("durationMs", f.getLong(MediaFormat.KEY_DURATION) / 1000);
                }
                if (f.containsKey(MediaFormat.KEY_FRAME_RATE)) {
                    try { res.put("fps", f.getInteger(MediaFormat.KEY_FRAME_RATE)); }
                    catch (Exception ce) { res.put("fps", f.getFloat(MediaFormat.KEY_FRAME_RATE)); }
                }
                break;
            }
            call.resolve(res);
        } catch (Exception e) {
            call.reject("probeCodec 失败: " + e.getMessage());
        } finally {
            try { ex.release(); } catch (Exception ignored) { }
            try { if (pfd != null) pfd.close(); } catch (Exception ignored) { }
        }
    }

    private String profileNameOf(int profile, int bitDepth) {
        switch (profile) {
            case 0x01: return "Baseline";
            case 0x02: return "Main";
            case 0x04: return "Extended";
            case 0x08: return "High";
            case 0x10: return "High 10";
            case 0x20: return "High 4:2:2";
            case 0x40: return "High 4:4:4";
            default: return bitDepth > 8 ? ("High " + bitDepth + "bit") : "unknown";
        }
    }

    /* ===================== 2) 转码 ===================== */

    /**
     * transcode({treeUri, name}) — 单文件转 8bit，输出到 <tree>/8bit/<同名>
     *
     * 流程（全程不碰原文件）：
     *   SAF 原文件 → 缓存临时文件 → ffmpeg 转 → 缓存结果 → createDocument 写回
     *
     * 返回：{ok, path, name, outBytes, ms, log}
     * 需要写权限但没拿到时返回 {ok:false, needWrite:true}
     */
    @PluginMethod
    public void transcode(final PluginCall call) {
        String treeStr = call.getString("treeUri");
        String name = call.getString("name");
        if (treeStr == null || treeStr.isEmpty() || name == null || name.isEmpty()) {
            call.reject("缺 treeUri / name");
            return;
        }

        final Activity activity = act();
        if (activity == null) { call.reject("Activity 不可用"); return; }

        final Uri tree = Uri.parse(treeStr);
        this.treeUri = tree;

        running.incrementAndGet();
        new Thread(new Runnable() {
            @Override
            public void run() {
                long t0 = android.os.SystemClock.elapsedRealtime();
                File tmpIn = null, tmpOut = null;
                try {
                    /* 1) 找原文件 */
                    Uri doc = resolveDocInTree(tree, name);
                    if (doc == null) { failOnUi(call, "文件不在已授权目录: " + name); return; }

                    /* 2) 拷到缓存（ffmpeg 只吃普通文件路径，SAF 的 fd 它读不了） */
                    tmpIn = new File(getContext().getCacheDir(), "tx_in_" + System.nanoTime() + ".mp4");
                    if (!copyDocToFile(doc, tmpIn)) { failOnUi(call, "原文件读取失败"); return; }

                    /* 3) 输出目录：<tree>/8bit/ */
                    Uri outDir = ensureSubDir(tree, OUT_DIR);
                    if (outDir == null) {
                        JSObject r = new JSObject();
                        r.put("ok", false);
                        r.put("needWrite", true);
                        resolveOnUi(call, r);
                        return;
                    }
                    String outName = baseNameOf(name) + ".mp4";
                    Uri outDoc = createFileInDir(outDir, "video/mp4", outName);
                    if (outDoc == null) {
                        JSObject r = new JSObject();
                        r.put("ok", false);
                        r.put("needWrite", true);
                        resolveOnUi(call, r);
                        return;
                    }

                    /* 4) 转码：软件解码 10bit → 硬件编码 8bit */
                    tmpOut = new File(getContext().getCacheDir(), "tx_out_" + System.nanoTime() + ".mp4");
                    /* 两级尝试：先原尺寸硬件编码；设备不吃 4K 硬编时降到 1080p 再来一次。
                     * 为什么只有硬件这条路：ffmpeg-kit-video（LGPL）没编进 libx264
                     * （那是 GPL），8bit H.264 软件编码器不可用。
                     * 为什么必须先解成 8bit：源是 High 10 / yuv420p10le，硬编只吃 8bit。 */
                    final String[][] attempts = new String[][]{
                            {
                                    "-y", "-i", tmpIn.getAbsolutePath(),
                                    "-c:v", "h264_mediacodec",
                                    "-pix_fmt", "yuv420p",
                                    "-b:v", "6M",
                                    "-c:a", "aac", "-b:a", "128k",
                                    "-movflags", "+faststart",
                                    "-f", "mp4", tmpOut.getAbsolutePath()
                            },
                            {
                                    "-y", "-i", tmpIn.getAbsolutePath(),
                                    "-vf", "scale=1920:-2",
                                    "-c:v", "h264_mediacodec",
                                    "-pix_fmt", "yuv420p",
                                    "-b:v", "3M",
                                    "-c:a", "aac", "-b:a", "128k",
                                    "-movflags", "+faststart",
                                    "-f", "mp4", tmpOut.getAbsolutePath()
                            }
                    };

                    final long totalMs = call.getLong("totalMs") != null ? call.getLong("totalMs") : 0L;
                    String lastErr = null;
                    boolean produced = false;

                    for (int ai = 0; ai < attempts.length && !produced; ai++) {
                        if (ai > 0) {
                            /* 上一轮失败：清掉半成品，换 1080p 重来 */
                            try { if (tmpOut.exists()) tmpOut.delete(); } catch (Exception ignore) { }
                            JSObject p = new JSObject();
                            p.put("pct", 0);
                            p.put("retry", ai);
                            notifyListeners("progress", p, true);
                        }

                        final long[] lastTick = {0L};
                        final int[] lastPct = {-1};
                        FFmpegSession session = FFmpegKit.executeAsync(attempts[ai], null, null,
                                new com.arthenica.ffmpegkit.StatisticsCallback() {
                                    @Override
                                    public void apply(Statistics st) {
                                        try {
                                            long now = android.os.SystemClock.elapsedRealtime();
                                            if (now - lastTick[0] < 400) return;   // 节流，别把桥刷爆
                                            lastTick[0] = now;
                                            int pct = estimatePct(st, totalMs);
                                            if (pct < 0 || pct == lastPct[0]) return;
                                            lastPct[0] = pct;
                                            /* 进度推到 JS（不 resolve call，只发事件） */
                                            JSObject p = new JSObject();
                                            p.put("pct", pct);
                                            p.put("frame", st.getVideoFrameNumber());
                                            p.put("timeMs", (long) st.getTime());
                                            p.put("speed", st.getSpeed());
                                            notifyListeners("progress", p, true);
                                        } catch (Exception ignore) { }
                                    }
                                });

                        /* 5) 等完成：SessionState 只是普通 enum（没有 isCompleted 便捷方法），
                         * 直接比枚举值最稳。 */
                        long deadline = android.os.SystemClock.elapsedRealtime() + 15 * 60 * 1000L;
                        boolean timedOut = false;
                        while (true) {
                            com.arthenica.ffmpegkit.SessionState st = session.getState();
                            if (st == com.arthenica.ffmpegkit.SessionState.COMPLETED
                                    || st == com.arthenica.ffmpegkit.SessionState.FAILED) break;
                            if (android.os.SystemClock.elapsedRealtime() > deadline) {
                                try { FFmpegKit.cancel(session.getSessionId()); } catch (Exception ignore) { }
                                timedOut = true;
                                break;
                            }
                            if (cancelFlag != null && cancelFlag.equals(name)) {
                                try { FFmpegKit.cancel(session.getSessionId()); } catch (Exception ignore) { }
                                cancelFlag = null;
                                JSObject r = new JSObject();
                                r.put("ok", false);
                                r.put("cancelled", true);
                                resolveOnUi(call, r);
                                return;
                            }
                            Thread.sleep(300);
                        }

                        if (timedOut) { lastErr = "超时（15 分钟）"; continue; }

                        ReturnCode rc = session.getReturnCode();
                        if (rc != null && ReturnCode.isSuccess(rc)
                                && tmpOut.exists() && tmpOut.length() > 0) {
                            produced = true;
                            break;
                        }
                        String out = safeOutput(session);
                        lastErr = (rc == null ? "unknown" : rc.toString()) +
                                (out != null ? " | " + tail(out, 240) : "");
                    }

                    if (!produced) {
                        failOnUi(call, "转码失败：" + (lastErr == null ? "未知原因" : lastErr));
                        return;
                    }

                    /* 6) 写回 SAF */
                    OutputStream os = cr().openOutputStream(outDoc, "w");
                    if (os == null) { failOnUi(call, "输出文件不可写"); return; }
                    copyFileToStream(tmpOut, os);
                    os.close();

                    long ms = android.os.SystemClock.elapsedRealtime() - t0;
                    JSObject r = new JSObject();
                    r.put("ok", true);
                    r.put("name", outName);
                    r.put("path", OUT_DIR + "/" + outName);
                    r.put("outBytes", tmpOut.length());
                    r.put("ms", ms);
                    resolveOnUi(call, r);
                } catch (Exception e) {
                    failOnUi(call, "转码异常: " + (e.getMessage() != null ? e.getMessage() : e.toString()));
                } finally {
                    try { if (tmpIn != null) tmpIn.delete(); } catch (Exception ignore) { }
                    try { if (tmpOut != null) tmpOut.delete(); } catch (Exception ignore) { }
                    running.decrementAndGet();
                }
            }
        }, "moyutai-transcode").start();
    }

    /** cancel({name}) — 只取消当前这一个（视频转码不可并发，够用） */
    @PluginMethod
    public void cancel(PluginCall call) {
        cancelFlag = call.getString("name");
        JSObject r = new JSObject();
        r.put("ok", true);
        call.resolve(r);
    }

    /** status() — 是否有任务在跑（JS 侧切页面时用来决定要不要拦） */
    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("running", running.get());
        /* minSdk 23：String.join 是 API 26+，老机上直接 NoSuchMethodError。
         * 自己拼，别为了一行日志抬高 minSdk。 */
        StringBuilder abis = new StringBuilder();
        for (String a : android.os.Build.SUPPORTED_64_BIT_ABIS) {
            if (abis.length() > 0) abis.append(',');
            abis.append(a);
        }
        r.put("abi", abis.toString());
        try {
            r.put("ffmpegLoaded", true);
        } catch (Exception e) {
            r.put("ffmpegLoaded", false);
        }
        call.resolve(r);
    }

    /* ===================== 工具 ===================== */

    private void resolveOnUi(final PluginCall call, final JSObject r) {
        Activity a = act();
        if (a == null) { call.resolve(r); return; }
        a.runOnUiThread(new Runnable() {
            @Override public void run() { call.resolve(r); }
        });
    }

    private void failOnUi(final PluginCall call, final String msg) {
        Activity a = act();
        if (a == null) { call.reject(msg); return; }
        a.runOnUiThread(new Runnable() {
            @Override public void run() { call.reject(msg); }
        });
    }

    /** uri 可能是目录（tree）也可能是单文件；name 给定时在目录里找 */
    private Uri resolveDoc(String uriStr, String name) throws Exception {
        Uri u = Uri.parse(uriStr);
        if (name == null || name.isEmpty()) {
            return u;
        }
        if (DocumentsContract.isTreeUri(u)) return resolveDocInTree(u, name);
        // 已经是文件 URI 但有 name：仍然按 document 用
        return u;
    }

    private Uri resolveDocInTree(Uri tree, String name) {
        Uri cached = index.get(name);
        if (cached != null) return cached;
        String docId = DocumentsContract.getTreeDocumentId(tree);
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId);
        Cursor c = null;
        try {
            c = cr().query(childrenUri, new String[]{
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME
            }, null, null, null);
            if (c != null) {
                while (c.moveToNext()) {
                    String childId = c.getString(0);
                    String childName = c.getString(1);
                    Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, childId);
                    if (childName != null) index.put(childName, doc);
                    if (childName != null && childName.equals(name)) return doc;
                }
            }
        } catch (Exception e) {
            /* 授权失效 → 让上层报错 */
        } finally {
            if (c != null) try { c.close(); } catch (Exception ignore) { }
        }
        return index.get(name);
    }

    private boolean copyDocToFile(Uri doc, File out) throws Exception {
        InputStream in = cr().openInputStream(doc);
        if (in == null) return false;
        FileOutputStream fos = new FileOutputStream(out);
        byte[] buf = new byte[BUF];
        int n;
        long total = 0;
        try {
            while ((n = in.read(buf)) > 0) {
                fos.write(buf, 0, n);
                total += n;
                if (total > 4L * 1024 * 1024 * 1024L) throw new Exception("文件超过 4GB");
            }
        } finally {
            try { in.close(); } catch (Exception ignore) { }
            try { fos.close(); } catch (Exception ignore) { }
        }
        return out.length() > 0;
    }

    private void copyFileToStream(File f, OutputStream os) throws Exception {
        FileInputStream fis = new FileInputStream(f);
        byte[] buf = new byte[BUF];
        int n;
        try {
            while ((n = fis.read(buf)) > 0) os.write(buf, 0, n);
            os.flush();
        } finally {
            try { fis.close(); } catch (Exception ignore) { }
        }
    }

    /** 在 tree 根下建（或复用）一个子目录，返回该子目录的 document URI */
    private Uri ensureSubDir(Uri tree, String dirName) {
        try {
            Uri rootDoc = DocumentsContract.buildDocumentUriUsingTree(tree,
                    DocumentsContract.getTreeDocumentId(tree));

            /* 先看有没有 */
            String rootId = DocumentsContract.getDocumentId(rootDoc);
            Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, rootId);
            Cursor c = null;
            try {
                c = cr().query(childrenUri, new String[]{
                        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                        DocumentsContract.Document.COLUMN_MIME_TYPE
                }, null, null, null);
                if (c != null) {
                    while (c.moveToNext()) {
                        String dn = c.getString(1);
                        String mime = c.getString(2);
                        if (dn != null && dn.equals(dirName) && mime != null &&
                                mime.startsWith("vnd.android.document/directory")) {
                            return DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0));
                        }
                    }
                }
            } finally {
                if (c != null) try { c.close(); } catch (Exception ignore) { }
            }

            /* 没有就建 */
            Uri created = DocumentsContract.createDocument(cr(), rootDoc,
                    DocumentsContract.Document.MIME_TYPE_DIR, dirName);
            return created;
        } catch (Exception e) {
            return null;
        }
    }

    private Uri createFileInDir(Uri dirDoc, String mime, String displayName) {
        try {
            return DocumentsContract.createDocument(cr(), dirDoc, mime, displayName);
        } catch (Exception e) {
            /* 同名已存在：DocumentsContract 会抛 IllegalStateException，删掉重建 */
            try {
                Uri existing = findInDir(dirDoc, displayName);
                if (existing != null) {
                    DocumentsContract.deleteDocument(cr(), existing);
                    return DocumentsContract.createDocument(cr(), dirDoc, mime, displayName);
                }
            } catch (Exception e2) { }
            return null;
        }
    }

    private Uri findInDir(Uri dirDoc, String displayName) {
        try {
            String dirId = DocumentsContract.getDocumentId(dirDoc);
            Uri tree = this.treeUri;
            if (tree == null) return null;
            Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, dirId);
            Cursor c = cr().query(childrenUri, new String[]{
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME
            }, null, null, null);
            if (c == null) return null;
            try {
                while (c.moveToNext()) {
                    if (displayName.equals(c.getString(1))) {
                        return DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0));
                    }
                }
            } finally { c.close(); }
        } catch (Exception e) { }
        return null;
    }

    private String baseNameOf(String name) {
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        return base + "_8bit";
    }

    private String safeOutput(FFmpegSession s) {
        try {
            String o = s.getOutput();
            return o;
        } catch (Exception e) { return null; }
    }
    private String tail(String s, int n) {
        if (s == null) return "";
        s = s.replace('\n', ' ').trim();
        return s.length() <= n ? s : s.substring(s.length() - n);
    }

    /** 估进度：Statistics.getTime() 是已处理视频时间（毫秒），除以总时长即可 */
    private int estimatePct(Statistics st, long totalMs) {
        try {
            if (totalMs <= 0) return -1;
            long t = (long) st.getTime();
            int pct = (int) Math.min(99, Math.max(0, (t * 100.0 / totalMs)));
            return pct;
        } catch (Exception e) { return -1; }
    }
}
