/* OpenRoad wind on your route: from the forecast at each point along it, how much of the wind is in your face or
   behind you and how much hits you from the side. Strong gusts from the side are what push a bike about on open
   moor and bridges. For a round trip it says which way round puts the headwind on the way out. */
'use strict';
(function (OR) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const rad = d => d * Math.PI / 180;
  // the way the road is heading at a distance along the route
  function headingAt(r, d) {
    const c = r.cum && r.cum.length === r.shape.length ? r.cum : OR.cumulative(r.shape);
    let i = 1; while (i < c.length - 1 && c[i] < d) i++;
    const a = Math.max(0, i - 2), b = Math.min(r.shape.length - 1, i + 1);
    return OR.bearing(r.shape[a], r.shape[b]);
  }
  // wind speed (mph) from the direction it comes FROM, against the way we are heading
  const parts = (speed, from, heading) => { const diff = rad(from - heading); return { head: speed * Math.cos(diff), cross: Math.abs(speed * Math.sin(diff)) }; };

  OR.windSummary = function (r, w) {
    const pts = w.filter(x => x.dir != null && x.along != null && x.wind != null).map(x => {
      const h = headingAt(r, Math.min(x.along, r.dist - 1)), m = parts(x.wind, x.dir, h), g = parts(x.gust || x.wind, x.dir, h);
      return { x, along: x.along, head: m.head, cross: m.cross, gcross: g.cross, ghead: g.head };
    });
    if (pts.length < 2) return null;
    const worst = pts.reduce((a, b) => b.gcross > a.gcross ? b : a);
    const meanHead = pts.reduce((s, p) => s + p.head, 0) / pts.length;
    const loop = OR.dist(r.shape[0], r.shape[r.shape.length - 1]) < 1500;
    let advice = null;
    if (loop) {
      const half = r.dist / 2, a = pts.filter(p => p.along <= half), b = pts.filter(p => p.along > half);
      if (a.length && b.length) {
        const ma = a.reduce((s, p) => s + p.head, 0) / a.length, mb = b.reduce((s, p) => s + p.head, 0) / b.length;
        // headwind first (positive head), tailwind home: better when the first half is the windier one
        if (mb - ma > 6) advice = 'Ridden this way round you have the wind behind you early and in your face on the way home. The other way round would put the headwind first.';
      }
    }
    return { worst, meanHead, advice, strong: pts.filter(p => p.gcross >= 25), pts };
  };

  OR.windHtml = function (r, w) {
    let s; try { s = OR.windSummary(r, w); } catch (e) { return ''; }
    if (!s) return '';
    const worst = s.worst, bits = [];
    const hw = Math.abs(s.meanHead);
    if (hw >= 8) bits.push((s.meanHead > 0 ? 'Mostly headwind' : 'Mostly tailwind') + ' (about ' + Math.round(hw) + ' mph)');
    else bits.push('Wind mostly from the side or light');
    let cls = 'wxs-ok';
    if (worst.gcross >= 25) {
      cls = 'wxs-warn';
      bits.push('Strong crosswind gusts, up to ' + Math.round(worst.gcross) + ' mph, around ' + OR.clock(new Date(worst.x.at)) + ', ' + OR.fmtDist(worst.along) + ' in. Expect to be pushed about on open or exposed roads and bridges');
    } else if (worst.gcross >= 15) bits.push('Side gusts to about ' + Math.round(worst.gcross) + ' mph');
    return '<p class="' + cls + ' windline">' + OR.ic('wind') + esc(bits.join('. ')) + '.</p>' + (s.advice ? '<p class="small muted">' + esc(s.advice) + '</p>' : '');
  };
})(window.OR);
