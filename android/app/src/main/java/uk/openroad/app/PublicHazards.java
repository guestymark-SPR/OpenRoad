package uk.openroad.app;

import android.content.Context;
import android.location.Location;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Map;

/**
 * Hazards shared with every OpenRoad rider nearby, not just your group: gravel, diesel, a crash. Anonymous (a random id
 * per phone, no name). Each is kept on the free servers under its map square (1 degree), so riders arriving later get it.
 * They expire after 6 hours; anyone who sees an expired one clears it. Riders passing can say it's gone: two "gone"s
 * (or the rider who marked it) take it down. You're warned when one is ahead of you, while recording a ride.
 */
final class PublicHazards {
    private PublicHazards() { }
    static final long TTL = 6 * 3600000L;
    private static final String KEY = "OPENROADPUBLICHAZARDS"; // the shared key: these are public by design
    private static GroupLink link;
    private static Context app;
    private static String me;
    private static final Map<String, JSONObject> haz = new HashMap<>();
    private static final Map<String, Boolean> warned = new HashMap<>();
    private static final java.util.ArrayDeque<Long> adds = new java.util.ArrayDeque<>();
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static Location last;
    static volatile boolean enabled = true;

    static String cell(double lat, double lon) { return "PUBHAZ" + (int) Math.floor(lat + 90) + "X" + (int) Math.floor(lon + 180); }

    static synchronized void start(Context c) {
        if (link != null || !enabled) return;
        app = c.getApplicationContext();
        me = Util.kvGet(app, "pubHazId");
        if (me == null || me.length() < 8) { me = GroupLink.newRiderId(); Util.kvSet(app, "pubHazId", me); }
        try {
            link = new GroupLink(KEY, me, GroupLink.SERVERS, new GroupLink.Listener() {
                @Override public void onMessage(String kind, String json) { onIn(kind, json); }
                @Override public void onStatus(String s, String st) { }
            });
        } catch (Exception e) { link = null; }
        if (last != null) area(last.getLatitude(), last.getLongitude());
    }
    static synchronized void stop() { if (link != null) { link.closeQuiet(); link = null; } }

    // watch my square and the eight around it
    private static void area(double lat, double lon) {
        if (link == null) return;
        for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) { String c = cell(lat + a, lon + b); if (!link.watching(c)) link.watch(c); }
    }

    private static void onIn(String kind, String json) {
        try {
            if ("h-clear".equals(kind)) { String id = new JSONObject(json).optString("id"); synchronized (haz) { haz.remove(id); } return; }
            if (!"h".equals(kind)) return;
            JSONObject h = new JSONObject(json);
            String id = h.optString("hid"); if (id.isEmpty()) return;
            if (System.currentTimeMillis() - h.optLong("t") > TTL || h.optInt("gone") >= 2) { // expired or voted gone: tidy it away for everyone
                if (link != null) link.clearKeptAt(cell(h.optDouble("la"), h.optDouble("lo")), "h", id);
                synchronized (haz) { haz.remove(id); } return;
            }
            synchronized (haz) { JSONObject old = haz.get(id); if (old != null && old.optLong("u") > h.optLong("u")) return; haz.put(id, h); }
        } catch (Exception ignored) { }
    }

    /** Mark a hazard where I am. Returns false if there's no position yet, or too many marked in the last hour. */
    static boolean add(Context c, String kind, String note) {
        start(c);
        if (last == null || link == null) return false;
        long now = System.currentTimeMillis();
        synchronized (adds) { while (!adds.isEmpty() && now - adds.peekFirst() > 3600000L) adds.pollFirst(); if (adds.size() >= 10) return false; adds.addLast(now); }
        try {
            byte[] b = new byte[6]; new SecureRandom().nextBytes(b);
            String id = GroupLink.hex(b);
            JSONObject h = new JSONObject().put("hid", id).put("k", kind).put("x", note == null ? "" : note.length() > 60 ? note.substring(0, 60) : note)
                    .put("la", Math.round(last.getLatitude() * 1e5) / 1e5).put("lo", Math.round(last.getLongitude() * 1e5) / 1e5)
                    .put("t", now).put("u", now).put("by", me).put("gone", 0).put("votes", new JSONArray());
            link.sendKeptAt(cell(h.getDouble("la"), h.getDouble("lo")), "h", id, h.toString());
            synchronized (haz) { haz.put(id, h); }
            return true;
        } catch (Exception e) { return false; }
    }
    /** It's gone: mine are taken down straight away; someone else's needs two riders to say so. */
    static void gone(Context c, String id) {
        start(c);
        JSONObject h; synchronized (haz) { h = haz.get(id); }
        if (h == null || link == null) return;
        try {
            String cl = cell(h.getDouble("la"), h.getDouble("lo"));
            JSONArray v = h.optJSONArray("votes"); if (v == null) v = new JSONArray();
            for (int i = 0; i < v.length(); i++) if (me.equals(v.optString(i))) return; // already said
            if (me.equals(h.optString("by")) || h.optInt("gone") + 1 >= 2) { link.clearKeptAt(cl, "h", id); synchronized (haz) { haz.remove(id); } return; }
            v.put(me); h.put("votes", v).put("gone", h.optInt("gone") + 1).put("u", System.currentTimeMillis());
            link.sendKeptAt(cl, "h", id, h.toString());
        } catch (Exception ignored) { }
    }
    static String list() {
        JSONArray a = new JSONArray(); long now = System.currentTimeMillis();
        synchronized (haz) { for (JSONObject h : haz.values()) if (now - h.optLong("t") < TTL) { try { a.put(new JSONObject(h.toString()).put("mine", me != null && me.equals(h.optString("by"))).put("voted", h.optJSONArray("votes") != null && h.optJSONArray("votes").toString().contains("\"" + me + "\""))); } catch (Exception ignored) { } } }
        return a.toString();
    }

    /** Where I am when not recording a ride (the app on screen): just watch the area. */
    static void pos(Context c, double lat, double lon) {
        Location l = new Location("app"); l.setLatitude(lat); l.setLongitude(lon); l.setTime(System.currentTimeMillis());
        if (last == null || last.getProvider().equals("app") || System.currentTimeMillis() - last.getTime() > 30000) last = l;
        if (!enabled) return; start(c); area(lat, lon);
    }
    /** Each GPS fix while riding: watch the area, and warn about hazards ahead (about 12 seconds' warning, at least 250 m). */
    static void fix(Context c, Location l) {
        last = l;
        if (!enabled) return;
        start(c);
        area(l.getLatitude(), l.getLongitude());
        float v = l.hasSpeed() ? l.getSpeed() : 0; if (v < 3) return;
        double warnAt = Math.max(250, v * 12);
        java.util.List<Object[]> say = new java.util.ArrayList<>();
        synchronized (haz) {
            for (JSONObject h : haz.values()) {
                if (me.equals(h.optString("by"))) continue;
                String id = h.optString("hid");
                float[] d = new float[1]; Location.distanceBetween(l.getLatitude(), l.getLongitude(), h.optDouble("la"), h.optDouble("lo"), d);
                boolean ahead = true;
                if (l.hasBearing() && d[0] > 60) { Location t = new Location(""); t.setLatitude(h.optDouble("la")); t.setLongitude(h.optDouble("lo")); ahead = Math.abs(((l.bearingTo(t) - l.getBearing()) % 360 + 540) % 360 - 180) < 40; }
                Boolean was = warned.get(id);
                if (d[0] < warnAt && ahead && (was == null || !was)) { warned.put(id, true); say.add(new Object[]{h, (double) d[0]}); }
                else if (d[0] > 1500 && was != null && was) warned.put(id, false);
            }
        }
        boolean miles = true;
        try { miles = !"km".equals(new JSONObject(String.valueOf(Util.kvGet(c, "or_cfg"))).optString("units", "mi")); } catch (Exception ignored) { }
        for (Object[] s : say) {
            JSONObject h = (JSONObject) s[0]; double d = (Double) s[1];
            String note = h.optString("x"), dist = miles ? Math.max(50, Math.round(d / 0.9144 / 50) * 50) + " yards" : Math.max(50, Math.round(d / 50) * 50) + " metres";
            long mins = (System.currentTimeMillis() - h.optLong("t")) / 60000;
            Speech.get(c).speak("Riders report " + GroupService.hazName(h.optString("k")).toLowerCase(java.util.Locale.UK) + " ahead" + (note.isEmpty() ? "" : ", " + note) + ", in " + dist + ". Marked " + (mins < 60 ? mins + (mins == 1 ? " minute" : " minutes") : (mins / 60) + (mins < 120 ? " hour" : " hours")) + " ago.");
        }
    }
}
