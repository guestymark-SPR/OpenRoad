package uk.openroad.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Keeps GPS recording the ride while the screen is off or another app is in front. */
public class RideService extends Service implements LocationListener {
    static final String ACTION_START = "uk.openroad.app.RIDE_START", ACTION_STOP = "uk.openroad.app.RIDE_STOP";
    private static final String CHANNEL = "ride";
    private static final int NOTE_ID = 11;
    static volatile boolean running = false;
    // [lon, lat, speed, accuracy, time]
    private static final List<double[]> points = new ArrayList<>();
    private PowerManager.WakeLock lock;
    private String name = "Ride";
    private double dist = 0; private Location last;
    private long lastNote = 0;

    static String pointsSince(long t) {
        StringBuilder sb = new StringBuilder("[");
        synchronized (points) {
            boolean first = true;
            for (double[] p : points) {
                if (p[4] <= t) continue;
                if (!first) sb.append(','); first = false;
                sb.append(String.format(Locale.US, "[%.7f,%.7f,%.2f,%.1f,%d]", p[0], p[1], p[2], p[3], (long) p[4]));
            }
        }
        return sb.append(']').toString();
    }

    @Override public IBinder onBind(Intent i) { return null; }

    @SuppressLint({"MissingPermission", "WakelockTimeout"})
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(a)) { stop(); return START_NOT_STICKY; }
        if (intent != null && intent.getStringExtra("name") != null) name = intent.getStringExtra("name");
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Ride recording", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shows that OpenRoad is recording your ride");
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
        Notification n = note("Recording: " + name, "Tap to open OpenRoad");
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION); else startForeground(NOTE_ID, n);
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) { stop(); return START_NOT_STICKY; }
        if (!running) {
            synchronized (points) { points.clear(); }
            dist = 0; last = null;
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "OpenRoad:ride");
            lock.acquire();
            try { ((LocationManager) getSystemService(LOCATION_SERVICE)).requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, this, Looper.getMainLooper()); } catch (Exception ignored) { }
            running = true;
        }
        return START_STICKY;
    }

    @Override public void onLocationChanged(Location l) {
        synchronized (points) {
            points.add(new double[]{l.getLongitude(), l.getLatitude(), l.hasSpeed() ? l.getSpeed() : 0, l.getAccuracy(), System.currentTimeMillis()});
            if (points.size() > 40000) points.subList(0, 10000).clear();
        }
        if (l.getAccuracy() < 60) { if (last != null) { float d = last.distanceTo(l); if (d > 8) { dist += d; last = l; } } else last = l; }
        CheckIn.savePos(this, l.getLatitude(), l.getLongitude(), System.currentTimeMillis());
        if (System.currentTimeMillis() - lastNote > 30000) {
            lastNote = System.currentTimeMillis();
            try { getSystemService(NotificationManager.class).notify(NOTE_ID, note("Recording: " + name, String.format(Locale.UK, "%.1f miles so far", dist / 1609.344))); } catch (Exception ignored) { }
        }
    }
    @Override public void onProviderEnabled(String p) { }
    @Override public void onProviderDisabled(String p) { }
    @SuppressWarnings("deprecation") @Override public void onStatusChanged(String p, int s, Bundle b) { }

    private Notification note(String title, String text) {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        return b.setSmallIcon(android.R.drawable.ic_menu_mylocation).setContentTitle(title).setContentText(text).setContentIntent(pi).setOngoing(true).setOnlyAlertOnce(true).build();
    }

    private void stop() {
        running = false;
        try { ((LocationManager) getSystemService(LOCATION_SERVICE)).removeUpdates(this); } catch (Exception ignored) { }
        if (lock != null && lock.isHeld()) lock.release();
        lock = null;
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        stopSelf();
    }

    @Override public void onDestroy() {
        running = false;
        try { ((LocationManager) getSystemService(LOCATION_SERVICE)).removeUpdates(this); } catch (Exception ignored) { }
        if (lock != null && lock.isHeld()) lock.release();
        super.onDestroy();
    }
}
