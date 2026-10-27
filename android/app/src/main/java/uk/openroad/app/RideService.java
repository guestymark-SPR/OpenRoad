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
public class RideService extends Service implements LocationListener, android.hardware.SensorEventListener {
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
    // rough road: big jolts while riding, compared with the usual vibration of the bike on that ride
    private static final List<double[]> jolts = new ArrayList<>(); // [lon, lat, g, speed, time]
    private float speedNow = 0; private double rms = 0.5; private long lastJolt = 0;
    static String joltsSince(long t) {
        StringBuilder sb = new StringBuilder("[");
        synchronized (jolts) { boolean f = true; for (double[] j : jolts) { if (j[4] <= t) continue; if (!f) sb.append(','); f = false; sb.append(String.format(Locale.US, "[%.6f,%.6f,%.2f,%.1f,%d]", j[0], j[1], j[2], j[3], (long) j[4])); } }
        return sb.append(']').toString();
    }
    // steadiness: how much the bike is being corrected side to side, per minute of riding over about 20 mph.
    // Gyro turn rate with the slow part (bends) taken out, so what's left is small, quick corrections.
    private static final List<double[]> steady = new ArrayList<>(); // [minute start time, rms correction rate]
    private double gSlow = 0, gSum = 0; private int gN = 0; private long gMin = 0;
    static String steadinessSince(long t) {
        StringBuilder sb = new StringBuilder("[");
        synchronized (steady) { boolean f = true; for (double[] s : steady) { if (s[0] <= t) continue; if (!f) sb.append(','); f = false; sb.append(String.format(Locale.US, "[%d,%.4f]", (long) s[0], s[1])); } }
        return sb.append(']').toString();
    }
    private void gyro(android.hardware.SensorEvent e) {
        double w = Math.sqrt(e.values[0] * e.values[0] + e.values[1] * e.values[1] + e.values[2] * e.values[2]);
        gSlow = gSlow * 0.98 + w * 0.02; // about the last second at 50 readings a second
        long now = System.currentTimeMillis(), m = now / 60000;
        if (m != gMin) {
            if (gN > 1500) synchronized (steady) { steady.add(new double[]{gMin * 60000.0, Math.sqrt(gSum / gN)}); if (steady.size() > 1500) steady.remove(0); }
            gMin = m; gSum = 0; gN = 0;
        }
        if (speedNow > 9) { double d = w - gSlow; gSum += d * d; gN++; }
    }
    @Override public void onSensorChanged(android.hardware.SensorEvent e) {
        if (e.sensor.getType() == android.hardware.Sensor.TYPE_GYROSCOPE) { gyro(e); return; }
        double g = Math.sqrt(e.values[0] * e.values[0] + e.values[1] * e.values[1] + e.values[2] * e.values[2]) / 9.81, dev = Math.abs(g - 1);
        rms = rms * 0.995 + dev * 0.005; // the bike's normal shake, over the last few seconds
        long now = System.currentTimeMillis();
        if (speedNow > 4 && dev > Math.max(1.2, rms * 5) && now - lastJolt > 2000 && last != null) {
            lastJolt = now;
            synchronized (jolts) { jolts.add(new double[]{last.getLongitude(), last.getLatitude(), dev, speedNow, now}); if (jolts.size() > 3000) jolts.remove(0); }
        }
    }
    @Override public void onAccuracyChanged(android.hardware.Sensor s, int a) { }

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
            CrashWatch.start(this, "ride");
            synchronized (jolts) { jolts.clear(); }
            try { android.hardware.SensorManager sm = (android.hardware.SensorManager) getSystemService(SENSOR_SERVICE); sm.registerListener(this, sm.getDefaultSensor(android.hardware.Sensor.TYPE_ACCELEROMETER), android.hardware.SensorManager.SENSOR_DELAY_GAME); } catch (Exception ignored) { }
            synchronized (steady) { steady.clear(); }
            try { android.hardware.SensorManager sm = (android.hardware.SensorManager) getSystemService(SENSOR_SERVICE); android.hardware.Sensor gy = sm.getDefaultSensor(android.hardware.Sensor.TYPE_GYROSCOPE); if (gy != null) sm.registerListener(this, gy, 20000); } catch (Exception ignored) { }
        }
        return START_STICKY;
    }

    @Override public void onLocationChanged(Location l) {
        CrashWatch.fix(l);
        try { PublicHazards.fix(this, l); } catch (Exception ignored) { }
        speedNow = l.hasSpeed() ? l.getSpeed() : 0;
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
        try { ((android.hardware.SensorManager) getSystemService(SENSOR_SERVICE)).unregisterListener(this); } catch (Exception ignored) { }
        CrashWatch.stop("ride");
        try { ((LocationManager) getSystemService(LOCATION_SERVICE)).removeUpdates(this); } catch (Exception ignored) { }
        if (lock != null && lock.isHeld()) lock.release();
        lock = null;
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        stopSelf();
    }

    @Override public void onDestroy() {
        running = false;
        try { ((android.hardware.SensorManager) getSystemService(SENSOR_SERVICE)).unregisterListener(this); } catch (Exception ignored) { }
        CrashWatch.stop("ride");
        try { ((LocationManager) getSystemService(LOCATION_SERVICE)).removeUpdates(this); } catch (Exception ignored) { }
        if (lock != null && lock.isHeld()) lock.release();
        super.onDestroy();
    }
}
