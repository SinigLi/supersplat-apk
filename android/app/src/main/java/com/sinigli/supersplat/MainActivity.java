package com.sinigli.supersplat;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // register before super.onCreate: BridgeActivity builds the bridge there
        registerPlugin(SaveImagePlugin.class);
        registerPlugin(ExtractPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
