/* OpenRoad "plan my trip": from a start, a finish, the dates, how long you want to ride each day and the places
   you want to see, it drafts the whole trip: the Channel crossing if it's needed, days of about equal riding that
   end in a town, each day's twisty route, and places to stay near each day's end. Then you edit it like any trip. */
'use strict';
(function (OR) {
  const $ = OR.$, $$ = OR.$$, esc = OR.esc, ic = (n, c) => OR.ic(n, c);
  const ll = p => [p.lng, p.lat];
  const est = r => OR.myTime ? OR.myTime(r.time, true) : r.time; // with your usual stops

  // the crossing that makes the least extra riding between two places
  function bestCrossing(a, b) {
    let best = null, bd = 1e15;
    OR.CROSSINGS.forEach(c => {
      const from = [c.from[1], c.from[2]], to = [c.to[1], c.to[2]];
      if (OR.inUK(from[0], from[1]) === OR.inUK(to[0], to[1])) return; // only UK to the continent and back
      const fromUK = OR.inUK(from[0], from[1]);
      if (fromUK !== OR.inUK(a.lng, a.lat)) return;
      const d = OR.dist(ll(a), from) + OR.dist(to, ll(b)) + c.hours * 3600 * 15; // an hour at sea "costs" about 15 km
      if (d < bd) { bd = d; best = c; }
    });
    return best;
  }
  const port = (c, which) => ({ name: c[which][0], lng: c[which][1], lat: c[which][2] });

  // stops in a sensible order (nearest next), keeping the start and finish fixed
  function order(start, stops, end) {
    const left = stops.slice(), out = []; let cur = start;
    while (left.length) { left.sort((x, y) => OR.dist(ll(cur), ll(x)) - OR.dist(ll(cur), ll(y))); cur = left.shift(); out.push(cur); }
    // if the finish is the start, an order that heads out the far way round can be better: try the reverse too
    if (end && OR.dist(ll(start), ll(end)) < 2000 && out.length > 2) {
      const len = l => [start].concat(l, [end]).reduce((s, p, i, a) => i ? s + OR.dist(ll(a[i - 1]), ll(p)) : 0, 0);
      if (len(out.slice().reverse()) < len(out)) out.reverse();
    }
    return out;
  }
  // the point on a route at a distance along it
  function pointAt(r, along) { let i = 1; while (i < r.cum.length - 1 && r.cum[i] < along) i++; const k = (along - r.cum[i - 1]) / Math.max(1, r.cum[i] - r.cum[i - 1]); return [r.shape[i - 1][0] + (r.shape[i][0] - r.shape[i - 1][0]) * k, r.shape[i - 1][1] + (r.shape[i][1] - r.shape[i - 1][1]) * k]; }
  function alongOf(r, p) { let best = 1e15, a = 0; for (let i = 0; i < r.shape.length - 1; i++) { const q = OR.projSeg(ll(p), r.shape[i], r.shape[i + 1]); if (q.d < best) { best = q.d; a = r.cum[i] + q.t * (r.cum[i + 1] - r.cum[i]); } } return a; }

  OR.autoTrip = async function (o, progress) {
    const say = m => progress && progress(m);
    const start = o.start, end = o.roundTrip ? Object.assign({}, o.start, { name: o.start.name }) : o.end;
    const sees = order(start, o.sees || [], end);
    // 1. the legs on land, with the crossings between them
    const seq = [start].concat(sees, [end]), legs = []; let cur = [seq[0]];
    for (let i = 1; i < seq.length; i++) {
      const a = seq[i - 1], b = seq[i];
      if (OR.inUK(a.lng, a.lat) !== OR.inUK(b.lng, b.lat)) {
        const c = bestCrossing(a, b); if (!c) throw new Error('No Channel crossing found between ' + a.name + ' and ' + b.name);
        cur.push(port(c, 'from')); legs.push({ kind: 'land', stops: cur }); legs.push({ kind: 'ferry', c }); cur = [port(c, 'to'), b];
      } else cur.push(b);
    }
    legs.push({ kind: 'land', stops: cur });
    // 2. plan each land leg as one route, to know how long it all takes
    for (const [i, l] of legs.entries()) {
      if (l.kind !== 'land' || l.stops.length < 2) continue;
      say('Planning the route (' + (i + 1) + ' of ' + legs.length + ')…');
      l.route = await OR.planWaypoints(l.stops.map((s, k) => ({ lng: s.lng, lat: s.lat, name: s.name, type: k === 0 || k === l.stops.length - 1 ? 'break' : 'through' })), o.style || 'twisty');
      l.secs = est(l.route);
    }
    const ferrySecs = l => (l.c.hours + 1) * 3600; // plus about an hour at the port
    const total = legs.reduce((s, l) => s + (l.kind === 'land' ? l.secs || 0 : ferrySecs(l)), 0);
    const days = Math.max(1, o.days), perDay = total / days;
    // 3. cut it into days of about equal riding; a cut near a place you want to see moves to it
    const dayPlans = [[]]; let used = 0;
    const newDay = () => { dayPlans.push([]); used = 0; };
    for (const l of legs) {
      if (l.kind === 'ferry') { if (used > perDay * 0.85 && dayPlans.length < days) newDay(); dayPlans[dayPlans.length - 1].push({ ferry: l.c }); used += ferrySecs(l); continue; }
      if (!l.route) continue;
      const r = l.route, stopAt = l.stops.map(s => ({ s, at: alongOf(r, s) }));
      let from = 0;
      while (true) {
        const room = perDay - used, leftSecs = l.secs * (1 - from / r.dist);
        if (leftSecs <= room * 1.1 || dayPlans.length >= days) { dayPlans[dayPlans.length - 1].push({ r, from, to: r.dist, stopAt }); used += leftSecs; break; }
        let to = from + r.dist * (room / l.secs);
        const near = stopAt.filter(x => x.at > from + 5000 && Math.abs(x.at - to) < r.dist * Math.max(0.04, perDay / l.secs * 0.2)).sort((a, b) => Math.abs(a.at - to) - Math.abs(b.at - to))[0];
        if (near) to = near.at;
        dayPlans[dayPlans.length - 1].push({ r, from, to, stopAt, cut: !near });
        newDay(); from = to;
      }
    }
    // 4. each day: its start, the places on the way, and where it ends, then plan that day properly
    const trip = { name: o.name || 'My trip', start: o.date, riders: o.riders || 1, fuelGBP: '', fuelEUR: '', eurRate: '', days: [] };
    let carry = null;
    for (const [di, parts] of dayPlans.entries()) {
      say('Planning day ' + (di + 1) + ' of ' + dayPlans.length + '…');
      const day = OR.trips.blankDay(); day.startTime = o.startTime || '09:00';
      for (const part of parts) {
        if (part.ferry) {
          const c = part.ferry;
          day.steps.push({ id: OR.uid(), kind: 'ferry', crossing: c.id, label: c.label, from: port(c, 'from'), to: port(c, 'to'), hours: c.hours, operator: '', cur: 'GBP' });
          carry = null; continue;
        }
        const r = part.r, a = carry || (part.from < 1 ? null : { lng: pointAt(r, part.from)[0], lat: pointAt(r, part.from)[1] });
        const startStop = part.from < 1 ? part.stopAt[0].s : a;
        const endP = part.to >= r.dist - 1 ? part.stopAt[part.stopAt.length - 1].s : { lng: pointAt(r, part.to)[0], lat: pointAt(r, part.to)[1], name: null };
        if (!endP.name) endP.name = (await OR.reverseName(endP.lng, endP.lat).catch(() => null)) || 'End of day ' + (di + 1);
        const vias = part.stopAt.filter(x => x.at > part.from + 500 && x.at < part.to - 500).map(x => x.s);
        const wps = [Object.assign({}, startStop, { type: 'break', name: startStop.name || 'Start' })].concat(vias.map(v => Object.assign({}, v, { type: 'through' })), [Object.assign({}, endP, { type: 'break' })]);
        let dr;
        try { dr = await OR.planWaypoints(wps.map(w => ({ lng: w.lng, lat: w.lat, name: w.name, type: w.type })), o.style || 'twisty'); } catch (e) { dr = null; }
        day.steps.push({ id: OR.uid(), kind: 'ride', name: (startStop.name || '') + ' to ' + endP.name, wps: wps.map(w => ({ lng: w.lng, lat: w.lat, name: w.name, type: w.type })), route: dr ? OR.packRoute(dr) : null });
        carry = endP;
      }
      // the day's title, and places to stay near where it ends (not on the last day of a trip that ends at home)
      const last = day.steps.filter(s => s.kind === 'ride').slice(-1)[0], endW = last && last.wps[last.wps.length - 1];
      day.title = last ? (last.wps[0].name + ' to ' + endW.name) : (day.steps[0] && day.steps[0].label) || '';
      if (endW && !(di === dayPlans.length - 1)) {
        try {
          const stays = (await OR.nearby('stay', endW.lng, endW.lat, 6000)).filter(p => p.name).sort((a, b) => a.d - b.d).slice(0, 4);
          if (stays.length) day.notes = 'Places to stay near ' + endW.name + ': ' + stays.map(p => p.name).join(', ') + '. Tap "Find a hotel" for details.';
        } catch (e) { }
      }
      trip.days.push(day);
    }
    // 5. today's fuel prices and euro rate, if there's a signal
    try { const p = await OR.todaysPrices('FR'); if (p.gbp) trip.fuelGBP = p.gbp.toFixed(3); if (p.eur) trip.fuelEUR = p.eur.toFixed(3); if (p.rate) trip.eurRate = p.rate; trip.fuelCountry = 'FR'; trip.priceStamp = { at: Date.now(), ukWeek: p.ukWeek, euDate: p.euDate, country: 'FR', rateDate: p.rateDate }; } catch (e) { }
    const t = OR.trips.create(trip);
    return { trip: t, total, perDay, longDay: perDay > (o.hours || 6) * 3600 * 1.1 };
  };

  // ---------- the form ----------
  OR.autoTripSheet = function () {
    const st = { start: OR.pos ? { lng: OR.pos.lng, lat: OR.pos.lat, name: 'My position' } : null, end: null, sees: [], roundTrip: true };
    const d0 = new Date(Date.now() + 7 * 864e5);
    const draw = () => OR.sheet('<h2>' + ic('trips') + 'Plan my trip</h2><p class="small">Say where and when, and OpenRoad drafts the whole trip: crossings, days, twisty routes and places to stay. You can change any of it afterwards.</p>' +
      OR.field('atName', 'Trip name', st.name || '', 'text', 'e.g. Ardennes 2027') +
      '<label class="f"><span>Start</span></label>' + placeBtn('start', st.start) +
      '<label class="chk"><input type="checkbox" id="atRound"' + (st.roundTrip ? ' checked' : '') + '> Finish back at the start</label>' + (st.roundTrip ? '' : '<label class="f"><span>Finish</span></label>' + placeBtn('end', st.end)) +
      '<label class="f"><span>Places I want to see (in any order)</span></label><div class="chips">' + st.sees.map((p, i) => '<span class="chip">' + esc(p.name) + ' <button class="mini" data-rmsee="' + i + '" aria-label="Remove">' + ic('x') + '</button></span>').join('') + '</div>' +
      '<button class="btn small" id="atAddSee">' + ic('plus') + 'Add a place</button>' +
      '<div class="two">' + OR.field('atDate', 'First day', st.date || OR.isoDate(d0), 'date') + OR.field('atDays', 'Number of days', st.days || 4, 'number') + '</div>' +
      '<label class="range"><span>Riding each day, with stops <b id="atHrsOut">' + (st.hours || 6) + ' hours</b></span><input type="range" id="atHrs" min="2" max="10" step="0.5" value="' + (st.hours || 6) + '"></label>' +
      '<div class="two"><label class="f"><span>Set off each day at</span><input type="time" id="atTime" value="' + (st.startTime || '09:00') + '"></label>' + OR.field('atRiders', 'Riders sharing costs', st.riders || 1, 'number') + '</div>' +
      '<button class="btn wide go" id="atGo">Plan it</button><p class="small muted" id="atMsg"></p>', b => {
      const keep = () => { st.name = $('#atName', b).value; st.date = $('#atDate', b).value; st.days = +$('#atDays', b).value; st.hours = +$('#atHrs', b).value; st.startTime = $('#atTime', b).value; st.riders = +$('#atRiders', b).value; st.roundTrip = $('#atRound', b).checked; };
      $('#atHrs', b).oninput = e => { $('#atHrsOut', b).textContent = e.target.value + ' hours'; };
      $('#atRound', b).onchange = () => { keep(); draw(); };
      $$('[data-place]', b).forEach(x => x.onclick = () => { keep(); find(x.dataset.place); });
      $('#atAddSee', b).onclick = () => { keep(); find('see'); };
      $$('[data-rmsee]', b).forEach(x => x.onclick = () => { keep(); st.sees.splice(+x.dataset.rmsee, 1); draw(); });
      $('#atGo', b).onclick = async () => {
        keep();
        if (!st.start) return OR.toast('Choose where you start');
        if (!st.roundTrip && !st.end) return OR.toast('Choose where you finish, or tick "Finish back at the start"');
        if (!(st.days >= 1)) return OR.toast('How many days?');
        const btn = $('#atGo', b); btn.disabled = true;
        try {
          const res = await OR.autoTrip({ name: st.name, start: st.start, end: st.end, roundTrip: st.roundTrip, sees: st.sees, date: st.date, days: st.days, hours: st.hours, startTime: st.startTime, riders: st.riders },
            m => { const el = $('#atMsg', b); if (el) el.textContent = m; });
          OR.closeSheet(); OR.openTrip(res.trip.id);
          OR.toast(res.longDay ? 'Planned, but it needs about ' + OR.fmtTime(res.perDay) + ' a day. Add a day or drop a place to make the days shorter.' : 'Trip planned: about ' + OR.fmtTime(res.perDay) + ' of riding a day, with stops.', 8000);
        } catch (e) { const el = $('#atMsg', b); if (el) el.textContent = 'Could not plan it: ' + e.message + (OR.online() ? '' : ' (planning needs a signal)'); btn.disabled = false; }
      };
    });
    const placeBtn = (k, p) => '<button class="btn wide placebtn" data-place="' + k + '">' + ic('near') + (p ? esc(p.name) : 'Choose…') + '</button>';
    // search for a place (or use my position)
    function find(which) {
      OR.sheet('<h2>' + (which === 'see' ? 'A place to see' : which === 'start' ? 'Start' : 'Finish') + '</h2>' + OR.field('atQ', 'Search', '', 'search', 'Town, castle, pass, postcode…') + '<div class="list" id="atRes"></div>' +
        (OR.pos && which !== 'see' ? '<button class="btn wide" id="atHere">Use my position</button>' : '') + '<button class="btn wide ghost" id="atBack">Back</button>', b => {
        let timer; const q = $('#atQ', b); setTimeout(() => q.focus(), 100);
        const pick = p => { if (which === 'see') st.sees.push(p); else st[which] = p; draw(); };
        q.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { const s = q.value.trim(); if (s.length < 2) return; OR.search(s).then(list => { const r = $('#atRes', b); if (!r) return; r.innerHTML = list.map((x, i) => '<button class="li" data-i="' + i + '"><b>' + esc(x.name) + '</b><span>' + esc(x.sub) + '</span></button>').join('') || '<p class="small muted">Nothing found.</p>'; $$('[data-i]', r).forEach(el => el.onclick = () => pick(list[+el.dataset.i])); }).catch(() => { }); }, 350); };
        const h = $('#atHere', b); if (h) h.onclick = () => pick({ lng: OR.pos.lng, lat: OR.pos.lat, name: 'My position' });
        $('#atBack', b).onclick = draw;
      });
    }
    draw();
  };
})(window.OR);
