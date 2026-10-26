/* OpenRoad to Google Maps and Apple Maps. Both take a start, an end and points in between, and plan their own
   roads between those points. So we send your own stops, then fill the space left with points taken from
   OpenRoad's line (in the longest gaps first) so they keep to the roads you planned.
   Google Maps links take up to 9 points in between; Apple's unified Maps URLs (iOS 18.4 / macOS 15.4 and later)
   take repeated "waypoint" values, and we send the same 9. */
'use strict';
(function (OR) {
  const MAX_VIA = 9;
  const ll = p => p[1].toFixed(5) + ',' + p[0].toFixed(5);

  // the points to send: [start, ...via, end], each [lng, lat]
  OR.mapsPoints = function (r) {
    const shape = r.shape, cum = r.cum || OR.cumulative(shape), total = cum[cum.length - 1];
    const at = d => { let i = cum.findIndex(c => c >= d); if (i < 0) i = cum.length - 1; return i; };
    // where each of your inner stops falls along the line
    let stops = (r.wps || []).slice(1, -1).map(w => {
      let best = 1e12, a = 0; for (let i = 0; i < shape.length - 1; i++) { const q = OR.projSeg([w.lng, w.lat], shape[i], shape[i + 1]); if (q.d < best) { best = q.d; a = cum[i] + q.t * (cum[i + 1] - cum[i]); } }
      return { d: a, p: [w.lng, w.lat], own: true };
    }).sort((a, b) => a.d - b.d);
    let dropped = 0;
    if (stops.length > MAX_VIA) { // keep an even spread of your stops
      const keep = []; for (let k = 0; k < MAX_VIA; k++) keep.push(stops[Math.round(k * (stops.length - 1) / (MAX_VIA - 1))]);
      dropped = stops.length - MAX_VIA; stops = keep;
    }
    // fill the rest by splitting the longest stretch at its middle, a point on our own line
    const via = stops.slice();
    while (via.length < MAX_VIA && total > 3000) {
      const marks = [0].concat(via.map(v => v.d), [total]);
      let g = 0, len = 0; for (let k = 0; k < marks.length - 1; k++) if (marks[k + 1] - marks[k] > len) { len = marks[k + 1] - marks[k]; g = k; }
      if (len < 4000) break; // short gaps: Google and Apple will find the same road
      const d = (marks[g] + marks[g + 1]) / 2;
      via.push({ d, p: shape[at(d)], own: false }); via.sort((a, b) => a.d - b.d);
    }
    const first = r.wps && r.wps.length ? [r.wps[0].lng, r.wps[0].lat] : shape[0];
    const last = r.wps && r.wps.length > 1 ? [r.wps[r.wps.length - 1].lng, r.wps[r.wps.length - 1].lat] : shape[shape.length - 1];
    return { start: first, via: via.map(v => v.p), end: last, own: stops.length, dropped };
  };

  OR.googleMapsUrl = function (r) {
    const m = OR.mapsPoints(r);
    return 'https://www.google.com/maps/dir/?api=1&origin=' + ll(m.start) + '&destination=' + ll(m.end) +
      (m.via.length ? '&waypoints=' + m.via.map(ll).join('%7C') : '') + '&travelmode=driving';
  };
  OR.appleMapsUrl = function (r) {
    const m = OR.mapsPoints(r);
    return 'https://maps.apple.com/directions?source=' + ll(m.start) + '&destination=' + ll(m.end) +
      m.via.map(p => '&waypoint=' + ll(p)).join('') + '&mode=driving';
  };

  OR.shareToMaps = function (r) {
    if (!r || !r.shape || r.shape.length < 2) return OR.toast('Plan a route first');
    const m = OR.mapsPoints(r), g = OR.googleMapsUrl(r), a = OR.appleMapsUrl(r), name = r.name || 'Route', A = OR.native, ic = OR.ic;
    const text = (which, url) => name + ' (' + OR.fmtDist(r.dist) + ', about ' + OR.fmtTime(r.time) + ') in ' + which + ':\n' + url + '\nPlanned with OpenRoad';
    OR.sheet('<h2>' + ic('map') + 'Google Maps or Apple Maps</h2>' +
      '<p class="small">Sends your start and end with ' + m.via.length + ' point' + (m.via.length === 1 ? '' : 's') + ' in between: ' + (m.own ? m.own + ' of your stops and ' : '') + (m.via.length - m.own) + ' taken from OpenRoad\'s line, so Google and Apple follow the same roads.' +
      (m.dropped ? ' This route has more stops than Google and Apple take, so ' + m.dropped + ' were left out, keeping an even spread.' : '') + '</p>' +
      '<div class="list">' +
      '<button class="li" id="msGo"><b>' + ic('map') + ' Open in Google Maps</b><span>On this phone, to look at it or navigate</span></button>' +
      '<button class="li" id="msG"><b>' + ic('share') + ' Send a Google Maps link</b><span>Works on Android and iPhone</span></button>' +
      '<button class="li" id="msA"><b>' + ic('share') + ' Send an Apple Maps link</b><span>For friends on an iPhone (iOS 18.4 or later)</span></button>' +
      '<button class="li" id="msB"><b>' + ic('share') + ' Send both links</b><span>One message, they tap the one for their phone</span></button>' +
      '</div>' +
      '<p class="small muted">Google and Apple choose their own roads between the points, so short stretches can differ from OpenRoad\'s, and they won\'t warn about low-emission zones or bends. Google Maps links opened in a phone\'s web browser (not the app) only use the first 3 points in between.</p>', b => {
      b.querySelector('#msGo').onclick = () => { if (A && A.openUrl) A.openUrl(g); else window.open(g, '_blank'); };
      b.querySelector('#msG').onclick = () => OR.share(text('Google Maps', g), name);
      b.querySelector('#msA').onclick = () => OR.share(text('Apple Maps', a), name);
      b.querySelector('#msB').onclick = () => OR.share(name + ' (' + OR.fmtDist(r.dist) + ', about ' + OR.fmtTime(r.time) + ')\nGoogle Maps: ' + g + '\nApple Maps: ' + a + '\nPlanned with OpenRoad', name);
    });
  };
})(window.OR);
