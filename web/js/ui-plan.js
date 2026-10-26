/* Screens for the planning extras: hills and low-emission zones on the route card, the rain radar on the map,
   and finding great roads near you. */
'use strict';
(function (OR) {
  const $ = OR.$, $$ = OR.$$, esc = OR.esc, ic = (n, c) => OR.ic(n, c);
  const cache = {};
  let cur = null, html = '';
  const sig = r => r.shape.length + ':' + r.shape[0].join() + ':' + r.shape[r.shape.length - 1].join() + ':' + Math.round(r.dist);

  OR.planExtrasHtml = () => '<div id="planExtras">' + html + '</div>';
  function paint() { const el = $('#planExtras'); if (el) el.innerHTML = html; bind(); }
  function render(r, c) {
    let h = '';
    if (c.zones && c.zones.length) {
      const avoidable = c.zones.filter(z => !z.startsIn && !z.endsIn);
      h += '<div class="card warnc lez"><b>' + ic('shield') + 'Low-emission zone' + (c.zones.length > 1 ? 's' : '') + ' on this route</b><ul>' +
        c.zones.map(z => '<li><b>' + esc(z.name) + '</b>: about ' + OR.fmtDist(z.km * 1000) + ' inside' + (z.endsIn ? ' (your destination is inside it)' : z.startsIn ? ' (you start inside it)' : '') + (OR.zoneNote(z) ? '. ' + esc(OR.zoneNote(z)) : '') + '</li>').join('') + '</ul>' +
        '<p class="small">Some zones need a sticker or registration for motorbikes too (France\'s Crit\'Air zones, for example). Check before you go: <a href="' + OR.zoneInfoUrl + '" target="_blank" rel="noopener">urbanaccessregulations.eu</a> lists the rules for each city.</p>' +
        (avoidable.length ? '<button class="btn small" id="lezAvoid">Avoid ' + (avoidable.length > 1 ? 'them' : 'it') + '</button>' : '') + '</div>';
    } else if (c.zones) h += OR.plan.avoidZones && OR.plan.avoidZones.length ? '' : '';
    if (OR.plan.avoidZones && OR.plan.avoidZones.length) h += '<div class="card okc"><b>Avoiding low-emission zones</b><p class="small">Routes go round ' + OR.plan.avoidZones.length + ' zone' + (OR.plan.avoidZones.length > 1 ? 's' : '') + '.</p><button class="btn small ghost" id="lezUndo">Stop avoiding</button></div>';
    if (c.elev) {
      const e = c.elev;
      h += '<div class="hills"><div class="hl-h"><b>' + ic('pass') + 'Hills</b><span>↑ ' + OR.fmtHeight(e.up) + ' · ↓ ' + OR.fmtHeight(e.down) + ' · highest ' + OR.fmtHeight(e.max) + (e.steep >= 6 ? ' · steepest about ' + Math.round(e.steep) + '%' : '') + '</span></div>' + OR.profileSvg(e) + '</div>';
    } else if (c.elevErr) h += '<p class="small muted">Hill profile unavailable: ' + esc(c.elevErr) + '</p>';
    else if (c.loading) h += '<p class="small muted">Checking hills and low-emission zones…</p>';
    return h;
  }
  function bind() {
    const a = $('#lezAvoid'); if (a) a.onclick = () => {
      const c = cache[sig(cur)]; if (!c) return;
      OR.plan.avoidZones = (OR.plan.avoidZones || []).concat(...c.zones.filter(z => !z.startsIn && !z.endsIn).map(z => z.outline));
      OR.toast('Planning round the zone' + (c.zones.length > 1 ? 's' : '') + '…'); OR.planChanged(true);
    };
    const u = $('#lezUndo'); if (u) u.onclick = () => { OR.plan.avoidZones = []; OR.planChanged(true); };
  }
  OR.on('routeShown', async r => {
    cur = r; const k = sig(r);
    let c = cache[k];
    if (!c) {
      c = cache[k] = { loading: true };
      html = render(r, c); paint();
      const [z, e] = await Promise.all([OR.zonesAlong(r).catch(() => null), OR.elevationAlong(r).catch(err => { c.elevErr = err.message; return null; })]);
      c.zones = z; c.elev = e; c.loading = false; r.zones = z; r.elev = e;
    }
    if (cur !== r) return;
    html = render(r, c); paint();
  });

  // ---------- rain radar ----------
  function radarChip(f) {
    let el = $('#radarChip');
    if (!f) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div'); el.id = 'radarChip';
      el.innerHTML = '<span></span><button id="rdPlay" aria-label="Play the last 2 hours">▶</button><button id="rdOff" aria-label="Turn radar off">' + ic('x') + '</button>';
      document.body.appendChild(el);
      $('#rdPlay', el).onclick = () => OR.radar.play();
      $('#rdOff', el).onclick = () => OR.radar.hide();
    }
    const last = OR.radar.at === OR.radar.frames.length - 1;
    $('span', el).textContent = 'Rain ' + OR.clock(new Date(f.time)) + (last ? ' (latest)' : '');
  }
  OR.on('radar', radarChip);
  OR.toggleRadar = async function () {
    if (OR.radar.on()) return OR.radar.hide();
    try { await OR.radar.load(); OR.radar.show(); if (OR.map.getZoom() > 9) OR.toast('Radar is coarse up close: zoom out to see showers coming', 5000); }
    catch (e) { OR.toast('Radar unavailable: ' + e.message, 6000); }
  };
  // every 10 minutes while it's on, get the newest picture
  setInterval(() => { if (OR.radar.on() && !document.hidden) OR.radar.load().then(() => OR.radar.show()).catch(() => { }); }, 600000);

  // ---------- great roads near you ----------
  OR.findGreatRoads = function () {
    const m = OR.map;
    const go = async () => {
      const roads = await OR.nameRoads(OR.greatRoads());
      OR.setData('great', { type: 'FeatureCollection', features: roads.map((g, i) => ({ type: 'Feature', properties: { i, name: g.name }, geometry: { type: 'MultiLineString', coordinates: g.lines } })) });
      OR.lastGreat = roads;
      if (!roads.length) return OR.toast('No really bendy roads in view. Try somewhere hillier, or zoom out a little.', 6000);
      OR.sheet('<h2>' + ic('twisty') + 'Bendiest roads in view</h2><p class="small muted">From the map\'s road data, counting how much each road turns per mile. Highlighted on the map in purple.</p><div class="list">' +
        roads.map((g, i) => '<div class="li great"><b>' + esc(g.ref ? g.ref + (g.name ? ' · ' + g.name : '') : g.name) + '</b><span>' + OR.bendLabel(g.twist) + ' · ' + OR.fmtDist(g.len) + ' of it here</span>' +
          '<div class="row"><button class="btn small" data-gshow="' + i + '">Show</button><button class="btn small pri" data-gride="' + i + '">Ride it</button></div></div>').join('') + '</div>', b => {
        $$('[data-gshow]', b).forEach(x => x.onclick = () => { const g = roads[+x.dataset.gshow]; OR.closeSheet(); m.fitBounds(OR.bbox([].concat(...g.lines)), { padding: 60 }); if (innerWidth < 900) $('#panel').classList.remove('open'); });
        $$('[data-gride]', b).forEach(x => x.onclick = () => rideRoad(roads[+x.dataset.gride]));
      });
    };
    if (m.getZoom() < 11 || m.getZoom() > 12.5) { OR.toast('Looking around here…'); m.easeTo({ zoom: 11.5, center: OR.pos ? [OR.pos.lng, OR.pos.lat] : m.getCenter() }); m.once('idle', go); }
    else go();
  };
  // a route from where you are, along the road's longest stretch in view (both ends as stops)
  function rideRoad(g) {
    OR.closeSheet();
    const line = g.lines.slice().sort((a, b) => b.length - a.length)[0];
    let a = line[0], z = line[line.length - 1];
    if (OR.pos && OR.dist([OR.pos.lng, OR.pos.lat], z) < OR.dist([OR.pos.lng, OR.pos.lat], a)) [a, z] = [z, a];
    const name = g.name;
    if (!OR.pos) return OR.toast('Waiting for your position');
    OR.plan.wps.length = 0;
    OR.plan.wps.push({ lng: OR.pos.lng, lat: OR.pos.lat, name: 'My position', type: 'break' }, { lng: a[0], lat: a[1], name: name + ' (start)', type: 'through' }, { lng: z[0], lat: z[1], name: name + ' (end)', type: 'break' });
    OR.setPlanMode && OR.setPlanMode('ab'); OR.planChanged(true); OR.tab('plan');
  }
})(window.OR);
