package uk.openroad.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
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

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * OpenRoad on the phone: the web app (assets/index.html) in a full-screen WebView, plus what a browser
 * can't do (see CoreBridge and Bridge below). The car screen is in the car package.
 */
public class MainActivity extends Activity {

    private static final int REQ_PERMS = 7, REQ_FILE = 42, REQ_SMS = 8, REQ_MIC = 9;
    private WebView web;
    private WebView printView; // kept so it isn't collected while printing
    private ValueCallback<Uri[]> fileCallback;
    private Bridge bridge;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        web = new WebView(this);
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        if (Build.VERSION.SDK_INT >= 26) web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        setContentView(web);

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
                if (Tiles.HOST.equals(u.getHost())) return Tiles.get(MainActivity.this).local(u);
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
                String[] acc = p.getAcceptTypes(); boolean images = acc != null && acc.length > 0 && acc[0] != null && acc[0].startsWith("image");
                Intent i = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType(images ? "image/*" : "*/*");
                if (p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try { startActivityForResult(Intent.createChooser(i, images ? "Choose photos" : "Open a GPX file"), REQ_FILE); } catch (Exception e) { fileCallback = null; return false; }
                return true;
            }
        });
        bridge = new Bridge();
        web.addJavascriptInterface(bridge, "Android");
        new Thread(() -> { Tiles.get(this); runOnUiThread(() -> web.loadUrl("file:///android_asset/index.html")); }, "maps").start();
        askPermissions();
    }

    // ---------- permissions ----------
    private void askPermissions() {
        List<String> p = new ArrayList<>();
        if (!bridge.hasLocation()) { p.add(Manifest.permission.ACCESS_FINE_LOCATION); p.add(Manifest.permission.ACCESS_COARSE_LOCATION); }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) p.add(Manifest.permission.POST_NOTIFICATIONS);
        if (!p.isEmpty()) requestPermissions(p.toArray(new String[0]), REQ_PERMS);
    }

    @Override public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        if (code == REQ_PERMS && bridge.hasLocation() && bridge.wantGps) bridge.gpsOn();
        if (code == REQ_MIC && res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) Voice.get(this).listen();
        if (code == REQ_MIC && (res.length == 0 || res[0] != PackageManager.PERMISSION_GRANTED)) js("window.onVoiceError&&onVoiceError('OpenRoad needs the microphone for voice commands')");
        if (code == REQ_PERMS && !bridge.hasLocation()) js("window.onGpsError&&onGpsError('Location permission was refused. Allow it in Settings > Apps > OpenRoad > Permissions.')");
    }

    @Override protected void onResume() { super.onResume(); GroupService.appVisible = true; if (bridge.wantGps) bridge.gpsOn(); }
    @Override protected void onPause() { super.onPause(); GroupService.appVisible = false; if (!RideService.running) bridge.gpsOff(false); }

    @Override protected void onNewIntent(Intent i) { super.onNewIntent(i); setIntent(i); openFromIntent(i); if (i.getBooleanExtra("openChat", false)) js("window.OR&&OR.openChat&&OR.openChat()"); }

    // a GPX file opened from Files, email or another app
    private void openFromIntent(Intent i) {
        if (i == null || i.getData() == null || i.getBooleanExtra("handled", false)) return;
        Uri d = i.getData();
        if ("openroad".equals(d.getScheme()) || ("https".equals(d.getScheme()) && d.getPath() != null && d.getPath().startsWith("/OpenRoad/join"))) {
            i.putExtra("handled", true);
            js("window.onJoinLink&&onJoinLink(" + JSONObject.quote(d.toString()) + ")");
            return;
        }
        if (!Intent.ACTION_VIEW.equals(i.getAction()) && !Intent.ACTION_SEND.equals(i.getAction())) return;
        i.putExtra("handled", true);
        final Uri u = i.getData();
        new Thread(() -> {
            try (InputStream in = getContentResolver().openInputStream(u)) {
                String text = Util.readAll(in);
                String name = u.getLastPathSegment() == null ? "route.gpx" : u.getLastPathSegment();
                js("window.onGpxFile&&onGpxFile(" + JSONObject.quote(name) + "," + JSONObject.quote(text) + ")");
            } catch (Exception e) { toast("Could not open that file"); }
        }).start();
    }

    @Override protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        com.google.zxing.integration.android.IntentResult qr = com.google.zxing.integration.android.IntentIntegrator.parseActivityResult(req, result, data);
        if (qr != null) { String t = qr.getContents(); js("window.onQrScanned&&onQrScanned(" + (t == null ? "null" : JSONObject.quote(t)) + ")"); return; }
        if (req == REQ_FILE && fileCallback != null) {
            Uri[] out = null;
            if (result == RESULT_OK && data != null) {
                if (data.getClipData() != null) { out = new Uri[data.getClipData().getItemCount()]; for (int k = 0; k < out.length; k++) out[k] = data.getClipData().getItemAt(k).getUri(); }
                else if (data.getData() != null) out = new Uri[]{data.getData()};
            }
            fileCallback.onReceiveValue(out);
            fileCallback = null;
        }
    }

    @SuppressWarnings("deprecation")
    @Override public void onBackPressed() {
        web.evaluateJavascript("(function(){var s=document.getElementById('sheet');if(s&&!s.hidden){s.hidden=true;return 1}var p=document.getElementById('panel');if(p&&p.classList.contains('open')&&innerWidth<900){p.classList.remove('open');return 1}return 0})()",
                v -> { if (!"1".equals(v)) moveTaskToBack(true); });
    }

    private void js(final String code) { runOnUiThread(() -> web.evaluateJavascript(code, null)); }
    private void toast(final String t) { runOnUiThread(() -> Toast.makeText(this, t, Toast.LENGTH_LONG).show()); }

    // ---------- the phone's bridge: everything in CoreBridge, plus things only the phone screen does ----------
    private class Bridge extends CoreBridge {
        Bridge() { super(MainActivity.this, MainActivity.this::js); }

        @Override void needPermission() { runOnUiThread(MainActivity.this::askPermissions); }

        @JavascriptInterface public void keepScreenOn(final boolean on) {
            runOnUiThread(() -> { if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); });
        }

        // safety check-in
        @JavascriptInterface public void checkInArm(String at, String phone, String name, String graceMin, String rider) {
            CheckIn.arm(MainActivity.this, Long.parseLong(at), phone, name, Integer.parseInt(graceMin.split("\\.")[0]), rider);
            if (checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED)
                runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.SEND_SMS}, REQ_SMS));
        }
        @JavascriptInterface public void checkInCancel() { CheckIn.cancel(MainActivity.this); }
        @JavascriptInterface public String checkInAt() { return String.valueOf(CheckIn.armedAt(MainActivity.this)); }
        @JavascriptInterface public void checkInPos(double lat, double lon, double t) { CheckIn.savePos(MainActivity.this, lat, lon, (long) t); }

        // offline maps
        @JavascriptInterface public void packDownload(String id, String url) { Tiles.get(MainActivity.this).downloadPack(id, url, MainActivity.this::js); }
        @JavascriptInterface public void packDelete(String id) { Tiles.get(MainActivity.this).deletePack(id); }
        @JavascriptInterface public void saveTiles(String json) { Tiles.get(MainActivity.this).saveTiles(json, MainActivity.this::js); }
        @JavascriptInterface public void clearTiles() { Tiles.get(MainActivity.this).clearTiles(); }

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
        // a ride picture: saved to Pictures/OpenRoad, and offered to WhatsApp, Facebook and so on if share is true
        @JavascriptInterface public String saveImage(String name, String base64, boolean share) {
            try {
                byte[] bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, "image/png");
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/OpenRoad");
                    final Uri uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new Exception("no storage");
                    try (OutputStream o = getContentResolver().openOutputStream(uri)) { o.write(bytes); }
                    if (share) runOnUiThread(() -> {
                        Intent i = new Intent(Intent.ACTION_SEND).setType("image/png").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        try { startActivity(Intent.createChooser(i, "Share your ride")); } catch (Exception ignored) { }
                    });
                    return share ? "" : "Saved to Pictures/OpenRoad/" + name;
                }
                File f = new File(getExternalFilesDir(Environment.DIRECTORY_PICTURES), name);
                try (OutputStream o = new FileOutputStream(f)) { o.write(bytes); }
                return "Saved to " + f.getPath() + (share ? " (sharing pictures needs Android 10 or newer)" : "");
            } catch (Exception e) { return "Could not save the picture: " + e.getMessage(); }
        }
        // voice commands and watch turn alerts
        @JavascriptInterface public void voiceListen() {
            Voice.get(MainActivity.this).out = MainActivity.this::js;
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) { runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC)); return; }
            Voice.get(MainActivity.this).listen();
        }
        @JavascriptInterface public void voiceButton(boolean on) {
            Voice.get(MainActivity.this).out = MainActivity.this::js;
            if (on && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_PERMS));
            Voice.get(MainActivity.this).button(on);
        }
        @JavascriptInterface public void turnNote(String text) { Voice.get(MainActivity.this).turn(text); }
        // QR codes for group rides
        @JavascriptInterface public void scanQr() {
            runOnUiThread(() -> {
                try {
                    new com.google.zxing.integration.android.IntentIntegrator(MainActivity.this).setDesiredBarcodeFormats(com.google.zxing.integration.android.IntentIntegrator.QR_CODE)
                            .setPrompt("Point at the group ride's QR code").setBeepEnabled(false).setOrientationLocked(false).initiateScan();
                } catch (Exception e) { js("window.onQrScanned&&onQrScanned(null)"); }
            });
        }
        @JavascriptInterface public String qrImage(String text) {
            try {
                com.google.zxing.common.BitMatrix m = new com.google.zxing.qrcode.QRCodeWriter().encode(text, com.google.zxing.BarcodeFormat.QR_CODE, 640, 640);
                android.graphics.Bitmap bmp = android.graphics.Bitmap.createBitmap(m.getWidth(), m.getHeight(), android.graphics.Bitmap.Config.RGB_565);
                for (int y = 0; y < m.getHeight(); y++) for (int x = 0; x < m.getWidth(); x++) bmp.setPixel(x, y, m.get(x, y) ? 0xFF000000 : 0xFFFFFFFF);
                java.io.ByteArrayOutputStream o = new java.io.ByteArrayOutputStream(); bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, o);
                return "data:image/png;base64," + android.util.Base64.encodeToString(o.toByteArray(), android.util.Base64.NO_WRAP);
            } catch (Exception e) { return ""; }
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
