package uk.openroad.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Group ride: shares my position with the group and keeps everyone else's, with the screen off too.
 * Speaks group messages, and says when a rider drops more than a set distance away or goes quiet.
 */
public class GroupService extends Service implements LocationListener {
    static final String ACTION_START = "uk.openroad.app.GROUP_START", ACTION_STOP = "uk.openroad.app.GROUP_STOP", ACTION_SAY = "uk.openroad.app.GROUP_SAY";
    private static final String CHANNEL = "group";
    private static final int NOTE_ID = 12;
    private static final long LOST_MS = 180000, MOVE_EVERY = 5000, STILL_EVERY = 30000;

    // shared with the web app (read through the bridge)
    static volatile boolean running = false;
    static volatile String code = "", myId = "", myName = "", myColour = "";
    private static final Map<String, JSONObject> riders = new LinkedHashMap<>();
    private static final JSONArray msgs = new JSONArray();
    private static final Map<String, String> servers = new LinkedHashMap<>();

    private GroupLink link;
    private PowerManager.WakeLock lock;
    private Location me;
    private long lastSent = 0; private Location lastSentAt;
    private boolean voice = true; private double splitM = 3218.7;
    private final Map<String, String> alertState = new LinkedHashMap<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable tick = new Runnable() { @Override public void run() { checkGroup(); sendIfDue(true); main.postDelayed(this, 10000); } };

    static String state() {
        try {
            JSONObject o = new JSONObject();
            o.put("on", running); o.put("code", code); o.put("me", myId); o.put("name", myName); o.put("colour", myColour);
            JSONArray rs = new JSONArray(); long now = System.currentTimeMillis();
            synchronized (riders) { for (JSONObject r : riders.values()) { JSONObject c = new JSONObject(r.toString()); c.put("age", (now - r.optLong("rx", now)) / 1000); rs.put(c); } }
            o.put("riders", rs);
            synchronized (msgs) { o.put("msgs", new JSONArray(msgs.toString())); }
            JSONObject sv = new JSONObject(); synchronized (servers) { for (Map.Entry<String, String> e : servers.entrySet()) sv.put(e.getKey(), e.getValue()); }
            o.put("servers", sv);
            return o.toString();
        } catch (Exception e) { return "{\"on\":false}"; }
    }

    @Override public IBinder onBind(Intent i) { return null; }

    @SuppressLint({"MissingPermission", "WakelockTimeout"})
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(a)) { stop(); return START_NOT_STICKY; }
        if (ACTION_SAY.equals(a)) { if (!running) { stopSelf(); return START_NOT_STICKY; } sendMessage(intent.getStringExtra("kind"), intent.getStringExtra("text")); return START_STICKY; }
        if (intent == null) { // restarted by Android after being killed: rejoin the last group
            String last = Util.kvGet(this, "groupLast");
            try { JSONObject o = new JSONObject(last); intent = new Intent().putExtra("code", o.getString("code")).putExtra("name", o.optString("name")).putExtra("colour", o.optString("colour")).putExtra("voice", o.optBoolean("voice", true)).putExtra("splitMi", o.optDouble("splitMi", 2)); }
            catch (Exception e) { stopSelf(); return START_NOT_STICKY; }
        }
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Group ride", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shows that OpenRoad is sharing your position with your group");
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
        Notification n = note("Group ride: connecting", "Sharing your position with your group");
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION); else startForeground(NOTE_ID, n);
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) { stop(); return START_NOT_STICKY; }

        String newCode = intent.getStringExtra("code");
        voice = intent.getBooleanExtra("voice", true);
        splitM = Math.max(0.3, intent.getDoubleExtra("splitMi", 2)) * 1609.344;
        myName = clip(intent.getStringExtra("name"), 24); myColour = clip(intent.getStringExtra("colour"), 9);
        try { Util.kvSet(this, "groupLast", new JSONObject().put("code", newCode).put("name", myName).put("colour", myColour).put("voice", voice).put("splitMi", splitM / 1609.344).toString()); } catch (Exception ignored) { }
        if (running && GroupLink.clean(newCode).equals(GroupLink.clean(code)) && link != null) { lastSent = 0; sendIfDue(true); return START_STICKY; }
        if (link != null) link.close();
        synchronized (riders) { riders.clear(); } synchronized (servers) { servers.clear(); } alertState.clear();
        synchronized (msgs) { while (msgs.length() > 0) msgs.remove(0); }
        myId = Util.kvGet(this, "groupRider");
        if (myId == null || myId.length() < 8) { myId = GroupLink.newRiderId(); Util.kvSet(this, "groupRider", myId); }
        code = newCode;
        try { link = new GroupLink(code, myId, GroupLink.SERVERS, listener); }
        catch (Exception e) { addMsg(null, "Couldn't join: " + e.getMessage()); stop(); return START_NOT_STICKY; }
        if (!running) {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "OpenRoad:group"); lock.acquire();
            try {
                LocationManager lm = (LocationManager) getSystemService(LOCATION_SERVICE);
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, this, Looper.getMainLooper());
                Location l = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
                if (l != null && System.currentTimeMillis() - l.getTime() < 120000) me = l;
            } catch (Exception ignored) { }
            running = true;
            main.postDelayed(tick, 3000);
        }
        return START_STICKY;
    }

    private final GroupLink.Listener listener = new GroupLink.Listener() {
        @Override public void onMessage(String kind, String json) { main.post(() -> received(kind, json)); }
        @Override public void onStatus(String server, String status) {
            synchronized (servers) { servers.put(server, status); }
            if ("online".equals(status)) main.post(() -> { lastSent = 0; sendIfDue(true); updateNote(); });
        }
    };

    private void received(String kind, String json) {
        try {
            JSONObject o = new JSONObject(json); String id = o.optString("id");
            if (id.isEmpty() || id.equals(myId)) return;
            if ("left".equals(kind)) {
                JSONObject r; synchronized (riders) { r = riders.remove(id); }
                if (r != null) { addMsg(r, "left the group"); alertState.remove(id); }
                updateNote(); return;
            }
            if ("m".equals(kind)) { // the same message arrives from both servers: keep one
                String key = id + ":" + o.optLong("t");
                synchronized (msgs) { for (int i = 0; i < msgs.length(); i++) if (key.equals(msgs.getJSONObject(i).optString("key"))) return; }
                JSONObject r; synchronized (riders) { r = riders.get(id); }
                String who = o.optString("n", r != null ? r.optString("n") : "A rider");
                String text = msgText(o.optString("k"), o.optString("x"));
                JSONObject m = new JSONObject().put("key", key).put("id", id).put("n", who).put("c", o.optString("c")).put("k", o.optString("k")).put("text", text).put("t", System.currentTimeMillis());
                if (o.has("la")) m.put("la", o.getDouble("la")).put("lo", o.getDouble("lo"));
                synchronized (msgs) { msgs.put(m); while (msgs.length() > 30) msgs.remove(0); }
                say(who + ": " + text + ("help".equals(o.optString("k")) && me != null && o.has("la") ? ". " + distWords(o.getDouble("la"), o.getDouble("lo")) + " away." : ""));
                return;
            }
            long t = o.optLong("t");
            if (t > 0 && System.currentTimeMillis() - t > 12 * 3600000L) return; // a position kept from an old ride
            JSONObject prev; synchronized (riders) { prev = riders.get(id); }
            if (prev != null && prev.optLong("t") > t) return; // older copy from the other server
            o.put("rx", t > 0 ? Math.min(System.currentTimeMillis(), t) : System.currentTimeMillis());
            synchronized (riders) { riders.put(id, o); }
            if (prev == null) { addMsg(o, "is in the group"); updateNote(); }
        } catch (Exception ignored) { }
    }

    static String msgText(String k, String x) {
        switch (k == null ? "" : k) {
            case "fuel": return "stopping for fuel";
            case "stop": return "pulling over";
            case "wait": return "wait for me";
            case "lost": return "I'm lost";
            case "ok": return "all good";
            case "help": return "need help, I've stopped";
            case "go": return "setting off";
            default: return x == null || x.isEmpty() ? "message" : clip(x, 80);
        }
    }

    // ---------- my position ----------
    @Override public void onLocationChanged(Location l) { me = l; sendIfDue(false); }
    private void sendIfDue(boolean force) {
        if (link == null || me == null) return;
        long now = System.currentTimeMillis(), since = now - lastSent;
        boolean moving = me.hasSpeed() && me.getSpeed() > 2;
        boolean moved = lastSentAt == null || me.distanceTo(lastSentAt) > 25;
        if (!(since >= STILL_EVERY || (moving && moved && since >= MOVE_EVERY) || (force && lastSent == 0))) return;
        try {
            JSONObject o = new JSONObject().put("id", myId).put("n", myName).put("c", myColour)
                    .put("la", Math.round(me.getLatitude() * 1e6) / 1e6).put("lo", Math.round(me.getLongitude() * 1e6) / 1e6)
                    .put("s", me.hasSpeed() ? Math.round(me.getSpeed() * 10) / 10.0 : 0).put("h", me.hasBearing() ? Math.round(me.getBearing()) : -1)
                    .put("a", Math.round(me.getAccuracy())).put("t", now).put("b", battery());
            link.sendPosition(o.toString());
            lastSent = now; lastSentAt = me;
        } catch (Exception ignored) { }
    }
    private void sendMessage(String kind, String text) {
        if (link == null) return;
        try {
            JSONObject o = new JSONObject().put("id", myId).put("n", myName).put("c", myColour).put("k", kind == null ? "" : kind).put("x", text == null ? "" : clip(text, 80)).put("t", System.currentTimeMillis());
            if (me != null) o.put("la", me.getLatitude()).put("lo", me.getLongitude());
            link.sendMessage(o.toString());
            JSONObject m = new JSONObject().put("key", "me:" + o.getLong("t")).put("id", myId).put("n", "You").put("c", myColour).put("k", o.getString("k")).put("text", msgText(kind, text)).put("t", o.getLong("t")).put("mine", true);
            synchronized (msgs) { msgs.put(m); while (msgs.length() > 30) msgs.remove(0); }
            lastSent = 0; sendIfDue(true);
        } catch (Exception ignored) { }
    }
    private int battery() {
        try { Intent b = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED)); int l = b.getIntExtra(BatteryManager.EXTRA_LEVEL, -1), s = b.getIntExtra(BatteryManager.EXTRA_SCALE, 100); return l < 0 ? -1 : Math.round(100f * l / s); }
        catch (Exception e) { return -1; }
    }

    // ---------- watching the group ----------
    private void checkGroup() {
        long now = System.currentTimeMillis();
        synchronized (riders) {
            Iterator<Map.Entry<String, JSONObject>> it = riders.entrySet().iterator();
            while (it.hasNext()) {
                JSONObject r = it.next().getValue(); String id = r.optString("id"), name = r.optString("n", "A rider");
                long age = now - r.optLong("rx", now);
                if (age > 12 * 3600000L) { it.remove(); continue; }
                String was = alertState.get(id), st;
                double d = me == null ? -1 : dist(r.optDouble("la"), r.optDouble("lo"));
                if (age > LOST_MS) st = "lost";
                else if (d > splitM) st = "far";
                else if (d >= 0 && d < splitM * 0.6) st = "near";
                else st = was == null ? "near" : was; // between the two distances: no change, so it doesn't keep flipping
                if (was != null && !st.equals(was)) {
                    if (st.equals("lost")) say("Lost contact with " + name + ". Last seen " + Math.round(age / 60000.0) + " minutes ago" + (d > 0 ? ", " + distWords(r.optDouble("la"), r.optDouble("lo")) + " away." : "."));
                    else if (st.equals("far")) say(name + " is " + distWords(r.optDouble("la"), r.optDouble("lo")) + " away.");
                    else if (st.equals("near") && was.equals("lost")) say(name + " is back in touch.");
                    else if (st.equals("near") && was.equals("far")) say(name + " has caught up.");
                }
                alertState.put(id, st);
            }
        }
        updateNote();
    }
    private double dist(double la, double lo) { float[] r = new float[1]; Location.distanceBetween(me.getLatitude(), me.getLongitude(), la, lo, r); return r[0]; }
    private String distWords(double la, double lo) {
        boolean km = "km".equals(Util.kvGet(this, "groupUnits"));
        double d = dist(la, lo) / (km ? 1000 : 1609.344);
        String u = km ? " kilometres" : " miles";
        return d < 0.3 ? (km ? Math.round(d * 1000) + " metres" : Math.round(d * 1760 / 10) * 10 + " yards") : d < 10 ? String.format(Locale.UK, "%.1f", d) + u : Math.round(d) + u;
    }
    private void say(String text) { if (voice) Speech.get(this).speak(text); }
    private void addMsg(JSONObject r, String text) {
        try {
            JSONObject m = new JSONObject().put("key", "sys:" + System.nanoTime()).put("n", r == null ? "" : r.optString("n", "A rider")).put("c", r == null ? "" : r.optString("c")).put("text", text).put("t", System.currentTimeMillis()).put("sys", true);
            synchronized (msgs) { msgs.put(m); while (msgs.length() > 30) msgs.remove(0); }
        } catch (Exception ignored) { }
    }
    private static String clip(String s, int n) { if (s == null) return ""; s = s.trim(); return s.length() > n ? s.substring(0, n) : s; }

    private void updateNote() {
        int n, lost = 0; long now = System.currentTimeMillis();
        synchronized (riders) { n = riders.size(); for (JSONObject r : riders.values()) if (now - r.optLong("rx", now) > LOST_MS) lost++; }
        boolean online = false; synchronized (servers) { for (String s : servers.values()) if ("online".equals(s)) online = true; }
        String title = online ? "Group ride: " + n + (n == 1 ? " other rider" : " other riders") : "Group ride: no connection, retrying";
        String text = lost > 0 ? lost + " not heard from for 3 minutes or more" : "Sharing your position with your group";
        try { getSystemService(NotificationManager.class).notify(NOTE_ID, note(title, text)); } catch (Exception ignored) { }
    }
    private Notification note(String title, String text) {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent pi = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        return b.setSmallIcon(android.R.drawable.ic_menu_share).setContentTitle(title).setContentText(text).setContentIntent(pi).setOngoing(true).setOnlyAlertOnce(true).build();
    }

    @Override public void onProviderEnabled(String p) { }
    @Override public void onProviderDisabled(String p) { }
    @SuppressWarnings("deprecation") @Override public void onStatusChanged(String p, int s, Bundle b) { }

    private void stop() {
        running = false; main.removeCallbacks(tick);
        Util.kvSet(this, "groupLast", "");
        if (link != null) { link.close(); link = null; }
        synchronized (riders) { riders.clear(); }
        code = "";
        try { ((LocationManager) getSystemService(LOCATION_SERVICE)).removeUpdates(this); } catch (Exception ignored) { }
        if (lock != null && lock.isHeld()) lock.release(); lock = null;
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        stopSelf();
    }
    @Override public void onDestroy() {
        main.removeCallbacks(tick);
        try { ((LocationManager) getSystemService(LOCATION_SERVICE)).removeUpdates(this); } catch (Exception ignored) { }
        if (lock != null && lock.isHeld()) lock.release();
        super.onDestroy();
    }
}
