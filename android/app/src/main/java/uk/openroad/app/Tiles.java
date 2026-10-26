package uk.openroad.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.AssetManager;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.GZIPInputStream;

/**
 * Map tiles for every OpenRoad screen (phone and car): offline country packs first, then tiles saved
 * on the phone, then OpenFreeMap over the internet. Served to the map at https://openroad.maps/…
 */
final class Tiles {
    static final String HOST = "openroad.maps";
    static final String TILEJSON = "https://tiles.openfreemap.org/planet";
    interface Js { void run(String code); }

    private static Tiles inst;
    static synchronized Tiles get(Context c) { if (inst == null) inst = new Tiles(c.getApplicationContext()); return inst; }

    private final AssetManager assets;
    private final SharedPreferences prefs;
    final File packDir, tileDir;
    private static class Pack { String id, name, area; double[] b; int minz = 0, maxz = 14; long size; SQLiteDatabase db; List<double[][]> polys; }
    static final String POLY_URL = "https://github.com/guestymark-SPR/OpenRoad/releases/download/maps/";
    private final Context ctx;
    private final List<Pack> packs = new ArrayList<>();
    private long memBytes = 0;
    private static final long MEM_MAX = 48L * 1024 * 1024;
    private final LinkedHashMap<String, byte[]> mem = new LinkedHashMap<>(512, 0.75f, true);
    private volatile String tileTemplate;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);

    private Tiles(Context c) {
        ctx = c; assets = c.getAssets();
        prefs = c.getSharedPreferences("net", Context.MODE_PRIVATE);
        packDir = new File(c.getFilesDir(), "maps"); packDir.mkdirs();
        tileDir = new File(c.getFilesDir(), "tiles"); tileDir.mkdirs();
        tileTemplate = prefs.getString("tiles", null);
        openPacks();
        pool.execute(this::fetchPolys);
    }

    WebResourceResponse local(Uri u) {
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
                try { return new WebResourceResponse("application/x-protobuf", null, 200, "OK", h, assets.open("glyphs/" + font + "/" + seg.get(2))); }
                catch (Exception missing) { return new WebResourceResponse("application/x-protobuf", null, 200, "OK", h, new ByteArrayInputStream(new byte[0])); }
            }
        } catch (Exception ignored) { }
        return new WebResourceResponse("text/plain", null, 404, "Not Found", h, new ByteArrayInputStream(new byte[0]));
    }

    byte[] tile(int z, int x, int y, boolean net) {
        String key = z + "/" + x + "/" + y;
        byte[] d = memGet(key);
        if (d != null) return d;
        List<byte[]> fromPacks = new ArrayList<>();
        boolean covered = packTiles(z, x, y, fromPacks);
        File f = new File(tileDir, z + "/" + x + "/" + y + ".pbf");
        if (!fromPacks.isEmpty() && covered) d = merged(fromPacks);
        else {
            // not in a pack, or on the edge of what the packs cover (a border or the coast of a country you
            // have no pack for): the full map is better, from the phone's saved tiles or the internet
            if (f.exists()) { try (InputStream in = new FileInputStream(f)) { d = Util.readBytes(in); } catch (Exception ignored) { } }
            if (d == null && net && (fromPacks.isEmpty() || (!packsOnly() && online()))) {
                d = download(z, x, y);
                if (d != null) { f.getParentFile().mkdirs(); try (OutputStream o = new FileOutputStream(f)) { o.write(d); } catch (Exception ignored) { } }
            }
            if (d == null && !fromPacks.isEmpty()) d = merged(fromPacks);
        }
        if (d != null) d = gunzip(d);
        if (d != null) memPut(key, d);
        return d;
    }

    private String template() {
        if (tileTemplate != null) return tileTemplate;
        try {
            JSONObject j = new JSONObject(Util.httpText(TILEJSON));
            tileTemplate = j.getJSONArray("tiles").getString(0);
            prefs.edit().putString("tiles", tileTemplate).apply();
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
                c.setConnectTimeout(8000); c.setReadTimeout(20000); c.setRequestProperty("User-Agent", Util.UA);
                int code = c.getResponseCode();
                if (code == 200) { try (InputStream in = c.getInputStream()) { return Util.readBytes(in); } }
                if (code == 204) return new byte[0];
                if (code == 404 && attempt == 0) { // the map was updated and the old version retired: get the new address
                    tileTemplate = null; prefs.edit().remove("tiles").apply();
                    if (template() == null) return null;
                    continue;
                }
                return null;
            } catch (Exception e) { return null; } finally { if (c != null) c.disconnect(); }
        }
        return null;
    }

    synchronized void openPacks() {
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
                loadPoly(p);
                packs.add(p);
            } catch (Exception ignored) { }
        }
        synchronized (mem) { mem.clear(); memBytes = 0; }
    }

    private static double tileLon(int x, int z) { return x / Math.pow(2, z) * 360.0 - 180; }
    private static double tileLat(int y, int z) { double n = Math.PI - 2 * Math.PI * y / Math.pow(2, z); return Math.toDegrees(Math.atan(Math.sinh(n))); }

    /** Every pack's copy of this tile goes into out (packs overlap at borders and where a country is split).
        Returns true if the packs between them cover the whole tile, judged by each country's outline. */
    boolean packTiles(int z, int x, int y, List<byte[]> out) {
        final double w = tileLon(x, z), e = tileLon(x + 1, z), n = tileLat(y, z), s = tileLat(y + 1, z);
        int tms = (1 << z) - 1 - y;
        List<Pack> have = new ArrayList<>();
        synchronized (this) {
            for (Pack p : packs) {
                if (z < p.minz || z > p.maxz) continue;
                if (p.b != null && (e < p.b[0] || w > p.b[2] || n < p.b[1] || s > p.b[3])) continue;
                try (Cursor c = p.db.rawQuery("SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?",
                        new String[]{String.valueOf(z), String.valueOf(x), String.valueOf(tms)})) {
                    if (c.moveToFirst()) { byte[] d = gunzip(c.getBlob(0)); if (d != null) { out.add(d); have.add(p); } }
                } catch (Exception ignored) { }
            }
        }
        if (have.isEmpty()) return false;
        // corners (just inside) and middle of the tile must each be inside some pack's country outline
        double dx = (e - w) * 0.02, dy = (n - s) * 0.02;
        double[][] pts = {{w + dx, n - dy}, {e - dx, n - dy}, {w + dx, s + dy}, {e - dx, s + dy}, {(w + e) / 2, (n + s) / 2}};
        for (double[] p : pts) { boolean in = false; for (Pack k : have) if (covers(k, p[0], p[1])) { in = true; break; } if (!in) return false; }
        return true;
    }
    private static boolean covers(Pack p, double lon, double lat) {
        if (p.b != null && (lon < p.b[0] || lon > p.b[2] || lat < p.b[1] || lat > p.b[3])) return false;
        if (p.polys == null) return true; // outline not downloaded yet: go by the pack's box, as before
        for (double[][] r : p.polys) if (inRing(r, lon, lat)) return true;
        return false;
    }
    private static boolean inRing(double[][] r, double x, double y) {
        boolean c = false;
        for (int i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > y) != (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
        return c;
    }
    private static byte[] merged(List<byte[]> l) { try { return MvtMerge.merge(l); } catch (Exception e) { return l.get(0); } }
    private boolean packsOnly() { return "1".equals(Util.kvGet(ctx, "packsOnly")); }
    private boolean online() {
        try {
            android.net.ConnectivityManager cm = (android.net.ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            android.net.NetworkCapabilities nc = cm.getNetworkCapabilities(cm.getActiveNetwork());
            return nc != null && nc.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (Exception e) { return true; }
    }

    // ---------- country outlines (Geofabrik .poly files, published with the packs) ----------
    private static String areaOf(String id) { return id.replaceAll("-\\d+$", ""); }
    private static List<double[][]> parsePoly(String text) {
        List<double[][]> out = new ArrayList<>(); List<double[]> cur = null; boolean hole = false; int line = 0;
        for (String raw : text.split("\n")) {
            String l = raw.trim(); line++;
            if (line == 1 || l.isEmpty()) continue;
            if (l.equals("END")) { if (cur != null) { if (!hole && cur.size() > 2) out.add(cur.toArray(new double[0][])); cur = null; } continue; }
            if (cur == null) { cur = new ArrayList<>(); hole = l.startsWith("!"); continue; }
            String[] q = l.split("\\s+"); if (q.length < 2) continue;
            try { cur.add(new double[]{Double.parseDouble(q[0]), Double.parseDouble(q[1])}); } catch (Exception ignored) { }
        }
        return out;
    }
    private void loadPoly(Pack p) {
        File f = new File(packDir, areaOf(p.id) + ".poly");
        if (!f.exists()) return;
        try (InputStream in = new FileInputStream(f)) { List<double[][]> r = parsePoly(new String(Util.readBytes(in), java.nio.charset.StandardCharsets.UTF_8)); if (!r.isEmpty()) p.polys = r; } catch (Exception ignored) { }
    }
    /** Downloads the outline of each country you have a pack for (a few hundred kB at most), once. */
    void fetchPolys() {
        List<Pack> need = new ArrayList<>();
        synchronized (this) { for (Pack p : packs) if (p.polys == null) need.add(p); }
        boolean got = false;
        for (Pack p : need) {
            File f = new File(packDir, areaOf(p.id) + ".poly");
            if (!f.exists()) {
                try {
                    String t = Util.httpText(POLY_URL + areaOf(p.id) + ".poly");
                    if (t != null && t.contains("END")) { try (OutputStream o = new FileOutputStream(f)) { o.write(t.getBytes(java.nio.charset.StandardCharsets.UTF_8)); } }
                } catch (Exception ignored) { }
            }
            synchronized (this) { loadPoly(p); if (p.polys != null) got = true; }
        }
        if (got) synchronized (mem) { mem.clear(); memBytes = 0; }
    }

    private static byte[] gunzip(byte[] d) {
        if (d.length > 2 && (d[0] & 0xFF) == 0x1F && (d[1] & 0xFF) == 0x8B) {
            try (GZIPInputStream gz = new GZIPInputStream(new ByteArrayInputStream(d))) { return Util.readBytes(gz); } catch (Exception e) { return null; }
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
    private void memClear() { synchronized (mem) { mem.clear(); memBytes = 0; } }

    // ---------- packs on this phone ----------
    String packsJson() {
        JSONArray a = new JSONArray();
        synchronized (this) {
            for (Pack p : packs) {
                try { JSONObject o = new JSONObject(); o.put("id", p.id); o.put("name", p.name); o.put("size", p.size); a.put(o); } catch (Exception ignored) { }
            }
        }
        return a.toString();
    }

    void downloadPack(final String id, final String url, final Js js) {
        final String safeId = id.replaceAll("[^A-Za-z0-9_-]", "_");
        new Thread(() -> {
            File part = new File(packDir, safeId + ".part"), dst = new File(packDir, safeId + ".mbtiles");
            HttpURLConnection c = null;
            try {
                String u = url;
                for (int hop = 0; hop < 5; hop++) { // GitHub release downloads redirect to another host
                    c = (HttpURLConnection) new URL(u).openConnection();
                    c.setInstanceFollowRedirects(false); c.setConnectTimeout(15000); c.setReadTimeout(60000); c.setRequestProperty("User-Agent", Util.UA);
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
                        if (done - last > (2 << 20)) { last = done; js.run("window.onPackProgress&&onPackProgress(" + JSONObject.quote(safeId) + "," + done + "," + total + ",'downloading')"); }
                    }
                }
                try (SQLiteDatabase t = SQLiteDatabase.openDatabase(part.getPath(), null, SQLiteDatabase.OPEN_READONLY);
                     Cursor q = t.rawQuery("SELECT 1 FROM tiles LIMIT 1", null)) { if (!q.moveToFirst()) throw new Exception("the pack is empty"); }
                synchronized (this) {
                    for (Pack pk : packs) try { pk.db.close(); } catch (Exception ignored) { }
                    packs.clear();
                    if (dst.exists()) dst.delete();
                    if (!part.renameTo(dst)) throw new Exception("could not install");
                }
                openPacks(); memClear(); pool.execute(this::fetchPolys);
                js.run("window.onPackProgress&&onPackProgress(" + JSONObject.quote(safeId) + "," + done + "," + total + ",'done')");
            } catch (Exception e) {
                part.delete(); openPacks();
                js.run("window.onPackProgress&&onPackProgress(" + JSONObject.quote(safeId) + ",0,0," + JSONObject.quote("error: " + e.getMessage()) + ")");
            } finally { if (c != null) c.disconnect(); }
        }, "pack-download").start();
    }

    void deletePack(String id) {
        synchronized (this) {
            for (Pack pk : packs) try { pk.db.close(); } catch (Exception ignored) { }
            packs.clear();
            new File(packDir, id.replaceAll("[^A-Za-z0-9_-]", "_") + ".mbtiles").delete();
        }
        openPacks(); memClear();
    }

    // save the map along a route
    void saveTiles(String json, final Js js) {
        final JSONArray a;
        try { a = new JSONArray(json); } catch (Exception e) { return; }
        final int total = a.length();
        final AtomicInteger done = new AtomicInteger(), failed = new AtomicInteger();
        for (int i = 0; i < total; i++) {
            final String t = a.optString(i);
            pool.submit(() -> {
                try {
                    String[] p = t.split("/");
                    int z = Integer.parseInt(p[0]), x = Integer.parseInt(p[1]), y = Integer.parseInt(p[2]);
                    boolean have = packTile(z, x, y) != null || new File(tileDir, t + ".pbf").exists();
                    if (!have && tile(z, x, y, true) == null) failed.incrementAndGet();
                } catch (Exception e) { failed.incrementAndGet(); }
                int d = done.incrementAndGet();
                if (d == total || d % 100 == 0) js.run("window.onTilesProgress&&onTilesProgress(" + d + "," + total + "," + failed.get() + ")");
            });
        }
    }
    String cacheInfo() { int[] n = {0}; long b = dirSize(tileDir, n); return "{\"tiles\":" + n[0] + ",\"bytes\":" + b + "}"; }
    void clearTiles() { deleteTree(tileDir); tileDir.mkdirs(); memClear(); }
    private long dirSize(File f, int[] count) { if (f.isFile()) { count[0]++; return f.length(); } long s = 0; File[] k = f.listFiles(); if (k != null) for (File c : k) s += dirSize(c, count); return s; }
    private void deleteTree(File f) { File[] k = f.listFiles(); if (k != null) for (File c : k) deleteTree(c); f.delete(); }
}
