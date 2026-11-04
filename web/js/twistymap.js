/* OpenRoad bendy roads on the whole map: Map button, "Show twisty roads". Roads are coloured by how much they bend,
   violet for bendy and magenta for very bendy, worked out on the phone from the map's own road lines (the same
   measure as Top rides and the route cards, degrees turned per mile). It works with the downloaded map packs and
   online, and it only looks at what is on screen, from zoom 9. */
'use strict';
(function (OR) {
  const MI = 1609.344, BLOCK = 500, STEP = 30;
  const CLASSES = ['trunk', 'primary', 'secondary', 'tertiary', 'unclassified'];
  let timer = 0, busy = false, shown = '';
  OR.twistyOn = () => !!OR.cfg.twistyMap;

  // a line resampled to a point about every STEP metres
  function resample(pts) {
    const out = [pts[0]]; let acc = 0, last = pts[0];
    for (let i = 1; i < pts.length; i++) {
      let a = last, b = pts[i], d = OR.dist(a, b);
      while (acc + d >= STEP) {
        const t = (STEP - acc) / d; a = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; out.push(a); d = OR.dist(a, b); acc = 0;
      }
      acc += d; last = b;
    }
    if (OR.dist(out[out.length - 1], pts[pts.length - 1]) > 8) out.push(pts[pts.length - 1]);
    return out;
  }
  // the bendy stretches of one line: [{k, pts}]
  function bendy(line) {
    if (line.length < 3) return [];
    const p = resample(line); if (p.length < 8) return [];
    const turn = [0]; for (let i = 1; i < p.length - 1; i++) { const d = OR.angDiff(OR.bearing(p[i - 1], p[i]), OR.bearing(p[i], p[i + 1])); turn.push(d < 75 ? d : 0); } turn.push(0);
    const per = Math.max(2, Math.round(BLOCK / STEP)), out = [];
    for (let s = 0; s + per < p.length; s += per) {
      let t = 0; for (let i = s + 1; i < s + per; i++) t += turn[i];
      const dpm = t / ((per * STEP) / MI), k = dpm >= 170 ? 2 : dpm >= 110 ? 1 : 0;
      if (!k) continue;
      const seg = p.slice(s, s + per + 1), prev = out[out.length - 1];
      if (prev && prev.k === k && prev.end === s) { prev.pts = prev.pts.concat(seg.slice(1)); prev.end = s + per; } else out.push({ k, pts: seg, end: s + per });
    }
    return out;
  }

  function refresh() {
    const m = OR.map; if (!m || !m.isStyleLoaded()) return;
    if (!OR.twistyOn() || m.getZoom() < 9 || (OR.ride && OR.ride.on && OR.ride.follow)) { if (shown) { shown = ''; OR.setData('twmap', null); } return; }
    if (busy) return; busy = true;
    try {
      const fs = m.querySourceFeatures('omt', { sourceLayer: 'transportation', filter: ['in', ['get', 'class'], ['literal', CLASSES]] });
      const seen = new Set(), feats = [];
      for (const f of fs) {
        if (feats.length > 5000) break;
        const g = f.geometry; if (!g) continue;
        const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
        for (const ln of lines) {
          const key = ln.length + ':' + ln[0][0].toFixed(5) + ',' + ln[0][1].toFixed(5) + ':' + ln[ln.length - 1][0].toFixed(5); // the same road piece seen in two tiles
          if (seen.has(key)) continue; seen.add(key);
          for (const b of bendy(ln)) feats.push({ type: 'Feature', properties: { k: b.k }, geometry: { type: 'LineString', coordinates: b.pts } });
        }
      }
      shown = 'on'; OR.setData('twmap', { type: 'FeatureCollection', features: feats });
    } catch (e) { console.warn('twisty map', e); } finally { busy = false; }
  }
  const later = () => { clearTimeout(timer); timer = setTimeout(refresh, 450); };
  OR.twistyRefresh = () => { later(); };
  OR.twistyToggle = on => { OR.cfg.twistyMap = on; OR.saveCfg(); if (!on) { shown = ''; OR.setData('twmap', null); } else { later(); if (OR.map && OR.map.getZoom() < 9) OR.toast('Zoom in a little to see the bendy roads', 4000); } };
  OR.twistyMapStart = () => { if (!OR.map) return; OR.map.on('moveend', later); OR.map.on('sourcedata', e => { if (e.sourceId === 'omt' && e.isSourceLoaded && OR.twistyOn()) later(); }); later(); };
  OR.twistyBendy = bendy; // for tests
})(window.OR);
