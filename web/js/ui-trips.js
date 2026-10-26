/* OpenRoad trips screens: list of trips and the day-by-day planner. */
'use strict';
(function (OR) {
  const $ = OR.$, $$ = OR.$$, esc = OR.esc, ic = (n, c) => OR.ic(n, c);
  let openId = null;
  const wxCache = {};
  const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const curSel = (id, val) => '<label class="f"><span>Currency</span><select id="' + id + '"><option value="GBP"' + (val !== 'EUR' ? ' selected' : '') + '>£ pounds</option><option value="EUR"' + (val === 'EUR' ? ' selected' : '') + '>€ euros</option></select></label>';

  OR.openTrip = id => { openId = id; OR.tab('trips'); render(); };
  OR.renderTrips = render;
  function save(t) { OR.trips.save(t); }

  function render() {
    const v = $('#v-trips'); if (!v) return;
    const t = openId && OR.trips.get(openId);
    if (t) return tripPage(v, t);
    openId = null;
    const list = OR.trips.list();
    v.innerHTML = '<h2 class="vh">Trips</h2><button class="btn wide go" id="autoTrip">' + ic('trips') + 'Plan my trip for me</button><button class="btn wide" id="newTrip">' + ic('plus') + 'Plan a trip step by step</button>' +
      (list.length ? '<div class="list">' + list.map(t => {
        const c = OR.tripCalc(t);
        return '<button class="li trip" data-id="' + t.id + '"><b>' + esc(t.name) + '</b><span>' + OR.dayDate(t, 0).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + t.days.length + ' day' + (t.days.length > 1 ? 's' : '') + '</span>' +
          '<span class="kv"><span><b>' + OR.fmtDist(c.tot.dist) + '</b>riding</span><span><b>' + OR.money(c.tot.all, t) + '</b>total</span></span></button>';
      }).join('') + '</div>'
        : '<div class="empty">' + ic('trips', 'big') + '<p>Plan a tour step by step: each day\'s ride, ferry or tunnel crossings, fuel, hotels and what it all costs, split between riders.</p></div>');
    $('#autoTrip', v).onclick = () => OR.autoTripSheet();
    $('#newTrip', v).onclick = newTrip;
    $$('.trip', v).forEach(b => b.onclick = () => { openId = b.dataset.id; render(); $('#views').scrollTop = 0; });
  }

  function tripForm(t) {
    const cc = t.fuelCountry || 'FR';
    return OR.field('tName', 'Trip name', t.name, 'text', 'e.g. Ardennes 2027') +
      '<div class="two">' + OR.field('tStart', 'First day', t.start, 'date') + OR.field('tRiders', 'Riders sharing costs', t.riders, 'number') + '</div>' +
      '<div class="pricebox"><div class="pb-h"><b>Fuel and euro</b><button class="btn small yellow" id="tPrices" type="button">' + OR.ic('update') + (t.priceStamp ? 'Update to today\'s prices' : 'Fill in today\'s prices') + '</button></div>' +
      '<label class="f"><span>Fuel abroad: prices for</span><select id="tCountry">' + Object.keys(OR.EU_NAMES).map(k => '<option value="' + k + '"' + (k === cc ? ' selected' : '') + '>' + OR.EU_NAMES[k] + '</option>').join('') + '</select></label>' +
      '<div class="two">' + OR.field('tFuelG', 'UK unleaded (£ a litre)', t.fuelGBP, 'number', 'e.g. 1.45') + OR.field('tFuelE', 'Abroad (€ a litre)', t.fuelEUR, 'number', 'e.g. 1.80') + '</div>' +
      OR.field('tRate', 'Euro rate: £ for €1', t.eurRate, 'number', 'e.g. 0.85') +
      '<p class="small stamp" id="tStamp">' + esc(t.priceStamp ? OR.priceStamp(t.priceStamp) : 'Press the button for today\'s official average prices and exchange rate, or type your own.') + '</p></div>' +
      '<p class="small muted">Ferry and hotel prices are whatever you enter.</p>';
  }
  function readForm(b, t) {
    t.name = $('#tName', b).value.trim() || 'My trip'; t.start = $('#tStart', b).value || t.start;
    t.riders = Math.max(1, parseInt($('#tRiders', b).value, 10) || 1);
    t.fuelGBP = $('#tFuelG', b).value; t.fuelEUR = $('#tFuelE', b).value; t.eurRate = $('#tRate', b).value; t.fuelCountry = $('#tCountry', b).value;
  }
  // fills the price fields from today's official averages and stamps when it was done
  function bindPrices(b, t) {
    const btn = $('#tPrices', b);
    const go = async () => {
      btn.disabled = true; const was = btn.innerHTML; btn.textContent = 'Getting prices…';
      try {
        const p = await OR.todaysPrices($('#tCountry', b).value);
        if (p.gbp != null) $('#tFuelG', b).value = p.gbp.toFixed(3);
        if (p.eur != null) $('#tFuelE', b).value = p.eur.toFixed(3);
        if (p.rate != null) $('#tRate', b).value = p.rate;
        t.priceStamp = { at: Date.now(), ukWeek: p.ukWeek, euDate: p.euDate, country: p.country, rateDate: p.rateDate };
        t.fuelCountry = p.country;
        $('#tStamp', b).textContent = OR.priceStamp(t.priceStamp);
        if (p.rate == null) OR.toast('Fuel prices filled in. The euro rate couldn\'t be fetched: type it in', 6000);
      } catch (e) { OR.toast('Couldn\'t get today\'s prices (' + e.message + '). ' + (OR.online() ? '' : 'You need a signal. ') + 'You can type them in.', 7000); }
      btn.disabled = false; btn.innerHTML = was;
    };
    btn.onclick = go;
    $('#tCountry', b).onchange = () => { t.fuelCountry = $('#tCountry', b).value; if (t.priceStamp) go(); };
  }
  function newTrip() {
    const t = { name: '', start: OR.isoDate(new Date(Date.now() + 7 * 864e5)), riders: 1, fuelGBP: '', fuelEUR: '', eurRate: '' };
    OR.sheet('<h2>New trip</h2>' + tripForm(t) + '<button class="btn wide pri" id="tGo">Create trip</button>', b => {
      bindPrices(b, t);
      $('#tGo', b).onclick = () => { readForm(b, t); const n = OR.trips.create(t); OR.closeSheet(); openId = n.id; render(); };
    });
  }
  function editTrip(t) {
    OR.sheet('<h2>Trip details</h2>' + tripForm(t) + '<button class="btn wide pri" id="tGo">Save</button>', b => {
      bindPrices(b, t);
      $('#tGo', b).onclick = () => { readForm(b, t); save(t); OR.closeSheet(); render(); };
    });
  }

  // ---------- one trip ----------
  // ---------- the trip on the map, beside the list ----------
  const DAY_COLOURS = ['#ff6a1f', '#1e88e5', '#8e24aa', '#0e9f57', '#d81b60', '#f59f00', '#00897b', '#5d4037'];
  OR.drawTrip = function (t, focus) {
    const feats = [], days = [], all = [];
    t.days.forEach((day, di) => {
      const c = DAY_COLOURS[di % DAY_COLOURS.length], dim = focus != null && focus !== di;
      let last = null;
      day.steps.forEach(s => {
        if (s.kind === 'ride' && s.route) { const r = OR.unpackRoute(s.route); feats.push({ type: 'Feature', properties: { c, dim }, geometry: { type: 'LineString', coordinates: r.shape } }); if (focus == null || focus === di) all.push(...r.shape); last = r.shape[r.shape.length - 1]; }
        else if (s.kind === 'ferry' && s.from && s.to) { const l = [[s.from.lng, s.from.lat], [s.to.lng, s.to.lat]]; feats.push({ type: 'Feature', properties: { c, dim, ferry: true }, geometry: { type: 'LineString', coordinates: l } }); if (focus == null || focus === di) all.push(...l); last = l[1]; }
      });
      if (last) days.push({ type: 'Feature', properties: { label: 'Day ' + (di + 1), c }, geometry: { type: 'Point', coordinates: last } });
    });
    OR.setData('trip', { type: 'FeatureCollection', features: feats }); OR.setData('tripdays', { type: 'FeatureCollection', features: days });
    if (all.length > 1) {
      const wide = innerWidth >= 900;
      OR.map.fitBounds(OR.bbox(all), { padding: wide ? { top: 90, bottom: 50, left: 440, right: 70 } : { top: 120, bottom: Math.round(innerHeight * 0.5), left: 30, right: 30 }, maxZoom: 13, duration: 700 });
    }
  };
  OR.clearTrip = () => { OR.setData('trip', null); OR.setData('tripdays', null); };
  OR.on('tab', t => { if (t !== 'trips') OR.clearTrip(); });
  function tripPage(v, t) {
    setTimeout(() => OR.drawTrip(t), 0);
    const c = OR.tripCalc(t), tot = c.tot;
    let h = '<button class="backbtn" id="tBack">' + ic('back') + 'All trips</button>' +
      '<div class="trip-head"><div><h2 class="vh">' + esc(t.name) + '</h2><span class="muted">' + OR.dayDate(t, 0).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) +
      ' to ' + OR.dayDate(t, t.days.length - 1).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + t.riders + ' rider' + (t.riders > 1 ? 's' : '') + '</span></div>' +
      '<div class="gbtns"><button class="btn small ghost" id="tEdit">Edit</button><button class="btn small pri" id="tDiary">' + ic('trips') + 'Diary</button></div></div>' +
      '<div class="total"><div class="big"><span>Trip total</span><b>' + OR.money(tot.all, t) + '</b>' + (t.riders > 1 ? '<small>' + OR.perRider(tot.all, t) + ' each</small>' : '') + '</div>' +
      '<dl><dt>Riding</dt><dd>' + OR.fmtDist(tot.dist) + ', ' + OR.fmtTime(tot.time) + '</dd><dt>Fuel</dt><dd>' + OR.money(tot.fuel, t) + (tot.litres ? ' (' + Math.round(tot.litres) + ' L)' : '') + '</dd>' +
      '<dt>Crossings</dt><dd>' + OR.money(tot.ferry, t) + '</dd><dt>Hotels</dt><dd>' + OR.money(tot.hotel, t) + '</dd><dt>Other</dt><dd>' + OR.money(tot.other, t) + '</dd></dl></div>';
    const notes = [];
    if (!(OR.mpg && OR.mpg())) notes.push('<button class="linkish" data-more="bike">Add your mpg</button> to work out fuel.');
    else if (tot.missingFuel) notes.push('<button class="linkish" id="tFix">Add fuel prices</button> to cost the fuel.');
    if (tot.unplanned) notes.push(tot.unplanned + ' ride' + (tot.unplanned > 1 ? 's' : '') + ' still to plan.');
    if ((tot.all.EUR || 0) && (tot.all.GBP || 0) && !num(t.eurRate)) notes.push('<button class="linkish" id="tFix2">Add a euro rate</button> to see one total in pounds.');
    if (t.priceStamp) h += '<p class="small stamp">' + OR.ic('fuel') + esc('Fuel ' + (t.fuelGBP ? '£' + t.fuelGBP : '') + (t.fuelEUR ? ' and €' + t.fuelEUR + ' in ' + (OR.EU_NAMES[t.fuelCountry] || 'Europe') : '') + (t.eurRate ? ', €1 = £' + t.eurRate : '') + '. ' + OR.priceStamp(t.priceStamp)) + ' <button class="linkish" id="tUpd">Update</button></p>';
    if (notes.length) h += '<div class="notes">' + notes.map(n => '<p>' + n + '</p>').join('') + '</div>';

    h += '<ol class="days">' + t.days.map((day, di) => dayHtml(t, day, di, c.days[di])).join('') + '</ol>';
    h += '<button class="btn wide" id="addDay">' + ic('plus') + 'Add day ' + (t.days.length + 1) + '</button>' +
      '<div class="tools">' + [['tPdf', 'print', 'Save as PDF', '#1e88e5'], ['tGpx', 'dl', 'GPX for all days', '#5d6d7e'], ['tShare', 'share', 'Share', '#00897b'], ['tDel', 'x', 'Delete trip', '#e53935']].map(([id, i, l, c]) => '<button class="tool" id="' + id + '">' + OR.badge(i, c) + '<span>' + l + '</span></button>').join('') + '</div>';
    v.innerHTML = h;
    bindTrip(v, t);
    t.days.forEach((day, di) => loadWeather(t, day, di));
  }

  function dayHtml(t, day, di, d) {
    const end = OR.dayEnd(day);
    let h = '<li class="day" data-d="' + di + '"><div class="day-head"><div><b>' + esc(OR.dayLabel(t, di)) + '</b>' +
      '<input class="day-title" data-d="' + di + '" value="' + esc(day.title) + '" placeholder="Add a title, e.g. Home to Dover"></div>' +
      '<span class="wxchip" id="wx' + di + '"></span><button class="mini dmapbtn" data-dmapshow="' + di + '" aria-label="Show this day on the map">' + ic('map') + '</button></div>';
    h += '<label class="leave">Set off at <input type="time" data-start="' + di + '" value="' + esc(day.startTime || '09:00') + '"></label>';
    h += '<ol class="steps">';
    if (!day.steps.length) h += '<li class="step none"><span class="muted small">Add the day\'s ride below. If you\'re crossing the Channel, add the ride to the port, the crossing, then the ride on the other side.</span></li>';
    d.timeline.forEach((x, k) => {
      const s = x.s, si = day.steps.indexOf(s);
      if (s.kind === 'ride') {
        const r = s.route, from = s.wps && s.wps[0], to = s.wps && s.wps.length > 1 && s.wps[s.wps.length - 1];
        h += '<li class="step ride"><span class="when">' + (x.none ? '' : OR.minToClock(x.at)) + '</span><div class="what">' + ic('rides') +
          '<div><b>' + esc(from ? from.name : 'Start not set') + ' to ' + esc(to ? to.name : '…') + '</b>' +
          (r ? '<span>' + OR.fmtDist(r.dist) + ', ' + OR.fmtTime(r.time) + (r.twist ? ', ' + OR.bendLabel(r.twist).toLowerCase() : '') + '</span>' + (r.roads && r.roads.length ? '<span class="refs">' + r.roads.map(OR.refChip).join('') + '</span>' : '')
            : '<span class="warn">Not planned yet</span>') +
          portWarn(day, si) + '<div class="row">' +
          '<button class="btn small ' + (r ? 'ghost' : 'pri') + '" data-plan="' + di + ':' + si + '">' + (r ? 'Change on map' : 'Plan on map') + '</button>' +
          (r ? '<button class="btn small" data-ride="' + di + ':' + si + '">Ride</button><button class="btn small" data-beeline="' + di + ':' + si + '">Beeline</button><button class="btn small" data-maps="' + di + ':' + si + '">Google / Apple</button><button class="btn small ghost" data-fuel="' + di + ':' + si + '">Fuel stops</button>' : '') +
          '<button class="mini" data-rm="' + di + ':' + si + '" aria-label="Remove ride">' + ic('x') + '</button></div></div></div></li>';
      } else {
        h += '<li class="step ferry"><span class="when">' + OR.minToClock(x.at) + '</span><div class="what">' + ic('ferry') +
          '<div><b>' + esc(s.label || 'Crossing') + '</b><span>' + esc([s.operator, s.hours ? 'about ' + OR.fmtTime(num(s.hours) * 3600) : '', 'arrive ' + OR.minToClock(x.until)].filter(Boolean).join(', ')) + '</span>' +
          '<span>' + (num(s.cost) ? '<b>' + OR.money({ [s.cur || 'GBP']: num(s.cost) }, t) + '</b>' : '<span class="warn">No price yet</span>') + (s.ref ? ', booking ' + esc(s.ref) : '') + '</span>' +
          '<div class="row"><button class="btn small ghost" data-ferry="' + di + ':' + si + '">Edit</button><button class="mini" data-rm="' + di + ':' + si + '" aria-label="Remove crossing">' + ic('x') + '</button></div></div></div></li>';
      }
    });
    // the night
    const hot = day.hotel;
    // daylight: sunrise and sunset where the day ends, and a warning if you'd still be riding after dark
    const sunAt = end || OR.dayStart && OR.dayStart(day);
    if (sunAt) {
      const sd = OR.dayDate(t, di), sun = OR.sunTimes(sunAt.lat, sunAt.lng, sd);
      if (sun && sun.rise && sun.set) {
        // times on a trip day are local where you are: UK and Ireland on UK time, the rest of western Europe an hour ahead
        const tz = (OR.inUK(sunAt.lng, sunAt.lat) || (sunAt.lng < -5.4 && sunAt.lat > 51.3 && sunAt.lat < 55.5)) ? 'Europe/London' : 'Europe/Paris';
        const hm = x => { const q = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(x); return +q.find(z => z.type === 'hour').value * 60 + +q.find(z => z.type === 'minute').value; };
        const clk = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
        const setM = hm(sun.set), riseM = hm(sun.rise), startM = d.timeline.length ? d.timeline[0].at : null;
        const late = d.timeline.length && d.arrive > setM, early = startM != null && startM < riseM;
        h += '<li class="step sun' + (late || early ? ' dark' : '') + '"><span class="when"></span><div class="what">' + ic('sun') + '<div><b>Sunrise ' + clk(riseM) + ', sunset ' + clk(setM) + (tz === 'Europe/Paris' ? ' (local time)' : '') + '</b>' +
          (late ? '<span class="warn">You\'d arrive about ' + OR.minToClock(d.arrive) + ', ' + OR.fmtTime((d.arrive - setM) * 60) + ' after sunset. Leave earlier or shorten the day.</span>' : early ? '<span class="warn">You\'d set off before sunrise.</span>' : d.timeline.length ? '<span>Riding finishes ' + OR.fmtTime((setM - d.arrive) * 60) + ' before sunset.</span>' : '') + '</div></div></li>';
      }
    }
    h += '<li class="step night"><span class="when">' + (d.timeline.length ? OR.minToClock(d.arrive) : '') + '</span><div class="what">' + ic('bed') + '<div>' +
      (hot ? '<b>' + esc(hot.name) + '</b><span>' + (num(hot.cost) ? '<b>' + OR.money({ [hot.cur || 'GBP']: num(hot.cost) }, t) + '</b>' : '<span class="warn">No price yet</span>') + (hot.ref ? ', booking ' + esc(hot.ref) : '') + '</span>' +
        '<div class="row">' + (hot.phone ? '<a class="btn small ghost" href="tel:' + esc(hot.phone.replace(/\s/g, '')) + '">Call</a>' : '') + (hot.web ? '<a class="btn small ghost" target="_blank" href="' + esc(/^https?:/.test(hot.web) ? hot.web : 'https://' + hot.web) + '">Website</a>' : '') +
        '<button class="btn small ghost" data-hotel="' + di + '">Edit</button><button class="mini" data-unhotel="' + di + '" aria-label="Remove hotel">' + ic('x') + '</button></div>'
        : '<b>Where are you staying?</b><span class="muted">' + (end ? 'Find places near ' + esc(end.name) + ' or add your own.' : 'Plan the ride first to search near where the day ends.') + '</span>' +
          '<div class="row">' + (end ? '<button class="btn small pri" data-findhotel="' + di + '">Find a hotel</button>' : '') + '<button class="btn small ghost" data-hotel="' + di + '">Add my own</button>' + (di === OR.trips.get(openId).days.length - 1 ? '<button class="btn small ghost" data-nohotel="' + di + '">Home tonight</button>' : '') + '</div>') +
      '</div></div></li>';
    (day.costs || []).forEach((cst, ci) => {
      h += '<li class="step cost"><span class="when"></span><div class="what"><span class="ci">' + (cst.cur === 'EUR' ? '€' : '£') + '</span><div><b>' + esc(cst.label || 'Cost') + '</b><span>' + OR.money({ [cst.cur || 'GBP']: num(cst.amount) }, t) + '</span></div><button class="mini" data-uncost="' + di + ':' + ci + '" aria-label="Remove cost">' + ic('x') + '</button></div></li>';
    });
    h += '</ol><div class="row wrap add"><button class="btn small" data-addride="' + di + '">' + ic('plus') + 'Ride</button><button class="btn small" data-addferry="' + di + '">' + ic('plus') + 'Ferry or tunnel</button><button class="btn small" data-addcost="' + di + '">' + ic('plus') + 'Cost</button>' +
      (OR.trips.get(openId).days.length > 1 ? '<button class="btn small ghost" data-delday="' + di + '">Remove day</button>' : '') + '</div>';
    h += '<div class="day-sum"><span>' + OR.fmtDist(d.dist) + ', ' + OR.fmtTime(d.time) + '</span><span>Fuel ' + OR.money(d.fuel, t) + '</span><b>Day ' + OR.money(d.all, t) + '</b></div></li>';
    return h;
  }
  // a crossing that doesn't start where the ride before it ends
  function portWarn(day, si) {
    const s = day.steps[si], nx = day.steps[si + 1];
    if (!nx || nx.kind !== 'ferry' || !s.wps || !s.wps.length) return '';
    const e = s.wps[s.wps.length - 1];
    if (OR.dist([e.lng, e.lat], [nx.from.lng, nx.from.lat]) < 3000) return '';
    return '<span class="warn small">This ride ends at ' + esc(e.name) + ' but the crossing leaves from ' + esc(nx.from.name) + '. <button class="linkish" data-toport="' + si + '">End the ride at ' + esc(nx.from.name) + '</button></span>';
  }

  function bindTrip(v, t) {
    const on = (id, fn) => { const e = $('#' + id, v); if (e) e.onclick = fn; };
    on('tBack', () => { openId = null; OR.clearTrip(); render(); });
    $$('[data-dmapshow]', v).forEach(b => b.onclick = () => { const di = +b.dataset.dmapshow; OR.drawTrip(t, di); $$('[data-dmapshow]', v).forEach(x => x.classList.toggle('on', x === b)); });
    on('tEdit', () => editTrip(t)); on('tDiary', () => OR.openDiary(t)); on('tUpd', () => editTrip(t)); on('tFix', () => editTrip(t)); on('tFix2', () => editTrip(t));
    $$('[data-more]', v).forEach(b => b.onclick = () => OR.openMore(b.dataset.more));
    on('addDay', () => { t.days.push(OR.trips.blankDay()); save(t); render(); });
    on('tPdf', () => OR.printHtml(t.name, OR.tripHtml(t)));
    on('tGpx', () => OR.saveFile(OR.fileName(t.name) + '.gpx', OR.tripGpx(t)));
    on('tShare', () => OR.share(OR.tripText(t), t.name));
    on('tDel', () => { if (confirm('Delete the trip "' + t.name + '"?')) { OR.trips.del(t.id); openId = null; render(); } });
    const ds = s => s.split(':').map(Number);
    $$('.day-title', v).forEach(i => i.onchange = () => { t.days[+i.dataset.d].title = i.value.trim(); save(t); });
    $$('[data-start]', v).forEach(i => i.onchange = () => { t.days[+i.dataset.start].startTime = i.value; save(t); render(); });
    $$('[data-addride]', v).forEach(b => b.onclick = () => { const di = +b.dataset.addride, day = t.days[di]; const prev = OR.tripPrevEnd(t, di, day.steps.length);
      day.steps.push({ kind: 'ride', wps: prev ? [{ lng: prev.lng, lat: prev.lat, name: prev.name, type: 'break' }] : [], route: null }); save(t); planStep(t, di, day.steps.length - 1); });
    $$('[data-plan]', v).forEach(b => b.onclick = () => { const [di, si] = ds(b.dataset.plan); planStep(t, di, si); });
    $$('[data-beeline]', v).forEach(b => b.onclick = () => { const [di, si] = ds(b.dataset.beeline); const st = t.days[di].steps[si], r = OR.unpackRoute(st.route); r.wps = st.wps; r.name = OR.dayLabel(t, di) + ': ' + (r.name || t.name); OR.sendToBeeline(r); });
    $$('[data-maps]', v).forEach(b => b.onclick = () => { const [di, si] = ds(b.dataset.maps); const st = t.days[di].steps[si], r = OR.unpackRoute(st.route); r.wps = st.wps; r.name = OR.dayLabel(t, di) + ': ' + (r.name || t.name); OR.shareToMaps(r); });
    $$('[data-ride]', v).forEach(b => b.onclick = () => { const [di, si] = ds(b.dataset.ride); const r = OR.unpackRoute(t.days[di].steps[si].route); r.wps = t.days[di].steps[si].wps; OR.startRideUi(r); });
    $$('[data-fuel]', v).forEach(b => b.onclick = () => { const [di, si] = ds(b.dataset.fuel); fuelStops(t, di, si); });
    $$('[data-rm]', v).forEach(b => b.onclick = () => { const [di, si] = ds(b.dataset.rm); if (confirm('Remove this from day ' + (di + 1) + '?')) { t.days[di].steps.splice(si, 1); save(t); render(); } });
    $$('[data-toport]', v).forEach(b => b.onclick = () => { const li = b.closest('.day'), di = +li.dataset.d, si = +b.dataset.toport, day = t.days[di], f = day.steps[si + 1].from;
      day.steps[si].wps[day.steps[si].wps.length - 1] = { lng: f.lng, lat: f.lat, name: f.name, type: 'break' }; day.steps[si].route = null; save(t); planStep(t, di, si); });
    $$('[data-addferry]', v).forEach(b => b.onclick = () => ferrySheet(t, +b.dataset.addferry, null));
    $$('[data-ferry]', v).forEach(b => b.onclick = () => { const [di, si] = ds(b.dataset.ferry); ferrySheet(t, di, si); });
    $$('[data-findhotel]', v).forEach(b => b.onclick = () => findHotel(t, +b.dataset.findhotel));
    $$('[data-hotel]', v).forEach(b => b.onclick = () => hotelSheet(t, +b.dataset.hotel));
    $$('[data-unhotel]', v).forEach(b => b.onclick = () => { t.days[+b.dataset.unhotel].hotel = null; save(t); render(); });
    $$('[data-nohotel]', v).forEach(b => b.onclick = () => { t.days[+b.dataset.nohotel].hotel = { name: 'Home', cost: 0, cur: 'GBP' }; save(t); render(); });
    $$('[data-addcost]', v).forEach(b => b.onclick = () => costSheet(t, +b.dataset.addcost));
    $$('[data-uncost]', v).forEach(b => b.onclick = () => { const [di, ci] = ds(b.dataset.uncost); t.days[di].costs.splice(ci, 1); save(t); render(); });
    $$('[data-delday]', v).forEach(b => b.onclick = () => { const di = +b.dataset.delday; if (confirm('Remove day ' + (di + 1) + ' and everything in it? Later days move up a date.')) { t.days.splice(di, 1); save(t); render(); } });
  }

  // ---------- planning a ride on the map ----------
  function planStep(t, di, si) {
    const s = t.days[di].steps[si];
    OR.plan.target = { tripId: t.id, day: di, step: si };
    OR.plan.wps = (s.wps || []).map(w => Object.assign({}, w)); OR.savePlan();
    OR.plan.options = []; OR.plan.route = null;
    if (s.route) { const r = OR.unpackRoute(s.route); r.wps = s.wps; OR.plan.options = [r]; OR.plan.choice = 0; OR.plan.route = r; OR.showOptions(true); }
    else { OR.setData('route', null); OR.setData('alts', null); }
    OR.setPlanMode('ab'); OR.drawWaypoints(); OR.renderPlan(); OR.tab('plan');
    if (!s.route && s.wps && s.wps.length === 1) OR.toast('Starts at ' + s.wps[0].name + '. Tap the map or search for where this ride goes.', 5000);
    if (!s.route && OR.plan.wps.length) OR.map.flyTo({ center: [OR.plan.wps[0].lng, OR.plan.wps[0].lat], zoom: 9 });
  }
  OR.saveTargetRoute = function (r) {
    const tg = OR.plan.target; if (!tg || !r) return;
    const t = OR.trips.get(tg.tripId); if (!t) return;
    const s = t.days[tg.day] && t.days[tg.day].steps[tg.step]; if (!s) return;
    s.route = OR.packRoute(r); s.wps = r.wps.map(w => Object.assign({}, w)); s.style = r.mode;
    save(t); OR.plan.target = null; OR.renderPlan(); OR.toast('Saved to ' + OR.dayLabel(t, tg.day)); OR.openTrip(t.id);
  };
  // "Add to trip" from the planner
  OR.addRouteToTrip = function (r) {
    const list = OR.trips.list();
    OR.sheet('<h2>Add this route to a trip</h2>' + (list.length ? '<div class="list">' + list.map(t => '<div class="li"><b>' + esc(t.name) + '</b><div class="row wrap">' +
      t.days.map((d, di) => '<button class="btn small" data-t="' + t.id + '" data-d="' + di + '">Day ' + (di + 1) + '</button>').join('') + '<button class="btn small ghost" data-t="' + t.id + '" data-d="new">New day</button></div></div>').join('') + '</div>' : '') +
      '<button class="btn wide pri" id="atNew">Start a new trip with it</button>', b => {
      $$('[data-t]', b).forEach(x => x.onclick = () => {
        const t = OR.trips.get(x.dataset.t); let di = x.dataset.d === 'new' ? t.days.push(OR.trips.blankDay()) - 1 : +x.dataset.d;
        t.days[di].steps.push({ kind: 'ride', wps: r.wps.map(w => Object.assign({}, w)), route: OR.packRoute(r), style: r.mode });
        save(t); OR.closeSheet(); OR.toast('Added to ' + OR.dayLabel(t, di)); OR.openTrip(t.id);
      });
      $('#atNew', b).onclick = () => {
        const t = OR.trips.create({ name: r.name || 'New trip' });
        t.days[0].steps.push({ kind: 'ride', wps: r.wps.map(w => Object.assign({}, w)), route: OR.packRoute(r), style: r.mode });
        save(t); OR.closeSheet(); OR.openTrip(t.id); editTrip(t);
      };
    });
  };

  // ---------- crossings ----------
  function ferrySheet(t, di, si) {
    const day = t.days[di], s = si != null ? day.steps[si] : { kind: 'ferry', crossing: '', cur: 'GBP' };
    const opts = OR.CROSSINGS.map(c => '<option value="' + c.id + '"' + (s.crossing === c.id ? ' selected' : '') + '>' + esc(c.label) + '</option>').join('');
    OR.sheet('<h2>' + (si != null ? 'Edit crossing' : 'Add a ferry or tunnel') + '</h2>' +
      '<label class="f"><span>Crossing</span><select id="fC"><option value="">Choose a crossing…</option>' + opts + '<option value="custom"' + (s.crossing === 'custom' ? ' selected' : '') + '>Another crossing</option></select></label>' +
      '<div id="fCustom"' + (s.crossing === 'custom' ? '' : ' hidden') + '>' + OR.field('fLabel', 'Name', s.crossing === 'custom' ? s.label : '', 'text', 'e.g. Rosslare to Pembroke') +
      '<div class="two"><button class="btn small ghost" id="fFrom">' + (s.crossing === 'custom' && s.from ? 'From ' + esc(s.from.name) : 'Pick departure port') + '</button><button class="btn small ghost" id="fTo">' + (s.crossing === 'custom' && s.to ? 'To ' + esc(s.to.name) : 'Pick arrival port') + '</button></div></div>' +
      OR.field('fOp', 'Operator', s.operator, 'text', '') +
      '<div class="two">' + OR.field('fDep', 'Departs', s.depart, 'time') + OR.field('fHrs', 'Crossing takes (hours)', s.hours, 'number') + '</div>' +
      '<div class="two">' + OR.field('fCost', 'Price for the group', s.cost, 'number', 'from your booking') + curSel('fCur', s.cur) + '</div>' +
      OR.field('fRef', 'Booking reference', s.ref, 'text') +
      '<p class="small muted">Crossing times are typical times. Check your booking: arrive at the port when the operator says (often 45 to 90 minutes before).</p>' +
      '<button class="btn wide pri" id="fSave">Save crossing</button>', b => {
      const sel = $('#fC', b);
      let from = s.from, to = s.to;
      sel.onchange = () => {
        $('#fCustom', b).hidden = sel.value !== 'custom';
        const c = OR.CROSSINGS.find(x => x.id === sel.value);
        if (c) { $('#fOp', b).placeholder = c.ops; if (!$('#fHrs', b).value) $('#fHrs', b).value = c.hours; }
      };
      if (sel.value && sel.value !== 'custom') sel.onchange();
      const pick = (which) => { OR.closeSheet(); if (innerWidth < 900) $('#panel').classList.remove('open'); OR.toast('Tap the port on the map, or search for it', 5000);
        OR.pickHook = p => { if (which === 'from') from = p; else to = p; s.from = from; s.to = to; s.crossing = 'custom'; s.label = $('#fLabel', b).value; ferrySheet(t, di, si != null ? si : saveStep(true)); }; };
      $('#fFrom', b).onclick = () => pick('from'); $('#fTo', b).onclick = () => pick('to');
      function saveStep(draft) {
        const c = OR.CROSSINGS.find(x => x.id === sel.value);
        s.crossing = sel.value;
        if (c) { s.label = c.label; s.from = { name: c.from[0], lng: c.from[1], lat: c.from[2] }; s.to = { name: c.to[0], lng: c.to[1], lat: c.to[2] }; }
        else if (sel.value === 'custom') { s.label = $('#fLabel', b).value.trim() || 'Crossing'; s.from = from; s.to = to; }
        s.operator = $('#fOp', b).value.trim(); s.depart = $('#fDep', b).value; s.hours = $('#fHrs', b).value; s.cost = $('#fCost', b).value; s.cur = $('#fCur', b).value; s.ref = $('#fRef', b).value.trim();
        if (si == null) { day.steps.push(s); si = day.steps.length - 1; }
        save(t); return si;
      }
      $('#fSave', b).onclick = () => {
        if (!sel.value) { OR.toast('Choose a crossing'); return; }
        if (sel.value === 'custom' && !(from && to)) { OR.toast('Pick the departure and arrival ports'); return; }
        saveStep(); OR.closeSheet(); render();
      };
    });
  }

  // ---------- hotels and costs ----------
  function findHotel(t, di) {
    const end = OR.dayEnd(t.days[di]); if (!end) return;
    OR.findNearby('stay', [end.lng, end.lat], (p, d) => {
      t.days[di].hotel = { name: p.name, phone: d.phone, web: d.web, lng: p.lng, lat: p.lat, addr: d.addr, cost: '', cur: OR.inUK(p.lng, p.lat) ? 'GBP' : 'EUR', ref: '' };
      save(t); OR.openTrip(t.id); hotelSheet(t, di);
    });
  }
  function hotelSheet(t, di) {
    const day = t.days[di], h = day.hotel || { name: '', cost: '', cur: 'GBP' };
    OR.sheet('<h2>Night ' + (di + 1) + '</h2>' + OR.field('hName', 'Where you\'re staying', h.name, 'text', 'Hotel, B&B, campsite…') +
      '<div class="two">' + OR.field('hCost', 'Price for the group', h.cost, 'number', 'from your booking') + curSel('hCur', h.cur) + '</div>' +
      OR.field('hRef', 'Booking reference', h.ref, 'text') + '<div class="two">' + OR.field('hPhone', 'Phone', h.phone, 'tel') + OR.field('hWeb', 'Website', h.web, 'url') + '</div>' +
      '<button class="btn wide pri" id="hSave">Save</button>', b => {
      $('#hSave', b).onclick = () => {
        const e = OR.dayEnd(day) || {};
        day.hotel = Object.assign({ lng: e.lng, lat: e.lat }, h, { name: $('#hName', b).value.trim() || 'Hotel', cost: $('#hCost', b).value, cur: $('#hCur', b).value, ref: $('#hRef', b).value.trim(), phone: $('#hPhone', b).value.trim(), web: $('#hWeb', b).value.trim() });
        save(t); OR.closeSheet(); render();
      };
    });
  }
  function costSheet(t, di) {
    OR.sheet('<h2>Add a cost to day ' + (di + 1) + '</h2><div class="chips">' + ['Tolls', 'Food', 'Parking', 'Fuel extra', 'Attraction', 'Breakdown cover'].map(l => '<button class="btn small ghost" data-l="' + l + '">' + l + '</button>').join('') + '</div>' +
      OR.field('cLabel', 'What for', '', 'text', 'e.g. French tolls') + '<div class="two">' + OR.field('cAmt', 'Amount', '', 'number') + curSel('cCur', 'GBP') + '</div>' +
      '<button class="btn wide pri" id="cSave">Add cost</button>', b => {
      $$('[data-l]', b).forEach(x => x.onclick = () => { $('#cLabel', b).value = x.dataset.l; $('#cAmt', b).focus(); });
      $('#cSave', b).onclick = () => {
        const amt = $('#cAmt', b).value; if (!num(amt)) { OR.toast('Enter an amount'); return; }
        (t.days[di].costs = t.days[di].costs || []).push({ label: $('#cLabel', b).value.trim() || 'Cost', amount: amt, cur: $('#cCur', b).value });
        save(t); OR.closeSheet(); render();
      };
    });
  }

  async function fuelStops(t, di, si) {
    const s = t.days[di].steps[si], r = OR.unpackRoute(s.route); r.wps = s.wps;
    OR.plan.target = null; OR.plan.options = [r]; OR.plan.choice = 0; OR.plan.route = r; OR.plan.wps = s.wps.map(w => Object.assign({}, w));
    OR.savePlan(); OR.drawWaypoints(); OR.setPlanMode('ab'); OR.showOptions(true); OR.tab('plan');
    setTimeout(() => { const b = $('#fuelChk'); if (b) b.click(); }, 50);
  }

  // ---------- weather per day ----------
  function loadWeather(t, day, di) {
    const el = $('#wx' + di); if (!el) return;
    const e = OR.dayEnd(day); if (!e) return;
    const date = OR.isoDate(OR.dayDate(t, di)), key = date + e.lng.toFixed(2) + e.lat.toFixed(2);
    const show = w => {
      if (!w) return;
      if (w.tooFar) { el.innerHTML = '<span class="muted small">Forecast from ' + w.from.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + '</span>'; return; }
      if (w.past) return;
      const c = OR.wmo(w.code);
      el.innerHTML = '<span aria-hidden="true">' + c[1] + '</span><b>' + Math.round(w.tmax) + '°</b><span class="small">' + Math.round(w.tmin) + '°, ' + Math.round(w.rainP || 0) + '% rain' + (w.gust >= 40 ? ', gusts ' + Math.round(w.gust) + ' mph' : '') + '</span>';
      el.title = c[0] + ' at ' + e.name;
    };
    if (wxCache[key] !== undefined) return show(wxCache[key]);
    if (!OR.online()) return;
    OR.dayWeather(e.lng, e.lat, date).then(w => { wxCache[key] = w; show(w); }).catch(() => { });
  }
})(window.OR);
