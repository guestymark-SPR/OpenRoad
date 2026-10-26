package uk.openroad.app;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import javax.net.ssl.SSLSocketFactory;

/**
 * Group ride link: shares small encrypted position messages with the other riders in a group.
 * It talks MQTT 3.1.1 to free public MQTT servers, to two at once so the group keeps working if one is down.
 * Everything is encrypted with AES-256-GCM using a key made from the group code, so the servers
 * (and anyone else listening) only ever see random bytes on a topic name that is a hash of the code.
 * Plain Java (no Android classes), so it can be tested on any computer.
 */
public class GroupLink {
    public interface Listener {
        void onMessage(String kind, String json);   // kind: "p" position, "m" message, "r" shared route, "x" regroup point; "left", "r-clear", "x-clear" when removed
        void onStatus(String server, String status); // "connecting", "online", "offline: why"
    }

    public static final String[] SERVERS = {"ssl://broker.hivemq.com:8883", "ssl://broker.emqx.io:8883"};
    private static final String ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
    private static final SecureRandom RNG = new SecureRandom();

    private final String base, riderId;
    private final byte[] key;
    private final Listener listener;
    private final List<Conn> conns = new ArrayList<>();
    private volatile boolean running = true;

    /** A new group code like 7KQ4-9MZT-H2XB (about 59 bits of randomness). */
    public static String newCode() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 12; i++) { if (i > 0 && i % 4 == 0) sb.append('-'); sb.append(ALPHABET.charAt(RNG.nextInt(ALPHABET.length()))); }
        return sb.toString();
    }
    /** The code as typed, without dashes or spaces, capitals; O and I read as 0 and 1 are not in the alphabet. */
    public static String clean(String code) { return code == null ? "" : code.toUpperCase().replaceAll("[^0-9A-Z]", ""); }
    public static String newRiderId() { byte[] b = new byte[6]; RNG.nextBytes(b); return hex(b); }

    public GroupLink(String code, String riderId, String[] servers, Listener listener) throws Exception {
        String c = clean(code);
        if (c.length() < 8) throw new IllegalArgumentException("Group code too short");
        this.riderId = riderId; this.listener = listener;
        this.key = pbkdf2(c.getBytes(StandardCharsets.UTF_8), "OpenRoad group ride v1".getBytes(StandardCharsets.UTF_8), 20000);
        this.base = "openroad/v1/" + hex(MessageDigest.getInstance("SHA-256").digest(("topic:" + c).getBytes(StandardCharsets.UTF_8))).substring(0, 24);
        for (String s : servers) { Conn k = new Conn(s); conns.add(k); k.start(); }
    }

    /** Publish my position (kept by the server, so a rider joining later sees it straight away). */
    public void sendPosition(String json) { publish(base + "/p/" + riderId, json, true); }
    /** Publish a quick message to the group (not kept). */
    public void sendMessage(String json) { publish(base + "/m/" + riderId, json, false); }
    /** Something kept for the group until replaced or cleared: "r" a shared route, "x" a regroup point. */
    public void sendKept(String what, String json) { publish(base + "/" + what + "/" + riderId, json, true); }
    public void clearKept(String what) { for (Conn k : conns) k.publish(base + "/" + what + "/" + riderId, new byte[0], true); }
    /** Leave: remove my kept position (and any route or regroup point I shared) from the servers, then disconnect. */
    public void close() {
        running = false;
        for (Conn k : conns) k.closeGracefully(new String[]{base + "/p/" + riderId, base + "/r/" + riderId, base + "/x/" + riderId});
    }
    public String topicBase() { return base; }

    private void publish(String topic, String json, boolean retain) {
        byte[] body;
        try { body = encrypt(json.getBytes(StandardCharsets.UTF_8)); } catch (Exception e) { return; }
        for (Conn k : conns) k.publish(topic, body, retain);
    }

    // ---------- encryption ----------
    byte[] encrypt(byte[] plain) throws Exception {
        byte[] iv = new byte[12]; RNG.nextBytes(iv);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
        byte[] ct = c.doFinal(plain), out = new byte[12 + ct.length];
        System.arraycopy(iv, 0, out, 0, 12); System.arraycopy(ct, 0, out, 12, ct.length);
        return out;
    }
    String decrypt(byte[] in) {
        if (in.length < 29) return null;
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, in, 0, 12));
            return new String(c.doFinal(in, 12, in.length - 12), StandardCharsets.UTF_8);
        } catch (Exception e) { return null; } // not from this group (or tampered with): ignore
    }
    // PBKDF2-HMAC-SHA256, one 32-byte block (written out because Android before 8.0 lacks it as a SecretKeyFactory)
    static byte[] pbkdf2(byte[] pass, byte[] salt, int iters) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256"); mac.init(new SecretKeySpec(pass, "HmacSHA256"));
        mac.update(salt); mac.update(new byte[]{0, 0, 0, 1});
        byte[] u = mac.doFinal(), t = u.clone();
        for (int i = 1; i < iters; i++) { u = mac.doFinal(u); for (int j = 0; j < t.length; j++) t[j] ^= u[j]; }
        return t;
    }
    static String hex(byte[] b) { StringBuilder sb = new StringBuilder(); for (byte x : b) sb.append(String.format("%02x", x)); return sb.toString(); }

    // ---------- one MQTT connection, reconnecting until closed ----------
    private final class Conn extends Thread {
        final String url, name; final boolean tls; final String host; final int port;
        volatile Socket sock; volatile OutputStream out;
        final Object wlock = new Object();

        Conn(String url) {
            super("group-" + url); setDaemon(true);
            this.url = url; tls = url.startsWith("ssl://");
            String hp = url.substring(url.indexOf("://") + 3);
            host = hp.substring(0, hp.lastIndexOf(':')); port = Integer.parseInt(hp.substring(hp.lastIndexOf(':') + 1));
            name = host;
        }

        @Override public void run() {
            int wait = 2000;
            while (running) {
                listener.onStatus(name, "connecting");
                try {
                    Socket s = tls ? SSLSocketFactory.getDefault().createSocket() : new Socket();
                    s.connect(new InetSocketAddress(host, port), 15000);
                    s.setSoTimeout(90000); s.setTcpNoDelay(true);
                    sock = s;
                    InputStream in = s.getInputStream();
                    synchronized (wlock) { out = s.getOutputStream(); }
                    send(connectPacket("or-" + riderId + "-" + Integer.toHexString(RNG.nextInt())));
                    DataInputStream din = new DataInputStream(in);
                    int[] h = readHeader(din); byte[] ack = readBody(din, h[1]);
                    if ((h[0] >> 4) != 2 || ack.length < 2 || ack[1] != 0) throw new IOException("refused (" + (ack.length > 1 ? ack[1] : -1) + ")");
                    send(subscribePacket(base + "/#"));
                    listener.onStatus(name, "online");
                    wait = 2000;
                    Thread pinger = new Thread(() -> { try { while (running && sock == s) { Thread.sleep(30000); send(new byte[]{(byte) 0xC0, 0}); } } catch (Exception ignored) { } });
                    pinger.setDaemon(true); pinger.start();
                    while (running) {
                        h = readHeader(din); byte[] body = readBody(din, h[1]);
                        if ((h[0] >> 4) == 3) onPublish(h[0], body);
                    }
                } catch (Exception e) {
                    if (running) listener.onStatus(name, "offline: " + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()));
                }
                closeSock();
                if (!running) break;
                try { Thread.sleep(wait); } catch (InterruptedException ignored) { }
                wait = Math.min(60000, wait * 2);
            }
        }

        void onPublish(int flags, byte[] b) {
            int tl = ((b[0] & 0xff) << 8) | (b[1] & 0xff);
            String topic = new String(b, 2, tl, StandardCharsets.UTF_8);
            int at = 2 + tl; if (((flags >> 1) & 3) > 0) at += 2; // packet id when QoS > 0
            if (!topic.startsWith(base + "/")) return;
            String[] parts = topic.substring(base.length() + 1).split("/");
            if (parts.length != 2) return;
            String seg = parts[0];
            if (b.length - at == 0) { // something kept was cleared: a rider left, or a route or regroup point was taken down
                String id = parts[1].replaceAll("[^0-9a-f]", "");
                listener.onMessage("p".equals(seg) ? "left" : seg + "-clear", "{\"id\":\"" + id + "\"}");
                return;
            }
            byte[] payload = new byte[b.length - at]; System.arraycopy(b, at, payload, 0, payload.length);
            String json = decrypt(payload); if (json == null) return;
            listener.onMessage(seg, json);
        }

        void publish(String topic, byte[] payload, boolean retain) {
            try { send(publishPacket(topic, payload, retain)); } catch (Exception ignored) { } // sent again with the next position
        }
        void send(byte[] p) throws IOException {
            synchronized (wlock) { if (out == null) throw new IOException("not connected"); out.write(p); out.flush(); }
        }
        void closeGracefully(String[] myTopics) {
            new Thread(() -> {
                try { for (String t : myTopics) send(publishPacket(t, new byte[0], true)); send(new byte[]{(byte) 0xE0, 0}); } catch (Exception ignored) { }
                closeSock(); interrupt();
            }).start();
        }
        void closeSock() {
            synchronized (wlock) { out = null; }
            try { if (sock != null) sock.close(); } catch (Exception ignored) { }
            sock = null;
        }
    }

    // ---------- MQTT 3.1.1 packets ----------
    private static void str(ByteArrayOutputStream b, String s) { byte[] x = s.getBytes(StandardCharsets.UTF_8); b.write(x.length >> 8); b.write(x.length & 0xff); b.write(x, 0, x.length); }
    private static byte[] packet(int type, ByteArrayOutputStream body) {
        ByteArrayOutputStream p = new ByteArrayOutputStream(); p.write(type);
        int n = body.size();
        do { int d = n % 128; n /= 128; if (n > 0) d |= 0x80; p.write(d); } while (n > 0);
        byte[] b = body.toByteArray(); p.write(b, 0, b.length); return p.toByteArray();
    }
    static byte[] connectPacket(String clientId) {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        str(b, "MQTT"); b.write(4); b.write(0x02); b.write(0); b.write(60); // level 4, clean session, keep-alive 60 s
        str(b, clientId); return packet(0x10, b);
    }
    static byte[] subscribePacket(String filter) {
        ByteArrayOutputStream b = new ByteArrayOutputStream(); b.write(0); b.write(1); str(b, filter); b.write(0); return packet(0x82, b);
    }
    static byte[] publishPacket(String topic, byte[] payload, boolean retain) {
        ByteArrayOutputStream b = new ByteArrayOutputStream(); str(b, topic); b.write(payload, 0, payload.length); return packet(0x30 | (retain ? 1 : 0), b);
    }
    private static int[] readHeader(DataInputStream in) throws IOException {
        int t = in.readUnsignedByte(), mul = 1, len = 0, d;
        do { d = in.readUnsignedByte(); len += (d & 0x7f) * mul; mul *= 128; if (mul > 128 * 128 * 128 * 128) throw new IOException("bad packet"); } while ((d & 0x80) != 0);
        return new int[]{t, len};
    }
    private static byte[] readBody(DataInputStream in, int n) throws IOException { byte[] b = new byte[n]; in.readFully(b); return b; }
}
