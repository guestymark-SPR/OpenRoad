package uk.openroad.app;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.AdvertisingSet;
import android.bluetooth.le.AdvertisingSetCallback;
import android.bluetooth.le.AdvertisingSetParameters;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;

/**
 * Bike to bike, with no mobile signal: each phone in the group broadcasts a tiny Bluetooth LE advert with its position
 * (and a quick message such as "stopping for fuel" or a crash alert), encrypted with the group code, and listens for
 * everyone else's. No pairing or connection. Each phone also repeats the riders it hears, so a position can hop
 * along a line of bikes. Range is short: roughly 50 to 150 m between phones, less through bodies and bikes.
 *
 * Advert: manufacturer data, company id 0xFFFF (the id set aside for testing), 2-byte group tag + one 16-byte AES block:
 *  0-2 rider (first 3 bytes of the rider id) | 3-6 lat x1e5 | 7-10 lon x1e5 | 11 speed (0.5 m/s) | 12 heading/2 |
 *  13 hop (high 4 bits) and age in 5 s steps (low 4) | 14 type: 0 position, 1-8 a quick message, 0xAA name (3-13) | 15 check
 */
final class BikeLink {
    interface Out { void position(String shortId, double la, double lo, float speed, int heading, long ageMs, boolean relayed); void message(String shortId, String kind); void name(String shortId, String name); }

    static final int COMPANY = 0xFFFF;
    static final String[] KINDS = {"", "fuel", "stop", "wait", "lost", "ok", "help", "go", "crash"};
    private final Context ctx; private final Out out;
    private final byte[] tag = new byte[2]; private final SecretKeySpec key;
    private final byte[] me = new byte[3]; private final String myName;
    private final Handler main = new Handler(Looper.getMainLooper());
    private BluetoothLeAdvertiser adv; private BluetoothLeScanner scan;
    private AdvertisingSet set; private AdvertiseCallback legacyCb; private AdvertisingSetCallback setStartCb;
    private volatile Location pos; private volatile int msgCode = 0; private long msgUntil = 0;
    private final Map<String, byte[]> heard = new LinkedHashMap<>(); // other riders' last own adverts (to repeat), by rider
    private final Map<String, Long> heardAt = new LinkedHashMap<>();
    private final Map<String, Long> lastMsg = new LinkedHashMap<>();
    private int turn = 0; private boolean running = false, fast = false;
    static volatile String status = "off";

    BikeLink(Context c, String code, String riderId, String name, Out out) throws Exception {
        ctx = c.getApplicationContext(); this.out = out; myName = name == null ? "" : name;
        String cl = GroupLink.clean(code);
        byte[] h = MessageDigest.getInstance("SHA-256").digest(("ble:" + cl).getBytes(StandardCharsets.UTF_8)); tag[0] = h[0]; tag[1] = h[1];
        byte[] k = GroupLink.pbkdf2(cl.getBytes(StandardCharsets.UTF_8), "OpenRoad bike-to-bike v1".getBytes(StandardCharsets.UTF_8), 20000);
        byte[] k16 = new byte[16]; System.arraycopy(k, 0, k16, 0, 16); key = new SecretKeySpec(k16, "AES");
        for (int i = 0; i < 3; i++) me[i] = (byte) Integer.parseInt(riderId.substring(i * 2, i * 2 + 2), 16);
    }
    static String shortOf(String riderId) { return riderId == null || riderId.length() < 6 ? "" : riderId.substring(0, 6).toLowerCase(); }

    static boolean allowed(Context c) {
        if (Build.VERSION.SDK_INT >= 31) return c.checkSelfPermission("android.permission.BLUETOOTH_SCAN") == PackageManager.PERMISSION_GRANTED && c.checkSelfPermission("android.permission.BLUETOOTH_ADVERTISE") == PackageManager.PERMISSION_GRANTED;
        return c.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @SuppressLint("MissingPermission")
    void start() {
        if (running) return;
        if (!allowed(ctx)) { status = "needs Bluetooth permission"; return; }
        BluetoothManager bm = (BluetoothManager) ctx.getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter ba = bm == null ? null : bm.getAdapter();
        if (ba == null) { status = "no Bluetooth on this phone"; return; }
        if (!ba.isEnabled()) { status = "Bluetooth is off"; return; }
        adv = ba.getBluetoothLeAdvertiser(); scan = ba.getBluetoothLeScanner();
        if (adv == null || scan == null) { status = "this phone can't broadcast over Bluetooth LE"; return; }
        running = true; status = "on";
        startScan(false);
        if (Build.VERSION.SDK_INT >= 26) {
            AdvertisingSetParameters p = new AdvertisingSetParameters.Builder().setLegacyMode(true).setConnectable(false).setScannable(false)
                    .setInterval(AdvertisingSetParameters.INTERVAL_LOW).setTxPowerLevel(AdvertisingSetParameters.TX_POWER_HIGH).build();
            try {
                setStartCb = new AdvertisingSetCallback() {
                    @Override public void onAdvertisingSetStarted(AdvertisingSet s, int tx, int st) { if (st == ADVERTISE_SUCCESS) set = s; else status = "couldn't broadcast (" + st + ")"; }
                };
                adv.startAdvertisingSet(p, data(packet(true)), null, null, null, setStartCb);
            } catch (Exception e) { status = "couldn't broadcast"; }
        } else {
            legacyCb = new AdvertiseCallback() { };
            try { adv.startAdvertising(new AdvertiseSettings.Builder().setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY).setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH).setConnectable(false).build(), data(packet(true)), legacyCb); } catch (Exception e) { status = "couldn't broadcast"; }
        }
        main.postDelayed(rotate, 700);
    }
    @SuppressLint("MissingPermission")
    void stop() {
        running = false; main.removeCallbacks(rotate); status = "off";
        try { if (scan != null) scan.stopScan(scanCb); } catch (Exception ignored) { }
        try { if (Build.VERSION.SDK_INT >= 26 && adv != null && setStartCb != null) adv.stopAdvertisingSet(setStartCb); } catch (Exception ignored) { }
        try { if (legacyCb != null && adv != null) adv.stopAdvertising(legacyCb); } catch (Exception ignored) { }
        set = null;
    }

    void position(Location l) { pos = l; }
    void message(String kind) { for (int i = 1; i < KINDS.length; i++) if (KINDS[i].equals(kind)) { msgCode = i; msgUntil = System.currentTimeMillis() + 60000; } }
    /** scan harder when the group has no signal (the servers are unreachable): more battery, quicker updates */
    @SuppressLint("MissingPermission")
    void urgent(boolean f) { if (f == fast || !running) return; fast = f; try { scan.stopScan(scanCb); } catch (Exception ignored) { } startScan(f); }

    @SuppressLint("MissingPermission")
    private void startScan(boolean lowLatency) {
        ScanFilter f = new ScanFilter.Builder().setManufacturerData(COMPANY, new byte[]{tag[0], tag[1]}, new byte[]{(byte) 0xff, (byte) 0xff}).build();
        ScanSettings s = new ScanSettings.Builder().setScanMode(lowLatency ? ScanSettings.SCAN_MODE_LOW_LATENCY : ScanSettings.SCAN_MODE_BALANCED).build();
        try { scan.startScan(Collections.singletonList(f), s, scanCb); } catch (Exception e) { status = "couldn't listen"; }
    }

    // take turns: my position (most often), my name now and then, and riders I've heard (so they hop further)
    private final Runnable rotate = new Runnable() {
        @SuppressLint("MissingPermission") @Override public void run() {
            if (!running) return;
            turn++;
            byte[] p = null;
            if (turn % 10 == 5) p = namePacket();
            else if (turn % 3 == 2) {
                List<String> ids = new ArrayList<>(heard.keySet()); long now = System.currentTimeMillis();
                ids.removeIf(id -> now - heardAt.get(id) > 60000);
                if (!ids.isEmpty()) { String id = ids.get((turn / 3) % ids.size()); p = relayPacket(heard.get(id), now - heardAt.get(id)); }
            }
            if (p == null) p = packet(true);
            if (p != null) {
                try {
                    if (Build.VERSION.SDK_INT >= 26 && set != null) set.setAdvertisingData(data(p));
                    else if (legacyCb != null) { adv.stopAdvertising(legacyCb); adv.startAdvertising(new AdvertiseSettings.Builder().setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY).setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH).setConnectable(false).build(), data(p), legacyCb); }
                } catch (Exception ignored) { }
            }
            main.postDelayed(this, 700);
        }
    };

    private AdvertiseData data(byte[] enc) {
        byte[] d = new byte[18]; d[0] = tag[0]; d[1] = tag[1];
        if (enc != null) System.arraycopy(enc, 0, d, 2, 16);
        return new AdvertiseData.Builder().setIncludeDeviceName(false).setIncludeTxPowerLevel(false).addManufacturerData(COMPANY, d).build();
    }
    private static void put32(byte[] b, int at, int v) { b[at] = (byte) (v >> 24); b[at + 1] = (byte) (v >> 16); b[at + 2] = (byte) (v >> 8); b[at + 3] = (byte) v; }
    private static int get32(byte[] b, int at) { return ((b[at] & 0xff) << 24) | ((b[at + 1] & 0xff) << 16) | ((b[at + 2] & 0xff) << 8) | (b[at + 3] & 0xff); }
    private static byte check(byte[] p) { int s = 0; for (int i = 0; i < 15; i++) s += p[i] & 0xff; return (byte) ((s & 0xff) ^ 0x5A); }
    private byte[] packet(boolean own) {
        Location l = pos;
        byte[] p = new byte[16]; System.arraycopy(me, 0, p, 0, 3);
        if (l == null) return null;
        put32(p, 3, (int) Math.round(l.getLatitude() * 1e5)); put32(p, 7, (int) Math.round(l.getLongitude() * 1e5));
        p[11] = (byte) Math.min(255, Math.round((l.hasSpeed() ? l.getSpeed() : 0) * 2)); p[12] = (byte) (l.hasBearing() ? Math.round(l.getBearing() / 2) % 180 : 255);
        long age = Math.max(0, System.currentTimeMillis() - l.getTime()); p[13] = (byte) Math.min(15, age / 5000);
        p[14] = (byte) (System.currentTimeMillis() < msgUntil ? msgCode : 0);
        p[15] = check(p);
        return enc(p);
    }
    private byte[] namePacket() {
        byte[] p = new byte[16]; System.arraycopy(me, 0, p, 0, 3);
        byte[] n = myName.getBytes(StandardCharsets.UTF_8); System.arraycopy(n, 0, p, 3, Math.min(11, n.length));
        p[14] = (byte) 0xAA; p[15] = check(p); return enc(p);
    }
    private byte[] relayPacket(byte[] plain, long sinceHeard) {
        if (plain == null) return null;
        byte[] p = plain.clone();
        long age = (p[13] & 0x0f) * 5000L + sinceHeard; p[13] = (byte) (0x10 | Math.min(15, age / 5000)); p[14] = 0; // repeated: position only
        p[15] = check(p); return enc(p);
    }
    private byte[] enc(byte[] p) { try { Cipher c = Cipher.getInstance("AES/ECB/NoPadding"); c.init(Cipher.ENCRYPT_MODE, key); return c.doFinal(p); } catch (Exception e) { return null; } }
    private byte[] dec(byte[] e) { try { Cipher c = Cipher.getInstance("AES/ECB/NoPadding"); c.init(Cipher.DECRYPT_MODE, key); return c.doFinal(e); } catch (Exception x) { return null; } }

    private final ScanCallback scanCb = new ScanCallback() {
        @Override public void onScanResult(int type, ScanResult r) { got(r); }
        @Override public void onBatchScanResults(List<ScanResult> l) { for (ScanResult r : l) got(r); }
        @Override public void onScanFailed(int code) { status = "couldn't listen (" + code + ")"; }
    };
    private void got(ScanResult r) {
        ScanRecord rec = r.getScanRecord(); if (rec == null) return;
        byte[] d = rec.getManufacturerSpecificData(COMPANY); if (d == null || d.length < 18 || d[0] != tag[0] || d[1] != tag[1]) return;
        byte[] e = new byte[16]; System.arraycopy(d, 2, e, 0, 16);
        byte[] p = dec(e); if (p == null || p[15] != check(p)) return; // not our group
        if (p[0] == me[0] && p[1] == me[1] && p[2] == me[2]) return;
        String id = String.format("%02x%02x%02x", p[0], p[1], p[2]);
        main.post(() -> handle(id, p));
    }
    private void handle(String id, byte[] p) {
        if ((p[14] & 0xff) == 0xAA) { int n = 3; while (n < 14 && p[n] != 0) n++; out.name(id, new String(p, 3, n - 3, StandardCharsets.UTF_8)); return; }
        double la = get32(p, 3) / 1e5, lo = get32(p, 7) / 1e5;
        if (Math.abs(la) > 90 || Math.abs(lo) > 180) return;
        boolean relayed = (p[13] & 0xf0) != 0; long age = (p[13] & 0x0f) * 5000L;
        int hd = p[12] & 0xff;
        out.position(id, la, lo, (p[11] & 0xff) / 2f, hd == 255 ? -1 : hd * 2, age, relayed);
        if (!relayed) { heard.put(id, p.clone()); heardAt.put(id, System.currentTimeMillis()); }
        int k = p[14] & 0xff;
        if (!relayed && k > 0 && k < KINDS.length) {
            String key = id + ":" + k; Long t = lastMsg.get(key);
            if (t == null || System.currentTimeMillis() - t > 120000) { lastMsg.put(key, System.currentTimeMillis()); out.message(id, KINDS[k]); }
        }
    }
}
