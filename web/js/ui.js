/* OpenRoad interface: navigation, planner, saved routes, rides, nearby, more, riding display. */
'use strict';
(function (OR) {
  const $ = OR.$, $$ = OR.$$, esc = OR.esc, A = OR.native;
  const ic = OR.ic;
  const badge = (i, col) => '<span class="badge" style="--c:' + col + '">' + ic(i) + '</span>';
  OR.badge = badge;
  // road numbers as sign chips: motorways blue, everything else primary-route green with yellow numbers
  const chip = r => '<span class="ref' + (/^(M|A\(M\))\d/.test(r) || /^E\d/.test(r) ? ' mway' : '') + '">' + esc(r) + '</span>';
  OR.refChip = chip;

  // ---------- startup ----------
  function boot() {
    if (!window.maplibregl) { window.__mlReady = boot; return; }
    OR.initMap(); OR.mapLiveStart && OR.mapLiveStart();
    document.documentElement.dataset.theme = OR.themeNow();
    document.documentElement.dataset.look = OR.cfg.look || 'classic';
    // the fixed buttons get the same icon set as everything else
    [['#locBtn', 'locate'], ['#layersBtn', 'layers'], ['#northBtn', 'north'], ['#qGo', 'search'], ['#hMore', 'menu'], ['#groupBtn', 'group']].forEach(([sel, n]) => { const el = $(sel); if (el) el.innerHTML = ic(n); });
    $('#top .logo').innerHTML = ic('moto');
    bindTop(); bindNav(); bindHud(); bindMapTaps();
    renderAll();
    OR.groupBoot && OR.groupBoot();
    OR.crashSync && OR.crashSync();
    if (A && A.setPacksOnly) A.setPacksOnly(!!OR.cfg.packsOnly);
    const resume = OR.rideToResume && OR.rideToResume();
    if (resume) setTimeout(() => startRide(resume.route, resume.snap), 600); else OR.recoverRide();
    // find where you are straight away: the map moves there and the planner offers "Start from my position"
    let found = false;
    OR.on('fix', p => {
      if (found) return; found = true;
      if (!OR.ride.on && !OR.plan.route && !OR.plan.wps.length) OR.map.jumpTo({ center: [p.lng, p.lat], zoom: Math.max(12, OR.map.getZoom()) });
      const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if (!OR.ride.on && !typing && curTab === 'plan') renderPlan();
    });
    OR.gpsAtStart();
    drawWaypoints();
    OR.on('style', () => { if (OR.plan.route) showOptions(); });
    if (OR.cfg.checkinAt && OR.cfg.checkinAt < Date.now() - 864e5) OR.checkin.cancel();
    if (OR.welcomeBoot) OR.welcomeBoot(); else if (!OR.store.get('seenIntro', false)) intro();
    setTimeout(checkUpdate, 4000);
  }
  function renderAll() { renderPlan(); if (curTab !== 'plan') tab(curTab, true); }
  OR.renderAll = renderAll;

  // the Android app checks GitHub for a newer version (published by the build workflow)
  function checkUpdate(manual) {
    if (!A || !A.versionCode) return;
    if (manual === true) OR.toast('Checking for updates…');
    OR.json('https://github.com/guestymark-SPR/OpenRoad/releases/download/app/version.json?t=' + Date.now()).then(v => {
      if (!(v.versionCode > A.versionCode())) { if (manual === true) OR.toast('You have the latest version (' + A.version() + ')'); return; }
      if (manual !== true && OR.store.get('skipVersion', 0) === v.versionCode) return;
      sheet('<h2>Update ready</h2><p>OpenRoad ' + esc(v.versionName) + ': ' + esc(v.notes || 'improvements and fixes') + '</p><button id="updGo" class="btn wide pri">Install update</button><button id="updLater" class="btn wide ghost">Not now</button>',
        b => { $('#updGo', b).onclick = () => { A.installUpdate(v.apk); closeSheet(); OR.toast('Downloading the update…'); };
               $('#updLater', b).onclick = () => { OR.store.set('skipVersion', v.versionCode); closeSheet(); }; });
    }).catch(e => { if (manual === true) OR.toast('Could not check for updates: ' + (OR.online() ? e.message : 'no signal'), 5000); });
  }
  OR.checkUpdate = checkUpdate;
  window.onUpdateState = s => { if (s === 'permission') OR.toast('Allow OpenRoad to install apps, then tap Install update again', 7000); if (s === 'error') OR.toast('The update could not be downloaded'); };

  // ---------- navigation ----------
  const TABS = [['plan', 'Plan', 'plan'], ['trips', 'Trips', 'trips'], ['group', 'Group', 'group'], ['rides', 'Rides', 'moto'], ['bike', 'Bike', 'wrench']];
  function bindNav() {
    $('#nav').innerHTML = '<div class="navsign">' + TABS.map(t => '<button data-tab="' + t[0] + '">' + ic(t[2]) + '<span>' + t[1] + '</span></button>').join('') + '</div>';
    $('#setBtn').innerHTML = ic('gear'); $('#setBtn').onclick = () => { morePage = null; tab('more'); renderMore(); };
    bindChips();
    $$('#nav button').forEach(b => b.onclick = () => {
      const open = $('#panel').classList.contains('open'), same = b.classList.contains('on');
      if (same && open && innerWidth < 900) $('#panel').classList.remove('open'); else tab(b.dataset.tab);
    });
    $('#grab').onclick = () => setMenu(menuLevel() === 0 ? 1 : 0);
    // swipe the menu down to tuck it away (then again to hide it for a full-screen map), up to bring it back
    [$('#grab'), $('#nav'), $('#views')].forEach(el => {
      let y0 = null, x0 = 0, top = 0;
      el.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; top = $('#views').scrollTop; }, { passive: true });
      el.addEventListener('touchend', e => {
        if (y0 == null) return; const t = e.changedTouches[0], dy = t.clientY - y0, dx = Math.abs(t.clientX - x0); y0 = null;
        if (Math.abs(dy) < 60 || dx > Math.abs(dy)) return;
        if (el.id === 'views' && (dy < 0 || top > 0)) return; // in the list, only a pull down from the very top hides it
        const l = menuLevel();
        if (dy > 0 && l < 2) setMenu(l + 1); else if (dy < 0 && l > 0) setMenu(l - 1);
      }, { passive: true });
    });
    $('#menuBtn').innerHTML = ic('menu'); $('#menuBtn').onclick = () => setMenu(innerWidth < 900 ? 1 : 0);
    $('#fullBtn').innerHTML = ic('full'); $('#fullBtn').onclick = () => setMenu(menuLevel() === 2 ? 0 : 2);
    tab('plan', true);
  }
  // 0: menu open, 1: just the tab bar, 2: hidden (full-screen map)
  function menuLevel() { const b = document.body.classList; return b.contains('menu-2') ? 2 : innerWidth < 900 ? ($('#panel').classList.contains('open') ? 0 : 1) : b.contains('menu-1') ? 1 : 0; }
  function setMenu(l) {
    const b = document.body.classList;
    b.toggle('menu-2', l === 2); b.toggle('menu-1', l === 1);
    $('#panel').classList.toggle('open', l === 0);
    if (l === 2) $('#results').hidden = true;
    setTimeout(() => OR.map && OR.map.resize(), 260);
  }
  OR.setMenu = setMenu;
  let curTab = 'plan';
  OR.curTab = () => curTab;
  function tab(t, quiet) {
    if (t === 'nearby') t = 'plan';
    curTab = t;
    document.body.classList.toggle('split', t === 'trips' || t === 'plan');
    OR.emit('tab', t);
    $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    $('#setBtn').classList.toggle('on', t === 'more');
    $$('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + t));
    if (!quiet) setMenu(0);
    $('#views').scrollTop = 0;
    // each screen is built when it's opened, not all at start
    if (t === 'rides') renderRides(); if (t === 'more') renderMore(); if (t === 'trips' && OR.renderTrips) OR.renderTrips();
    if (t === 'group' && OR.pageGroup) renderGroupTab(); if (t === 'bike') renderBike();
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
      if (!list.length) { res.innerHTML = '<div class="muted pad">Nothing found. Try a town, postcode or road name.</div>'; return; }
      res.innerHTML = list.map((r, i) => '<button class="res" data-i="' + i + '"><b>' + esc(r.name) + '</b><span>' + esc(r.sub) + '</span></button>').join('');
      $$('.res', res).forEach(b => b.onclick = () => {
        const r = list[+b.dataset.i]; res.hidden = true; q.value = r.name; q.blur();
        if (OR.pickHook) { const h = OR.pickHook; OR.pickHook = null; h({ lng: r.lng, lat: r.lat, name: r.name }); return; }
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
    // the north button only shows when the map is turned or tilted
    const north = $('#northBtn'), nsvg = $('#northBtn svg'); let lastB = null;
    const nb = () => { if (OR.ride.on) return; const m = OR.map, b = Math.round(m.getBearing()), off = Math.abs(b) > 1 || m.getPitch() > 2; if (north.hidden !== !off) north.hidden = !off; if (off && b !== lastB) { lastB = b; nsvg.style.transform = 'rotate(' + (-b) + 'deg)'; } };
    OR.map.on('rotate', nb); OR.map.on('pitch', nb);
    $('#layersBtn').onclick = mapStyleSheet;
  }
  function mapStyleSheet() {
    const c = OR.cfg;
    sheet('<h2>Map</h2><div class="seg big" id="mt"><button data-v="road" class="' + (c.mapType !== 'satellite' ? 'on' : '') + '">' + ic('map') + 'Road</button><button data-v="satellite" class="' + (c.mapType === 'satellite' ? 'on' : '') + '">' + ic('layers') + 'Satellite</button></div>' +
      '<p class="small muted">Satellite pictures need a signal. Offline packs show the road map.</p>' +
      '<h3 class="grp">On the map</h3><div class="menu"><button id="radarTog">' + badge('cloud', '#039be5') + '<span><b>' + (OR.radar && OR.radar.on() ? 'Turn rain radar off' : 'Rain radar') + '</b><small>Showers over the last 2 hours</small></span>' + ic('chev', 'chev') + '</button>' +
      '<button id="roughTog">' + badge('warn', '#ef8f00') + '<span><b>' + (OR.roughOn && OR.roughOn() ? 'Hide rough roads' : 'Rough roads I\'ve ridden') + '</b><small>Bumps and potholes your phone felt</small></span>' + ic('chev', 'chev') + '</button>' +
      '<button id="poiTog">' + badge('fuel', '#e53935') + '<span><b>' + (c.mapPois === false ? 'Show fuel and places to stay' : 'Hide fuel and places to stay') + '</b><small>Petrol stations and hotels on the map when zoomed in close</small></span>' + ic('chev', 'chev') + '</button>' +
      '<button id="jnTog">' + badge('map', '#0079c1') + '<span><b>' + (c.mapJunctions === false ? 'Show junction numbers' : 'Hide junction numbers') + '</b><small>Motorway junctions, from OpenStreetMap</small></span>' + ic('chev', 'chev') + '</button>' +
      '<button id="closTog">' + badge('noentry', '#d50000') + '<span><b>' + (!(c.tomtomKey || '').trim() ? 'Road closures' : c.mapClosures === false ? 'Show road closures' : 'Hide road closures') + '</b><small>' + (!(c.tomtomKey || '').trim() ? 'Needs the free TomTom key (Settings, Map and routing)' : 'Closed roads in red, roadworks in orange, live from TomTom') + '</small></span>' + ic('chev', 'chev') + '</button>' +
      '<button id="hillsTog">' + badge('hills', '#6d4c41') + '<span><b>' + (c.hills === false ? 'Show the hills' : c.hills3d === false ? 'Raise the hills in 3D' : 'Hills: shaded and 3D') + '</b><small>' + (c.hills === false ? 'Hill shading and 3D ground' : c.hills3d === false ? 'Tilt the map to see them' : 'Tap to change. 3D shows when the map is tilted') + '</small></span>' + ic('chev', 'chev') + '</button>' +
      '<button id="fullTog">' + badge('full', '#5d6d7e') + '<span><b>Full-screen map</b><small>Hide the menu; the menu button brings it back</small></span>' + ic('chev', 'chev') + '</button></div><p class="small muted">Rain over the last 2 hours from RainViewer (free for personal use). It doesn\'t forecast, and it\'s coarse when zoomed in.</p><h3 class="grp">Colours</h3>' +
      '<div class="seg" id="th">' + [['auto', 'Auto'], ['day', 'Day'], ['night', 'Night']].map(([k, l]) => '<button data-v="' + k + '" class="' + (c.theme === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>' +
      '<p class="small muted">Auto switches to night colours after sunset where you are.</p>', b => {
      $$('#mt button', b).forEach(x => x.onclick = () => { OR.setMapType(x.dataset.v); closeSheet(); });
      const rb = $('#radarTog', b); if (rb) rb.onclick = () => { closeSheet(); OR.toggleRadar(); };
      const fs = $('#fullTog', b); if (fs) fs.onclick = () => { closeSheet(); setMenu(2); OR.toast('Tap the menu button, bottom left, to bring the menu back'); };
      $('#hillsTog', b).onclick = () => {
        closeSheet();
        // off → shaded and 3D → shaded only → off
        if (c.hills === false) { c.hills = true; c.hills3d = true; } else if (c.hills3d !== false) c.hills3d = false; else c.hills = false;
        OR.saveCfg(); OR.restyle(); OR.toast(c.hills === false ? 'Hills off' : c.hills3d === false ? 'Hill shading on, 3D off' : 'Hills on: tap 3D to tilt the map');
      };
      const rr = $('#roughTog', b); if (rr) rr.onclick = () => { closeSheet(); OR.showRough(!OR.roughOn()); };
      $('#poiTog', b).onclick = () => { closeSheet(); c.mapPois = c.mapPois === false; OR.saveCfg(); if (OR.map.getLayer('poi-main')) OR.map.setLayoutProperty('poi-main', 'visibility', c.mapPois ? 'visible' : 'none'); OR.toast(c.mapPois ? 'Fuel and stays show when you zoom in close' : 'Fuel and stays hidden'); };
      $('#jnTog', b).onclick = () => { closeSheet(); c.mapJunctions = c.mapJunctions === false; OR.saveCfg(); OR.mapLiveRefresh(); };
      $('#closTog', b).onclick = () => {
        closeSheet();
        if (!(c.tomtomKey || '').trim()) { OR.toast('Road closures need a free TomTom key. Add it in Settings, Map and routing.', 6000); return; }
        c.mapClosures = c.mapClosures === false; OR.saveCfg(); OR.mapLiveRefresh(); if (c.mapClosures) { OR.refreshClosures(); OR.toast('Showing road closures around the map'); }
      };
      $$('#th button', b).forEach(x => x.onclick = () => { c.theme = x.dataset.v; OR.saveCfg(); OR.applyTheme(); closeSheet(); });
    });
  }

  // ---------- map taps ----------
  let popup = null;
  function bindMapTaps() {
    OR.map.on('click', e => {
      const rider = OR.map.getLayer('ov-riders') && OR.map.queryRenderedFeatures([[e.point.x - 14, e.point.y - 14], [e.point.x + 14, e.point.y + 14]], { layers: ['ov-riders', 'ov-riders-t'] });
      if (rider && rider.length) { OR.emit('riderTap', rider[0].properties.id); return; }
      const hz = OR.map.getLayer('ov-haz') && OR.map.queryRenderedFeatures([[e.point.x - 16, e.point.y - 30], [e.point.x + 16, e.point.y + 6]], { layers: ['ov-haz'] });
      if (hz && hz.length) { OR.emit('hazTap', hz[0].properties.key); return; }
      const cl = OR.map.getLayer('ov-closed') && OR.map.queryRenderedFeatures([[e.point.x - 16, e.point.y - 30], [e.point.x + 16, e.point.y + 6]], { layers: ['ov-closed', 'ov-closed-l', 'ov-works-l'] });
      if (cl && cl.length) { closureSheet(cl[0].properties.i); return; }
      const tp = OR.map.getLayer('poi-main') && OR.map.queryRenderedFeatures([[e.point.x - 14, e.point.y - 30], [e.point.x + 14, e.point.y + 4]], { layers: ['poi-main'] });
      if (tp && tp.length && !OR.pickHook) { tilePoi(tp[0]); return; }
      if (OR.ride.on) return;
      const hit = OR.map.queryRenderedFeatures(e.point, { layers: ['ov-pois', 'ov-alts'].filter(l => OR.map.getLayer(l)) });
      if (hit.length && hit[0].layer.id === 'ov-alts') { const i = hit[0].properties.i; if (i != null) chooseOption(+i); return; }
      if (hit.length) return;
      if (OR.pickHook) { const h = OR.pickHook; OR.pickHook = null; OR.reverseName(e.lngLat.lng, e.lngLat.lat).then(n => h({ lng: e.lngLat.lng, lat: e.lngLat.lat, name: n || 'Chosen point' })); return; }
      placeMenu([e.lngLat.lng, e.lngLat.lat]);
    });
    OR.on('poi', f => poiPopup(f));
  }
  // a petrol station or hotel from the map itself: show it like a search result, with Go here
  function tilePoi(f) {
    const pr = f.properties, ll = f.geometry.coordinates, fuel = pr.class === 'fuel';
    const tags = fuel ? { amenity: 'fuel' } : { tourism: { hostel: 'hostel', motel: 'motel', guest_house: 'guest_house', camp_site: 'camp_site', chalet: 'chalet', apartment: 'apartment' }[pr.subclass] || 'hotel' };
    const p = { id: 'tile' + ll[0].toFixed(5) + ll[1].toFixed(5), lng: ll[0], lat: ll[1], tags, name: pr['name:en'] || pr.name || (fuel ? 'Petrol station' : 'Place to stay') };
    OR.lastPois = (OR.lastPois || []).filter(x => x.id !== p.id).concat([p]);
    poiPopup({ properties: { id: p.id } });
  }
  function closureSheet(i) {
    const x = OR.closureInfo(+i); if (!x) return;
    sheet('<h2>' + esc(x.title) + '</h2>' + (x.where ? '<p><b>' + esc(x.where) + '</b></p>' : '') + (x.text ? '<p>' + esc(x.text) + '</p>' : '') +
      (x.until ? '<p class="small muted">Expected until ' + esc(x.until) + '</p>' : '') + '<p class="small muted">Live from TomTom. Check the signs on the day.</p>');
  }
  function closePopup() { if (popup) { popup.remove(); popup = null; } }
  OR.closePopup = closePopup;
  function placeMenu(ll, name) {
    closePopup();
    const el = document.createElement('div'); el.className = 'pm';
    const has = OR.plan.wps.length;
    el.innerHTML = '<div class="pm-name">' + esc(name || 'This spot') + '</div><div class="pm-btns">' +
      (has ? '<button class="btn" data-a="via">Add via point</button><button class="btn pri" data-a="end">Go here</button>' : '<button class="btn" data-a="start">Start here</button><button class="btn pri" data-a="end">Go here</button>') +
      '<button class="btn" data-a="loop">Round trip from here</button><button class="btn" data-a="stay">Stays nearby</button><button class="btn" data-a="fuel">Fuel nearby</button></div>';
    popup = new maplibregl.Popup({ closeButton: true, maxWidth: '310px', className: 'orpop' }).setLngLat(ll).setDOMContent(el).addTo(OR.map);
    const label = name ? Promise.resolve(name) : OR.reverseName(ll[0], ll[1]);
    if (!name) label.then(n => { if (n) $('.pm-name', el).textContent = n; });
    $$('button', el).forEach(b => b.onclick = async () => {
      const a = b.dataset.a; closePopup();
      if (a === 'stay' || a === 'fuel') return findNearby(a, ll);
      const nm = (await label.catch(() => null)) || (ll[1].toFixed(4) + ', ' + ll[0].toFixed(4));
      if (a === 'loop') { loopFrom = { lng: ll[0], lat: ll[1], name: nm }; planMode = 'loop'; renderPlan(); tab('plan'); return; }
      const w = { lng: ll[0], lat: ll[1], name: nm, type: 'through' };
      const wps = OR.plan.wps;
      planMode = 'ab';
      if (a === 'start') wps.unshift(Object.assign(w, { type: 'break' }));
      else if (a === 'end') {
        if (!wps.length) { if (OR.pos) wps.push({ lng: OR.pos.lng, lat: OR.pos.lat, name: 'My position', type: 'break' }); else { OR.toast('Start set here. Now tap where you want to go.'); wps.push(Object.assign(w, { type: 'break' })); changed(); return; } }
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
    el.innerHTML = '<div class="pm-name">' + esc(p.name) + '</div><div class="muted small">' + esc([d.type, d.stars && d.stars + ' star'].filter(Boolean).join(', ')) + '</div>' +
      (d.addr ? '<div class="small">' + esc(d.addr) + '</div>' : '') + (d.hours ? '<div class="small">Open ' + esc(d.hours) + '</div>' : '') +
      '<div class="pm-btns">' + (d.phone ? '<a class="btn" href="tel:' + esc(d.phone.replace(/\s/g, '')) + '">Call</a>' : '') +
      (d.web ? '<a class="btn" target="_blank" href="' + esc(/^https?:/.test(d.web) ? d.web : 'https://' + d.web) + '">Website</a>' : '') +
      (OR.poiPick ? '<button class="btn pri" data-a="pick">Use for this trip</button>' : '<button class="btn" data-a="stop">Add as stop</button><button class="btn pri" data-a="go">Go here</button>') + '</div>';
    popup = new maplibregl.Popup({ maxWidth: '310px', className: 'orpop' }).setLngLat([p.lng, p.lat]).setDOMContent(el).addTo(OR.map);
    $$('button', el).forEach(b => b.onclick = () => {
      closePopup();
      if (b.dataset.a === 'pick') { const h = OR.poiPick; OR.poiPick = null; h(p, d); return; }
      const w = { lng: p.lng, lat: p.lat, name: p.name, type: 'break' };
      if (OR.ride.on && OR.pos) { // while riding: go there now, then carry on
        const r = OR.ride.route, rest = r ? r.wps.slice(1) : [];
        OR.plan.wps = [{ lng: OR.pos.lng, lat: OR.pos.lat, name: 'Here', type: 'break' }, w].concat(b.dataset.a === 'stop' ? rest : []);
        return planAndRide();
      }
      const wps = OR.plan.wps; planMode = 'ab';
      if (b.dataset.a === 'go') { if (!wps.length && OR.pos) wps.push({ lng: OR.pos.lng, lat: OR.pos.lat, name: 'My position', type: 'break' }); wps.push(w); }
      else { if (wps.length >= 2) wps.splice(wps.length - 1, 0, w); else wps.push(w); }
      changed(wps.length >= 2);
    });
  }
  OR.poiPopup = poiPopup;

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
  OR.drawWaypoints = drawWaypoints;
  function changed(replan) {
    showAllWps = false;
    OR.savePlan(); drawWaypoints();
    OR.plan.route = null; OR.plan.options = []; clearRouteExtras(); OR.setData('route', null); OR.setData('alts', null); OR.emit('planCleared');
    renderPlan(); tab('plan');
    if (replan) doPlan();
  }
  OR.planChanged = changed;
  // a route from where I am to a point (used for riding to a group rider)
  OR.routeTo = function (ll, name) {
    if (!OR.pos) { OR.toast('Waiting for your position'); return false; }
    planMode = 'ab';
    OR.plan.wps.length = 0;
    OR.plan.wps.push({ lng: OR.pos.lng, lat: OR.pos.lat, name: 'My position', type: 'break' }, { lng: ll[0], lat: ll[1], name: name, type: 'break' });
    changed(true); tab('plan'); return true;
  };
  // where am I: for telling the emergency services, a breakdown company or the group
  OR.whereAmI = async function () {
    if (!OR.pos) return toast('Waiting for your position');
    const p = OR.pos, g = OR.osGrid ? OR.osGrid(p.lat, p.lng) : null;
    sheet('<h2>' + ic('near') + 'Where am I</h2><div class="where"><div><span>Near</span><b id="whName">Looking up…</b></div>' + (g ? '<div><span>OS grid reference</span><b class="grid">' + g.ref + '</b></div>' : '') +
      '<div><span>Latitude, longitude</span><b>' + p.lat.toFixed(5) + ', ' + p.lng.toFixed(5) + '</b></div></div>' +
      '<p class="small">Emergency: <b>999</b> in the UK, <b>112</b> anywhere in Europe (it works in the UK too). Read them the ' + (g ? 'grid reference' : 'latitude and longitude') + '.</p>' +
      '<div class="row"><a class="btn go" href="tel:' + (g ? '999' : '112') + '">Call ' + (g ? '999' : '112') + '</a><button class="btn" id="whShare">' + ic('share') + 'Send my position</button></div>', b => {
      OR.reverseName(p.lng, p.lat).then(n => { const el = $('#whName', b); if (el) el.textContent = n || 'Unknown road'; });
      $('#whShare', b).onclick = () => OR.share('My position: https://maps.google.com/?q=' + p.lat.toFixed(5) + ',' + p.lng.toFixed(5) + (g ? ' (OS grid ref ' + g.ref + ')' : ''), 'My position');
    });
  };
  function clearRouteExtras() { OR.setData('gaps', null); OR.setData('pois', null); extras = {}; }

  // ---------- plan view ----------
  let showAllWps = false;
  let planning = false, planErr = '', planMode = 'ab', loopFrom = null, loopMiles = OR.store.get('loopMiles', 80), loopDir = 'any', extras = {};
  let loopBy = OR.store.get('loopBy', 'dist'), backBy = null;
  // "back by": the time to be home, by default 3 hours from now rounded to the quarter hour
  function backByTime() { if (backBy && backBy > Date.now() + 20 * 60000) return backBy; const d = new Date(Date.now() + 3 * 3600000); d.setMinutes(Math.round(d.getMinutes() / 15) * 15, 0, 0); return d.getTime(); }
  function backByValue() { const d = new Date(backByTime()); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function timeNote() { const mins = Math.round((backByTime() - Date.now()) / 60000); return mins < 30 ? 'That\'s too soon for a loop.' : 'About ' + OR.fmtTime(mins * 60) + ' from now, including your usual stops.'; }
  OR.setPlanMode = m => { planMode = m; renderPlan(); };
  function styleSeg() {
    const keys = ['twisty', 'extra', 'scenic', 'fast'];
    return '<div class="seg styles" id="styleSeg">' + keys.map(k => '<button data-s="' + k + '" class="' + (OR.cfg.style === k ? 'on' : '') + '">' + OR.STYLES[k].label + '</button>').join('') + '</div>';
  }
  function renderPlan() {
    const v = $('#v-plan'), wps = OR.plan.wps, r = OR.plan.route, tgt = OR.plan.target;
    let h = '';
    if (tgt) {
      const t = OR.trips.get(tgt.tripId);
      h += '<div class="banner"><div><b>Planning a ride for your trip</b><span>' + esc(t ? t.name + ', ' + OR.dayLabel(t, tgt.day) : '') + '</span></div>' +
        (r ? '<button class="btn yellow" id="tgtSave">Save to trip</button>' : '') + '<button class="btn ghost" id="tgtCancel">Cancel</button></div>';
    }
    h += '<div class="modes" role="tablist">' + [['ab', 'A to B'], ['loop', 'Round trip'], ['saved', 'Saved routes']].map(([k, l]) => '<button data-m="' + k + '" class="' + (planMode === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
    if (planMode === 'saved') { v.innerHTML = h + savedHtml(); bindModes(v); bindSaved(v); bindTarget(v); return; }
    h += styleSeg();
    if (planMode === 'loop') {
      const from = loopFrom || (OR.pos ? { lng: OR.pos.lng, lat: OR.pos.lat, name: 'My position' } : null);
      h += '<div class="card"><div class="row-l"><span class="lbl">Start and finish</span><b>' + esc(from ? from.name : 'Tap the map or search for a place') + '</b></div>' +
        (OR.pos ? '<button class="btn small ghost" id="loopHere">Use my position</button>' : '') + '</div>' +
        '<div class="seg" id="loopBy"><button data-b="dist" class="' + (loopBy === 'dist' ? 'on' : '') + '">By distance</button><button data-b="time" class="' + (loopBy === 'time' ? 'on' : '') + '">By time</button></div>' +
        (loopBy === 'time' ? '<div class="backby"><label class="f"><span>Back by</span><input type="time" id="loopBack" value="' + backByValue() + '"></label><div class="chips hrs">' + [1, 2, 3, 4, 5].map(h => '<button class="btn small" data-h="' + h + '">' + h + ' h</button>').join('') + '</div></div>' +
          '<p class="small muted" id="loopTimeNote">' + timeNote() + '</p>'
          : '<label class="range"><span>Length <b id="loopMiOut">' + loopMiles + ' miles</b></span><input type="range" id="loopMi" min="20" max="300" step="10" value="' + loopMiles + '"></label>') +
        '<div class="dirs8">' + ['NW', 'N', 'NE', 'W', 'any', 'E', 'SW', 'S', 'SE'].map(d => '<button data-d="' + d + '" class="' + (loopDir === d ? 'on' : '') + '">' + (d === 'any' ? 'Any' : d) + '</button>').join('') + '</div>' +
        '<button class="btn wide pri" id="loopGo"' + (from ? '' : ' disabled') + '>' + (planning ? 'Finding loops…' : 'Make a loop') + '</button>';
      if (!loopFrom && !OR.pos) h += '<p class="hint">Tap the map where the loop should start and choose "Round trip from here".</p>';
    } else if (!wps.length) {
      h += (OR.todayHtml && !tgt ? OR.todayHtml() : '') + '<div class="empty">' + ic('plan', 'big') + '<p>Search for a place or tap the map to say where you\'re going. Add via points to ride the roads you want.</p>' +
        (OR.pos ? '<button class="btn" id="fromHere">Start from my position</button>' : '') + '</div>';
    } else {
      const fold = wps.length > 5 && !showAllWps;
      h += '<ol class="wps">' + wps.map((w, i) => {
        if (fold && i > 1 && i < wps.length - 2) return i === 2 ? '<li><button class="more" id="wpsAll">' + ic('down') + 'Show ' + (wps.length - 4) + ' more via points</button></li>' : '';
        const end = i === wps.length - 1 && wps.length > 1, tag = i === 0 ? 'A' : end ? 'B' : String(i);
        const cls = i === 0 ? 'wp-a' : end ? 'wp-b' : w.type === 'break' ? 'wp-stop' : 'wp-via';
        return '<li><span class="wp ' + cls + '">' + tag + '</span><span class="wpn">' + esc(w.name || 'Point') +
          (i > 0 && !end ? '<small>' + (w.type === 'break' ? 'Stop' : 'Via') + '</small>' : '') + '</span>' +
          (i > 0 && !end ? '<button class="mini txt" data-k="' + i + '" data-a="kind">' + (w.type === 'break' ? 'Make via' : 'Make stop') + '</button>' : '') +
          '<button class="mini" data-k="' + i + '" data-a="up" aria-label="Move up">' + ic('up') + '</button><button class="mini" data-k="' + i + '" data-a="down" aria-label="Move down">' + ic('down') + '</button>' +
          '<button class="mini" data-k="' + i + '" data-a="rm" aria-label="Remove">' + ic('x') + '</button></li>';
      }).join('') + '</ol>';
      h += '<div class="row">' + (wps.length >= 2 ? '<button class="btn pri" id="planGo">' + (planning ? 'Planning…' : 'Plan route') + '</button>' : '') +
        '<button class="btn ghost" id="rev">Reverse</button><button class="btn ghost" id="loop">Back to start</button><button class="btn ghost" id="clr">Clear</button></div>';
      if (wps.length === 1) h += '<p class="hint">Now tap the map or search for where you want to go.</p>';
      // the best biking roads near the places in this route, to add
      const places = []; [wps[wps.length - 1], wps[0]].concat(wps.filter(w => w.type === 'break')).forEach(w => { if (w && w.name && !/\((start|end)\)$|^My position$|^Point$/.test(w.name) && !places.some(p => p.name === w.name)) places.push(w); });
      if (places.length) h += '<div class="trchips">' + places.slice(0, 3).map((w, i) => '<button class="btn small" data-trp="' + wps.indexOf(w) + '">' + ic('twisty') + 'Top rides near ' + esc(w.name.split(',')[0]) + '</button>').join('') + '</div>';
    }
    if (planErr) h += '<p class="err">' + esc(planErr) + '</p>';
    if (OR.plan.options.length && planMode !== 'saved') {
      h += '<h3>Pick a route</h3><div class="opts">' + OR.plan.options.map((o, i) =>
        '<button class="opt' + (i === OR.plan.choice ? ' on' : '') + '" data-i="' + i + '"><span class="opt-top"><b>' + esc(o.variant) + '</b><span class="nums">' + OR.fmtDist(o.dist) + '<i>' + OR.fmtTime(OR.myTime ? OR.myTime(o.time) : o.time) + '</i></span></span>' +
        (o.roads && o.roads.length ? '<span class="refs">' + o.roads.map(chip).join('') + '</span>' : '') +
        '<span class="bend"><span class="bar"><i style="width:' + Math.min(100, Math.round(o.twist / 2.2)) + '%"></i></span>' + OR.bendLabel(o.twist) + (o.mwayPct ? ', ' + o.mwayPct + '% motorway' : ', no motorway') + '</span></button>').join('') + '</div>';
      h += OR.wxStripHtml ? OR.wxStripHtml() : '';
      h += OR.planExtrasHtml ? OR.planExtrasHtml() : '';
      h += '<div class="rideRow"><button class="btn go" id="ride">' + ic('rides') + 'Start ride</button><button class="btn brief" id="brief">' + ic('shield') + 'Route brief</button></div>';
      h += '<div class="tools">' + [['wx', 'cloud', 'Weather', '#039be5'], ['fuelChk', 'fuel', 'Fuel check', '#e53935'], ['stays', 'bed', 'Stays at end', '#7e57c2'], ['save', 'save', 'Save', '#0e9f57'], ['toTrip', 'trips', 'Add to trip', '#1565c0'], ['sendR', 'share', 'Send to…', '#00897b']]
        .map(([id, i, l, c]) => '<button class="tool" id="' + id + '">' + badge(i, c) + '<span>' + l + '</span></button>').join('') + '</div>';
      h += '<div id="extraOut">' + (extras.html || '') + '</div>';
      h += '<details><summary>Turn-by-turn list (' + r.man.length + ' steps)</summary><ol class="dirs">' + r.man.map(m =>
        '<li>' + OR.arrow(m.type) + '<span>' + esc(m.text) + (m.len > 0 ? '<small>then ' + OR.fmtDist(m.len) + '</small>' : '') + '</span></li>').join('') + '</ol></details>';
    }
    v.innerHTML = h;
    bindModes(v); bindTarget(v); if (OR.bindToday) OR.bindToday(v);
    $$('#styleSeg button', v).forEach(b => b.onclick = () => { OR.cfg.style = b.dataset.s; OR.saveCfg(); renderPlan(); if (planMode === 'ab' && wps.length >= 2) doPlan(); });
    const on = (id, fn) => { const el = $('#' + id, v); if (el) el.onclick = fn; };
    on('fromHere', () => { OR.plan.wps.push({ lng: OR.pos.lng, lat: OR.pos.lat, name: 'My position', type: 'break' }); changed(); });
    on('planGo', doPlan);
    $$('[data-trp]', v).forEach(b => b.onclick = () => OR.topRidesSheet(OR.plan.wps[+b.dataset.trp], OR.addRideToPlan, 'Add'));
    on('wpsAll', () => { showAllWps = true; renderPlan(); });
    on('rev', () => { wps.reverse(); fixTypes(); changed(wps.length >= 2); });
    on('loop', () => { if (wps.length) { wps.push(Object.assign({}, wps[0], { type: 'break' })); fixTypes(); changed(wps.length >= 2); } });
    on('clr', () => { OR.plan.wps = []; planErr = ''; changed(); });
    on('loopHere', () => { loopFrom = { lng: OR.pos.lng, lat: OR.pos.lat, name: 'My position' }; renderPlan(); });
    $$('#loopBy button', v).forEach(b => b.onclick = () => { loopBy = b.dataset.b; OR.store.set('loopBy', loopBy); renderPlan(); });
    const lb = $('#loopBack', v); if (lb) lb.onchange = () => { const [h, m] = lb.value.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); if (d < Date.now()) d.setDate(d.getDate() + 1); backBy = d.getTime(); $('#loopTimeNote', v).textContent = timeNote(); };
    $$('.hrs [data-h]', v).forEach(b => b.onclick = () => { backBy = Date.now() + (+b.dataset.h) * 3600000; lb.value = backByValue(); $('#loopTimeNote', v).textContent = timeNote(); });
    const mi = $('#loopMi', v); if (mi) mi.oninput = () => { loopMiles = +mi.value; $('#loopMiOut', v).textContent = loopMiles + ' miles'; OR.store.set('loopMiles', loopMiles); };
    $$('.dirs8 button', v).forEach(b => b.onclick = () => { loopDir = b.dataset.d; $$('.dirs8 button', v).forEach(x => x.classList.toggle('on', x === b)); });
    on('loopGo', doLoop);
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
    on('brief', () => OR.openBrief && OR.openBrief(OR.plan.route));
    on('save', () => { const n = prompt('Name this route', r.name); if (n == null) return; r.name = n.trim() || r.name; OR.routes.save(r); OR.toast('Saved to Saved routes'); });
    on('fuelChk', () => fuelCheck(r));
    on('sendR', () => sendSheet(r));
    on('wx', () => weatherCheck(r));
    on('stays', () => { const e = r.shape[r.shape.length - 1]; findNearby('stay', e); });

    on('toTrip', () => OR.addRouteToTrip && OR.addRouteToTrip(r));
  }
  OR.renderPlan = renderPlan;
  function bindModes(v) { $$('.modes button', v).forEach(b => b.onclick = () => { planMode = b.dataset.m; renderPlan(); }); }
  function bindTarget(v) {
    const s = $('#tgtSave', v); if (s) s.onclick = () => OR.saveTargetRoute && OR.saveTargetRoute(OR.plan.route);
    const c = $('#tgtCancel', v); if (c) c.onclick = () => { const t = OR.plan.target; OR.plan.target = null; renderPlan(); if (t) { OR.openTrip(t.tripId); } };
  }
  function fixTypes() { const w = OR.plan.wps; if (w.length) { w[0].type = 'break'; w[w.length - 1].type = 'break'; } }
  // everywhere a route can go: another app, a file, a friend, or the phone's offline maps
  function sendSheet(r) {
    const row = (id, i, c, t, d) => '<button data-s="' + id + '">' + badge(i, c) + '<span><b>' + t + '</b><small>' + d + '</small></span>' + ic('chev', 'chev') + '</button>';
    sheet('<h2>' + ic('share') + 'Send this route</h2><div class="menu">' +
      row('gmaps', 'map', '#4285f4', 'Google Maps or Apple Maps', 'Open it there, or send a link to a friend') +
      row('beeline', 'share', '#f5a300', 'Beeline Moto II', 'Turn-by-turn on your Beeline') +
      row('shareR', 'chat', '#00897b', 'Send as a message', 'WhatsApp, text or email, with map links') +
      row('gpx', 'dl', '#5d6d7e', 'GPX file', 'For Calimoto, Kurviger, Garmin and others') +
      (A ? row('offl', 'map', '#ef8f00', 'Save the maps for it', 'So the route works with no signal') : '') + '</div>', b => {
      $$('[data-s]', b).forEach(x => x.onclick = () => {
        const k = x.dataset.s; closeSheet();
        if (k === 'gmaps') OR.shareToMaps(r); else if (k === 'beeline') OR.sendToBeeline(r); else if (k === 'shareR') OR.share(shareText(r), r.name);
        else if (k === 'gpx') OR.saveFile(OR.fileName(r.name) + '.gpx', OR.toGpx(r)); else if (k === 'offl') OR.saveRouteMap(r);
      });
    });
  }
  OR.sendSheet = r => sendSheet(r);
  function shareText(r) {
    return r.name + ': ' + OR.fmtDist(r.dist) + ', about ' + OR.fmtTime(r.time) + (r.roads && r.roads.length ? ' via ' + r.roads.join(', ') : '') + '\n' +
      r.wps.map((w, i) => (i === 0 ? 'Start: ' : i === r.wps.length - 1 ? 'End: ' : 'Via: ') + (w.name || '') + ' https://maps.google.com/?q=' + w.lat.toFixed(5) + ',' + w.lng.toFixed(5)).join('\n') +
      '\nPlanned with OpenRoad';
  }

  async function doPlan() {
    if (planning) return; planning = true; planErr = ''; clearRouteExtras(); renderPlan();
    try { await OR.planRoute(); showOptions(true); }
    catch (e) { planErr = 'Could not plan the route: ' + e.message; } // with no signal, offline planning explains itself
    planning = false; renderPlan();
  }
  OR.doPlan = doPlan;
  async function doLoop() {
    const from = loopFrom || (OR.pos ? { lng: OR.pos.lng, lat: OR.pos.lat, name: 'My position' } : null); if (!from || planning) return;
    planning = true; planErr = ''; clearRouteExtras(); renderPlan();
    try {
      const opts = loopBy === 'time' ? await OR.roundTripByTime([from.lng, from.lat], (backByTime() - Date.now()) / 1000, loopDir) : await OR.roundTrip([from.lng, from.lat], loopMiles, loopDir);
      opts.forEach(o => { o.name = 'Round trip from ' + from.name; o.wps[0].name = from.name; o.wps[o.wps.length - 1].name = from.name; });
      OR.plan.options = opts.slice(0, 3); OR.plan.choice = 0; OR.plan.route = opts[0];
      OR.plan.wps = opts[0].wps.map(w => Object.assign({}, w)); OR.savePlan(); drawWaypoints();
      showOptions(true);
    } catch (e) { planErr = e.message; }
    planning = false; renderPlan();
  }
  // put a set of round trips in the planner (Today's loop), as if made with Round trip
  OR.useLoop = function (opts, from) {
    planMode = 'loop'; loopFrom = { lng: from.lng, lat: from.lat, name: from.home ? 'Home' : from.name === 'here' ? 'My position' : from.name };
    OR.plan.options = opts.slice(0, 3); OR.plan.choice = 0; OR.plan.route = OR.plan.options[0];
    OR.plan.wps = OR.plan.route.wps.map(w => Object.assign({}, w)); OR.savePlan(); drawWaypoints(); clearRouteExtras();
    tab('plan'); renderPlan(); showOptions(true); renderPlan();
  };
  function showOptions(fit) {
    const o = OR.plan.options, c = OR.plan.choice; if (!o.length) return;
    const alts = { type: 'FeatureCollection', features: o.map((r, i) => i === c ? null : { type: 'Feature', properties: { i }, geometry: { type: 'LineString', coordinates: r.shape } }).filter(Boolean) };
    // a new route draws itself along the road (view3d.js); picking another option just swaps the lines
    if (fit && OR.revealRoute && OR.revealRoute(o[c], alts, fitPad())) { OR.emit('routeShown', o[c]); return; }
    if (OR.stopReveal) OR.stopReveal();
    OR.setData('alts', alts);
    OR.setData('route', { type: 'FeatureCollection', features: [OR.routeGeo(o[c])] });
    if (fit) fitRoute(o[c]);
    OR.emit('routeShown', o[c]);
  }
  OR.showOptions = showOptions;
  OR.chooseOption = i => chooseOption(i);
  function chooseOption(i) {
    OR.plan.choice = i; OR.plan.route = OR.plan.options[i]; clearRouteExtras();
    if (planMode === 'loop') { OR.plan.wps = OR.plan.route.wps.map(w => Object.assign({}, w)); OR.savePlan(); drawWaypoints(); }
    showOptions(); renderPlan();
  }
  function fitPad() { return window.innerWidth >= 900 ? { top: 90, bottom: 60, left: 450, right: 80 } : { top: 90, bottom: Math.round(window.innerHeight * 0.55), left: 40, right: 40 }; }
  OR.fitPad = fitPad;
  function fitRoute(r) {
    OR.map.fitBounds(OR.bbox(r.shape), { padding: fitPad(), duration: 800, maxZoom: 14 });
  }
  OR.fitRoute = fitRoute;
  function setExtras(html) { extras.html = html; const o = $('#extraOut'); if (o) o.innerHTML = html; }

  async function fuelCheck(r) {
    setExtras('<p class="muted">Looking for fuel stations along the route…</p>');
    try {
      const f = await OR.fuelAlong(r);
      OR.ride.fuel = f.list; OR.lastPois = f.list;
      OR.setData('pois', OR.poiGeo(f.list)); OR.setData('gaps', OR.gapGeo(r, f.gaps));
      let h = '<div class="card"><b>' + f.list.length + ' fuel stations within a mile of the route</b>';
      if (!f.range) h += '<p class="small">Add your tank size and mpg in the Bike tab to see where gaps are too long for your range.</p>';
      else if (!f.gaps.length) h += '<p class="small ok">No gap is longer than your safe range (' + OR.fmtDist(f.range - OR.cfg.bike.reserveMi * OR.MI) + ' before reserve).</p>';
      else h += f.gaps.map(g => '<p class="small warn">' + (g.first ? 'From the start, with the fuel you have now: ' : '') + OR.fmtDist(g.len) + ' with no fuel near the route, from mile ' + Math.round(g.from / OR.MI) + ' to ' + Math.round(g.to / OR.MI) + '. Shown in red.</p>').join('');
      h += '<p class="small muted">From OpenStreetMap. Opening hours aren\'t always recorded, so check small stations before relying on them.</p></div>';
      setExtras(h);
      // live prices for stations in France
      const fr = f.list.filter(p => p.lng > -5.3 && p.lng < 9.7 && p.lat > 41.3 && p.lat < 51.2);
      if (fr.length) {
        setExtras(h + '<p class="muted small">Getting today\'s prices for the stations in France…</p>');
        await OR.addFuelPrices(f.list);
        const priced = f.list.filter(p => p.price).sort((a, b) => a.price.eur - b.price.eur);
        if (priced.length) {
          const avg = priced.reduce((s, p) => s + p.price.eur, 0) / priced.length, tank = parseFloat(OR.cfg.bike.tankL) || 0;
          h += '<div class="card okc"><b>' + ic('fuel') + 'Cheapest fuel on the route in France</b><ol class="cheap">' + priced.slice(0, 5).map(p => '<li><b>€' + p.price.eur.toFixed(3) + '</b> ' + esc(p.name) + ' <span class="small muted">' + esc(OR.FUEL_GRADES[p.price.grade]) + ', ' + (OR.cfg.units === 'km' ? 'km ' + Math.round(p.at / 1000) : 'mile ' + Math.round(p.at / OR.MI)) + ', ' + OR.priceAge(p.price.at) + '</span></li>').join('') + '</ol>' +
            (tank && priced.length > 2 ? '<p class="small">Filling up at the cheapest rather than an average-priced one saves about €' + ((avg - priced[0].price.eur) * tank * 0.8).toFixed(2) + ' on a tank.</p>' : '') +
            '<p class="small muted">Live prices from the French government\'s official open data (prix-carburants). Grade: ' + esc(OR.FUEL_GRADES[OR.cfg.fuelGrade || 'e10']) + ', change it in the Bike tab.</p></div>';
          f.list.forEach(p => { if (p.price) p.name = p.name + ' €' + p.price.eur.toFixed(2); });
          OR.setData('pois', OR.poiGeo(f.list));
        } else h += '<p class="small muted">No live prices matched the French stations on this route.</p>';
        setExtras(h);
      }
    } catch (e) { setExtras('<p class="err">Fuel search failed: ' + esc(e.message) + '</p>'); }
  }
  async function weatherCheck(r, depart) {
    const now = new Date(); const dep = depart || now;
    setExtras('<p class="muted">Getting the forecast along the route…</p>');
    try {
      const w = await OR.weatherAlong(r, dep);
      OR.lastPois = w.map((x, i) => ({ id: 'wx' + i, lng: x.lng, lat: x.lat, kind: 'wx', name: Math.round(x.temp) + '°', tags: {} }));
      OR.setData('pois', OR.poiGeo(OR.lastPois));
      const warns = w.map(OR.weatherWarn).filter(Boolean);
      let h = '<div class="card wx"><div class="row-l"><b>Weather if you leave at ' + OR.clock(dep) + '</b>' +
        '<label class="inline-time">Leave at <input type="time" id="wxDep" value="' + String(dep.getHours()).padStart(2, '0') + ':' + String(dep.getMinutes()).padStart(2, '0') + '"></label></div>';
      if (warns.length) h += '<p class="warn small"><b>' + esc(Array.from(new Set(warns)).join('. ')) + '.</b></p>';
      h += '<ol class="wxl">' + w.map(x => { const c = OR.wmo(x.code); return '<li><span class="t">' + OR.clock(new Date(x.at)) + '</span><span class="e" aria-hidden="true">' + c[1] + '</span><span class="d">' + c[0] + (x.end ? ', at the end' : x.along < 200 ? ', at the start' : ', ' + OR.fmtDist(x.along) + ' in') + '</span><b>' + Math.round(x.temp) + '°</b><span class="s">' + Math.round(x.rainP || 0) + '% rain<br>' + Math.round(x.wind) + ' mph, gusts ' + Math.round(x.gust) + '</span></li>'; }).join('') + '</ol>' +
        '<p class="small muted">Forecast from Open-Meteo for when you\'d reach each point.</p></div>';
      setExtras(h);
      const t = $('#wxDep'); if (t) t.onchange = () => { const [hh, mm] = t.value.split(':').map(Number); const d = new Date(); d.setHours(hh, mm, 0, 0); if (d < Date.now() - 3600000) d.setDate(d.getDate() + 1); weatherCheck(r, d); };
    } catch (e) { setExtras('<p class="err">Weather unavailable: ' + esc(e.message) + '</p>'); }
  }
  OR.weatherCheck = weatherCheck;

  // ---------- saved routes (inside Plan) ----------
  function savedHtml() {
    const list = OR.routes.list();
    return '<label class="btn wide file">' + ic('dl') + 'Import a GPX file<input type="file" id="gpxIn" accept=".gpx,application/gpx+xml,application/xml,text/xml,*/*" hidden></label>' +
      (list.length ? '<div class="list">' + list.map(r => '<div class="li"><b>' + esc(r.name) + '</b><span>' + OR.fmtDist(r.dist) + ', ' + OR.fmtTime(r.time) + (r.twist ? ', ' + OR.bendLabel(r.twist).toLowerCase() : '') + '</span>' +
        (r.roads && r.roads.length ? '<span class="refs">' + r.roads.map(chip).join('') + '</span>' : '') +
        '<div class="row"><button class="btn small" data-a="open" data-id="' + r.id + '">Show</button><button class="btn small pri" data-a="ride" data-id="' + r.id + '">Ride</button><button class="btn small" data-a="send" data-id="' + r.id + '">' + ic('share') + 'Send</button><button class="btn small ghost icon-only" data-a="del" data-id="' + r.id + '" aria-label="Delete">' + ic('x') + '</button></div></div>').join('') + '</div>'
        : '<div class="empty">' + ic('save', 'big') + '<p>Routes you save or import appear here and work with no signal. GPX files from Calimoto, Kurviger or friends open straight in.</p></div>');
  }
  function bindSaved(v) {
    $('#gpxIn', v).onchange = e => { const f = e.target.files[0]; if (f) f.text().then(t => importGpx(t, f.name)); e.target.value = ''; };
    $$('button[data-a]', v).forEach(b => b.onclick = () => {
      const r = OR.routes.get(b.dataset.id); if (!r) return;
      if (b.dataset.a === 'open') { loadRoute(r); }
      if (b.dataset.a === 'ride') startRide(r);
      if (b.dataset.a === 'send') sendSheet(r);
      if (b.dataset.a === 'del' && confirm('Delete "' + r.name + '"?')) { OR.routes.del(r.id); renderPlan(); }
    });
  }
  function loadRoute(r) {
    OR.plan.wps = r.wps.map(w => Object.assign({}, w)); OR.savePlan();
    OR.plan.options = [r]; OR.plan.choice = 0; OR.plan.route = r; planMode = 'ab'; clearRouteExtras();
    drawWaypoints(); showOptions(true); renderPlan(); tab('plan');
  }
  OR.loadRoute = loadRoute;
  window.onGpxFile = (name, text) => importGpx(text, name); // Android: a GPX opened from Files or another app
  async function importGpx(text, file) {
    let g; try { g = OR.parseGpx(text); } catch (e) { OR.toast(e.message, 5000); return; }
    const name = g.name || String(file || 'GPX').replace(/\.gpx$/i, '');
    const items = [];
    g.routes.forEach((r, i) => items.push({ label: 'Route: ' + (r.name || 'route ' + (i + 1)) + ' (' + r.pts.length + ' points)', kind: 'rte', d: r }));
    g.tracks.forEach((t, i) => items.push({ label: 'Track: ' + (t.name || 'track ' + (i + 1)) + ' (' + OR.fmtDist(OR.cumulative(t.pts).pop()) + ')', kind: 'trk', d: t }));
    if (!items.length && g.wpts.length > 1) items.push({ label: 'Waypoints (' + g.wpts.length + ')', kind: 'wpt', d: { name, pts: g.wpts } });
    if (!items.length) { OR.toast('No route or track found in this GPX', 5000); return; }
    sheet('<h2>Import ' + esc(name) + '</h2><div class="list">' + items.map((it, i) =>
      '<div class="li"><b>' + esc(it.label) + '</b><div class="row">' +
      (it.kind === 'trk' ? '<button class="btn pri" data-i="' + i + '" data-m="exact">Follow exactly</button><button class="btn" data-i="' + i + '" data-m="via">Plan through it</button>'
        : '<button class="btn pri" data-i="' + i + '" data-m="via">Plan through these points</button>') +
      '</div></div>').join('') + '</div><p class="small muted">Follow exactly matches the track to the roads, so you get spoken turns on the exact line. Plan through it routes between up to 30 of its points in your riding style.</p>',
      box => $$('button[data-i]', box).forEach(b => b.onclick = async () => {
        const it = items[+b.dataset.i]; closeSheet();
        try {
          if (b.dataset.m === 'exact') {
            const r = await OR.routeFromTrack(it.d.pts, it.d.name || name);
            OR.routes.save(r); loadRoute(r); OR.toast('Imported and saved');
          } else {
            let pts = it.d.pts;
            if (pts.length > 30) { const step = (pts.length - 1) / 29; pts = Array.from({ length: 30 }, (_, k) => pts[Math.round(k * step)]); }
            OR.plan.wps = pts.map((p, i) => ({ lng: p[0], lat: p[1], name: p.name || (i === 0 ? 'Start' : i === pts.length - 1 ? 'End' : 'Point ' + i), type: i === 0 || i === pts.length - 1 ? 'break' : 'through' }));
            planMode = 'ab'; changed(true);
          }
        } catch (e) { OR.toast('Import failed: ' + e.message, 7000); }
      }));
  }

  // ---------- nearby: chips under the search bar ----------
  const NEAR = ['fuel', 'cafe', 'stay', 'pub', 'view', 'motopark', 'bikeshop', 'camp', 'pass'];
  const CHIP = { fuel: 'Fuel', cafe: 'Cafés', stay: 'Stays', pub: 'Pubs', view: 'Viewpoints', motopark: 'Bike parking', bikeshop: 'Bike shops', camp: 'Campsites', pass: 'Passes' };
  function bindChips() {
    const el = $('#chips');
    el.innerHTML = NEAR.slice(0, 5).map(k => '<button data-near="' + k + '" style="--c:' + OR.POI[k].c + '">' + ic(OR.POI[k].i) + CHIP[k] + '</button>').join('') +
      '<button id="greatRoads" style="--c:#8e24aa">' + ic('twisty') + 'Great roads</button>' + NEAR.slice(5).map(k => '<button data-near="' + k + '" style="--c:' + OR.POI[k].c + '">' + ic(OR.POI[k].i) + CHIP[k] + '</button>').join('');
    $$('[data-near]', el).forEach(bt => bt.onclick = () => { if (innerWidth < 900) $('#panel').classList.remove('open'); const c = OR.pos ? [OR.pos.lng, OR.pos.lat] : OR.map.getCenter().toArray(); findNearby(bt.dataset.near, c); });
    $('#greatRoads', el).onclick = () => { if (innerWidth < 900) $('#panel').classList.remove('open'); OR.findGreatRoads(); };
  }

  async function findNearby(kind, ll, onPick) {
    OR.toast('Looking for ' + OR.KINDS[kind].label.toLowerCase() + '…');
    try {
      const r = kind === 'fuel' ? 8000 : 10000;
      const list = await OR.nearby(kind, ll[0], ll[1], r);
      if (kind === 'fuel') { await OR.addFuelPrices(list).catch(() => { }); if (list.some(p => p.price)) list.sort((a, b) => (a.price ? 0 : 1) - (b.price ? 0 : 1) || a.d - b.d); }
      OR.lastPois = list; OR.setData('pois', OR.poiGeo(list)); OR.poiPick = onPick || null;
      if (!list.length) { OR.toast('None found within ' + OR.fmtDist(r)); return; }
      sheet('<h2>' + OR.KINDS[kind].label + (onPick ? ' near the end of the day' : ' nearby') + '</h2>' + (onPick ? '<p class="small">Tap one to see it, then "Use for this trip".</p>' : '') + '<div class="list">' +
        list.slice(0, 40).map((p, i) => { const d = OR.poiDetails(p); return '<button class="li" data-i="' + i + '"><b>' + esc(p.name) + (p.price ? ' <i class="pricetag">' + esc(OR.priceLabel(p)) + '</i>' : '') + '</b><span>' + esc([d.type, OR.fmtDist(p.d) + ' away', p.price ? OR.priceAge(p.price.at) : '', d.phone ? 'phone' : '', d.web ? 'website' : ''].filter(Boolean).join(', ')) + '</span></button>'; }).join('') + '</div>',
        box => $$('.li', box).forEach(b => b.onclick = () => { const p = list[+b.dataset.i]; closeSheet(); if (innerWidth < 900) $('#panel').classList.remove('open'); OR.map.flyTo({ center: [p.lng, p.lat], zoom: 15 }); setTimeout(() => poiPopup({ properties: { id: p.id } }), 650); }));
      if (!OR.ride.on) OR.map.fitBounds(OR.bbox(list.slice(0, 15).map(p => [p.lng, p.lat]).concat([ll])), { padding: 80, maxZoom: 14 });
    } catch (e) { OR.toast('Search failed: ' + e.message, 6000); }
  }
  OR.findNearby = findNearby;

  // ---------- rides ----------
  let ridesShown = 30; // newest first; older ones on request, so a long history doesn't slow the tab
  function renderRides() {
    const v = $('#v-rides'), list = OR.rides.list();
    const yr = new Date().getFullYear(), season = list.filter(r => new Date(r.start).getFullYear() === yr);
    const tot = season.reduce((a, r) => ({ d: a.d + r.dist, t: a.t + r.moving, l: Math.max(a.l, r.leanL || 0, r.leanR || 0) }), { d: 0, t: 0, l: 0 });
    v.innerHTML = '<h2 class="vh">Rides</h2><button id="freeRide" class="btn wide go">' + ic('rides') + 'Record a ride</button>' +
      '<div class="stats"><div><b>' + season.length + '</b><span>rides in ' + yr + '</span></div><div><b>' + OR.fmtDist(tot.d) + '</b><span>ridden</span></div><div><b>' + OR.fmtTime(tot.t) + '</b><span>moving</span></div>' + (tot.l ? '<div><b>' + tot.l + '°</b><span>best lean</span></div>' : '') + '</div>' +
      (list.length ? '<button id="seasonBtn" class="btn wide">' + ic('star') + 'Your riding in numbers</button>' : '') +
      (list.length ? '<div class="list">' + list.slice(0, ridesShown).map(r => '<div class="li"><b>' + esc(r.name) + '</b><span>' +
        new Date(r.start).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) + '</span>' +
        '<div class="kv"><span><b>' + OR.fmtDist(r.dist) + '</b>distance</span><span><b>' + OR.fmtTime(r.moving) + '</b>moving</span><span><b>' + (r.moving ? OR.speed(r.dist / r.moving) : 0) + '</b>avg ' + OR.speedUnit() + '</span><span><b>' + OR.speed(r.max) + '</b>max ' + OR.speedUnit() + '</span>' +
        (r.leanL || r.leanR ? '<span><b>' + (r.leanL || 0) + '° / ' + (r.leanR || 0) + '°</b>lean L / R</span>' : '') + '</div>' +
        '<div class="row"><button class="btn small" data-a="show" data-id="' + r.id + '">Show</button><button class="btn small" data-a="replay" data-id="' + r.id + '">Replay</button><button class="btn small" data-a="more" data-id="' + r.id + '">' + ic('menu') + 'More</button></div></div>').join('') + '</div>'
        + (list.length > ridesShown ? '<button class="btn wide ghost" id="ridesMore">Show older rides (' + (list.length - ridesShown) + ' more)</button>' : '')
        : '<div class="empty">' + ic('rides', 'big') + '<p>Every ride is recorded with distance, time, speeds and an estimate of your lean angle. Recording carries on with the screen off in the Android app.</p></div>') +
      '<p class="small muted">Lean angle is estimated from GPS speed and how sharply you turn, so treat it as a guide rather than a measurement.</p>';
    $('#freeRide', v).onclick = () => startRide(null);
    const rm = $('#ridesMore', v); if (rm) rm.onclick = () => { ridesShown += 40; renderRides(); };
    const ss = $('#seasonBtn', v); if (ss) ss.onclick = () => OR.seasonStats(yr);
    // the less-used things for a ride, in one sheet: share it, look at it, keep it
    const more = r => {
      const row = (a, i, c, t, d) => '<button data-a="' + a + '" data-id="' + r.id + '">' + badge(i, c) + '<span><b>' + t + '</b><small>' + d + '</small></span>' + ic('chev', 'chev') + '</button>';
      sheet('<h2>' + ic('rides') + esc(r.name) + '</h2><h3 class="grp">Share</h3><div class="menu">' + row('card', 'star', '#ef8f00', 'Picture', 'A map card with your numbers, for WhatsApp or Facebook') +
        row('fly', 'pass', '#7e57c2', 'Flyover video', '30 seconds flying over the hills you rode') + row('video', 'cam', '#d81b60', 'Helmet-cam video', 'Your footage with speed, lean and a map on it') + '</div>' +
        '<h3 class="grp">Look back</h3><div class="menu">' + row('coach', 'lean', '#1565c0', 'Corner coach', 'Your smoothest bends, and ones to work on') + '</div>' +
        '<h3 class="grp">Keep</h3><div class="menu">' + row('route', 'save', '#0e9f57', 'Save as a route', 'Ride it again with directions') + row('gpx', 'dl', '#5d6d7e', 'GPX file', 'For other apps and Garmin') + row('del', 'x', '#c62828', 'Delete', 'Remove this ride from the phone') + '</div>', b => {
        const del = b.querySelector('button[data-a=del]'); if (del) del.classList.add('danger');
        $$('button[data-a]', b).forEach(x => x.onclick = () => { closeSheet(); act(x.dataset.a, r); });
      });
    };
    $$('button[data-a]', v).forEach(b => b.onclick = () => { const r = OR.rides.get(b.dataset.id); if (r) act(b.dataset.a, r); });
    async function act(a, r) {
      const pts = OR.rides.pts(r), b = { dataset: { a } };
      if (a === 'more') return more(r);
      if (b.dataset.a === 'show') { OR.setData('rideview', { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: pts } }] }); OR.map.fitBounds(OR.bbox(pts), { padding: 60 }); if (innerWidth < 900) $('#panel').classList.remove('open'); }
      if (b.dataset.a === 'gpx') OR.saveFile(OR.fileName(r.name) + '.gpx', OR.toGpx({ name: r.name, pts, times: OR.rides.times(r) }));
      if (b.dataset.a === 'replay') OR.replayRide(r);
      if (b.dataset.a === 'card') OR.rideCard(r);
      if (b.dataset.a === 'coach') OR.cornerCoach(r);
      if (b.dataset.a === 'video') OR.rideVideo(r);
      if (b.dataset.a === 'fly') { OR.closeSheet && OR.closeSheet(); if (innerWidth < 900) $('#panel').classList.remove('open'); OR.flyover(r); }
      if (b.dataset.a === 'route') { try { const rt = await OR.routeFromTrack(pts, r.name); OR.routes.save(rt); OR.toast('Saved to Saved routes'); } catch (e) { OR.toast('Could not make a route: ' + e.message, 6000); } }
      if (b.dataset.a === 'del' && confirm('Delete this ride?')) { OR.rides.del(r.id); renderRides(); }
    }
  }

  // ---------- more ----------
  let morePage = null;
  const field = (id, label, val, type, ph) => '<label class="f"><span>' + label + '</span><input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '" placeholder="' + esc(ph || '') + '"' + (type === 'number' ? ' inputmode="decimal" step="any"' : '') + '></label>';
  OR.field = field;
  const PAGES = [['group', 'group', 'Group ride', 'See your riding group live on the map', '#e53935'], ['chat', 'chat', 'Group chat', 'Quick messages, read aloud and notifications', '#0e9f57'], ['bike', 'moto', 'My bike and fuel', 'Range, mpg and low-fuel warnings', '#0e9f57'], ['maint', 'wrench', 'Maintenance', 'Services, tyres, pre-ride check and MOT', '#1565c0'], ['safety', 'shield', 'Crash alert and check-in', 'Crash detection, check-in, speed and break warnings', '#e53935'], ['aware', 'warn', 'Road-ahead warnings', 'Bends, low sun, tiredness, shared hazards, bike to bike', '#ef6c00'],
    ['ice', 'helmet', 'Emergency card', 'Your ICE details for first responders', '#ef8f00'], ['maps', 'map', 'Offline maps', 'Country packs for riding with no signal', '#1e88e5'],
    ['settings', 'gear', 'Map and routing', 'Units, colours, tolls, ferries, cameras, traffic', '#5d6d7e'], ['voice', 'mic', 'Voice and watch', 'Voice commands, intercom button, watch alerts, turn countdown bar', '#1565c0'],
    ['phrases', 'chat', 'Phrasebook', 'French, Dutch and German, spoken aloud', '#1e88e5'],
    ['papers', 'id', 'Papers', 'Licence, V5C, insurance, MOT and breakdown cover', '#00897b'],
    ['auto', 'moto', 'Android Auto', 'Setting it up on a car screen', '#3949ab'],
    ['about', 'update', 'Updates and about', 'Version, updates, where the data comes from', '#8e6bd6']];
  function renderMore() {
    const v = $('#v-more');
    if (!morePage) {
      const sec = (title, ids) => '<h3 class="grp">' + title + '</h3><div class="menu">' + ids.map(id => PAGES.find(p => p[0] === id)).map(p => '<button data-p="' + p[0] + '">' + badge(p[1], p[4]) + '<span><b>' + p[2] + '</b><small>' + p[3] + '</small></span>' + ic('chev', 'chev') + '</button>').join('') + '</div>';
      const c = OR.cfg, qs = (id, val, opts) => '<div class="seg qseg" id="' + id + '">' + opts.map(([k, l]) => '<button data-v="' + k + '" class="' + (val === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
      v.innerHTML = '<h2 class="vh">Settings</h2>' +
        '<div class="quick"><div class="q-row"><span>' + ic('sun') + 'Map colours</span>' + qs('qTheme', c.theme, [['auto', 'Auto'], ['day', 'Day'], ['night', 'Night']]) + '</div>' +
        '<div class="q-row"><span>' + ic(c.voice ? 'vol' : 'mute') + 'Spoken directions</span>' + qs('qVoice', c.voice ? 'on' : 'off', [['on', 'On'], ['off', 'Off']]) + '</div>' +
        '<div class="q-row"><span>' + ic('map') + 'Units</span>' + qs('qUnits', c.units, [['mi', 'Miles'], ['km', 'Km']]) + '</div>' +
        '<div class="q-row"><span>' + ic('star') + 'Look</span>' + qs('qLook', c.look || 'classic', [['outlaw', 'Outlaw'], ['classic', 'Classic']]) + '</div></div>' +
        sec('Riding', ['settings', 'voice', 'aware', 'maps']) + sec('Safety', ['safety', 'ice']) + sec('Group rides', ['chat']) + sec('Riding abroad', ['papers', 'phrases']) + sec('App', ['auto', 'about']) +
        (A ? '<p class="small muted center">OpenRoad ' + esc(A.version()) + '</p>' : '');
      $$('.menu button', v).forEach(b => b.onclick = () => { morePage = b.dataset.p; renderMore(); $('#views').scrollTop = 0; });
      const qb = (id, fn) => $$('#' + id + ' button', v).forEach(x => x.onclick = () => { fn(x.dataset.v); OR.saveCfg(); renderMore(); });
      qb('qTheme', x => { c.theme = x; OR.applyTheme(); });
      qb('qVoice', x => { c.voice = x === 'on'; if (!c.voice) OR.hush(); });
      qb('qUnits', x => { c.units = x; renderAll && renderAll(); });
      qb('qLook', x => { c.look = x; OR.applyTheme(); });
      return;
    }
    const p = PAGES.find(x => x[0] === morePage);
    v.innerHTML = '<button class="backbtn" id="moreBack">' + ic('back') + 'Settings</button><h2 class="vh">' + p[2] + '</h2><div id="morePage"></div>';
    $('#moreBack', v).onclick = () => { morePage = null; renderMore(); };
    ({ phrases: p => OR.pagePhrases(p), voice: p => handsFree(p, true), group: p => OR.pageGroup(p), chat: pageChat, bike: p => OR.pageBike(p), maint: OR.pageMaint, safety: pageSafety, ice: pageIce, maps: pageMaps, settings: pageSettings, about: pageAbout, auto: pageAuto, aware: p => OR.awareSettings && OR.awareSettings(p) })[morePage]($('#morePage', v));
  }
  // pages that now have their own tab
  OR.openMore = p => {
    if (p === 'group') return tab('group');
    if (p === 'bike' || p === 'maint' || p === 'papers') { bikeSeg = p; return tab('bike'); }
    morePage = p; tab('more'); renderMore();
  };
  function renderGroupTab() {
    const v = $('#v-group');
    v.innerHTML = '<h2 class="vh">Group ride</h2><div id="groupPage"></div>';
    OR.pageGroup($('#groupPage', v));
  }
  OR.renderGroupTab = renderGroupTab;
  let bikeSeg = 'bike';
  function renderBike() {
    const v = $('#v-bike'), name = (OR.cfg.bike && OR.cfg.bike.name) || 'My bike';
    v.innerHTML = '<h2 class="vh">' + esc(name) + '</h2><div class="seg big" id="bikeSeg"><button data-v="bike" class="' + (bikeSeg === 'bike' ? 'on' : '') + '">Bike and fuel</button><button data-v="maint" class="' + (bikeSeg === 'maint' ? 'on' : '') + '">Maintenance</button><button data-v="papers" class="' + (bikeSeg === 'papers' ? 'on' : '') + '">Papers</button></div><div id="bikePage"></div>';
    $$('#bikeSeg button', v).forEach(b => b.onclick = () => { bikeSeg = b.dataset.v; renderBike(); });
    (bikeSeg === 'maint' ? OR.pageMaint : bikeSeg === 'papers' ? OR.pagePapers : OR.pageBike)($('#bikePage', v));
  }
  OR.renderBike = renderBike;
  function keep(box, id, obj, key, num, after) { const el = $('#' + id, box); el.onchange = () => { obj[key] = num ? (el.value === '' ? '' : parseFloat(el.value)) : el.value.trim(); OR.saveCfg(); if (after) after(); }; }

  function pageChat(box) {
    const c = OR.chatCfg(), on = OR.group && OR.group.state.on;
    box.innerHTML = (on ? '<button id="pcOpen" class="btn wide pri">' + ic('chat') + 'Open the group chat</button>' : '<p class="small">The chat works in a group ride: start or join one in the <b>Group</b> tab. The chat is there, and on the chat button in the ride bar while riding.</p><button id="pcGroup" class="btn wide">' + ic('group') + 'Group ride</button>') +
      '<h3 class="gh">When a message comes in</h3>' +
      '<label class="chk"><input type="checkbox" id="pcVoice"' + (c.voice ? ' checked' : '') + '> Read it out (through your intercom or headphones)</label>' +
      '<label class="chk"><input type="checkbox" id="pcNote"' + (c.notify ? ' checked' : '') + '> Show a notification when OpenRoad isn\'t on screen</label>' +
      '<label class="chk"><input type="checkbox" id="pcShow"' + (c.showPresets ? ' checked' : '') + '> Show the quick message buttons when the chat opens</label>' +
      '<h3 class="gh">Quick messages</h3><p class="small muted">One tap sends these. "Need help" is always there and also sends your position.</p>' +
      '<div class="presets">' + c.presets.map((t, i) => '<div class="pr"><span>' + esc(t) + '</span><button data-up="' + i + '" aria-label="Move up"' + (i ? '' : ' disabled') + '>▲</button><button data-down="' + i + '" aria-label="Move down"' + (i < c.presets.length - 1 ? '' : ' disabled') + '>▼</button><button data-del="' + i + '" aria-label="Remove">' + ic('x') + '</button></div>').join('') + '</div>' +
      '<div class="joinrow">' + field('pcNew', 'Add a quick message', '', 'text', 'e.g. Pub at 6?') + '<button id="pcAdd" class="btn">Add</button></div>' +
      '<button id="pcReset" class="btn wide ghost">Put back the standard ones</button>';
    const save = () => { OR.saveCfg(); OR.chatApply(); OR.chatPresetsChanged && OR.chatPresetsChanged(); pageChat(box); };
    $('#pcVoice', box).onchange = e => { c.voice = e.target.checked; save(); };
    $('#pcNote', box).onchange = e => { c.notify = e.target.checked; save(); };
    $('#pcShow', box).onchange = e => { c.showPresets = e.target.checked; save(); };
    $$('[data-up]', box).forEach(b => b.onclick = () => { const i = +b.dataset.up; [c.presets[i - 1], c.presets[i]] = [c.presets[i], c.presets[i - 1]]; save(); });
    $$('[data-down]', box).forEach(b => b.onclick = () => { const i = +b.dataset.down; [c.presets[i + 1], c.presets[i]] = [c.presets[i], c.presets[i + 1]]; save(); });
    $$('[data-del]', box).forEach(b => b.onclick = () => { c.presets.splice(+b.dataset.del, 1); if (!c.presets.length) c.presets = OR.CHAT_PRESETS.slice(); save(); });
    const add = () => { const t = $('#pcNew', box).value.trim().slice(0, 40); if (!t) return; c.presets.push(t); save(); };
    $('#pcAdd', box).onclick = add; $('#pcNew', box).onkeydown = e => { if (e.key === 'Enter') add(); };
    $('#pcReset', box).onclick = () => { if (confirm('Put back the standard quick messages?')) { c.presets = OR.CHAT_PRESETS.slice(); save(); } };
    const o = $('#pcOpen', box); if (o) o.onclick = () => OR.openChat();
    const g = $('#pcGroup', box); if (g) g.onclick = () => OR.openMore('group');
  }
  function pageSafety(box) {
    const ci = OR.cfg.checkin, at = OR.cfg.checkinAt;
    box.innerHTML = '<div id="sfCheck"><h3 class="gh">Check-in</h3><p class="small">Set a time to check in. If you don\'t tap "I\'m OK" by then, the phone alarms. If there\'s still no answer after the grace time, your contact gets a text with your last position.</p>' +
      '<div class="two">' + field('cName', 'Contact name', ci.name) + field('cPhone', 'Contact mobile', ci.phone, 'tel', '07…') + '</div>' +
      '<div class="two">' + field('cGrace', 'Grace time (minutes)', ci.grace, 'number') + field('cEvery', 'Repeat every (hours, 0 for once)', ci.every, 'number') + '</div>' +
      (at ? '<div class="card warnc"><b>Check-in due ' + OR.clock(new Date(at)) + (new Date(at).toDateString() !== new Date().toDateString() ? ' on ' + new Date(at).toLocaleDateString('en-GB') : '') + '</b><div class="row"><button id="ciOk" class="btn pri">I\'m OK</button><button id="ciOff" class="btn ghost">Turn off</button></div></div>'
        : '<div class="row"><label class="f inline"><span>Check in by</span><input id="ciTime" type="time" value="' + defaultTime() + '"></label><button id="ciArm" class="btn pri">Set check-in</button></div>') +
      (A ? '' : '<p class="small muted">In a browser the text can only be opened for you to send. The Android app sends it itself.</p>') + '</div>';
    keep(box, 'cName', ci, 'name'); keep(box, 'cPhone', ci, 'phone'); keep(box, 'cGrace', ci, 'grace', 1); keep(box, 'cEvery', ci, 'every', 1);
    const arm = $('#ciArm', box); if (arm) arm.onclick = () => {
      const [h, m] = $('#ciTime', box).value.split(':').map(Number); if (isNaN(h)) return;
      const d = new Date(); d.setHours(h, m, 0, 0); if (d < Date.now()) d.setDate(d.getDate() + 1);
      if (OR.checkin.armAt(d.getTime())) { OR.toast('Check-in set for ' + OR.clock(d)); pageSafety(box); }
    };
    safetyExtras(box);
    box.appendChild($('#sfCheck', box)); // crash detection first, then check-in
    const ok = $('#ciOk', box); if (ok) ok.onclick = () => { OR.checkin.ok(); pageSafety(box); };
    const off = $('#ciOff', box); if (off) off.onclick = () => { OR.checkin.cancel(); pageSafety(box); };
  }
  // voice commands and watch alerts, at the end of Settings
  function handsFree(box) {
    const c = OR.cfg, el = document.createElement('div');
    box.innerHTML = '';
    el.innerHTML = '<p class="small">Tap the microphone in the ride bar and say what you want. Answers are spoken.</p>' +
      '<label class="chk"><input type="checkbox" id="sVBtn"' + (c.voiceButton ? ' checked' : '') + '> Use my intercom or headset button to start a voice command while riding</label>' +
      '<p class="small muted">Most Sena and Cardo intercoms send a play/pause press from their button. While this is on, that press starts a voice command instead of playing music. It depends on the intercom, so try it before a ride.</p>' +
      '<details><summary>What you can say</summary><ul class="vhelp">' + OR.VOICE_HELP.map(h => '<li><b>' + esc(h[0]) + '</b><br><span>' + esc(h[1]) + '</span></li>').join('') + '</ul></details>' +
      (A ? '<button id="sVTry" class="btn wide">' + ic('mic') + 'Try a voice command</button>' : '') +
      '<h3>Watch</h3><label class="chk"><input type="checkbox" id="sWatch"' + (c.watchTurns ? ' checked' : '') + '> Alert my watch at each turn</label>' +
      '<p class="small muted">Each turn pops up as a notification, so a paired watch (Galaxy Watch and others) buzzes and shows it, for example "Turn left onto the A515". On a Galaxy Watch, turn on "Show phone notifications on watch while using phone" in the Galaxy Wearable app, or it only shows them when the phone screen is off.</p>' +
      '<h3>Ride screen</h3><label class="chk"><input type="checkbox" id="sTurnBar"' + (c.turnBar !== false ? ' checked' : '') + '> Countdown bar for the next turn</label>' +
      '<p class="small muted">A bar down the right side that empties as the next turn gets closer, with the distance and the turn arrow.</p>';
    box.appendChild(el);
    $('#sVBtn', el).onchange = e => { c.voiceButton = e.target.checked; OR.saveCfg(); OR.voiceApply(); };
    $('#sWatch', el).onchange = e => { c.watchTurns = e.target.checked; OR.saveCfg(); if (c.watchTurns && A && A.turnNote) A.turnNote('Watch alerts are on: turns will show here'); };
    $('#sTurnBar', el).onchange = e => { c.turnBar = e.target.checked; OR.saveCfg(); if (!c.turnBar) countdown(null); };
    const tr = $('#sVTry', el); if (tr) tr.onclick = () => OR.voiceListen();
  }
  // crash detection, over-the-limit warning and break reminders, below the check-in
  function safetyExtras(box) {
    const s = OR.safetyCfg(), c = OR.crashContact();
    const el = document.createElement('div');
    el.innerHTML = '<h3 class="gh">Crash detection</h3>' +
      '<label class="chk"><input type="checkbox" id="sCrash"' + (s.crash ? ' checked' : '') + '> Watch for a crash while recording a ride or in a group ride</label>' +
      '<p class="small">If the phone feels a hard impact while you\'re riding and the bike then stops, it alarms for 60 seconds. If you don\'t tap "I\'m OK", ' +
      (c ? '<b>' + esc(c.name) + '</b> (' + esc(c.phone) + ')' : '<b>your contact</b>') + ' gets a text with your position, and your group is told if you\'re in a group ride.' +
      (c ? '' : ' <b>Add a contact under Check-in below (or on the Emergency card) first.</b>') + ' The text includes your blood group and medical notes from the Emergency card, if you\'ve filled them in.</p>' +
      '<p class="small muted">The phone needs to be on the bike or on you, and works best in a mount. It can\'t catch every crash, and a hard knock while stopped won\'t set it off. ' + (A ? 'Changes apply from your next ride.' : 'Crash detection needs the Android app.') + '</p>' +
      (A ? '<button id="sCrashTest" class="btn wide ghost">Test the alarm (nothing is sent)</button>' : '') +
      '<h3 class="gh">Speed limit warning</h3>' +
      '<label class="f"><span>Chime and say the limit when I\'m</span><select id="sOver"><option value="off">Off</option><option value="any">Over the limit</option><option value="guide">More than 10% + 2 mph over</option></select></label>' +
      '<p class="small muted">Works on planned routes, where OpenRoad knows the limits (they come from OpenStreetMap and are sometimes missing or out of date). GPS speed is usually a little lower than your speedo shows, because speedos read high.</p>' +
      '<h3 class="gh">Break reminders</h3>' +
      '<label class="f"><span>Remind me to stop after</span><select id="sBreak"><option value="0">Off</option><option value="1.5">1½ hours</option><option value="2">2 hours</option><option value="2.5">2½ hours</option><option value="3">3 hours</option></select></label>' +
      '<p class="small muted">It counts riding time since your last stop of 10 minutes or more, and suggests a café or fuel stop just ahead.</p>';
    box.appendChild(el);
    $('#sOver', el).value = s.overLimit; $('#sBreak', el).value = String(s.breakEvery);
    $('#sCrash', el).onchange = e => {
      if (e.target.checked && !OR.crashContact()) { OR.toast('Add a contact number first, at the top of this page'); }
      s.crash = e.target.checked; OR.saveCfg(); OR.crashSync();
    };
    $('#sOver', el).onchange = e => { s.overLimit = e.target.value; OR.saveCfg(); };
    $('#sBreak', el).onchange = e => { s.breakEvery = parseFloat(e.target.value); OR.saveCfg(); };
    const t = $('#sCrashTest', el); if (t) t.onclick = () => { OR.crashSync(); A.crashTest(); setTimeout(OR.crashPoll, 300); const iv = setInterval(() => { OR.crashPoll(); if (!document.getElementById('crashBox')) clearInterval(iv); }, 1000); };
    ['cName', 'cPhone'].forEach(id => { const f = $('#' + id, box); if (f) f.addEventListener('change', () => OR.crashSync()); });
  }
  function defaultTime() { const d = new Date(Date.now() + 4 * 3600000); return String(d.getHours()).padStart(2, '0') + ':00'; }
  function pageIce(box) {
    const ice = OR.cfg.ice;
    box.innerHTML = field('iName', 'Your name', ice.name) + '<div class="two">' + field('iBlood', 'Blood group', ice.blood) + field('iReg', 'Bike registration', ice.reg) + '</div>' +
      field('iMed', 'Medical notes (allergies, conditions, medication)', ice.medical) + '<div class="two">' + field('iCN', 'Emergency contact', ice.contactName) + field('iCP', 'Contact number', ice.contactPhone, 'tel') + '</div>' +
      '<button id="iceShow" class="btn wide pri">Show the card full screen</button><p class="small muted">Kept only on this phone.</p>';
    keep(box, 'iName', ice, 'name'); keep(box, 'iBlood', ice, 'blood'); keep(box, 'iReg', ice, 'reg'); keep(box, 'iMed', ice, 'medical'); keep(box, 'iCN', ice, 'contactName'); keep(box, 'iCP', ice, 'contactPhone');
    $('#iceShow', box).onclick = () => sheet('<div class="ice"><pre>' + esc(OR.iceText()) + (OR.pos && OR.osGrid && OR.osGrid(OR.pos.lat, OR.pos.lng) ? '\nNow at OS grid ref ' + OR.osGrid(OR.pos.lat, OR.pos.lng).ref : '') + '</pre>' + (ice.contactPhone ? '<a class="btn wide pri" href="tel:' + esc(ice.contactPhone.replace(/\s/g, '')) + '">Call ' + esc(ice.contactName || 'contact') + '</a>' : '') + '</div>');
  }
  OR.on('checkin', () => { if (morePage === 'safety' && $('#morePage')) pageSafety($('#morePage')); });
  OR.on('checkinDue', () => {
    sheet('<div class="due"><h2>Safety check-in</h2><p>Tap below to let OpenRoad know you\'re OK. If you don\'t, ' + esc(OR.cfg.checkin.name || 'your contact') + ' will get a text with your position in ' + (OR.cfg.checkin.grace || 10) + ' minutes.</p><button id="dueOk" class="btn wide go">I\'m OK</button></div>',
      box => $('#dueOk', box).onclick = () => { OR.checkinAlerting = false; OR.checkin.ok(); closeSheet(); });
  });

  let catalogue = null, packState = {};
  function pageMaps(box) {
    setTimeout(() => { const c = $('#packsOnly', box); if (c) c.onchange = () => { OR.cfg.packsOnly = c.checked; OR.saveCfg(); if (A.setPacksOnly) A.setPacksOnly(c.checked); }; }, 0);
    if (!A) { box.innerHTML = '<p class="hint">Offline map packs are part of the Android app. In a browser the map loads from the internet as you go.</p>'; return; }
    const inst = OR.packs.installed(), info = OR.cacheInfo();
    let h = '<p class="small">A pack holds a whole country\'s map so it works with no signal. Download on Wi-Fi: big countries are several hundred MB.</p>';
    h += '<label class="chk"><input type="checkbox" id="packsOnly"' + (OR.cfg.packsOnly ? ' checked' : '') + '> Save mobile data: never download map at country borders</label>' +
      '<p class="small muted">Where a pack ends at a border or coast, OpenRoad uses the full online map when there\'s signal, so neighbouring countries aren\'t blank. Tick this to use only your packs (areas outside them stay blank).</p>';
    if (!catalogue) { h += '<p class="muted">Loading the list of packs…</p>'; OR.packs.catalogue().then(c => { catalogue = c; if (morePage === 'maps') pageMaps(box); }).catch(e => { catalogue = []; packState._err = e.message; if (morePage === 'maps') pageMaps(box); }); }
    else if (!catalogue.length) h += '<p class="err">No packs listed' + (packState._err ? ' (' + esc(packState._err) + ')' : '') + '.</p>';
    else h += '<div class="list">' + catalogue.map(p => {
      const have = inst.find(i => i.id === p.id), st = packState[p.id];
      const pct = st && st.state === 'downloading' ? Math.round(100 * st.done / Math.max(1, st.total)) : null;
      return '<div class="li"><b>' + esc(p.name) + '</b><span>' + Math.round(p.size / 1048576) + ' MB' + (p.date ? ', map data from ' + esc(new Date(p.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })) : '') + (have ? ', on this phone' : '') + (st && /^error/.test(st.state) ? '. ' + esc(st.state) : '') + '</span>' +
        (pct != null ? '<span class="bar dl"><i style="width:' + pct + '%"></i></span>' : '') +
        '<div class="row">' + (pct != null ? '<span class="small muted">' + pct + '%</span>' : '<button class="btn small ' + (have ? 'ghost' : 'pri') + '" data-get="' + p.id + '">' + (have ? 'Update' : 'Download') + '</button>') +
        (have ? '<button class="btn small ghost" data-del="' + p.id + '">Delete</button>' : '') + '</div></div>';
    }).join('') + '</div>';
    if (info) h += '<h3>Saved map tiles</h3><p class="small">' + info.tiles + ' tiles, ' + Math.round(info.bytes / 1048576) + ' MB, from browsing and Save offline on routes.</p><button class="btn ghost" id="clrCache">Clear saved tiles</button>';
    h += '<p class="small muted">Planning routes and searching need a signal. Planned and saved routes keep their directions with no signal.</p>';
    box.innerHTML = h;
    $$('[data-get]', box).forEach(b => b.onclick = () => { const p = catalogue.find(c => c.id === b.dataset.get); packState[p.id] = { state: 'downloading', done: 0, total: p.size }; OR.packs.download(p); pageMaps(box); });
    $$('[data-del]', box).forEach(b => b.onclick = () => { if (confirm('Delete this map pack?')) { OR.packs.del(b.dataset.del); pageMaps(box); } });
    const cc = $('#clrCache', box); if (cc) cc.onclick = () => { if (confirm('Clear saved map tiles? Country packs are kept.')) { A.clearTiles(); pageMaps(box); } };
  }
  OR.on('pack', s => { packState[s.id] = s; if (s.state === 'done') { OR.toast('Map pack installed'); OR.map.setStyle(OR.buildStyle(OR.map.__mode), { diff: false }); } if (morePage === 'maps' && $('#morePage')) pageMaps($('#morePage')); });
  OR.on('tiles', s => { if (s.done === s.total) OR.toast('Map saved for offline: ' + (s.total - s.failed) + ' of ' + s.total + ' tiles' + (s.failed ? '. ' + s.failed + ' failed: try again with a better signal' : ''), 6000); });

  function pageSettings(box) {
    const c = OR.cfg;
    const seg = (id, val, opts) => '<div class="seg" id="' + id + '">' + opts.map(([k, l]) => '<button data-v="' + k + '" class="' + (val === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
    box.innerHTML = '<h3>Units</h3>' + seg('sUnits', c.units, [['mi', 'Miles and mph'], ['km', 'Kilometres']]) +
      '<h3>Map colours</h3>' + seg('sTheme', c.theme, [['auto', 'Auto'], ['day', 'Day'], ['night', 'Night']]) +
      '<h3>Spoken directions</h3>' + seg('sVoice', c.voice ? 'on' : 'off', [['on', 'On'], ['off', 'Off']]) + '<button class="btn wide" id="sTest">' + ic('vol') + 'Test the voice</button>' +
      '<p class="small muted">Directions play through the phone\'s audio, so pair your helmet headset with the phone over Bluetooth. Music is turned down while it speaks.</p>' +
      '<h3>Routes</h3><label class="chk"><input type="checkbox" id="sTolls"' + (c.avoidTolls ? ' checked' : '') + '> Avoid toll roads</label>' +
      '<label class="chk"><input type="checkbox" id="sFerry"' + (c.avoidFerries ? ' checked' : '') + '> Avoid ferries</label>' +
      '<h3>While riding</h3><label class="chk"><input type="checkbox" id="sCams"' + (c.cameras !== false ? ' checked' : '') + '> Speed camera warnings (UK and Ireland)</label>' +
      '<h3>Live traffic</h3>' + field('sTomtom', 'TomTom traffic key (free)', c.tomtomKey || '', 'text', 'paste your key') +
      '<p class="small muted">For roadworks, accidents and queues in the route brief. Get a free key at developer.tomtom.com (no card needed, 2,500 checks a month). It\'s kept only on this phone.</p>' +
      '<p class="small muted">Camera warnings are switched off everywhere else because warning devices are illegal in France, Germany and Switzerland. Camera locations come from OpenStreetMap and aren\'t complete.</p>' +
      '<h3>Home</h3><div class="card"><div class="row-l"><span class="lbl">Today\'s forecast and loop start from</span><b>' + esc(c.home ? c.home.name || 'Home' : 'Not set') + '</b></div><button class="btn small" id="sHome">' + (c.home ? 'Change' : 'Set') + '</button></div>' +
      '<h3>Today and recording</h3><label class="chk"><input type="checkbox" id="sToday"' + (c.today !== false ? ' checked' : '') + '> Today card on the Plan screen</label><p class="small">Whether it\'s a riding day, and when it\'s dry.</p>' +
      '<label class="chk"><input type="checkbox" id="sTodayLoop"' + (c.todayLoop !== false ? ' checked' : '') + '> Plan a loop for today</label><p class="small">A twisty round trip from home that fits the dry hours, planned once a day.</p>' +
      '<label class="chk"><input type="checkbox" id="sAuto"' + (c.autoRecord !== false ? ' checked' : '') + '> Record rides automatically</label><p class="small">When OpenRoad is open and you set off at riding speed, it starts recording; it stops when you\'ve been parked a while.</p>' +
      '<h3>Map</h3><label class="chk"><input type="checkbox" id="sHills"' + (c.hills !== false ? ' checked' : '') + '> Hill shading</label><p class="small">Shows the shape of the land. Needs a signal.</p>' +
      '<label class="chk"><input type="checkbox" id="sHills3d"' + (c.hills3d !== false ? ' checked' : '') + '> 3D hills when the map is tilted</label><p class="small">Tap 3D on the map, or tilt with two fingers. Turn off if the map feels slow on an older phone.</p>' +
      '<label class="chk"><input type="checkbox" id="sReveal"' + (c.reveal !== false ? ' checked' : '') + '> Draw new routes along the road</label><p class="small">A new route draws itself while the map flies over it.</p>';
    const segBind = (id, fn) => $$('#' + id + ' button', box).forEach(b => b.onclick = () => { fn(b.dataset.v); OR.saveCfg(); pageSettings(box); });
    segBind('sUnits', x => { c.units = x; renderAll(); });
    segBind('sTheme', x => { c.theme = x; OR.applyTheme(); });
    segBind('sVoice', x => { c.voice = x === 'on'; updateMute(); });
    $('#sTest', box).onclick = () => { const was = c.voice; c.voice = true; OR.say('In half a mile, turn left onto the A537.'); c.voice = was; };
    $('#sTolls', box).onchange = e => { c.avoidTolls = e.target.checked; OR.saveCfg(); };
    $('#sFerry', box).onchange = e => { c.avoidFerries = e.target.checked; OR.saveCfg(); };
    $('#sCams', box).onchange = e => { c.cameras = e.target.checked; OR.saveCfg(); };
    $('#sHome', box).onclick = () => OR.openSetup && OR.openSetup('home');
    const tog = (id, key, after) => { $('#' + id, box).onchange = e => { c[key] = e.target.checked; OR.saveCfg(); if (after) after(); }; };
    tog('sToday', 'today', () => renderPlan()); tog('sTodayLoop', 'todayLoop', () => OR.todayRefresh && OR.todayRefresh());
    tog('sAuto', 'autoRecord'); tog('sReveal', 'reveal');
    tog('sHills', 'hills', () => OR.restyle()); tog('sHills3d', 'hills3d', () => OR.restyle());
    $('#sTomtom', box).onchange = e => { c.tomtomKey = e.target.value.trim(); OR.saveCfg(); OR.toast(c.tomtomKey ? 'Traffic key saved' : 'Traffic key removed'); };
  }
  // Android Auto only lists apps from the Play Store unless "Unknown sources" is on in its developer settings
  function pageAuto(box) {
    let info = null; try { info = A && A.autoInfo ? JSON.parse(A.autoInfo()) : null; } catch (e) { }
    box.innerHTML = (info ? '<div class="card ' + (info.installed ? 'okc' : 'warnc') + '"><b>' + (info.installed ? 'Android Auto ' + esc(info.version || '') + ' is on this phone' : 'Android Auto isn\'t installed on this phone') + '</b>' + (info.installed ? '' : '<span class="small">Install it from the Play Store first.</span>') + '</div>' : '') +
      '<p class="small">OpenRoad is installed from its own download, not the Play Store. Android Auto hides apps like that until you switch on <b>Unknown sources</b>.</p>' +
      '<ol class="aasteps small"><li>Open Android Auto\'s settings: on a Samsung, <b>Settings, Apps, Android Auto</b>, then <b>Configure in Android Auto</b> (other phones: <b>Additional settings in the app</b>). The button below opens the Android Auto app page.</li>' +
      '<li>Scroll to the bottom and tap <b>Version</b> about 10 times, until it asks to allow development settings. Tap <b>OK</b>.</li>' +
      '<li>Tap the <b>three dots</b> at the top right, then <b>Developer settings</b>.</li>' +
      '<li>Turn on <b>Unknown sources</b>.</li>' +
      '<li>Unplug the phone from the car (or turn wireless Android Auto off and on), then connect again.</li>' +
      '<li>On the car screen, open the app list: OpenRoad should be there. If not, look in Android Auto\'s launcher settings on the phone and make sure OpenRoad isn\'t hidden.</li></ol>' +
      (A && A.openAutoSettings ? '<button class="btn wide pri" id="aaOpen">' + ic('gear') + 'Open Android Auto settings</button>' : '') +
      '<h3>On the car screen</h3><p class="small">OpenRoad shows your trip days and saved routes. Pick one to navigate, with the map, turn card and voice; or choose <b>Record a ride</b>. Plan routes on the phone first: planning isn\'t possible on the car screen.</p>' +
      '<p class="small muted">Android Auto may switch developer settings off again after it updates. If OpenRoad disappears from the car, check Unknown sources is still on.</p>';
    const b = $('#aaOpen', box); if (b) b.onclick = () => A.openAutoSettings();
  }
  function pageAbout(box) {
    box.innerHTML = (A ? '<div class="stats"><div><b>' + esc(A.version()) + '</b><span>your version</span></div></div><button id="sUpd" class="btn wide pri">' + ic('update') + 'Check for updates</button><p class="small muted">OpenRoad also checks each time it opens.</p>' : '') +
      '<h3>Where the data comes from</h3><p class="small">Map data © OpenStreetMap contributors. Map tiles from OpenFreeMap. Routing and speed limits by Valhalla on the FOSSGIS server. Place search by Photon (Komoot). Fuel, stays and other places from OpenStreetMap via Overpass. Weather from Open-Meteo. Satellite pictures from Esri.</p>' +
      '<p class="small warn">Road data can be out of date. Follow road signs and the law, and set your route before you ride.</p><button class="btn" id="sNews">' + ic('spark') + 'What\'s new</button><button class="btn ghost" id="sIntro">Show the quick guide</button>';
    const u = $('#sUpd', box); if (u) u.onclick = () => checkUpdate(true);
    $('#sIntro', box).onclick = intro;
    $('#sNews', box).onclick = () => OR.showNews && OR.showNews();
  }

  // ---------- ride ----------
  function startRide(route, resume) {
    closePopup(); closeSheet();
    if (route && OR.routes.list().every(r => r.id !== route.id)) OR.routes.save(route); // so it's there with no signal
    document.body.classList.add('riding'); $('#hud').hidden = false; $('#panel').classList.remove('open');
    $('#thenBox').hidden = true; countdown(null); $('#hudNote').hidden = true; $('#recentre').hidden = true; $('#limit').hidden = true;
    $('#turn').hidden = !route; $('#hRemainL').textContent = route ? 'to go' : 'ridden'; $('#hEtaL').textContent = route ? 'arrive' : 'riding for';
    OR.ride.fuel = route && OR.ride.fuel && OR.plan.route === route ? OR.ride.fuel : [];
    OR.startRide(route, resume);
    if (route && OR.online() && OR.fuelRange()) OR.fuelAlong(route).then(f => { OR.ride.fuel = f.list; }).catch(() => { });
    updateMute();
    if (OR.pos) OR.map.easeTo({ center: [OR.pos.lng, OR.pos.lat], zoom: 16, pitch: 55 });
  }
  OR.startRideUi = startRide;
  OR.endRideUi = () => { if (OR.ride.on) endRide(); };
  async function planAndRide() {
    OR.toast('Planning…');
    try { const o = await OR.planRoute(); if (OR.ride.on) OR.stopRide(); startRide(o[0]); }
    catch (e) { OR.toast('Could not plan: ' + e.message, 6000); }
  }
  function endRide() {
    const saved = OR.stopRide();
    document.body.classList.remove('riding'); $('#hud').hidden = true;
    if (saved) { OR.toast('Ride saved: ' + OR.fmtDist(saved.dist) + ' in ' + OR.fmtTime(saved.moving) + (OR.plan.route ? '. Route cleared from the map' : ''), 5000); renderRides(); }
    // the ride is over: clear its route off the map and out of Plan (it's kept in Saved routes, and in its trip)
    OR.plan.wps = []; showAllWps = false; OR.savePlan(); drawWaypoints();
    OR.plan.route = null; OR.plan.options = []; clearRouteExtras(); OR.setData('route', null); OR.setData('alts', null); OR.setData('trip', null); OR.setData('tripdays', null); OR.emit('planCleared');
    renderPlan();
  }
  function updateMute() { $('#hMute').innerHTML = ic(OR.cfg.voice ? 'vol' : 'mute'); $('#hMute').classList.toggle('off', !OR.cfg.voice); }
  // countdown bar: appears about 25 seconds before each turn (300-800 m, depending on your speed) and empties
  // as you get there. The scale is fixed once it appears, so the bar only ever goes down for that turn.
  const cd = { route: null, k: null, scale: 0, on: false };
  function countdown(s) {
    const bar = $('#cdBar'), fill = $('#cdFill'), r = OR.ride;
    if (!bar) return;
    if (!s || s.free || OR.cfg.turnBar === false || !r.on || r.off > 0 || r.rerouting || r.arrived) { bar.hidden = true; cd.on = false; cd.k = null; return; }
    if (cd.route !== r.route || cd.k !== s.k) { cd.route = r.route; cd.k = s.k; cd.on = false; }
    if (!cd.on) { const v = Math.max((OR.pos && OR.pos.speed) || 0, 9); cd.scale = Math.min(800, Math.max(300, v * 25)); }
    if (s.toTurn > cd.scale) { bar.hidden = true; cd.on = false; return; }
    const pct = Math.max(0, Math.min(1, s.toTurn / cd.scale)) * 100 + '%';
    if (!cd.on) { // first showing for this turn: jump straight to the level, then glide from there
      bar.classList.add('noanim'); bar.hidden = false; fill.style.height = pct; void fill.offsetHeight; bar.classList.remove('noanim');
      $('#cdIcon').innerHTML = OR.arrow(s.m.type); cd.on = true;
    } else fill.style.height = pct;
    fill.classList.toggle('near', s.toTurn < cd.scale * 0.25);
    $('#cdDist').textContent = OR.fmtDist(s.toTurn, true);
  }
  function refOf(street) { const m = String(street || '').match(/\b([A-Z]{1,3}\d{1,4}[A-Z]?)\b/); return m ? m[1] : ''; }
  function bindHud() {
    $('#hEnd').onclick = () => { if (confirm('End this ride?')) endRide(); };
    $('#hMic').innerHTML = ic('mic'); $('#hMic').onclick = () => OR.voiceListen();
    OR.on('voiceState', s => { $('#hMic').classList.toggle('on', s === 'listening' || s === 'thinking'); });
    OR.on('voiceToggled', updateMute);
    $('#hMute').onclick = () => { OR.cfg.voice = !OR.cfg.voice; OR.saveCfg(); if (!OR.cfg.voice) OR.hush(); updateMute(); OR.toast(OR.cfg.voice ? 'Voice on' : 'Voice off'); };
    $('#hMore').onclick = rideOptions;
    $('#recentre').onclick = () => { OR.ride.follow = true; $('#recentre').hidden = true; };
    OR.map.on('dragstart', () => { if (OR.ride.on) { OR.ride.follow = false; $('#recentre').hidden = false; } });
    OR.on('fix', p => {
      if (!OR.ride.on) return;
      const sp = OR.speed(p.speed) || 0; $('#hSpeed').textContent = sp; $('#hSpeedU').textContent = OR.speedUnit();
      const lim = OR.limitSign(OR.ride.limit);
      $('#limit').hidden = !lim; if (lim) $('#limit').textContent = lim;
      $('#hSpeed').parentNode.classList.toggle('over', !!lim && sp > lim + 2);
    });
    OR.on('ride', s => {
      countdown(s);
      if (s.free) { $('#hRemain').textContent = OR.fmtDist(OR.ride.dist); $('#hEta').textContent = OR.fmtTime((Date.now() - OR.ride.start) / 1000); return; }
      $('#turnIcon').innerHTML = OR.arrow(s.m.type);
      $('#turnDist').textContent = OR.fmtDist(s.toTurn, true);
      const ref = refOf(s.m.street), name = (s.m.street || s.m.text).replace(ref, '').replace(/^[\s/]+|[\s/]+$/g, '');
      $('#turnStreet').innerHTML = (ref ? chip(ref) : '') + '<span>' + esc(name || (ref ? '' : s.m.text)) + '</span>';
      const showThen = s.next && s.m.len < 300 && s.toTurn < 600;
      $('#thenBox').hidden = !showThen; if (showThen) $('#thenIcon').innerHTML = OR.arrow(s.next.type);
      $('#hRemain').textContent = OR.fmtDist(s.remain); $('#hEta').textContent = OR.clock(s.eta);
      // under the arrival time: how long is left
      const left = Math.max(0, (s.eta - Date.now()) / 1000); $('#hEtaL').textContent = left < 60 ? 'under 1 min' : OR.fmtTime(left) + ' left';
    });
    OR.on('rerouting', on => { if (on) countdown(null); $('#hudNote').hidden = !on; $('#hudNote').textContent = 'Finding a new route…'; });
    OR.on('breakDue', b => { const n = $('#hudNote'); n.hidden = false; n.textContent = b.line + (b.pick ? ' Tap to see stops.' : ''); n.onclick = b.pick ? () => { n.hidden = true; n.onclick = null; findNearby(b.pick.kind, [b.pick.lng, b.pick.lat]); } : null; });
    OR.on('overLimit', () => { const l = $('#limit'); if (l) { l.classList.add('over'); setTimeout(() => l.classList.remove('over'), 4000); } });
    OR.on('arrived', () => { countdown(null); $('#hudNote').hidden = false; $('#hudNote').textContent = 'You\'ve arrived. Tap End to save the ride.'; });
    OR.on('fuel', () => { const l = OR.fuelLeft(); if (OR.ride.on && l != null && l < (OR.cfg.bike.reserveMi || 25) * OR.MI) { $('#hudNote').hidden = false; $('#hudNote').textContent = 'Fuel low: about ' + OR.fmtDist(l) + ' left. Ride options has fuel nearby.'; } });
  }
  function rideOptions() {
    const r = OR.ride.route;
    const t = (id, i, c, l) => '<button class="tile" id="' + id + '">' + badge(i, c) + '<span>' + l + '</span></button>';
    const grp = (title, tiles) => tiles ? '<h3 class="grp">' + title + '</h3><div class="tiles">' + tiles + '</div>' : '';
    sheet('<h2>Ride options</h2>' +
      grp('This route', r ? t('roSkip', 'skip', '#ff6a1f', 'Skip next stop') + t('roView', 'map', '#1e88e5', 'Route overview') + t('roWx', 'cloud', '#039be5', 'Weather ahead') : '') +
      grp('Find nearby', t('roFuel', 'fuel', '#e53935', 'Fuel') + t('roCafe', 'cup', '#8d5a3b', 'Cafés') + t('roStay', 'bed', '#7e57c2', 'Stays') + t('roFill', 'fuel', '#0e9f57', 'I\'ve filled up')) +
      grp('Group', OR.group && OR.group.state.on ? t('roGroup', 'group', '#e53935', 'Group') + t('roChat', 'chat', '#0e9f57', 'Group chat') : '') +
      grp('Help and papers', t('roWhere', 'near', '#e53935', 'Where am I') + t('roIce', 'helmet', '#ef8f00', 'Emergency card') + t('roPapers', 'id', '#00897b', 'My papers') + t('roPhrase', 'chat', '#1e88e5', 'Phrasebook')) +
      grp('Bike', t('roSpeedo', 'lean', '#1565c0', 'Speedo check')) +
      (OR.ride.leanL || OR.ride.leanR ? '<p class="small muted">Lean so far: ' + Math.round(OR.ride.leanL) + '° left, ' + Math.round(OR.ride.leanR) + '° right (estimated).</p>' : ''), b => {
      const on = (id, fn) => { const e = $('#' + id, b); if (e) e.onclick = () => { closeSheet(); fn(); }; };
      const here = () => OR.pos ? [OR.pos.lng, OR.pos.lat] : OR.map.getCenter().toArray();
      on('roSkip', () => OR.skipNextStop());
      on('roView', () => { OR.ride.follow = false; $('#recentre').hidden = false; OR.map.fitBounds(OR.bbox(OR.ride.route.shape), { padding: 80, pitch: 0, bearing: 0 }); });
      on('roWx', () => OR.weatherAlong(OR.ride.route, new Date()).then(w => {
        const ahead = w.filter(x => x.along >= OR.ride.along - 100), warns = ahead.map(OR.weatherWarn).filter(Boolean);
        const n = ahead[0] ? ahead[0] : null;
        sheet('<h2>Weather ahead</h2><ol class="wxl">' + ahead.map(x => { const c = OR.wmo(x.code); return '<li><span class="t">' + OR.clock(new Date(x.at)) + '</span><span class="e">' + c[1] + '</span><span class="d">' + c[0] + '</span><b>' + Math.round(x.temp) + '°</b><span class="s">' + Math.round(x.rainP || 0) + '% rain</span></li>'; }).join('') + '</ol>');
        OR.say(warns.length ? 'Weather ahead: ' + Array.from(new Set(warns)).join('. ') : n ? 'Weather ahead: ' + OR.wmo(n.code)[0] + ', ' + Math.round(n.temp) + ' degrees' : '');
      }).catch(e => OR.toast('Weather unavailable: ' + e.message)));
      on('roFuel', () => findNearby('fuel', here())); on('roCafe', () => findNearby('cafe', here())); on('roStay', () => findNearby('stay', here()));
      on('roIce', () => sheet('<div class="ice"><pre>' + esc(OR.iceText()) + '</pre></div>'));
      on('roFill', () => OR.fillUpSheet());
      on('roPapers', () => OR.showPapers());
      on('roWhere', () => OR.whereAmI());
      on('roPhrase', () => OR.openMore('phrases'));
      on('roSpeedo', () => OR.speedoSheet());
      on('roGroup', () => OR.groupSheet());
      on('roChat', () => OR.openChat());
    });
  }

  // ---------- one look for every page ----------
  function groupRuns(root, test, cls) {
    const all = Array.from(root.querySelectorAll('*')).filter(test), done = new Set();
    all.forEach(el => {
      if (done.has(el) || !el.isConnected) return;
      const run = [el]; let n = el.nextElementSibling;
      while (n && (test(n) || (cls === 'fieldcard' && n.matches('p.small') && run.length))) { run.push(n); n = n.nextElementSibling; }
      while (run.length > 1 && run[run.length - 1].matches('p.small')) run.pop(); // a note after the last field stays below the card
      const w = document.createElement('div'); w.className = cls; el.before(w); run.forEach(x => { w.appendChild(x); done.add(x); });
    });
  }
  const NOCARD = '.card,.optcard,.fieldcard,.li,.brief,.dday,.svc,.tyre,.bikecard,.bikephoto,.hzgrid,.ice,.quick,#crashBox,.joinrow,.row';
  OR.cardify = function (root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('h3:not(.grp):not(.gh)').forEach(h => { if (!h.closest(NOCARD + ',.passes,.hills,.golden,.besttime')) h.classList.add('grp'); });
    root.querySelectorAll('label.chk').forEach(l => {
      if (l.closest('.optcard')) return;
      const inp = l.querySelector('input[type=checkbox]'); if (!inp) return;
      const row = document.createElement('label'); row.className = 'opt-row';
      const sp = document.createElement('span'), b = document.createElement('b');
      inp.remove(); b.innerHTML = l.innerHTML.trim(); sp.appendChild(b);
      const nx = l.nextElementSibling;
      if (nx && nx.tagName === 'P' && nx.classList.contains('small')) { const sm = document.createElement('small'); sm.innerHTML = nx.innerHTML; sp.appendChild(sm); nx.remove(); }
      inp.classList.add('switch'); row.appendChild(sp); row.appendChild(inp);
      l.replaceWith(row);
    });
    groupRuns(root, el => el.classList.contains('opt-row') && !el.parentElement.closest('.optcard'), 'optcard');
    groupRuns(root, el => el.matches('label.f, div.two') && !el.parentElement.closest(NOCARD + ',.two,.fieldcard'), 'fieldcard');
  };
  let carding = false;
  const cardObs = new MutationObserver(list => {
    if (carding) return; carding = true;
    try {
      const roots = new Set();
      for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.matches('h3,label.chk,label.f,div.two') || n.querySelector('h3,label.chk,label.f,div.two'))) roots.add(n.parentElement || n);
      roots.forEach(r => OR.cardify(r));
    } finally { carding = false; }
  });
  setTimeout(() => { ['#views', '#sheetBox'].forEach(sel => { const el = $(sel); if (el) { OR.cardify(el); cardObs.observe(el, { childList: true, subtree: true }); } }); }, 0);

  // ---------- pop-up sheet ----------
  function sheet(html, bind) {
    const s = $('#sheet'), b = $('#sheetBox');
    b.innerHTML = '<button class="sheetX" aria-label="Close">' + ic('x') + '</button>' + html; s.hidden = false; b.scrollTop = 0;
    $('.sheetX', b).onclick = closeSheet; s.onclick = e => { if (e.target === s) closeSheet(); };
    if (bind) bind(b);
  }
  function closeSheet() { $('#sheet').hidden = true; }
  OR.sheet = sheet; OR.closeSheet = closeSheet;

  function intro() {
    OR.store.set('seenIntro', true);
    sheet('<div class="intro"><div class="sign">' + ic('moto') + 'OpenRoad</div><p class="muted">Made for riding: twisty roads, tours across the Channel and your bike\'s fuel range.</p><ol>' +
      '<li><b>Plan</b> from A to B, or make a round trip of the length you want. Choose twisty, extra twisty, no motorways or fastest.</li>' +
      '<li><b>Trips</b> plan a tour day by day: rides, ferries, fuel, hotels and what it all costs.</li>' +
      '<li><b>Ride</b> with big turn arrows, spoken directions through your headset, speed limits and new routes when you go off course.</li>' +
      '<li><b>Rides</b> keeps every ride with distance, speeds and lean angle.</li>' +
      '<li><b>More</b> has your bike and fuel range, safety check-in, emergency card and offline country maps.</li></ol>' +
      '<button class="btn wide go" id="introOk">Let\'s ride</button></div>', b => $('#introOk', b).onclick = closeSheet);
  }

  // scripts load deferred: start once they all have
  if (document.readyState === 'complete') boot(); else document.addEventListener('DOMContentLoaded', boot);
})(window.OR);
