/* OpenRoad trip planner: multi-day trips with rides, ferry and tunnel crossings, hotels and costs. */
'use strict';
(function (OR) {
  // Common crossings from Britain to the continent. Times are typical crossing times only: check the operator's timetable.
  OR.CROSSINGS = [
    { id: 'dover-calais', label: 'Dover to Calais', ops: 'DFDS, P&O, Irish Ferries', hours: 1.5, from: ['Dover', 1.331, 51.127], to: ['Calais', 1.862, 50.966] },
    { id: 'dover-dunkirk', label: 'Dover to Dunkirk', ops: 'DFDS', hours: 2, from: ['Dover', 1.331, 51.127], to: ['Dunkirk', 2.205, 51.017] },
    { id: 'tunnel', label: 'Eurotunnel Folkestone to Calais', ops: 'LeShuttle', hours: 0.6, from: ['Folkestone terminal', 1.137, 51.095], to: ['Calais Coquelles terminal', 1.812, 50.935] },
    { id: 'newhaven-dieppe', label: 'Newhaven to Dieppe', ops: 'DFDS', hours: 4, from: ['Newhaven', 0.057, 50.789], to: ['Dieppe', 1.087, 49.930] },
    { id: 'portsmouth-caen', label: 'Portsmouth to Caen (Ouistreham)', ops: 'Brittany Ferries', hours: 6, from: ['Portsmouth', -1.088, 50.812], to: ['Ouistreham', -0.247, 49.283] },
    { id: 'portsmouth-lehavre', label: 'Portsmouth to Le Havre', ops: 'Brittany Ferries', hours: 5.5, from: ['Portsmouth', -1.088, 50.812], to: ['Le Havre', 0.120, 49.483] },
    { id: 'portsmouth-stmalo', label: 'Portsmouth to St Malo', ops: 'Brittany Ferries (overnight)', hours: 11, from: ['Portsmouth', -1.088, 50.812], to: ['St Malo', -2.022, 48.641] },
    { id: 'poole-cherbourg', label: 'Poole to Cherbourg', ops: 'Brittany Ferries', hours: 4.5, from: ['Poole', -1.985, 50.709], to: ['Cherbourg', -1.618, 49.646] },
    { id: 'plymouth-roscoff', label: 'Plymouth to Roscoff', ops: 'Brittany Ferries', hours: 6, from: ['Plymouth', -4.157, 50.364], to: ['Roscoff', -3.966, 48.718] },
    { id: 'harwich-hook', label: 'Harwich to Hook of Holland', ops: 'Stena Line', hours: 7, from: ['Harwich', 1.256, 51.947], to: ['Hook of Holland', 4.133, 51.977] },
    { id: 'hull-rotterdam', label: 'Hull to Rotterdam (Europoort)', ops: 'P&O (overnight)', hours: 11.5, from: ['Hull', -0.284, 53.744], to: ['Rotterdam Europoort', 4.135, 51.954] },
    { id: 'newcastle-amsterdam', label: 'Newcastle to Amsterdam (IJmuiden)', ops: 'DFDS (overnight)', hours: 15.5, from: ['Newcastle (North Shields)', -1.468, 54.998], to: ['IJmuiden', 4.594, 52.464] }
  ];
  OR.CROSSINGS.forEach(c => { // the same crossings the other way
    if (c.back) return;
    OR.CROSSINGS.push({ id: c.id + '-back', back: true, label: c.to[0] + ' to ' + c.from[0], ops: c.ops, hours: c.hours, from: c.to, to: c.from });
  });

  // roughly: Great Britain and Northern Ireland, not France or the Republic of Ireland (used to pick £ or € for fuel)
  const uk = (lng, lat) => lat > 49.85 && lat < 61 && lng > -8.7 && lng < 1.8 && !(lat < 51.2 && lng > 1.45)
    && !(lng < -5.4 && (lat < 54.05 || (lng < -7.3 && lat > 54.6)));
  OR.inUK = uk;

  const blankDay = () => ({ id: OR.uid(), title: '', startTime: '09:00', steps: [], hotel: null, costs: [], notes: '' });
  OR.trips = {
    list: () => OR.store.get('trips', []),
    get: id => OR.trips.list().find(t => t.id === id) || null,
    save(t) { t.updated = Date.now(); const l = OR.trips.list().filter(x => x.id !== t.id); l.unshift(t); OR.store.set('trips', l); },
    del(id) { OR.store.set('trips', OR.trips.list().filter(t => t.id !== id)); },
    create(o) {
      const t = Object.assign({ id: OR.uid(), name: 'My trip', start: new Date().toISOString().slice(0, 10), riders: 1, fuelGBP: '', fuelEUR: '', eurRate: '', days: [blankDay()] }, o || {});
      OR.trips.save(t); return t;
    },
    blankDay
  };

  OR.dayDate = (trip, i) => { const d = new Date(trip.start + 'T12:00:00'); d.setDate(d.getDate() + i); return d; };
  OR.dayLabel = (trip, i) => 'Day ' + (i + 1) + ', ' + OR.dayDate(trip, i).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  OR.isoDate = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

  // routes are kept compact inside the trip
  OR.packRoute = r => r ? Object.assign({}, r, { shape: OR.encodePoly(r.shape, 6), cum: undefined, limits: undefined }) : null;
  OR.unpackRoute = r => { if (!r) return null; const o = Object.assign({}, r, { shape: typeof r.shape === 'string' ? OR.decodePoly(r.shape, 6) : r.shape }); o.cum = OR.cumulative(o.shape); return o; };

  // where a day finishes (for hotels and weather) and where the next ride should start
  OR.dayEnd = function (day) {
    for (let i = day.steps.length - 1; i >= 0; i--) {
      const s = day.steps[i];
      if (s.kind === 'ferry') return { name: s.to.name, lng: s.to.lng, lat: s.to.lat };
      if (s.wps && s.wps.length) { const w = s.wps[s.wps.length - 1]; return { name: w.name, lng: w.lng, lat: w.lat }; }
    }
    return null;
  };
  OR.tripPrevEnd = function (trip, di, si) {
    const day = trip.days[di];
    for (let i = si - 1; i >= 0; i--) { const s = day.steps[i]; if (s.kind === 'ferry') return s.to; if (s.wps && s.wps.length) return s.wps[s.wps.length - 1]; }
    for (let d = di - 1; d >= 0; d--) { const h = trip.days[d].hotel; if (h && h.lng != null) return { name: h.name, lng: h.lng, lat: h.lat }; const e = OR.dayEnd(trip.days[d]); if (e) return e; }
    return null;
  };

  // ---------- costs ----------
  const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  function add(m, cur, v) { if (!v) return; m[cur] = (m[cur] || 0) + v; }
  OR.tripCalc = function (trip) {
    const mpg = num(OR.cfg.bike.mpg), days = [];
    const tot = { dist: 0, time: 0, litres: 0, fuel: {}, ferry: {}, hotel: {}, other: {}, all: {}, missingFuel: false, unplanned: 0 };
    trip.days.forEach((day, di) => {
      const d = { dist: 0, time: 0, litres: 0, fuel: {}, ferry: {}, hotel: {}, other: {}, all: {}, timeline: [] };
      let clock = toMin(day.startTime || '09:00');
      day.steps.forEach(s => {
        if (s.kind === 'ride') {
          if (!s.route) { tot.unplanned++; d.timeline.push({ s, at: clock, none: true }); return; }
          const r = s.route; d.dist += r.dist; d.time += r.time;
          d.timeline.push({ s, at: clock, until: clock + r.time / 60 }); clock += r.time / 60;
          const mid = typeof r.shape === 'string' ? OR.decodePoly(r.shape, 6) : r.shape, p = mid[Math.floor(mid.length / 2)];
          const cur = s.fuelCur || (p && uk(p[0], p[1]) ? 'GBP' : 'EUR');
          if (mpg > 0) {
            const L = r.dist / OR.MI / mpg * 4.54609; d.litres += L;
            const price = num(cur === 'GBP' ? trip.fuelGBP : trip.fuelEUR);
            if (price) add(d.fuel, cur, L * price); else tot.missingFuel = true;
          } else tot.missingFuel = true;
        } else if (s.kind === 'ferry') {
          const dep = s.depart ? toMin(s.depart) : clock;
          d.timeline.push({ s, at: Math.max(dep, clock), until: Math.max(dep, clock) + num(s.hours) * 60 });
          clock = Math.max(dep, clock) + num(s.hours) * 60;
          add(d.ferry, s.cur || 'GBP', num(s.cost));
        }
      });
      if (day.hotel) add(d.hotel, day.hotel.cur || 'GBP', num(day.hotel.cost));
      (day.costs || []).forEach(c => add(d.other, c.cur || 'GBP', num(c.amount)));
      for (const k of ['fuel', 'ferry', 'hotel', 'other']) for (const c in d[k]) { add(d.all, c, d[k][c]); add(tot[k], c, d[k][c]); add(tot.all, c, d[k][c]); }
      d.arrive = clock;
      tot.dist += d.dist; tot.time += d.time; tot.litres += d.litres;
      days.push(d);
    });
    return { days, tot };
  };
  function toMin(hhmm) { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); }
  OR.minToClock = m => { m = Math.round(m); const d = Math.floor(m / 1440); m = m % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0') + (d ? ' (+' + d + ' day' + (d > 1 ? 's' : '') + ')' : ''); };
  const SYM = { GBP: '£', EUR: '€' };
  // "£120 + €85", or one figure in pounds when the trip has a euro rate set
  OR.money = function (m, trip, opts) {
    const rate = num(trip && trip.eurRate);
    const g = m.GBP || 0, e = m.EUR || 0;
    if (!g && !e) return opts && opts.zero === false ? '' : '£0';
    if (rate && e) return '£' + fmt(g + e * rate) + (opts && opts.detail && e ? ' (incl. €' + fmt(e) + ')' : '');
    return [g ? '£' + fmt(g) : '', e ? '€' + fmt(e) : ''].filter(Boolean).join(' + ');
  };
  OR.perRider = function (m, trip) {
    const n = Math.max(1, num(trip.riders)); const o = {}; for (const c in m) o[c] = m[c] / n; return OR.money(o, trip);
  };
  function fmt(v) { return v >= 100 ? Math.round(v).toLocaleString('en-GB') : v.toFixed(2).replace(/\.00$/, ''); }
  OR.SYM = SYM;

  // ---------- exports ----------
  OR.tripGpx = function (trip) {
    const xe = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
    const ll = p => 'lat="' + p[1].toFixed(6) + '" lon="' + p[0].toFixed(6) + '"';
    let g = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="OpenRoad" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>' + xe(trip.name) + '</name></metadata>\n';
    trip.days.forEach((day, di) => {
      if (day.hotel && day.hotel.lng != null) g += '<wpt ' + ll([day.hotel.lng, day.hotel.lat]) + '><name>' + xe('Night ' + (di + 1) + ': ' + day.hotel.name) + '</name></wpt>\n';
      day.steps.forEach((s, si) => {
        if (s.kind !== 'ride' || !s.route) return;
        const r = OR.unpackRoute(s.route), nm = OR.dayLabel(trip, di) + (day.steps.length > 1 ? ' part ' + (si + 1) : '') + ': ' + (r.name || '');
        g += '<rte><name>' + xe(nm) + '</name>\n' + (s.wps || []).map(w => '<rtept ' + ll([w.lng, w.lat]) + '><name>' + xe(w.name) + '</name></rtept>').join('\n') + '\n</rte>\n';
        g += '<trk><name>' + xe(nm) + '</name><trkseg>\n' + r.shape.map(p => '<trkpt ' + ll(p) + '/>').join('\n') + '\n</trkseg></trk>\n';
      });
    });
    return g + '</gpx>\n';
  };
  OR.tripText = function (trip) {
    const c = OR.tripCalc(trip);
    let t = trip.name + ' (' + OR.dayDate(trip, 0).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + trip.days.length + ' days)\n';
    t += OR.fmtDist(c.tot.dist) + ' riding, about ' + OR.fmtTime(c.tot.time) + '. Total ' + OR.money(c.tot.all, trip) + (num(trip.riders) > 1 ? ', ' + OR.perRider(c.tot.all, trip) + ' each' : '') + '\n\n';
    trip.days.forEach((day, di) => {
      const d = c.days[di];
      t += OR.dayLabel(trip, di) + (day.title ? ': ' + day.title : '') + '\n';
      day.steps.forEach(s => {
        if (s.kind === 'ride') t += '  Ride ' + (s.wps && s.wps.length ? s.wps[0].name + ' to ' + s.wps[s.wps.length - 1].name : '(not planned)') + (s.route ? ', ' + OR.fmtDist(s.route.dist) + ', ' + OR.fmtTime(s.route.time) : '') + '\n';
        else t += '  ' + (s.label || 'Crossing') + (s.depart ? ' at ' + s.depart : '') + (s.ref ? ', booking ' + s.ref : '') + '\n';
      });
      if (day.hotel) t += '  Night: ' + day.hotel.name + (day.hotel.phone ? ', ' + day.hotel.phone : '') + '\n';
      t += '  Day cost ' + OR.money(d.all, trip) + '\n\n';
    });
    return t + 'Planned with OpenRoad';
  };
  OR.tripHtml = function (trip) {
    const c = OR.tripCalc(trip), e = OR.esc;
    const rows = trip.days.map((day, di) => {
      const d = c.days[di];
      const steps = d.timeline.map(x => {
        const s = x.s;
        if (s.kind === 'ride') return '<tr><td>' + (x.none ? '' : OR.minToClock(x.at)) + '</td><td>Ride ' + e(s.wps && s.wps.length ? s.wps[0].name + ' to ' + s.wps[s.wps.length - 1].name : 'not planned yet') +
          (s.route && s.route.roads && s.route.roads.length ? '<br><small>via ' + e(s.route.roads.join(', ')) + '</small>' : '') + '</td><td>' + (s.route ? OR.fmtDist(s.route.dist) + '<br>' + OR.fmtTime(s.route.time) : '') + '</td></tr>';
        return '<tr><td>' + OR.minToClock(x.at) + '</td><td>' + e(s.label || 'Crossing') + (s.operator ? ', ' + e(s.operator) : '') + (s.ref ? '<br><small>Booking ' + e(s.ref) + '</small>' : '') + '</td><td>' + e(OR.money({ [s.cur || 'GBP']: num(s.cost) }, trip, { zero: false })) + '</td></tr>';
      }).join('');
      const h = day.hotel ? '<p><b>Night:</b> ' + e(day.hotel.name) + (day.hotel.phone ? ', ' + e(day.hotel.phone) : '') + (day.hotel.ref ? ', booking ' + e(day.hotel.ref) : '') + (num(day.hotel.cost) ? ', ' + OR.money({ [day.hotel.cur || 'GBP']: num(day.hotel.cost) }, trip) : '') + '</p>' : '';
      const other = (day.costs || []).map(x => e(x.label || 'Cost') + ' ' + OR.money({ [x.cur || 'GBP']: num(x.amount) }, trip)).join(', ');
      return '<section><h2>' + e(OR.dayLabel(trip, di)) + (day.title ? ': ' + e(day.title) : '') + '</h2><table>' + steps + '</table>' + h +
        (other ? '<p><b>Other costs:</b> ' + other + '</p>' : '') + (day.notes ? '<p>' + e(day.notes) + '</p>' : '') +
        '<p class="day">' + OR.fmtDist(d.dist) + ' riding, ' + OR.fmtTime(d.time) + '. Fuel ' + OR.money(d.fuel, trip) + '. Day total <b>' + OR.money(d.all, trip) + '</b></p></section>';
    }).join('');
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + e(trip.name) + '</title><style>' +
      'body{font:11pt/1.45 "Overpass",Arial,sans-serif;color:#1c2226;margin:18mm 16mm}h1{font-size:22pt;margin:0 0 2mm;color:#0b6b3a}h2{font-size:13pt;margin:0 0 2mm;padding:2mm 3mm;background:#0b6b3a;color:#fff;border-radius:2mm}' +
      'section{margin:0 0 7mm;page-break-inside:avoid}table{width:100%;border-collapse:collapse}td{padding:1.5mm 2mm;border-bottom:.3mm solid #dfe4e1;vertical-align:top}td:first-child{width:22mm;color:#555}td:last-child{text-align:right;width:30mm}' +
      '.sum{display:flex;gap:6mm;margin:4mm 0 8mm;flex-wrap:wrap}.sum div{border:.4mm solid #0b6b3a;border-radius:2mm;padding:2mm 4mm}.sum b{display:block;font-size:14pt}.day{color:#333}small{color:#666}</style></head><body>' +
      '<h1>' + e(trip.name) + '</h1><p>' + OR.dayDate(trip, 0).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ', ' + trip.days.length + ' days, ' + e(trip.riders || 1) + ' rider' + (num(trip.riders) > 1 ? 's' : '') + '</p>' +
      '<div class="sum"><div>Riding<b>' + OR.fmtDist(c.tot.dist) + '</b>' + OR.fmtTime(c.tot.time) + '</div><div>Fuel<b>' + OR.money(c.tot.fuel, trip) + '</b>' + Math.round(c.tot.litres) + ' litres</div>' +
      '<div>Crossings<b>' + OR.money(c.tot.ferry, trip) + '</b></div><div>Hotels<b>' + OR.money(c.tot.hotel, trip) + '</b></div><div>Other<b>' + OR.money(c.tot.other, trip) + '</b></div>' +
      '<div>Total<b>' + OR.money(c.tot.all, trip) + '</b>' + (num(trip.riders) > 1 ? OR.perRider(c.tot.all, trip) + ' each' : '') + '</div></div>' + rows +
      '<p><small>Planned with OpenRoad. Crossing times are typical times: check your booking. Prices are the ones you entered.</small></p></body></html>';
  };
  OR.printHtml = function (title, html) {
    if (OR.native && OR.native.printHtml) { OR.native.printHtml(title, html); return; }
    const w = window.open('', '_blank'); if (!w) { OR.toast('Allow pop-ups to print'); return; }
    w.document.write(html); w.document.close(); setTimeout(() => w.print(), 400);
  };
})(window.OR);
