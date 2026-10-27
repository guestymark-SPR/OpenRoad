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
    static volatile String code = "", myId = "", myName = "", myColour = "", myRole = "";
    // routes and regroup points shared by riders (kept by the servers, so latecomers get them), by rider id
    private static final Map<String, JSONObject> routes = new LinkedHashMap<>(), meets = new LinkedHashMap<>();
    private static volatile boolean allThere = false;
    // chat: every message received or sent this group ride (newest last), and my last 20, kept on the
    // servers so a rider who had no signal gets them when they reconnect
    private static final JSONArray chat = new JSONArray();
    private static final JSONArray myChat = new JSONArray();
    static volatile long chatSeen = 0, chatGot = 0;
    static volatile boolean chatVoice = true, chatNotify = true, appVisible = false;
    // hazards riders have marked (gravel, diesel...), kept for 8 hours, and mine to send to the group
    private static final Map<String, JSONObject> hazards = new LinkedHashMap<>();
    private static final JSONArray myHazards = new JSONArray();
    private final Map<String, Boolean> hazWarned = new LinkedHashMap<>();
    private static final Map<String, JSONObject> riders = new LinkedHashMap<>();
    private static final JSONArray msgs = new JSONArray();
    private static final Map<String, String> servers = new LinkedHashMap<>();

    private static GroupService self;
    private GroupLink link;
    private BikeLink ble; private static final Map<String, String> bleNames = new LinkedHashMap<>();
    private PowerManager.WakeLock lock;
    private Location me;
    private long lastSent = 0; private Location lastSentAt;
    private boolean voice = true; private double splitM = 3218.7;
    private final Map<String, String> alertState = new LinkedHashMap<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable tick = new Runnable() { @Override public void run() { checkGroup(); sendIfDue(true); if (ble != null && link != null) ble.urgent(!link.anyOnline()); main.postDelayed(this, 10000); } };

    static String state() {
        try {
            JSONObject o = new JSONObject();
            o.put("on", running); o.put("code", code); o.put("me", myId); o.put("name", myName); o.put("colour", myColour);
            JSONArray rs = new JSONArray(); long now = System.currentTimeMillis();
            synchronized (riders) { for (JSONObject r : riders.values()) { JSONObject c = new JSONObject(r.toString()); c.put("age", (now - r.optLong("rx", now)) / 1000); rs.put(c); } }
            o.put("riders", rs); o.put("role", myRole); o.put("allThere", allThere);
            int unread = 0; long last = 0;
            synchronized (chat) { for (int i = 0; i < chat.length(); i++) { JSONObject c = chat.getJSONObject(i); last = Math.max(last, c.optLong("rx", c.optLong("t"))); if (!c.optBoolean("mine") && c.optLong("t") > chatSeen) unread++; } }
            o.put("unread", unread); o.put("chatLast", last); o.put("chatSeen", chatSeen);
            JSONArray rt = new JSONArray(); synchronized (routes) { for (JSONObject r : routes.values()) rt.put(r); } o.put("routes", rt);
            JSONArray mt = new JSONArray(); synchronized (meets) { for (JSONObject r : meets.values()) mt.put(r); } o.put("meets", mt);
            synchronized (msgs) { o.put("msgs", new JSONArray(msgs.toString())); }
            JSONObject sv = new JSONObject(); synchronized (servers) { for (Map.Entry<String, String> e : servers.entrySet()) sv.put(e.getKey(), e.getValue()); }
            o.put("servers", sv); o.put("ble", BikeLink.status);
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
        synchronized (routes) { routes.clear(); } synchronized (meets) { meets.clear(); } allThere = false;
        synchronized (hazards) { hazards.clear(); } synchronized (myHazards) { while (myHazards.length() > 0) myHazards.remove(0); } hazWarned.clear();
        synchronized (chat) { while (chat.length() > 0) chat.remove(0); } synchronized (myChat) { while (myChat.length() > 0) myChat.remove(0); } chatSeen = 0; chatGot = 0;
        synchronized (msgs) { while (msgs.length() > 0) msgs.remove(0); }
        myId = Util.kvGet(this, "groupRider");
        if (myId == null || myId.length() < 8) { myId = GroupLink.newRiderId(); Util.kvSet(this, "groupRider", myId); }
        code = newCode;
        try { link = new GroupLink(code, myId, GroupLink.SERVERS, listener); }
        catch (Exception e) { addMsg(null, "Couldn't join: " + e.getMessage()); stop(); return START_NOT_STICKY; }
        startBle();
        if (!running) {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "OpenRoad:group"); lock.acquire();
            try {
                LocationManager lm = (LocationManager) getSystemService(LOCATION_SERVICE);
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, this, Looper.getMainLooper());
                Location l = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
                if (l != null && System.currentTimeMillis() - l.getTime() < 120000) me = l;
            } catch (Exception ignored) { }
            running = true; self = this;
            CrashWatch.start(this, "group");
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
            if (id.isEmpty()) return;
            if ("r".equals(kind) || "x".equals(kind) || "r-clear".equals(kind) || "x-clear".equals(kind)) { kept(kind, id, o); return; }
            if ("c".equals(kind)) { if (!id.equals(myId)) chatIn(o); return; }
            if ("c-clear".equals(kind) || "h-clear".equals(kind)) return;
            if ("h".equals(kind)) { hazIn(o); return; }
            if (id.equals(myId)) return;
            if ("left".equals(kind)) {
                JSONObject r; synchronized (riders) { r = riders.remove(id); }
                if (r != null) { addMsg(r, "left the group"); alertState.remove(id); }
                updateNote(); return;
            }
            if ("m".equals(kind)) { // the same message arrives from both servers: keep one
                String key = id + ":" + o.optLong("t");
                synchronized (msgs) { for (int i = 0; i < msgs.length(); i++) if (key.equals(msgs.getJSONObject(i).optString("key"))) return; }
                // the same quick message over the internet and bike to bike: keep the first
                if (!o.optString("k").isEmpty()) synchronized (msgs) { for (int i = 0; i < msgs.length(); i++) { JSONObject x = msgs.getJSONObject(i); if (x.optString("id").startsWith(id.substring(0, Math.min(6, id.length()))) && o.optString("k").equals(x.optString("k")) && System.currentTimeMillis() - x.optLong("t") < 180000) return; } }
                JSONObject r; synchronized (riders) { r = riders.get(id); }
                String who = o.optString("n", r != null ? r.optString("n") : "A rider");
                String text = msgText(o.optString("k"), o.optString("x"));
                JSONObject m = new JSONObject().put("key", key).put("id", id).put("n", who).put("c", o.optString("c")).put("k", o.optString("k")).put("text", text).put("t", System.currentTimeMillis());
                if (o.has("la")) m.put("la", o.getDouble("la")).put("lo", o.getDouble("lo"));
                synchronized (msgs) { msgs.put(m); while (msgs.length() > 30) msgs.remove(0); }
                if ("crash".equals(o.optString("k")) || "help".equals(o.optString("k"))) urgent(who, text, o);
                say(who + ": " + text + (("help".equals(o.optString("k")) || "crash".equals(o.optString("k"))) && me != null && o.has("la") ? ". " + distWords(o.getDouble("la"), o.getDouble("lo")) + " away." : ""));
                return;
            }
            long t = o.optLong("t");
            if (t > 0 && System.currentTimeMillis() - t > 12 * 3600000L) return; // a position kept from an old ride
            JSONObject prev; synchronized (riders) { prev = riders.get(id); }
            if (prev != null && prev.optLong("t") > t) return; // older copy from the other server
            o.put("rx", t > 0 ? Math.min(System.currentTimeMillis(), t) : System.currentTimeMillis());
            synchronized (riders) { riders.put(id, o); if (id.length() >= 6 && !id.endsWith("000000")) riders.remove(id.substring(0, 6) + "000000"); } // the same rider heard bike to bike before
            if (prev == null) { addMsg(o, "is in the group"); updateNote(); }
        } catch (Exception ignored) { }
    }

    private void kept(String kind, String id, JSONObject o) throws Exception {
        boolean route = kind.startsWith("r"), clear = kind.endsWith("-clear");
        Map<String, JSONObject> m = route ? routes : meets;
        JSONObject prev; synchronized (m) { prev = m.get(id); }
        if (clear) { synchronized (m) { m.remove(id); } if (!route) allThere = false; return; }
        if (prev != null && prev.optLong("t") >= o.optLong("t")) return; // the same thing from the other server
        if (System.currentTimeMillis() - o.optLong("t") > 24 * 3600000L) return; // left over from an old ride
        synchronized (m) { m.put(id, o); }
        if (id.equals(myId)) return;
        String who = o.optString("n", "A rider");
        if (route) say(who + " shared a route" + (o.optString("name").isEmpty() ? "" : ": " + o.optString("name")) + ". Open the group page to load it.");
        else { allThere = false; say(who + " set a regroup point" + (o.optString("name").isEmpty() ? "" : " at " + o.optString("name")) + (me != null ? ", " + distWords(o.optDouble("la"), o.optDouble("lo")) + " away." : ".")); }
    }
    // ---------- chat ----------
    private void chatIn(JSONObject bundle) throws Exception {
        JSONArray ms = bundle.optJSONArray("msgs"); if (ms == null) return;
        String id = bundle.getString("id"), who = bundle.optString("n", "A rider"), col = bundle.optString("c");
        java.util.List<JSONObject> fresh = new java.util.ArrayList<>();
        synchronized (chat) {
            for (int i = 0; i < ms.length(); i++) {
                JSONObject m = ms.getJSONObject(i); String to = m.optString("to");
                if (!to.isEmpty() && !to.equals(myId)) continue; // a private message to someone else
                String key = id + ":" + m.optLong("t");
                boolean have = false; for (int j = chat.length() - 1; j >= 0 && !have; j--) if (key.equals(chat.getJSONObject(j).optString("key"))) have = true;
                if (have) continue;
                JSONObject c = new JSONObject(m.toString()).put("key", key).put("id", id).put("n", who).put("c", col).put("rx", System.currentTimeMillis());
                fresh.add(c);
            }
            for (JSONObject c : fresh) insertSorted(c);
            while (chat.length() > 400) chat.remove(0);
        }
        if (fresh.isEmpty()) return;
        long newest = 0; for (JSONObject c : fresh) newest = Math.max(newest, c.optLong("t"));
        chatGot = Math.max(chatGot, newest);
        lastSent = 0; sendIfDue(true); // tells the sender it arrived (the ticks)
        for (JSONObject c : fresh) {
            if (System.currentTimeMillis() - c.optLong("t") > 15 * 60000) continue; // catching up on old ones: no noise
            String text = c.optString("x"), line = who + (c.optString("to").isEmpty() ? "" : ", privately") + ": " + (text.isEmpty() && c.has("la") ? "shared their location" : text);
            if (chatVoice) say(line);
            if (!appVisible && chatNotify) chatNote(line);
        }
    }
    private static void insertSorted(JSONObject c) throws Exception {
        long t = c.optLong("t"); int at = chat.length();
        while (at > 0 && chat.getJSONObject(at - 1).optLong("t") > t) at--;
        if (at == chat.length()) { chat.put(c); return; }
        JSONArray copy = new JSONArray();
        for (int i = 0; i < chat.length(); i++) { if (i == at) copy.put(c); copy.put(chat.get(i)); }
        while (chat.length() > 0) chat.remove(0);
        for (int i = 0; i < copy.length(); i++) chat.put(copy.get(i));
    }
    private final java.util.List<String> noteLines = new java.util.ArrayList<>();
    private void chatNote(String line) {
        try {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel("groupchat") == null) {
                NotificationChannel ch = new NotificationChannel("groupchat", "Group chat", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("Messages from riders in your group"); nm.createNotificationChannel(ch);
            }
            noteLines.add(line); while (noteLines.size() > 6) noteLines.remove(0);
            Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT).putExtra("openChat", true);
            PendingIntent pi = PendingIntent.getActivity(this, 4, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification.InboxStyle st = new Notification.InboxStyle(); for (String l : noteLines) st.addLine(l);
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "groupchat") : new Notification.Builder(this);
            b.setSmallIcon(android.R.drawable.sym_action_chat).setContentTitle("Group chat").setContentText(line).setStyle(st).setContentIntent(pi).setAutoCancel(true).setCategory(Notification.CATEGORY_MESSAGE);
            nm.notify(14, b.build());
        } catch (Exception ignored) { }
    }
    static void clearChatNote(android.content.Context c) { try { ((NotificationManager) c.getSystemService(NOTIFICATION_SERVICE)).cancel(14); GroupService g = self; if (g != null) g.noteLines.clear(); } catch (Exception ignored) { } }
    static void sendChat(String text, String to, boolean withLocation) {
        GroupService g = self; if (g == null || g.link == null) return;
        g.main.post(() -> {
            try {
                JSONObject m = new JSONObject().put("t", System.currentTimeMillis()).put("x", clip(text, 500));
                if (to != null && !to.isEmpty()) m.put("to", to);
                if (withLocation && g.me != null) m.put("la", Math.round(g.me.getLatitude() * 1e5) / 1e5).put("lo", Math.round(g.me.getLongitude() * 1e5) / 1e5);
                synchronized (myChat) { myChat.put(m); while (myChat.length() > 20) myChat.remove(0); }
                JSONObject bundle = new JSONObject().put("id", myId).put("n", myName).put("c", myColour).put("t", m.getLong("t"));
                synchronized (myChat) { bundle.put("msgs", new JSONArray(myChat.toString())); }
                g.link.sendKept("c", bundle.toString());
                JSONObject mine = new JSONObject(m.toString()).put("key", myId + ":" + m.getLong("t")).put("id", myId).put("n", myName).put("c", myColour).put("mine", true);
                synchronized (chat) { insertSorted(mine); while (chat.length() > 400) chat.remove(0); }
            } catch (Exception ignored) { }
        });
    }
    static String chatSince(long t) {
        JSONArray out = new JSONArray();
        try { synchronized (chat) { for (int i = 0; i < chat.length(); i++) { JSONObject c = chat.getJSONObject(i); if (c.optLong("rx", c.optLong("t")) > t || c.optLong("t") > t) out.put(c); } } } catch (Exception ignored) { }
        return out.toString();
    }
    static void seen(long t) { if (t > chatSeen) { chatSeen = t; GroupService g = self; if (g != null) g.main.post(() -> { g.lastSent = 0; g.sendIfDue(true); }); } }
    // ---------- hazard drops ----------
    static final String[][] HAZ = {{"gravel", "Gravel"}, {"diesel", "Diesel or oil"}, {"pothole", "Pothole"}, {"mud", "Mud on the road"}, {"roadworks", "Roadworks"}, {"animal", "Animals on the road"},
            {"crash", "Accident"}, {"flood", "Water on the road"}, {"debris", "Something in the road"}, {"leaves", "Wet leaves"}, {"other", "Hazard"}};
    static String hazName(String k) { for (String[] h : HAZ) if (h[0].equals(k)) return h[1]; return "Hazard"; }
    private void hazIn(JSONObject bundle) throws Exception {
        JSONArray hs = bundle.optJSONArray("hz"); if (hs == null) return;
        String id = bundle.getString("id"), who = bundle.optString("n", "A rider");
        synchronized (hazards) {
            // what this rider has marked now replaces what they had before (so removed ones go)
            hazards.entrySet().removeIf(e -> e.getValue().optString("id").equals(id));
            for (int i = 0; i < hs.length(); i++) {
                JSONObject h = hs.getJSONObject(i);
                if (System.currentTimeMillis() - h.optLong("t") > 8 * 3600000L) continue;
                hazards.put(id + ":" + h.optLong("t"), new JSONObject(h.toString()).put("id", id).put("n", who).put("key", id + ":" + h.optLong("t")));
            }
        }
    }
    static void addHazard(String kind, String note) {
        GroupService g = self; if (g == null || g.link == null || g.me == null) return;
        g.main.post(() -> {
            try {
                JSONObject h = new JSONObject().put("k", kind).put("x", clip(note, 60)).put("t", System.currentTimeMillis())
                        .put("la", Math.round(g.me.getLatitude() * 1e5) / 1e5).put("lo", Math.round(g.me.getLongitude() * 1e5) / 1e5);
                synchronized (myHazards) { myHazards.put(h); while (myHazards.length() > 30) myHazards.remove(0); }
                g.pushHazards();
                synchronized (hazards) { hazards.put(myId + ":" + h.getLong("t"), new JSONObject(h.toString()).put("id", myId).put("n", myName).put("key", myId + ":" + h.getLong("t")).put("mine", true)); }
                g.say(hazName(kind) + " marked. The group will be warned.");
            } catch (Exception ignored) { }
        });
    }
    static void removeHazard(long t) {
        GroupService g = self; if (g == null) return;
        g.main.post(() -> {
            try {
                synchronized (myHazards) { for (int i = myHazards.length() - 1; i >= 0; i--) if (myHazards.getJSONObject(i).optLong("t") == t) myHazards.remove(i); }
                synchronized (hazards) { hazards.remove(myId + ":" + t); }
                g.pushHazards();
            } catch (Exception ignored) { }
        });
    }
    private void pushHazards() throws Exception {
        JSONObject b = new JSONObject().put("id", myId).put("n", myName).put("t", System.currentTimeMillis());
        synchronized (myHazards) { b.put("hz", new JSONArray(myHazards.toString())); }
        if (link != null) link.sendKept("h", b.toString());
    }
    // warn as I get near a hazard someone else marked: the distance grows with speed (about 12 seconds' warning, at least 250 m)
    private void hazCheck() {
        if (me == null) return;
        float v = me.hasSpeed() ? me.getSpeed() : 0;
        double warnAt = Math.max(250, v * 12);
        java.util.List<Object[]> say = new java.util.ArrayList<>();
        synchronized (hazards) {
            for (JSONObject h : hazards.values()) {
                if (h.optBoolean("mine") || myId.equals(h.optString("id"))) continue;
                float[] d = new float[1]; Location.distanceBetween(me.getLatitude(), me.getLongitude(), h.optDouble("la"), h.optDouble("lo"), d);
                String k = h.optString("key"); Boolean was = hazWarned.get(k);
                boolean ahead = true;
                if (me.hasBearing() && d[0] > 60) { // only hazards in front of me, not ones on a road I've passed
                    Location t = new Location(""); t.setLatitude(h.optDouble("la")); t.setLongitude(h.optDouble("lo"));
                    float diff = Math.abs(((me.bearingTo(t) - me.getBearing()) % 360 + 540) % 360 - 180);
                    ahead = diff < 70;
                }
                if (d[0] < warnAt && ahead && (was == null || !was) && v > 2) { hazWarned.put(k, true); say.add(new Object[]{h, (double) d[0]}); }
                else if (d[0] > 1000 && was != null && was) hazWarned.put(k, false); // far away again: warn next time round
            }
        }
        for (Object[] s : say) {
            JSONObject h = (JSONObject) s[0];
            String note = h.optString("x");
            say(hazName(h.optString("k")) + " ahead" + (note.isEmpty() ? "" : ", " + note) + ", in " + Math.round((Double) s[1] / 10) * 10 + " metres. Marked by " + h.optString("n", "a rider") + ".");
        }
    }
    static String hazardsJson() {
        JSONArray a = new JSONArray(); synchronized (hazards) { for (JSONObject h : hazards.values()) a.put(h); } return a.toString();
    }
    static void setRole(String r) { myRole = r == null ? "" : r; GroupService g = self; if (g != null) g.main.post(() -> { g.lastSent = 0; g.sendIfDue(true); }); }
    static void share(String what, String json) {
        GroupService g = self; if (g == null || g.link == null) return;
        g.main.post(() -> {
            try {
                if (json == null || json.isEmpty()) { g.link.clearKept(what); Map<String, JSONObject> m = "r".equals(what) ? routes : meets; synchronized (m) { m.remove(myId); } if ("x".equals(what)) allThere = false; return; }
                JSONObject o = new JSONObject(json).put("id", myId).put("n", myName).put("c", myColour).put("t", System.currentTimeMillis());
                g.link.sendKept(what, o.toString());
                Map<String, JSONObject> m = "r".equals(what) ? routes : meets; synchronized (m) { m.put(myId, o); }
                if ("x".equals(what)) allThere = false;
            } catch (Exception ignored) { }
        });
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
            case "crash": return "may have crashed. Their phone sent an automatic crash alert";
            default: return x == null || x.isEmpty() ? "message" : clip(x, 80);
        }
    }

    // ---------- my position ----------
    @Override public void onLocationChanged(Location l) { me = l; CrashWatch.fix(l); sendIfDue(false); hazCheck(); if (ble != null) ble.position(l); }

    // ---------- bike to bike (Bluetooth, no signal needed) ----------
    void startBle() {
        if (ble != null) { ble.stop(); ble = null; }
        if ("off".equals(Util.kvGet(this, "bikeLink"))) { BikeLink.status = "off"; return; }
        try { ble = new BikeLink(this, code, myId, myName, bleOut); ble.start(); if (me != null) ble.position(me); } catch (Exception e) { ble = null; BikeLink.status = "couldn't start"; }
    }
    static void bleRestart() { GroupService g = self; if (g != null) g.main.post(g::startBle); }
    private JSONObject riderByShort(String s) { for (JSONObject r : riders.values()) if (r.optString("id").startsWith(s)) return r; return null; }
    private final BikeLink.Out bleOut = new BikeLink.Out() {
        @Override public void position(String s, double la, double lo, float speed, int heading, long ageMs, boolean relayed) {
            try {
                long rx = System.currentTimeMillis() - ageMs; JSONObject r, created = null;
                synchronized (riders) {
                    r = riderByShort(s);
                    if (r == null) { created = r = new JSONObject().put("id", s + "000000").put("n", bleNames.containsKey(s) ? bleNames.get(s) : "Rider nearby").put("c", "#5d6d7e"); riders.put(s + "000000", r); }
                    if (r.optLong("rx") >= rx) return; // what came over the internet is newer
                    r.put("la", la).put("lo", lo).put("s", speed).put("h", heading).put("rx", rx).put("t", rx).put("via", relayed ? "ble2" : "ble");
                }
                if (created != null) { addMsg(created, "is in range, bike to bike"); updateNote(); }
            } catch (Exception ignored) { }
        }
        @Override public void message(String s, String kind) {
            try {
                JSONObject r; synchronized (riders) { r = riderByShort(s); }
                JSONObject o = new JSONObject().put("id", r != null ? r.optString("id") : s + "000000").put("n", r != null ? r.optString("n") : bleNames.containsKey(s) ? bleNames.get(s) : "A rider nearby")
                        .put("c", r != null ? r.optString("c") : "").put("k", kind).put("t", System.currentTimeMillis()).put("via", "ble");
                if (r != null && r.has("la")) o.put("la", r.optDouble("la")).put("lo", r.optDouble("lo"));
                received("m", o.toString());
            } catch (Exception ignored) { }
        }
        @Override public void name(String s, String n) {
            bleNames.put(s, n);
            synchronized (riders) { JSONObject r = riderByShort(s); if (r != null && "Rider nearby".equals(r.optString("n"))) try { r.put("n", n); } catch (Exception ignored) { } }
        }
    };
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
                    .put("a", Math.round(me.getAccuracy())).put("t", now).put("b", battery()).put("r", myRole).put("cr", chatGot).put("cs", chatSeen);
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
            if (ble != null) ble.message(kind);
            JSONObject m = new JSONObject().put("key", "me:" + o.getLong("t")).put("id", myId).put("n", "You").put("c", myColour).put("k", o.getString("k")).put("text", msgText(kind, text)).put("t", o.getLong("t")).put("mine", true);
            synchronized (msgs) { msgs.put(m); while (msgs.length() > 30) msgs.remove(0); }
            lastSent = 0; sendIfDue(true);
        } catch (Exception ignored) { }
    }
    /** From CrashWatch: tell the group. Returns false if not in a group. */
    static boolean crashAlert(Location at) {
        GroupService g = self; if (g == null || !running) return false;
        if (at != null) g.me = at;
        g.main.post(() -> g.sendMessage("crash", ""));
        return true;
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
            sweepCheck(now);
        }
        meetCheck(now);
        updateNote();
    }
    // the back marker: say when a rider drops behind me (further from the leader than I am)
    private final Map<String, Boolean> behind = new LinkedHashMap<>();
    private void sweepCheck(long now) {
        if (!"sweep".equals(myRole) || me == null) { behind.clear(); return; }
        JSONObject lead = null;
        for (JSONObject r : riders.values()) if ("lead".equals(r.optString("r")) && now - r.optLong("rx", now) < LOST_MS) lead = r;
        if (lead == null) return;
        double mine = dist(lead.optDouble("la"), lead.optDouble("lo"));
        for (JSONObject r : riders.values()) {
            if (r == lead || now - r.optLong("rx", now) > LOST_MS) continue;
            float[] d = new float[1]; Location.distanceBetween(lead.optDouble("la"), lead.optDouble("lo"), r.optDouble("la"), r.optDouble("lo"), d);
            String id = r.optString("id"); Boolean was = behind.get(id);
            boolean now2 = was != null && was ? d[0] > mine + 250 : d[0] > mine + 600; // a margin each way so it doesn't keep flipping
            if (was != null && now2 != was) say(r.optString("n", "A rider") + (now2 ? " has dropped behind you." : " is back in front of you."));
            behind.put(id, now2);
        }
    }
    // everyone within 250 m of the newest regroup point: say so once
    private void meetCheck(long now) {
        JSONObject pt = null; synchronized (meets) { for (JSONObject x : meets.values()) if (pt == null || x.optLong("t") > pt.optLong("t")) pt = x; }
        if (pt == null || me == null) return;
        if (dist(pt.optDouble("la"), pt.optDouble("lo")) > 250) return;
        int n = 0, there = 0;
        synchronized (riders) { for (JSONObject r : riders.values()) { if (now - r.optLong("rx", now) > LOST_MS) continue; n++; float[] d = new float[1]; Location.distanceBetween(pt.optDouble("la"), pt.optDouble("lo"), r.optDouble("la"), r.optDouble("lo"), d); if (d[0] <= 250) there++; } }
        boolean all = n > 0 && there == n;
        if (all && !allThere) say("Everyone's at the regroup point.");
        allThere = all;
    }
    private double dist(double la, double lo) { float[] r = new float[1]; Location.distanceBetween(me.getLatitude(), me.getLongitude(), la, lo, r); return r[0]; }
    private String distWords(double la, double lo) {
        boolean km = "km".equals(Util.kvGet(this, "groupUnits"));
        double d = dist(la, lo) / (km ? 1000 : 1609.344);
        String u = km ? " kilometres" : " miles";
        return d < 0.3 ? (km ? Math.round(d * 1000) + " metres" : Math.round(d * 1760 / 10) * 10 + " yards") : d < 10 ? String.format(Locale.UK, "%.1f", d) + u : Math.round(d) + u;
    }
    // a crash or help call from a rider: a high-priority notification that opens the app, voice even if muted
    private void urgent(String who, String text, JSONObject o) {
        try {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel("groupsos") == null) {
                NotificationChannel ch = new NotificationChannel("groupsos", "Group ride: crash and help calls", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("When someone in your group crashes or asks for help");
                ch.enableVibration(true); ch.setVibrationPattern(new long[]{0, 700, 300, 700, 300, 700});
                nm.createNotificationChannel(ch);
            }
            Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT).putExtra("groupRider", o.optString("id"));
            PendingIntent pi = PendingIntent.getActivity(this, 3, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            String where = me != null && o.has("la") ? distWords(o.getDouble("la"), o.getDouble("lo")) + " away. " : "";
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "groupsos") : new Notification.Builder(this);
            b.setSmallIcon(android.R.drawable.ic_dialog_alert).setContentTitle(who + " " + text).setContentText(where + "Tap to see where.").setContentIntent(pi).setAutoCancel(true).setCategory(Notification.CATEGORY_ALARM);
            nm.notify(13 + Math.abs(o.optString("id").hashCode() % 1000), b.build());
            if (!voice) Speech.get(this).speak(who + " " + text + ". " + where);
        } catch (Exception ignored) { }
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
        running = false; self = null; main.removeCallbacks(tick);
        CrashWatch.stop("group");
        Util.kvSet(this, "groupLast", "");
        if (link != null) { link.close(); link = null; }
        if (ble != null) { ble.stop(); ble = null; }
        synchronized (riders) { riders.clear(); }
        code = "";
        try { ((LocationManager) getSystemService(LOCATION_SERVICE)).removeUpdates(this); } catch (Exception ignored) { }
        if (lock != null && lock.isHeld()) lock.release(); lock = null;
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        stopSelf();
    }
    @Override public void onDestroy() {
        main.removeCallbacks(tick); CrashWatch.stop("group"); if (self == this) self = null;
        try { ((LocationManager) getSystemService(LOCATION_SERVICE)).removeUpdates(this); } catch (Exception ignored) { }
        if (lock != null && lock.isHeld()) lock.release();
        super.onDestroy();
    }
}
