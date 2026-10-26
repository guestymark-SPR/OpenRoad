package uk.openroad.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.telephony.SmsManager;

import java.util.ArrayList;
import java.util.Locale;

/**
 * Safety check-in. At the set time the phone alarms and asks "Are you OK?". If nobody taps "I'm OK"
 * within the grace time, the contact is sent a text with the last known position.
 * Runs from the system alarm clock, so it works with OpenRoad closed and the screen off.
 */
public class CheckIn extends BroadcastReceiver {
    static final String DUE = "uk.openroad.app.CHECKIN_DUE", SEND = "uk.openroad.app.CHECKIN_SEND", OK = "uk.openroad.app.CHECKIN_OK";
    private static final String CH = "checkin2";
    private static final int NOTE = 21;

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("checkin", Context.MODE_PRIVATE); }

    static void arm(Context c, long at, String phone, String name, int graceMin, String rider) {
        prefs(c).edit().putLong("at", at).putString("phone", phone).putString("name", name).putInt("grace", Math.max(1, graceMin))
                .putString("rider", rider == null || rider.isEmpty() ? "the rider" : rider).apply();
        schedule(c, DUE, at, 1);
        schedule(c, SEND, at + Math.max(1, graceMin) * 60000L, 2);
        ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(NOTE);
    }

    static void cancel(Context c) {
        prefs(c).edit().putLong("at", 0).apply();
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        am.cancel(pi(c, DUE, 1)); am.cancel(pi(c, SEND, 2));
        ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(NOTE);
    }

    static long armedAt(Context c) { return prefs(c).getLong("at", 0); }

    static void savePos(Context c, double lat, double lon, long t) {
        if (prefs(c).getLong("at", 0) == 0) return;
        prefs(c).edit().putString("lat", String.valueOf(lat)).putString("lon", String.valueOf(lon)).putLong("t", t).apply();
    }

    private static PendingIntent pi(Context c, String action, int code) {
        return PendingIntent.getBroadcast(c, 600 + code, new Intent(c, CheckIn.class).setAction(action), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void schedule(Context c, String action, long at, int code) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent p = pi(c, action, code);
        try {
            if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) {
                Intent open = new Intent(c, MainActivity.class);
                PendingIntent show = PendingIntent.getActivity(c, 30, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, show), p);
                return;
            }
        } catch (SecurityException ignored) { }
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, p); // may be a few minutes late if exact alarms are not allowed
    }

    @Override public void onReceive(Context c, Intent in) {
        SharedPreferences p = prefs(c);
        long at = p.getLong("at", 0);
        String a = in.getAction();
        if (OK.equals(a)) { cancel(c); return; }
        if (at == 0) return;
        if (DUE.equals(a)) {
            note(c, "Safety check-in: are you OK?", "Tap \"I'm OK\". If not, " + nameOr(p) + " will be texted your position in " + p.getInt("grace", 10) + " minutes.", true);
        } else if (SEND.equals(a)) {
            String msg = message(c, p);
            boolean sent = false;
            if (c.checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED) {
                try {
                    SmsManager sm = Build.VERSION.SDK_INT >= 31 ? c.getSystemService(SmsManager.class) : SmsManager.getDefault();
                    ArrayList<String> parts = sm.divideMessage(msg);
                    sm.sendMultipartTextMessage(p.getString("phone", ""), null, parts, null, null);
                    sent = true;
                } catch (Exception ignored) { }
            }
            p.edit().putLong("at", 0).apply();
            if (sent) note(c, "Check-in missed: " + nameOr(p) + " has been texted", msg, false);
            else {
                // no permission to send texts: offer the message ready to send
                Intent sms = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(p.getString("phone", "")))).putExtra("sms_body", msg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                PendingIntent sp = PendingIntent.getActivity(c, 31, sms, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                Notification.Builder b = builder(c, true).setContentTitle("Check-in missed: tap to text " + nameOr(p)).setContentText(msg)
                        .setStyle(new Notification.BigTextStyle().bigText(msg)).setContentIntent(sp).setAutoCancel(true);
                ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).notify(NOTE, b.build());
            }
        }
    }

    private static String nameOr(SharedPreferences p) { String n = p.getString("name", ""); return n.isEmpty() ? "your contact" : n; }

    @SuppressLint("MissingPermission")
    private static String message(Context c, SharedPreferences p) {
        String rider = p.getString("rider", "the rider");
        double lat = 0, lon = 0; long t = 0;
        try { lat = Double.parseDouble(p.getString("lat", "0")); lon = Double.parseDouble(p.getString("lon", "0")); t = p.getLong("t", 0); } catch (Exception ignored) { }
        try {
            if (c.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                Location l = ((LocationManager) c.getSystemService(Context.LOCATION_SERVICE)).getLastKnownLocation(LocationManager.GPS_PROVIDER);
                if (l != null && l.getTime() > t) { lat = l.getLatitude(); lon = l.getLongitude(); t = l.getTime(); }
            }
        } catch (Exception ignored) { }
        String s = "OpenRoad safety check-in: " + rider + " has not checked in as planned while out on the motorbike.";
        if (t > 0) { s += String.format(Locale.UK, " Last known position at %tH:%<tM: https://maps.google.com/?q=%.5f,%.5f", new java.util.Date(t), lat, lon); String g = OsGrid.ref(lat, lon); if (g != null) s += " (OS grid ref " + g + ")"; }
        else s += " No GPS position was available.";
        return s;
    }

    private static Notification.Builder builder(Context c, boolean urgent) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CH) == null) {
            NotificationChannel ch = new NotificationChannel(CH, "Safety check-in", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Asks if you are OK and tells you if your contact was texted");
            Uri snd = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            ch.setSound(snd, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
            ch.enableVibration(true); ch.setVibrationPattern(new long[]{0, 800, 400, 800, 400, 800});
            nm.createNotificationChannel(ch);
        }
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CH) : new Notification.Builder(c);
        b.setSmallIcon(android.R.drawable.ic_dialog_alert);
        if (urgent) b.setCategory(Notification.CATEGORY_ALARM);
        return b;
    }

    private static void note(Context c, String title, String text, boolean ask) {
        Intent open = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent op = PendingIntent.getActivity(c, 32, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = builder(c, ask).setContentTitle(title).setContentText(text).setStyle(new Notification.BigTextStyle().bigText(text)).setContentIntent(op);
        if (ask) {
            b.addAction(new Notification.Action.Builder(null, "I'm OK", pi(c, OK, 3)).build()).setOngoing(true);
            b.setFullScreenIntent(op, true);
        } else b.setAutoCancel(true);
        ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).notify(NOTE, b.build());
    }
}
