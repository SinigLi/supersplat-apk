package com.sinigli.supersplat;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * v45 MediaServerPlugin — AV 工作台媒体访问（原生层）
 *
 * 背景：音视频工程媒体不进包（300MB 级，v29 OOM 教训），WebView <video> 需要
 * 带 Range 的 HTTP 流。方案（方案文档 §3.2）：SAF 选目录 + 持久授权 +
 * 内嵌 HTTP Range 服务器（127.0.0.1 随机端口），WebView 走 http://127.0.0.1:port/
 * 直接流播，seek/拖动零拷贝过桥。
 *
 * API：
 *   pickFolder()                       SAF 目录选择器 + takePersistableUriPermission
 *                                      → {uri, name}
 *   listFiles({uri})                   目录树媒体文件清单（按扩展名过滤）
 *                                      → {files: [{name, uri(子路径), size}]}
 *   start({uri})                       启动本地服务器（列目录建索引，路径=相对名）
 *                                      → {port, count}
 *   stop()                             停服务器
 *
 * 安全边界：
 *   - 只绑 127.0.0.1 loopback，外部不可达
 *   - 路径必须命中授权目录索引（拒绝 ../ 穿越与任意路径探测）
 *   - 只读，MIME 按扩展名白名单
 *
 * 决策记录（2026-11-02）：
 * - 为什么不走 convertFileSrc：SAF 内容 URI（content://）转 file URI 不可行，
 *   WebView 对 content:// 的 Range 请求支持不全（seek 会整文件重拉）
 * - 为什么不用 base64 过桥：v29 教训，300MB 级必死
 * - cleartext：Capacitor 配置 android.allowMixedContent + 127.0.0.1 走
 *   networkSecurityConfig 的 loopback 白名单（Android 官方允许明文 loopback）
 * - 服务器生命周期：start 时创建，stop/app 退出时关闭；端口随机分配
 */
@CapacitorPlugin(name = "MediaServer")
public class MediaServerPlugin extends Plugin {

    private static final int BUF = 1 << 16;
    /** MIME 白名单（_avLogic.MEDIA_* 对齐） */
    private static final Map<String, String> MIME;
    static {
        Map<String, String> m = new HashMap<>();
        m.put("mp4", "video/mp4");
        m.put("webm", "video/webm");
        m.put("mkv", "video/x-matroska");
        m.put("mov", "video/quicktime");
        m.put("m4v", "video/x-m4v");
        m.put("wav", "audio/wav");
        m.put("mp3", "audio/mpeg");
        m.put("flac", "audio/flac");
        m.put("m4a", "audio/mp4");
        m.put("ogg", "audio/ogg");
        m.put("aac", "audio/aac");
        MIME = m;
    }

    private ExecutorService pool;
    private ServerSocket server;
    private Thread acceptThread;
    private int port = -1;
    /** 相对路径 → SAF document URI（start 时建） */
    private final Map<String, Uri> index = new ConcurrentHashMap<>();
    private String rootUri;
    private long totalBytes = 0;

    /** v45e：进程未死时重开 App，上个会话在 workbench 里设置的横屏请求会残留
     *  （老板 07:21 反馈「一点就横屏」的嫌疑之一）。每次 Activity 重建都回系统默认。 */
    @Override
    public void load() {
        Activity a = getActivity();
        if (a != null) {
            a.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_FULL_USER);
        }
    }

    /* ---------- SAF ---------- */

    private Activity act() { return getActivity(); }
    private ContentResolver cr() { return getContext().getContentResolver(); }

    /** 持久化授权：重启后 folderUri 仍可用（Q11 已确认可接受重选，这里尽力持久） */
    private void takePersist(Uri treeUri) {
        try {
            cr().takePersistableUriPermission(treeUri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception e) { /* 非 tree URI 或无 flag：忽略，让 listFiles 报错 */ }
    }

    /** tree URI → Document URI（目录本身） */
    private Uri docUriForTree(Uri treeUri) {
        String docId = DocumentsContract.getTreeDocumentId(treeUri);
        return DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);
    }

    /** 列目录直接子项：[name, uri, size, isDir] */
    private List<JSObject> listChildren(Uri treeUri) throws Exception {
        Uri doc = docUriForTree(treeUri);
        String docId = DocumentsContract.getDocumentId(doc);
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId);
        List<JSObject> out = new ArrayList<>();
        Cursor c = cr().query(childrenUri, new String[]{
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_SIZE,
        }, null, null, null);
        if (c == null) throw new Exception("目录不可读（授权失效？）");
        try {
            while (c.moveToNext()) {
                JSObject o = new JSObject();
                String docIdChild = c.getString(0);
                o.put("docId", docIdChild);
                o.put("name", c.getString(1));
                o.put("mime", c.getString(2));
                o.put("size", c.getLong(3));
                o.put("dir", DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(2)));
                out.add(o);
            }
        } finally { c.close(); }
        return out;
    }

    /** docId（树内路径）→ document URI */
    private Uri docUriForId(Uri treeUri, String docId) {
        return DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);
    }

    /* ---------- 插件方法 ---------- */

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Activity activity = act();
        if (activity == null) { call.reject("Activity 不可用"); return; }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        // Cap7 唯一可用形态（v44 真机教训：旧 startActivityForResult+saveCall 不触发回调）
        startActivityForResult(call, intent, "pickFolderResult");
    }

    @ActivityCallback
    private void pickFolderResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        int rc = result.getResultCode();
        if (rc != Activity.RESULT_OK || result.getData() == null) {
            call.reject("未选择目录");
            return;
        }
        Uri treeUri = result.getData().getData();
        if (treeUri == null) { call.reject("未选择目录"); return; }
        takePersist(treeUri);
        String name = treeUri.getLastPathSegment();
        if (name != null && name.contains(":")) name = name.substring(name.indexOf(':') + 1);
        JSObject res = new JSObject();
        res.put("uri", treeUri.toString());
        res.put("name", name == null ? "" : name);
        call.resolve(res);
    }

    @PluginMethod
    public void listFiles(PluginCall call) {
        String uriStr = call.getString("uri");
        if (uriStr == null || uriStr.isEmpty()) { call.reject("缺 uri"); return; }
        try {
            Uri treeUri = Uri.parse(uriStr);
            List<JSObject> children = listChildren(treeUri);
            JSArray arr = new JSArray();
            int n = 0;
            for (JSObject o : children) {
                if (o.optBoolean("dir")) continue;
                String name = o.optString("name", "");
                String lower = name.toLowerCase();
                int dot = lower.lastIndexOf('.');
                if (dot < 0) continue;
                String ext = lower.substring(dot + 1);
                if (!MIME.containsKey(ext)) continue;
                JSObject f = new JSObject();
                f.put("name", name);
                f.put("size", o.optLong("size"));
                f.put("docId", o.optString("docId"));
                arr.put(f);
                n++;
            }
            JSObject res = new JSObject();
            res.put("files", arr);
            res.put("count", n);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("列目录失败: " + e.getMessage());
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        String uriStr = call.getString("uri");
        if (uriStr == null || uriStr.isEmpty()) { call.reject("缺 uri"); return; }
        stopInternal();     // 复用前先停旧的

        try {
            Uri treeUri = Uri.parse(uriStr);
            rootUri = uriStr;
            index.clear();
            totalBytes = 0;
            List<JSObject> children = listChildren(treeUri);
            for (JSObject o : children) {
                if (o.optBoolean("dir")) continue;
                String name = o.optString("name", "");
                String lower = name.toLowerCase();
                int dot = lower.lastIndexOf('.');
                if (dot < 0) continue;
                if (!MIME.containsKey(lower.substring(dot + 1))) continue;
                index.put(name, docUriForId(treeUri, o.optString("docId")));
                totalBytes += o.optLong("size");
            }
            if (index.isEmpty()) { call.reject("目录里没有可播放的媒体文件"); return; }

            ServerSocket ss = new ServerSocket(0, 64, java.net.InetAddress.getByName("127.0.0.1"));
            server = ss;
            port = ss.getLocalPort();
            acceptThread = new Thread(this::acceptLoop, "moyutai-mediasrv");
            acceptThread.setPriority(Thread.MIN_PRIORITY + 1);
            acceptThread.start();
            JSObject res = new JSObject();
            res.put("port", port);
            res.put("count", index.size());
            res.put("bytes", totalBytes);
            call.resolve(res);
        } catch (Exception e) {
            stopInternal();
            call.reject("服务器启动失败: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopInternal();
        if (call != null) call.resolve();
    }

    /** v45c：读系统栏/挖孔避让尺寸（反馈 #4：顶栏按钮被系统下拉栏遮挡）
     *  Android 15 强制 edge-to-edge，WebView 里 env(safe-area-inset) 不可靠，
     *  这里从 WindowInsetsCompat 拿真实 px，Web 层写进 CSS 变量。 */
    @PluginMethod
    public void getSafeArea(PluginCall call) {
        final Activity a = getActivity();
        if (a == null) { call.reject("no activity"); return; }
        final PluginCall c = call;
        a.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    android.view.View v = a.getWindow().getDecorView();
                    androidx.core.graphics.Insets i = androidx.core.view.WindowInsetsCompat
                            .toWindowInsetsCompat(v.getRootWindowInsets())
                            .getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars()
                                    | androidx.core.view.WindowInsetsCompat.Type.displayCutout());
                    JSObject res = new JSObject();
                    res.put("top", i.top);
                    res.put("left", i.left);
                    res.put("right", i.right);
                    res.put("bottom", i.bottom);
                    c.resolve(res);
                } catch (Exception e) {
                    c.reject("insets failed: " + e.getMessage());
                }
            }
        });
    }

    /** v45b：工作台强制横屏（反馈 #1；screen.orientation.lock 在 WebView 可能被拒，Activity 级保证生效） */
    @PluginMethod
    public void lockLandscape(PluginCall call) {
        Boolean on = call.getBoolean("on");
        Activity a = getActivity();
        if (a == null) { call.reject("no activity"); return; }
        if (on == null) on = Boolean.TRUE;
        a.setRequestedOrientation(Boolean.TRUE.equals(on)
                ? android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                : android.content.pm.ActivityInfo.SCREEN_ORIENTATION_FULL_USER);
        JSObject res = new JSObject();
        res.put("ok", true);
        call.resolve(res);
    }

    @Override
    protected void handleOnDestroy() {
        stopInternal();
    }

    private synchronized void stopInternal() {
        try { if (server != null && !server.isClosed()) server.close(); } catch (Exception e) { /* */ }
        server = null;
        port = -1;
        if (acceptThread != null) acceptThread.interrupt();
        acceptThread = null;
        if (pool != null) pool.shutdownNow();
        pool = null;
    }

    /* ---------- HTTP ---------- */

    private void acceptLoop() {
        pool = Executors.newFixedThreadPool(3);
        while (server != null && !server.isClosed()) {
            try {
                Socket s = server.accept();
                pool.execute(() -> serve(s));
            } catch (Exception e) {
                if (server == null || server.isClosed()) return;    // 正常关停
            }
        }
    }

    /** 读 HTTP 头（到 \r\n\r\n），不读 body（GET 无 body） */
    private String readHeaders(InputStream in) throws Exception {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] b = new byte[1];
        int state = 0;
        while (state < 4) {
            int n = in.read(b);
            if (n < 0) break;
            int c = b[0];
            state = (c == '\r' && (state == 0 || state == 2)) ? state + 1
                    : (c == '\n' && (state == 1 || state == 3)) ? state + 1 : 0;
            buf.write(c);
        }
        return buf.toString("ISO-8859-1");
    }

    private void serve(Socket s) {
        try {
            s.setSoTimeout(8000);
            InputStream in = s.getInputStream();
            OutputStream out = s.getOutputStream();
            String head = readHeaders(in);
            String[] lines = head.split("\r\n");
            if (lines.length == 0) { s.close(); return; }
            String[] req = lines[0].split(" ");
            if (req.length < 2) { s.close(); return; }
            String path = req[1];
            if (path.startsWith("/")) path = path.substring(1);
            path = java.net.URLDecoder.decode(path, "UTF-8");

            // Range 头（可能是 bytes=start-end / bytes=start- / bytes=-suffix）
            String range = null;
            for (String l : lines) {
                if (l.toLowerCase().startsWith("range:")) {
                    range = l.substring(6).trim();
                    break;
                }
            }

            if ("/__probe".equals("/" + path) || path.isEmpty()) {
                // 探针/根路径：确认服务器活着
                writeResp(out, 200, "text/plain", "moyutai-media-ok".getBytes(StandardCharsets.UTF_8), null, 0);
                s.close();
                return;
            }

            Uri doc = index.get(path);
            if (doc == null) {
                writeResp(out, 404, "text/plain", "not found".getBytes(StandardCharsets.UTF_8), null, 0);
                s.close();
                return;
            }

            String ext = "";
            int dot = path.lastIndexOf('.');
            if (dot >= 0) ext = path.substring(dot + 1).toLowerCase();
            String mime = MIME.getOrDefault(ext, "application/octet-stream");

            long size = querySize(doc);
            if (size < 0) {
                writeResp(out, 500, "text/plain", "stat failed".getBytes(StandardCharsets.UTF_8), null, 0);
                s.close();
                return;
            }

            if (range != null && range.startsWith("bytes=")) {
                serveRange(out, doc, mime, size, range.substring(6).trim());
            } else {
                serveFull(out, doc, mime, size);
            }
            s.close();
        } catch (Exception e) {
            try { s.close(); } catch (Exception ignored) { }
        }
    }

    private long querySize(Uri doc) {
        Cursor c = cr().query(doc, new String[]{DocumentsContract.Document.COLUMN_SIZE}, null, null, null);
        if (c == null) return -1;
        try {
            return c.moveToFirst() ? c.getLong(0) : -1;
        } finally { c.close(); }
    }

    private InputStream openDoc(Uri doc) throws Exception {
        return cr().openInputStream(doc);
    }

    private void serveFull(OutputStream out, Uri doc, String mime, long size) throws Exception {
        InputStream in = openDoc(doc);
        if (in == null) { writeResp(out, 500, "text/plain", "open failed".getBytes(StandardCharsets.UTF_8), null, 0); return; }
        StringBuilder h = new StringBuilder();
        h.append("HTTP/1.1 200 OK\r\n");
        h.append("Content-Type: ").append(mime).append("\r\n");
        h.append("Content-Length: ").append(size).append("\r\n");
        h.append("Accept-Ranges: bytes\r\n");
        h.append("Access-Control-Allow-Origin: *\r\n");
        h.append("Connection: close\r\n\r\n");
        out.write(h.toString().getBytes(StandardCharsets.ISO_8859_1));
        pipe(in, out, 0, size);
        in.close();
    }

    private void serveRange(OutputStream out, Uri doc, String mime, long size, String rangeSpec) throws Exception {
        long start, end;
        // 只处理单区间 "start-end" / "start-" / "-suffix"
        int dash = rangeSpec.indexOf('-');
        String a = rangeSpec.substring(0, dash).trim();
        String b = rangeSpec.substring(dash + 1).trim();
        if (a.isEmpty()) {
            long suffix = Long.parseLong(b);
            start = Math.max(0, size - suffix);
            end = size - 1;
        } else {
            start = Long.parseLong(a);
            end = b.isEmpty() ? size - 1 : Math.min(Long.parseLong(b), size - 1);
        }
        if (start > end || start >= size) {
            writeResp(out, 416, "text/plain", "range error".getBytes(StandardCharsets.UTF_8), null, 0);
            return;
        }
        InputStream in = openDoc(doc);
        if (in == null) { writeResp(out, 500, "text/plain", "open failed".getBytes(StandardCharsets.UTF_8), null, 0); return; }
        long skipTotal = start;
        while (skipTotal > 0) {
            long skipped = in.skip(skipTotal);
            if (skipped <= 0) break;
            skipTotal -= skipped;
        }
        if (skipTotal > 0) { in.close(); writeResp(out, 500, "text/plain", "seek failed".getBytes(StandardCharsets.UTF_8), null, 0); return; }
        long len = end - start + 1;
        StringBuilder h = new StringBuilder();
        h.append("HTTP/1.1 206 Partial Content\r\n");
        h.append("Content-Type: ").append(mime).append("\r\n");
        h.append("Content-Range: bytes ").append(start).append("-").append(end).append("/").append(size).append("\r\n");
        h.append("Content-Length: ").append(len).append("\r\n");
        h.append("Accept-Ranges: bytes\r\n");
        h.append("Access-Control-Allow-Origin: *\r\n");
        h.append("Connection: close\r\n\r\n");
        out.write(h.toString().getBytes(StandardCharsets.ISO_8859_1));
        pipe(in, out, 0, len);
        in.close();
    }

    private void pipe(InputStream in, OutputStream out, long off, long len) throws Exception {
        byte[] buf = new byte[BUF];
        long remaining = len;
        while (remaining > 0) {
            int want = (int) Math.min(BUF, remaining);
            int n = in.read(buf, 0, want);
            if (n < 0) break;
            out.write(buf, 0, n);
            remaining -= n;
        }
        out.flush();
    }

    private void writeResp(OutputStream out, int code, String mime, byte[] body, String extraHeader, long total) throws Exception {
        StringBuilder h = new StringBuilder();
        h.append("HTTP/1.1 ").append(code).append(" ").append(statusText(code)).append("\r\n");
        h.append("Content-Type: ").append(mime).append("\r\n");
        h.append("Content-Length: ").append(body.length).append("\r\n");
        h.append("Access-Control-Allow-Origin: *\r\n");
        h.append("Connection: close\r\n\r\n");
        out.write(h.toString().getBytes(StandardCharsets.ISO_8859_1));
        out.write(body);
        out.flush();
    }

    private String statusText(int code) {
        switch (code) {
            case 200: return "OK";
            case 206: return "Partial Content";
            case 404: return "Not Found";
            case 416: return "Range Not Satisfiable";
            case 500: return "Server Error";
            default: return "";
        }
    }

    /* ---------- v45l：容器元数据探测（fps 真值来自容器，不再靠网页播放采样猜） ---------- */

    /**
     * probeMeta：用 MediaExtractor 读取视频容器轨道格式。
     * 返回 fps（KEY_FRAME_RATE，int/float 兼容）、width/height、rotation、durationMs。
     * 只读容器头信息，不做解码，毫秒级返回。
     */
    @PluginMethod
    public void probeMeta(PluginCall call) {
        String name = call.getString("name");
        if (name == null || name.isEmpty() || port < 0) { call.reject("缺少 name 或媒体服务未启动"); return; }
        Uri doc = index.get(name);
        if (doc == null) { call.reject("文件不在已授权目录: " + name); return; }
        android.media.MediaExtractor ex = new android.media.MediaExtractor();
        try {
            android.os.ParcelFileDescriptor pfd = cr().openFileDescriptor(doc, "r");
            ex.setDataSource(pfd.getFileDescriptor());
            JSObject res = new JSObject();
            res.put("ok", false);
            int n = ex.getTrackCount();
            for (int i = 0; i < n; i++) {
                android.media.MediaFormat f = ex.getTrackFormat(i);
                String mime = f.getString(android.media.MediaFormat.KEY_MIME);
                if (mime == null || !mime.startsWith("video/")) continue;
                res.put("ok", true);
                res.put("width", f.containsKey(android.media.MediaFormat.KEY_WIDTH) ? f.getInteger(android.media.MediaFormat.KEY_WIDTH) : 0);
                res.put("height", f.containsKey(android.media.MediaFormat.KEY_HEIGHT) ? f.getInteger(android.media.MediaFormat.KEY_HEIGHT) : 0);
                if (f.containsKey("rotation-degrees")) res.put("rotation", f.getInteger("rotation-degrees"));
                if (f.containsKey(android.media.MediaFormat.KEY_FRAME_RATE)) {
                    try {
                        res.put("fps", f.getInteger(android.media.MediaFormat.KEY_FRAME_RATE));
                    } catch (ClassCastException ce) {
                        res.put("fps", f.getFloat(android.media.MediaFormat.KEY_FRAME_RATE));
                    }
                }
                if (f.containsKey(android.media.MediaFormat.KEY_DURATION)) {
                    res.put("durationMs", f.getLong(android.media.MediaFormat.KEY_DURATION) / 1000);
                }
                break;
            }
            call.resolve(res);
        } catch (Exception e) {
            call.reject("probeMeta 失败: " + e.getMessage());
        } finally {
            try { ex.release(); } catch (Exception ignored) { }
        }
    }
}
