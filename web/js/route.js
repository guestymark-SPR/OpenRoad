/* OpenRoad routing: Valhalla motorcycle routing (FOSSGIS public server), riding styles, bendiness score, GPX. */
'use strict';
(function (OR) {
  const VALHALLA = 'https://valhalla1.openstreetmap.de';
  const PHOTON = 'https://photon.komoot.io/api/';
  const SERVER_MAX = 10; // the FOSSGIS server accepts at most 10 points per request
  const MAX_LOC = 60;    // longer routes are planned 10 points at a time and joined

  // ---------- place search ----------
  OR.search = function (q) {
    const c = OR.map.getCenter();
    const url = PHOTON + '?limit=7&lang=en&q=' + encodeURIComponent(q) + '&lat=' + c.lat.toFixed(3) + '&lon=' + c.lng.toFixed(3);
    return OR.json(url).then(j => (j.features || []).map(f => {
      const p = f.properties || {};
      const main = p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.city || 'Place';
      const sub = [p.street && p.name ? p.street : '', p.city !== main ? p.city : '', p.county, p.postcode, p.country].filter(Boolean).join(', ');
      return { name: main, sub, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
    }));
  };
  // "52.1, -1.2" or "52.1 -1.2" typed straight in
  OR.parseLatLon = function (q) {
    const m = q.trim().match(/^(-?\d{1,2}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)$/);
    if (!m) return null; const lat = +m[1], lng = +m[2];
    return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { name: lat.toFixed(5) + ', ' + lng.toFixed(5), sub: 'Coordinates', lat, lng } : null;
  };
  OR.reverseName = function (lng, lat) {
    return OR.json('https://photon.komoot.io/reverse?lang=en&lon=' + lng + '&lat=' + lat).then(j => {
      const p = (j.features && j.features[0] && j.features[0].properties) || {};
      return p.name || [p.street, p.city || p.district].filter(Boolean).join(', ') || p.city || null;
    }).catch(() => null);
  };

  // ---------- plan state ----------
  OR.plan = { wps: OR.store.get('wps', []), route: null, options: [], choice: 0 };
  OR.savePlan = () => OR.store.set('wps', OR.plan.wps);

  // ---------- Valhalla ----------
  function costing(opts) {
    const m = { use_highways: opts.highways, use_tolls: OR.cfg.avoidTolls ? 0 : 0.5, use_ferry: OR.cfg.avoidFerries ? 0 : 0.5, use_trails: 0, exclude_unpaved: true };
    if (opts.shortest) m.shortest = true;
    return { motorcycle: m };
  }
  function body(wps, opts) {
    return {
      locations: wps.map((w, i) => ({ lat: +w.lat.toFixed(6), lon: +w.lng.toFixed(6), type: i === 0 || i === wps.length - 1 || w.type === 'break' ? 'break' : 'through' })),
      costing: 'motorcycle', costing_options: costing(opts), units: OR.cfg.units === 'km' ? 'kilometers' : 'miles', language: 'en-GB',
      alternates: opts.alternates || 0, id: 'openroad'
    };
  }
  function valhalla(path, b) {
    return OR.json(VALHALLA + '/' + path, { method: 'POST', body: JSON.stringify(b), timeout: 60000 }).catch(e => {
      // Valhalla puts a readable reason in the error body
      const m = String(e.message).match(/"error"\s*:\s*"([^"]+)"/); throw new Error(m ? m[1] : e.message);
    });
  }

  // Plan a route with any number of points: in pieces of up to 10 points that share their end points,
  // joined into one trip. With 10 or fewer points it is a single request (and can have alternatives).
  async function routeTrips(wps, o, extra) {
    if (wps.length <= SERVER_MAX) {
      const b = body(wps, o); if (extra) extra(b);
      const j = await valhalla('route', b);
      return [j.trip].concat((j.alternates || []).map(a => a.trip));
    }
    const pieces = [];
    for (let i = 0; i < wps.length - 1; i += SERVER_MAX - 1) pieces.push(wps.slice(i, i + SERVER_MAX));
    const trips = [];
    for (let k = 0; k < pieces.length; k++) {
      const pw = pieces[k].map((w, i) => i === 0 || i === pieces[k].length - 1 ? Object.assign({}, w, { type: 'break' }) : w);
      const b = body(pw, Object.assign({}, o, { alternates: 0 })); if (k === 0 && extra) extra(b);
      trips.push((await valhalla('route', b)).trip);
    }
    return [{ units: trips[0].units, summary: { time: trips.reduce((t, x) => t + x.summary.time, 0) }, legs: [].concat.apply([], trips.map(t => t.legs)) }];
  }

  // Turn a Valhalla trip into the route OpenRoad navigates on.
  OR.buildRoute = function (trip, meta) {
    const unitM = trip.units === 'kilometers' ? 1000 : OR.MI;
    const shape = [], man = [], legEnds = [];
    let mway = 0;
    for (const leg of trip.legs) {
      const pts = OR.decodePoly(leg.shape, 6), off = shape.length ? shape.length - 1 : 0;
      if (shape.length) pts.shift();
      for (const p of pts) shape.push(p);
      for (const m of leg.maneuvers) {
        if (m.highway) mway += m.length * unitM;
        man.push({ idx: m.begin_shape_index + off, end: m.end_shape_index + off, type: m.type, text: m.instruction,
          alert: m.verbal_transition_alert_instruction || '', pre: m.verbal_pre_transition_instruction || m.instruction,
          post: m.verbal_post_transition_instruction || '', street: (m.street_names || m.begin_street_names || []).join(' / '),
          len: m.length * unitM, time: m.time, exit: m.roundabout_exit_count || 0, toll: !!m.toll });
      }
      legEnds.push(shape.length - 1);
    }
    // drop the "arrive" step of intermediate legs that are only shaping points; keep real stops
    const cum = OR.cumulative(shape);
    for (const m of man) m.at = cum[m.idx];
    const dist = cum[cum.length - 1];
    // the main numbered roads, longest first (A537, M6, N4, D901…), shown as sign-style chips
    const refLen = {};
    for (const m of man) for (const n of (m.street || '').split(' / ')) { const t = n.trim(); if (/^[A-Z]{1,3}\d{1,4}[A-Z]?$/.test(t)) refLen[t] = (refLen[t] || 0) + m.len; }
    const roads = Object.keys(refLen).sort((a, b) => refLen[b] - refLen[a]).slice(0, 4);
    const sum = trip.summary || {};
    return Object.assign({ roads, hasToll: !!sum.has_toll || man.some(m => m.toll), hasFerry: !!sum.has_ferry || man.some(m => m.type === 28),
      id: OR.uid(), shape, cum, man, legEnds: legEnds.map(i => cum[i]), dist, time: trip.summary.time,
      twist: OR.bendiness(shape, man), mwayPct: dist ? Math.round(100 * Math.min(mway, dist) / dist) : 0, created: Date.now()
    }, meta || {});
  };

  // Bendiness: total heading change per mile along the road, ignoring junction turns. Relative, for comparing options.
  OR.bendiness = function (shape, man) {
    if (shape.length < 3) return 0;
    const turnPts = new Set(); (man || []).forEach(m => turnPts.add(m.idx));
    const cum = OR.cumulative(shape), skip = [];
    for (const i of turnPts) skip.push(cum[i]);
    skip.sort((a, b) => a - b);
    const pts = OR.resample(shape, 40); let total = 0, along = 0, j = 0, prev = null;
    for (let i = 1; i < pts.length; i++) {
      const h = OR.bearing(pts[i - 1], pts[i]); along += 40;
      while (j < skip.length && skip[j] < along - 80) j++;
      const nearTurn = j < skip.length && Math.abs(skip[j] - along) < 80;
      if (prev != null && !nearTurn) { const d = OR.angDiff(prev, h); if (d < 75) total += d; }
      prev = h;
    }
    const miles = cum[cum.length - 1] / OR.MI;
    return miles ? Math.round(total / miles) : 0;
  };
  OR.bendLabel = function (b) {
    if (b < 60) return 'Mostly straight';
    if (b < 110) return 'Some bends';
    if (b < 170) return 'Bendy';
    return 'Very bendy';
  };

  const STYLES = {
    fast: { label: 'Fastest', tries: [{ highways: 1, alternates: 2 }] },
    scenic: { label: 'No motorways', tries: [{ highways: 0, alternates: 2 }] },
    twisty: { label: 'Twisty', cap: 1.6, tries: [{ highways: 0, alternates: 2 }, { highways: 0, shortest: true }] },
    extra: { label: 'Extra twisty', cap: 2.3, tries: [{ highways: 0, alternates: 3 }, { highways: 0, shortest: true }, { highways: 0.2, shortest: true }] }
  };
  OR.STYLES = STYLES;

  // Plan options for these points in a riding style: up to 3, best first for that style.
  async function planOptions(wps, styleKey) {
    if (wps.length < 2) throw new Error('Add a start and a destination');
    if (wps.length > MAX_LOC) throw new Error('Too many points (' + wps.length + '). OpenRoad plans up to ' + MAX_LOC + ': remove some via points.');
    const style = STYLES[styleKey] || STYLES.twisty, multi = wps.length > 2;
    const results = [], errs = [];
    await Promise.all(style.tries.map(async t => {
      const o = Object.assign({}, t); if (multi) o.alternates = 0; // alternatives only work point to point
      try {
        const trips = await routeTrips(wps, o);
        trips.forEach((tr, k) => results.push(OR.buildRoute(tr, { mode: styleKey, variant: (o.shortest ? 'Quiet back roads' : k ? 'Alternative ' + k : style.label) })));
      } catch (e) { errs.push(e.message); }
    }));
    if (!results.length) throw new Error(errs[0] || 'No route found');
    const uniq = [];
    for (const r of results) if (!uniq.some(u => Math.abs(u.dist - r.dist) < 300 && Math.abs(u.time - r.time) < 60)) uniq.push(r);
    const fastest = Math.min.apply(null, uniq.map(r => r.time));
    let opts = uniq;
    if (style.cap) {
      // most bends first, but not if it takes far longer than the quickest option found
      opts = uniq.filter(r => r.time <= fastest * style.cap).sort((a, b) => b.twist - a.twist);
      opts = opts.concat(uniq.filter(r => opts.indexOf(r) < 0));
    } else opts.sort((a, b) => a.time - b.time);
    opts = opts.slice(0, 3);
    opts.forEach(r => { r.wps = wps.map(w => Object.assign({}, w)); r.name = r.name || defaultName(wps); });
    return opts;
  }
  OR.planRoute = async function () {
    const opts = await planOptions(OR.plan.wps, OR.cfg.style);
    OR.plan.options = opts; OR.plan.choice = 0; OR.plan.route = opts[0];
    return opts;
  };
  OR.planWaypoints = async (wps, styleKey) => (await planOptions(wps, styleKey || OR.cfg.style))[0];
  OR.planOptions = planOptions;
  function defaultName(wps) { return (wps[0].name || 'Start') + ' to ' + (wps[wps.length - 1].name || 'End'); }

  // Re-plan from where the bike is now to the remaining stops (used when off route).
  OR.rerouteFrom = async function (pos, route, along) {
    let rest = [];
    if (route.mode === 'gpx') {
      // a followed GPX track: rejoin it and keep to its line, through points every ~5 km of what is left
      const ahead = []; for (let i = 0; i < route.shape.length; i++) if (route.cum[i] > along + 300) ahead.push(route.shape[i]);
      rest = OR.resample(ahead.length ? ahead : [route.shape[route.shape.length - 1]], 5000).slice(0, MAX_LOC - 1)
        .map((p, i, a) => ({ lng: p[0], lat: p[1], name: i === a.length - 1 ? 'Track end' : 'Track', type: i === a.length - 1 ? 'break' : 'through' }));
    } else {
      // stops still ahead: where each one sits along the route, compared with where the bike is
      const at = w => { let best = 1e12, a = 0; for (let i = 0; i < route.shape.length - 1; i++) { const r = OR.projSeg([w.lng, w.lat], route.shape[i], route.shape[i + 1]); if (r.d < best) { best = r.d; a = route.cum[i] + r.t * (route.cum[i + 1] - route.cum[i]); } } return a; };
      route.wps.forEach((w, i) => { if (i > 0 && (i === route.wps.length - 1 || at(w) > along + 50)) rest.push(w); });
    }
    const wps = [{ lng: pos[0], lat: pos[1], name: 'Here', type: 'break' }].concat(rest).slice(0, MAX_LOC);
    const t = (STYLES[route.mode] || STYLES.twisty).tries[0];
    const trips = await routeTrips(wps, Object.assign({}, t, { alternates: 0 }), b => {
      if (pos[2] != null) { b.locations[0].heading = Math.round(pos[2]); b.locations[0].heading_tolerance = 60; }
    });
    const r = OR.buildRoute(trips[0], { mode: route.mode, name: route.name, variant: 'Rerouted' });
    r.wps = wps; r.id = route.id; r.originalId = route.originalId || route.id;
    return r;
  };

  // ---------- follow a GPX track exactly (map-matched so it gets turn-by-turn) ----------
  OR.routeFromTrack = async function (pts, name) {
    const dense = OR.resample(pts, 150);
    // the public server limits each matched trace to about 200 km, so long tracks are matched in pieces
    const chunks = []; let cur = [dense[0]], d = 0;
    for (let i = 1; i < dense.length; i++) {
      cur.push(dense[i]); d += OR.dist(dense[i - 1], dense[i]);
      if (d > 140000) { chunks.push(cur); cur = [dense[i]]; d = 0; }
    }
    if (cur.length > 1) chunks.push(cur);
    const trips = [];
    for (let i = 0; i < chunks.length; i++) {
      OR.toast('Matching track to roads… ' + (i + 1) + ' of ' + chunks.length, 8000);
      const b = { encoded_polyline: OR.encodePoly(chunks[i], 6), costing: 'motorcycle', costing_options: costing({ highways: 0.5 }), shape_match: 'map_snap',
        units: OR.cfg.units === 'km' ? 'kilometers' : 'miles', language: 'en-GB' };
      const j = await valhalla('trace_route', b);
      trips.push(j.trip);
    }
    const merged = { units: trips[0].units, summary: { time: trips.reduce((s, t) => s + t.summary.time, 0) }, legs: [] };
    trips.forEach(t => merged.legs.push.apply(merged.legs, t.legs));
    const r = OR.buildRoute(merged, { mode: 'gpx', name: name || 'GPX route', variant: 'Follows the GPX track' });
    const a = pts[0], z = pts[pts.length - 1];
    r.wps = [{ lng: a[0], lat: a[1], name: 'Track start', type: 'break' }, { lng: z[0], lat: z[1], name: 'Track end', type: 'break' }];
    return r;
  };

  // ---------- GPX ----------
  OR.parseGpx = function (text) {
    const x = new DOMParser().parseFromString(text, 'application/xml');
    if (x.getElementsByTagName('parsererror').length) throw new Error('This is not a readable GPX file');
    const pt = e => [parseFloat(e.getAttribute('lon')), parseFloat(e.getAttribute('lat'))];
    const nm = e => { const n = e.getElementsByTagName('name')[0]; return n ? n.textContent.trim() : ''; };
    const tracks = Array.from(x.getElementsByTagName('trk')).map(t => ({ name: nm(t), pts: Array.from(t.getElementsByTagName('trkpt')).map(pt) })).filter(t => t.pts.length > 1);
    const routes = Array.from(x.getElementsByTagName('rte')).map(r => ({ name: nm(r), pts: Array.from(r.getElementsByTagName('rtept')).map(e => { const p = pt(e); p.name = nm(e); return p; }) })).filter(r => r.pts.length > 1);
    const wpts = Array.from(x.getElementsByTagName('wpt')).map(e => { const p = pt(e); p.name = nm(e); return p; });
    const meta = x.getElementsByTagName('metadata')[0];
    return { name: (meta && nm(meta)) || (tracks[0] && tracks[0].name) || (routes[0] && routes[0].name) || '', tracks, routes, wpts };
  };
  const xe = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  OR.toGpx = function (r) {
    const ll = p => 'lat="' + p[1].toFixed(6) + '" lon="' + p[0].toFixed(6) + '"';
    let g = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="OpenRoad" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>' + xe(r.name) + '</name></metadata>\n';
    if (r.wps) { g += '<rte><name>' + xe(r.name) + '</name>\n'; r.wps.forEach(w => { g += '<rtept ' + ll([w.lng, w.lat]) + '><name>' + xe(w.name || '') + '</name></rtept>\n'; }); g += '</rte>\n'; }
    const pts = r.shape || r.pts || [];
    g += '<trk><name>' + xe(r.name) + '</name><trkseg>\n';
    pts.forEach((p, i) => { g += '<trkpt ' + ll(p) + '>' + (r.times ? '<time>' + new Date(r.times[i]).toISOString() + '</time>' : '') + '</trkpt>\n'; });
    return g + '</trkseg></trk>\n</gpx>\n';
  };
  OR.fileName = s => (String(s || 'route').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'route');

  // ---------- saved routes ----------
  const pack = r => Object.assign({}, r, { shape: OR.encodePoly(r.shape, 6), cum: undefined });
  const unpack = r => { const o = Object.assign({}, r, { shape: OR.decodePoly(r.shape, 6) }); o.cum = OR.cumulative(o.shape); return o; };
  OR.routes = {
    list: () => OR.store.get('routes', []),
    save(r) { const l = OR.routes.list().filter(x => x.id !== r.id); l.unshift(pack(r)); OR.store.set('routes', l.slice(0, 200)); },
    get(id) { const r = OR.routes.list().find(x => x.id === id); return r ? unpack(r) : null; },
    del(id) { OR.store.set('routes', OR.routes.list().filter(x => x.id !== id)); }
  };

  OR.routeGeo = r => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.shape } });
})(window.OR);
