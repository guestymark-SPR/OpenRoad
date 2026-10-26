/* OpenRoad ride mode: GPS, following the route, turn-by-turn voice, rerouting, ride recording. */
'use strict';
(function (OR) {
  const A = OR.native;
  OR.pos = null;
  const ride = OR.ride = { on: false, route: null, follow: true, seg: 0, along: 0, spoken: {}, off: 0, rerouting: false, lastOffSay: 0,
    pts: [], times: [], dist: 0, moving: 0, max: 0, start: 0, lastT: 0 };

  // ---------- GPS ----------
  let watchId = null, marker = null, lastHeading = 0;
  OR.startGps = function () {
    if (A && A.startGps) { A.startGps(); return; }
    if (!navigator.geolocation) { OR.toast('This device has no GPS access'); return; }
    if (watchId != null) return;
    watchId = navigator.geolocation.watchPosition(onFix, e => window.onGpsError(e.message), { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  };
  OR.stopGps = function () { if (A && A.stopGps) A.stopGps(); else if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; } };
  window.onNativeFix = onFix;
  window.onGpsError = msg => OR.toast(msg || 'GPS problem', 6000);

  function markerEl() {
    const el = document.createElement('div'); el.className = 'me';
    el.innerHTML = '<svg viewBox="0 0 48 48" width="48" height="48"><circle cx="24" cy="24" r="20" class="me-halo"/><path d="M24 7 L36 37 L24 30 L12 37 Z" class="me-arrow"/></svg>';
    return el;
  }
  function onFix(f) {
    const c = f.coords; if (!c) return;
    const p = { lng: c.longitude, lat: c.latitude, speed: c.speed, acc: c.accuracy, t: f.timestamp || Date.now() };
    if (c.speed != null && c.speed > 1.5 && c.heading != null && !isNaN(c.heading)) lastHeading = c.heading;
    else if (OR.pos && c.speed != null && c.speed > 1.5) lastHeading = OR.bearing([OR.pos.lng, OR.pos.lat], [p.lng, p.lat]);
    p.heading = lastHeading;
    OR.pos = p;
    if (!marker && OR.map) marker = new maplibregl.Marker({ element: markerEl(), rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([p.lng, p.lat]).addTo(OR.map);
    if (marker) { marker.setLngLat([p.lng, p.lat]); marker.setRotation(p.heading || 0); }
    if (ride.on) {
      const l = OR.leanFrom ? OR.leanFrom(p) : null;
      if (l != null) { if (l > ride.leanR) ride.leanR = l; if (-l > ride.leanL) ride.leanL = -l; ride.lean = l; }
      step(p);
    }
    OR.emit('fix', p);
  }

  // ---------- following the route ----------
  function locate(route, p) {
    const s = route.shape, n = s.length, me = [p.lng, p.lat];
    let best = { d: 1e12, i: 0, t: 0 };
    const scan = (a, b) => { for (let i = Math.max(0, a); i < Math.min(n - 1, b); i++) { const r = OR.projSeg(me, s[i], s[i + 1]); if (r.d < best.d) best = { d: r.d, i, t: r.t }; } };
    scan(ride.seg - 30, ride.seg + 600);
    if (best.d > 120) scan(0, n);
    const along = route.cum[best.i] + best.t * (route.cum[best.i + 1] - route.cum[best.i]);
    const segBear = OR.bearing(s[best.i], s[best.i + 1]);
    return { d: best.d, i: best.i, t: best.t, along, segBear };
  }

  function nextMan(route, along) {
    for (let k = 0; k < route.man.length; k++) if (route.man[k].at > along + 8) return k;
    return route.man.length - 1;
  }

  function step(p) {
    record(p);
    const route = ride.route;
    if (!route) { OR.emit('ride', { free: true }); camera(p, null); return; }
    const L = locate(route, p);
    const wrongWay = p.speed > 4 && OR.angDiff(L.segBear, p.heading) > 120;
    const offLimit = 45 + Math.min(60, p.acc || 10);
    if (L.d > offLimit || wrongWay) ride.off++; else { ride.off = 0; ride.seg = L.i; ride.along = Math.max(L.along, ride.along - 30); }
    if (ride.off >= 3 && !ride.rerouting) offRoute(p, L);

    const k = nextMan(route, ride.along), m = route.man[k];
    const toTurn = m.at - ride.along, remain = route.dist - ride.along;
    // voice: an early warning then the instruction itself, timed for the speed you are doing
    const v = Math.max(p.speed || 0, 9);
    const far = Math.min(2000, Math.max(500, v * 45)), near = Math.min(260, Math.max(70, v * 8));
    const said = ride.spoken[k] || 0;
    const prevLen = k > 0 ? route.man[k - 1].len : 1e9;
    if (ride.off === 0) {
      if (said < 1 && toTurn <= far && toTurn > near * 1.8 && prevLen > far * 0.6 && m.alert) { OR.say('In ' + OR.spokenDist(toTurn) + ', ' + m.alert); ride.spoken[k] = 1; }
      else if (said < 2 && toTurn <= near) { OR.say(m.pre); ride.spoken[k] = 2; }
    }
    ride.limit = OR.limitAt(ride.limits, ride.along);
    for (const c of ride.cams || []) {
      const d = c.at - ride.along;
      if (d > 0 && d < Math.max(300, v * 20) && !c.said) { c.said = true; const lim = OR.limitSign(ride.limit); OR.say('Speed camera ahead' + (lim ? ', limit ' + lim : '')); }
    }
    const isEnd = k === route.man.length - 1;
    if (isEnd && remain < 35 && !ride.arrived) { ride.arrived = true; OR.say(m.pre || 'You have arrived'); OR.emit('arrived'); }
    // travelled part in grey
    const done = route.shape.slice(0, ride.seg + 1); done.push([p.lng, p.lat]);
    OR.setData('done', { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: done } }] });
    const eta = new Date(Date.now() + timeLeft(route, ride.along) * 1000);
    OR.emit('ride', { m, next: route.man[k + 1], toTurn, remain, eta, k, limit: ride.limit });
    camera(p, toTurn);
  }
  function timeLeft(route, along) {
    let t = 0;
    for (const m of route.man) { const end = m.at + m.len; if (end <= along) continue; t += m.time * (m.at >= along ? 1 : (end - along) / Math.max(1, m.len)); }
    return t;
  }

  async function offRoute(p, L) {
    if (OR.online()) {
      ride.rerouting = true; OR.emit('rerouting', true); OR.say('Finding a new route');
      try {
        const r = await OR.rerouteFrom([p.lng, p.lat, p.heading], ride.route, ride.along);
        ride.route = r; ride.seg = 0; ride.along = 0; ride.spoken = {}; ride.off = 0;
        OR.setData('route', { type: 'FeatureCollection', features: [OR.routeGeo(r)] });
        ride.limits = null; ride.cams = []; loadRideData(r);
        OR.emit('rerouted', r);
      } catch (e) { offlineHint(p, L); }
      ride.rerouting = false; OR.emit('rerouting', false);
    } else offlineHint(p, L);
  }
  function offlineHint(p, L) {
    if (Date.now() - ride.lastOffSay < 60000) return; ride.lastOffSay = Date.now();
    const target = ride.route.shape[Math.min(ride.route.shape.length - 1, L.i + 1)];
    const b = OR.bearing([p.lng, p.lat], target), rel = ((b - (p.heading || 0)) + 540) % 360 - 180;
    const side = Math.abs(rel) < 30 ? 'ahead' : Math.abs(rel) > 150 ? 'behind you' : rel > 0 ? 'to your right' : 'to your left';
    OR.say('You are off the route. The route is ' + OR.spokenDist(L.d) + ' ' + side + '.');
  }

  // ---------- camera ----------
  let lastCam = 0;
  function camera(p, toTurn) {
    if (!ride.follow || !OR.map) return;
    const now = Date.now(); if (now - lastCam < 700) return; lastCam = now;
    const mph = (p.speed || 0) * 2.237;
    let zoom = mph > 55 ? 15 : mph > 35 ? 15.8 : 16.6;
    if (toTurn != null && toTurn < 350) zoom = Math.max(zoom, 16.8);
    OR.map.easeTo({ center: [p.lng, p.lat], bearing: p.heading || OR.map.getBearing(), zoom, pitch: 55, duration: 900, offset: [0, OR.map.getContainer().clientHeight * 0.22] });
  }

  // ---------- recording ----------
  function record(p) {
    if ((p.acc || 0) > 60) return;
    const q = [p.lng, p.lat];
    if (ride.pts.length) {
      const last = ride.pts[ride.pts.length - 1], d = OR.dist(last, q), dt = (p.t - ride.lastT) / 1000;
      if (d < 8) return;
      if (dt > 0 && d / dt > 90) return; // a GPS jump, not real riding
      ride.dist += d; if (dt < 30 && d / dt > 1.5) ride.moving += dt;
    }
    if (p.speed != null && p.speed > ride.max && p.speed < 90) ride.max = p.speed;
    ride.pts.push(q); ride.times.push(p.t); ride.lastT = p.t;
    OR.emit('distance', ride.dist);
    if (ride.pts.length % 5 === 0) OR.setData('track', { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: ride.pts } }] });
    if (ride.pts.length % 30 === 0) OR.store.set('rideInProgress', snapshot());
  }
  const snapshot = () => ({ start: ride.start, pts: OR.encodePoly(ride.pts, 6), times: ride.times, dist: ride.dist, moving: ride.moving, max: ride.max, routeId: ride.route && (ride.route.originalId || ride.route.id), name: ride.route && ride.route.name });

  // When the screen was off, the app's ride service kept recording; pull those points in.
  OR.pullNativeTrack = function () {
    if (!A || !A.rideTrack || !ride.on) return;
    try {
      const pts = JSON.parse(A.rideTrack(String(ride.lastT || 0)) || '[]');
      for (const f of pts) record({ lng: f[0], lat: f[1], speed: f[2], acc: f[3], t: f[4] });
    } catch (e) { }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) OR.pullNativeTrack(); });

  // ---------- start / stop ----------
  let wake = null;
  function screenOn(on) {
    if (A && A.keepScreenOn) { A.keepScreenOn(on); return; }
    try { if (on && navigator.wakeLock) navigator.wakeLock.request('screen').then(w => wake = w).catch(() => { }); else if (wake) { wake.release(); wake = null; } } catch (e) { }
  }
  OR.startRide = function (route) {
    Object.assign(ride, { on: true, route: route || null, follow: true, seg: 0, along: 0, spoken: {}, off: 0, arrived: false, pts: [], times: [], dist: 0, moving: 0, max: 0, start: Date.now(), lastT: 0,
      limits: route && route.limits || null, limit: null, cams: [], leanL: 0, leanR: 0, lean: 0 });
    if (OR.resetLean) OR.resetLean();
    if (route) loadRideData(route);
    OR.setData('done', null); OR.setData('track', null);
    OR.startGps(); screenOn(true);
    if (A && A.rideStart) A.rideStart(route ? route.name : 'Free ride');
    if (route) {
      OR.setData('route', { type: 'FeatureCollection', features: [OR.routeGeo(route)] }); OR.setData('alts', null);
      const m = route.man[0]; OR.say((m && m.pre) || 'Route started');
      ride.spoken[0] = 2;
    } else OR.say('Recording your ride');
    OR.emit('ridestart', route);
  };
  // Skip the next stop or via point and re-plan from here (needs a signal)
  OR.skipNextStop = async function () {
    const r = ride.route; if (!r || !OR.pos) return false;
    const at = w => { let best = 1e12, a = 0; for (let i = 0; i < r.shape.length - 1; i++) { const q = OR.projSeg([w.lng, w.lat], r.shape[i], r.shape[i + 1]); if (q.d < best) { best = q.d; a = r.cum[i] + q.t * (r.cum[i + 1] - r.cum[i]); } } return a; };
    const idx = r.wps.findIndex((w, i) => i > 0 && i < r.wps.length - 1 && at(w) > ride.along + 50);
    if (idx < 0) { OR.toast('There are no more stops before the destination'); return false; }
    const name = r.wps[idx].name;
    const copy = Object.assign({}, r, { wps: r.wps.filter((_, i) => i !== idx) });
    ride.rerouting = true; OR.emit('rerouting', true);
    try {
      const nr = await OR.rerouteFrom([OR.pos.lng, OR.pos.lat, OR.pos.heading], copy, ride.along);
      ride.route = nr; ride.seg = 0; ride.along = 0; ride.spoken = {}; ride.off = 0; ride.limits = null; ride.cams = [];
      OR.setData('route', { type: 'FeatureCollection', features: [OR.routeGeo(nr)] }); loadRideData(nr);
      OR.say('Skipped ' + (name || 'the next stop')); OR.emit('rerouted', nr); return true;
    } catch (e) { OR.toast('Could not skip: ' + e.message, 5000); return false; }
    finally { ride.rerouting = false; OR.emit('rerouting', false); }
  };

  // speed limits and (UK/Ireland only) speed cameras along the route, fetched once when the ride starts
  function loadRideData(route) {
    if (!OR.online()) return;
    if (!ride.limits && OR.speedLimits) OR.speedLimits(route).then(l => { if (ride.route === route) { ride.limits = l; route.limits = l; } }).catch(() => { });
    if (OR.camerasAlong && OR.cfg.cameras !== false) OR.camerasAlong(route).then(c => { if (ride.route === route) ride.cams = c; }).catch(() => { });
  }
  OR.stopRide = function () {
    if (!ride.on) return null;
    OR.pullNativeTrack();
    ride.on = false; screenOn(false); OR.hush();
    if (A && A.rideStop) A.rideStop();
    OR.store.set('rideInProgress', null);
    let saved = null;
    if (ride.pts.length > 5 && ride.dist > 200) {
      saved = { id: OR.uid(), start: ride.start, end: Date.now(), dist: ride.dist, moving: ride.moving, max: ride.max, leanL: Math.round(ride.leanL), leanR: Math.round(ride.leanR),
        name: ride.route ? ride.route.name : 'Ride on ' + new Date(ride.start).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
        pts: OR.encodePoly(ride.pts, 6), t0: ride.times[0], dt: ride.times.map((t, i) => i ? Math.round((t - ride.times[i - 1]) / 1000) : 0) };
      OR.rides.add(saved);
      OR.cfg.fuelSince = (OR.cfg.fuelSince || 0) + ride.dist; OR.saveCfg();
    }
    OR.setData('done', null); OR.setData('track', null);
    OR.map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
    OR.emit('ridestop', saved);
    return saved;
  };
  // a ride that was cut short (app closed, battery) is saved on next start
  OR.recoverRide = function () {
    const r = OR.store.get('rideInProgress', null); if (!r || !r.pts) return;
    OR.store.set('rideInProgress', null);
    if (r.dist < 200) return;
    const pts = OR.decodePoly(r.pts, 6);
    OR.rides.add({ id: OR.uid(), start: r.start, end: r.times[r.times.length - 1], dist: r.dist, moving: r.moving, max: r.max, name: (r.name || 'Ride') + ' (recovered)',
      pts: r.pts, t0: r.times[0], dt: r.times.map((t, i) => i ? Math.round((t - r.times[i - 1]) / 1000) : 0) });
    OR.toast('A ride that was not finished has been saved to Rides (' + OR.fmtDist(r.dist) + ', ' + pts.length + ' points)', 6000);
  };

  OR.rides = {
    list: () => OR.store.get('rides', []),
    add(r) { const l = OR.rides.list(); l.unshift(r); OR.store.set('rides', l.slice(0, 500)); },
    del(id) { OR.store.set('rides', OR.rides.list().filter(r => r.id !== id)); },
    get(id) { return OR.rides.list().find(r => r.id === id); },
    pts(r) { return OR.decodePoly(r.pts, 6); },
    times(r) { const t = []; let c = r.t0; r.dt.forEach((d, i) => { c = i ? c + d * 1000 : r.t0; t.push(c); }); return t; }
  };

  // ---------- manoeuvre arrows ----------
  const P = {
    straight: 'M24 42 V10 M14 20 L24 8 L34 20',
    slightR: 'M18 42 V28 Q18 20 26 14 L32 10 M24 8 H34 V18', slightL: 'M30 42 V28 Q30 20 22 14 L16 10 M24 8 H14 V18',
    right: 'M16 42 V24 Q16 16 24 16 H38 M30 8 L38 16 L30 24', left: 'M32 42 V24 Q32 16 24 16 H10 M18 8 L10 16 L18 24',
    sharpR: 'M14 42 V14 L34 34 M34 22 V34 H22', sharpL: 'M34 42 V14 L14 34 M14 22 V34 H26',
    uturn: 'M30 42 V18 Q30 8 21 8 Q12 8 12 18 V30 M5 23 L12 31 L19 23',
    round: 'M24 42 V32 M24 32 A8 8 0 1 1 30 18 L36 10 M28 9 H37 V18',
    flag: 'M14 42 V8 M14 9 H34 L29 16 L34 23 H14',
    ferry: 'M8 30 H40 L35 38 H13 Z M14 30 V20 H34 V30 M24 20 V12',
    merge: 'M16 42 Q16 28 24 20 V8 M32 42 Q32 28 24 20 M14 18 L24 7 L34 18'
  };
  OR.arrow = function (type) {
    const t = +type; let p = P.straight;
    if ([4, 5, 6].includes(t)) p = P.flag;
    else if ([9, 18, 20, 23, 37].includes(t)) p = P.slightR;
    else if ([16, 19, 21, 24, 38].includes(t)) p = P.slightL;
    else if ([10, 2].includes(t)) p = P.right; else if ([15, 3].includes(t)) p = P.left;
    else if (t === 11) p = P.sharpR; else if (t === 14) p = P.sharpL;
    else if (t === 12 || t === 13) p = P.uturn;
    else if (t === 26 || t === 27) p = P.round;
    else if (t === 28 || t === 29) p = P.ferry;
    else if (t === 25) p = P.merge;
    return '<svg viewBox="0 0 48 48" class="arrow"><path d="' + p + '"/></svg>';
  };
})(window.OR);
