package uk.openroad.app;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Joins map tiles (Mapbox Vector Tile format) from several offline packs into one, layer by layer.
 * Where two countries' packs overlap, each has only its own country's roads in the shared tile;
 * merged, the tile has both. Features that are in both packs (near the border) are kept once.
 * Plain Java, so it can be tested on any computer.
 */
public final class MvtMerge {
    private MvtMerge() { }

    private static final class Layer {
        String name; long extent = 4096, version = 2;
        final List<byte[]> keys = new ArrayList<>(), values = new ArrayList<>();
        final Map<String, Integer> keyIdx = new LinkedHashMap<>(), valIdx = new LinkedHashMap<>();
        final ByteArrayOutputStream features = new ByteArrayOutputStream();
        final Set<String> seen = new HashSet<>();
        int count = 0;
    }

    /** tiles: uncompressed vector tiles. Returns one uncompressed tile. */
    public static byte[] merge(List<byte[]> tiles) {
        if (tiles.size() == 1) return tiles.get(0);
        Map<String, Layer> out = new LinkedHashMap<>();
        for (byte[] t : tiles) {
            Reader r = new Reader(t, 0, t.length);
            while (r.more()) {
                long tag = r.varint(); int field = (int) (tag >>> 3), wire = (int) (tag & 7);
                if (field == 3 && wire == 2) { int len = (int) r.varint(); addLayer(out, t, r.pos, r.pos + len); r.pos += len; }
                else r.skip(wire);
            }
        }
        ByteArrayOutputStream tile = new ByteArrayOutputStream();
        for (Layer L : out.values()) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            writeTag(b, 15, 0); writeVarint(b, L.version);
            writeTag(b, 1, 2); writeBytes(b, L.name.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            byte[] f = L.features.toByteArray(); b.write(f, 0, f.length);
            for (byte[] k : L.keys) { writeTag(b, 3, 2); writeBytes(b, k); }
            for (byte[] v : L.values) { writeTag(b, 4, 2); writeBytes(b, v); }
            writeTag(b, 5, 0); writeVarint(b, L.extent);
            writeTag(tile, 3, 2); writeBytes(tile, b.toByteArray());
        }
        return tile.toByteArray();
    }

    private static void addLayer(Map<String, Layer> out, byte[] t, int start, int end) {
        // first pass: name, keys, values, extent
        String name = null; long extent = 4096, version = 2;
        List<byte[]> keys = new ArrayList<>(), values = new ArrayList<>();
        Reader r = new Reader(t, start, end);
        while (r.more()) {
            long tag = r.varint(); int field = (int) (tag >>> 3), wire = (int) (tag & 7);
            if (wire == 2) {
                int len = (int) r.varint(); byte[] v = java.util.Arrays.copyOfRange(t, r.pos, r.pos + len); r.pos += len;
                if (field == 1) name = new String(v, java.nio.charset.StandardCharsets.UTF_8);
                else if (field == 3) keys.add(v); else if (field == 4) values.add(v);
            } else if (wire == 0) { long v = r.varint(); if (field == 5) extent = v; else if (field == 15) version = v; }
            else r.skip(wire);
        }
        if (name == null) return;
        Layer L = out.get(name);
        if (L == null) { L = new Layer(); L.name = name; L.extent = extent; L.version = version; out.put(name, L); }
        int[] kmap = new int[keys.size()], vmap = new int[values.size()];
        for (int i = 0; i < keys.size(); i++) kmap[i] = index(L.keys, L.keyIdx, keys.get(i));
        for (int i = 0; i < values.size(); i++) vmap[i] = index(L.values, L.valIdx, values.get(i));
        double scale = extent == L.extent ? 1 : (double) L.extent / extent;
        // second pass: features, with their tags renumbered to the merged keys and values
        r = new Reader(t, start, end);
        while (r.more()) {
            long tag = r.varint(); int field = (int) (tag >>> 3), wire = (int) (tag & 7);
            if (field == 2 && wire == 2) { int len = (int) r.varint(); addFeature(L, t, r.pos, r.pos + len, kmap, vmap, scale); r.pos += len; }
            else r.skip(wire);
        }
    }

    private static int index(List<byte[]> list, Map<String, Integer> idx, byte[] v) {
        String k = new String(v, java.nio.charset.StandardCharsets.ISO_8859_1);
        Integer i = idx.get(k);
        if (i == null) { i = list.size(); list.add(v); idx.put(k, i); }
        return i;
    }

    private static void addFeature(Layer L, byte[] t, int start, int end, int[] kmap, int[] vmap, double scale) {
        Long id = null; long type = 0; List<Long> tags = new ArrayList<>(); byte[] geom = null;
        Reader r = new Reader(t, start, end);
        while (r.more()) {
            long tag = r.varint(); int field = (int) (tag >>> 3), wire = (int) (tag & 7);
            if (field == 1 && wire == 0) id = r.varint();
            else if (field == 3 && wire == 0) type = r.varint();
            else if (field == 2 && wire == 2) { int len = (int) r.varint(); Reader p = new Reader(t, r.pos, r.pos + len); while (p.more()) tags.add(p.varint()); r.pos += len; }
            else if (field == 4 && wire == 2) { int len = (int) r.varint(); geom = java.util.Arrays.copyOfRange(t, r.pos, r.pos + len); r.pos += len; }
            else r.skip(wire);
        }
        if (geom == null || tags.size() % 2 != 0) return;
        long[] nt = new long[tags.size()];
        for (int i = 0; i < tags.size(); i += 2) {
            int k = (int) (long) tags.get(i), v = (int) (long) tags.get(i + 1);
            if (k >= kmap.length || v >= vmap.length) return;
            nt[i] = kmap[k]; nt[i + 1] = vmap[v];
        }
        if (scale != 1) geom = rescale(geom, scale);
        // the same feature from two packs has the same geometry and tags: keep it once
        StringBuilder sig = new StringBuilder().append(type).append(':');
        for (long x : nt) sig.append(x).append(',');
        sig.append(':').append(java.util.Arrays.hashCode(geom)).append(':').append(geom.length);
        if (!L.seen.add(sig.toString())) return;
        ByteArrayOutputStream f = new ByteArrayOutputStream();
        if (id != null) { writeTag(f, 1, 0); writeVarint(f, id); }
        ByteArrayOutputStream tb = new ByteArrayOutputStream(); for (long x : nt) writeVarint(tb, x);
        writeTag(f, 2, 2); writeBytes(f, tb.toByteArray());
        writeTag(f, 3, 0); writeVarint(f, type);
        writeTag(f, 4, 2); writeBytes(f, geom);
        writeTag(L.features, 2, 2); writeBytes(L.features, f.toByteArray());
        L.count++;
    }

    // tiles from different packs normally share the same extent; if not, scale the geometry commands' coordinates
    private static byte[] rescale(byte[] geom, double s) {
        Reader r = new Reader(geom, 0, geom.length); ByteArrayOutputStream o = new ByteArrayOutputStream();
        while (r.more()) {
            long cmd = r.varint(); writeVarint(o, cmd);
            int id = (int) (cmd & 7), n = (int) (cmd >>> 3);
            if (id == 1 || id == 2) for (int i = 0; i < n * 2; i++) { long z = r.varint(); long v = (z >>> 1) ^ -(z & 1); v = Math.round(v * s); writeVarint(o, (v << 1) ^ (v >> 63)); }
        }
        return o.toByteArray();
    }

    /** Number of features per layer, for tests. */
    public static Map<String, Integer> count(byte[] tile) {
        Map<String, Integer> m = new LinkedHashMap<>();
        Reader r = new Reader(tile, 0, tile.length);
        while (r.more()) {
            long tag = r.varint(); int field = (int) (tag >>> 3), wire = (int) (tag & 7);
            if (field == 3 && wire == 2) {
                int len = (int) r.varint(); Reader l = new Reader(tile, r.pos, r.pos + len); String name = "?"; int n = 0;
                while (l.more()) { long t2 = l.varint(); int f2 = (int) (t2 >>> 3), w2 = (int) (t2 & 7); if (w2 == 2) { int ln = (int) l.varint(); if (f2 == 1) name = new String(tile, l.pos, ln, java.nio.charset.StandardCharsets.UTF_8); if (f2 == 2) n++; l.pos += ln; } else l.skip(w2); }
                m.put(name, n); r.pos += len;
            } else r.skip(wire);
        }
        return m;
    }

    // ---------- protobuf ----------
    private static final class Reader {
        final byte[] b; int pos; final int end;
        Reader(byte[] b, int s, int e) { this.b = b; pos = s; end = e; }
        boolean more() { return pos < end; }
        long varint() { long v = 0; int sh = 0; while (true) { int x = b[pos++] & 0xff; v |= (long) (x & 0x7f) << sh; if (x < 0x80) return v; sh += 7; } }
        void skip(int wire) {
            if (wire == 0) varint(); else if (wire == 1) pos += 8; else if (wire == 2) { int len = (int) varint(); pos += len; } else if (wire == 5) pos += 4;
            else throw new IllegalStateException("bad tile");
        }
    }
    private static void writeVarint(ByteArrayOutputStream o, long v) { while ((v & ~0x7FL) != 0) { o.write((int) ((v & 0x7f) | 0x80)); v >>>= 7; } o.write((int) v); }
    private static void writeTag(ByteArrayOutputStream o, int field, int wire) { writeVarint(o, ((long) field << 3) | wire); }
    private static void writeBytes(ByteArrayOutputStream o, byte[] b) { writeVarint(o, b.length); o.write(b, 0, b.length); }
}
