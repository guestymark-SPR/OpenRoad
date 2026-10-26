/* OpenRoad map: a road-first style on OpenMapTiles data (OpenFreeMap online, offline packs in the app). */
'use strict';
(function (OR) {
  const NATIVE = !!OR.native;
  // In the app, tiles and label fonts come through the app itself: offline packs first, then saved tiles, then the internet.
  const TILES = NATIVE ? { type: 'vector', tiles: ['https://openroad.maps/t/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 }
                       : { type: 'vector', url: 'https://tiles.openfreemap.org/planet' };
  const GLYPHS = NATIVE ? 'https://openroad.maps/glyphs/{fontstack}/{range}.pbf' : 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
  const ATTR = '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

  const PAL = {
    day: { bg: '#f2efe9', water: '#a9cbe3', wood: '#cfe3c1', grass: '#e0ecd0', park: '#d3e8c4', urban: '#e9e3da', building: '#ddd5ca',
      mway: '#4f86d9', mwayC: '#2c5aa3', trunk: '#3f9a63', trunkC: '#2a6e45', prim: '#f0b44c', primC: '#b97d1e', sec: '#f6dd8a', secC: '#c5a548',
      tert: '#ffffff', tertC: '#b9b0a3', minor: '#ffffff', minorC: '#c9c1b5', track: '#a6927a', text: '#2d2a26', halo: '#ffffff', border: '#9b8fb5', rail: '#9a948c' },
    night: { bg: '#121619', water: '#173246', wood: '#17251b', grass: '#19221a', park: '#18261b', urban: '#1b1f22', building: '#23282c',
      mway: '#3a6fc0', mwayC: '#15305a', trunk: '#2f7f50', trunkC: '#123a23', prim: '#c48a2a', primC: '#5a3c0c', sec: '#9c8640', secC: '#3d3416',
      tert: '#5d6266', tertC: '#2a2d30', minor: '#4a4f53', minorC: '#25282b', track: '#5d5144', text: '#d9dee2', halo: '#0e1113', border: '#6b6390', rail: '#4b4f52' }
  };

  const z = (pairs) => ['interpolate', ['exponential', 1.5], ['zoom']].concat(pairs);
  function roadLayers(c) {
    const cls = (list) => ['match', ['get', 'class'], list, true, false];
    const defs = [
      // [id, classes, colour, casing, widths by zoom, minzoom]
      ['track', ['track'], c.track, null, [10, 0.5, 14, 1.2, 18, 3], 11],
      ['minor', ['minor', 'service'], c.minor, c.minorC, [11, 0.4, 14, 3, 18, 14], 11],
      ['tertiary', ['tertiary'], c.tert, c.tertC, [8, 0.5, 12, 2, 14, 5, 18, 18], 8],
      ['secondary', ['secondary'], c.sec, c.secC, [7, 0.6, 12, 2.6, 14, 6, 18, 20], 7],
      ['primary', ['primary'], c.prim, c.primC, [6, 0.7, 12, 3, 14, 7, 18, 22], 5],
      ['trunk', ['trunk'], c.trunk, c.trunkC, [5, 0.8, 12, 3.4, 14, 8, 18, 24], 4],
      ['motorway', ['motorway'], c.mway, c.mwayC, [4, 0.8, 12, 3.6, 14, 8.5, 18, 26], 4]
    ];
    const out = [];
    for (const [id, classes, col, cas, w, mz] of defs) {
      const filter = ['all', cls(classes), ['!=', ['get', 'brunnel'], 'tunnel']];
      if (cas) out.push({ id: 'rc-' + id, type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: mz + 1, filter,
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': cas, 'line-width': z(w.map((v, i) => i % 2 ? v + 1.6 : v)) } });
      out.push({ id: 'r-' + id, type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: mz, filter,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: id === 'track' ? { 'line-color': col, 'line-width': z(w), 'line-dasharray': [2, 1.5] } : { 'line-color': col, 'line-width': z(w) } });
    }
    // tunnels: faded with dashes
    out.unshift({ id: 'r-tunnel', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 9,
      filter: ['all', ['==', ['get', 'brunnel'], 'tunnel'], cls(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'])],
      paint: { 'line-color': c.tertC, 'line-width': z([10, 1, 14, 4, 18, 14]), 'line-dasharray': [1, 1], 'line-opacity': 0.7 } });
    return out;
  }

  // Satellite view: Esri World Imagery under OpenRoad's roads and labels (needs a signal)
  const SAT = { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19,
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' };
  const FILLS = ['landuse', 'wood', 'grass', 'park', 'water', 'building'];
  OR.buildStyle = function (mode) {
    const st = buildBase(mode);
    if (OR.cfg.mapType !== 'satellite') return st;
    st.sources.sat = SAT;
    st.layers = st.layers.filter(l => FILLS.indexOf(l.id) < 0);
    st.layers.splice(1, 0, { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-brightness-max': mode === 'night' ? 0.7 : 1 } });
    st.layers.forEach(l => { if (/^(r|rc)-(minor|track|tertiary)$/.test(l.id)) l.paint['line-opacity'] = 0.75; });
    return st;
  };
  OR.setMapType = function (t) { OR.cfg.mapType = t; OR.saveCfg(); if (OR.map) { OR.map.setStyle(OR.buildStyle(OR.map.__mode), { diff: false }); } };
  function buildBase(mode) {
    const c = PAL[mode] || PAL.day;
    return {
      version: 8, name: 'OpenRoad ' + mode, glyphs: GLYPHS,
      sources: { omt: Object.assign({ attribution: ATTR }, TILES) },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': c.bg } },
        { id: 'landuse', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['match', ['get', 'class'], ['residential', 'suburb', 'neighbourhood', 'commercial', 'industrial', 'retail'], true, false], paint: { 'fill-color': c.urban, 'fill-opacity': 0.8 } },
        { id: 'wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['match', ['get', 'class'], ['wood', 'forest'], true, false], paint: { 'fill-color': c.wood } },
        { id: 'grass', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['match', ['get', 'class'], ['grass', 'farmland', 'scrub'], true, false], paint: { 'fill-color': c.grass, 'fill-opacity': 0.6 } },
        { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': c.park, 'fill-opacity': 0.6 } },
        { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': c.water } },
        { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', minzoom: 9, paint: { 'line-color': c.water, 'line-width': z([9, 0.5, 14, 2, 18, 6]) } },
        { id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14, paint: { 'fill-color': c.building } },
        { id: 'boundary', type: 'line', source: 'omt', 'source-layer': 'boundary', filter: ['all', ['<=', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]], paint: { 'line-color': c.border, 'line-width': z([3, 0.8, 10, 2.5]), 'line-dasharray': [3, 2] } },
        { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 10, filter: ['==', ['get', 'class'], 'rail'], paint: { 'line-color': c.rail, 'line-width': z([10, 0.6, 16, 2]), 'line-dasharray': [3, 3] } },
        { id: 'ferry', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 6, filter: ['==', ['get', 'class'], 'ferry'], paint: { 'line-color': c.mway, 'line-width': 1.4, 'line-dasharray': [2, 2], 'line-opacity': 0.8 } },
        ...roadLayers(c),
        { id: 'road-ref', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 7,
          filter: ['all', ['has', 'ref'], ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary'], true, false]],
          layout: { 'symbol-placement': 'line', 'symbol-spacing': 350, 'text-field': ['get', 'ref'], 'text-font': ['Noto Sans Bold'], 'text-size': z([7, 10, 14, 13]), 'text-rotation-alignment': 'viewport', 'text-max-angle': 30 },
          paint: { 'text-color': '#ffffff', 'text-halo-color': ['match', ['get', 'class'], 'motorway', c.mwayC, 'trunk', c.trunkC, 'primary', c.primC, c.secC], 'text-halo-width': 3 } },
        { id: 'road-name', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 13,
          filter: ['match', ['get', 'class'], ['primary', 'secondary', 'tertiary', 'minor'], true, false],
          layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': z([13, 11, 18, 14]) },
          paint: { 'text-color': c.text, 'text-halo-color': c.halo, 'text-halo-width': 1.6 } },
        { id: 'peak', type: 'symbol', source: 'omt', 'source-layer': 'mountain_peak', minzoom: 11, filter: ['all', ['has', 'name'], ['==', ['get', 'class'], 'peak']],
          layout: { 'text-field': ['concat', '▲ ', ['coalesce', ['get', 'name:en'], ['get', 'name']]], 'text-font': ['Noto Sans Italic'], 'text-size': 11, 'text-anchor': 'top' },
          paint: { 'text-color': c.text, 'text-halo-color': c.halo, 'text-halo-width': 1.4, 'text-opacity': 0.8 } },
        { id: 'place-village', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 10, filter: ['match', ['get', 'class'], ['village', 'hamlet', 'suburb'], true, false],
          layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': z([10, 11, 15, 15]) },
          paint: { 'text-color': c.text, 'text-halo-color': c.halo, 'text-halo-width': 1.6 } },
        { id: 'place-town', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 6, filter: ['==', ['get', 'class'], 'town'],
          layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Bold'], 'text-size': z([7, 11, 14, 18]) },
          paint: { 'text-color': c.text, 'text-halo-color': c.halo, 'text-halo-width': 1.8 } },
        { id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 3, filter: ['==', ['get', 'class'], 'city'],
          layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Bold'], 'text-size': z([4, 11, 12, 22]) },
          paint: { 'text-color': c.text, 'text-halo-color': c.halo, 'text-halo-width': 2 } },
        { id: 'place-country', type: 'symbol', source: 'omt', 'source-layer': 'place', maxzoom: 7, filter: ['==', ['get', 'class'], 'country'],
          layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Bold'], 'text-size': 14, 'text-transform': 'uppercase', 'text-letter-spacing': 0.1 },
          paint: { 'text-color': c.text, 'text-halo-color': c.halo, 'text-halo-width': 2, 'text-opacity': 0.75 } }
      ]
    };
  }

  // ---------- day / night ----------
  // Sunrise and sunset (NOAA approximation), used for the Auto theme.
  OR.sunTimes = function (lat, lon, date) {
    const d = date || new Date(), rad = Math.PI / 180;
    const day = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5);
    const g = 2 * Math.PI / 365 * (day - 1);
    const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const cosH = (Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl))) - Math.tan(lat * rad) * Math.tan(decl);
    if (cosH > 1 || cosH < -1) return null;
    const ha = Math.acos(cosH) / rad;
    const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return { rise: new Date(base + (720 - 4 * (lon + ha) - eq) * 60000), set: new Date(base + (720 - 4 * (lon - ha) - eq) * 60000) };
  };
  OR.themeNow = function () {
    if (OR.cfg.theme !== 'auto') return OR.cfg.theme;
    const c = OR.map ? OR.map.getCenter() : { lat: 53.5, lng: -2.2 };
    const t = OR.sunTimes(c.lat, c.lng), now = new Date();
    if (!t) return 'day';
    return now > t.rise && now < t.set ? 'day' : 'night';
  };
  OR.applyTheme = function () {
    const m = OR.themeNow();
    document.documentElement.dataset.theme = m;
    if (OR.map && OR.map.__mode !== m) {
      OR.map.__mode = m;
      OR.map.setStyle(OR.buildStyle(m), { diff: false });
      OR.map.once('styledata', () => OR.emit('style'));
    }
  };

  // ---------- events ----------
  const handlers = {};
  OR.on = (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); };
  OR.emit = (ev, a) => { (handlers[ev] || []).forEach(fn => { try { fn(a); } catch (e) { console.error(e); } }); };

  // ---------- overlays (route, alternatives, ride track, points of interest) ----------
  const EMPTY = { type: 'FeatureCollection', features: [] };
  const data = { alts: EMPTY, route: EMPTY, done: EMPTY, track: EMPTY, pois: EMPTY, gaps: EMPTY, rideview: EMPTY };
  OR.setData = function (id, fc) { data[id] = fc || EMPTY; const s = OR.map && OR.map.getSource('ov-' + id); if (s) s.setData(data[id]); };
  function addOverlays() {
    const m = OR.map, night = m.__mode === 'night';
    for (const id in data) if (!m.getSource('ov-' + id)) m.addSource('ov-' + id, { type: 'geojson', data: data[id] });
    const L = (o) => { if (!m.getLayer(o.id)) m.addLayer(o); };
    L({ id: 'ov-alts', type: 'line', source: 'ov-alts', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': night ? '#7c8790' : '#8f99a3', 'line-width': z([5, 4, 14, 9]), 'line-opacity': 0.75 } });
    L({ id: 'ov-route-c', type: 'line', source: 'ov-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': night ? '#000' : '#5a1a00', 'line-width': z([5, 6, 14, 13]), 'line-opacity': 0.6 } });
    L({ id: 'ov-route', type: 'line', source: 'ov-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ff6a1f', 'line-width': z([5, 4, 14, 9]) } });
    L({ id: 'ov-gaps', type: 'line', source: 'ov-gaps', layout: { 'line-cap': 'butt' }, paint: { 'line-color': '#e5243b', 'line-width': z([5, 6, 14, 12]), 'line-opacity': 0.55 } });
    L({ id: 'ov-done', type: 'line', source: 'ov-done', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#9aa3ab', 'line-width': z([5, 4, 14, 9]) } });
    L({ id: 'ov-rideview', type: 'line', source: 'ov-rideview', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#7c3aed', 'line-width': z([5, 3, 14, 7]) } });
    L({ id: 'ov-track', type: 'line', source: 'ov-track', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1fa0ff', 'line-width': z([5, 2, 14, 5]), 'line-opacity': 0.85 } });
    L({ id: 'ov-pois', type: 'circle', source: 'ov-pois', paint: { 'circle-radius': z([6, 5, 14, 9]), 'circle-color': ['match', ['get', 'kind'], 'fuel', '#c62828', 'stay', '#6d4bb3', 'camp', '#0b6b3a', 'view', '#0e7490', 'pass', '#7a5c2e', 'bikeshop', '#334155', 'cam', '#f5c518', 'wx', '#2563eb', '#0e7490'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    L({ id: 'ov-pois-l', type: 'symbol', source: 'ov-pois', minzoom: 10, layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-optional': true },
      paint: { 'text-color': night ? '#e6e9ec' : '#222', 'text-halo-color': night ? '#000' : '#fff', 'text-halo-width': 1.6 } });
  }

  OR.initMap = function () {
    const m = new maplibregl.Map({
      container: 'map', style: OR.buildStyle(OR.themeNow()), center: OR.store.get('view', { c: [-2.1, 53.4] }).c, zoom: OR.store.get('view', { z: 7 }).z,
      attributionControl: false, maxPitch: 70, dragRotate: true, touchPitch: true, fadeDuration: 100
    });
    m.__mode = OR.themeNow();
    OR.map = m;
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    m.addControl(new maplibregl.ScaleControl({ unit: OR.cfg.units === 'km' ? 'metric' : 'imperial' }), 'bottom-left');
    m.on('style.load', addOverlays);
    m.on('styledata', () => { if (m.isStyleLoaded()) addOverlays(); });
    m.on('moveend', () => { const c = m.getCenter(); OR.store.set('view', { c: [c.lng, c.lat], z: m.getZoom() }); });
    m.on('error', e => { if (e && e.error && /Failed to fetch|NetworkError/.test(String(e.error.message))) return; console.warn(e && e.error); });
    m.on('click', 'ov-pois', e => { const f = e.features && e.features[0]; if (f) OR.emit('poi', f); });
    m.on('mouseenter', 'ov-pois', () => m.getCanvas().style.cursor = 'pointer');
    m.on('mouseleave', 'ov-pois', () => m.getCanvas().style.cursor = '');
    setInterval(OR.applyTheme, 5 * 60000);
    return m;
  };
})(window.OR);
