/* OpenRoad riding awareness: warnings about the road ahead and about you.
   - Bends ahead: tight bends on the route, spoken early with a speed to take them at.
   - Turn sounds in the ear the turn is on (stereo intercoms and headsets).
   - Low sun: stretches where you'll ride into a low sun, on the route card and spoken while riding.
   - Grip: stretches likely to be slippery (wet, first rain after a dry spell, cold, wooded with autumn leaves).
   - Fatigue: when your riding gets less smooth than earlier in the same ride, suggests a break. */
'use strict';
(function (OR) {
  const A = OR.native, $ = OR.$, $$ = OR.$$, esc = OR.esc, ic = (n, c) => OR.ic(n, c);
  const R2D = 180 / Math.PI, D2R = Math.PI / 180, G = 9.81;
  const METEO = 'https://api.open-meteo.com/v1/forecast';
  const on = k => OR.cfg[k] !== false; // all on unless switched off in Safety

  // ---------- which side a turn is on: -1 left, 1 right, 0 straight or unknown ----------
  OR.turnSide = function (type) {
    const t = +type;
    if ([9, 10, 11, 2, 18, 20, 23, 37, 12].includes(t)) return 1;
    if ([16, 15, 14, 3, 19, 21, 24, 38, 13].includes(t)) return -1;
    return 0;
  };

  // ---------- bends ahead ----------
  // From the route's shape every 10 m: how much it turns over 60 m gives the radius; a bend is a run of turning
  // the same way that adds up to 40° or more. Speed to take it: v = sqrt(g · r · tan(lean)), with a lean you
  // are comfortable at (from your own past rides, 15° to 25°), and a 15% margin.
  OR.routeBends = function (route) {
    const P = OR.resample(route.shape, 10); if (P.length < 12) return [];
    const h = []; for (let i = 1; i < P.length; i++) h.push(OR.bearing(P[i - 1], P[i]));
    const dh = h.map((x, i) => i ? ((x - h[i - 1] + 540) % 360) - 180 : 0);
    const W = 3, win = dh.map((_, i) => { let s = 0; for (let k = Math.max(1, i - W); k <= Math.min(dh.length - 1, i + W); k++) s += dh[k]; return s; });
    const cum = OR.cumulative(P), out = [];
    let i = W;
    while (i < win.length - W) {
      const a = Math.abs(win[i]);
      if (a < 20) { i++; continue; }
      const sign = Math.sign(win[i]);
      // grow the bend both ways while it keeps turning the same way
      let s = i, e = i;
      while (s > 1 && Math.sign(dh[s - 1]) === sign && Math.abs(dh[s - 1]) > 0.8) s--;
      while (e < dh.length - 1 && Math.sign(dh[e + 1]) === sign && Math.abs(dh[e + 1]) > 0.8) e++;
      let total = 0; for (let k = s; k <= e; k++) total += dh[k];
      let peak = 0; for (let k = s; k <= e; k++) peak = Math.max(peak, Math.abs(win[k]));
      const radius = (W * 2 * 10) / (peak * D2R);
      if (Math.abs(total) >= 40 && radius < 260) out.push({ at: cum[s], mid: cum[Math.round((s + e) / 2)], end: cum[e], dir: sign > 0 ? 'right' : 'left', angle: Math.round(Math.abs(total)), radius: Math.round(radius), p: P[Math.round((s + e) / 2)] });
      i = e + W + 1;
    }
    // map back to distances along the route's own line (resampling keeps distance, so these match route.cum)
    return out;
  };
  // a lean you're comfortable at, from bends on your recorded rides (kept as a short list of numbers)
  OR.comfortLean = function () {
    const l = OR.store.get('bendLeans', []).slice().sort((a, b) => a - b);
    if (l.length < 8) return 20;
    return Math.max(15, Math.min(25, l[Math.floor(l.length * 0.6)]));
  };
  OR.on('ridestop', saved => { if (!saved || !OR.corners) return; try { const c = OR.corners(saved).map(x => x.lean).filter(x => x > 3); if (c.length) OR.store.set('bendLeans', OR.store.get('bendLeans', []).concat(c).slice(-300)); } catch (e) { } });
  OR.bendSpeed = (radius, lean) => Math.sqrt(G * radius * Math.tan((lean || OR.comfortLean()) * D2R)) * 0.85;
  const round5 = v => Math.max(5, Math.round(v / 5) * 5);

  let bends = [], bendRoute = null, saidBend = {};
  function bendCheck(e) {
    const r = OR.ride.route; if (!r || !on('bendWarn') || OR.ride.off) return;
    if (bendRoute !== r) { bendRoute = r; bends = OR.routeBends(r); saidBend = {}; }
    const p = OR.pos, v = (p && p.speed) || 0, along = OR.ride.along; if (v < 7) return; // under about 15 mph
    const lean = OR.comfortLean();
    const look = Math.max(140, v * 7); // about 7 seconds ahead
    for (let k = 0; k < bends.length; k++) {
      const b = bends[k], d = b.at - along;
      if (d < 0) continue; if (d > look) break;
      if (saidBend[k]) continue;
      // a junction turn here is already being announced
      if (r.man.some(m => Math.abs(m.at - b.mid) < 60 && OR.turnSide(m.type) !== 0)) { saidBend[k] = 1; continue; }
      const vs = OR.bendSpeed(b.radius, lean), lim = e && e.limit ? e.limit / 3.6 : Infinity;
      saidBend[k] = 1;
      if (vs > Math.min(lim, 26) || v < vs + 2) continue; // not tight for this speed (or the speed limit is lower anyway)
      // a bend straight after, the other way
      const nx = bends[k + 1], then = nx && nx.at - b.end < 150 && nx.dir !== b.dir ? nx : null; if (then) saidBend[k + 1] = 1;
      const kind = b.angle >= 150 ? 'Hairpin' : b.angle >= 90 ? 'Tight' : 'Sharp';
      const sp = OR.speed(Math.min(vs, then ? OR.bendSpeed(then.radius, lean) : vs));
      OR.say(kind + ' ' + b.dir + (then ? ' then ' + then.dir : '') + ' in ' + OR.spokenDist(d) + ', about ' + round5(sp), b.dir === 'left' ? -0.8 : 0.8);
      OR.emit('bendAhead', { bend: b, then, speed: sp });
      break;
    }
  }

  // ---------- low sun ----------
  // Sun position (NOAA approximation, good to a fraction of a degree): elevation and compass bearing.
  OR.sunPos = function (date, lat, lon) {
    const d = date.getTime() / 864e5 - 10957.5; // days since 1 Jan 2000, 12:00 UTC
    const g = (357.529 + 0.98560028 * d) * D2R, q = 280.459 + 0.98564736 * d;
    const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R, ep = (23.439 - 0.00000036 * d) * D2R;
    const ra = Math.atan2(Math.cos(ep) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(ep) * Math.sin(L));
    const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
    const H = (gmst * 15 + lon) * D2R - ra, la = lat * D2R;
    const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H));
    const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(H));
    return { el: el * R2D, az: ((az * R2D) + 360) % 360 };
  };
  // where along the route you are at what time, leaving at depart
  function timeAt(route, depart) {
    const total = OR.myTime ? OR.myTime(route.time, true) : route.time, dist = route.dist || route.cum[route.cum.length - 1];
    return d => new Date(depart.getTime() + total * 1000 * (d / dist));
  }
  // stretches riding into a sun between 0° and 20° up and within 25° of straight ahead
  OR.glareAlong = function (route, depart) {
    const when = timeAt(route, depart), P = OR.resample(route.shape, 250), c = OR.cumulative(P), out = [];
    let cur = null;
    for (let i = 1; i < P.length; i++) {
      const t = when(c[i]), s = OR.sunPos(t, P[i][1], P[i][0]), road = OR.bearing(P[i - 1], P[i]);
      const glare = s.el > 0 && s.el < 20 && OR.angDiff(road, s.az) < 25;
      if (glare) { if (!cur) cur = { from: c[i - 1], to: c[i], t, el: s.el }; else cur.to = c[i]; }
      else if (cur) { out.push(cur); cur = null; }
    }
    if (cur) out.push(cur);
    return out.filter(x => x.to - x.from >= 1000); // ignore anything shorter than about half a mile
  };
  const glareLen = g => g.reduce((s, x) => s + x.to - x.from, 0);
  // the leave time in the next 3 hours (15-minute steps) with the least low sun
  OR.glareBetter = function (route, depart) {
    const now = glareLen(OR.glareAlong(route, depart)); if (now < 3000) return null;
    let best = { t: depart, len: now };
    for (let m = 15; m <= 180; m += 15) { const t = new Date(depart.getTime() + m * 60000), l = glareLen(OR.glareAlong(route, t)); if (l < best.len - 1500) best = { t, len: l }; }
    return best.t === depart ? null : best;
  };
  let lastGlareSay = 0;
  function glareCheck() {
    const r = OR.ride.route; if (!r || !on('glareWarn') || Date.now() - lastGlareSay < 10 * 60000) return;
    const along = OR.ride.along;
    const g = OR.glareAlong(r, new Date(Date.now() - (OR.myTime ? OR.myTime(r.time, true) : r.time) * 1000 * (along / r.dist)));
    const next = g.find(x => x.to > along && x.from - along < 1500);
    if (!next) return;
    lastGlareSay = Date.now();
    const len = next.to - Math.max(along, next.from);
    OR.say((next.from > along + 200 ? 'In ' + OR.spokenDist(next.from - along) + ', low' : 'Low') + ' sun ahead for about ' + OR.spokenDist(len) + '. Visor down, and watch for oncoming traffic you can\'t see.');
  }

  // ---------- grip ----------
  // Looks at the weather before and during the ride where you'll be, and at wooded stretches (OpenStreetMap).
  const LEAF_MONTHS = [9, 10]; // October and November (0 = January)
  async function woodsAlong(route) {
    if (route.dist > 400000) return []; // very long routes: too much to fetch at once
    const line = OR.resample(route.shape, 60), coords = line.map(p => p[1].toFixed(5) + ',' + p[0].toFixed(5)).join(',');
    const q = '[out:json][timeout:40];(way["natural"="wood"](around:20,' + coords + ');way["landuse"="forest"](around:20,' + coords + '););out geom qt;';
    const els = await OR.overpassRaw(q);
    return els.filter(e => e.geometry && e.geometry.length > 3).map(e => { const g = e.geometry.map(n => [n.lon, n.lat]); const b = OR.bbox(g); return { g, b }; });
  }
  function inside(p, ring) { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
  function inBox(p, b) { return p[0] >= b[0][0] && p[0] <= b[1][0] && p[1] >= b[0][1] && p[1] <= b[1][1]; }
  OR.gripAlong = async function (route, depart) {
    const when = timeAt(route, depart), P = OR.resample(route.shape, 200), c = OR.cumulative(P);
    // weather: up to 12 points along the route, with the last 3 days of rain
    const n = Math.min(12, Math.max(2, Math.ceil(route.dist / 15000))), idx = [];
    for (let k = 0; k < n; k++) idx.push(Math.round(k * (P.length - 1) / (n - 1)));
    const q = '?latitude=' + idx.map(i => P[i][1].toFixed(3)).join(',') + '&longitude=' + idx.map(i => P[i][0].toFixed(3)).join(',') + '&hourly=temperature_2m,precipitation&past_days=3&forecast_days=3&timeformat=unixtime';
    let wx = await OR.json(METEO + q); if (!Array.isArray(wx)) wx = [wx];
    const woods = await woodsAlong(route).catch(() => null);
    const leafy = LEAF_MONTHS.includes(depart.getMonth());
    const seg = [];
    for (let i = 1; i < P.length; i++) {
      const t = when(c[i]).getTime(), wi = idx.reduce((b, x, k) => Math.abs(x - i) < Math.abs(idx[b] - i) ? k : b, 0), h = wx[wi] && wx[wi].hourly; if (!h) continue;
      let k = 0; h.time.forEach((tt, j) => { if (Math.abs(tt * 1000 - t) < Math.abs(h.time[k] * 1000 - t)) k = j; });
      const sum = (a, b) => { let s = 0; for (let j = Math.max(0, k - a); j <= Math.max(0, k - b); j++) s += h.precipitation[j] || 0; return s; };
      const recent = sum(2, 0), before = sum(72, 3), temp = h.temperature_2m[k], wet12 = sum(12, 0);
      const wood = woods ? woods.some(w => inBox(P[i], w.b) && inside(P[i], w.g)) : false;
      const why = [];
      if (recent >= 0.3 && before < 1) why.push('first rain after a dry spell: oily and greasy');
      else if (recent >= 0.3) why.push('wet');
      if (temp <= 1 || (temp <= 3 && wet12 >= 0.2)) why.push('cold enough for ice' + (wood ? ' in the shade' : ''));
      else if (temp <= 6) why.push('cold: tyres slow to warm');
      if (wood && leafy) why.push('wooded: fallen leaves likely' + (wet12 >= 0.2 ? ', and slow to dry' : ''));
      else if (wood && wet12 >= 0.2) why.push('wooded: slow to dry');
      const risk = why.some(w => /ice|first rain/.test(w)) ? 2 : why.length ? 1 : 0;
      seg.push({ a: P[i - 1], b: P[i], from: c[i - 1], to: c[i], risk, why, temp, wood });
    }
    // join into stretches of the same risk and reasons
    const st = [];
    seg.forEach(s => { const l = st[st.length - 1]; if (l && l.risk === s.risk && l.why.join() === s.why.join()) { l.to = s.to; l.line.push(s.b); } else st.push({ from: s.from, to: s.to, risk: s.risk, why: s.why, line: [s.a, s.b] }); });
    return { stretches: st, woodsChecked: !!woods, leafy, minTemp: Math.min(...seg.map(s => s.temp)) };
  };
  const GRIP_COL = ['match', ['get', 'risk'], 2, '#c62828', 1, '#ef8f00', '#2e7d32'];
  OR.showGrip = function (g) {
    const m = OR.map;
    if (!g) { if (m.getLayer('grip')) m.removeLayer('grip'); if (m.getSource('grip')) m.removeSource('grip'); return; }
    const data = { type: 'FeatureCollection', features: g.stretches.filter(s => s.risk).map(s => ({ type: 'Feature', properties: { risk: s.risk }, geometry: { type: 'LineString', coordinates: s.line } })) };
    if (m.getSource('grip')) m.getSource('grip').setData(data);
    else { m.addSource('grip', { type: 'geojson', data }); m.addLayer({ id: 'grip', type: 'line', source: 'grip', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': GRIP_COL, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 5, 14, 11], 'line-opacity': 0.75 } }); }
  };
  OR.on('style', () => { gripShown = null; });
  OR.on('planCleared', () => OR.showGrip(null));
  let gripShown = null;

  // ---------- on the route card ----------
  const cache = {};
  const sig = r => r.shape.length + ':' + Math.round(r.dist) + ':' + r.shape[0].join();
  const depart = () => OR.plan && OR.plan.depart ? new Date(OR.plan.depart) : new Date();
  OR.awareHtml = function (r) {
    if (!r) return '';
    const c = cache[sig(r)] || {}; let h = '';
    const dep = depart(), dkey = Math.round(dep.getTime() / 900000);
    if (c.glareKey !== dkey) { c.glare = OR.glareAlong(r, dep); c.better = OR.glareBetter(r, dep); c.glareKey = dkey; cache[sig(r)] = c; }
    const gl = glareLen(c.glare);
    if (gl >= 1500) h += '<div class="card warnc glare"><b>' + ic('sun') + 'Low sun for about ' + OR.fmtDist(gl) + '</b><span class="small">Riding into a low sun ' + c.glare.map(x => 'from ' + OR.fmtDist(x.from) + ' (' + OR.clock(x.t) + ')').slice(0, 3).join(', ') + '. Visor down, and oncoming drivers may not see you either.' +
      (c.better ? ' Leaving at <b>' + OR.clock(c.better.t) + '</b> cuts it to ' + (c.better.len < 500 ? 'almost none' : 'about ' + OR.fmtDist(c.better.len)) + '.' : '') + '</span>' + (c.better ? '<button class="btn small" id="glSet">Leave at ' + OR.clock(c.better.t) + '</button>' : '') + '</div>';
    if (c.grip) {
      const g = c.grip, bad = g.stretches.filter(s => s.risk), len = k => g.stretches.filter(s => s.risk === k).reduce((a, s) => a + s.to - s.from, 0);
      if (bad.length) {
        const reasons = {}; bad.forEach(s => s.why.forEach(w => { reasons[w] = (reasons[w] || 0) + s.to - s.from; }));
        h += '<div class="card ' + (len(2) ? 'bad' : 'warnc') + ' gripc"><b>' + ic('shield') + 'Grip: ' + (len(2) ? OR.fmtDist(len(2)) + ' poor' + (len(1) ? ', ' : '') : '') + (len(1) ? OR.fmtDist(len(1)) + ' to take care on' : '') + '</b><ul class="small">' +
          Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([w, d]) => '<li>' + esc(w.charAt(0).toUpperCase() + w.slice(1)) + ': about ' + OR.fmtDist(d) + '</li>').join('') + '</ul>' +
          '<span class="small muted">From the forecast where you\'ll be' + (g.woodsChecked ? ' and wooded roads on OpenStreetMap' : '') + '. It can\'t see diesel, mud or gravel.</span><button class="btn small" id="grShow">' + (gripShown === sig(r) ? 'Hide on map' : 'Show on map') + '</button></div>';
      } else h += '<div class="card okc gripc"><b>' + ic('shield') + 'Grip looks good</b><span class="small">Dry, and ' + Math.round(g.minTemp) + '° at the coldest' + (g.leafy && g.woodsChecked ? ', no long wooded stretches' : '') + '. It can\'t see diesel, mud or gravel.</span></div>';
    } else if (c.gripErr) h += '<p class="small muted">Grip check unavailable: ' + esc(c.gripErr) + '</p>';
    else if (c.gripBusy) h += '<p class="small muted">Checking grip along the route…</p>';
    return h;
  };
  OR.awareBind = function (r) {
    const gs = $('#glSet'); if (gs) gs.onclick = () => { const c = cache[sig(r)]; if (!c || !c.better) return; OR.plan.depart = c.better.t.getTime(); OR.toast('Leave time set to ' + OR.clock(c.better.t)); OR.emit('departChanged', c.better.t); OR.repaintExtras && OR.repaintExtras(); };
    const gr = $('#grShow'); if (gr) gr.onclick = () => { const c = cache[sig(r)]; if (gripShown === sig(r)) { OR.showGrip(null); gripShown = null; } else { OR.showGrip(c.grip); gripShown = sig(r); } OR.repaintExtras && OR.repaintExtras(); };
  };
  OR.on('routeShown', async r => {
    const k = sig(r), c = cache[k] = cache[k] || {};
    if (gripShown && gripShown !== k) { OR.showGrip(null); gripShown = null; }
    if (c.grip || c.gripBusy || !OR.online()) return;
    c.gripBusy = true;
    try { c.grip = await OR.gripAlong(r, depart()); } catch (e) { c.gripErr = e.message; }
    c.gripBusy = false;
    OR.repaintExtras && OR.repaintExtras();
  });
  OR.on('departChanged', () => { Object.values(cache).forEach(c => { c.grip = null; c.glareKey = null; }); });

  // ---------- fatigue ----------
  // Each minute of riding over about 20 mph gets a roughness score: how jerky your speed is (from GPS) and,
  // in the Android app with the phone in a mount, how much the bike is being corrected side to side (gyro).
  // Your first half hour of the ride is your fresh baseline. If the last 10 minutes are clearly rougher than
  // that, for two checks in a row, after at least 45 minutes of riding, OpenRoad suggests a break.
  const fat = { mins: [], cur: null, lastV: null, lastT: 0, flagged: 0, lastSay: 0 };
  OR.fatigue = fat;
  function fatFix(p) {
    if (!OR.ride.on) return;
    const t = p.t || Date.now(), v = p.speed;
    if (v == null) return;
    if (fat.lastT && t - fat.lastT < 5000 && v > 9 && fat.lastV > 9) {
      const dt = (t - fat.lastT) / 1000, a = (v - fat.lastV) / dt, m = Math.floor(t / 60000);
      if (!fat.cur || fat.cur.m !== m) { if (fat.cur && fat.cur.n >= 30) fat.mins.push(fat.cur); fat.cur = { m, n: 0, ss: 0, hard: 0 }; }
      fat.cur.n++; fat.cur.ss += a * a; if (a < -3) fat.cur.hard++;
    }
    fat.lastV = v; fat.lastT = t;
  }
  const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  function minuteScore(x) { return Math.sqrt(x.ss / x.n) + x.hard * 0.4 + (x.gyro != null ? x.gyro * 1.5 : 0); }
  OR.fatigueIndex = function () {
    const ms = fat.mins; if (ms.length < 40) return null;
    if (A && A.rideSteadiness) { try { const g = JSON.parse(A.rideSteadiness(String(ms[0].m * 60000 - 1))); const by = {}; g.forEach(x => { by[Math.floor(x[0] / 60000)] = x[1]; }); ms.forEach(x => { if (by[x.m] != null) x.gyro = by[x.m]; }); } catch (e) { } }
    const base = median(ms.slice(5, 35).map(minuteScore)), last = median(ms.slice(-10).map(minuteScore));
    return base > 0 ? last / base : null;
  };
  function fatigueCheck() {
    if (!OR.ride.on || !on('fatigueWarn')) return;
    const rode = OR.breakState ? OR.breakState().moving : 0; if (rode < 45 * 60) { fat.flagged = 0; return; }
    const ix = OR.fatigueIndex(); if (ix == null) return;
    fat.flagged = ix > 1.35 ? fat.flagged + 1 : 0;
    if (fat.flagged >= 2 && Date.now() - fat.lastSay > 40 * 60000) {
      fat.lastSay = Date.now(); fat.flagged = 0;
      const intro = 'Your riding is less smooth than it was earlier. Tiredness shows up like that before you feel it. Time for a break?';
      if (OR.suggestBreak && OR.pos) OR.suggestBreak(OR.pos, intro); else OR.say(intro);
    }
  }
  setInterval(() => { if (OR.ride && OR.ride.on) fatigueCheck(); }, 5 * 60000);
  OR.fatigueCheckNow = fatigueCheck; // for testing
  OR.on('ridestart', () => { fat.mins = []; fat.cur = null; fat.lastV = null; fat.lastT = 0; fat.flagged = 0; });

  // ---------- live hooks ----------
  OR.on('fix', fatFix);
  OR.on('ride', e => { if (!e || e.free) return; try { bendCheck(e); } catch (x) { } });
  setInterval(() => { if (OR.ride && OR.ride.on) try { glareCheck(); } catch (x) { } }, 60000);

  if (A && A.pubHazOn) A.pubHazOn(on('pubHazards'));
  // ---------- settings (in Safety) ----------
  OR.awareSettings = function (box) {
    const el = document.createElement('div'), c = OR.cfg;
    const row = (k, t, d) => '<label class="chk"><input type="checkbox" data-aw="' + k + '"' + (c[k] !== false ? ' checked' : '') + '> ' + t + '</label><p class="small muted">' + d + '</p>';
    el.innerHTML = '<h3>Road ahead</h3>' +
      row('bendWarn', 'Warn me about tight bends', 'Spoken a few seconds before a tight bend on your route, with a speed to take it at, from the shape of the road and the lean you usually use (now about ' + OR.comfortLean() + '°). Only when you\'re going faster than that.') +
      row('stereoTurns', 'Turn sounds in the ear the turn is on', 'A chime and the direction in your left ear for a left turn, right for right. Needs a stereo headset or intercom (most Sena and Cardo play music in stereo).') +
      row('glareWarn', 'Warn me about low sun ahead', 'When you\'re about to ride into a low sun. The route card also shows it before you go.') +
      row('pubHazards', 'Share hazards with all OpenRoad riders', 'See and hear hazards other riders mark (gravel, diesel, a crash), and mark your own for everyone. Anonymous: no name or track is shared, just the hazard and where it is. They go after 6 hours. Android app only.') +
      row('fatigueWarn', 'Suggest a break when my riding gets tired', 'Compares how smooth your riding is now with your first half hour. A guide only: stop whenever you feel tired.');
    box.appendChild(el);
    $$('[data-aw]', el).forEach(x => x.onchange = () => { c[x.dataset.aw] = x.checked; OR.saveCfg(); if (x.dataset.aw === 'pubHazards' && A && A.pubHazOn) A.pubHazOn(x.checked); });
  };
})(window.OR);
