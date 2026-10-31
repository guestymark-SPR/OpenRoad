/* OpenRoad core: storage, network, units, geometry, polyline decoding. Everything hangs off window.OR. */
'use strict';
window.OR = window.OR || {};
(function (OR) {
  const A = window.Android && window.Android.isNative && window.Android.isNative() ? window.Android : null;
  OR.native = A;
  // the Google Play build updates through Play and can't send texts itself (it offers them ready to send)
  OR.playBuild = !!(A && A.store && A.store() === 'play');
  OR.canText = !OR.playBuild;

  // ---------- storage (native files on Android, localStorage in a browser) ----------
  OR.store = {
    get(k, def) {
      try {
        const v = A ? A.kvGet('or_' + k) : localStorage.getItem('or_' + k);
        return v == null || v === '' ? def : JSON.parse(v);
      } catch (e) { return def; }
    },
    set(k, v) {
      const s = JSON.stringify(v);
      try { if (A) A.kvSet('or_' + k, s); else localStorage.setItem('or_' + k, s); } catch (e) { OR.toast && OR.toast('Could not save: storage full'); }
    }
  };

  // ---------- network: on Android requests go through the app (no browser CORS limits) ----------
  const pending = {}; let seq = 1;
  window.onFetch = function (id, status, text) {
    const p = pending[id]; if (!p) return; delete pending[id];
    if (status >= 200 && status < 300) p.ok(text); else p.fail(new Error(status ? 'server answered ' + status + (text ? ': ' + String(text).slice(0, 200) : '') : 'no connection'));
  };
  OR.http = function (url, opt) {
    opt = opt || {};
    const method = opt.method || 'GET', body = opt.body || '', type = opt.type || 'application/json';
    if (A && A.fetchTextH) {
      return new Promise((ok, fail) => {
        const id = seq++; pending[id] = { ok, fail };
        A.fetchTextH(id, url, method, body, type, JSON.stringify(opt.headers || {}));
        setTimeout(() => { if (pending[id]) { delete pending[id]; fail(new Error('timed out')); } }, opt.timeout || 45000);
      });
    }
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), opt.timeout || 45000);
    return fetch(url, { method, body: method === 'GET' ? undefined : body, headers: method === 'GET' ? undefined : { 'Content-Type': type }, signal: ctl.signal })
      .then(r => r.text().then(tx => { clearTimeout(t); if (!r.ok) throw new Error('server answered ' + r.status + ': ' + tx.slice(0, 200)); return tx; }))
      .catch(e => { clearTimeout(t); throw e.name === 'AbortError' ? new Error('timed out') : e; });
  };
  OR.json = (url, opt) => OR.http(url, opt).then(t => JSON.parse(t));
  OR.online = () => navigator.onLine !== false;
  // a phone on its side: the panel and ride cards sit in a column on the left (style.css), so the map works around it
  OR.sideways = () => { try { return matchMedia('(orientation: landscape) and (max-height: 560px)').matches; } catch (e) { return false; } };

  // ---------- settings ----------
  const DEF = {
    units: 'mi', theme: 'auto', voice: true, voiceVol: 1, style: 'twisty', avoidTolls: true, avoidFerries: false,
    bike: { name: '', tankL: '', mpg: '', reserveMi: 25 }, fuelSince: 0,
    ice: { name: '', blood: '', medical: '', contactName: '', contactPhone: '', reg: '' },
    checkin: { phone: '', name: '', every: 0, grace: 10 }
  };
  OR.cfg = Object.assign({}, DEF, OR.store.get('cfg', {}));
  for (const k of ['bike', 'ice', 'checkin']) OR.cfg[k] = Object.assign({}, DEF[k], OR.cfg[k] || {});
  OR.saveCfg = () => OR.store.set('cfg', OR.cfg);

  // ---------- units (UK: miles, yards, mph) ----------
  const MI = 1609.344, YD = 0.9144;
  OR.fmtDist = function (m, short) {
    if (m == null || isNaN(m)) return '–';
    if (m < 1) return OR.cfg.units === 'km' ? '0 km' : '0 miles';
    if (OR.cfg.units === 'km') {
      if (m < 950) return (Math.round(m / 10) * 10) + ' m';
      return (m < 10000 ? (m / 1000).toFixed(1) : Math.round(m / 1000)) + ' km';
    }
    if (m < 0.1 * MI) { const y = Math.round(m / YD / 10) * 10; return (y < 10 ? 10 : y) + (short ? ' yd' : ' yards'); }
    const mi = m / MI;
    return (mi < 10 ? mi.toFixed(1) : Math.round(mi)) + ' mi';
  };
  OR.spokenDist = function (m) {
    if (OR.cfg.units === 'km') {
      if (m < 950) return (Math.round(m / 50) * 50 || 50) + ' metres';
      const k = Math.round(m / 500) / 2; return (k === 1 ? '1 kilometre' : k + ' kilometres');
    }
    if (m < 0.15 * MI) return (Math.round(m / YD / 50) * 50 || 50) + ' yards';
    const mi = m / MI;
    if (mi < 0.35) return 'a quarter of a mile';
    if (mi < 0.65) return 'half a mile';
    if (mi < 0.85) return 'three quarters of a mile';
    const r = Math.round(mi); return r === 1 ? '1 mile' : r + ' miles';
  };
  OR.speedUnit = () => OR.cfg.units === 'km' ? 'km/h' : 'mph';
  OR.speed = ms => ms == null || isNaN(ms) ? null : Math.round(ms * (OR.cfg.units === 'km' ? 3.6 : 2.236936));
  OR.fmtTime = function (s) {
    if (s == null || isNaN(s)) return '–';
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    return h ? h + ' h ' + (m < 10 ? '0' : '') + m + ' min' : m + ' min';
  };
  OR.clock = d => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  OR.MI = MI;

  // ---------- geometry ----------
  const R = 6371008.8, rad = Math.PI / 180;
  OR.dist = function (a, b) { // [lon,lat]
    const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  };
  OR.bearing = function (a, b) {
    const y = Math.sin((b[0] - a[0]) * rad) * Math.cos(b[1] * rad);
    const x = Math.cos(a[1] * rad) * Math.sin(b[1] * rad) - Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos((b[0] - a[0]) * rad);
    return (Math.atan2(y, x) / rad + 360) % 360;
  };
  OR.angDiff = (a, b) => { let d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  OR.cumulative = function (pts) { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + OR.dist(pts[i - 1], pts[i])); return c; };
  // nearest point on segment a-b to p, in a local flat projection. Returns {t, d}
  OR.projSeg = function (p, a, b) {
    const k = Math.cos(p[1] * rad);
    const ax = (a[0] - p[0]) * k, ay = a[1] - p[1], bx = (b[0] - p[0]) * k, by = b[1] - p[1];
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let t = L ? -(ax * dx + ay * dy) / L : 0; t = Math.max(0, Math.min(1, t));
    const x = ax + t * dx, y = ay + t * dy;
    return { t, d: Math.sqrt(x * x + y * y) * rad * R };
  };
  OR.bbox = function (pts) {
    let w = 180, s = 90, e = -180, n = -90;
    for (const p of pts) { if (p[0] < w) w = p[0]; if (p[0] > e) e = p[0]; if (p[1] < s) s = p[1]; if (p[1] > n) n = p[1]; }
    return [[w, s], [e, n]];
  };
  // evenly spaced points every `step` metres along a line
  OR.resample = function (pts, step) {
    if (pts.length < 2) return pts.slice();
    const out = [pts[0]]; let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], d = OR.dist(a, b); if (!d) continue;
      let pos = step - carry;
      while (pos <= d) { const t = pos / d; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); pos += step; }
      carry = d - (pos - step);
    }
    const last = pts[pts.length - 1]; if (OR.dist(out[out.length - 1], last) > 1) out.push(last);
    return out;
  };

  // Valhalla shapes: encoded polyline with 6 decimal places
  OR.decodePoly = function (str, prec) {
    const f = Math.pow(10, prec || 6), out = []; let i = 0, lat = 0, lon = 0;
    while (i < str.length) {
      let b, sh = 0, r = 0;
      do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
      lat += (r & 1) ? ~(r >> 1) : (r >> 1);
      sh = 0; r = 0;
      do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
      lon += (r & 1) ? ~(r >> 1) : (r >> 1);
      out.push([lon / f, lat / f]);
    }
    return out;
  };
  OR.encodePoly = function (pts, prec) {
    const f = Math.pow(10, prec || 6); let pl = 0, pn = 0, s = '';
    const enc = v => { v = v < 0 ? ~(v << 1) : v << 1; let o = ''; while (v >= 32) { o += String.fromCharCode((32 | (v & 31)) + 63); v >>= 5; } return o + String.fromCharCode(v + 63); };
    for (const p of pts) { const la = Math.round(p[1] * f), lo = Math.round(p[0] * f); s += enc(la - pl) + enc(lo - pn); pl = la; pn = lo; }
    return s;
  };

  OR.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  OR.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  OR.$ = (s, r) => (r || document).querySelector(s);
  OR.$$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  // ---------- voice ----------
  // pan: -1 left ear to 1 right ear (turns and bends, on a stereo headset), when turn sounds are on
  OR.say = function (text, pan) {
    if (!OR.cfg.voice || !text) return;
    if (pan && OR.cfg.stereoTurns !== false && A && A.speakPan) { A.speakPan(text, pan); return; }
    if (A && A.speak) { A.speak(text); return; }
    try {
      const u = new SpeechSynthesisUtterance(text); u.lang = 'en-GB'; u.volume = OR.cfg.voiceVol;
      const v = speechSynthesis.getVoices().find(x => x.lang === 'en-GB'); if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch (e) { }
  };
  OR.hush = () => { try { if (A && A.stopSpeak) A.stopSpeak(); else speechSynthesis.cancel(); } catch (e) { } };

  // ---------- files ----------
  OR.saveFile = function (name, text, mime) {
    if (A && A.saveFile) { const r = A.saveFile(name, text); OR.toast(r || 'Saved to Downloads: ' + name); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime || 'application/gpx+xml' }));
    a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  OR.share = function (text, title) {
    if (A && A.shareText) { A.shareText(text, title || 'OpenRoad'); return; }
    if (navigator.share) navigator.share({ title: title || 'OpenRoad', text }).catch(() => { });
    else { navigator.clipboard && navigator.clipboard.writeText(text); OR.toast('Copied'); }
  };

  let tt;
  OR.toast = function (msg, ms) {
    const el = document.getElementById('toast'); if (!el) return;
    el.textContent = msg; el.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('on'), ms || 3200);
  };

  // ---------- loaded when first used ----------
  // Tools you open now and then are fetched the first time you use them, so the app starts with less to read.
  // Each name below starts as a stand-in that loads its file, then hands over to the real thing.
  const loading = {};
  OR.load = file => loading[file] || (loading[file] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'js/' + file + '.js'; s.onload = res; s.onerror = () => { delete loading[file]; rej(new Error('could not load ' + file)); };
    document.head.appendChild(s);
  }));
  const later = (file, names) => names.forEach(n => { if (!OR[n]) OR[n] = (...a) => OR.load(file).then(() => OR[n](...a)); });
  later('flyover', ['flyover', 'mp4']);
  later('ridevideo', ['rideVideo', 'videoTimes', 'videoStart', 'drawRideOverlay']);
  later('beeline', ['sendToBeeline', 'beelineFiles']);
  later('mapshare', ['shareToMaps', 'mapsPoints', 'googleMapsUrl', 'appleMapsUrl']);
  later('autotrip', ['autoTripSheet', 'autoTrip']);
  later('papers', ['pagePapers', 'showPapers']);
})(window.OR);
