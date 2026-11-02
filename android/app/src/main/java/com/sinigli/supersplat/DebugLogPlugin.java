package com.sinigli.supersplat;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;

/**
 * v44 调试日记（真机排障链路，老板 2026-11-02 指定）
 *
 * append(text) → 追加到应用缓存目录 cache/moyutai/debug.log（自带时间戳）
 * read()       → 读回全文（调试弹层展示）
 * clear()      → 清空
 * send()       → SAF CREATE_DOCUMENT 用户挑位置导出（默认 moyutai-debug.log）→ 飞书发回
 *
 * release 版隐藏「🐞 日志」按钮（老板确认的工作流），插件本体保留无害。
 */
@CapacitorPlugin(name = "DebugLog")
public class DebugLogPlugin extends Plugin {

    private static final int REQ_SEND = 4402;
    private PluginCall pendingSend;

    private File logFile(Context ctx) {
        File dir = new File(ctx.getCacheDir(), "moyutai");
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, "debug.log");
    }

    @PluginMethod
    public void append(PluginCall call) {
        String text = call.getString("text", "");
        Context ctx = getContext();
        try (FileOutputStream fos = new FileOutputStream(logFile(ctx), true)) {
            String line = new SimpleDateFormat("MM-dd HH:mm:ss.SSS").format(new Date())
                    + " " + text + "\n";
            fos.write(line.getBytes(StandardCharsets.UTF_8));
            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("path", logFile(ctx).getAbsolutePath());
            call.resolve(res);
        } catch (Exception e) {
            call.reject("append failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        Context ctx = getContext();
        try (FileOutputStream fos = new FileOutputStream(logFile(ctx), false)) {
            fos.write(new byte[0]);
            call.resolve();
        } catch (Exception e) {
            call.reject("clear failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void read(PluginCall call) {
        Context ctx = getContext();
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(
                new InputStreamReader(new FileInputStream(logFile(ctx)), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) sb.append(line).append('\n');
            JSObject res = new JSObject();
            res.put("text", sb.toString());
            call.resolve(res);
        } catch (Exception e) {
            call.reject("read failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void send(PluginCall call) {
        pendingSend = call;
        Activity act = bridge.getActivity();
        Intent it = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        it.addCategory(Intent.CATEGORY_OPENABLE);
        it.setType("text/plain");
        it.putExtra(Intent.EXTRA_TITLE, "moyutai-debug.log");
        try {
            startActivityForResult(call, it, "sendResult");
        } catch (Exception e) {
            pendingSend = null;
            call.reject("no saver: " + e.getMessage());
        }
    }

    @ActivityCallback
    private void sendResult(PluginCall call, ActivityResult result) {
        pendingSend = null;
        if (call == null) return;
        android.content.Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            JSObject res = new JSObject();
            res.put("cancelled", true);
            call.resolve(res);
            return;
        }
        Context ctx = getContext();
        Uri dest = data.getData();
        File src = logFile(ctx);
        try (InputStream in = new FileInputStream(src);
             OutputStream os = ctx.getContentResolver().openOutputStream(dest)) {
            if (os == null) throw new IllegalStateException("output stream null");
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
            os.flush();
            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("bytes", src.length());
            res.put("dest", dest.toString());
            call.resolve(res);
        } catch (Exception e) {
            call.reject("export failed: " + e.getMessage());
        }
    }
}
