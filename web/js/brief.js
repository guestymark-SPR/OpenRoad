/* OpenRoad route brief: everything worth knowing before you set off on a route. */
'use strict';
(function (OR) {
  const TOMTOM = 'https://api.tomtom.com/traffic/services/5/incidentDetails';
  const INC = { 1: 'Accident', 2: 'Fog', 3: 'Dangerous conditions', 4: 'Rain', 5: 'Ice', 6: 'Queue', 7: 'Lane closed', 8: 'Road closed', 9: 'Roadworks', 10: 'Wind', 11: 'Flooding', 14: 'Broken-down vehicle' };
  const DELAY = { 1: 'minor delay', 2: 'moderate delay', 3: 'major delay' };

  function alongOf(route, lng, lat) {
    let best = { d: 1e12, a: 0 };
    for (let i = 0; i < route.shape.length - 1; i++) {
      const r = OR.projSeg([lng, lat], route.shape[i], route.shape[i + 1]);
      if (r.d < best.d) best = { d: r.d, a: route.cum[i] + r.t * (route.cum[i + 1] - route.cum[i]) };
    }
    return best;
  }

  // Things on the road itself, from OpenStreetMap: level crossings, fords, cattle grids, marked hazards
  OR.hazardsAlong = async function (route) {
    const pts = OR.resample(route.shape, 250);
    const coords = pts.map(p => p[1].toFixed(5) + ',' + p[0].toFixed(5)).join(',');
    const list = await OR.overpass('[out:json][timeout:90];(node["railway"="level_crossing"](around:25,' + coords + ');node["ford"](around:25,' + coords + ');way["ford"](around:25,' + coords + ');' +
      'node["barrier"="cattle_grid"](around:25,' + coords + ');node["hazard"](around:60,' + coords + '););out tags center;');
    const out = [];
    for (const h of list) {
      const t = h.tags || {}; const pos = alongOf(route, h.lng, h.lat);
      if (pos.d > 60) continue;
      let what = t.railway === 'level_crossing' ? 'Level crossing' : t.ford ? 'Ford (water across the road)' : t.barrier === 'cattle_grid' ? 'Cattle grid' : '';
      if (!what && t.hazard) what = { animal_crossing: 'Animals crossing', falling_rocks: 'Falling rocks', ice: 'Ice risk', slippery: 'Slippery road', curves: 'Dangerous bends', curve: 'Dangerous bend', bump: 'Bump', dip: 'Dip in the road',
        loose_gravel: 'Loose gravel', school_zone: 'School zone', children: 'Children', deer: 'Deer', cattle: 'Cattle', horse_riders: 'Horse riders', queues_likely: 'Queues likely', side_winds: 'Side winds', frost_heave: 'Frost damage',
        damaged_road: 'Damaged road', road_narrows: 'Road narrows', low_flying_aircraft: 'Low-flying aircraft' }[t.hazard] || ('Hazard: ' + String(t.hazard).replace(/_/g, ' '));
      out.push({ what, at: pos.a, lng: h.lng, lat: h.lat });
    }
    out.sort((a, b) => a.at - b.at);
    // group the same thing close together
    const merged = [];
    for (const h of out) { const l = merged[merged.length - 1]; if (l && l.what === h.what && h.at - l.at < 500) continue; merged.push(h); }
    return merged;
  };

  // Live incidents on the route from TomTom (needs a free key in Settings)
  OR.trafficAlong = async function (route) {
    const key = (OR.cfg.tomtomKey || '').trim(); if (!key) return null;
    const boxes = []; let start = 0;
    for (let i = 1; i < route.shape.length; i++) {
      if (route.cum[i] - route.cum[start] > 45000 || i === route.shape.length - 1) { boxes.push(OR.bbox(route.shape.slice(start, i + 1))); start = i; }
    }
    const fields = '{incidents{geometry{type,coordinates},properties{iconCategory,magnitudeOfDelay,events{description},from,to,delay,roadNumbers}}}';
    const all = [];
    for (const b of boxes.slice(0, 20)) {
      const pad = 0.01, bb = [b[0][0] - pad, b[0][1] - pad, b[1][0] + pad, b[1][1] + pad].map(v => v.toFixed(5)).join(',');
      const j = await OR.json(TOMTOM + '?key=' + encodeURIComponent(key) + '&bbox=' + bb + '&language=en-GB&timeValidityFilter=present&fields=' + encodeURIComponent(fields));
      for (const inc of j.incidents || []) {
        const g = inc.geometry || {}, c = g.type === 'Point' ? [g.coordinates] : (g.coordinates || []);
        if (!c.length) continue;
        const mid = c[Math.floor(c.length / 2)], pos = alongOf(route, mid[0], mid[1]);
        if (pos.d > 120) continue; // on another road
        const p = inc.properties || {};
        all.push({ what: INC[p.iconCategory] || 'Incident', at: pos.a, delay: p.delay || 0, size: DELAY[p.magnitudeOfDelay] || '', text: (p.events || []).map(e => e.description).filter(Boolean).join(', '),
          roads: (p.roadNumbers || []).join(', '), from: p.from || '', to: p.to || '', lng: mid[0], lat: mid[1] });
      }
    }
    const seen = new Set();
    return all.filter(x => { const k = x.what + Math.round(x.at / 300); if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.at - b.at);
  };

  // What to wear and take, from the forecast and the countries on the route
  OR.kitList = function (wx, countries, route, dark) {
    const temps = wx.map(w => w.temp), minT = temps.length ? Math.min.apply(null, temps) : null;
    const rain = wx.some(w => (w.rainP || 0) >= 40 || w.code >= 51), gusts = wx.length ? Math.max.apply(null, wx.map(w => w.gust || 0)) : 0;
    const sunny = wx.some(w => w.code <= 1);
    const k = [
      ['Helmet', 'visor clean, chin strap done up'], ['Gloves', countries.indexOf('FR') >= 0 ? 'certified gloves are the law in France' : countries.indexOf('BE') >= 0 ? 'required in Belgium' : 'always wear them'],
      ['Jacket and trousers with armour', countries.indexOf('BE') >= 0 ? 'long sleeves and long trousers are the law in Belgium' : ''], ['Boots that cover the ankles', countries.indexOf('BE') >= 0 ? 'required in Belgium' : ''],
      ['Earplugs', 'wind noise over a long ride damages hearing']
    ];
    if (rain) k.push(['Waterproofs', 'rain is likely on the route'], ['Spare dry gloves', 'wet gloves get cold fast']);
    if (minT != null && minT < 10) k.push(['Thermal layers and neck warmer', 'down to ' + Math.round(minT) + '° on the route'], ['Heated grips or winter gloves', 'cold hands slow your reactions']);
    if (minT != null && minT <= 3) k.push(['Watch for ice', 'near freezing: shaded bends and bridges first']);
    if (gusts >= 35) k.push(['Expect strong gusts', 'up to ' + Math.round(gusts) + ' mph: grip lightly, watch for gaps between buildings and trees']);
    if (sunny) k.push(['Tinted visor or sunglasses', 'and sun cream for your neck']);
    if (dark) k.push(['Clear visor and hi-vis', 'part of the ride is after sunset']);
    if (route.dist > 160000) k.push(['Water and snacks', 'over 100 miles: plan a break every 1 to 2 hours']);
    k.push(['Phone charged, ICE card filled in', 'More, Emergency card']);
    if (countries.some(c => c !== 'GB')) OR.ABROAD.forEach(a => k.push([a, 'riding abroad']));
    countries.forEach(c => { const r = OR.RULES[c]; if (r) r.carry.forEach(x => k.push([x, r.name])); });
    return k;
  };

  // Put the whole brief together. Each part loads on its own; anything that fails is reported, not hidden.
  OR.buildBrief = async function (route, depart) {
    const dep = depart || new Date();
    const arrive = new Date(dep.getTime() + route.time * 1000);
    const end = route.shape[route.shape.length - 1], st = route.shape[0];
    const sunS = OR.sunTimes(st[1], st[0], dep), sunE = OR.sunTimes(end[1], end[0], arrive);
    const dark = !!(sunE && (arrive > sunE.set || dep < sunS.rise));
    const b = { route, dep, arrive, sunset: sunE && sunE.set, sunrise: sunS && sunS.rise, dark, errors: {} };
    const tasks = {
      wx: OR.weatherAlong(route, dep), hazards: OR.hazardsAlong(route), countries: OR.routeCountries(route),
      cams: OR.camerasAlong ? OR.camerasAlong(route) : Promise.resolve([]), traffic: OR.trafficAlong(route),
      zones: route.zones !== undefined ? Promise.resolve(route.zones) : OR.zonesAlong ? OR.zonesAlong(route) : Promise.resolve(null),
      elev: route.elev ? Promise.resolve(route.elev) : OR.elevationAlong ? OR.elevationAlong(route) : Promise.resolve(null)
    };
    await Promise.all(Object.keys(tasks).map(k => tasks[k].then(v => { b[k] = v; }).catch(e => { b[k] = null; b.errors[k] = e.message; })));
    b.countries = b.countries || []; if (!b.countries.length) b.countries = OR.inUK(st[0], st[1]) ? ['GB'] : [];
    b.kit = OR.kitList(b.wx || [], b.countries, route, dark);
    b.warnings = [];
    if (b.wx) Array.from(new Set(b.wx.map(OR.weatherWarn).filter(Boolean))).forEach(w => b.warnings.push(w));
    if (dark) b.warnings.push(arrive > (sunE && sunE.set) ? 'You\'ll finish after sunset (' + OR.clock(sunE.set) + ')' : 'You\'ll set off before sunrise');
    if (route.twist >= 170) b.warnings.push('Very bendy route: take it steady until you know the roads');
    if (route.hasFerry) b.warnings.push('The route includes a ferry');
    if (route.hasToll) b.warnings.push('The route includes toll roads');
    (b.zones || []).forEach(z => b.warnings.push('Passes through ' + z.name + ' (low-emission zone): check whether motorbikes need a sticker or registration'));
    if (b.elev && b.elev.steep >= 15) b.warnings.push('Steep in places: about ' + Math.round(b.elev.steep) + '% at the steepest');
    return b;
  };

  // Text version, for sharing and reading aloud
  OR.briefText = function (b) {
    const r = b.route, L = [];
    L.push(r.name + ': ' + OR.fmtDist(r.dist) + ', about ' + OR.fmtTime(r.time) + '. Leave ' + OR.clock(b.dep) + ', arrive about ' + OR.clock(b.arrive) + '.');
    if (b.warnings.length) L.push('Watch out: ' + b.warnings.join('. ') + '.');
    if (b.wx && b.wx.length) { const t = b.wx.map(w => w.temp); L.push('Weather: ' + OR.wmo(b.wx[0].code)[0].toLowerCase() + ', ' + Math.round(Math.min.apply(null, t)) + ' to ' + Math.round(Math.max.apply(null, t)) + ' degrees, up to ' + Math.round(Math.max.apply(null, b.wx.map(w => w.rainP || 0))) + '% chance of rain.'); }
    if (b.hazards && b.hazards.length) L.push('On the road: ' + summarise(b.hazards) + '.');
    if (b.traffic && b.traffic.length) L.push('Traffic: ' + b.traffic.map(t => t.what + (t.roads ? ' on ' + t.roads : '') + (t.delay ? ', ' + Math.round(t.delay / 60) + ' min delay' : '')).join('; ') + '.');
    b.countries.forEach(c => { const x = OR.RULES[c]; if (x && c !== 'GB') L.push(x.name + ': ' + x.must.join('; ') + '.'); });
    return L.join('\n');
  };
  function summarise(list) { const c = {}; list.forEach(h => c[h.what] = (c[h.what] || 0) + 1); return Object.keys(c).map(k => c[k] + ' × ' + k.toLowerCase()).join(', '); }
  OR.summariseHazards = summarise;
})(window.OR);
