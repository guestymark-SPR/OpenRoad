/* OpenRoad interface: panel views, map taps, waypoints, riding display. */
'use strict';
(function (OR) {
  const $ = OR.$, $$ = OR.$$, esc = OR.esc, A = OR.native;
  const ICON = {
    up: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>', down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    vol: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9Z M16 9a4 4 0 0 1 0 6 M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
    mute: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9Z M16 9l5 6 M21 9l-5 6"/></svg>'
  };

  // ---------- startup ----------
  function boot() {
    if (!window.maplibregl) { window.__mlReady = boot; return; }
    OR.initMap();
    document.documentElement.dataset.theme = OR.themeNow();
    bindTop(); bindPanel(); bindHud(); bindMapTaps();
    renderAll();
    OR.recoverRide();
    drawWaypoints();
    OR.on('style', () => { if (OR.plan.route) showOptions(); });
    if (OR.cfg.checkinAt && OR.cfg.checkinAt < Date.now() - 864e5) OR.checkin.cancel();
    if (!OR.store.get('seenIntro', false)) intro();
    setTimeout(checkUpdate, 4000);
  }
  // the Android app checks GitHub for a newer version (published by the build workflow)
  // manual = from the Settings button: always answers, and offers a version you skipped before
  function checkUpdate(manual) {
    if (!A || !A.versionCode) return;
    if (manual === true) OR.toast('Checking for updates…');
    OR.json('https://github.com/guestymark-SPR/OpenRoad/releases/download/app/version.json?t=' + Date.now()).then(v => {
      if (!(v.versionCode > A.versionCode())) { if (manual === true) OR.toast('You have the latest version (' + A.version() + ')'); return; }
      if (manual !== true && OR.store.get('skipVersion', 0) === v.versionCode) return;
      sheet('<h2>Update available</h2><p>OpenRoad ' + esc(v.versionName) + ': ' + esc(v.notes || 'improvements and fixes') + '</p><button id="updGo" class="wide pri">Install update</button><button id="updLater" class="wide">Not now</button>',
        b => { $('#updGo', b).onclick = () => { A.installUpdate(v.apk); closeSheet(); OR.toast('Downloading the update…'); };
               $('#updLater', b).onclick = () => { OR.store.set('skipVersion', v.versionCode); closeSheet(); }; });
    }).catch(e => { if (manual === true) OR.toast('Could not check for updates: ' + (OR.online() ? e.message : 'no signal'), 5000); });
  }
  OR.checkUpdate = checkUpdate;
  window.onUpdateState = s => { if (s === 'permission') OR.toast('Allow OpenRoad to install apps, then tap Install update again', 7000); if (s === 'error') OR.toast('The update could not be downloaded'); };
  function renderAll() { renderPlan(); renderRoutes(); renderRides(); renderTrip(); renderMaps(); renderSettings(); }

  // ---------- panel ----------
  function bindPanel() {
    $$('#tabs button').forEach(b => b.onclick = () => tab(b.dataset.tab));
    $('#grab').onclick = () => $('#panel').classList.toggle('open');
    $('#menuBtn').onclick = () => $('#panel').classList.toggle('open');
  }
  function tab(t) {
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    $$('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + t));
    $('#panel').classList.add('open');
    if (t === 'maps') renderMaps(); if (t === 'rides') renderRides(); if (t === 'routes') renderRoutes(); if (t === 'trip') renderTrip();
  }
  OR.tab = tab;

  // ---------- search ----------
  function bindTop() {
    const q = $('#q'), res = $('#results'); let timer;
    const go = () => {
      const s = q.value.trim(); if (s.length < 2) { res.hidden = true; return; }
      const ll = OR.parseLatLon(s);
      if (ll) return showResults([ll]);
      res.hidden = false; res.innerHTML = '<div class="muted pad">Searching…</div>';
      OR.search(s).then(showResults).catch(e => { res.innerHTML = '<div class="muted pad">Search needs a signal (' + esc(e.message) + ')</div>'; });
    };
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(go, 450); });
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(timer); go(); } });
    $('#qGo').onclick = go;
    document.addEventListener('click', e => { if (!$('#top').contains(e.target)) res.hidden = true; });
    function showResults(list) {
      res.hidden = false;
      if (!list.length) { res.innerHTML = '<div class="muted pad">Nothing found</div>'; return; }
      res.innerHTML = list.map((r, i) => '<button class="res" data-i="' + i + '"><b>' + esc(r.name) + '</b><span>' + esc(r.sub) + '</span></button>').join('');
      $$('.res', res).forEach(b => b.onclick = () => {
        const r = list[+b.dataset.i]; res.hidden = true; q.value = r.name; q.blur();
        OR.map.flyTo({ center: [r.lng, r.lat], zoom: Math.max(OR.map.getZoom(), 12) });
        placeMenu([r.lng, r.lat], r.name);
      });
    }
    $('#locBtn').onclick = () => {
      OR.startGps();
      if (OR.ride.on) { OR.ride.follow = true; $('#recentre').hidden = true; return; }
      if (OR.pos) OR.map.flyTo({ center: [OR.pos.lng, OR.pos.lat], zoom: Math.max(13, OR.map.getZoom()) });
      else { OR.toast('Finding your position…'); OR.on('fix', firstFix); }
    };
    let flew = false;
    function firstFix(p) { if (flew || OR.ride.on) return; flew = true; OR.map.flyTo({ center: [p.lng, p.lat], zoom: 13 }); }
    $('#northBtn').onclick = () => OR.map.easeTo({ bearing: 0, pitch: 0 });
    OR.map.on('rotate', () => { $('#northBtn svg').style.transform = 'rotate(' + (-OR.map.getBearing()) + 'deg)'; });
    $('#themeBtn').onclick = () => {
      const order = ['auto', 'day', 'night'], cur = order.indexOf(OR.cfg.theme);
      OR.cfg.theme = order[(cur + 1) % 3]; OR.saveCfg(); OR.applyTheme();
      OR.toast('Map: ' + { auto: 'Auto (night after sunset)', day: 'Day', night: 'Night' }[OR.cfg.theme]);
      renderSettings();
    };
  }

  // ---------- map taps ----------
  let popup = null;
  function bindMapTaps() {
    OR.map.on('click', e => {
      if (OR.ride.on) return;
      const hit = OR.map.queryRenderedFeatures(e.point, { layers: ['ov-pois', 'ov-alts'].filter(l => OR.map.getLayer(l)) });
      if (hit.length && hit[0].layer.id === 'ov-alts') { const i = hit[0].properties.i; if (i != null) chooseOption(+i); return; }
      if (hit.length) return;
      placeMenu([e.lngLat.lng, e.lngLat.lat]);
    });
    OR.on('poi', f => poiPopup(f));
  }
  function closePopup() { if (popup) { popup.remove(); popup = null; } }
  function placeMenu(ll, name) {
    closePopup();
    const el = document.createElement('div'); el.className = 'pm';
    const has = OR.plan.wps.length;
    el.innerHTML = '<div class="pm-name">' + esc(name || 'This spot') + '</div>' +
      '<div class="pm-btns">' +
      (has ? '' : '<button data-a="start">Start here</button>') +
      (has ? '<button data-a="via">Add via point</button><button data-a="end" class="pri">Go here</button>' : '<button data-a="end" class="pri">Go here</button>') +
      '<button data-a="stay">Stays nearby</button><button data-a="fuel">Fuel nearby</button></div>';
    popup = new maplibregl.Popup({ closeButton: true, maxWidth: '300px', className: 'orpop' }).setLngLat(ll).setDOMContent(el).addTo(OR.map);
    const label = name ? Promise.resolve(name) : OR.reverseName(ll[0], ll[1]);
    if (!name) label.then(n => { if (n) $('.pm-name', el).textContent = n; });
    $$('button', el).forEach(b => b.onclick = async () => {
      const a = b.dataset.a; closePopup();
      if (a === 'stay' || a === 'fuel') return findNearby(a, ll);
      const nm = (await label.catch(() => null)) || (ll[1].toFixed(4) + ', ' + ll[0].toFixed(4));
      const w = { lng: ll[0], lat: ll[1], name: nm, type: 'through' };
      const wps = OR.plan.wps;
      if (a === 'start') wps.unshift(Object.assign(w, { type: 'break' }));
      else if (a === 'end') {
        if (!wps.length) { if (OR.pos) wps.push({ lng: OR.pos.lng, lat: OR.pos.lat, name: 'My position', type: 'break' }); else { OR.toast('Start set here. Tap where you want to go.'); wps.push(Object.assign(w, { type: 'break' })); changed(); return; } }
        if (wps.length >= 2 && wps[wps.length - 1].type !== 'through') wps[wps.length - 1].type = 'through';
        wps.push(Object.assign(w, { type: 'break' }));
      } else if (a === 'via') { if (wps.length >= 2) wps.splice(wps.length - 1, 0, w); else wps.push(w); }
      changed(wps.length >= 2);
    });
  }
  function poiPopup(f) {
    const p = (OR.lastPois || []).find(x => x.id === f.properties.id); if (!p) return;
    const d = OR.poiDetails(p);
    closePopup();
    const el = document.createElement('div'); el.className = 'pm';
    el.innerHTML = '<div class="pm-name">' + esc(p.name) + '</div><div class="muted">' + esc([d.type, d.stars && d.stars + '★'].filter(Boolean).join(' · ')) + '</div>' +
      (d.addr ? '<div class="small">' + esc(d.addr) + '</div>' : '') + (d.hours ? '<div class="small">Hours: ' + esc(d.hours) + '</div>' : '') +
      '<div class="pm-btns">' + (d.phone ? '<a class="btn" href="tel:' + esc(d.phone.replace(/\s/g, '')) + '">Call</a>' : '') +
      (d.web ? '<a class="btn" target="_blank" href="' + esc(/^https?:/.test(d.web) ? d.web : 'https://' + d.web) + '">Website</a>' : '') +
      '<button data-a="stop">Add as stop</button><button data-a="go" class="pri">Go here</button></div>';
    popup = new maplibregl.Popup({ maxWidth: '300px', className: 'orpop' }).setLngLat([p.lng, p.lat]).setDOMContent(el).addTo(OR.map);
    $$('button', el).forEach(b => b.onclick = () => {
      closePopup();
      const w = { lng: p.lng, lat: p.lat, name: p.name, type: 'break' };
      if (OR.ride.on && OR.pos) { // while riding: go there now, then carry on
        const r = OR.ride.route;
        const rest = r ? r.wps.slice(1) : [];
        OR.plan.wps = [{ lng: OR.pos.lng, lat: OR.pos.lat, name: 'Here', type: 'break' }, w].concat(b.dataset.a === 'stop' ? rest : []);
        return planAndRide();
      }
      const wps = OR.plan.wps;
      if (b.dataset.a === 'go') { if (!wps.length && OR.pos) wps.push({ lng: OR.pos.lng, lat: OR.pos.lat, name: 'My position', type: 'break' }); wps.push(w); }
      else { if (wps.length >= 2) wps.splice(wps.length - 1, 0, w); else wps.push(w); }
      changed(wps.length >= 2);
    });
  }

  // ---------- waypoints ----------
  let wpMarkers = [];
  function drawWaypoints() {
    wpMarkers.forEach(m => m.remove()); wpMarkers = [];
    const wps = OR.plan.wps;
    wps.forEach((w, i) => {
      const el = document.createElement('div');
      const end = i === wps.length - 1 && wps.length > 1;
      el.className = 'wp ' + (i === 0 ? 'wp-a' : end ? 'wp-b' : w.type === 'break' ? 'wp-stop' : 'wp-via');
      el.textContent = i === 0 ? 'A' : end ? 'B' : String(i);
      const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([w.lng, w.lat]).addTo(OR.map);
      m.on('dragend', () => { const ll = m.getLngLat(); w.lng = ll.lng; w.lat = ll.lat; w.name = 'Moved point';
        OR.reverseName(ll.lng, ll.lat).then(n => { if (n) { w.name = n; OR.savePlan(); renderPlan(); } });
        changed(wps.length >= 2); });
      wpMarkers.push(m);
    });
  }
  function changed(replan) {
    OR.savePlan(); drawWaypoints();
    OR.plan.route = null; OR.plan.options = []; OR.setData('route', null); OR.setData('alts', null); OR.setData('gaps', null);
    renderPlan(); tab('plan');
    if (replan) doPlan();
  }

  // ---------- plan view ----------
  let planning = false, planErr = '';
  function renderPlan() {
    const v = $('#v-plan'), wps = OR.plan.wps, r = OR.plan.route;
    const st = Object.keys(OR.STYLES).reverse().map(k => '<button data-s="' + k + '" class="' + (OR.cfg.style === k ? 'on' : '') + '">' + OR.STYLES[k].label + '</button>').join('');
    let h = '<div class="seg" id="styleSeg">' + st + '</div>';
    if (!wps.length) h += '<p class="hint">Search for a place, or tap the map, to set where you are going. Tap again to add via points through the roads you want to ride.</p>' +
      (OR.pos ? '<button id="fromHere" class="wide">Start from my position</button>' : '');
    else {
      h += '<ol class="wps">' + wps.map((w, i) => {
        const end = i === wps.length - 1 && wps.length > 1;
        const tag = i === 0 ? 'A' : end ? 'B' : String(i);
        const cls = i === 0 ? 'wp-a' : end ? 'wp-b' : w.type === 'break' ? 'wp-stop' : 'wp-via';
        return '<li><span class="wp ' + cls + '">' + tag + '</span><span class="wpn">' + esc(w.name || 'Point') +
          (i > 0 && !end ? '<small>' + (w.type === 'break' ? 'Stop' : 'Via') + '</small>' : '') + '</span>' +
          (i > 0 && !end ? '<button class="mini" data-k="' + i + '" data-a="kind" title="Stop or via">' + (w.type === 'break' ? 'Via' : 'Stop') + '</button>' : '') +
          '<button class="mini" data-k="' + i + '" data-a="up" aria-label="Move up">' + ICON.up + '</button><button class="mini" data-k="' + i + '" data-a="down" aria-label="Move down">' + ICON.down + '</button>' +
          '<button class="mini" data-k="' + i + '" data-a="rm" aria-label="Remove">' + ICON.x + '</button></li>';
      }).join('') + '</ol>';
      h += '<div class="row">' + (wps.length >= 2 ? '<button id="planGo" class="pri">' + (planning ? 'Planning…' : 'Plan route') + '</button>' : '') +
        '<button id="rev">Reverse</button><button id="loop">Back to start</button><button id="clr">Clear</button></div>';
      if (wps.length === 1) h += '<p class="hint">Now tap the map or search for where you want to go.</p>';
    }
    if (planErr) h += '<p class="err">' + esc(planErr) + '</p>';
    if (OR.plan.options.length) {
      h += '<h3>Route options</h3><div class="opts">' + OR.plan.options.map((o, i) =>
        '<button class="opt' + (i === OR.plan.choice ? ' on' : '') + '" data-i="' + i + '"><b>' + esc(o.variant) + '</b>' +
        '<span>' + OR.fmtDist(o.dist) + ' · ' + OR.fmtTime(o.time) + '</span>' +
        '<span>' + OR.bendLabel(o.twist) + ' (' + o.twist + '°/mi) · motorway ' + o.mwayPct + '%</span></button>').join('') + '</div>';
      h += '<button id="ride" class="wide go">Start ride</button>';
      h += '<div class="row"><button id="save">Save</button><button id="fuelChk">Check fuel</button><button id="stays">Stays at end</button></div>' +
        '<div class="row"><button id="gpx">Export GPX</button><button id="shareR">Share</button>' + (A ? '<button id="offl">Save map offline</button>' : '') + '</div>';
      h += '<div id="fuelOut"></div>';
      h += '<details><summary>Turn-by-turn list (' + r.man.length + ' steps)</summary><ol class="dirs">' + r.man.map(m =>
        '<li>' + OR.arrow(m.type) + '<span>' + esc(m.text) + (m.len > 0 ? '<small>then ' + OR.fmtDist(m.len) + '</small>' : '') + '</span></li>').join('') + '</ol></details>';
      h += '<p class="small muted">Bendiness counts how much the road curves per mile, leaving out junctions. Use it to compare options rather than as an exact measure.</p>';
    }
    v.innerHTML = h;
    $$('#styleSeg button', v).forEach(b => b.onclick = () => { OR.cfg.style = b.dataset.s; OR.saveCfg(); renderPlan(); if (wps.length >= 2) doPlan(); });
    const on = (id, fn) => { const el = $('#' + id, v); if (el) el.onclick = fn; };
    on('fromHere', () => { OR.plan.wps.push({ lng: OR.pos.lng, lat: OR.pos.lat, name: 'My position', type: 'break' }); changed(); });
    on('planGo', doPlan);
    on('rev', () => { wps.reverse(); fixTypes(); changed(wps.length >= 2); });
    on('loop', () => { if (wps.length) { wps.push(Object.assign({}, wps[0], { type: 'break' })); fixTypes(); changed(wps.length >= 2); } });
    on('clr', () => { OR.plan.wps = []; planErr = ''; changed(); });
    $$('.wps .mini', v).forEach(b => b.onclick = () => {
      const k = +b.dataset.k, a = b.dataset.a;
      if (a === 'rm') wps.splice(k, 1);
      else if (a === 'up' && k > 0) wps.splice(k - 1, 0, wps.splice(k, 1)[0]);
      else if (a === 'down' && k < wps.length - 1) wps.splice(k + 1, 0, wps.splice(k, 1)[0]);
      else if (a === 'kind') wps[k].type = wps[k].type === 'break' ? 'through' : 'break';
      fixTypes(); changed(wps.length >= 2);
    });
    $$('.opt', v).forEach(b => b.onclick = () => chooseOption(+b.dataset.i));
    on('ride', () => startRide(OR.plan.route));
    on('save', () => { const n = prompt('Name this route', r.name); if (n == null) return; r.name = n.trim() || r.name; OR.routes.save(r); OR.toast('Saved to Routes'); renderRoutes(); });
    on('fuelChk', () => fuelCheck(r));
    on('stays', () => { const e = r.shape[r.shape.length - 1]; findNearby('stay', e); });
    on('gpx', () => OR.saveFile(OR.fileName(r.name) + '.gpx', OR.toGpx(r)));
    on('shareR', () => OR.share(shareText(r), r.name));
    on('offl', () => OR.saveRouteMap(r));
  }
  function fixTypes() { const w = OR.plan.wps; if (w.length) { w[0].type = 'break'; w[w.length - 1].type = 'break'; } }
  function shareText(r) {
    const a = r.wps[0], b = r.wps[r.wps.length - 1];
    return r.name + ' — ' + OR.fmtDist(r.dist) + ', about ' + OR.fmtTime(r.time) + '\n' +
      r.wps.map((w, i) => (i === 0 ? 'Start: ' : i === r.wps.length - 1 ? 'End: ' : 'Via: ') + (w.name || '') + ' https://maps.google.com/?q=' + w.lat.toFixed(5) + ',' + w.lng.toFixed(5)).join('\n') +
      '\nPlanned with OpenRoad';
  }

  async function doPlan() {
    if (planning) return; planning = true; planErr = ''; renderPlan();
    try {
      await OR.planRoute();
      showOptions(true);
    } catch (e) { planErr = 'Could not plan the route: ' + e.message + (OR.online() ? '' : ' (no signal: planning needs the internet; saved routes work offline)'); }
    planning = false; renderPlan();
  }
  function showOptions(fit) {
    const o = OR.plan.options, c = OR.plan.choice;
    OR.setData('alts', { type: 'FeatureCollection', features: o.map((r, i) => i === c ? null : { type: 'Feature', properties: { i }, geometry: { type: 'LineString', coordinates: r.shape } }).filter(Boolean) });
    OR.setData('route', { type: 'FeatureCollection', features: [OR.routeGeo(o[c])] });
    if (fit) fitRoute(o[c]);
  }
  function chooseOption(i) { OR.plan.choice = i; OR.plan.route = OR.plan.options[i]; OR.setData('gaps', null); showOptions(); renderPlan(); }
  function fitRoute(r) {
    const wide = window.innerWidth >= 900;
    OR.map.fitBounds(OR.bbox(r.shape), { padding: wide ? { top: 80, bottom: 60, left: 440, right: 80 } : { top: 90, bottom: Math.round(window.innerHeight * 0.5), left: 40, right: 40 }, duration: 800, maxZoom: 14 });
  }
  OR.fitRoute = fitRoute;

  async function fuelCheck(r) {
    const out = $('#fuelOut'); if (out) out.innerHTML = '<p class="muted">Looking for fuel stations along the route…</p>';
    try {
      const f = await OR.fuelAlong(r);
      OR.ride.fuel = f.list; OR.lastPois = f.list;
      OR.setData('pois', OR.poiGeo(f.list)); OR.setData('gaps', OR.gapGeo(r, f.gaps));
      let h = '<div class="card"><b>' + f.list.length + ' fuel stations within a mile of the route</b>';
      if (!f.range) h += '<p class="small">Add your tank size and mpg in Trip › Bike & fuel to see where fuel gaps are too long for your range.</p>';
      else if (!f.gaps.length) h += '<p class="small ok">No gap is longer than your safe range (' + OR.fmtDist(f.range - OR.cfg.bike.reserveMi * OR.MI) + ' to reserve).</p>';
      else h += f.gaps.map(g => '<p class="small warn">' + (g.first ? 'From the start (with the fuel you have now): ' : '') + OR.fmtDist(g.len) + ' with no fuel near the route, from mile ' + Math.round(g.from / OR.MI) + ' to ' + Math.round(g.to / OR.MI) + '. Shown in red on the map.</p>').join('');
      h += '<p class="small muted">From OpenStreetMap. Opening hours and whether a station is open are not always recorded, so check small stations before relying on them.</p></div>';
      if (out) out.innerHTML = h;
    } catch (e) { if (out) out.innerHTML = '<p class="err">Fuel search failed: ' + esc(e.message) + '</p>'; }
  }

  async function findNearby(kind, ll) {
    OR.toast('Looking for ' + OR.KINDS[kind].label.toLowerCase() + '…');
    try {
      const list = await OR.nearby(kind, ll[0], ll[1], kind === 'fuel' ? 8000 : 10000);
      OR.lastPois = list; OR.setData('pois', OR.poiGeo(list));
      if (!list.length) { OR.toast('None found within ' + OR.fmtDist(kind === 'fuel' ? 8000 : 10000)); return; }
      sheet('<h3>' + OR.KINDS[kind].label + ' nearby</h3><p class="small muted">From OpenStreetMap. Prices and availability are not included: use the website or phone number to book.</p><div class="list">' +
        list.slice(0, 40).map((p, i) => { const d = OR.poiDetails(p); return '<button class="li" data-i="' + i + '"><b>' + esc(p.name) + '</b><span>' + esc([d.type, OR.fmtDist(p.d) + ' away', d.phone ? '☎' : '', d.web ? 'web' : ''].filter(Boolean).join(' · ')) + '</span></button>'; }).join('') + '</div>',
        box => $$('.li', box).forEach(b => b.onclick = () => { const p = list[+b.dataset.i]; closeSheet(); OR.map.flyTo({ center: [p.lng, p.lat], zoom: 15 }); setTimeout(() => poiPopup({ properties: { id: p.id } }), 600); }));
      if (!OR.ride.on) OR.map.fitBounds(OR.bbox(list.slice(0, 15).map(p => [p.lng, p.lat]).concat([ll])), { padding: 80, maxZoom: 14 });
    } catch (e) { OR.toast('Search failed: ' + e.message, 5000); }
  }

  // ---------- routes view ----------
  function renderRoutes() {
    const v = $('#v-routes'), list = OR.routes.list();
    v.innerHTML = '<label class="wide btn file">Import GPX file<input type="file" id="gpxIn" accept=".gpx,application/gpx+xml,application/xml,text/xml,*/*" hidden></label>' +
      (list.length ? '<div class="list">' + list.map(r => '<div class="li"><b>' + esc(r.name) + '</b><span>' + OR.fmtDist(r.dist) + ' · ' + OR.fmtTime(r.time) +
        (r.twist ? ' · ' + OR.bendLabel(r.twist) : '') + '</span><div class="row"><button data-a="open" data-id="' + r.id + '">Show</button><button data-a="ride" data-id="' + r.id + '" class="pri">Ride</button>' +
        '<button data-a="gpx" data-id="' + r.id + '">GPX</button><button data-a="del" data-id="' + r.id + '">Delete</button></div></div>').join('') + '</div>'
        : '<p class="hint">Saved routes appear here and work with no signal. You can import GPX files, for example from the Ardennes plan, Calimoto, Kurviger or a friend.</p>');
    $('#gpxIn', v).onchange = e => { const f = e.target.files[0]; if (f) f.text().then(t => importGpx(t, f.name)); e.target.value = ''; };
    $$('button[data-a]', v).forEach(b => b.onclick = () => {
      const r = OR.routes.get(b.dataset.id); if (!r) return;
      if (b.dataset.a === 'open') { loadRoute(r); tab('plan'); }
      if (b.dataset.a === 'ride') startRide(r);
      if (b.dataset.a === 'gpx') OR.saveFile(OR.fileName(r.name) + '.gpx', OR.toGpx(r));
      if (b.dataset.a === 'del' && confirm('Delete "' + r.name + '"?')) { OR.routes.del(r.id); renderRoutes(); }
    });
  }
  function loadRoute(r) {
    OR.plan.wps = r.wps.map(w => Object.assign({}, w)); OR.savePlan();
    OR.plan.options = [r]; OR.plan.choice = 0; OR.plan.route = r;
    drawWaypoints(); showOptions(true); renderPlan();
  }
  window.onGpxFile = (name, text) => importGpx(text, name); // Android: a GPX opened from Files or another app
  async function importGpx(text, file) {
    let g; try { g = OR.parseGpx(text); } catch (e) { OR.toast(e.message, 5000); return; }
    const name = g.name || String(file || 'GPX').replace(/\.gpx$/i, '');
    const items = [];
    g.routes.forEach((r, i) => items.push({ label: 'Route: ' + (r.name || 'route ' + (i + 1)) + ' (' + r.pts.length + ' points)', kind: 'rte', d: r }));
    g.tracks.forEach((t, i) => items.push({ label: 'Track: ' + (t.name || 'track ' + (i + 1)) + ' (' + OR.fmtDist(OR.cumulative(t.pts).pop()) + ')', kind: 'trk', d: t }));
    if (!items.length && g.wpts.length > 1) items.push({ label: 'Waypoints (' + g.wpts.length + ')', kind: 'wpt', d: { name, pts: g.wpts } });
    if (!items.length) { OR.toast('No route or track found in this GPX', 5000); return; }
    sheet('<h3>Import ' + esc(name) + '</h3><div class="list">' + items.map((it, i) =>
      '<div class="li"><b>' + esc(it.label) + '</b><div class="row">' +
      (it.kind === 'trk' ? '<button data-i="' + i + '" data-m="exact" class="pri">Follow exactly</button><button data-i="' + i + '" data-m="via">Plan through it</button>'
        : '<button data-i="' + i + '" data-m="via" class="pri">Plan through these points</button>') +
      '</div></div>').join('') + '</div><p class="small muted">"Follow exactly" matches the track to the roads so you get spoken turns on the exact line. "Plan through" routes between up to 30 of its points with your riding style.</p>',
      box => $$('button[data-i]', box).forEach(b => b.onclick = async () => {
        const it = items[+b.dataset.i]; closeSheet();
        try {
          if (b.dataset.m === 'exact') {
            const r = await OR.routeFromTrack(it.d.pts, it.d.name || name);
            OR.routes.save(r); renderRoutes(); loadRoute(r); tab('plan'); OR.toast('Imported and saved to Routes');
          } else {
            let pts = it.d.pts;
            if (pts.length > 30) { // keep the ends and evenly spread points between
              const step = (pts.length - 1) / 29; pts = Array.from({ length: 30 }, (_, k) => pts[Math.round(k * step)]);
            }
            OR.plan.wps = pts.map((p, i) => ({ lng: p[0], lat: p[1], name: p.name || (i === 0 ? 'Start' : i === pts.length - 1 ? 'End' : 'Point ' + i), type: i === 0 || i === pts.length - 1 ? 'break' : 'through' }));
            changed(true);
          }
        } catch (e) { OR.toast('Import failed: ' + e.message, 7000); }
      }));
  }

  // ---------- rides view ----------
  function renderRides() {
    const v = $('#v-rides'), list = OR.rides.list();
    const yr = new Date().getFullYear(), season = list.filter(r => new Date(r.start).getFullYear() === yr);
    const tot = season.reduce((a, r) => ({ d: a.d + r.dist, t: a.t + r.moving }), { d: 0, t: 0 });
    v.innerHTML = '<button id="freeRide" class="wide go">Record a ride (no route)</button>' +
      '<div class="card"><b>' + yr + ' season</b><span>' + season.length + ' rides · ' + OR.fmtDist(tot.d) + ' · ' + OR.fmtTime(tot.t) + ' moving</span></div>' +
      (list.length ? '<div class="list">' + list.map(r => '<div class="li"><b>' + esc(r.name) + '</b><span>' +
        new Date(r.start).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' + OR.fmtDist(r.dist) + ' · ' + OR.fmtTime(r.moving) +
        ' · avg ' + (r.moving ? OR.speed(r.dist / r.moving) : 0) + ' · max ' + OR.speed(r.max) + ' ' + OR.speedUnit() + '</span><div class="row">' +
        '<button data-a="show" data-id="' + r.id + '">Show</button><button data-a="gpx" data-id="' + r.id + '">GPX</button><button data-a="route" data-id="' + r.id + '">Save as route</button><button data-a="del" data-id="' + r.id + '">Delete</button></div></div>').join('') + '</div>'
        : '<p class="hint">Every ride is recorded here: distance, moving time, speeds and the track. Recording carries on with the screen off in the Android app.</p>');
    $('#freeRide', v).onclick = () => startRide(null);
    $$('button[data-a]', v).forEach(b => b.onclick = async () => {
      const r = OR.rides.get(b.dataset.id); if (!r) return; const pts = OR.rides.pts(r);
      if (b.dataset.a === 'show') { OR.setData('rideview', { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: pts } }] }); OR.map.fitBounds(OR.bbox(pts), { padding: 60 }); if (window.innerWidth < 900) $('#panel').classList.remove('open'); }
      if (b.dataset.a === 'gpx') OR.saveFile(OR.fileName(r.name) + '.gpx', OR.toGpx({ name: r.name, pts, times: OR.rides.times(r) }));
      if (b.dataset.a === 'route') { try { const rt = await OR.routeFromTrack(pts, r.name); OR.routes.save(rt); OR.toast('Saved to Routes'); renderRoutes(); } catch (e) { OR.toast('Could not make a route: ' + e.message, 6000); } }
      if (b.dataset.a === 'del' && confirm('Delete this ride?')) { OR.rides.del(r.id); renderRides(); }
    });
  }

  // ---------- trip view ----------
  function field(id, label, val, type, ph) { return '<label class="f"><span>' + label + '</span><input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '" placeholder="' + esc(ph || '') + '"' + (type === 'number' ? ' inputmode="decimal" step="any"' : '') + '></label>'; }
  function renderTrip() {
    const v = $('#v-trip'), b = OR.cfg.bike, ice = OR.cfg.ice, ci = OR.cfg.checkin;
    const range = OR.fuelRange(), left = OR.fuelLeft();
    const at = OR.cfg.checkinAt;
    v.innerHTML =
      '<h3>Nearby</h3><div class="row wrap">' + Object.keys(OR.KINDS).map(k => '<button data-near="' + k + '">' + OR.KINDS[k].label + '</button>').join('') + '</div>' +
      '<p class="small muted">Searches around your position, or the middle of the map if there is no GPS fix.</p>' +
      '<h3>Bike & fuel</h3>' + field('bName', 'Bike', b.name, 'text', 'e.g. Low Rider S') +
      '<div class="two">' + field('bTank', 'Tank (litres)', b.tankL, 'number', 'from the handbook') + field('bMpg', 'Real-world mpg', b.mpg, 'number', 'e.g. 45') + '</div>' +
      field('bRes', 'Warn me with this many miles left', b.reserveMi, 'number') +
      (range ? '<div class="card"><b>Range on a full tank: ' + OR.fmtDist(range) + '</b><span>Since last fill-up: ' + OR.fmtDist(OR.cfg.fuelSince + (OR.ride.on ? OR.ride.dist : 0)) + ' · about ' + OR.fmtDist(left) + ' left</span></div>' : '<p class="hint">Enter tank size and mpg to get range, low-fuel warnings and fuel gap checks on routes.</p>') +
      '<button id="filled" class="wide">I\'ve filled up</button>' +
      '<h3>Safety check-in</h3><p class="small">If you don\'t tap "I\'m OK" by the time you set, the app alarms. If there\'s still no answer after the grace time, your contact gets a text with your last position.</p>' +
      '<div class="two">' + field('cName', 'Contact name', ci.name) + field('cPhone', 'Contact mobile', ci.phone, 'tel', '07…') + '</div>' +
      '<div class="two">' + field('cGrace', 'Grace (minutes)', ci.grace, 'number') + field('cEvery', 'Repeat every (hours, 0 = once)', ci.every, 'number') + '</div>' +
      (at ? '<div class="card warnc"><b>Check-in due ' + OR.clock(new Date(at)) + (new Date(at).toDateString() !== new Date().toDateString() ? ' ' + new Date(at).toLocaleDateString('en-GB') : '') + '</b><div class="row"><button id="ciOk" class="pri">I\'m OK</button><button id="ciOff">Turn off</button></div></div>'
        : '<div class="row"><label class="f inline"><span>Check in by</span><input id="ciTime" type="time" value="' + defaultTime() + '"></label><button id="ciArm" class="pri">Set</button></div>') +
      (A ? '' : '<p class="small muted">In a web browser the text can only be opened for you to send. The Android app sends it itself.</p>') +
      '<h3>Emergency (ICE) card</h3>' + field('iName', 'Your name', ice.name) + '<div class="two">' + field('iBlood', 'Blood group', ice.blood) + field('iReg', 'Bike registration', ice.reg) + '</div>' +
      field('iMed', 'Medical notes (allergies, conditions, medication)', ice.medical) + '<div class="two">' + field('iCN', 'Emergency contact', ice.contactName) + field('iCP', 'Contact number', ice.contactPhone, 'tel') + '</div>' +
      '<button id="iceShow" class="wide">Show ICE card full screen</button><p class="small muted">Kept only on this device.</p>';
    const keep = (id, obj, key, num) => { const el = $('#' + id, v); el.onchange = () => { obj[key] = num ? (el.value === '' ? '' : parseFloat(el.value)) : el.value.trim(); OR.saveCfg(); if (obj === OR.cfg.bike) renderTrip(); }; };
    keep('bName', b, 'name'); keep('bTank', b, 'tankL', 1); keep('bMpg', b, 'mpg', 1); keep('bRes', b, 'reserveMi', 1);
    keep('cName', ci, 'name'); keep('cPhone', ci, 'phone'); keep('cGrace', ci, 'grace', 1); keep('cEvery', ci, 'every', 1);
    keep('iName', ice, 'name'); keep('iBlood', ice, 'blood'); keep('iReg', ice, 'reg'); keep('iMed', ice, 'medical'); keep('iCN', ice, 'contactName'); keep('iCP', ice, 'contactPhone');
    $('#filled', v).onclick = () => { OR.filledUp(); renderTrip(); };
    $$('[data-near]', v).forEach(bt => bt.onclick = () => { const c = OR.pos ? [OR.pos.lng, OR.pos.lat] : OR.map.getCenter().toArray(); findNearby(bt.dataset.near, c); });
    const arm = $('#ciArm', v); if (arm) arm.onclick = () => {
      const [h, m] = $('#ciTime', v).value.split(':').map(Number); if (isNaN(h)) return;
      const d = new Date(); d.setHours(h, m, 0, 0); if (d < Date.now()) d.setDate(d.getDate() + 1);
      if (OR.checkin.armAt(d.getTime())) { OR.toast('Check-in set for ' + OR.clock(d)); renderTrip(); }
    };
    const ok = $('#ciOk', v); if (ok) ok.onclick = () => { OR.checkin.ok(); renderTrip(); };
    const off = $('#ciOff', v); if (off) off.onclick = () => { OR.checkin.cancel(); renderTrip(); };
    $('#iceShow', v).onclick = showIce;
  }
  function defaultTime() { const d = new Date(Date.now() + 4 * 3600000); return String(d.getHours()).padStart(2, '0') + ':00'; }
  function showIce() {
    sheet('<div class="ice"><pre>' + esc(OR.iceText()) + '</pre>' + (OR.cfg.ice.contactPhone ? '<a class="btn wide pri" href="tel:' + esc(OR.cfg.ice.contactPhone.replace(/\s/g, '')) + '">Call ' + esc(OR.cfg.ice.contactName || 'contact') + '</a>' : '') + '</div>');
  }
  OR.on('checkin', () => renderTrip());
  OR.on('checkinDue', () => {
    sheet('<div class="due"><h2>Safety check-in</h2><p>Tap below to let OpenRoad know you are OK. If you don\'t, ' + esc(OR.cfg.checkin.name || 'your contact') + ' will get a text with your position in ' + (OR.cfg.checkin.grace || 10) + ' minutes.</p><button id="dueOk" class="wide go">I\'m OK</button></div>',
      box => $('#dueOk', box).onclick = () => { OR.checkinAlerting = false; OR.checkin.ok(); closeSheet(); renderTrip(); });
  });

  // ---------- maps view ----------
  let catalogue = null, packState = {};
  function renderMaps() {
    const v = $('#v-maps');
    if (!A) { v.innerHTML = '<p class="hint">Offline map packs are part of the Android app. In a browser the map loads from the internet as you go.</p><p class="small">Map data © OpenStreetMap contributors, tiles by OpenFreeMap / OpenMapTiles.</p>'; return; }
    const inst = OR.packs.installed(), info = OR.cacheInfo();
    let h = '<h3>Offline map packs</h3><p class="small">A pack holds the whole country\'s map so it works with no signal. Download on Wi-Fi: big countries are several hundred MB.</p>';
    if (!catalogue) { h += '<p class="muted">Loading the list of packs…</p>'; OR.packs.catalogue().then(c => { catalogue = c; renderMaps(); }).catch(e => { catalogue = []; packState._err = e.message; renderMaps(); }); }
    else if (!catalogue.length) h += '<p class="err">No packs listed yet' + (packState._err ? ' (' + esc(packState._err) + ')' : '') + '. Packs are built on GitHub with the "Build map packs" workflow.</p>';
    else h += '<div class="list">' + catalogue.map(p => {
      const have = inst.find(i => i.id === p.id), st = packState[p.id];
      const prog = st && st.state === 'downloading' ? ' · ' + Math.round(100 * st.done / Math.max(1, st.total)) + '%' : st && /^error/.test(st.state) ? ' · ' + st.state : '';
      return '<div class="li"><b>' + esc(p.name) + '</b><span>' + Math.round(p.size / 1048576) + ' MB' + (p.date ? ' · data from ' + esc(p.date) : '') + (have ? ' · on this device' : '') + prog + '</span><div class="row">' +
        (st && st.state === 'downloading' ? '' : '<button data-get="' + p.id + '" class="' + (have ? '' : 'pri') + '">' + (have ? 'Update' : 'Download') + '</button>') +
        (have ? '<button data-del="' + p.id + '">Delete</button>' : '') + '</div></div>';
    }).join('') + '</div>';
    const extra = inst.filter(i => !(catalogue || []).some(c => c.id === i.id));
    if (extra.length) h += '<div class="list">' + extra.map(p => '<div class="li"><b>' + esc(p.name) + '</b><span>' + Math.round(p.size / 1048576) + ' MB on this device</span><div class="row"><button data-del="' + p.id + '">Delete</button></div></div>').join('') + '</div>';
    if (info) h += '<h3>Saved map tiles</h3><p class="small">' + info.tiles + ' tiles, ' + Math.round(info.bytes / 1048576) + ' MB, from browsing and "Save map offline" on routes.</p><button id="clrCache">Clear saved tiles</button>';
    h += '<p class="small muted">Route planning and place search need a signal. A route you have planned or saved keeps its turn-by-turn directions with no signal.</p>';
    v.innerHTML = h;
    $$('[data-get]', v).forEach(b => b.onclick = () => { const p = catalogue.find(c => c.id === b.dataset.get); packState[p.id] = { state: 'downloading', done: 0, total: p.size }; OR.packs.download(p); renderMaps(); });
    $$('[data-del]', v).forEach(b => b.onclick = () => { if (confirm('Delete this map pack?')) { OR.packs.del(b.dataset.del); renderMaps(); } });
    const cc = $('#clrCache', v); if (cc) cc.onclick = () => { if (confirm('Clear saved map tiles? Downloaded country packs are kept.')) { A.clearTiles(); renderMaps(); } };
  }
  OR.on('pack', s => { packState[s.id] = s; if (s.state === 'done') { OR.toast('Map pack installed'); OR.map.setStyle(OR.buildStyle(OR.map.__mode), { diff: false }); } if ($('#v-maps').classList.contains('on')) renderMaps(); });
  OR.on('tiles', s => { if (s.done === s.total) OR.toast('Map saved for offline: ' + (s.total - s.failed) + ' of ' + s.total + ' tiles' + (s.failed ? ' (' + s.failed + ' failed: try again on a better signal)' : ''), 6000); });

  // ---------- settings ----------
  function renderSettings() {
    const v = $('#v-settings'), c = OR.cfg;
    const seg = (id, val, opts) => '<div class="seg" id="' + id + '">' + opts.map(([k, l]) => '<button data-v="' + k + '" class="' + (val === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
    v.innerHTML = '<h3>Units</h3>' + seg('sUnits', c.units, [['mi', 'Miles'], ['km', 'Kilometres']]) +
      '<h3>Map</h3>' + seg('sTheme', c.theme, [['auto', 'Auto'], ['day', 'Day'], ['night', 'Night']]) +
      '<h3>Voice</h3>' + seg('sVoice', c.voice ? 'on' : 'off', [['on', 'Spoken directions on'], ['off', 'Off']]) + '<button id="sTest">Test voice</button>' +
      '<p class="small muted">Spoken directions play through whatever the phone uses for audio, so pair your helmet headset with the phone over Bluetooth.</p>' +
      '<h3>Routing</h3><label class="chk"><input type="checkbox" id="sTolls"' + (c.avoidTolls ? ' checked' : '') + '> Avoid toll roads</label>' +
      '<label class="chk"><input type="checkbox" id="sFerry"' + (c.avoidFerries ? ' checked' : '') + '> Avoid ferries</label>' +
      (A ? '<h3>Updates</h3><div class="card"><b>OpenRoad ' + esc(A.version()) + '</b><span>The app also checks each time it opens.</span></div><button id="sUpd" class="wide pri">Check for updates</button>' : '') +
      '<h3>About</h3><p class="small">OpenRoad ' + esc(A && A.version ? A.version() : 'web') + '. Free and open. Routing by Valhalla on the FOSSGIS server; search by Photon (Komoot); fuel, stays and cafés from OpenStreetMap via Overpass; map tiles from OpenFreeMap. Map data © OpenStreetMap contributors.</p>' +
      '<p class="small warn">Road data can be out of date. Follow road signs and the law, and keep your eyes on the road: set the route before you ride.</p>' +
      '<button id="sIntro">Show the quick guide</button>';
    const segBind = (id, fn) => $$('#' + id + ' button', v).forEach(b => b.onclick = () => { fn(b.dataset.v); OR.saveCfg(); renderSettings(); });
    segBind('sUnits', x => { c.units = x; renderAll(); });
    segBind('sTheme', x => { c.theme = x; OR.applyTheme(); });
    segBind('sVoice', x => { c.voice = x === 'on'; updateMute(); });
    $('#sTest', v).onclick = () => { const was = c.voice; c.voice = true; OR.say('In half a mile, turn left onto the A537. Then the Cat and Fiddle.'); c.voice = was; };
    $('#sTolls', v).onchange = e => { c.avoidTolls = e.target.checked; OR.saveCfg(); };
    $('#sFerry', v).onchange = e => { c.avoidFerries = e.target.checked; OR.saveCfg(); };
    $('#sIntro', v).onclick = intro;
    const upd = $('#sUpd', v); if (upd) upd.onclick = () => checkUpdate(true);
  }

  // ---------- ride ----------
  function startRide(route) {
    closePopup(); closeSheet();
    if (route && OR.routes.list().every(r => r.id !== route.id)) OR.routes.save(route); // so it's there with no signal
    document.body.classList.add('riding'); $('#hud').hidden = false; $('#panel').classList.remove('open');
    $('#thenBox').hidden = true; $('#hudNote').hidden = true; $('#recentre').hidden = true;
    $('#turn').hidden = !route; $('#hRemainL').textContent = route ? 'to go' : 'ridden'; $('#hEtaL').textContent = route ? 'arrive' : 'riding for';
    OR.ride.fuel = route && OR.ride.fuel && OR.plan.route === route ? OR.ride.fuel : [];
    OR.startRide(route);
    if (route && OR.online() && OR.fuelRange()) OR.fuelAlong(route).then(f => { OR.ride.fuel = f.list; }).catch(() => { });
    updateMute();
    if (OR.pos) OR.map.easeTo({ center: [OR.pos.lng, OR.pos.lat], zoom: 16, pitch: 55 });
  }
  OR.startRideUi = startRide;
  async function planAndRide() {
    OR.toast('Planning…');
    try { const o = await OR.planRoute(); if (OR.ride.on) OR.stopRide(); startRide(o[0]); }
    catch (e) { OR.toast('Could not plan: ' + e.message, 6000); }
  }
  function endRide() {
    const saved = OR.stopRide();
    document.body.classList.remove('riding'); $('#hud').hidden = true;
    if (saved) { OR.toast('Ride saved: ' + OR.fmtDist(saved.dist) + ' in ' + OR.fmtTime(saved.moving), 5000); renderRides(); }
    if (OR.plan.route) showOptions();
    renderTrip();
  }
  function updateMute() { $('#hMute').innerHTML = OR.cfg.voice ? ICON.vol : ICON.mute; $('#hMute').classList.toggle('off', !OR.cfg.voice); }
  function bindHud() {
    $('#hEnd').onclick = () => { if (confirm('End this ride?')) endRide(); };
    $('#hMute').onclick = () => { OR.cfg.voice = !OR.cfg.voice; OR.saveCfg(); if (!OR.cfg.voice) OR.hush(); updateMute(); OR.toast(OR.cfg.voice ? 'Voice on' : 'Voice off'); };
    $('#hView').onclick = () => { OR.ride.follow = false; $('#recentre').hidden = false; if (OR.ride.route) OR.map.fitBounds(OR.bbox(OR.ride.route.shape), { padding: 80, pitch: 0, bearing: 0 }); };
    $('#recentre').onclick = () => { OR.ride.follow = true; $('#recentre').hidden = true; };
    $('#hFuel').onclick = () => { const c = OR.pos ? [OR.pos.lng, OR.pos.lat] : OR.map.getCenter().toArray(); findNearby('fuel', c); };
    OR.map.on('dragstart', () => { if (OR.ride.on) { OR.ride.follow = false; $('#recentre').hidden = false; } });
    OR.on('fix', p => { if (!OR.ride.on) return; $('#hSpeed').textContent = OR.speed(p.speed) || 0; $('#hSpeedU').textContent = OR.speedUnit(); });
    OR.on('ride', s => {
      if (s.free) { $('#hRemain').textContent = OR.fmtDist(OR.ride.dist); $('#hEta').textContent = OR.fmtTime((Date.now() - OR.ride.start) / 1000); return; }
      $('#turnIcon').innerHTML = OR.arrow(s.m.type);
      $('#turnDist').textContent = OR.fmtDist(s.toTurn, true);
      $('#turnStreet').textContent = s.m.street || s.m.text;
      const showThen = s.next && s.m.len < 300 && s.toTurn < 600;
      $('#thenBox').hidden = !showThen; if (showThen) $('#thenIcon').innerHTML = OR.arrow(s.next.type);
      $('#hRemain').textContent = OR.fmtDist(s.remain); $('#hEta').textContent = OR.clock(s.eta);
    });
    OR.on('rerouting', on => { $('#hudNote').hidden = !on; $('#hudNote').textContent = 'Finding a new route…'; });
    OR.on('arrived', () => { $('#hudNote').hidden = false; $('#hudNote').textContent = 'You have arrived. Tap End to save the ride.'; });
    OR.on('fuel', () => { const l = OR.fuelLeft(); if (OR.ride.on && l != null && l < (OR.cfg.bike.reserveMi || 25) * OR.MI) { $('#hudNote').hidden = false; $('#hudNote').textContent = 'Fuel low: about ' + OR.fmtDist(l) + ' left. Tap the pump for fuel nearby.'; } });
  }

  // ---------- sheet (pop-up panel) ----------
  function sheet(html, bind) {
    const s = $('#sheet'), b = $('#sheetBox');
    b.innerHTML = '<button class="sheetX" aria-label="Close">' + ICON.x + '</button>' + html; s.hidden = false;
    $('.sheetX', b).onclick = closeSheet; s.onclick = e => { if (e.target === s) closeSheet(); };
    if (bind) bind(b);
  }
  function closeSheet() { $('#sheet').hidden = true; }
  OR.sheet = sheet;

  function intro() {
    OR.store.set('seenIntro', true);
    sheet('<h2>OpenRoad</h2><ol class="intro"><li><b>Plan</b>: search or tap the map for where you\'re going, then tap more points for the roads you want. Pick <i>Twisty roads</i>, <i>No motorways</i> or <i>Fastest</i>.</li>' +
      '<li><b>Compare</b>: each option shows miles, time, how bendy it is and how much is motorway.</li>' +
      '<li><b>Ride</b>: big turn arrows and spoken directions to your helmet headset. Go off route and it finds a new one.</li>' +
      '<li><b>Trip</b>: set your tank and mpg for range and fuel gap checks, find stays and cafés, keep an ICE card, and set a safety check-in.</li>' +
      '<li><b>Maps</b>: download country packs on Wi-Fi so the map works with no signal.</li></ol><button class="wide pri" id="introOk">Let\'s ride</button>',
      b => $('#introOk', b).onclick = closeSheet);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window.OR);
