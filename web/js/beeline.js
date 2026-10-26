/* OpenRoad to Beeline Moto II. The Moto II only takes routes from Beeline's own app, which imports GPX files
   (up to 4 MB; turn-by-turn routes under 1,500 km). This builds a GPX that suits it and hands it to the Beeline app. */
'use strict';
(function (OR) {
  const xe = s => String(s || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
  const ll = p => 'lat="' + p[1].toFixed(6) + '" lon="' + p[0].toFixed(6) + '"';
  const MAX_KM = 1400; // under Beeline's 1,500 km with room for its map matching
  // one GPX: the exact line as a track (Beeline uses the track first), and your stops as waypoints and a route
  function gpx(name, shape, stops) {
    const pts = OR.resample(shape, 40); // every 40 m keeps a long day well under 4 MB
    let g = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="OpenRoad" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>' + xe(name) + '</name></metadata>\n';
    stops.forEach(w => { g += '<wpt ' + ll([w.lng, w.lat]) + '><name>' + xe(w.name || 'Stop') + '</name></wpt>\n'; });
    if (stops.length >= 2) { g += '<rte><name>' + xe(name) + '</name>\n'; stops.forEach(w => { g += '<rtept ' + ll([w.lng, w.lat]) + '><name>' + xe(w.name || '') + '</name></rtept>\n'; }); g += '</rte>\n'; }
    g += '<trk><name>' + xe(name) + '</name><trkseg>\n'; pts.forEach(p => { g += '<trkpt ' + ll(p) + '/>\n'; }); g += '</trkseg></trk>\n</gpx>\n';
    return g;
  }
  // long routes are cut into parts at a stop near each 1,400 km, or at the 1,400 km point if there's no stop near it
  OR.beelineFiles = function (r) {
    const cum = r.cum || OR.cumulative(r.shape), total = cum[cum.length - 1], parts = Math.ceil(total / (MAX_KM * 1000));
    const stops = (r.wps || []).map(w => { let best = 1e12, a = 0; for (let i = 0; i < r.shape.length - 1; i++) { const q = OR.projSeg([w.lng, w.lat], r.shape[i], r.shape[i + 1]); if (q.d < best) { best = q.d; a = cum[i] + q.t * (cum[i + 1] - cum[i]); } } return Object.assign({ at: a }, w); });
    if (parts <= 1) return [{ name: r.name, text: gpx(r.name, r.shape, stops) }];
    const out = []; let from = 0;
    for (let k = 1; k <= parts; k++) {
      let to = k === parts ? total : total * k / parts;
      const near = stops.filter(s => Math.abs(s.at - to) < 60000).sort((a, b) => Math.abs(a.at - to) - Math.abs(b.at - to))[0]; if (near && k < parts) to = near.at;
      const i0 = cum.findIndex(c => c >= from), i1 = Math.max(i0 + 1, cum.findIndex(c => c >= to) < 0 ? cum.length - 1 : cum.findIndex(c => c >= to));
      const name = r.name + ' (part ' + k + ' of ' + parts + ')';
      out.push({ name, text: gpx(name, r.shape.slice(i0, i1 + 1), stops.filter(s => s.at >= from - 50 && s.at <= to + 50)) });
      from = to;
    }
    return out;
  };
  OR.sendToBeeline = function (r) {
    if (!r || !r.shape) return OR.toast('Plan a route first');
    const files = OR.beelineFiles(r), A = OR.native;
    const go = f => {
      const fname = OR.fileName(f.name) + '.gpx';
      if (A && A.openGpx) A.openGpx(fname, f.text);
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([f.text], { type: 'application/gpx+xml' })); a.download = fname; document.body.appendChild(a); a.click(); a.remove(); }
    };
    const help = '<p class="small">Choose <b>Beeline</b> when Android asks which app to open it with, then pick a mode:</p><ul class="small"><li><b>Turn-by-turn</b>: Beeline matches the line to its roads and gives turn arrows. Best for most rides.</li><li><b>Breadcrumb</b>: your exact line, with distance to the next turn but no arrows. Use it if Beeline changes the route.</li><li><b>Waypoints only</b>: Beeline plans its own way between your stops.</li></ul><p class="small muted">Beeline needs app version 4.2.5277 or later on Android. The Moto II must be paired in the Beeline app.</p>';
    if (files.length === 1) { go(files[0]); OR.sheet('<h2>' + OR.ic('share') + 'Sent to Beeline</h2>' + help); return; }
    OR.sheet('<h2>' + OR.ic('share') + 'Send to Beeline</h2><p>This route is ' + OR.fmtDist(r.dist) + ', longer than Beeline takes in one go (1,500 km), so it\'s in ' + files.length + ' parts. Send part 1 now, and the next when you get there.</p><div class="list">' +
      files.map((f, i) => '<button class="li" data-bp="' + i + '"><b>' + OR.esc(f.name) + '</b></button>').join('') + '</div>' + help, b => {
      b.querySelectorAll('[data-bp]').forEach(x => x.onclick = () => go(files[+x.dataset.bp]));
    });
  };
})(window.OR);
