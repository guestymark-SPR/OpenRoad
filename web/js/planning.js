/* OpenRoad route planning extras: low-emission zones on the route (and avoiding them), the hill profile,
   the rain radar layer and finding the bendiest roads near you. */
'use strict';
(function (OR) {
  const MI = 1609.344;

  // ---------- low-emission zones (OpenStreetMap boundary=low_emission_zone) ----------
  // join the outer ways of a relation into closed rings
  function rings(el) {
    if (el.type === 'way' && el.geometry) return [el.geometry.map(g => [g.lon, g.lat])];
    const ways = (el.members || []).filter(m => m.type === 'way' && m.role !== 'inner' && m.geometry).map(m => m.geometry.map(g => [g.lon, g.lat]));
    const out = [], same = (a, b) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
    while (ways.length) {
      let ring = ways.shift();
      let grew = true;
      while (!same(ring[0], ring[ring.length - 1]) && grew) {
        grew = false;
        for (let i = 0; i < ways.length; i++) {
          const w = ways[i], end = ring[ring.length - 1];
          if (same(end, w[0])) ring = ring.concat(w.slice(1));
          else if (same(end, w[w.length - 1])) ring = ring.concat(w.slice().reverse().slice(1));
          else if (same(ring[0], w[w.length - 1])) ring = w.concat(ring.slice(1));
          else if (same(ring[0], w[0])) ring = w.slice().reverse().concat(ring.slice(1));
          else continue;
          ways.splice(i, 1); grew = true; break;
        }
      }
      if (ring.length > 3) out.push(ring);
    }
    return out;
  }
  const inRing = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  OR.inZone = (p, z) => z.rings.some(r => inRing(p, r));
  // a simpler outline for asking the router to avoid it (at most about 120 points), slightly enlarged so the simplification doesn't cut corners
  function simplify(ring) {
    const step = Math.max(1, Math.ceil(ring.length / 120)), pts = ring.filter((_, i) => i % step === 0);
    const c = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);
    const out = pts.map(p => [+(c[0] + (p[0] - c[0]) * 1.03).toFixed(5), +(c[1] + (p[1] - c[1]) * 1.03).toFixed(5)]);
    out.push(out[0]); return out;
  }
  OR.zonesAlong = async function (route) {
    const bb = OR.bbox(route.shape), pad = 0.05;
    const q = '[out:json][timeout:60];(relation["boundary"="low_emission_zone"](' + [bb[0][1] - pad, bb[0][0] - pad, bb[1][1] + pad, bb[1][0] + pad].map(x => x.toFixed(4)).join(',') + ');' +
      'way["boundary"="low_emission_zone"](' + [bb[0][1] - pad, bb[0][0] - pad, bb[1][1] + pad, bb[1][0] + pad].map(x => x.toFixed(4)).join(',') + '););out geom;';
    const els = await OR.overpassRaw(q);
    const zones = els.map(el => ({ id: el.type + el.id, name: (el.tags || {}).name || 'Low-emission zone', tags: el.tags || {}, rings: rings(el) })).filter(z => z.rings.length);
    const sample = OR.resample(route.shape, 150);
    const start = route.shape[0], end = route.shape[route.shape.length - 1];
    return zones.map(z => {
      const hits = sample.filter(p => OR.inZone(p, z));
      return hits.length ? Object.assign(z, { km: hits.length * 0.15, startsIn: OR.inZone(start, z), endsIn: OR.inZone(end, z), outline: z.rings.map(simplify) }) : null;
    }).filter(Boolean);
  };
  // the zone's own notes, as mapped in OpenStreetMap
  OR.zoneNote = z => {
    const t = z.tags, bits = [];
    ['description', 'note', 'low_emission_zone:description', 'access:conditional', 'motorcycle:conditional'].forEach(k => { if (t[k]) bits.push(t[k]); });
    return bits.join('. ');
  };
  OR.zoneInfoUrl = 'https://urbanaccessregulations.eu/';

  // ---------- hill profile (Open-Meteo elevation, Copernicus DEM GLO-90) ----------
  OR.elevationAlong = async function (route) {
    const n = Math.min(400, Math.max(30, Math.round(route.dist / 400)));
    const pts = OR.resample(route.shape, route.dist / n);
    const heights = [];
    for (let i = 0; i < pts.length; i += 100) {
      const part = pts.slice(i, i + 100);
      const j = await OR.json('https://api.open-meteo.com/v1/elevation?latitude=' + part.map(p => p[1].toFixed(5)).join(',') + '&longitude=' + part.map(p => p[0].toFixed(5)).join(','));
      if (!j.elevation) throw new Error(j.reason || 'no elevation data');
      heights.push.apply(heights, j.elevation);
    }
    const cum = OR.cumulative(pts);
    // smooth a little so map noise doesn't add up to fake climbing
    const sm = heights.map((h, i) => { const a = heights.slice(Math.max(0, i - 1), i + 2); return a.reduce((x, y) => x + y, 0) / a.length; });
    let up = 0, down = 0, steep = 0, steepAt = 0;
    for (let i = 1; i < sm.length; i++) { const d = sm[i] - sm[i - 1]; if (d > 0) up += d; else down -= d; }
    // steepest stretch over about 500 m
    for (let i = 0, j = 0; i < sm.length; i++) {
      while (j < sm.length - 1 && cum[j] - cum[i] < 500) j++;
      if (cum[j] - cum[i] >= 300) { const g = Math.abs(sm[j] - sm[i]) / (cum[j] - cum[i]) * 100; if (g > steep) { steep = g; steepAt = cum[i]; } }
    }
    return { pts, cum, h: sm, up, down, max: Math.max.apply(null, sm), min: Math.min.apply(null, sm), steep, steepAt };
  };
  OR.fmtHeight = m => OR.cfg.units === 'km' ? Math.round(m).toLocaleString('en-GB') + ' m' : Math.round(m * 3.28084).toLocaleString('en-GB') + ' ft';
  OR.profileSvg = function (e, w, h) {
    w = w || 340; h = h || 90;
    const total = e.cum[e.cum.length - 1] || 1, lo = Math.floor(e.min / 50) * 50, hi = Math.max(lo + 100, Math.ceil(e.max / 50) * 50);
    const X = d => (d / total * w).toFixed(1), Y = v => (h - 4 - (v - lo) / (hi - lo) * (h - 14)).toFixed(1);
    const line = e.h.map((v, i) => X(e.cum[i]) + ',' + Y(v)).join(' ');
    return '<svg class="prof" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" role="img" aria-label="Height along the route">' +
      '<polygon points="0,' + h + ' ' + line + ' ' + w + ',' + h + '" class="pf"/><polyline points="' + line + '" class="pl"/>' +
      '<text x="3" y="11" class="pt">' + OR.fmtHeight(hi) + '</text><text x="3" y="' + (h - 6) + '" class="pt">' + OR.fmtHeight(lo) + '</text></svg>';
  };

  // ---------- rain radar (RainViewer, free for personal use: the last 2 hours, up to zoom 7) ----------
  let frames = [], frameAt = -1, playTimer = null;
  OR.radar = {
    get frames() { return frames; }, get at() { return frameAt; },
    async load() {
      const j = await OR.json('https://api.rainviewer.com/public/weather-maps.json?t=' + Date.now());
      frames = ((j.radar && j.radar.past) || []).map(f => ({ time: f.time * 1000, url: j.host + f.path + '/256/{z}/{x}/{y}/2/1_1.png' }));
      if (!frames.length) throw new Error('no radar pictures available');
      return frames;
    },
    show(i) {
      const m = OR.map; if (!m || !frames.length) return;
      frameAt = i == null ? frames.length - 1 : i;
      const f = frames[frameAt], id = 'radar';
      if (m.getLayer(id)) m.removeLayer(id);
      if (m.getSource(id)) m.removeSource(id);
      m.addSource(id, { type: 'raster', tiles: [f.url], tileSize: 256, maxzoom: 7, attribution: 'Radar <a href="https://www.rainviewer.com/">RainViewer</a>' });
      const before = m.getLayer('ov-alts') ? 'ov-alts' : undefined;
      m.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0.7, 'raster-fade-duration': 0 } }, before);
      OR.emit('radar', f);
    },
    hide() { const m = OR.map; this.stop(); frameAt = -1; if (m.getLayer('radar')) m.removeLayer('radar'); if (m.getSource('radar')) m.removeSource('radar'); OR.emit('radar', null); },
    play() {
      this.stop(); let i = 0;
      playTimer = setInterval(() => { this.show(i); i++; if (i >= frames.length) { this.stop(); setTimeout(() => this.show(), 900); } }, 700);
    },
    stop() { if (playTimer) { clearInterval(playTimer); playTimer = null; } },
    on: () => frameAt >= 0
  };
  OR.on('style', () => { if (frameAt >= 0) OR.radar.show(frameAt); });

  // ---------- the bendiest roads in view (from the map's own road shapes) ----------
  const CLASSES = { trunk: 'Main road', primary: 'Main road', secondary: 'B-road', tertiary: 'Minor road', minor: 'Minor road' };
  OR.greatRoads = function () {
    const m = OR.map, feats = m.querySourceFeatures('omt', { sourceLayer: 'transportation' });
    // pieces of road (tiles cut roads into pieces) joined back up where they meet end to end
    const lines = [], seen = {};
    feats.forEach(f => {
      const p = f.properties; if (!CLASSES[p.class] || p.ramp || p.brunnel === 'tunnel') return;
      const ls = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
      ls.forEach(l => { if (l.length < 2) return; const k = l[0].map(x => x.toFixed(5)) + '|' + l[l.length - 1].map(x => x.toFixed(5)) + '|' + l.length; if (seen[k]) return; seen[k] = 1; lines.push({ cls: p.class, pts: l }); });
    });
    const key = c => c[0].toFixed(5) + ',' + c[1].toFixed(5), ends = {};
    lines.forEach((l, i) => [key(l.pts[0]), key(l.pts[l.pts.length - 1])].forEach(k => (ends[k] = ends[k] || []).push(i)));
    const used = new Array(lines.length).fill(false), chains = [];
    const nextAt = (k, cls) => { const c = (ends[k] || []).filter(i => !used[i] && CLASSES[lines[i].cls] === CLASSES[cls]); return c.length === 1 ? c[0] : -1; };
    lines.forEach((l, i) => {
      if (used[i]) return; used[i] = true; let pts = l.pts.slice();
      for (let grow = true; grow;) {
        grow = false;
        let n = nextAt(key(pts[pts.length - 1]), l.cls);
        if (n >= 0) { used[n] = true; const q = lines[n].pts; pts = pts.concat(key(q[0]) === key(pts[pts.length - 1]) ? q.slice(1) : q.slice().reverse().slice(1)); grow = true; }
        n = nextAt(key(pts[0]), l.cls);
        if (n >= 0) { used[n] = true; const q = lines[n].pts; pts = (key(q[q.length - 1]) === key(pts[0]) ? q.slice(0, -1) : q.slice().reverse().slice(0, -1)).concat(pts); grow = true; }
      }
      chains.push({ cls: l.cls, pts });
    });
    // how much each turns per mile, measured every 40 m so straight bits with many points don't count as bends
    const out = chains.map(c => {
      const pts = OR.resample(c.pts, 40); let len = 0, turn = 0;
      for (let i = 1; i < pts.length; i++) { len += OR.dist(pts[i - 1], pts[i]); if (i > 1) { const d = OR.angDiff(OR.bearing(pts[i - 2], pts[i - 1]), OR.bearing(pts[i - 1], pts[i])); if (d < 75) turn += d; } } // the same measure as for routes (sharp corners at junctions don't count)
      return { cls: c.cls, kind: CLASSES[c.cls], len, twist: len ? Math.round(turn / (len / MI)) : 0, lines: [c.pts], mid: c.pts[Math.floor(c.pts.length / 2)], name: '', ref: '' };
    }).filter(g => g.len > 2500 && g.twist >= 110);
    return out.sort((a, b) => b.twist * Math.sqrt(b.len) - a.twist * Math.sqrt(a.len)).slice(0, 10);
  };
  // names: the nearest town or village to the middle of each road
  OR.nameRoads = async function (roads) {
    await Promise.all(roads.map(async g => { const n = await OR.reverseName(g.mid[0], g.mid[1]).catch(() => null); g.name = g.kind + (n ? ' near ' + n.split(',')[0] : ''); }));
    return roads;
  };
})(window.OR);
