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
                        Environment.DIRECTORY_PICTURES + "/SuperSplat");
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
                        "SuperSplat");
                if (!dir.exists() && !dir.mkdirs()) {
                    call.reject("could not create Pictures/SuperSplat");
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
            send.setType("image/png");
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

    // ----- helpers -----

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
