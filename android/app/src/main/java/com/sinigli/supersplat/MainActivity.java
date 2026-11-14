package com.sinigli.supersplat;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // register before super.onCreate: BridgeActivity builds the bridge there
        registerPlugin(SaveImagePlugin.class);
        registerPlugin(ExtractPlugin.class);
        registerPlugin(DebugLogPlugin.class);
        registerPlugin(MediaServerPlugin.class);
        // v68: 10bit H.264 素材本机转码（ffmpeg-kit + MediaCodec）
        registerPlugin(MediaTranscodePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
