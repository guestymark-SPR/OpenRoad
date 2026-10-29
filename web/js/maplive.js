/* OpenRoad map extras: motorway junction numbers, road closures and roadworks around you.
   Fuel and places to stay come straight from the map tiles (see map.js 'poi-main'). */
'use strict';
(function (OR) {
  const EMPTY = { type: 'FeatureCollection', features: [] };

  // ---------- junction numbers (OpenStreetMap, motorway_junction nodes) ----------
  // The map tiles don't carry junction numbers, so they're fetched once per area (about 50 x 30 km in the UK)
  // and kept on the phone; junctions rarely change, so an area is only fetched again after 90 days.
  const JZ = 9, KEEP = 90 * 864e5;
  const cellOf = (lng, lat) => { const n = 2 ** JZ; return [Math.floor((lng + 180) / 360 * n), Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n)]; };
  const cellBox = (x, y) => { const n = 2 ** JZ, lon = v => v / n * 360 - 180, lat = v => Math.atan(Math.sinh(Math.PI * (1 - 2 * v / n))) * 180 / Math.PI; return [lat(y + 1), lon(x), lat(y), lon(x + 1)]; };
  const jn = {}; // cell -> [[lng, lat, label], ...]
  let jBusy = false, jFailAt = 0;

  function jLabel(ref) {
    ref = String(ref).split(';')[0].trim();
    return /^\d{1,3}[a-z]?$/i.test(ref) ? 'J' + ref : ref.length <= 6 ? ref : '';
  }
  function jDraw() {
    const feats = [];
    for (const k in jn) for (const p of jn[k]) feats.push({ type: 'Feature', properties: { label: p[2] }, geometry: { type: 'Point', coordinates: [p[0], p[1]] } });
    OR.setData('jn', { type: 'FeatureCollection', features: feats });
  }
  async function jFetch(x, y) {
    const key = 'jn9_' + x + '_' + y, saved = OR.store.get(key, null);
    if (saved && Date.now() - saved.at < KEEP) { jn[x + '/' + y] = saved.p; return false; }
    const b = cellBox(x, y);
    const els = await OR.overpassRaw('[out:json][timeout:40];node["highway"="motorway_junction"]["ref"](' + b.map(v => v.toFixed(4)).join(',') + ');out;');
    const p = [];
    for (const e of els) {
      const lab = jLabel((e.tags || {}).ref); if (!lab) continue;
      // each junction is usually mapped on both carriageways; show the number once
      if (p.some(q => q[2] === lab && Math.abs(q[0] - e.lon) < 0.02 && Math.abs(q[1] - e.lat) < 0.012)) continue;
      p.push([+e.lon.toFixed(5), +e.lat.toFixed(5), lab]);
    }
    jn[x + '/' + y] = p; OR.store.set(key, { at: Date.now(), p });
    return true;
  }
  async function jUpdate() {
    const m = OR.map; if (!m || OR.cfg.mapJunctions === false || m.getZoom() < 9 || jBusy) return;
    const b = m.getBounds(), a = cellOf(b.getWest(), b.getNorth()), c = cellOf(b.getEast(), b.getSouth());
    const todo = [];
    for (let x = a[0]; x <= c[0]; x++) for (let y = a[1]; y <= c[1]; y++) if (!jn[x + '/' + y]) todo.push([x, y]);
    if (!todo.length || todo.length > 6) return;
    jBusy = true;
    let changed = false;
    for (const [x, y] of todo) {
      if (!OR.store.get('jn9_' + x + '_' + y, null) && (Date.now() - jFailAt < 120000 || !OR.online())) continue; // a busy server: try again in 2 minutes
      try { await jFetch(x, y); changed = true; } catch (e) { jFailAt = Date.now(); break; }
    }
    jBusy = false;
    if (changed) jDraw();
  }

  // ---------- road closures and roadworks (TomTom live incidents, needs the free key) ----------
  // The free key allows 2,500 checks a month, so the map only asks when it has moved somewhere new,
  // at most every 10 minutes for the same area, and stops for the day at 60 checks.
  const TOMTOM = 'https://api.tomtom.com/traffic/services/5/incidentDetails';
  const CLOSED = 8, WORKS = 9;
  let cLast = null, cBusy = false, cList = [];
  const today = () => new Date().toISOString().slice(0, 10);
  function cBudget() { const u = OR.store.get('ttUse', {}); return u.d === today() ? u.n : 0; }
  function cSpend() { OR.store.set('ttUse', { d: today(), n: cBudget() + 1 }); }
  OR.closuresOn = () => OR.cfg.mapClosures !== false && !!(OR.cfg.tomtomKey || '').trim();

  async function cUpdate(force) {
    const m = OR.map; if (!m || cBusy) return;
    if (!OR.closuresOn() || m.getZoom() < 8) { if (!OR.closuresOn()) OR.setData('closed', EMPTY); return; }
    const c = m.getCenter(), now = Date.now();
    // the area asked about: the view, widened, but within TomTom's 10,000 km² limit (about 90 x 90 km)
    const b = m.getBounds(), k = 1 / Math.cos(c.lat * Math.PI / 180), clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    // at least about 35 km each way, so a ride zoomed in close doesn't ask again every few minutes
    const latH = clamp((b.getNorth() - b.getSouth()) * 0.75, 0.32, 0.4), lngH = clamp((b.getEast() - b.getWest()) * 0.75, 0.32 * k, 0.4 * k);
    if (!force && cLast) {
      const inside = Math.abs(c.lat - cLast.lat) < cLast.latH * 0.5 && Math.abs(c.lng - cLast.lng) < cLast.lngH * 0.5;
      if (inside && now - cLast.at < 10 * 60000) return;
      if (now - cLast.at < 60000) return;
    }
    if (cBudget() >= 60 || !OR.online()) return;
    cBusy = true;
    try {
      const bb = [c.lng - lngH, c.lat - latH, c.lng + lngH, c.lat + latH].map(v => v.toFixed(4)).join(',');
      const fields = '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,from,to,roadNumbers,startTime,endTime,events{description}}}}';
      cSpend();
      const j = await OR.json(TOMTOM + '?key=' + encodeURIComponent(OR.cfg.tomtomKey.trim()) + '&bbox=' + bb + '&language=en-GB&timeValidityFilter=present&categoryFilter=' + CLOSED + ',' + WORKS + '&fields=' + encodeURIComponent(fields), { timeout: 20000 });
      cLast = { lat: c.lat, lng: c.lng, latH, lngH, at: now };
      cList = [];
      const feats = [];
      for (const inc of j.incidents || []) {
        const g = inc.geometry, p = inc.properties || {}; if (!g) continue;
        const kind = p.iconCategory === CLOSED ? 'closed' : 'works';
        const i = cList.length;
        cList.push({ kind, text: (p.events || []).map(e => e.description).filter(Boolean).join(', '), roads: (p.roadNumbers || []).join(', '), from: p.from || '', to: p.to || '', end: p.endTime || '' });
        const line = g.type === 'LineString' ? g.coordinates : null, pt = line ? line[Math.floor(line.length / 2)] : g.coordinates;
        if (line && line.length > 1) feats.push({ type: 'Feature', properties: { kind, i }, geometry: g });
        feats.push({ type: 'Feature', properties: { kind, i, pin: 1 }, geometry: { type: 'Point', coordinates: pt } });
      }
      OR.setData('closed', { type: 'FeatureCollection', features: feats });
    } catch (e) {
      cLast = { lat: c.lat, lng: c.lng, latH: 0, lngH: 0, at: now }; // don't hammer it; try again after a minute
      if (/403|401/.test(e.message)) OR.toast('Road closures: TomTom didn\'t accept the key. Check it in Settings, Map and routing.', 6000);
    }
    cBusy = false;
  }
  OR.refreshClosures = () => { cLast = null; return cUpdate(true); };

  OR.closureInfo = function (i) {
    const x = cList[i]; if (!x) return null;
    const until = x.end ? new Date(x.end) : null;
    return { title: (x.kind === 'closed' ? 'Road closed' : 'Roadworks') + (x.roads ? ', ' + x.roads : ''), text: x.text,
      where: x.from && x.to ? x.from + ' to ' + x.to : x.from || x.to, until: until && !isNaN(until) ? until.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + until.toTimeString().slice(0, 5) : '' };
  };

  // ---------- wiring ----------
  let t = 0;
  function onMove() { clearTimeout(t); t = setTimeout(() => { jUpdate(); cUpdate(); }, 800); }
  OR.mapLiveRefresh = function () {
    if (OR.cfg.mapJunctions === false) OR.setData('jn', EMPTY); else jDraw();
    if (!OR.closuresOn()) OR.setData('closed', EMPTY);
    onMove();
  };
  OR.mapLiveStart = function () {
    const m = OR.map; if (!m) return;
    m.on('moveend', onMove);
    // while riding the map keeps moving, so moveend fires often; the checks above keep the requests rare
    setInterval(() => { if (OR.ride && OR.ride.on) cUpdate(); }, 5 * 60000);
    if (m.loaded()) onMove(); else m.once('load', onMove);
  };
})(window.OR);
