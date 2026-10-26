/* OpenRoad riding better: race your best run (ghost rider), a corner-by-corner look at a ride (corner coach),
   and a map of the rough roads the phone felt you ride over. */
'use strict';
(function (OR) {
  const $ = OR.$, $$ = OR.$$, esc = OR.esc, ic = (n, c) => OR.ic(n, c), A = OR.native, G = 9.81;

  // distance along a route for each point of a track (null when it's off the route)
  function project(route, pts) {
    const s = route.shape, n = s.length, out = []; let i0 = 0;
    for (const p of pts) {
      let best = { d: 1e12, i: 0, t: 0 };
      for (let i = Math.max(0, i0 - 50); i < Math.min(n - 1, i0 + 400); i++) { const r = OR.projSeg(p, s[i], s[i + 1]); if (r.d < best.d) best = { d: r.d, i, t: r.t }; }
      if (best.d > 120) { out.push(null); continue; }
      i0 = best.i; out.push(route.cum[best.i] + best.t * (route.cum[best.i + 1] - route.cum[best.i]));
    }
    return out;
  }

  // ---------- ghost rider ----------
  let ghost = null, ghostMk = null, lastGhostSay = 0;
  // your fastest earlier ride of the same route (same start and finish, about the same length, mostly on it)
  OR.findGhost = function (route) {
    const st = route.shape[0], en = route.shape[route.shape.length - 1];
    let best = null;
    for (const r of OR.rides.list()) {
      if (!r.pts || !r.t0 || Math.abs(r.dist - route.dist) > route.dist * 0.2) continue;
      const pts = OR.rides.pts(r); if (pts.length < 20) continue;
      if (OR.dist(pts[0], st) > 400 || OR.dist(pts[pts.length - 1], en) > 400) continue;
      const along = project(route, pts), on = along.filter(a => a != null).length / along.length;
      if (on < 0.85) continue;
      const times = OR.rides.times(r), dur = times[times.length - 1] - times[0];
      if (!best || dur < best.dur) best = { ride: r, along, times, dur };
    }
    return best;
  };
  // where the ghost was this long into its ride, and how long it took to reach a given distance
  const ghostAlongAt = (g, ms) => { const t = g.times[0] + ms; let a = 0; for (let i = 0; i < g.times.length; i++) { if (g.times[i] > t) break; if (g.along[i] != null) a = Math.max(a, g.along[i]); } return a; };
  const ghostTimeTo = (g, along) => { for (let i = 0; i < g.times.length; i++) if (g.along[i] != null && g.along[i] >= along) return g.times[i] - g.times[0]; return null; };
  OR.on('ridestart', route => {
    ghost = null; if (ghostMk) { ghostMk.remove(); ghostMk = null; }
    if (!route || OR.cfg.ghost === false) return;
    setTimeout(() => {
      const g = OR.findGhost(route); if (!g) return;
      ghost = g;
      const el = document.createElement('div'); el.className = 'ghost-dot'; el.innerHTML = ic('moto');
      ghostMk = new maplibregl.Marker({ element: el }).setLngLat(route.shape[0]).addTo(OR.map);
      OR.say('Racing your best run of this route, from ' + new Date(g.ride.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) + '.');
    }, 1500);
  });
  OR.ghostGap = function () {
    if (!ghost || !OR.ride.on || !OR.ride.route) return null;
    const elapsed = Date.now() - OR.ride.start, t = ghostTimeTo(ghost, OR.ride.along);
    return t == null ? null : (t - elapsed) / 1000; // positive: you're ahead of your best
  };
  OR.on('ride', e => {
    if (!ghost || !ghostMk || e.free) return;
    const r = OR.ride.route, a = ghostAlongAt(ghost, Date.now() - OR.ride.start);
    let i = 1; while (i < r.cum.length - 1 && r.cum[i] < a) i++;
    ghostMk.setLngLat(r.shape[i]);
    const gap = OR.ghostGap(); let chip = $('#ghostChip');
    if (gap == null) { if (chip) chip.remove(); return; }
    if (!chip) { chip = document.createElement('div'); chip.id = 'ghostChip'; $('#hud').appendChild(chip); }
    const s = Math.round(Math.abs(gap)), txt = s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s';
    chip.className = gap >= 0 ? 'ahead' : 'behind';
    chip.innerHTML = ic('moto') + '<b>' + (Math.abs(gap) < 3 ? 'Level with your best' : txt + (gap >= 0 ? ' ahead' : ' behind')) + '</b>';
    if (Date.now() - lastGhostSay > 15 * 60000 && OR.ride.along > 2000) { lastGhostSay = Date.now(); const mm = Math.floor(s / 60), ss = s % 60, spoken = (mm ? mm + (mm === 1 ? ' minute' : ' minutes') + (ss ? ' ' : '') : '') + (ss || !mm ? ss + (ss === 1 ? ' second' : ' seconds') : ''); OR.say(Math.abs(gap) < 3 ? 'Level with your best run.' : 'You\'re ' + spoken + (gap >= 0 ? ' ahead of' : ' behind') + ' your best run.'); }
  });
  OR.on('arrived', () => { const g = OR.ghostGap(); if (g != null) OR.say(Math.abs(g) < 3 ? 'Same time as your best run.' : g > 0 ? 'New best! ' + Math.round(g) + ' seconds quicker than before.' : Math.round(-g) + ' seconds slower than your best.'); });
  OR.on('ridestop', () => { ghost = null; if (ghostMk) { ghostMk.remove(); ghostMk = null; } const c = $('#ghostChip'); if (c) c.remove(); });

  // ---------- corner coach ----------
  // Bends found from the track, with speed in, at the middle and out, and the lean estimate there.
  OR.corners = function (r) {
    const raw = OR.rides.pts(r), times = OR.rides.times(r); if (raw.length < 30) return [];
    // speed at each point, from distance over time (averaged over neighbours, GPS is noisy)
    const cum = OR.cumulative(raw), v = raw.map((_, i) => { const a = Math.max(0, i - 2), b = Math.min(raw.length - 1, i + 2); const dt = (times[b] - times[a]) / 1000; return dt > 0 ? (cum[b] - cum[a]) / dt : 0; });
    // every 15 m along the track, with heading
    const step = 15, P = []; let j = 0;
    for (let d = 0; d < cum[cum.length - 1]; d += step) {
      while (j < cum.length - 2 && cum[j + 1] < d) j++;
      const k = cum[j + 1] > cum[j] ? (d - cum[j]) / (cum[j + 1] - cum[j]) : 0;
      P.push({ p: [raw[j][0] + (raw[j + 1][0] - raw[j][0]) * k, raw[j][1] + (raw[j + 1][1] - raw[j][1]) * k], d, v: v[j] + (v[j + 1] - v[j]) * k, t: times[j] + (times[j + 1] - times[j]) * k });
    }
    for (let i = 1; i < P.length; i++) P[i].h = OR.bearing(P[i - 1].p, P[i].p); P[0].h = P[1] ? P[1].h : 0;
    const turn = i => { if (i < 1) return 0; let d = P[i].h - P[i - 1].h; d = ((d + 540) % 360) - 180; return d; };
    // total turn over about 120 m around each point
    const W = 4, tw = P.map((_, i) => { let s = 0; for (let k = Math.max(1, i - W); k <= Math.min(P.length - 1, i + W); k++) s += turn(k); return s; });
    const out = [];
    for (let i = W; i < P.length - W; i++) {
      if (Math.abs(tw[i]) < 30 || Math.abs(tw[i]) < Math.abs(tw[i - 1]) || Math.abs(tw[i]) < Math.abs(tw[i + 1])) continue;
      if (P[i].v < 6) continue; // under about 13 mph: junctions and roundabouts, not bends
      if (out.length && i - out[out.length - 1].i < W * 2) continue;
      const seg = (a, b) => P.slice(Math.max(0, i + a), Math.min(P.length, i + b + 1)).map(x => x.v);
      const vin = Math.max(...seg(-10, -4)), vmid = Math.min(...seg(-1, 1)), vout = Math.max(...seg(4, 8));
      const after = Math.min(...seg(1, 4));
      const w = (tw[i] * Math.PI / 180) / Math.max(1, (P[Math.min(P.length - 1, i + W)].t - P[Math.max(0, i - W)].t) / 1000);
      const lean = Math.min(55, Math.round(Math.atan(Math.abs(P[i].v * w) / G) * 180 / Math.PI));
      out.push({ i, p: P[i].p, at: P[i].d, dir: tw[i] > 0 ? 'right' : 'left', angle: Math.round(Math.abs(tw[i])), vin, vmid, vout, lean,
        midBrake: after < vmid - 1.5,            // still slowing after the middle of the bend
        drive: vout - vmid,                      // speed picked up on the way out
        scrub: vin > 0 ? (vin - vmid) / vin : 0  // how much speed went in the bend
      });
    }
    // smooth: steady through the middle and driving out; hesitant: still braking after the middle, or lost a lot of speed
    out.forEach(c => { c.score = Math.round(100 - (c.midBrake ? 35 : 0) - Math.min(40, c.scrub * 100) + Math.min(15, c.drive * 2)); });
    return out;
  };
  const LEAN_COLOR = ['interpolate', ['linear'], ['get', 'lean'], 0, '#2e7d32', 15, '#9ccc65', 25, '#f5c518', 35, '#ef6c00', 45, '#c62828'];
  function showCoach(r, cs) {
    const pts = OR.rides.pts(r), times = OR.rides.times(r), feats = [];
    for (let i = 1; i < pts.length; i++) {
      const dt = (times[i] - times[i - 1]) / 1000, a = i > 1 ? OR.angDiff(OR.bearing(pts[i - 2], pts[i - 1]), OR.bearing(pts[i - 1], pts[i])) : 0, v = dt > 0 ? OR.dist(pts[i - 1], pts[i]) / dt : 0;
      const lean = dt > 0 ? Math.min(55, Math.atan(v * (a * Math.PI / 180 / dt) / G) * 180 / Math.PI) : 0;
      feats.push({ type: 'Feature', properties: { lean: Math.round(lean) }, geometry: { type: 'LineString', coordinates: [pts[i - 1], pts[i]] } });
    }
    const m = OR.map;
    if (!m.getSource('coach')) {
      m.addSource('coach', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'coach', type: 'line', source: 'coach', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': LEAN_COLOR, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 15, 8] } });
      m.addSource('coachpts', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'coachpts', type: 'circle', source: 'coachpts', paint: { 'circle-radius': 11, 'circle-color': ['case', ['get', 'good'], '#0e9f57', '#ef6c00'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
      m.addLayer({ id: 'coachnum', type: 'symbol', source: 'coachpts', layout: { 'text-field': ['get', 'n'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': true }, paint: { 'text-color': '#fff' } });
    }
    m.getSource('coach').setData({ type: 'FeatureCollection', features: feats });
    m.getSource('coachpts').setData({ type: 'FeatureCollection', features: cs.map((c, i) => ({ type: 'Feature', properties: { n: String(i + 1), good: c.good }, geometry: { type: 'Point', coordinates: c.p } })) });
    m.fitBounds(OR.bbox(pts), { padding: 60, pitch: 0, bearing: 0 });
  }
  OR.clearCoach = () => { const m = OR.map; ['coachnum', 'coachpts', 'coach'].forEach(l => { if (m.getLayer(l)) m.removeLayer(l); }); ['coachpts', 'coach'].forEach(s => { if (m.getSource(s)) m.removeSource(s); }); };
  OR.on('style', () => OR.clearCoach());
  OR.cornerCoach = function (r) {
    const all = OR.corners(r);
    if (all.length < 3) return OR.toast('Not enough bends in this ride to look at', 5000);
    const sorted = all.slice().sort((a, b) => b.score - a.score), best = sorted.slice(0, 5).map(c => Object.assign(c, { good: true })), worst = sorted.slice(-5).reverse().filter(c => c.score < 85 && !best.includes(c));
    const shown = best.concat(worst);
    showCoach(r, shown);
    const mph = v => OR.speed(v), u = OR.speedUnit();
    const row = (c, i) => '<button class="li cc" data-c="' + i + '"><span class="ccn ' + (c.good ? 'g' : 'h') + '">' + (i + 1) + '</span><span><b>' + (c.dir === 'left' ? 'Left' : 'Right') + '-hander, ' + c.angle + '° · about ' + c.lean + '° lean</b><small>In ' + mph(c.vin) + ', middle ' + mph(c.vmid) + ', out ' + mph(c.vout) + ' ' + u + '. ' +
      (c.good ? (c.drive > 2 ? 'Steady through and drove out well.' : 'Steady through the middle.') : (c.midBrake ? 'Still slowing after the middle of the bend: try to finish braking before you turn in.' : 'Lost a lot of speed in the bend: look further through it and roll on earlier.')) + '</small></span></button>';
    const avgLean = Math.round(all.reduce((s, c) => s + c.lean, 0) / all.length);
    if (innerWidth < 900) $('#panel').classList.remove('open');
    OR.sheet('<h2>' + ic('lean') + 'Corner coach</h2><p class="small">' + all.length + ' bends in <b>' + esc(r.name) + '</b>. Average lean in bends about ' + avgLean + '°, most ' + Math.max(...all.map(c => c.lean)) + '°. The track on the map is coloured by lean: green upright, red leant over.</p>' +
      '<h3 class="gh">Smoothest</h3><div class="list">' + best.map(row).join('') + '</div>' +
      (worst.length ? '<h3 class="gh">Worth another look</h3><div class="list">' + worst.map((c, i) => row(c, best.length + i)).join('') + '</div>' : '') +
      '<p class="small muted">Worked out from GPS once a second, so treat it as a guide: it can\'t see your body position or the road surface.</p><button class="btn wide ghost" id="ccClose">Clear from the map</button>', b => {
      $$('[data-c]', b).forEach(x => x.onclick = () => { const c = shown[+x.dataset.c]; OR.closeSheet(); OR.map.flyTo({ center: c.p, zoom: 16 }); });
      $('#ccClose', b).onclick = () => { OR.clearCoach(); OR.closeSheet(); };
    });
  };

  // ---------- rough-road map ----------
  const roughList = () => OR.store.get('rough', []);
  OR.on('ridestop', saved => {
    if (!A || !A.rideJolts || !saved) return;
    try {
      const j = JSON.parse(A.rideJolts(String(saved.start - 1000)));
      if (j.length) { const l = roughList().concat(j.map(x => [+x[0].toFixed(5), +x[1].toFixed(5), x[2], x[4]])); OR.store.set('rough', l.slice(-5000)); }
    } catch (e) { }
  });
  OR.showRough = function (on) {
    const m = OR.map, l = roughList();
    if (!on) { if (m.getLayer('rough')) m.removeLayer('rough'); if (m.getSource('rough')) m.removeSource('rough'); return; }
    if (!l.length) return OR.toast('No rough roads recorded yet. They\'re logged while you record a ride in the Android app, with the phone in a mount.', 7000);
    const data = { type: 'FeatureCollection', features: l.map(x => ({ type: 'Feature', properties: { g: x[2] }, geometry: { type: 'Point', coordinates: [x[0], x[1]] } })) };
    if (m.getSource('rough')) m.getSource('rough').setData(data);
    else {
      m.addSource('rough', { type: 'geojson', data });
      m.addLayer({ id: 'rough', type: 'circle', source: 'rough', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 3, 15, 8], 'circle-color': ['interpolate', ['linear'], ['get', 'g'], 1.2, '#f5c518', 2, '#ef6c00', 3, '#c62828'], 'circle-opacity': 0.8, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
    }
    OR.toast(l.length + ' rough spots on the map. Red are the worst jolts.', 5000);
  };
  OR.roughOn = () => !!(OR.map && OR.map.getLayer('rough'));
})(window.OR);
