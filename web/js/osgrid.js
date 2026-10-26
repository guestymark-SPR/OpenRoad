/* UK Ordnance Survey grid references from GPS positions (WGS84 to OSGB36 by a Helmert transform, then the
   National Grid transverse Mercator). Accurate to about 5 m, which is what the Helmert method gives. Great Britain only. */
'use strict';
(function (OR) {
  const rad = d => d * Math.PI / 180;
  // roughly Great Britain: not France or Belgium across the Channel, and not Ireland (which has its own grid)
  OR.onGB = (lat, lon) => {
    if (lat < 49.8 || lat > 61 || lon < -8.7 || lon > 1.8) return false;
    if (lat < 51.3 && lon > 1.5) return false;
    if (lat > 51.35 && lat < 55.15 && lon < -5.45) return false;
    if (lat > 51.35 && lat < 55.45 && lon < -6.2) return false;
    return true;
  };
  OR.osGrid = function (lat, lon) {
    if (!OR.onGB(lat, lon)) return null;
    // WGS84 position to earth-centred x, y, z
    let a = 6378137, b = 6356752.314245, e2 = 1 - b * b / (a * a);
    const φ = rad(lat), λ = rad(lon), ν0 = a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
    const x = ν0 * Math.cos(φ) * Math.cos(λ), y = ν0 * Math.cos(φ) * Math.sin(λ), z = ν0 * (1 - e2) * Math.sin(φ);
    // Helmert transform to OSGB36
    const tx = -446.448, ty = 125.157, tz = -542.060, s = 20.4894e-6, rx = rad(-0.1502 / 3600), ry = rad(-0.2470 / 3600), rz = rad(-0.8421 / 3600);
    const x2 = tx + (1 + s) * x - rz * y + ry * z, y2 = ty + rz * x + (1 + s) * y - rx * z, z2 = tz - ry * x + rx * y + (1 + s) * z;
    // back to latitude and longitude on the Airy 1830 ellipsoid
    a = 6377563.396; b = 6356256.909; e2 = 1 - b * b / (a * a);
    const p = Math.sqrt(x2 * x2 + y2 * y2); let φ2 = Math.atan2(z2, p * (1 - e2)), prev = 2 * Math.PI;
    while (Math.abs(φ2 - prev) > 1e-12) { const ν = a / Math.sqrt(1 - e2 * Math.sin(φ2) ** 2); prev = φ2; φ2 = Math.atan2(z2 + e2 * ν * Math.sin(φ2), p); }
    const λ2 = Math.atan2(y2, x2);
    // National Grid transverse Mercator
    const F0 = 0.9996012717, φ0 = rad(49), λ0 = rad(-2), N0 = -100000, E0 = 400000, n = (a - b) / (a + b);
    const sφ = Math.sin(φ2), cφ = Math.cos(φ2), tφ = Math.tan(φ2);
    const ν = a * F0 / Math.sqrt(1 - e2 * sφ * sφ), ρ = a * F0 * (1 - e2) / Math.pow(1 - e2 * sφ * sφ, 1.5), η2 = ν / ρ - 1;
    const dφ = φ2 - φ0, Sφ = φ2 + φ0;
    const M = b * F0 * ((1 + n + 5 / 4 * n * n + 5 / 4 * n ** 3) * dφ - (3 * n + 3 * n * n + 21 / 8 * n ** 3) * Math.sin(dφ) * Math.cos(Sφ)
      + (15 / 8 * n * n + 15 / 8 * n ** 3) * Math.sin(2 * dφ) * Math.cos(2 * Sφ) - (35 / 24 * n ** 3) * Math.sin(3 * dφ) * Math.cos(3 * Sφ));
    const I = M + N0, II = ν / 2 * sφ * cφ, III = ν / 24 * sφ * cφ ** 3 * (5 - tφ * tφ + 9 * η2), IIIA = ν / 720 * sφ * cφ ** 5 * (61 - 58 * tφ * tφ + tφ ** 4);
    const IV = ν * cφ, V = ν / 6 * cφ ** 3 * (ν / ρ - tφ * tφ), VI = ν / 120 * cφ ** 5 * (5 - 18 * tφ * tφ + tφ ** 4 + 14 * η2 - 58 * tφ * tφ * η2);
    const dλ = λ2 - λ0;
    const N = I + II * dλ ** 2 + III * dλ ** 4 + IIIA * dλ ** 6, E = E0 + IV * dλ + V * dλ ** 3 + VI * dλ ** 5;
    if (E < 0 || E >= 700000 || N < 0 || N >= 1300000) return null;
    // the two grid letters, then 4 + 4 figures (10 m)
    const e100k = Math.floor(E / 100000), n100k = Math.floor(N / 100000);
    let l1 = (19 - n100k) - (19 - n100k) % 5 + Math.floor((e100k + 10) / 5), l2 = (19 - n100k) * 5 % 25 + e100k % 5;
    if (l1 > 7) l1++; if (l2 > 7) l2++;
    const pad = v => String(Math.floor((v % 100000) / 10)).padStart(4, '0');
    return { ref: String.fromCharCode(l1 + 65) + String.fromCharCode(l2 + 65) + ' ' + pad(E) + ' ' + pad(N), E: Math.round(E), N: Math.round(N) };
  };
})(typeof window !== 'undefined' ? window.OR : (global.OR = global.OR || {}));
