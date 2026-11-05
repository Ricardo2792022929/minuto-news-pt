package com.flashnoticias.app;

import android.media.MediaPlayer;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.FrameLayout;
import android.widget.VideoView;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // Tempo sem rede antes de mostrar "Sem ligação" a meio do uso (evita saltar em quebras curtas, ex.: elevador, troca Wi-Fi/dados).
    private static final long OFFLINE_GRACE_MS = 4000;

    private boolean introOn = true;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private ConnectivityManager.NetworkCallback networkCallback;
    private final Runnable showOfflineIfStillDown = () -> {
        if (!isOnline()) showOffline();
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        hideBars();
        bridge.getWebView().setBackgroundColor(android.graphics.Color.BLACK);
        // Sem rede: abre logo a página local "Sem ligação" (servida dos assets da app).
        if (!isOnline()) showOffline();
        watchNetwork();

        FullVideo video = new FullVideo(this);
        video.setVideoURI(Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.intro));
        video.setOnPreparedListener(mp -> {
            video.setBackgroundColor(android.graphics.Color.TRANSPARENT);
            mp.setVideoScalingMode(MediaPlayer.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING);
            hideBars();
            video.start();
        });
        video.setOnCompletionListener(mp -> finishIntro(video));
        video.setOnErrorListener((mp, what, extra) -> {
            finishIntro(video);
            return true;
        });
        addContentView(video, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
    }

    /** Há internet a sério: a rede existe e o Android confirmou que chega à internet (exclui Wi-Fi de hotel com login). */
    private boolean isOnline() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (cm == null) return true;
        Network network = cm.getActiveNetwork();
        if (network == null) return false;
        return hasInternet(cm.getNetworkCapabilities(network));
    }

    private static boolean hasInternet(NetworkCapabilities caps) {
        return caps != null
                && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
    }

    /**
     * Segue a rede enquanto a app está aberta: se cair (e não voltar em poucos segundos) mostra "Sem ligação";
     * quando volta e o ecrã "Sem ligação" está aberto, recarrega o site sozinho.
     * Os avisos chegam na thread principal (mainHandler), por isso podem mexer na WebView.
     */
    private void watchNetwork() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (cm == null) return;
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onCapabilitiesChanged(Network network, NetworkCapabilities caps) {
                if (hasInternet(caps)) {
                    mainHandler.removeCallbacks(showOfflineIfStillDown);
                    if (isShowingOffline()) reloadSite();
                } else {
                    scheduleOfflineCheck();
                }
            }

            @Override
            public void onLost(Network network) {
                scheduleOfflineCheck();
            }
        };
        try {
            cm.registerDefaultNetworkCallback(networkCallback, mainHandler);
        } catch (RuntimeException e) {
            // Sem permissão ou demasiados callbacks: fica só a verificação do arranque e a página de erro.
            networkCallback = null;
        }
    }

    private void scheduleOfflineCheck() {
        mainHandler.removeCallbacks(showOfflineIfStillDown);
        mainHandler.postDelayed(showOfflineIfStillDown, OFFLINE_GRACE_MS);
    }

    private boolean isShowingOffline() {
        String current = bridge.getWebView().getUrl();
        return current != null && current.contains("offline.html");
    }

    private void showOffline() {
        // getLocalUrl() aponta para o site remoto quando há server.url, por isso usa-se getErrorUrl().
        String offlineUrl = bridge.getErrorUrl();
        if (offlineUrl != null && !isShowingOffline()) {
            bridge.getWebView().loadUrl(offlineUrl);
        }
    }

    private void reloadSite() {
        String site = bridge.getServerUrl();
        if (site != null) bridge.getWebView().loadUrl(site);
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacks(showOfflineIfStillDown);
        if (networkCallback != null) {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            try {
                if (cm != null) cm.unregisterNetworkCallback(networkCallback);
            } catch (RuntimeException ignored) {
                // Já não estava registado.
            }
            networkCallback = null;
        }
        super.onDestroy();
    }

    private void finishIntro(View video) {
        introOn = false;
        showBars();
        if (video.getParent() instanceof ViewGroup) {
            ((ViewGroup) video.getParent()).removeView(video);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && introOn) hideBars();
    }

    private void hideBars() {
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        }
    }

    private void showBars() {
        getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    static class FullVideo extends VideoView {
        FullVideo(android.content.Context context) {
            super(context);
        }

        @Override
        protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
            setMeasuredDimension(
                    View.MeasureSpec.getSize(widthMeasureSpec),
                    View.MeasureSpec.getSize(heightMeasureSpec)
            );
        }
    }
}