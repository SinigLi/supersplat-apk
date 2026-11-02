package com.sinigli.supersplat;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.provider.OpenableColumns;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.apache.commons.compress.archivers.sevenz.SevenZArchiveEntry;
import org.apache.commons.compress.archivers.sevenz.SevenZFile;
import org.apache.commons.compress.archivers.zip.ZipArchiveEntry;
import org.apache.commons.compress.archivers.zip.ZipArchiveInputStream;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * v44 ExtractPlugin — 摸鱼台解压中心（原生层）
 *
 * pick():     SAF 文件选择器（可多选分卷），返回 [{uri,name}]
 * extract():  后台线程执行；分卷按名称序拼接 → 7z/zip 解压 →
 *             Download/摸鱼台/<名>[_expN]/（MediaStore Downloads，任何文件管理器可见）
 *             事件：progress {phase,done,total,pct} / done {dest,files,bytes,volumes} / error {message}
 *
 * 决策记录（2026-11-02）：
 * - 解压库走原生 commons-compress（方案文档 P0 预研的回退路径直接启用：wasm 方案 100MB 级
 *   分卷在 WebView 内存/速度不可控，原生流式落盘稳妥）
 * - 目标目录：MediaStore Downloads（API29+，本机 API≥29）。老板 Q2 接受的兜底目录
 *   落位调整为 Download/摸鱼台/<名>——zip 内容多为任意类型文件，相册（Pictures）目录
 *   不适合，Download 任何文件管理器都可见；如需改回一行 RELATIVE_PATH 即可
 * - _exp 冲突：对自家已解压条目按 RELATIVE_PATH 前缀查询判定（MediaStore 无读权限时
 *   只能看到本应用条目，行为正确）
 * - 不支持 rar：明确报错（老板确认）
 */
@CapacitorPlugin(name = "Extract")
public class ExtractPlugin extends Plugin {

    private static final int REQ_PICK = 4401;
    private static final int BUF = 1 << 16;
    private static final String ROOT_DIR = "Download/摸鱼台/";

    private PluginCall pendingPick;

    /* ---------- 选文件 ---------- */
    @PluginMethod
    public void pick(PluginCall call) {
        pendingPick = call;
        Activity act = bridge.getActivity();
        Intent it = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        it.addCategory(Intent.CATEGORY_OPENABLE);
        it.setType("*/*");
        it.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        it.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                "application/zip", "application/x-zip-compressed", "application/x-7z-compressed",
                "application/octet-stream"});
        try {
            startActivityForResult(call, it, REQ_PICK);
        } catch (Exception e) {
            pendingPick = null;
            call.reject("no file picker: " + e.getMessage());
        }
    }

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_PICK || pendingPick == null) return;
        PluginCall call = pendingPick;
        pendingPick = null;
        Context ctx = getContext();
        List<JSObject> files = new ArrayList<>();
        if (resultCode == Activity.RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                for (int i = 0; i < data.getClipData().getItemCount(); i++) {
                    Uri u = data.getClipData().getItemAt(i).getUri();
                    files.add(fileInfo(ctx, u));
                }
            } else if (data.getData() != null) {
                files.add(fileInfo(ctx, data.getData()));
            }
        }
        JSObject res = new JSObject();
        JSArray arr = new JSArray();
        for (JSObject f : files) arr.put(f);
        res.put("files", arr);
        call.resolve(res);
    }

    private static JSObject fileInfo(Context ctx, Uri u) {
        JSObject f = new JSObject();
        f.put("uri", u.toString());
        f.put("name", displayName(ctx, u));
        f.put("size", sizeOf(ctx.getContentResolver(), u));
        return f;
    }

    private static String displayName(Context ctx, Uri uri) {
        try (Cursor c = ctx.getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0) {
                    String n = c.getString(i);
                    if (n != null && !n.isEmpty()) return n;
                }
            }
        } catch (Exception ignore) { }
        String p = uri.getLastPathSegment();
        return p == null ? "archive" : p;
    }

    private static long sizeOf(ContentResolver cr, Uri uri) {
        try (Cursor c = cr.query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.SIZE);
                if (i >= 0) return c.getLong(i);
            }
        } catch (Exception ignore) { }
        return 0;
    }

    /* ---------- 解压 ---------- */
    @PluginMethod
    public void extract(PluginCall call) {
        List<String> uris = new ArrayList<>();
        try {
            JSArray arr = call.getArray("uris");
            if (arr != null) for (int i = 0; i < arr.length(); i++) uris.add(arr.getString(i));
        } catch (Exception e) {
            call.reject("bad uris: " + e.getMessage());
            return;
        }
        if (uris.isEmpty()) { call.reject("no uris"); return; }
        if (Build.VERSION.SDK_INT < 29) {
            call.reject("需要 Android 10+（MediaStore Downloads）");
            return;
        }
        JSObject started = new JSObject();
        started.put("started", true);
        call.resolve(started);   // 立即返回，进度/结果走事件（解压可达数分钟，不占桥）

        final List<String> list = uris;
        final Context ctx = getContext();
        new Thread(new Runnable() { @Override public void run() { runExtract(ctx, list); } }, "moyutai-extract").start();
    }

    private void runExtract(Context ctx, List<String> uriStrs) {
        File joined = null;
        try {
            ContentResolver cr = ctx.getContentResolver();
            List<Uri> uris = new ArrayList<>();
            final List<String> names = new ArrayList<>();
            for (String s : uriStrs) {
                Uri u = Uri.parse(s);
                uris.add(u);
                names.add(displayName(ctx, u));
            }
            List<Integer> idx = new ArrayList<>();
            for (int i = 0; i < uris.size(); i++) idx.add(i);
            Collections.sort(idx, new Comparator<Integer>() {
                @Override public int compare(Integer a, Integer b) { return naturalCmp(names.get(a), names.get(b)); }
            });

            String first = names.get(idx.get(0));
            String base = stripVolume(first);
            String lower = base.toLowerCase();
            if (lower.endsWith(".rar")) throw new IllegalArgumentException("不支持 rar 压缩包，请让对方改用 7z 或 zip");
            final boolean is7z = lower.endsWith(".7z");
            final boolean isZip = lower.endsWith(".zip");
            if (!is7z && !isZip) throw new IllegalArgumentException("不支持的格式（仅 zip / 7z，含分卷）");

            // 1) 分卷拼接（或单卷复制）到缓存
            long totalIn = 0;
            for (Integer i : idx) totalIn += Math.max(1, sizeOf(cr, uris.get(i)));
            File cache = new File(ctx.getCacheDir(), "extract_tmp");
            if (!cache.exists()) cache.mkdirs();
            joined = new File(cache, "joined.bin");
            long copied = 0;
            FileOutputStream fos = new FileOutputStream(joined);
            try {
                byte[] buf = new byte[BUF];
                for (Integer i : idx) {
                    InputStream in = cr.openInputStream(uris.get(i));
                    if (in == null) throw new IllegalStateException("无法读取: " + names.get(i));
                    try {
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            fos.write(buf, 0, n);
                            copied += n;
                            notifyProgress("copy", copied, totalIn);
                        }
                    } finally { in.close(); }
                }
            } finally { fos.close(); }

            // 2) 目标目录名（_exp 冲突判定：查自家已解压条目）
            String relDir = ROOT_DIR + uniqueDirName(base);

            // 3) 解压 → MediaStore Downloads
            long total = Math.max(1, joined.length());
            long done = 0;
            int files = 0;
            if (is7z) {
                SevenZFile z = new SevenZFile(joined);
                try {
                    SevenZArchiveEntry e;
                    byte[] buf = new byte[BUF];
                    while ((e = z.getNextEntry()) != null) {
                        if (e.isDirectory()) continue;
                        String entryPath = relDir + "/" + sanitize(e.getName());
                        // 1.26 API：read(entry,buf) 已移除，改 per-entry InputStream（局部变量 effectively final 可被匿名类捕获）
                        final InputStream ein = z.getInputStream(e);
                        done += writeDownload(cr, entryPath, new EntrySource() {
                            @Override public int read(byte[] b) throws Exception { return ein.read(b); }
                        }, buf);
                        files++;
                        notifyProgress("extract", done, total);
                    }
                } finally { z.close(); }
            } else {
                FileInputStream fin = new FileInputStream(joined);
                try {
                    ZipArchiveInputStream z = new ZipArchiveInputStream(fin, "UTF-8", false, true);
                    byte[] buf = new byte[BUF];
                    ZipArchiveEntry e;
                    while ((e = z.getNextZipEntry()) != null) {
                        if (e.isDirectory()) continue;
                        String entryPath = relDir + "/" + sanitize(e.getName());
                        done += writeDownload(cr, entryPath, new EntrySource() {
                            @Override public int read(byte[] b) throws Exception { return z.read(b); }
                        }, buf);
                        files++;
                        notifyProgress("extract", done, total);
                    }
                } finally { fin.close(); }
            }

            JSObject ok = new JSObject();
            ok.put("dest", "/storage/emulated/0/" + relDir);
            ok.put("files", files);
            ok.put("bytes", done);
            ok.put("volumes", idx.size());
            notifyListeners("done", ok);
        } catch (Exception e) {
            JSObject err = new JSObject();
            String msg = String.valueOf(e.getMessage());
            if (msg.contains("Can't open archive") || msg.contains("Error opening")) {
                msg = "分卷不完整或损坏（缺卷/顺序错误？请全选 .001~.NNN）";
            }
            err.put("message", msg);
            notifyListeners("error", err);
        } finally {
            if (joined != null) joined.delete();
        }
    }

    private interface EntrySource { int read(byte[] b) throws Exception; }

    /** MediaStore Downloads 写一个条目（IS_PENDING 两段式），返回写入字节数 */
    private long writeDownload(ContentResolver cr, String relPathWithFile, EntrySource src, byte[] buf) throws Exception {
        ContentValues cv = new ContentValues();
        cv.put(MediaStore.Downloads.DISPLAY_NAME,
                relPathWithFile.substring(relPathWithFile.lastIndexOf('/') + 1));
        cv.put(MediaStore.Downloads.MIME_TYPE, guessMime(relPathWithFile));
        cv.put(MediaStore.Downloads.RELATIVE_PATH,
                relPathWithFile.substring(0, relPathWithFile.lastIndexOf('/') + 1));
        cv.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri item = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
        if (item == null) throw new IllegalStateException("MediaStore 拒绝写入: " + relPathWithFile);
        long total = 0;
        try (OutputStream os = cr.openOutputStream(item)) {
            if (os == null) throw new IllegalStateException("无法打开输出流");
            int n;
            while ((n = src.read(buf)) > 0) { os.write(buf, 0, n); total += n; }
        }
        ContentValues done = new ContentValues();
        done.put(MediaStore.Downloads.IS_PENDING, 0);
        cr.update(item, done, null, null);
        return total;
    }

    private static String guessMime(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".mp4")) return "video/mp4";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".wav")) return "audio/wav";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".csv")) return "text/csv";
        if (p.endsWith(".txt")) return "text/plain";
        if (p.endsWith(".glb")) return "model/gltf-binary";
        if (p.endsWith(".ply")) return "application/octet-stream";
        return "application/octet-stream";
    }

    /** 防路径穿越 + 去非法字符 */
    private static String sanitize(String entryName) {
        String name = entryName.replace('\\', '/');
        while (name.startsWith("/")) name = name.substring(1);
        String[] parts = name.split("/");
        List<String> keep = new ArrayList<>();
        for (String p : parts) {
            if (p.isEmpty() || p.equals(".") || p.equals("..")) continue;
            keep.add(p.replaceAll("[\\x00:\\*\\?\"<>\\|]", "_"));
        }
        if (keep.isEmpty()) throw new IllegalStateException("非法条目名: " + entryName);
        return String.join("/", keep);
    }

    private void notifyProgress(String phase, long done, long total) {
        JSObject o = new JSObject();
        o.put("phase", phase);
        o.put("done", done);
        o.put("total", total);
        o.put("pct", Math.min(100.0, done * 100.0 / Math.max(1, total)));
        notifyListeners("progress", o);
    }

    /* ---------- 分卷/目录工具 ---------- */
    /** 识别 .7z.001 / .zip.002 / .part3 / .z01 等分卷尾缀 */
    private static final Pattern VOL = Pattern.compile("\\.(\\d{3}|part\\d+|z\\d\\d)$", Pattern.CASE_INSENSITIVE);

    static String stripVolume(String name) {
        Matcher m = VOL.matcher(name);
        return m.find() ? name.substring(0, m.start()) : name;
    }

    /** 自然序：数字段按数值比（part2 < part10），其余按字典序 */
    static int naturalCmp(String a, String b) {
        int ia = 0, ib = 0;
        while (ia < a.length() && ib < b.length()) {
            char ca = a.charAt(ia), cb = b.charAt(ib);
            if (Character.isDigit(ca) && Character.isDigit(cb)) {
                long va = 0, vb = 0;
                int sa = ia, sb = ib;
                while (ia < a.length() && Character.isDigit(a.charAt(ia))) va = va * 10 + (a.charAt(ia++) - '0');
                while (ib < b.length() && Character.isDigit(b.charAt(ib))) vb = vb * 10 + (b.charAt(ib++) - '0');
                if (va != vb) return va < vb ? -1 : 1;
            } else {
                if (ca != cb) return ca < cb ? -1 : 1;
                ia++; ib++;
            }
        }
        return (a.length() - ia) - (b.length() - ib);
    }

    /** 同名已存在（自家条目）→ <名>_exp、<名>_exp2… */
    private String uniqueDirName(String base) {
        String clean = base;
        String l = clean.toLowerCase();
        if (l.endsWith(".zip") || l.endsWith(".7z")) clean = clean.substring(0, clean.length() - 4);
        String relPrefix = ROOT_DIR + clean;
        ContentResolver cr = getContext().getContentResolver();
        boolean taken = false;
        int n = 1;
        try (Cursor c = cr.query(MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                new String[]{MediaStore.MediaColumns._ID},
                MediaStore.MediaColumns.RELATIVE_PATH + " LIKE ?",
                new String[]{relPrefix + "/%"}, null)) {
            taken = c != null && c.moveToFirst();
        } catch (Exception ignore) { }
        if (!taken) return clean;
        while (n < 100) {
            String cand = clean + "_exp" + (n == 1 ? "" : String.valueOf(n));
            try (Cursor c = cr.query(MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                    new String[]{MediaStore.MediaColumns._ID},
                    MediaStore.MediaColumns.RELATIVE_PATH + " LIKE ?",
                    new String[]{ROOT_DIR + cand + "/%"}, null)) {
                if (c == null || !c.moveToFirst()) return cand;
            } catch (Exception ignore) { }
            n++;
        }
        return clean + "_exp" + System.currentTimeMillis();
    }
}
