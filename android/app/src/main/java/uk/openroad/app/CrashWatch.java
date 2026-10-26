package uk.openroad.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.Location;
import android.location.LocationManager;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.telephony.SmsManager;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Locale;

/**
 * Crash detection while a ride is being recorded or a group ride is on.
 * A crash is a hard jolt (over 4 g on the phone's accelerometer) while riding at over 15 mph,
 * followed by the bike stopping and staying stopped. Then the phone alarms for 60 seconds.
 * If nobody taps "I'm OK", the safety contact is texted the position, and the group (if any) is told.
 * A pothole or a dropped phone gives the jolt but not the stop, so it doesn't count.
 */
public class CrashWatch implements SensorEventListener {
    private static final String CH = "crash1";
    static final String OK = "uk.openroad.app.CRASH_OK";
    private static final int NOTE = 31, COUNTDOWN = 60;
    private static final float JOLT = 4f * 9.81f;
    private static final float RIDING = 6.7f;   // m/s, 15 mph
    private static final float STOPPED = 1.5f;  // m/s

    private static CrashWatch inst;
    private static final java.util.Set<String> owners = new java.util.HashSet<>();
    private static int users = 0;

    // shared with the web app
    static volatile String phase = "off";       // off, watching, checking, alarm, sent, cancelled
    static volatile long until = 0;            // when the text goes if not cancelled
    static volatile boolean test = false;
    static volatile String result = "";

    private final Context ctx;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final SensorManager sm;
    private float lastFastSpeed = 0; private long lastFastAt = 0;
    private long joltAt = 0; private float joltG = 0;
    private Location pos;
    private Ringtone ring;

    private CrashWatch(Context c) { ctx = c.getApplicationContext(); sm = (SensorManager) ctx.getSystemService(Context.SENSOR_SERVICE); }

    /** Ride recording and group ride each start and stop it; it runs while either wants it. */
    static synchronized void start(Context c, String owner) {
        if (!settings(c).optBoolean("on", false)) return;
        if (inst == null) inst = new CrashWatch(c);
        boolean first = owners.isEmpty();
        owners.add(owner); users = owners.size();
        if (first) inst.listen(true);
    }
    static synchronized void stop(String owner) {
        if (!owners.remove(owner)) return;
        users = owners.size();
        if (users == 0 && inst != null) { inst.listen(false); if (!"alarm".equals(phase)) phase = "off"; }
    }
    static void fix(Location l) {
        CrashWatch w = inst; if (w == null) return;
        w.main.post(() -> w.onFix(l));
    }
    static String state() {
        try { return new JSONObject().put("phase", phase).put("left", Math.max(0, (until - System.currentTimeMillis()) / 1000)).put("test", test).put("result", result).toString(); }
        catch (Exception e) { return "{}"; }
    }
    static void cancel(Context c) {
        CrashWatch w = inst != null ? inst : new CrashWatch(c);
        w.main.post(() -> { if ("alarm".equals(phase) || "checking".equals(phase)) { phase = users > 0 ? "watching" : "off"; result = "cancelled"; w.quiet(); } });
    }
    /** A practice run: the full alarm and countdown, but nothing is sent. */
    static void runTest(Context c) {
        if (inst == null) inst = new CrashWatch(c);
        CrashWatch w = inst; w.main.post(() -> { test = true; w.alarm(); });
    }
    static JSONObject settings(Context c) { try { return new JSONObject(Util.kvGet(c, "crash")); } catch (Exception e) { return new JSONObject(); } }

    private void listen(boolean on) {
        Sensor acc = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        if (on && acc != null) { sm.registerListener(this, acc, SensorManager.SENSOR_DELAY_GAME); phase = "watching"; }
        else sm.unregisterListener(this);
    }

    @Override public void onSensorChanged(SensorEvent e) {
        float g = (float) Math.sqrt(e.values[0] * e.values[0] + e.values[1] * e.values[1] + e.values[2] * e.values[2]);
        long now = System.currentTimeMillis();
        if (g > JOLT && "watching".equals(phase) && lastFastSpeed > RIDING && now - lastFastAt < 6000) {
            joltAt = now; joltG = g / 9.81f; phase = "checking";
            main.postDelayed(this::checkStopped, 12000);
        }
    }
    @Override public void onAccuracyChanged(Sensor s, int a) { }

    private void onFix(Location l) {
        pos = l;
        if (l.hasSpeed() && l.getSpeed() > RIDING) { lastFastSpeed = l.getSpeed(); lastFastAt = System.currentTimeMillis(); }
        if ("checking".equals(phase) && l.hasSpeed() && l.getSpeed() > 4f && System.currentTimeMillis() - joltAt > 4000) phase = "watching"; // still riding: it was a bump
    }
    // 12 s after the jolt: has the bike stopped? Then check again 15 s later, so a quick stop and go doesn't set it off.
    private void checkStopped() {
        if (!"checking".equals(phase)) return;
        if (!stoppedNow()) { phase = "watching"; return; }
        main.postDelayed(() -> { if ("checking".equals(phase)) { if (stoppedNow()) { test = false; alarm(); } else phase = "watching"; } }, 15000);
    }
    private boolean stoppedNow() {
        if (pos == null) return true; // no GPS since the jolt: treat as stopped
        boolean fresh = System.currentTimeMillis() - pos.getTime() < 8000;
        return !fresh || !pos.hasSpeed() || pos.getSpeed() < STOPPED;
    }

    // ---------- the alarm ----------
    private void alarm() {
        phase = "alarm"; result = ""; until = System.currentTimeMillis() + COUNTDOWN * 1000L;
        JSONObject s = settings(ctx); String who = s.optString("name", "your contact");
        Speech.get(ctx).speak((test ? "Crash alert test. " : "Crash detected. ") + "Are you OK? Tap I'm OK to cancel, or " + (who.isEmpty() ? "your contact" : who) + " will be sent your position in one minute.");
        try {
            AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
            am.setStreamVolume(AudioManager.STREAM_ALARM, am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0);
            ring = RingtoneManager.getRingtone(ctx, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM));
            if (ring != null) {
                if (Build.VERSION.SDK_INT >= 28) ring.setLooping(true);
                ring.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
                main.postDelayed(() -> { if ("alarm".equals(phase) && ring != null) ring.play(); }, 9000); // after the spoken warning
            }
            Vibrator v = (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createWaveform(new long[]{0, 900, 500}, 0));
        } catch (Exception ignored) { }
        note();
        tick();
    }
    private void tick() {
        if (!"alarm".equals(phase)) return;
        long left = until - System.currentTimeMillis();
        if (left <= 0) { send(); return; }
        if (left < 31000 && left > 29000) Speech.get(ctx).speak("Sending your position in 30 seconds.");
        note();
        main.postDelayed(this::tick, 1000);
    }
    private void quiet() {
        try { if (ring != null) ring.stop(); } catch (Exception ignored) { }
        try { Vibrator v = (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE); if (v != null) v.cancel(); } catch (Exception ignored) { }
        ((NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(NOTE);
    }
    private void send() {
        quiet();
        JSONObject s = settings(ctx);
        String phone = s.optString("phone", ""), msg = message(s);
        if (test) {
            phase = users > 0 ? "watching" : "off"; test = false;
            result = phone.isEmpty() ? "Test finished. No contact is set, so nothing would have been sent." : "Test finished. In a real alert " + s.optString("name", "your contact") + " (" + phone + ") would have been texted: " + msg;
            Speech.get(ctx).speak("Test finished. Nothing was sent.");
            return;
        }
        boolean sent = false;
        if (!phone.isEmpty() && ctx.checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED) {
            try {
                SmsManager sms = Build.VERSION.SDK_INT >= 31 ? ctx.getSystemService(SmsManager.class) : SmsManager.getDefault();
                ArrayList<String> parts = sms.divideMessage(msg);
                sms.sendMultipartTextMessage(phone, null, parts, null, null);
                sent = true;
            } catch (Exception ignored) { }
        }
        boolean group = GroupService.crashAlert(pos);
        phase = "sent";
        result = (sent ? s.optString("name", "Your contact") + " has been texted your position." : phone.isEmpty() ? "No contact is set up, so no text was sent." : "The text could not be sent (no permission or no signal).")
                + (group ? " Your group has been told." : "");
        Speech.get(ctx).speak(result);
        Notification.Builder b = builder().setContentTitle("Crash alert sent").setContentText(result).setStyle(new Notification.BigTextStyle().bigText(result + "\n\n" + msg)).setAutoCancel(true);
        ((NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE)).notify(NOTE, b.build());
    }
    @SuppressLint("MissingPermission")
    private String message(JSONObject s) {
        Location l = pos;
        try {
            if (ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                Location g = ((LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE)).getLastKnownLocation(LocationManager.GPS_PROVIDER);
                if (g != null && (l == null || g.getTime() > l.getTime())) l = g;
            }
        } catch (Exception ignored) { }
        String rider = s.optString("rider", ""); if (rider.isEmpty()) rider = "The rider";
        String m = "OpenRoad crash alert: " + rider + " may have come off the motorbike. The phone felt a hard impact and the bike stopped, and nobody cancelled the alarm.";
        if (l != null) {
            m += String.format(Locale.UK, " Position at %tH:%<tM: https://maps.google.com/?q=%.5f,%.5f", new java.util.Date(l.getTime()), l.getLatitude(), l.getLongitude());
            String g = OsGrid.ref(l.getLatitude(), l.getLongitude()); if (g != null) m += " (OS grid ref " + g + ")";
        }
        String extra = s.optString("medical", "");
        if (!extra.isEmpty()) m += " Medical: " + extra;
        return m + " If you can't reach them, call 999 (112 in Europe).";
    }

    private Notification.Builder builder() {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CH) == null) {
            NotificationChannel ch = new NotificationChannel(CH, "Crash detection", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("The alarm after a suspected crash");
            ch.setSound(null, null); // the alarm sound is played separately so it can be stopped
            nm.createNotificationChannel(ch);
        }
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, CH) : new Notification.Builder(ctx);
        return b.setSmallIcon(android.R.drawable.ic_dialog_alert).setCategory(Notification.CATEGORY_ALARM);
    }
    private void note() {
        Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent op = PendingIntent.getActivity(ctx, 40, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent ok = PendingIntent.getBroadcast(ctx, 41, new Intent(ctx, OkReceiver.class).setAction(OK), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        long left = Math.max(0, (until - System.currentTimeMillis()) / 1000);
        Notification.Builder b = builder().setContentTitle((test ? "TEST: " : "") + "Crash detected. Are you OK?")
                .setContentText("Sending your position in " + left + " s. Tap I'm OK to cancel.")
                .setContentIntent(op).setFullScreenIntent(op, true).setOngoing(true).setOnlyAlertOnce(true)
                .addAction(new Notification.Action.Builder(null, "I'm OK", ok).build());
        ((NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE)).notify(NOTE, b.build());
    }

    /** The "I'm OK" button on the notification. */
    public static class OkReceiver extends BroadcastReceiver {
        @Override public void onReceive(Context c, Intent i) { cancel(c); Speech.get(c).speak("Alarm cancelled."); }
    }
}
