package uk.openroad.app;

import android.content.Context;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Small shared helpers: the app's saved data (the same files the web app reads), network, streams. */
final class Util {
    static final String UA = "OpenRoad/1.0 (Android motorcycle navigation; github.com/guestymark-SPR/OpenRoad)";
    private static final ExecutorService net = Executors.newFixedThreadPool(4);

    static File kvFile(Context c, String k) { File d = new File(c.getFilesDir(), "kv"); d.mkdirs(); return new File(d, k.replaceAll("[^A-Za-z0-9_.-]", "_")); }
    static String kvGet(Context c, String k) {
        File f = kvFile(c, k); if (!f.exists()) return null;
        try (InputStream in = new FileInputStream(f)) { return readAll(in); } catch (Exception e) { return null; }
    }
    static synchronized void kvSet(Context c, String k, String v) {
        File f = kvFile(c, k), tmp = new File(f.getPath() + ".tmp");
        try (OutputStream o = new FileOutputStream(tmp)) { o.write(v.getBytes(StandardCharsets.UTF_8)); } catch (Exception e) { return; }
        tmp.renameTo(f);
    }

    /** HTTP for the web app, answered with window.onFetch(id, status, text) */
    static void fetch(final int id, final String url, final String method, final String body, final String type, final String headers, final Tiles.Js js) {
        net.submit(() -> {
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
            js.run("window.onFetch&&onFetch(" + id + "," + code + "," + JSONObject.quote(out) + ")");
        });
    }

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
}
