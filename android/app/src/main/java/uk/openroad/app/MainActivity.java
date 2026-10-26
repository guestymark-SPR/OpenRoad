package uk.openroad.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.ConnectivityManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Looper;
import android.provider.MediaStore;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.GZIPInputStream;

/**
 * OpenRoad: the web app (assets/index.html) in a full-screen WebView, plus what a browser can't do:
 * offline map packs and tile cache, network without CORS limits, spoken directions over the helmet
 * headset, GPS with the screen off (RideService), safety check-in texts (CheckIn), files and updates.
 */
public class MainActivity extends Activity {

    static final String HOST = "openroad.maps";
    static final String UA = "OpenRoad/1.0 (Android motorcycle navigation; github.com/guestymark-SPR/OpenRoad)";
    static final String TILEJSON = "https://tiles.openfreemap.org/planet";
    private static final int REQ_PERMS = 7, REQ_FILE = 42, REQ_SMS = 8;

    private WebView web;
    private WebView printView; // kept so it isn't collected while printing
    private LocationManager lm;
    private boolean wantGps = false;
    private ValueCallback<Uri[]> fileCallback;
    private File kvDir, packDir, tileDir;
    private final ExecutorService netPool = Executors.newFixedThreadPool(4);
    private final ExecutorService tilePool = Executors.newFixedThreadPool(4);

    // offline map packs (MBTiles)
    private static class Pack { String id, name; double[] b; int minz = 0, maxz = 14; long size; SQLiteDatabase db; }
    private final List<Pack> packs = new ArrayList<>();
    // recent tiles kept in memory
    private long memBytes = 0;
    private static final long MEM_MAX = 48L * 1024 * 1024;
    private final LinkedHashMap<String, byte[]> mem = new LinkedHashMap<>(512, 0.75f, true);
    private volatile String tileTemplate;

    // voice
    private TextToSpeech tts;
    private volatile boolean ttsReady;
    private final List<String> ttsQueue = new ArrayList<>();
    private AudioManager audio;
    private AudioFocusRequest focusReq;

    private final LocationListener gps = new LocationListener() {
        @Override public void onLocationChanged(Location l) {
            js(String.format(Locale.US, "window.onNativeFix&&onNativeFix({coords:{latitude:%.7f,longitude:%.7f,speed:%s,heading:%s,accuracy:%.1f},timestamp:%d})",
                    l.getLatitude(), l.getLongitude(), l.hasSpeed() ? String.valueOf(l.getSpeed()) : "null",
                    l.hasBearing() ? String.valueOf(l.getBearing()) : "null", l.getAccuracy(), System.currentTimeMillis()));
        }
        @Override public void onProviderEnabled(String p) { }
        @Override public void onProviderDisabled(String p) { js("window.onGpsError&&onGpsError('Location is switched off. Turn it on in quick settings.')"); }
        @SuppressWarnings("deprecation") @Override public void onStatusChanged(String p, int s, Bundle b) { }
    };

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        kvDir = new File(getFilesDir(), "kv"); kvDir.mkdirs();
        packDir = new File(getFilesDir(), "maps"); packDir.mkdirs();
        tileDir = new File(getFilesDir(), "tiles"); tileDir.mkdirs();
        lm = (LocationManager) getSystemService(LOCATION_SERVICE);
        audio = (AudioManager) getSystemService(AUDIO_SERVICE);
        tileTemplate = getSharedPreferences("net", MODE_PRIVATE).getString("tiles", null);

        web = new WebView(this);
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        if (Build.VERSION.SDK_INT >= 26) web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        setContentView(web);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);

        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (HOST.equals(u.getHost())) return local(u);
                return null;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                String sc = u.getScheme() == null ? "" : u.getScheme();
                if (sc.equals("file")) return false;
                try {
                    if (sc.equals("tel")) startActivity(new Intent(Intent.ACTION_DIAL, u));
                    else if (sc.equals("sms") || sc.equals("smsto")) startActivity(new Intent(Intent.ACTION_SENDTO, u));
                    else startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) { }
                return true;
            }
            @Override public void onPageFinished(WebView v, String url) { openFromIntent(getIntent()); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                try { startActivityForResult(Intent.createChooser(i, "Open a GPX file"), REQ_FILE); } catch (Exception e) { fileCallback = null; return false; }
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "Android");
        new Thread(() -> { openPacks(); runOnUiThread(() -> web.loadUrl("file:///android_asset/index.html")); }, "maps").start();
        askPermissions();
    }

    // ---------- permissions & GPS ----------
    private boolean hasLocation() { return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED; }

    private void askPermissions() {
        List<String> p = new ArrayList<>();
        if (!hasLocation()) { p.add(Manifest.permission.ACCESS_FINE_LOCATION); p.add(Manifest.permission.ACCESS_COARSE_LOCATION); }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) p.add(Manifest.permission.POST_NOTIFICATIONS);
        if (!p.isEmpty()) requestPermissions(p.toArray(new String[0]), REQ_PERMS);
    }

    @SuppressLint("MissingPermission")
    private void startGps() {
        wantGps = true;
        if (!hasLocation()) { askPermissions(); return; }
        try {
            lm.removeUpdates(gps);
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, gps, Looper.getMainLooper());
            Location last = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            if (last != null && System.currentTimeMillis() - last.getTime() < 60000) gps.onLocationChanged(last);
            if (!lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) js("window.onGpsError&&onGpsError('Location is switched off. Turn it on in quick settings.')");
        } catch (Exception e) { js("window.onGpsError&&onGpsError(" + JSONObject.quote("GPS could not start: " + e.getMessage()) + ")"); }
    }

    private void stopGps() { wantGps = false; try { lm.removeUpdates(gps); } catch (Exception ignored) { } }

    @Override public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        if (code == REQ_PERMS && hasLocation() && wantGps) startGps();
        if (code == REQ_PERMS && !hasLocation()) js("window.onGpsError&&onGpsError('Location permission was refused. Allow it in Settings > Apps > OpenRoad > Permissions.')");
    }

    @Override protected void onResume() { super.onResume(); if (wantGps) startGps(); }
    @Override protected void onPause() { super.onPause(); if (!RideService.running) { try { lm.removeUpdates(gps); } catch (Exception ignored) { } } }

    @Override protected void onNewIntent(Intent i) { super.onNewIntent(i); setIntent(i); openFromIntent(i); }

    // a GPX file opened from Files, email or another app
    private void openFromIntent(Intent i) {
        if (i == null || i.getData() == null || i.getBooleanExtra("handled", false)) return;
        if (!Intent.ACTION_VIEW.equals(i.getAction()) && !Intent.ACTION_SEND.equals(i.getAction())) return;
        i.putExtra("handled", true);
        final Uri u = i.getData();
        netPool.submit(() -> {
            try (InputStream in = getContentResolver().openInputStream(u)) {
                String text = readAll(in);
                String name = u.getLastPathSegment() == null ? "route.gpx" : u.getLastPathSegment();
                js("window.onGpxFile&&onGpxFile(" + JSONObject.quote(name) + "," + JSONObject.quote(text) + ")");
            } catch (Exception e) { toast("Could not open that file"); }
        });
    }

    @Override protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (req == REQ_FILE && fileCallback != null) {
            Uri u = result == RESULT_OK && data != null ? data.getData() : null;
            fileCallback.onReceiveValue(u == null ? null : new Uri[]{u});
            fileCallback = null;
        }
    }

    @Override public void onBackPressed() {
        web.evaluateJavascript("(function(){var s=document.getElementById('sheet');if(s&&!s.hidden){s.hidden=true;return 1}var p=document.getElementById('panel');if(p&&p.classList.contains('open')&&innerWidth<900){p.classList.remove('open');return 1}return 0})()",
                v -> { if (!"1".equals(v)) moveTaskToBack(true); });
    }

    // ---------- map tiles: packs, then saved tiles, then the internet ----------
    private WebResourceResponse local(Uri u) {
        List<String> seg = u.getPathSegments();
        Map<String, String> h = new HashMap<>();
        h.put("Access-Control-Allow-Origin", "*");
        try {
            if (seg.size() == 4 && "t".equals(seg.get(0))) {
                int z = Integer.parseInt(seg.get(1)), x = Integer.parseInt(seg.get(2)), y = Integer.parseInt(seg.get(3).replace(".pbf", ""));
                byte[] d = tile(z, x, y, true);
                if (d == null) return new WebResourceResponse("application/x-protobuf", null, 204, "No Content", h, new ByteArrayInputStream(new byte[0]));
                return new WebResourceResponse("application/x-protobuf", null, 200, "OK", h, new ByteArrayInputStream(d));
            }
            if (seg.size() == 3 && "glyphs".equals(seg.get(0))) {
                String font = seg.get(1).split(",")[0].trim();
                try { return new WebResourceResponse("application/x-protobuf", null, 200, "OK", h, getAssets().open("glyphs/" + font + "/" + seg.get(2))); }
                catch (Exception missing) { return new WebResourceResponse("application/x-protobuf", null, 200, "OK", h, new ByteArrayInputStream(new byte[0])); }
            }
        } catch (Exception ignored) { }
        return new WebResourceResponse("text/plain", null, 404, "Not Found", h, new ByteArrayInputStream(new byte[0]));
    }

    private byte[] tile(int z, int x, int y, boolean net) {
        String key = z + "/" + x + "/" + y;
        byte[] d = memGet(key);
        if (d != null) return d;
        d = packTile(z, x, y);
        File f = new File(tileDir, z + "/" + x + "/" + y + ".pbf");
        if (d == null && f.exists()) { try (InputStream in = new FileInputStream(f)) { d = readBytes(in); } catch (Exception ignored) { } }
        if (d == null && net) {
            d = download(z, x, y);
            if (d != null) { f.getParentFile().mkdirs(); try (OutputStream o = new FileOutputStream(f)) { o.write(d); } catch (Exception ignored) { } }
        }
        if (d != null) d = gunzip(d);
        if (d != null) memPut(key, d);
        return d;
    }

    private String template() {
        if (tileTemplate != null) return tileTemplate;
        try {
            JSONObject j = new JSONObject(httpText(TILEJSON));
            tileTemplate = j.getJSONArray("tiles").getString(0);
            getSharedPreferences("net", MODE_PRIVATE).edit().putString("tiles", tileTemplate).apply();
        } catch (Exception ignored) { }
        return tileTemplate;
    }

    private byte[] download(int z, int x, int y) {
        String t = template();
        if (t == null) return null;
        for (int attempt = 0; attempt < 2; attempt++) {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(t.replace("{z}", "" + z).replace("{x}", "" + x).replace("{y}", "" + y)).openConnection();
                c.setConnectTimeout(8000); c.setReadTimeout(20000); c.setRequestProperty("User-Agent", UA);
                int code = c.getResponseCode();
                if (code == 200) { try (InputStream in = c.getInputStream()) { return readBytes(in); } }
                if (code == 204) return new byte[0];
                if (code == 404 && attempt == 0) { // the map was updated and the old version retired: get the new address
                    tileTemplate = null; getSharedPreferences("net", MODE_PRIVATE).edit().remove("tiles").apply();
                    if (template() == null) return null;
                    continue;
                }
                return null;
            } catch (Exception e) { return null; } finally { if (c != null) c.disconnect(); }
        }
        return null;
    }

    private synchronized void openPacks() {
        for (Pack p : packs) try { p.db.close(); } catch (Exception ignored) { }
        packs.clear();
        File[] fs = packDir.listFiles();
        if (fs == null) return;
        for (File f : fs) {
            if (!f.getName().endsWith(".mbtiles")) continue;
            try {
                Pack p = new Pack();
                p.db = SQLiteDatabase.openDatabase(f.getPath(), null, SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS);
                p.id = f.getName().replace(".mbtiles", ""); p.name = p.id; p.size = f.length();
                try (Cursor c = p.db.rawQuery("SELECT name, value FROM metadata", null)) {
                    while (c.moveToNext()) {
                        String k = c.getString(0), v = c.getString(1);
                        if ("openroad_name".equals(k)) p.name = v;
                        else if ("minzoom".equals(k)) p.minz = Integer.parseInt(v.trim());
                        else if ("maxzoom".equals(k)) p.maxz = Integer.parseInt(v.trim());
                        else if ("bounds".equals(k)) { String[] q = v.split(","); p.b = new double[]{Double.parseDouble(q[0]), Double.parseDouble(q[1]), Double.parseDouble(q[2]), Double.parseDouble(q[3])}; }
                    }
                }
                packs.add(p);
            } catch (Exception ignored) { }
        }
    }

    private static double tileLon(int x, int z) { return x / Math.pow(2, z) * 360.0 - 180; }
    private static double tileLat(int y, int z) { double n = Math.PI - 2 * Math.PI * y / Math.pow(2, z); return Math.toDegrees(Math.atan(Math.sinh(n))); }

    private byte[] packTile(int z, int x, int y) {
        double w = tileLon(x, z), e = tileLon(x + 1, z), n = tileLat(y, z), s = tileLat(y + 1, z);
        int tms = (1 << z) - 1 - y;
        synchronized (this) {
            // where packs overlap (borders, split countries) use the one that covers most of this tile
            Pack best = null; double bestCover = -1;
            List<Pack> cand = new ArrayList<>();
            for (Pack p : packs) {
                if (z < p.minz || z > p.maxz) continue;
                if (p.b != null && (e < p.b[0] || w > p.b[2] || n < p.b[1] || s > p.b[3])) continue;
                cand.add(p);
            }
            cand.sort((a, b) -> Double.compare(cover(b, w, e, n, s), cover(a, w, e, n, s)));
            for (Pack p : cand) {
                try (Cursor c = p.db.rawQuery("SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?",
                        new String[]{String.valueOf(z), String.valueOf(x), String.valueOf(tms)})) {
                    if (c.moveToFirst()) return c.getBlob(0);
                } catch (Exception ignored) { }
            }
        }
        return null;
    }
    private static double cover(Pack p, double w, double e, double n, double s) {
        if (p.b == null) return 1;
        return Math.max(0, Math.min(e, p.b[2]) - Math.max(w, p.b[0])) * Math.max(0, Math.min(n, p.b[3]) - Math.max(s, p.b[1]));
    }

    private static byte[] gunzip(byte[] d) {
        if (d.length > 2 && (d[0] & 0xFF) == 0x1F && (d[1] & 0xFF) == 0x8B) {
            try (GZIPInputStream gz = new GZIPInputStream(new ByteArrayInputStream(d))) { return readBytes(gz); } catch (Exception e) { return null; }
        }
        return d;
    }

    private byte[] memGet(String k) { synchronized (mem) { return mem.get(k); } }
    private void memPut(String k, byte[] v) {
        synchronized (mem) {
            byte[] old = mem.put(k, v);
            memBytes += v.length - (old == null ? 0 : old.length);
            java.util.Iterator<Map.Entry<String, byte[]>> it = mem.entrySet().iterator();
            while (memBytes > MEM_MAX && it.hasNext()) { memBytes -= it.next().getValue().length; it.remove(); }
        }
    }

    // ---------- voice: over the helmet headset, turning music down while it speaks ----------
    private void speakNow(String text) {
        if (tts == null) {
            synchronized (ttsQueue) { ttsQueue.add(text); }
            tts = new TextToSpeech(this, st -> {
                if (st != TextToSpeech.SUCCESS) return;
                tts.setLanguage(Locale.UK);
                tts.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) { }
                    @Override public void onDone(String id) { if (!tts.isSpeaking()) releaseFocus(); }
                    @Override public void onError(String id) { releaseFocus(); }
                });
                ttsReady = true;
                synchronized (ttsQueue) { for (String q : ttsQueue) say(q); ttsQueue.clear(); }
            });
            return;
        }
        if (!ttsReady) { synchronized (ttsQueue) { ttsQueue.add(text); } return; }
        say(text);
    }
    private void say(String text) {
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                focusReq = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                        .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()).build();
                audio.requestAudioFocus(focusReq);
            }
        } catch (Exception ignored) { }
        tts.speak(text, TextToSpeech.QUEUE_ADD, null, "or" + System.nanoTime());
    }
    private void releaseFocus() { try { if (Build.VERSION.SDK_INT >= 26 && focusReq != null) audio.abandonAudioFocusRequest(focusReq); } catch (Exception ignored) { } }

    // ---------- helpers ----------
    private void js(final String code) { runOnUiThread(() -> web.evaluateJavascript(code, null)); }
    private void toast(final String t) { runOnUiThread(() -> Toast.makeText(this, t, Toast.LENGTH_LONG).show()); }
    static byte[] readBytes(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream(); byte[] buf = new byte[16384]; int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        return bo.toByteArray();
    }
    static String readAll(InputStream in) throws java.io.IOException { return new String(readBytes(in), StandardCharsets.UTF_8); }
    static String httpText(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10000); c.setReadTimeout(20000); c.setRequestProperty("User-Agent", UA);
        try (InputStream in = c.getInputStream()) { return readAll(in); } finally { c.disconnect(); }
    }
    private boolean unmetered() {
        try { ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE); return cm != null && !cm.isActiveNetworkMetered(); } catch (Exception e) { return false; }
    }
    private long dirSize(File f, int[] count) {
        if (f.isFile()) { count[0]++; return f.length(); }
        long s = 0; File[] k = f.listFiles(); if (k != null) for (File c : k) s += dirSize(c, count); return s;
    }
    private void deleteTree(File f) { File[] k = f.listFiles(); if (k != null) for (File c : k) deleteTree(c); f.delete(); }

    // ---------- the bridge the web app calls (window.Android) ----------
    private class Bridge {
        @JavascriptInterface public boolean isNative() { return true; }
        @JavascriptInterface public String version() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
        }
        @JavascriptInterface public int versionCode() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionCode; } catch (Exception e) { return 0; }
        }

        private File kvFile(String k) { return new File(kvDir, k.replaceAll("[^A-Za-z0-9_.-]", "_")); }
        @JavascriptInterface public String kvGet(String k) {
            File f = kvFile(k); if (!f.exists()) return null;
            try (InputStream in = new FileInputStream(f)) { return readAll(in); } catch (Exception e) { return null; }
        }
        @JavascriptInterface public void kvSet(String k, String v) {
            File f = kvFile(k), tmp = new File(f.getPath() + ".tmp");
            try (OutputStream o = new FileOutputStream(tmp)) { o.write(v.getBytes(StandardCharsets.UTF_8)); } catch (Exception e) { return; }
            tmp.renameTo(f);
        }

        @JavascriptInterface public void fetchTextH(final int id, final String url, final String method, final String body, final String type, final String headers) {
            netPool.submit(() -> {
                int code = 0; String out = ""; HttpURLConnection c = null;
                try {
                    c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(12000); c.setReadTimeout(80000);
                    c.setRequestProperty("User-Agent", UA);
                    if (headers != null && !headers.isEmpty()) {
                        JSONObject h = new JSONObject(headers); java.util.Iterator<String> it = h.keys();
                        while (it.hasNext()) { String k = it.next(); c.setRequestProperty(k, h.optString(k)); }
                    }
                    if ("POST".equalsIgnoreCase(method)) {
                        c.setRequestMethod("POST"); c.setDoOutput(true);
                        c.setRequestProperty("Content-Type", type == null || type.isEmpty() ? "application/json" : type);
                        try (OutputStream o = c.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
                    }
                    code = c.getResponseCode();
                    InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                    if (in != null) try (InputStream is = in) { out = readAll(is); }
                } catch (Exception e) { code = 0; out = e.getMessage() == null ? "" : e.getMessage(); }
                finally { if (c != null) c.disconnect(); }
                js("window.onFetch&&onFetch(" + id + "," + code + "," + JSONObject.quote(out) + ")");
            });
        }

        @JavascriptInterface public void speak(String text) { runOnUiThread(() -> speakNow(text)); }
        @JavascriptInterface public void stopSpeak() { runOnUiThread(() -> { if (tts != null) tts.stop(); releaseFocus(); }); }

        @JavascriptInterface public void startGps() { runOnUiThread(MainActivity.this::startGps); }
        @JavascriptInterface public void stopGps() { runOnUiThread(MainActivity.this::stopGps); }
        @JavascriptInterface public void keepScreenOn(final boolean on) {
            runOnUiThread(() -> { if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); });
        }

        // ride recording that carries on with the screen off
        @JavascriptInterface public void rideStart(String name) {
            runOnUiThread(() -> {
                Intent i = new Intent(MainActivity.this, RideService.class).setAction(RideService.ACTION_START).putExtra("name", name);
                if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i);
            });
        }
        @JavascriptInterface public void rideStop() { runOnUiThread(() -> startService(new Intent(MainActivity.this, RideService.class).setAction(RideService.ACTION_STOP))); }
        @JavascriptInterface public String rideTrack(String since) { return RideService.pointsSince(Long.parseLong(since)); }

        // safety check-in
        @JavascriptInterface public void checkInArm(String at, String phone, String name, String graceMin, String rider) {
            CheckIn.arm(MainActivity.this, Long.parseLong(at), phone, name, Integer.parseInt(graceMin.split("\\.")[0]), rider);
            if (checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED)
                runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.SEND_SMS}, REQ_SMS));
        }
        @JavascriptInterface public void checkInCancel() { CheckIn.cancel(MainActivity.this); }
        @JavascriptInterface public String checkInAt() { return String.valueOf(CheckIn.armedAt(MainActivity.this)); }
        @JavascriptInterface public void checkInPos(double lat, double lon, double t) { CheckIn.savePos(MainActivity.this, lat, lon, (long) t); }

        // offline map packs
        @JavascriptInterface public String mapPacks() {
            JSONArray a = new JSONArray();
            synchronized (MainActivity.this) {
                for (Pack p : packs) {
                    try { JSONObject o = new JSONObject(); o.put("id", p.id); o.put("name", p.name); o.put("size", p.size); a.put(o); } catch (Exception ignored) { }
                }
            }
            return a.toString();
        }
        @JavascriptInterface public void packDownload(final String id, final String url) {
            final String safeId = id.replaceAll("[^A-Za-z0-9_-]", "_");
            new Thread(() -> {
                File part = new File(packDir, safeId + ".part"), dst = new File(packDir, safeId + ".mbtiles");
                HttpURLConnection c = null;
                try {
                    String u = url;
                    for (int hop = 0; hop < 5; hop++) { // GitHub release downloads redirect to another host
                        c = (HttpURLConnection) new URL(u).openConnection();
                        c.setInstanceFollowRedirects(false); c.setConnectTimeout(15000); c.setReadTimeout(60000); c.setRequestProperty("User-Agent", UA);
                        int code = c.getResponseCode();
                        if (code >= 300 && code < 400) { u = c.getHeaderField("Location"); c.disconnect(); c = null; continue; }
                        if (code != 200) throw new Exception("server answered " + code);
                        break;
                    }
                    if (c == null) throw new Exception("too many redirects");
                    long total = c.getContentLengthLong(), done = 0, last = 0;
                    try (InputStream in = c.getInputStream(); OutputStream o = new FileOutputStream(part)) {
                        byte[] buf = new byte[1 << 16]; int k;
                        while ((k = in.read(buf)) > 0) {
                            o.write(buf, 0, k); done += k;
                            if (done - last > (2 << 20)) { last = done; js("window.onPackProgress&&onPackProgress(" + JSONObject.quote(safeId) + "," + done + "," + total + ",'downloading')"); }
                        }
                    }
                    try (SQLiteDatabase t = SQLiteDatabase.openDatabase(part.getPath(), null, SQLiteDatabase.OPEN_READONLY);
                         Cursor q = t.rawQuery("SELECT 1 FROM tiles LIMIT 1", null)) { if (!q.moveToFirst()) throw new Exception("the pack is empty"); }
                    synchronized (MainActivity.this) {
                        for (Pack pk : packs) try { pk.db.close(); } catch (Exception ignored) { }
                        packs.clear();
                        if (dst.exists()) dst.delete();
                        if (!part.renameTo(dst)) throw new Exception("could not install");
                    }
                    openPacks();
                    synchronized (mem) { mem.clear(); memBytes = 0; }
                    js("window.onPackProgress&&onPackProgress(" + JSONObject.quote(safeId) + "," + done + "," + total + ",'done')");
                } catch (Exception e) {
                    part.delete(); openPacks();
                    js("window.onPackProgress&&onPackProgress(" + JSONObject.quote(safeId) + ",0,0," + JSONObject.quote("error: " + e.getMessage()) + ")");
                } finally { if (c != null) c.disconnect(); }
            }, "pack-download").start();
        }
        @JavascriptInterface public void packDelete(String id) {
            synchronized (MainActivity.this) {
                for (Pack pk : packs) try { pk.db.close(); } catch (Exception ignored) { }
                packs.clear();
                new File(packDir, id.replaceAll("[^A-Za-z0-9_-]", "_") + ".mbtiles").delete();
            }
            openPacks();
            synchronized (mem) { mem.clear(); memBytes = 0; }
        }

        // save the map along a route
        @JavascriptInterface public void saveTiles(String json) {
            final JSONArray a;
            try { a = new JSONArray(json); } catch (Exception e) { return; }
            final int total = a.length();
            final AtomicInteger done = new AtomicInteger(), failed = new AtomicInteger();
            for (int i = 0; i < total; i++) {
                final String t = a.optString(i);
                tilePool.submit(() -> {
                    try {
                        String[] p = t.split("/");
                        int z = Integer.parseInt(p[0]), x = Integer.parseInt(p[1]), y = Integer.parseInt(p[2]);
                        boolean have = packTile(z, x, y) != null || new File(tileDir, t + ".pbf").exists();
                        if (!have && tile(z, x, y, true) == null) failed.incrementAndGet();
                    } catch (Exception e) { failed.incrementAndGet(); }
                    int d = done.incrementAndGet();
                    if (d == total || d % 100 == 0) js("window.onTilesProgress&&onTilesProgress(" + d + "," + total + "," + failed.get() + ")");
                });
            }
        }
        @JavascriptInterface public String cacheInfo() {
            int[] n = {0}; long b = dirSize(tileDir, n);
            return "{\"tiles\":" + n[0] + ",\"bytes\":" + b + "}";
        }
        @JavascriptInterface public void clearTiles() { deleteTree(tileDir); tileDir.mkdirs(); synchronized (mem) { mem.clear(); memBytes = 0; } }
        @JavascriptInterface public boolean unmeteredNet() { return unmetered(); }

        // files and sharing
        @JavascriptInterface public String saveFile(String name, String text) {
            try {
                byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, "application/gpx+xml");
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/OpenRoad");
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new Exception("no storage");
                    try (OutputStream o = getContentResolver().openOutputStream(uri)) { o.write(bytes); }
                    return "Saved to Downloads/OpenRoad/" + name;
                }
                File f = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), name);
                try (OutputStream o = new FileOutputStream(f)) { o.write(bytes); }
                return "Saved to " + f.getPath();
            } catch (Exception e) { return "Could not save the file: " + e.getMessage(); }
        }
        @JavascriptInterface public void shareText(String text, String title) {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text).putExtra(Intent.EXTRA_SUBJECT, title);
                try { startActivity(Intent.createChooser(i, title)); } catch (Exception ignored) { }
            });
        }
        @JavascriptInterface public void openUrl(String url) {
            runOnUiThread(() -> { try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) { } });
        }

        // trip sheets: Android's print screen, where "Save as PDF" is one of the printers
        @JavascriptInterface public void printHtml(final String title, final String html) {
            runOnUiThread(() -> {
                final WebView pw = new WebView(MainActivity.this);
                printView = pw;
                pw.setWebViewClient(new WebViewClient() {
                    @Override public void onPageFinished(WebView view, String url) {
                        android.print.PrintManager pm = (android.print.PrintManager) getSystemService(PRINT_SERVICE);
                        pm.print(title, view.createPrintDocumentAdapter(title), new android.print.PrintAttributes.Builder().setMediaSize(android.print.PrintAttributes.MediaSize.ISO_A4).build());
                    }
                });
                pw.loadDataWithBaseURL("file:///android_asset/", html, "text/html", "utf-8", null);
            });
        }

        // updates
        @JavascriptInterface public void installUpdate(final String url) { runOnUiThread(() -> Updater.start(MainActivity.this, url, s -> js("window.onUpdateState&&onUpdateState('" + s + "')"))); }
    }
}
