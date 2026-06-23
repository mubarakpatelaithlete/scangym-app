package com.scangym.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * ScanGym Main Activity — Capacitor bridge to PWA
 * 
 * The app loads the web app from frontend/public/ via Capacitor's WebView.
 * All native features (camera, geolocation, push notifications) are handled
 * through Capacitor plugins configured in capacitor.config.ts.
 */
public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }
}