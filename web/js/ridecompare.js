/* OpenRoad same road, last time: finds the roads this ride shares with your earlier rides (at least 1 mile in a row)
   and compares how you rode them: time, average speed and top speed, on the very same stretch. Rides are matched
   by position, so a different day or a different direction of travel on the road counts as the same road. */
'use strict';
(function (OR) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const CELL = 0.0006, NEAR = 35, MINLEN = 1609; // grid size in degrees (~60 m), how close counts as the same road, shortest stretch
  const key = (lng, lat) => Math.floor(lng / CELL) + ',' + Math.floor(lat / CELL);

  function index(pts) { const g = new Map(); pts.forEach((p, i) => { const k = key(p[0], p[1]); (g.get(k) || g.set(k, []).get(k)).push(i); }); return g; }
  function nearest(g, pts, p) {
    const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL); let best = null, bd = NEAR;
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) { const l = g.get(x + ',' + y); if (l) for (const i of l) { const d = OR.dist(p, pts[i]); if (d < bd) { bd = d; best = i; } } }
    return best;
  }
  const speeds = (pts, t) => { const v = [0]; for (let i = 1; i < pts.length; i++) { const dt = (t[i] - t[i - 1]) / 1000; v.push(dt > 0 && dt < 60 ? OR.dist(pts[i - 1], pts[i]) / dt : 0); } return v; };

  // the stretches of ride A that ride B also covered
  function shared(a, b) {
    const ap = OR.rides.pts(a), at = OR.rides.times(a), bp = OR.rides.pts(b), bt = OR.rides.times(b), g = index(bp), out = [];
    let cur = null;
    for (let i = 0; i < ap.length; i++) {
      const j = nearest(g, bp, ap[i]);
      if (j != null && (!cur || Math.abs(j - cur.lastJ) <= 12)) { if (!cur) cur = { i0: i, j0: j, i1: i, j1: j, lastJ: j }; cur.i1 = i; cur.j1 = j; cur.lastJ = j; }
      else { if (cur) out.push(cur); cur = j != null ? { i0: i, j0: j, i1: i, j1: j, lastJ: j } : null; }
    }
    if (cur) out.push(cur);
    const va = speeds(ap, at), vb = speeds(bp, bt);
    return out.map(s => {
      const lo = Math.min(s.j0, s.j1), hi = Math.max(s.j0, s.j1);
      let da = 0; for (let i = s.i0 + 1; i <= s.i1; i++) da += OR.dist(ap[i - 1], ap[i]);
      if (da < MINLEN) return null;
      const ta = (at[s.i1] - at[s.i0]) / 1000, tb = (bt[hi] - bt[lo]) / 1000; if (ta < 30 || tb < 30) return null;
      let db = 0; for (let i = lo + 1; i <= hi; i++) db += OR.dist(bp[i - 1], bp[i]);
      if (db < da * 0.6 || db > da * 1.6) return null; // not really the same road
      const max = (v, x, y) => { let m = 0; for (let i = x; i <= y; i++) m = Math.max(m, v[i]); return m; };
      return { dist: da, ta, tb, avgA: da / ta, avgB: db / tb, maxA: max(va, s.i0, s.i1), maxB: max(vb, lo, hi), mid: ap[Math.floor((s.i0 + s.i1) / 2)] };
    }).filter(Boolean);
  }

  OR.rideCompare = function (r) {
    const others = OR.rides.list().filter(x => x.id !== r.id && x.end && x.dist > 3000 && x.start < r.start).slice(0, 40);
    let best = null;
    for (const o of others) {
      let s = []; try { s = shared(r, o); } catch (e) { }
      const total = s.reduce((t, x) => t + x.dist, 0);
      if (total > 0 && (!best || total > best.total)) best = { o, s, total };
    }
    const sp = v => OR.speed(v) + ' ' + OR.speedUnit();
    if (!best) { OR.sheet('<h2>' + OR.ic('lean') + 'Same road, last time</h2><p>None of your earlier rides share a mile or more of road with this one.</p>'); return; }
    const when = new Date(best.o.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const rows = best.s.slice(0, 6).map(x => {
      const d = x.avgA - x.avgB, f = OR.speed(Math.abs(d)), word = Math.abs(d) < 0.5 ? 'about the same' : f + ' ' + OR.speedUnit() + (d > 0 ? ' faster' : ' slower');
      const dt = Math.round(x.ta - x.tb), tw = Math.abs(dt) < 5 ? 'the same time' : OR.fmtTime(Math.abs(dt)) + (dt < 0 ? ' quicker' : ' longer');
      return '<div class="optcard cmp"><div class="opt-row"><span><b>' + OR.fmtDist(x.dist) + ' of the same road</b><small>' + word + ', ' + tw + '</small></span></div>' +
        '<div class="cmp-grid"><span></span><b>This ride</b><b>' + esc(when) + '</b><span>Average</span><i>' + sp(x.avgA) + '</i><i>' + sp(x.avgB) + '</i><span>Top speed</span><i>' + sp(x.maxA) + '</i><i>' + sp(x.maxB) + '</i><span>Time</span><i>' + OR.fmtTime(x.ta) + '</i><i>' + OR.fmtTime(x.tb) + '</i></div></div>';
    }).join('');
    OR.sheet('<h2>' + OR.ic('lean') + 'Same road, last time</h2><p class="small">Compared with <b>' + esc(best.o.name) + '</b> (' + esc(when) + '), the earlier ride that shares the most road with this one. Same stretch of road, measured the same way.</p>' + rows +
      '<p class="small muted">Speeds are from your phone\'s GPS. Traffic, weather and stops all change a time, so use it as a guide to your riding, not a race.</p>');
  };
})(window.OR);
