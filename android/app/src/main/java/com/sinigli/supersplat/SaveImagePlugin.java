package com.sinigli.supersplat;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Saves a PNG data URL into the device gallery.
 *
 * The web layer cannot do this: WebView silently ignores programmatic
 * downloads, and long-press on our own overlay never reaches the system save
 * sheet. Writing through MediaStore from the shell is the only reliable path.
 */
@CapacitorPlugin(name = "SaveImage")
public class SaveImagePlugin extends Plugin {

    @PluginMethod
    public void save(PluginCall call) {
        String dataUrl = call.getString("data");
        String filename = call.getString("filename", "shot.png");

        if (dataUrl == null || dataUrl.isEmpty()) {
            call.reject("missing image data");
            return;
        }

        try {
            int comma = dataUrl.indexOf(',');
            String b64 = comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl;
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);

            String base = filename.endsWith(".png")
                    ? filename.substring(0, filename.length() - 4)
                    : filename;
            if (base.isEmpty()) base = "shot";

            String displayName = base + ".png";
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
                // pre-Q: no scoped storage, write to the public Pictures folder
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
                // let the gallery notice it
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
}
