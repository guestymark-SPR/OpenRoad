package uk.openroad.app;

/** UK Ordnance Survey grid reference for a GPS position (Great Britain only), for emergency texts. Same method as web/js/osgrid.js. */
public final class OsGrid {
    private OsGrid() { }
    static boolean onGB(double lat, double lon) {
        if (lat < 49.8 || lat > 61 || lon < -8.7 || lon > 1.8) return false;
        if (lat < 51.3 && lon > 1.5) return false;
        if (lat > 51.35 && lat < 55.15 && lon < -5.45) return false;
        if (lat > 51.35 && lat < 55.45 && lon < -6.2) return false;
        return true;
    }
    /** e.g. "SK 1234 5678", or null outside Great Britain */
    public static String ref(double lat, double lon) {
        if (!onGB(lat, lon)) return null;
        double a = 6378137, b = 6356752.314245, e2 = 1 - b * b / (a * a);
        double f = Math.toRadians(lat), l = Math.toRadians(lon), nu0 = a / Math.sqrt(1 - e2 * Math.sin(f) * Math.sin(f));
        double x = nu0 * Math.cos(f) * Math.cos(l), y = nu0 * Math.cos(f) * Math.sin(l), z = nu0 * (1 - e2) * Math.sin(f);
        double tx = -446.448, ty = 125.157, tz = -542.060, s = 20.4894e-6, rx = Math.toRadians(-0.1502 / 3600), ry = Math.toRadians(-0.2470 / 3600), rz = Math.toRadians(-0.8421 / 3600);
        double x2 = tx + (1 + s) * x - rz * y + ry * z, y2 = ty + rz * x + (1 + s) * y - rx * z, z2 = tz - ry * x + rx * y + (1 + s) * z;
        a = 6377563.396; b = 6356256.909; e2 = 1 - b * b / (a * a);
        double p = Math.sqrt(x2 * x2 + y2 * y2), f2 = Math.atan2(z2, p * (1 - e2)), prev = 2 * Math.PI;
        while (Math.abs(f2 - prev) > 1e-12) { double nu = a / Math.sqrt(1 - e2 * Math.sin(f2) * Math.sin(f2)); prev = f2; f2 = Math.atan2(z2 + e2 * nu * Math.sin(f2), p); }
        double l2 = Math.atan2(y2, x2);
        double F0 = 0.9996012717, f0 = Math.toRadians(49), l0 = Math.toRadians(-2), N0 = -100000, E0 = 400000, n = (a - b) / (a + b);
        double sf = Math.sin(f2), cf = Math.cos(f2), tf = Math.tan(f2);
        double nu = a * F0 / Math.sqrt(1 - e2 * sf * sf), rho = a * F0 * (1 - e2) / Math.pow(1 - e2 * sf * sf, 1.5), eta2 = nu / rho - 1;
        double df = f2 - f0, sF = f2 + f0;
        double M = b * F0 * ((1 + n + 5.0 / 4 * n * n + 5.0 / 4 * n * n * n) * df - (3 * n + 3 * n * n + 21.0 / 8 * n * n * n) * Math.sin(df) * Math.cos(sF)
                + (15.0 / 8 * n * n + 15.0 / 8 * n * n * n) * Math.sin(2 * df) * Math.cos(2 * sF) - (35.0 / 24 * n * n * n) * Math.sin(3 * df) * Math.cos(3 * sF));
        double I = M + N0, II = nu / 2 * sf * cf, III = nu / 24 * sf * Math.pow(cf, 3) * (5 - tf * tf + 9 * eta2), IIIA = nu / 720 * sf * Math.pow(cf, 5) * (61 - 58 * tf * tf + Math.pow(tf, 4));
        double IV = nu * cf, V = nu / 6 * Math.pow(cf, 3) * (nu / rho - tf * tf), VI = nu / 120 * Math.pow(cf, 5) * (5 - 18 * tf * tf + Math.pow(tf, 4) + 14 * eta2 - 58 * tf * tf * eta2);
        double dl = l2 - l0;
        double N = I + II * dl * dl + III * Math.pow(dl, 4) + IIIA * Math.pow(dl, 6), E = E0 + IV * dl + V * Math.pow(dl, 3) + VI * Math.pow(dl, 5);
        if (E < 0 || E >= 700000 || N < 0 || N >= 1300000) return null;
        int e100k = (int) Math.floor(E / 100000), n100k = (int) Math.floor(N / 100000);
        int c1 = (19 - n100k) - (19 - n100k) % 5 + (e100k + 10) / 5, c2 = (19 - n100k) * 5 % 25 + e100k % 5;
        if (c1 > 7) c1++; if (c2 > 7) c2++;
        return "" + (char) (c1 + 65) + (char) (c2 + 65) + String.format(java.util.Locale.UK, " %04d %04d", (int) Math.floor((E % 100000) / 10), (int) Math.floor((N % 100000) / 10));
    }
}
