package uk.openroad.app;

import android.annotation.SuppressLint;
import android.app.Presentation;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.NonNull;
import androidx.car.app.AppManager;
import androidx.car.app.CarContext;
import androidx.car.app.SurfaceCallback;
import androidx.car.app.SurfaceContainer;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * The map on the car screen: OpenRoad's own map page (assets/car.html) in a WebView, shown on the
 * surface Android Auto gives us. The page also runs navigation and sends the turn card back via carUpdate.
 */
final class CarMap implements SurfaceCallback {
    interface Listener { void onUpdate(JSONObject state); }

    private final CarContext car;
    private final Handler main = new Handler(Looper.getMainLooper());
    private VirtualDisplay display;
    private Presentation presentation;
    private WebView web;
    private boolean loaded = false;
    private final List<String> pending = new ArrayList<>();
    private float density = 1;
    Listener listener;
    JSONObject last;

    CarMap(CarContext car) {
        this.car = car;
        car.getCarService(AppManager.class).setSurfaceCallback(this);
    }

    void js(final String code) {
        main.post(() -> {
            if (web != null && loaded) web.evaluateJavascript(code, null);
            else pending.add(code);
        });
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override public void onSurfaceAvailable(@NonNull SurfaceContainer sc) {
        if (sc.getSurface() == null) return;
        release();
        density = sc.getDpi() / 160f;
        DisplayManager dm = car.getSystemService(DisplayManager.class);
        display = dm.createVirtualDisplay("OpenRoadCar", sc.getWidth(), sc.getHeight(), sc.getDpi(), sc.getSurface(), 0);
        presentation = new Presentation(car, display.getDisplay());
        web = new WebView(presentation.getContext());
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (Tiles.HOST.equals(u.getHost())) return Tiles.get(car).local(u);
                return null;
            }
            @Override public void onPageFinished(WebView v, String url) {
                loaded = true;
                js("carTheme('" + (car.isDarkMode() ? "night" : "day") + "')");
                for (String c : pending) web.evaluateJavascript(c, null);
                pending.clear();
            }
        });
        web.addJavascriptInterface(new CarBridge(), "Android");
        presentation.setContentView(web);
        presentation.show();
        loaded = false;
        new Thread(() -> { Tiles.get(car); main.post(() -> { if (web != null) web.loadUrl("file:///android_asset/car.html"); }); }, "car-map").start();
    }

    @Override public void onVisibleAreaChanged(@NonNull Rect r) { insets(r); }
    @Override public void onStableAreaChanged(@NonNull Rect r) { }
    private int w() { return display == null ? 0 : display.getDisplay().getWidth(); }
    private int h() { return display == null ? 0 : display.getDisplay().getHeight(); }
    @SuppressWarnings("deprecation")
    private void insets(Rect r) {
        if (display == null) return;
        js(String.format(Locale.US, "carInsets(%d,%d,%d,%d)", Math.round(r.left / density), Math.round(r.top / density),
                Math.round((w() - r.right) / density), Math.round((h() - r.bottom) / density)));
    }

    @Override public void onSurfaceDestroyed(@NonNull SurfaceContainer sc) { release(); }

    private void release() {
        loaded = false;
        if (web != null) { try { web.destroy(); } catch (Exception ignored) { } web = null; }
        if (presentation != null) { try { presentation.dismiss(); } catch (Exception ignored) { } presentation = null; }
        if (display != null) { display.release(); display = null; }
    }

    void destroy() { release(); }

    /** The web page's bridge on the car: the shared one, plus the turn card going back to Android Auto. */
    private final class CarBridge extends CoreBridge {
        CarBridge() { super(car, CarMap.this::js); }
        @JavascriptInterface public void keepScreenOn(boolean on) { }
        @JavascriptInterface public void carUpdate(final String json) {
            main.post(() -> {
                try { last = new JSONObject(json); if (listener != null) listener.onUpdate(last); } catch (Exception ignored) { }
            });
        }
    }
}
