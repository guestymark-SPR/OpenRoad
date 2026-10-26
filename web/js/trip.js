/* OpenRoad trip tools: fuel range and stops, places to stay and eat, ICE card, safety check-in. */
'use strict';
(function (OR) {
  const A = OR.native;
  const OVERPASS = 'https://overpass-api.de/api/interpreter';

  function overpass(q) {
    return OR.json(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q), type: 'application/x-www-form-urlencoded', timeout: 90000 })
      .then(j => (j.elements || []).map(e => {
        const t = e.tags || {}, lat = e.lat != null ? e.lat : e.center && e.center.lat, lng = e.lon != null ? e.lon : e.center && e.center.lon;
        return { id: e.type + e.id, lat, lng, tags: t, name: t.name || t.brand || t.operator || '' };
      }).filter(p => p.lat != null));
  }

  // ---------- fuel ----------
  OR.fuelRange = function () { // full-tank range in metres, or null if the bike isn't set up
    const b = OR.cfg.bike, L = parseFloat(b.tankL), mpg = parseFloat(b.mpg);
    if (!(L > 0 && mpg > 0)) return null;
    return L / 4.54609 * mpg * OR.MI;
  };
  OR.fuelLeft = function () { const r = OR.fuelRange(); if (r == null) return null; return Math.max(0, r - (OR.cfg.fuelSince || 0) - (OR.ride.on ? OR.ride.dist : 0)); };
  OR.filledUp = function () { OR.cfg.fuelSince = OR.ride.on ? -OR.ride.dist : 0; OR.saveCfg(); OR.fuelWarned = false; OR.toast('Tank marked full'); OR.emit('fuel'); };

  // Fuel stations within about a mile of the route, in order along it, plus the long gaps between them.
  OR.fuelAlong = async function (route) {
    const sample = OR.resample(route.shape, 2500);
    const coords = sample.map(p => p[1].toFixed(5) + ',' + p[0].toFixed(5)).join(',');
    const list = await overpass('[out:json][timeout:80];nwr["amenity"="fuel"](around:1500,' + coords + ');out center tags;');
    for (const f of list) {
      // where along the route the station is
      let best = { d: 1e12, i: 0, t: 0 };
      for (let i = 0; i < route.shape.length - 1; i += 1) { const r = OR.projSeg([f.lng, f.lat], route.shape[i], route.shape[i + 1]); if (r.d < best.d) best = { d: r.d, i, t: r.t }; }
      f.at = route.cum[best.i] + best.t * (route.cum[best.i + 1] - route.cum[best.i]); f.off = best.d; f.kind = 'fuel';
      f.name = f.name || 'Fuel';
    }
    list.sort((a, b) => a.at - b.at);
    const range = OR.fuelRange(), reserve = (parseFloat(OR.cfg.bike.reserveMi) || 25) * OR.MI;
    const gaps = [];
    if (range) {
      const safe = range - reserve;
      const stops = [{ at: 0, start: true }].concat(list, [{ at: route.dist, end: true }]);
      const left = OR.fuelLeft();
      for (let i = 1; i < stops.length; i++) {
        const g = stops[i].at - stops[i - 1].at;
        const limit = i === 1 && left != null ? left - reserve : safe;
        if (g > limit) gaps.push({ from: stops[i - 1].at, to: stops[i].at, len: g, first: i === 1 });
      }
    }
    return { list, gaps, range };
  };
  OR.gapGeo = function (route, gaps) {
    return { type: 'FeatureCollection', features: gaps.map(g => {
      const pts = []; for (let i = 0; i < route.shape.length; i++) if (route.cum[i] >= g.from && route.cum[i] <= g.to) pts.push(route.shape[i]);
      return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts.length > 1 ? pts : [route.shape[0], route.shape[0]] } };
    }) };
  };

  // ---------- nearby places ----------
  const KINDS = {
    fuel: { label: 'Fuel', q: '["amenity"="fuel"]' },
    stay: { label: 'Places to stay', q: '["tourism"~"^(hotel|guest_house|motel|hostel|apartment|chalet)$"]' },
    camp: { label: 'Campsites', q: '["tourism"="camp_site"]' },
    cafe: { label: 'Cafés', q: '["amenity"="cafe"]' },
    pub: { label: 'Pubs', q: '["amenity"="pub"]' }
  };
  OR.KINDS = KINDS;
  OR.nearby = async function (kind, lng, lat, radiusM) {
    const k = KINDS[kind];
    const list = await overpass('[out:json][timeout:60];nwr' + k.q + '(around:' + (radiusM || 8000) + ',' + lat.toFixed(5) + ',' + lng.toFixed(5) + ');out center tags 80;');
    list.forEach(p => { p.kind = kind === 'camp' ? 'camp' : kind; p.d = OR.dist([lng, lat], [p.lng, p.lat]); p.name = p.name || k.label.replace(/s$/, ''); });
    return list.sort((a, b) => a.d - b.d);
  };
  OR.poiGeo = list => ({ type: 'FeatureCollection', features: list.map(p => ({ type: 'Feature', properties: { id: p.id, name: p.name, kind: p.kind }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })) });
  OR.poiDetails = function (p) {
    const t = p.tags || {};
    const type = { hotel: 'Hotel', guest_house: t.guest_house === 'bed_and_breakfast' ? 'B&B' : 'Guest house', motel: 'Motel', hostel: 'Hostel', apartment: 'Apartment', chalet: 'Chalet', camp_site: 'Campsite' }[t.tourism]
      || (t.amenity === 'fuel' ? 'Fuel' + (t.brand ? ' · ' + t.brand : '') : t.amenity === 'cafe' ? 'Café' : t.amenity === 'pub' ? 'Pub' : '');
    const addr = [t['addr:housenumber'], t['addr:street'], t['addr:city'] || t['addr:town'] || t['addr:village'], t['addr:postcode']].filter(Boolean).join(', ');
    return { type, addr, phone: t.phone || t['contact:phone'] || '', web: t.website || t['contact:website'] || '', hours: t.opening_hours || '', stars: t.stars || '', fuel24: t.opening_hours === '24/7' };
  };

  // ---------- ICE card ----------
  OR.iceText = function () {
    const i = OR.cfg.ice;
    return ['IN CASE OF EMERGENCY', i.name && 'Rider: ' + i.name, i.blood && 'Blood group: ' + i.blood, i.medical && 'Medical: ' + i.medical,
      i.contactName && 'Contact: ' + i.contactName + (i.contactPhone ? ' ' + i.contactPhone : ''), i.reg && 'Bike: ' + i.reg].filter(Boolean).join('\n');
  };

  // ---------- safety check-in ----------
  // If you don't tap "I'm OK" by the time set, the app alerts you; if there is still no answer it texts your contact your last position.
  OR.checkin = {
    armAt(at) {
      const c = OR.cfg.checkin;
      if (!c.phone) { OR.toast('Add a contact number in Trip › Check-in first'); return false; }
      OR.cfg.checkinAt = at; OR.saveCfg();
      if (A && A.checkInArm) A.checkInArm(String(at), c.phone, c.name || '', String(c.grace || 10), OR.cfg.ice.name || 'the rider');
      OR.emit('checkin'); return true;
    },
    ok() {
      const c = OR.cfg.checkin;
      if (c.every > 0 && OR.cfg.checkinAt) return OR.checkin.armAt(Date.now() + c.every * 3600000) && OR.toast('Checked in. Next check-in ' + OR.clock(new Date(OR.cfg.checkinAt)));
      OR.checkin.cancel(); OR.toast('Checked in');
    },
    cancel() { OR.cfg.checkinAt = 0; OR.saveCfg(); if (A && A.checkInCancel) A.checkInCancel(); OR.emit('checkin'); },
    message() {
      const p = OR.pos, who = OR.cfg.ice.name || 'I';
      return 'OpenRoad safety check-in: ' + who + (who === 'I' ? ' have' : ' has') + ' not checked in as planned while out on the motorbike.' +
        (p ? ' Last known position (' + new Date(p.t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + '): https://maps.google.com/?q=' + p.lat.toFixed(5) + ',' + p.lng.toFixed(5) : ' No GPS position was available.');
    }
  };
  // browser fallback (the Android app does this natively, even with the screen off)
  setInterval(() => {
    const at = OR.cfg.checkinAt; if (!at || A) return;
    const now = Date.now(), grace = (OR.cfg.checkin.grace || 10) * 60000;
    if (now > at && !OR.checkinAlerting) { OR.checkinAlerting = true; OR.emit('checkinDue'); OR.say('Safety check-in. Tap I am OK.'); }
    if (now > at + grace && !OR.checkinSent) {
      OR.checkinSent = true;
      location.href = 'sms:' + OR.cfg.checkin.phone + '?&body=' + encodeURIComponent(OR.checkin.message());
    }
  }, 15000);
  // the app passes the last fix to its check-in service so the text has your position
  OR.on('fix', p => { if (A && A.checkInPos && OR.cfg.checkinAt) A.checkInPos(p.lat, p.lng, p.t); });
  window.onCheckInDue = () => OR.emit('checkinDue');
  // the app's check-in runs natively (it may have been answered from the notification): keep the screen in step
  function syncCheckin() {
    if (!A || !A.checkInAt) return;
    const at = +A.checkInAt() || 0;
    if (at !== (OR.cfg.checkinAt || 0)) { OR.cfg.checkinAt = at; OR.saveCfg(); OR.emit('checkin'); }
    if (at && Date.now() > at) OR.emit('checkinDue');
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncCheckin(); });
  setTimeout(syncCheckin, 1500);
  window.onCheckInSent = (ok) => OR.toast(ok ? 'Check-in missed: your contact has been sent your position' : 'Check-in missed: the message app has been opened', 10000);

  // ---------- fuel warnings while riding ----------
  OR.on('distance', () => {
    const left = OR.fuelLeft(), reserve = (parseFloat(OR.cfg.bike.reserveMi) || 25) * OR.MI;
    if (left == null || OR.fuelWarned || left > reserve) return;
    OR.fuelWarned = true;
    let msg = 'Fuel getting low. About ' + OR.spokenDist(left) + ' left.';
    const st = (OR.ride.fuel || []).find(f => f.at > OR.ride.along + 100);
    if (st && OR.ride.route) msg += ' Next fuel on your route in ' + OR.spokenDist(st.at - OR.ride.along) + (st.name && st.name !== 'Fuel' ? ', ' + st.name : '') + '.';
    OR.say(msg); OR.emit('fuel');
  });
})(window.OR);
