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
        m.put("jpg", "image/jpeg");
        m.put("jpeg", "image/jpeg");
        m.put("png", "image/png");
        m.put("webp", "image/webp");
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
                /* v59k：带上可直接 openInputStream 的 document uri（图片导入用） */
                try { o.put("uri", docUriForId(treeUri, docIdChild).toString()); } catch (Exception ignore) { }
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

    /* ---------- v51：分镜清单 CSV（单文件授权 + 只读文本）---------- */

    /** SAF 单文件选择器，限定 text/csv 等文本类型；授权持久化 → {uri,name} */
    @PluginMethod
    public void pickCsv(PluginCall call) {
        Activity activity = act();
        if (activity == null) { call.reject("Activity 不可用"); return; }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("text/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"text/csv", "text/comma-separated-values", "text/plain", "application/csv", "application/vnd.ms-excel"});
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "pickCsvResult");
    }

    @ActivityCallback
    private void pickCsvResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        int rc = result.getResultCode();
        if (rc != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.resolve();   /* 用户取消：null */
            return;
        }
        Uri uri = result.getData().getData();
        takePersistFile(uri);
        String name = queryDisplayName(uri);
        JSObject ret = new JSObject();
        ret.put("uri", uri.toString());
        ret.put("name", name);
        call.resolve(ret);
    }

    /** 单文件版持久授权（takePersist 是 tree 用的，flag 同理） */
    private void takePersistFile(Uri uri) {
        try {
            cr().takePersistableUriPermission(uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception e) { /* 无 persistable flag：忽略，listFiles 报错 */ }
    }

    private String queryDisplayName(Uri uri) {
        Cursor c = null;
        try {
            c = cr().query(uri, null, null, null, null);
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) return c.getString(idx);
            }
        } catch (Exception e) { /* ignore */ } finally {
            if (c != null) try { c.close(); } catch (Exception e2) { }
        }
        return "";
    }

    /** 读 SAF 文本文件（自动识别编码：UTF-8/GBK/UTF-16，上限 4MB）→ {text, charset} */
    @PluginMethod
    public void readText(PluginCall call) {
        String u = call.getString("uri");
        if (u == null || u.length() == 0) { call.reject("缺少 uri"); return; }
        try {
            Uri uri = Uri.parse(u);
            InputStream in = cr().openInputStream(uri);
            if (in == null) { call.reject("文件不可读"); return; }
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[BUF];
            int n, total = 0;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > 4 * 1024 * 1024) { in.close(); call.reject("CSV 超过 4MB 上限"); return; }
                bos.write(buf, 0, n);
            }
            in.close();
            byte[] data = bos.toByteArray();
            /* 编码检测：BOM 优先；否则 UTF-8 严格解码失败 → GBK；GBK 再失败 → Latin-1 */
            String charset;
            if (data.length >= 3 && (data[0] & 0xFF) == 0xEF && (data[1] & 0xFF) == 0xBB && (data[2] & 0xFF) == 0xBF) {
                charset = "UTF-8";
            } else if (data.length >= 2 && (data[0] & 0xFF) == 0xFF && (data[1] & 0xFF) == 0xFE) {
                charset = "UTF-16LE";
            } else if (data.length >= 2 && (data[0] & 0xFF) == 0xFE && (data[1] & 0xFF) == 0xFF) {
                charset = "UTF-16BE";
            } else {
                charset = detectNoBom(data);
            }
            String text = new String(data, charset);
            /* 去 BOM 字符（String 构造会残留 U+FEFF） */
            if (text.length() > 0 && text.charAt(0) == '\uFEFF') text = text.substring(1);
            JSObject ret = new JSObject();
            ret.put("text", text);
            ret.put("charset", charset);
            ret.put("bytes", data.length);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("读取失败：" + (e.getMessage() == null ? e.toString() : e.getMessage()));
        }
    }

    /** 无 BOM 时的编码判定：UTF-8 严格解码成功即 UTF-8；否则 GBK（中文
     *  Windows 记事本默认）；GBK 非法字节再落 Latin-1。 */
    private String detectNoBom(byte[] data) {
        if (strictDecode(data, java.nio.charset.StandardCharsets.UTF_8)) return "UTF-8";
        try {
            if (strictDecode(data, java.nio.charset.Charset.forName("GBK"))) return "GBK";
        } catch (Exception e) { /* GBK 不可用（理论上 Android 自带）*/ }
        return "ISO-8859-1";
    }

    private boolean strictDecode(byte[] data, java.nio.charset.Charset cs) {
        try {
            java.nio.charset.CharsetDecoder dec = cs.newDecoder()
                    .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                    .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT);
            dec.decode(java.nio.ByteBuffer.wrap(data));
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * v59k：读授权树内单个文件的字节（base64 返回）。
     * 用于「导入图片文件夹建角色卡组」：JS 侧拿 base64 → Image 解码 → 缩 256 头像。
     * uri 为 document/tree URI；无持久授权时尝试 takePersistFile。
     */
    @PluginMethod
    public void readBytes(PluginCall call) {
        String uriStr = call.getString("uri");
        /* v59k-b：优先 tree+docId 在原生侧直构 document uri（与 server index 同构；
         * 真机 debug_22 证实 uri 字符串往返在某些 ROM 上退化为裸 docId → No content provider） */
        String treeStr = call.getString("tree");
        String docId = call.getString("docId");
        if ((uriStr == null || uriStr.isEmpty()) && (treeStr == null || treeStr.isEmpty() || docId == null || docId.isEmpty())) {
            call.reject("缺 uri 或 tree+docId"); return;
        }
        try {
            Uri uri;
            if (treeStr != null && !treeStr.isEmpty() && docId != null && !docId.isEmpty()) {
                uri = docUriForId(Uri.parse(treeStr), docId);
            } else {
                uri = Uri.parse(uriStr);
            }
            takePersistFile(uri);
            android.os.StrictMode.ThreadPolicy old = android.os.StrictMode.getThreadPolicy();
            android.os.StrictMode.setThreadPolicy(android.os.StrictMode.ThreadPolicy.LAX);
            java.io.InputStream in = null;
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            try {
                in = cr().openInputStream(uri);
                if (in == null) { call.reject("无法打开文件"); return; }
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            } finally {
                try { if (in != null) in.close(); } catch (Exception ignore) { }
                android.os.StrictMode.setThreadPolicy(old);
            }
            JSObject ret = new JSObject();
            ret.put("base64", android.util.Base64.encodeToString(bos.toByteArray(), android.util.Base64.NO_WRAP));
            ret.put("size", bos.size());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("读文件失败: " + e.getMessage());
        }
    }

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
                /* v59k：带上 document uri（readBytes 需要）；listChildren 已填 */
                if (o.has("uri")) f.put("uri", o.optString("uri"));
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

    /* ---------- v47：定位成本统计（诊断用，读操作无锁风险） ---------- */

    private volatile long stRanges = 0, stLseek = 0, stSkip = 0, stSeekMsSum = 0, stSeekMsMax = 0;

    private synchronized void noteSeek(boolean byLseek, long ms) {
        stRanges++;
        if (byLseek) stLseek++; else stSkip++;
        stSeekMsSum += ms;
        if (ms > stSeekMsMax) stSeekMsMax = ms;
    }

    /** 诊断口：JS 侧 dlog 出来即可判断真机是否还在走慢路径 */
    @PluginMethod
    public void stats(PluginCall call) {
        JSObject r = new JSObject();
        r.put("ranges", stRanges);
        r.put("lseek", stLseek);
        r.put("skipFallback", stSkip);
        r.put("seekMsMax", stSeekMsMax);
        r.put("seekMsAvg", stRanges > 0 ? Math.round(stSeekMsSum * 10.0 / stRanges) / 10.0 : 0.0);
        call.resolve(r);
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
        // v47：改为 O(1) 定位。原实现用 InputStream.skip()，在部分 SAF provider 上退化为
        // 「顺序读掉 N 字节再丢弃」，成本随偏移线性增长 → 长视频后半段按帧移动明显变慢，
        // 缩略图捕获通道（同一条 Range 路径）也被一起拖死。
        long seekT0 = android.os.SystemClock.elapsedRealtime();
        InputStream in = null;
        boolean byLseek = false;
        try {
            android.os.ParcelFileDescriptor pfd = cr().openFileDescriptor(doc, "r");
            if (pfd == null) throw new java.io.IOException("pfd null");
            try {
                if (start > 0) {
                    android.system.Os.lseek(pfd.getFileDescriptor(), start, android.system.OsConstants.SEEK_SET);
                }
                in = new android.os.ParcelFileDescriptor.AutoCloseInputStream(pfd);
                byLseek = true;
            } catch (Exception le) {
                // provider 给的是不可定位的管道流：关掉 pfd，退回顺序跳过
                try { pfd.close(); } catch (Exception ignored) { }
                in = openDoc(doc);
                if (in == null) { writeResp(out, 500, "text/plain", "open failed".getBytes(StandardCharsets.UTF_8), null, 0); return; }
                long skipTotal = start;
                while (skipTotal > 0) {
                    long skipped = in.skip(skipTotal);
                    if (skipped <= 0) break;
                    skipTotal -= skipped;
                }
                if (skipTotal > 0) {
                    in.close();
                    writeResp(out, 500, "text/plain", "seek failed".getBytes(StandardCharsets.UTF_8), null, 0);
                    return;
                }
            }
        } catch (Exception e) {
            writeResp(out, 500, "text/plain", ("open failed: " + e.getMessage()).getBytes(StandardCharsets.UTF_8), null, 0);
            return;
        }
        if (in == null) {
            writeResp(out, 500, "text/plain", "open failed".getBytes(StandardCharsets.UTF_8), null, 0);
            return;
        }
        noteSeek(byLseek, android.os.SystemClock.elapsedRealtime() - seekT0);
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

    /* ---------- v45o：容器元数据（精确 fps）+ 首帧缩略图（原生解码，不再依赖 WebView） ---------- */

    /**
     * probeMeta：读取视频容器轨道格式 + 样本迭代计算精确帧率。
     * KEY_FRAME_RATE 对 23.976fps 源会整数截断成 23（24000/1001 取整），
     * 因此用 (样本数-1)/(末样本-首样本) 计算精确值；失败退回 KEY_FRAME_RATE。
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
            int videoTrack = -1;
            android.media.MediaFormat f = null;
            for (int i = 0; i < n; i++) {
                android.media.MediaFormat fm = ex.getTrackFormat(i);
                String mime = fm.getString(android.media.MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("video/")) { videoTrack = i; f = fm; break; }
            }
            if (videoTrack >= 0) {
                res.put("ok", true);
                res.put("width", f.containsKey(android.media.MediaFormat.KEY_WIDTH) ? f.getInteger(android.media.MediaFormat.KEY_WIDTH) : 0);
                res.put("height", f.containsKey(android.media.MediaFormat.KEY_HEIGHT) ? f.getInteger(android.media.MediaFormat.KEY_HEIGHT) : 0);
                /* v68：把 profile / 位深报给 JS。老板那批素材是 H.264 High 10 (10bit)，
                 * Android 硬件 AVC 解码器只保证 Baseline/Main/High(8bit)，MediaCodec 直接拒，
                 * WebView 报 MEDIA_ERR_SRC_NOT_SUPPORTED(4)。提前探测就能给明白话，
                 * 不再让 <video> 反复撞、也不再把 94 个文件的缩略图任务全排一遍。
                 * 注意 canPlayType 对 avc1.6E0033 也返回 "probably"，JS 侧骗不了，只能靠原生。 */
                int profile = -1;
                try {
                    if (f.containsKey(android.media.MediaFormat.KEY_PROFILE)) {
                        profile = f.getInteger(android.media.MediaFormat.KEY_PROFILE);
                    }
                } catch (Exception ignore) { }
                int bitDepth = 8;
                try {
                    if (f.containsKey("bit-depth")) bitDepth = f.getInteger("bit-depth");
                } catch (Exception ignore) { }
                /* MediaCodecInfo.CodecProfileLevel：0x10=High10, 0x20=High422, 0x40=High444 */
                if (profile == 0x10 || profile == 0x20 || profile == 0x40) bitDepth = Math.max(bitDepth, 10);
                res.put("profile", profile);
                res.put("bitDepth", bitDepth);
                res.put("decodable", !(profile == 0x10 || profile == 0x20 || profile == 0x40) && bitDepth <= 8);
                if (f.containsKey("rotation-degrees")) res.put("rotation", f.getInteger("rotation-degrees"));
                if (f.containsKey(android.media.MediaFormat.KEY_DURATION)) {
                    res.put("durationMs", f.getLong(android.media.MediaFormat.KEY_DURATION) / 1000);
                }
                // 精确 fps：样本迭代（上限 20 万样本，防超长文件拖时间）
                // v45r-2：fps = (帧数-1) / 时间跨度。min/max 与遍历顺序完全无关，
                // 不会被 B 帧乱序带偏（v45p 的中位数法在这台设备 4K 流上仍被乱序时间戳搞出 29.97/25）。
                // 只走索引不解码，几千帧也在几毫秒内。
                ex.selectTrack(videoTrack);
                ex.seekTo(0, android.media.MediaExtractor.SEEK_TO_PREVIOUS_SYNC);
                int count = 0;
                long minTs = -1, maxTs = -1;
                while (count < 300000 && ex.advance()) {
                    long t = ex.getSampleTime();
                    if (t < 0) break;
                    if (minTs < 0 || t < minTs) minTs = t;
                    if (maxTs < 0 || t > maxTs) maxTs = t;
                    count++;
                }
                float fps = -1;
                if (count > 3 && maxTs > minTs) {
                    fps = (count - 1) * 1000000f / (maxTs - minTs);
                }
                if (fps <= 0 && f.containsKey(android.media.MediaFormat.KEY_FRAME_RATE)) {
                    try { fps = f.getInteger(android.media.MediaFormat.KEY_FRAME_RATE); }
                    catch (Exception ce) { fps = f.getFloat(android.media.MediaFormat.KEY_FRAME_RATE); }
                }
                if (fps > 0) res.put("fps", Math.round(fps * 1000f) / 1000f);
            }
            call.resolve(res);
        } catch (Exception e) {
            call.reject("probeMeta 失败: " + e.getMessage());
        } finally {
            try { ex.release(); } catch (Exception ignored) { }
        }
    }

    /**
     * thumb：原生抽取首帧 JPEG（base64）。MediaMetadataRetriever 直接解码，
     * 不经 WebView 视频管线（真机 WebView 解码/画布路径不可靠，v45n 实证），也不受解码器实例上限约束。
     */
    /* v45r：缩略图专用单线程池——绝不占用 Capacitor 桥线程（v45p 实证：58 个 MMR 整帧解码把桥堵死，
     * 日志/存储/媒体服务全部排队饿死 → 空日志+转圈圈+占位不出图）。队列超限快速拒绝，JS 侧会重试。 */
    /* v45r-2：懒加载线程池——插件实例化期绝不跑任何可能抛异常的初始化。
     * v45r 教训：Executors.newSingleThreadExecutor() 返回包装类，强转 ThreadPoolExecutor
     * 在插件实例化时抛 ClassCastException → Capacitor 静默摘除整个插件 → 媒体功能全灭。
     * 直接 new ThreadPoolExecutor：无强转、无包装、getQueue() 可用。 */
    private java.util.concurrent.ThreadPoolExecutor thumbPool;

    private synchronized java.util.concurrent.ThreadPoolExecutor thumbPool() {
        if (thumbPool == null || thumbPool.isShutdown()) {
            thumbPool = new java.util.concurrent.ThreadPoolExecutor(
                    1, 1, 30L, java.util.concurrent.TimeUnit.SECONDS,
                    new java.util.concurrent.LinkedBlockingQueue<Runnable>(),
                    new java.util.concurrent.ThreadFactory() {
                        @Override
                        public Thread newThread(Runnable r) {
                            Thread t = new Thread(r, "moyutai-thumb");
                            t.setDaemon(true);
                            return t;
                        }
                    });
        }
        return thumbPool;
    }

    @PluginMethod
    public void thumb(PluginCall call) {
        String name = call.getString("name");
        if (name == null || name.isEmpty() || port < 0) { call.reject("缺少 name 或媒体服务未启动"); return; }
        Uri doc = index.get(name);
        if (doc == null) { call.reject("文件不在已授权目录: " + name); return; }
        java.util.concurrent.ThreadPoolExecutor pool = thumbPool();
        if (pool.getQueue().size() > 12) { call.reject("缩略图队列繁忙"); return; }
        try {
            pool.execute(() -> {
            if (port < 0) { call.reject("服务已停"); return; }   // v45x：退出工程后队列残留立即拒绝，不再空转
            android.media.MediaMetadataRetriever r = new android.media.MediaMetadataRetriever();
            try {
                android.os.ParcelFileDescriptor pfd = cr().openFileDescriptor(doc, "r");
                r.setDataSource(pfd.getFileDescriptor());
                // v45v：解码统一走"带超时的降级阶梯"——每一步都在独立线程里跑，10s 无响应视为挂起并放弃该步。
                // 背景：getScaledFrameAtTime 在部分设备 4K 流上会无限挂起（v45u 实证：整条解码线程卡死、队列冻结），
                // 因此官方路径失败后必须能落到另一套真正不同的代码路径（getFrameAtTime 全帧），而不是同一 API 换参数重试。
                int tw = 192;
                int vw = 0, vh = 0;
                try {
                    String mw = r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH);
                    String mh = r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
                    if (mw != null && mh != null) { vw = Integer.parseInt(mw); vh = Integer.parseInt(mh); }
                } catch (Exception ignored) { }
                int th = (vw > 0 && vh > 0) ? Math.max(1, Math.round(vh * tw / (float) vw)) : 108;

                class DecodeStep {
                    android.media.MediaMetadataRetriever rr;
                    DecodeStep(android.media.MediaMetadataRetriever r) { rr = r; }
                    android.graphics.Bitmap scaled(long posUs, int w, int h) {
                        return rr.getScaledFrameAtTime(posUs, android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC, w, h);
                    }
                    android.graphics.Bitmap full(long posUs, int option) {
                        return rr.getFrameAtTime(posUs, option);
                    }
                }
                final DecodeStep step = new DecodeStep(r);

                // runWithTimeout：task 在一次性线程里执行，10s 拿不到结果按挂起处理返回 null
                class Run {
                    android.graphics.Bitmap withTimeout(java.util.concurrent.Callable<android.graphics.Bitmap> task) {
                        java.util.concurrent.Future<android.graphics.Bitmap> f = null;
                        try {
                            f = java.util.concurrent.Executors.newSingleThreadExecutor().submit(task);
                            return f.get(5, java.util.concurrent.TimeUnit.SECONDS);   // v45x：10s 太宽（8 步最坏 80s/文件），5s 足够区分挂起
                        } catch (Exception e) {
                            return null;
                        } finally {
                            if (f != null) f.cancel(true);
                        }
                    }
                }
                final Run run = new Run();

                android.graphics.Bitmap sc = null;
                String failReason = null;
                // 阶梯1：官方 scaled 直解（超时保护）
                if (android.os.Build.VERSION.SDK_INT >= 27) {
                    long[] pos = {0L, 100000L, 1000000L};
                    for (long p : pos) {
                        if (sc != null) break;
                        sc = run.withTimeout(() -> step.scaled(p, tw, th));
                        if (sc == null && p == 0L) failReason = "scaled hang/timeout";
                    }
                }
                // 阶梯2：老全帧路径（代码路径与阶梯1完全不同）
                if (sc == null) {
                    long[] pos = {0L, 100000L, 500000L, 1000000L};
                    for (long p : pos) {
                        if (sc != null) break;
                        sc = run.withTimeout(() -> step.full(p, android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC));
                        if (sc == null && p == 0L) sc = run.withTimeout(() -> step.full(0L, android.media.MediaMetadataRetriever.OPTION_CLOSEST));
                    }
                }
                if (sc == null) { call.reject("无法解码首帧" + (failReason != null ? "（" + failReason + "）" : "")); return; }
                java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                sc.compress(android.graphics.Bitmap.CompressFormat.JPEG, 70, bo);
                int w = sc.getWidth(), h = sc.getHeight();
                sc.recycle();
                JSObject res = new JSObject();
                res.put("jpeg", android.util.Base64.encodeToString(bo.toByteArray(), android.util.Base64.NO_WRAP));
                res.put("width", w);
                res.put("height", h);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("thumb 失败: " + e.getMessage());
            } finally {
                try { r.release(); } catch (Exception ignored) { }
            }
            });
        } catch (Exception e) {
            call.reject("缩略图提交失败: " + e.getMessage());
        }
    }
}
