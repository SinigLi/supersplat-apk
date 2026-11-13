package com.sinigli.supersplat;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.util.ArrayList;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Image output for rendered stills.
 *
 * The web layer cannot do any of this: WebView silently ignores programmatic
 * downloads and long-press on our overlay never opens the system save sheet.
 * So the shell offers the three things a phone user actually expects:
 *
 *   save   -> straight into the gallery (no picker)
 *   saveAs -> the system "save as" document picker, user picks the folder
 *   share  -> the system share sheet (WeChat, mail, drive, ...)
 */
@CapacitorPlugin(
        name = "SaveImage",
        permissions = @Permission(
                strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE },
                alias = "storage"
        )
)
public class SaveImagePlugin extends Plugin {

    // held between launching the document picker and its result
    private byte[] pendingBytes;
    private String pendingName;

    // ----- save straight to the gallery -----

    @PluginMethod
    public void save(PluginCall call) {
        if (call.getString("data") == null || call.getString("data").isEmpty()) {
            call.reject("missing image data");
            return;
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storagePermissionCallback");
            return;
        }

        writeToGallery(call);
    }

    @PermissionCallback
    private void storagePermissionCallback(PluginCall call) {
        if (getPermissionState("storage") == PermissionState.GRANTED) {
            writeToGallery(call);
        } else {
            call.reject("存储权限被拒绝，无法保存到相册");
        }
    }

    private void writeToGallery(PluginCall call) {
        String dataUrl = call.getString("data");
        String filename = call.getString("filename", "shot.png");

        try {
            byte[] bytes = decode(dataUrl);
            String displayName = normalizeName(filename);
            Uri uri;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver resolver = getContext().getContentResolver();
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, displayName);
                values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                values.put(MediaStore.Images.Media.RELATIVE_PATH,
                        Environment.DIRECTORY_PICTURES + "/摸鱼台");
                values.put(MediaStore.Images.Media.IS_PENDING, 1);

                uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (uri == null) {
                    call.reject("could not create a gallery entry");
                    return;
                }

                try (OutputStream out = resolver.openOutputStream(uri)) {
                    if (out == null) {
                        call.reject("could not open the gallery stream");
                        return;
                    }
                    out.write(bytes);
                    out.flush();
                }

                ContentValues done = new ContentValues();
                done.put(MediaStore.Images.Media.IS_PENDING, 0);
                resolver.update(uri, done, null, null);
            } else {
                File dir = new File(
                        Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES),
                        "摸鱼台");
                if (!dir.exists() && !dir.mkdirs()) {
                    call.reject("could not create Pictures/Moyutai");
                    return;
                }
                File file = new File(dir, displayName);
                try (OutputStream out = new FileOutputStream(file)) {
                    out.write(bytes);
                    out.flush();
                }
                android.media.MediaScannerConnection.scanFile(
                        getContext(), new String[]{ file.getAbsolutePath() }, new String[]{ "image/png" }, null);
                uri = Uri.fromFile(file);
            }

            JSObject res = new JSObject();
            res.put("uri", uri.toString());
            res.put("bytes", bytes.length);
            res.put("name", displayName);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("save failed: " + e.getMessage(), e);
        }
    }

    // ----- save as: system document picker -----

    @PluginMethod
    public void saveAs(PluginCall call) {
        String dataUrl = call.getString("data");
        if (dataUrl == null || dataUrl.isEmpty()) {
            call.reject("missing image data");
            return;
        }

        try {
            pendingBytes = decode(dataUrl);
            pendingName = normalizeName(call.getString("filename", "shot.png"));
        } catch (Exception e) {
            call.reject("decode failed: " + e.getMessage(), e);
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/png");
        intent.putExtra(Intent.EXTRA_TITLE, pendingName);

        startActivityForResult(call, intent, "saveAsResult");
    }

    @ActivityCallback
    private void saveAsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        byte[] bytes = pendingBytes;
        String name = pendingName;
        pendingBytes = null;
        pendingName = null;

        if (result.getResultCode() != android.app.Activity.RESULT_OK || bytes == null) {
            call.reject("cancelled");
            return;
        }

        Intent data = result.getData();
        Uri uri = data != null ? data.getData() : null;
        if (uri == null) {
            call.reject("no destination returned");
            return;
        }

        try (OutputStream out = getContext().getContentResolver().openOutputStream(uri)) {
            if (out == null) {
                call.reject("could not open the chosen destination");
                return;
            }
            out.write(bytes);
            out.flush();
        } catch (Exception e) {
            call.reject("write failed: " + e.getMessage(), e);
            return;
        }

        JSObject res = new JSObject();
        res.put("uri", uri.toString());
        res.put("bytes", bytes.length);
        res.put("name", name);
        call.resolve(res);
    }

    // ----- share: system share sheet -----

    @PluginMethod
    public void share(PluginCall call) {
        String dataUrl = call.getString("data");
        if (dataUrl == null || dataUrl.isEmpty()) {
            call.reject("missing image data");
            return;
        }

        try {
            byte[] bytes = decode(dataUrl);
            String name = normalizeName(call.getString("filename", "shot.png"));

            // FileProvider can only serve paths declared in file_paths.xml; the
            // cache dir is already granted there.
            File dir = new File(getContext().getCacheDir(), "shared");
            if (!dir.exists() && !dir.mkdirs()) {
                call.reject("could not create the share cache");
                return;
            }
            File file = new File(dir, name);
            try (OutputStream out = new FileOutputStream(file)) {
                out.write(bytes);
                out.flush();
            }

            String authority = getContext().getPackageName() + ".fileprovider";
            Uri uri = FileProvider.getUriForFile(getContext(), authority, file);

            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(shareMime(call.getString("mime"), "image/png"));
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, name);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Intent chooser = Intent.createChooser(send, "分享照片");
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);

            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("name", name);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("share failed: " + e.getMessage(), e);
        }
    }

    // ----- v45 shareFile: 任意小文件（JSON 导出等）走系统分享；与 share 的区别：
    // 不强制 .png 后缀、mime 可指定（白名单内）、data 为裸 base64（无 dataUrl 前缀） -----

    @PluginMethod
    public void shareFile(PluginCall call) {
        String b64 = call.getString("data");
        String filename = call.getString("filename", "export.bin");
        if (b64 == null || b64.isEmpty()) { call.reject("missing data"); return; }
        try {
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            String name = sanitizeName(filename);

            File dir = new File(getContext().getCacheDir(), "shared");
            if (!dir.exists() && !dir.mkdirs()) { call.reject("could not create the share cache"); return; }
            File file = new File(dir, name);
            try (OutputStream out = new FileOutputStream(file)) {
                out.write(bytes);
                out.flush();
            }

            String authority = getContext().getPackageName() + ".fileprovider";
            Uri uri = FileProvider.getUriForFile(getContext(), authority, file);

            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(shareMime(call.getString("mime"), "application/octet-stream"));
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, name);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Intent chooser = Intent.createChooser(send, "分享文件");
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);

            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("name", name);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("share failed: " + e.getMessage(), e);
        }
    }

    // ----- v63 sharePaths: 一次分享多个文件（分卷导出用） -----
    // 参数 names: 提交前已写进 CacheDirectory/shared/ 的文件名列表（纯文件名，不带路径）
    // 走 ACTION_SEND_MULTIPLE，收件方在同一条消息里拿到全部卷；
    // 卷名保持 <原名>.001/.002…，解压中心的 stripVolume 能直接拼回原文件。

    @PluginMethod
    public void sharePaths(PluginCall call) {
        JSArray arr = call.getArray("names");
        if (arr == null || arr.length() == 0) { call.reject("missing names"); return; }
        try {
            File dir = new File(getContext().getCacheDir(), "shared");
            if (!dir.exists() && !dir.mkdirs()) { call.reject("could not create the share cache"); return; }

            ArrayList<Uri> uris = new ArrayList<>();
            ArrayList<String> missing = new ArrayList<>();
            for (int i = 0; i < arr.length(); i++) {
                String name = sanitizeName(arr.getString(i));
                File f = new File(dir, name);
                if (!f.exists() || f.length() == 0) { missing.add(name); continue; }
                uris.add(FileProvider.getUriForFile(getContext(),
                        getContext().getPackageName() + ".fileprovider", f));
            }
            if (uris.isEmpty()) { call.reject("files not found: " + joinComma(missing)); return; }

            String mime = shareMime(call.getString("mime"), "application/octet-stream");
            Intent send = new Intent(uris.size() == 1 ? Intent.ACTION_SEND : Intent.ACTION_SEND_MULTIPLE);
            send.setType(mime);
            if (uris.size() == 1) {
                send.putExtra(Intent.EXTRA_STREAM, uris.get(0));
            } else {
                send.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
            }
            send.putExtra(Intent.EXTRA_SUBJECT, uris.size() + " files");
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Intent chooser = Intent.createChooser(send, "分享文件");
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);

            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("count", uris.size());
            res.put("missing", joinComma(missing));
            call.resolve(res);
        } catch (Exception e) {
            call.reject("sharePaths failed: " + e.getMessage(), e);
        }
    }

    // ----- helpers -----

    /** v63：String.join 是 API 26+，minSdk 23 用不了；手写逗号拼接 */
    private String joinComma(ArrayList<String> list) {
        if (list == null || list.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        for (String s : list) {
            if (sb.length() > 0) sb.append(',');
            sb.append(s);
        }
        return sb.toString();
    }

    /** 分享文件名消毒：保留调用方给的扩展名，只去文件系统非法字符 */
    private String sanitizeName(String filename) {
        String base = filename == null ? "" : filename;
        base = base.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        if (base.isEmpty()) base = "export.bin";
        return base;
    }

    /** v45：mime 白名单（空/未知回退 image/png，保持既有行为） */
    private String shareMime(String mime, String fallback) {
        if (mime == null || mime.isEmpty()) return fallback;
        String m = mime.toLowerCase();
        if (m.matches("[a-z]+/[a-z0-9.+-]+")) return m;
        return fallback;
    }

    private byte[] decode(String dataUrl) {
        int comma = dataUrl.indexOf(',');
        String b64 = comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl;
        return Base64.decode(b64, Base64.DEFAULT);
    }

    private String normalizeName(String filename) {
        String base = filename == null ? "" : filename;
        if (base.endsWith(".png")) base = base.substring(0, base.length() - 4);
        // a shot name becomes a file name: drop separators the FS would reject
        base = base.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        if (base.isEmpty()) base = "shot";
        return base + ".png";
    }
}
