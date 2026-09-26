package com.mauricioricotti.offbeat;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.mauricioricotti.offbeat.mediascanner.MediaScannerPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registrar los plugins propios ANTES de super.onCreate():
        // super.onCreate() crea el Bridge (load()) y ya no acepta registros.
        registerPlugin(MediaScannerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
