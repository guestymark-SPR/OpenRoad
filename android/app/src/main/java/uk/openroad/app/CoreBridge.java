package uk.openroad.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Looper;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.util.Locale;

/** What the web app can ask of Android on any screen (window.Android): saved data, network, voice, GPS, ride recording. */
class CoreBridge {
    final Context ctx;
    final Tiles.Js js;
    private final LocationManager lm;
    boolean wantGps = false;

    CoreBridge(Context ctx, Tiles.Js js) { this.ctx = ctx; this.js = js; lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE); }

    private final LocationListener gps = new LocationListener() {
        @Override public void onLocationChanged(Location l) {
            js.run(String.format(Locale.US, "window.onNativeFix&&onNativeFix({coords:{latitude:%.7f,longitude:%.7f,speed:%s,heading:%s,accuracy:%.1f},timestamp:%d})",
                    l.getLatitude(), l.getLongitude(), l.hasSpeed() ? String.valueOf(l.getSpeed()) : "null",
                    l.hasBearing() ? String.valueOf(l.getBearing()) : "null", l.getAccuracy(),
                    // when the fix was taken, not when it arrived, so the app can place you where you are now
                    System.currentTimeMillis() - Math.max(0, (android.os.SystemClock.elapsedRealtimeNanos() - l.getElapsedRealtimeNanos()) / 1000000L)));
        }
        @Override public void onProviderEnabled(String p) { }
        @Override public void onProviderDisabled(String p) { js.run("window.onGpsError&&onGpsError('Location is switched off. Turn it on in quick settings.')"); }
        @SuppressWarnings("deprecation") @Override public void onStatusChanged(String p, int s, Bundle b) { }
    };

    boolean hasLocation() { return ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED; }
    void needPermission() { js.run("window.onGpsError&&onGpsError('OpenRoad needs location permission. Open OpenRoad on the phone to allow it.')"); }

    @SuppressLint("MissingPermission")
    void gpsOn() {
        wantGps = true;
        if (!hasLocation()) { needPermission(); return; }
        try {
            lm.removeUpdates(gps);
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 500L, 0f, gps, Looper.getMainLooper()); // as often as the GPS gives them (most phones: once a second)
            Location last = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            if (last != null && System.currentTimeMillis() - last.getTime() < 60000) gps.onLocationChanged(last);
            if (!lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) js.run("window.onGpsError&&onGpsError('Location is switched off. Turn it on in quick settings.')");
        } catch (Exception e) { js.run("window.onGpsError&&onGpsError(" + JSONObject.quote("GPS could not start: " + e.getMessage()) + ")"); }
    }
    void gpsOff(boolean forget) { if (forget) wantGps = false; try { lm.removeUpdates(gps); } catch (Exception ignored) { } }
    void onMain(Runnable r) { new android.os.Handler(Looper.getMainLooper()).post(r); }

    @JavascriptInterface public boolean isNative() { return true; }
    // Android Auto on this phone: whether it's installed and which version (for the setup page)
    @JavascriptInterface public String autoInfo() {
        try { android.content.pm.PackageInfo i = ctx.getPackageManager().getPackageInfo("com.google.android.projection.gearhead", 0);
            return new JSONObject().put("installed", true).put("version", i.versionName).toString(); }
        catch (Exception e) { return "{\"installed\":false}"; }
    }
    @JavascriptInterface public void openAutoSettings() {
        onMain(() -> { try { ctx.startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:com.google.android.projection.gearhead")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) { } });
    }
    @JavascriptInterface public String version() { try { return ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).versionName; } catch (Exception e) { return "?"; } }
    @SuppressWarnings("deprecation")
    @JavascriptInterface public int versionCode() { try { return ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).versionCode; } catch (Exception e) { return 0; } }
    @JavascriptInterface public String kvGet(String k) { return Util.kvGet(ctx, k); }
    @JavascriptInterface public void kvSet(String k, String v) { Util.kvSet(ctx, k, v); }
    @JavascriptInterface public void fetchTextH(int id, String url, String method, String body, String type, String headers) { Util.fetch(id, url, method, body, type, headers, js); }
    @JavascriptInterface public void speak(String text) { Speech.get(ctx).speak(text); }
    @JavascriptInterface public void speakPan(String text, float pan) { Speech.get(ctx).speakPan(text, pan); }
    @JavascriptInterface public String rideSteadiness(String since) { return RideService.steadinessSince(Long.parseLong(since)); }
    @JavascriptInterface public void stopSpeak() { Speech.get(ctx).stop(); }
    @JavascriptInterface public void speakIn(String text, String lang) { Speech.get(ctx).speakIn(text, lang, js); }
    @JavascriptInterface public void startGps() { onMain(this::gpsOn); }
    @JavascriptInterface public void stopGps() { onMain(() -> gpsOff(true)); }

    // ride recording that carries on with the screen off
    @JavascriptInterface public void rideStart(String name) {
        onMain(() -> {
            try {
                Intent i = new Intent(ctx, RideService.class).setAction(RideService.ACTION_START).putExtra("name", name);
                if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i); else ctx.startService(i);
            } catch (Exception ignored) { } // e.g. not allowed to start from the background: the ride still records while the screen shows it
        });
    }
    @JavascriptInterface public void rideStop() { onMain(() -> { try { ctx.startService(new Intent(ctx, RideService.class).setAction(RideService.ACTION_STOP)); } catch (Exception ignored) { } }); }
    @JavascriptInterface public boolean rideActive() { return RideService.running; }
    @JavascriptInterface public String rideTrack(String since) { return RideService.pointsSince(Long.parseLong(since)); }
    @JavascriptInterface public String rideJolts(String since) { return RideService.joltsSince(Long.parseLong(since)); }
    @JavascriptInterface public String mapPacks() { return Tiles.get(ctx).packsJson(); }
    @JavascriptInterface public String cacheInfo() { return Tiles.get(ctx).cacheInfo(); }
    @JavascriptInterface public void setPacksOnly(boolean on) { Util.kvSet(ctx, "packsOnly", on ? "1" : ""); }
    // group ride: positions shared with the group, kept going by GroupService with the screen off
    @JavascriptInterface public String groupNewCode() { return GroupLink.newCode(); }
    @JavascriptInterface public boolean groupCodeOk(String code) { return GroupLink.clean(code).length() >= 12; }
    @JavascriptInterface public void groupStart(String code, String name, String colour, boolean voice, double splitMi, String units) {
        Util.kvSet(ctx, "groupUnits", units == null ? "mi" : units);
        onMain(() -> {
            try {
                Intent i = new Intent(ctx, GroupService.class).setAction(GroupService.ACTION_START).putExtra("code", code).putExtra("name", name).putExtra("colour", colour).putExtra("voice", voice).putExtra("splitMi", splitMi);
                if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i); else ctx.startService(i);
            } catch (Exception e) { js.run("window.onGroupError&&onGroupError(" + JSONObject.quote(String.valueOf(e.getMessage())) + ")"); }
        });
    }
    @JavascriptInterface public void groupStop() { onMain(() -> { try { ctx.startService(new Intent(ctx, GroupService.class).setAction(GroupService.ACTION_STOP)); } catch (Exception ignored) { } }); }
    @JavascriptInterface public void groupSay(String kind, String text) { onMain(() -> { try { ctx.startService(new Intent(ctx, GroupService.class).setAction(GroupService.ACTION_SAY).putExtra("kind", kind).putExtra("text", text)); } catch (Exception ignored) { } }); }
    @JavascriptInterface public String groupState() { return GroupService.state(); }
    @JavascriptInterface public void eventPeek(String code, String kind, String json) { EventLink.peek(ctx, code, kind, json, js::run); }
    @JavascriptInterface public void eventRemind(String id, double at, String title, String text) { EventLink.remind(ctx, id, (long) at, title, text); }
    @JavascriptInterface public void groupRole(String role) { GroupService.setRole(role); }
    @JavascriptInterface public void groupChat(String text, String to, boolean withLocation) { GroupService.sendChat(text, to, withLocation); }
    @JavascriptInterface public String groupChatSince(double t) { return GroupService.chatSince((long) t); }
    @JavascriptInterface public void groupChatSeen(double t) { GroupService.seen((long) t); GroupService.clearChatNote(ctx); }
    @JavascriptInterface public void groupChatVoice(boolean on) { GroupService.chatVoice = on; }
    @JavascriptInterface public void groupChatNotify(boolean on) { GroupService.chatNotify = on; }
    @JavascriptInterface public void groupHazard(String kind, String note) { GroupService.addHazard(kind, note); }
    @JavascriptInterface public void groupHazardRemove(double t) { GroupService.removeHazard((long) t); }
    @JavascriptInterface public String groupHazards() { return GroupService.hazardsJson(); }
    @JavascriptInterface public void groupShare(String what, String json) { if ("r".equals(what) || "x".equals(what)) GroupService.share(what, json); }
    // crash detection (runs while recording a ride or in a group ride)
    @JavascriptInterface public void crashConfig(String json) { Util.kvSet(ctx, "crash", json); }
    @JavascriptInterface public String crashState() { return CrashWatch.state(); }
    @JavascriptInterface public void crashCancel() { CrashWatch.cancel(ctx); }
    @JavascriptInterface public void crashTest() { CrashWatch.runTest(ctx); }
}
