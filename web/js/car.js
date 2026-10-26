/* OpenRoad on the car screen (Android Auto). The map and navigation run here, the same code as the phone;
   the Android side shows the turn card and buttons from what carUpdate() sends it. */
'use strict';
(function (OR) {
  const A = OR.native, $ = OR.$;
  const send = o => { if (A && A.carUpdate) A.carUpdate(JSON.stringify(o)); };
  let insets = { left: 0, top: 0, right: 0, bottom: 0 };

  function init() {
    OR.initMap();
    OR.map.setPitch(0);
    OR.startGps();
    OR.groupBoot(); // riders in your group show on the car map too
    send({ state: 'ready' });
  }
  // the area of the car screen not covered by Android Auto's cards (in CSS pixels)
  window.carInsets = function (l, t, r, b) {
    insets = { left: l, top: t, right: r, bottom: b };
    const h = $('#hud'); h.style.right = (r + 16) + 'px'; h.style.bottom = (b + 16) + 'px';
    if (OR.map) OR.map.setPadding(insets);
  };
  window.carTheme = function (m) { OR.cfg.theme = m; OR.applyTheme(); };
  window.carMute = function (mute) { OR.cfg.voice = !mute; OR.saveCfg(); if (mute) OR.hush(); };

  function routeFor(kind, a, b, c) {
    if (kind === 'route') return OR.routes.get(a);
    if (kind === 'trip') {
      const t = OR.trips.get(a); if (!t) return null;
      const s = t.days[b] && t.days[b].steps[c]; if (!s || !s.route) return null;
      const r = OR.unpackRoute(s.route); r.wps = s.wps; r.name = OR.dayLabel(t, b) + ': ' + (s.wps[0].name + ' to ' + s.wps[s.wps.length - 1].name);
      return r;
    }
    return null;
  }
  window.carStart = function (kind, a, b, c) {
    const r = kind === 'free' ? null : routeFor(kind, a, +b, +c);
    if (kind !== 'free' && !r) { send({ state: 'error', text: 'That route could not be found on the phone' }); return; }
    if (OR.ride.on) OR.stopRide();
    OR.startRide(r);
    if (r) OR.map.fitBounds(OR.bbox(r.shape), { padding: 40, duration: 0 });
    send(r ? { state: 'loading', name: r.name, dest: r.wps[r.wps.length - 1].name } : { state: 'free' });
  };
  window.carStop = function () {
    const saved = OR.stopRide();
    send({ state: 'stopped', saved: saved ? OR.fmtDist(saved.dist) + ' in ' + OR.fmtTime(saved.moving) : '' });
  };

  OR.on('ride', s => {
    if (s.free) { send({ state: 'free', dist: OR.ride.dist, elapsed: (Date.now() - OR.ride.start) / 1000, units: OR.cfg.units }); return; }
    const r = OR.ride.route, pos = OR.pos;
    send({ state: OR.ride.rerouting ? 'rerouting' : OR.ride.arrived ? 'arrived' : 'nav', units: OR.cfg.units,
      type: s.m.type, exit: s.m.exit || 0, street: s.m.street || '', text: s.m.text, toTurn: s.toTurn,
      next: s.next && s.m.len < 400 ? { type: s.next.type, exit: s.next.exit || 0, text: s.next.text, street: s.next.street || '' } : null,
      remain: s.remain, etaMs: s.eta.getTime(), name: r.name, dest: r.wps[r.wps.length - 1].name,
      left: !!(pos && OR.inUK(pos.lng, pos.lat)) || !!(pos && pos.lat > 51.4 && pos.lat < 55.4 && pos.lng < -5.4 && pos.lng > -10.6) });
  });
  OR.on('rerouting', on => { if (on) send({ state: 'rerouting' }); });
  OR.on('arrived', () => send({ state: 'arrived' }));

  // speed and the speed limit, in the corner of the map
  let lastIdle = 0;
  OR.on('fix', p => {
    const sp = OR.speed(p.speed) || 0; $('#spdN').textContent = sp; $('#spdU').textContent = OR.speedUnit();
    const lim = OR.ride.on ? OR.limitSign(OR.ride.limit) : null;
    $('#lim').hidden = !lim; if (lim) $('#lim').textContent = lim;
    $('#spd').classList.toggle('over', !!lim && sp > lim + 2);
    if (!OR.ride.on && Date.now() - lastIdle > 2000) { lastIdle = Date.now(); OR.map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(OR.map.getZoom(), 14), duration: 800 }); }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window.OR);
