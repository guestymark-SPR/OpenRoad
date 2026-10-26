/* OpenRoad ride kit: weather along the route, speed limits, UK speed cameras, round trips, lean angle. */
'use strict';
(function (OR) {
  const VALHALLA = 'https://valhalla1.openstreetmap.de';
  const METEO = 'https://api.open-meteo.com/v1/forecast';

  // ---------- weather (Open-Meteo, no key) ----------
  const WMO = { 0: ['Clear', '☀️'], 1: ['Mostly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'], 45: ['Fog', '🌫️'], 48: ['Freezing fog', '🌫️'],
    51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'], 56: ['Freezing drizzle', '🌧️'], 57: ['Freezing drizzle', '🌧️'],
    61: ['Light rain', '🌦️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'], 66: ['Freezing rain', '🌧️'], 67: ['Freezing rain', '🌧️'],
    71: ['Light snow', '🌨️'], 73: ['Snow', '🌨️'], 75: ['Heavy snow', '❄️'], 77: ['Snow grains', '🌨️'], 80: ['Showers', '🌦️'], 81: ['Heavy showers', '🌧️'], 82: ['Violent showers', '⛈️'],
    85: ['Snow showers', '🌨️'], 86: ['Heavy snow showers', '❄️'], 95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm, hail', '⛈️'], 99: ['Thunderstorm, hail', '⛈️'] };
  OR.wmo = c => WMO[c] || ['–', '·'];
  OR.FORECAST_DAYS = 16;

  // Points along the route about every hour of riding, each with the forecast for when you'd be there.
  OR.weatherAlong = async function (route, depart) {
    const t0 = (depart || new Date()).getTime();
    if (t0 > Date.now() + (OR.FORECAST_DAYS - 1) * 864e5) throw new Error('Forecasts only go ' + OR.FORECAST_DAYS + ' days ahead');
    const pts = []; let t = 0, next = 0;
    for (const m of route.man) {
      if (t >= next) { pts.push({ p: route.shape[m.idx], at: t0 + t * 1000, along: m.at }); next = t + 3600; }
      t += m.time || 0;
    }
    const end = route.shape[route.shape.length - 1];
    if (pts.length > 1 && t0 + t * 1000 - pts[pts.length - 1].at < 20 * 60000) pts.pop(); // don't show the arrival twice
    pts.push({ p: end, at: t0 + t * 1000, along: route.dist, end: true });
    const use = pts.slice(0, 14);
    const q = '?latitude=' + use.map(x => x.p[1].toFixed(3)).join(',') + '&longitude=' + use.map(x => x.p[0].toFixed(3)).join(',') +
      '&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,weather_code&wind_speed_unit=mph&timeformat=unixtime&forecast_days=' + OR.FORECAST_DAYS;
    let j = await OR.json(METEO + q); if (!Array.isArray(j)) j = [j];
    return use.map((x, i) => {
      const h = j[i] && j[i].hourly; if (!h) return null;
      let k = 0, best = 1e15; h.time.forEach((tt, n) => { const d = Math.abs(tt * 1000 - x.at); if (d < best) { best = d; k = n; } });
      return { lng: x.p[0], lat: x.p[1], at: x.at, along: x.along, end: x.end, temp: h.temperature_2m[k], rainP: h.precipitation_probability[k], rain: h.precipitation[k],
        wind: h.wind_speed_10m[k], gust: h.wind_gusts_10m[k], code: h.weather_code[k] };
    }).filter(Boolean);
  };
  // One day's forecast at a place (for trip days)
  OR.dayWeather = async function (lng, lat, dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    if (d.getTime() > Date.now() + (OR.FORECAST_DAYS - 1) * 864e5) return { tooFar: true, from: new Date(d.getTime() - (OR.FORECAST_DAYS - 1) * 864e5) };
    if (d.getTime() < Date.now() - 864e5) return { past: true };
    const j = await OR.json(METEO + '?latitude=' + lat.toFixed(3) + '&longitude=' + lng.toFixed(3) + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_gusts_10m_max&wind_speed_unit=mph&timezone=auto&start_date=' + dateStr + '&end_date=' + dateStr);
    const x = j.daily; if (!x || !x.time || !x.time.length) return null;
    return { code: x.weather_code[0], tmax: x.temperature_2m_max[0], tmin: x.temperature_2m_min[0], rainP: x.precipitation_probability_max[0], gust: x.wind_gusts_10m_max[0] };
  };
  OR.weatherWarn = w => w.code >= 95 ? 'Thunderstorms' : w.gust >= 45 ? 'Strong gusts (' + Math.round(w.gust) + ' mph)' : w.code >= 61 && w.rainP >= 60 ? 'Rain likely' : w.temp != null && w.temp <= 3 ? 'Near freezing: watch for ice' : '';

  // ---------- speed limits (Valhalla trace_attributes on the planned line) ----------
  OR.speedLimits = async function (route) {
    // the public server matches up to about 200 km at a time, so long routes go in pieces
    const pieces = []; let start = 0;
    for (let i = 1; i < route.shape.length; i++) {
      if (route.cum[i] - route.cum[start] > 140000 || i === route.shape.length - 1) { pieces.push([start, i]); start = i; }
    }
    const out = [];
    for (const [a, b] of pieces) {
      const pts = route.shape.slice(a, b + 1);
      const j = await OR.json(VALHALLA + '/trace_attributes', { method: 'POST', timeout: 60000, body: JSON.stringify({
        encoded_polyline: OR.encodePoly(pts, 6), costing: 'motorcycle', shape_match: 'edge_walk', units: 'kilometers',
        filters: { attributes: ['edge.speed_limit', 'edge.begin_shape_index', 'edge.end_shape_index', 'shape'], action: 'include' } }) });
      const sh = j.shape ? OR.decodePoly(j.shape, 6) : pts, cum = OR.cumulative(sh), off = route.cum[a];
      for (const e of j.edges || []) {
        const kph = e.speed_limit;
        if (e.begin_shape_index == null || e.end_shape_index == null) continue;
        out.push({ from: off + cum[e.begin_shape_index], to: off + cum[e.end_shape_index], kph: kph > 0 && kph < 200 ? kph : null });
      }
    }
    // merge neighbours with the same limit
    const merged = [];
    for (const s of out) { const l = merged[merged.length - 1]; if (l && l.kph === s.kph && Math.abs(l.to - s.from) < 5) l.to = s.to; else merged.push(Object.assign({}, s)); }
    return merged;
  };
  OR.limitAt = function (limits, along) {
    if (!limits) return null;
    for (const s of limits) if (along >= s.from - 3 && along <= s.to + 3) return s.kph;
    return null;
  };
  // UK signs are in mph; OSM stores UK limits as mph values converted to km/h, so round back to a sign value
  OR.limitSign = function (kph, uk) {
    if (!kph) return null;
    if (uk || OR.cfg.units === 'mi') { const mph = Math.round(kph / 1.609344 / 5) * 5; return mph; }
    return Math.round(kph / 10) * 10 || Math.round(kph);
  };

  // ---------- speed cameras: UK and Ireland only ----------
  // Warning devices are illegal in France, Germany, Switzerland and some other countries, so OpenRoad only warns here.
  OR.inUKIreland = (lng, lat) => lat > 49.85 && lat < 61 && lng > -10.7 && lng < 1.8 && !(lat < 51.2 && lng > 1.45);
  OR.camerasAlong = async function (route) {
    const sample = OR.resample(route.shape, 1500).filter(p => OR.inUKIreland(p[0], p[1]));
    if (!sample.length) return [];
    const coords = sample.map(p => p[1].toFixed(5) + ',' + p[0].toFixed(5)).join(',');
    const list = await OR.overpass('[out:json][timeout:80];node["highway"="speed_camera"](around:900,' + coords + ');out tags;');
    const res = [];
    for (const c of list) {
      if (!OR.inUKIreland(c.lng, c.lat)) continue;
      let best = { d: 1e12, i: 0, t: 0 };
      for (let i = 0; i < route.shape.length - 1; i++) { const r = OR.projSeg([c.lng, c.lat], route.shape[i], route.shape[i + 1]); if (r.d < best.d) best = { d: r.d, i, t: r.t }; }
      if (best.d > 40) continue; // on another road
      res.push({ lng: c.lng, lat: c.lat, at: route.cum[best.i] + best.t * (route.cum[best.i + 1] - route.cum[best.i]), maxspeed: c.tags.maxspeed || '' });
    }
    return res.sort((a, b) => a.at - b.at);
  };

  // ---------- round trips ----------
  OR.DIRS = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
  // A loop through four points on a circle that starts and ends at `start`, sized so the roads add up to roughly `miles`.
  function loopPoints(start, metres, bearing) {
    const dia = metres / 1.35 / Math.PI; // roads wind, so the loop on the map is smaller than the distance ridden
    const R = 6371008.8, rad = Math.PI / 180;
    const move = (p, brg, d) => {
      const la = p[1] * rad, lo = p[0] * rad, b = brg * rad, a = d / R;
      const la2 = Math.asin(Math.sin(la) * Math.cos(a) + Math.cos(la) * Math.sin(a) * Math.cos(b));
      const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(a) * Math.cos(la), Math.cos(a) - Math.sin(la) * Math.sin(la2));
      return [lo2 / rad, la2 / rad];
    };
    const centre = move(start, bearing, dia / 2), pts = [];
    for (const k of [72, 144, 216, 288]) pts.push(move(centre, (bearing + 180 + k) % 360, dia / 2));
    return pts;
  }
  OR.roundTrip = async function (start, miles, dir) {
    const metres = miles * OR.MI, base = dir === 'any' ? Math.random() * 360 : OR.DIRS[dir];
    const tries = dir === 'any' ? [base, base + 120, base + 240] : [base, base - 25, base + 25];
    const found = [];
    await Promise.all(tries.map(async (b, n) => {
      const vias = loopPoints(start, metres, (b + 360) % 360);
      const wps = [{ lng: start[0], lat: start[1], name: 'Start', type: 'break' }]
        .concat(vias.map((p, i) => ({ lng: p[0], lat: p[1], name: 'Loop ' + (i + 1), type: 'through' })))
        .concat([{ lng: start[0], lat: start[1], name: 'Back to start', type: 'break' }]);
      try {
        const r = await OR.planWaypoints(wps, 'twisty');
        r.variant = Math.round(r.dist / OR.MI) + ' mi loop heading ' + compass(b);
        found.push(r);
      } catch (e) { }
    }));
    if (!found.length) throw new Error('No loop found from here. Try another direction or length (loops over the sea cannot be routed).');
    // closest to the length asked for, then the bendiest
    found.sort((a, b) => Math.abs(a.dist - metres) / metres - Math.abs(b.dist - metres) / metres || b.twist - a.twist);
    return found;
  };
  // a loop that gets you back by a time: plan by a distance guessed from your pace, then adjust once
  OR.roundTripByTime = async function (start, seconds, dir) {
    if (seconds < 1800) throw new Error('That\'s less than half an hour: pick a later time.');
    const est = r => OR.myTime ? OR.myTime(r.time, true) : r.time;
    const rides = OR.rides.list().filter(r => r.moving > 1800).slice(0, 20);
    const pace = rides.length >= 2 ? rides.reduce((s, r) => s + r.dist, 0) / rides.reduce((s, r) => s + r.moving, 0) / OR.MI * 3600 : 32; // mph on your rides
    let miles = Math.max(15, seconds / 3600 * pace * 0.85);
    let all = [];
    for (let round = 0; round < 2; round++) {
      const found = await OR.roundTrip(start, Math.min(400, miles), dir).catch(() => []);
      all = all.concat(found);
      const fit = all.filter(r => est(r) <= seconds * 1.03);
      const best = (fit.length ? fit : all).slice().sort((a, b) => Math.abs(est(a) - seconds) - Math.abs(est(b) - seconds))[0];
      if (!best) break;
      const ratio = est(best) / seconds;
      if (ratio > 0.82 && ratio <= 1.03) break;
      miles = miles / ratio * 0.95;
    }
    if (!all.length) throw new Error('No loop found from here. Try another direction (loops over the sea cannot be routed).');
    const back = r => new Date(Date.now() + est(r) * 1000);
    const fits = all.filter(r => est(r) <= seconds * 1.03).sort((a, b) => est(b) - est(a));
    const over = all.filter(r => est(r) > seconds * 1.03).sort((a, b) => est(a) - est(b));
    const out = fits.concat(over);
    out.forEach(r => { r.variant = Math.round(r.dist / OR.MI) + ' mi, back about ' + OR.clock(back(r)) + (est(r) > seconds * 1.03 ? ' (later than you asked)' : ''); r.backBy = back(r).getTime(); });
    return out;
  };
  function compass(b) { const n = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']; return n[Math.round(((b % 360) + 360) % 360 / 45) % 8]; }

  // ---------- lean angle (estimated from GPS speed and how fast the heading turns) ----------
  // In a steady turn, lean = atan(speed × turn rate / g). Phones can't measure it directly when mounted at an unknown angle.
  const lean = { prev: null, hist: [] };
  OR.resetLean = () => { lean.prev = null; lean.hist = []; };
  OR.leanFrom = function (p) {
    const prev = lean.prev; lean.prev = p;
    if (!prev || p.speed == null || p.speed < 6 || prev.speed == null || prev.speed < 6) return null;
    const dt = (p.t - prev.t) / 1000; if (dt <= 0.5 || dt > 3) return null;
    let dh = p.heading - prev.heading; if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
    const w = dh * Math.PI / 180 / dt, v = (p.speed + prev.speed) / 2;
    const deg = Math.atan(v * w / 9.81) * 180 / Math.PI;
    lean.hist.push(deg); if (lean.hist.length > 3) lean.hist.shift();
    if (lean.hist.length < 3) return null;
    const m = lean.hist.slice().sort((a, b) => a - b)[1]; // median of three, to ignore GPS spikes
    return Math.abs(m) > 62 ? null : m;
  };
})(window.OR);
