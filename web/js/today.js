/* OpenRoad Today: the first thing on the Plan screen. Should I ride today, when, and where?
   The hourly forecast where you are (Open-Meteo) gives the riding window: daylight hours that are dry, above 4°
   and without strong gusts. A twisty round trip from home (or from where you are, when you're away) is planned to
   fit that window, once a day, ready to ride with one tap. The same answer goes to the home-screen widget. */
'use strict';
(function (OR) {
  const $ = OR.$, $$ = OR.$$, esc = OR.esc, A = OR.native, ic = (n, c) => OR.ic(n, c);
  const METEO = 'https://api.open-meteo.com/v1/forecast', H = 3600000;
  const st = { wx: OR.store.get('todayWx', null), loop: OR.store.get('todayLoop', null), busy: false, planning: false, err: '', loopErr: '' };

  // ---------- where from ----------
  // home, unless you're more than 25 km from it (touring): then from where you are
  OR.todayFrom = function () {
    const h = OR.cfg.home, p = OR.pos;
    if (h && h.lat != null && (!p || OR.dist([p.lng, p.lat], [h.lng, h.lat]) < 25000)) return { lng: h.lng, lat: h.lat, name: 'home', home: true };
    if (p) return { lng: p.lng, lat: p.lat, name: 'here' };
    return null;
  };
  const dayKey = t => { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  const placeKey = (f, step) => Math.round(f.lat / step) + ',' + Math.round(f.lng / step);

  // ---------- the forecast and the riding window ----------
  async function fetchWx(f) {
    const q = '?latitude=' + f.lat.toFixed(3) + '&longitude=' + f.lng.toFixed(3) +
      '&hourly=temperature_2m,precipitation_probability,precipitation,wind_gusts_10m,weather_code&wind_speed_unit=mph&timeformat=unixtime&forecast_days=3';
    const j = await OR.json(METEO + q), h = j.hourly;
    if (!h || !h.time) throw new Error('no forecast');
    return { at: Date.now(), key: placeKey(f, 0.05), lat: f.lat, lng: f.lng,
      // Open-Meteo's rain figures are for the hour before each time, so each entry is the hour that ends then
      hours: h.time.map((t, i) => ({ t: t * 1000 - H, temp: h.temperature_2m[i], p: h.precipitation_probability[i] || 0, mm: h.precipitation[i] || 0, gust: h.wind_gusts_10m[i] || 0, code: h.weather_code[i] })) };
  }
  // why an hour isn't good for riding ('' if it is)
  function why(x, lat, lng) {
    const s = OR.sunTimes(lat, lng, new Date(x.t));
    if (s && (x.t + 30 * 60000 < s.rise.getTime() || x.t + 30 * 60000 > s.set.getTime())) return 'dark';
    if (x.code >= 95) return 'storms';
    if (x.p >= 40 || x.mm >= 0.3) return 'rain';
    if (x.gust >= 40) return 'wind';
    if (x.temp < 4) return 'cold';
    return '';
  }
  OR.rideWindow = function (wx, now) {
    now = now || Date.now();
    const h0 = Math.floor(now / H) * H, hrs = wx.hours.filter(x => x.t >= h0 && x.t < h0 + 40 * H).map(x => Object.assign({}, x, { bad: why(x, wx.lat, wx.lng) }));
    // runs of good hours; the first of two hours or more, else the first single hour
    const runs = []; let cur = null;
    hrs.forEach((x, i) => { if (x.bad) { cur = null; return; } if (!cur) runs.push(cur = { a: i, b: i + 1 }); else cur.b = i + 1; });
    const run = runs.find(x => x.b - x.a >= 2) || runs[0];
    const win = run ? { from: Math.max(now, hrs[run.a].t), to: hrs[run.b - 1].t + H, hours: hrs.slice(run.a, run.b) } : null;
    if (win) { const s = OR.sunTimes(wx.lat, wx.lng, new Date(win.to - H)); if (s && win.to > s.set.getTime()) win.to = s.set.getTime(); win.sunset = !!(s && win.to >= s.set.getTime() - 60000); }
    // what spoils the rest of today, for the words
    const today = hrs.filter(x => dayKey(x.t) === dayKey(now) && x.bad && x.bad !== 'dark');
    const count = {}; today.forEach(x => count[x.bad] = (count[x.bad] || 0) + 1);
    const spoiler = Object.keys(count).sort((a, b) => count[b] - count[a])[0] || '';
    return { hrs, win, spoiler };
  };
  const NAMES = { rain: 'rain', storms: 'thunderstorms', wind: 'strong gusts', cold: 'cold, below 4°', dark: 'dark' };
  // the headline, the line under it, and a tone: good, wait, bad
  OR.todayVerdict = function (wx, now) {
    now = now || Date.now();
    const r = OR.rideWindow(wx, now), w = r.win, hh = t => OR.clock(new Date(t));
    if (!w) return { tone: 'bad', head: 'Not a riding day', sub: 'The next day and a half look ' + (NAMES[r.spoiler] ? 'poor: ' + NAMES[r.spoiler] : 'poor') + '.', r };
    const temps = w.hours.map(x => x.temp), lo = Math.round(Math.min.apply(null, temps)), hi = Math.round(Math.max.apply(null, temps));
    const t = lo === hi ? lo + '°' : lo + '–' + hi + '°', gust = Math.max.apply(null, w.hours.map(x => x.gust));
    const windy = gust >= 30 ? ', gusts to ' + Math.round(gust) + ' mph' : ', light winds';
    const len = (w.to - w.from) / H, until = w.sunset ? 'until sunset at ' + hh(w.to) : 'until ' + hh(w.to);
    const startsNow = w.from <= now + 15 * 60000, sameDay = dayKey(w.from) === dayKey(now);
    const after = !w.sunset && r.hrs.find(x => x.t >= w.to && x.bad) ? ', then ' + (NAMES[r.hrs.find(x => x.t >= w.to && x.bad).bad] || 'worse') : '';
    if (startsNow && len >= 3.5) return { tone: 'good', head: 'Great day for a ride', sub: 'Dry ' + until + after + '. ' + t + windy + '.', r };
    if (startsNow) return { tone: 'good', head: 'Ride now', sub: 'Dry ' + until + after + '. ' + t + windy + '.', r };
    if (sameDay) return { tone: 'wait', head: 'Ride from ' + hh(w.from), sub: 'Dry from then ' + until + '. ' + t + windy + '.', r };
    const now0 = r.hrs[0], dark = now0 && now0.bad === 'dark';
    return { tone: 'wait', head: 'Tomorrow looks better', sub: (dark ? 'It\'s dark now. ' : '') + 'Dry from ' + hh(w.from) + ' ' + until + '. ' + t + windy + '.', r };
  };

  // ---------- the loop ----------
  function pace() {
    const rides = OR.rides.list().filter(r => r.moving > 1800).slice(0, 20);
    return rides.length >= 2 ? rides.reduce((s, r) => s + r.dist, 0) / rides.reduce((s, r) => s + r.moving, 0) / OR.MI * 3600 : 32;
  }
  // riding hours that fit the window, between 1 and 4
  function loopHours(v) {
    const w = v.r.win; if (!w) return 2;
    return Math.max(1, Math.min(4, (w.to - Math.max(Date.now(), w.from)) / H * 0.8));
  }
  async function planLoop(f, v, fresh) {
    if (st.planning) return; st.planning = true; st.loopErr = ''; draw();
    try {
      const hrs = loopHours(v), miles = Math.round(Math.max(25, Math.min(220, hrs * pace() * 0.9)) / 5) * 5;
      const opts = await OR.roundTrip([f.lng, f.lat], miles, 'any');
      const name = f.home ? 'home' : 'here';
      opts.forEach(o => { o.name = 'Today\'s loop from ' + name; o.wps[0].name = f.home ? 'Home' : 'Start'; o.wps[o.wps.length - 1].name = f.home ? 'Home' : 'Back to start'; });
      st.loop = { day: dayKey(Date.now()), key: placeKey(f, 0.02), from: f, opts: opts.slice(0, 3), at: Date.now() };
      OR.store.set('todayLoop', st.loop);
      if (fresh) OR.toast('A new loop: ' + Math.round(opts[0].dist / OR.MI) + ' miles');
    } catch (e) { st.loopErr = e.message || 'Couldn\'t plan a loop'; }
    st.planning = false; draw(); toWidget();
  }
  const loopOk = f => st.loop && st.loop.day === dayKey(Date.now()) && f && st.loop.key === placeKey(f, 0.02) && st.loop.opts && st.loop.opts.length;
  OR.todayLoop = () => { const f = OR.todayFrom(); return loopOk(f) ? st.loop.opts[0] : null; };

  // ---------- refresh ----------
  OR.todayRefresh = async function (force) {
    const f = OR.todayFrom(); if (!f) { draw(); return; }
    const stale = !st.wx || st.wx.key !== placeKey(f, 0.05) || Date.now() - st.wx.at > 45 * 60000;
    if ((stale || force) && !st.busy && OR.online()) {
      st.busy = true; st.err = ''; draw();
      try { st.wx = await fetchWx(f); OR.store.set('todayWx', st.wx); } catch (e) { st.err = 'Couldn\'t get the forecast' + (OR.online() ? '' : ': no signal'); }
      st.busy = false;
    }
    draw(); toWidget();
    // once a day (and when you move somewhere new), plan the loop, if there's a riding window
    if (st.wx && !loopOk(f) && !st.planning && OR.online() && OR.cfg.todayLoop !== false) { const v = OR.todayVerdict(st.wx); if (v.r.win) planLoop(f, v); }
  };

  // ---------- the card ----------
  function bars(v) {
    const hrs = v.r.hrs.slice(0, 14);
    return '<div class="tdhrs" aria-hidden="true">' + hrs.map(x => {
      const c = OR.wmo(x.code);
      return '<div class="tdh ' + (x.bad === 'dark' ? 'dark' : x.bad ? 'bad' : 'ok') + '"><span>' + String(new Date(x.t).getHours()).padStart(2, '0') + '</span><i>' + c[1] + '</i><b>' + Math.round(x.temp) + '°</b></div>';
    }).join('') + '</div>';
  }
  function loopHtml(f, v) {
    if (OR.cfg.todayLoop === false) return '';
    if (st.planning) return '<div class="tdloop"><span class="spin" aria-hidden="true"></span><span>Planning a twisty loop from ' + esc(f.name) + ' to fit…</span></div>';
    if (loopOk(f)) {
      const o = st.loop.opts[0], ride = OR.myTime ? OR.myTime(o.time, true) : o.time;
      const back = v.r.win && v.r.win.from > Date.now() ? '' : ', back about ' + OR.clock(new Date(Date.now() + ride * 1000));
      return '<div class="tdloop ready"><div class="tdl-t">' + ic('twisty') + '<span><b>Your loop is ready</b><small>' + OR.fmtDist(o.dist) + ', ' + OR.fmtTime(ride) + back + '. ' + esc(OR.bendLabel ? OR.bendLabel(o.twist) : '') + '</small></span></div>' +
        (o.roads && o.roads.length ? '<span class="refs">' + o.roads.slice(0, 6).map(OR.refChip).join('') + '</span>' : '') +
        '<div class="tdl-b"><button class="btn go" id="tdRide">' + ic('rides') + 'Ride it</button><button class="btn" id="tdSee">' + ic('map') + 'See it</button><button class="btn ghost" id="tdNew" aria-label="Plan a different loop">' + ic('loop') + 'Another</button></div></div>';
    }
    if (st.loopErr) return '<div class="tdloop"><span class="small">' + esc(st.loopErr) + '</span><button class="btn small" id="tdNew">Try again</button></div>';
    if (v.r.win || !st.wx) return OR.online() ? '<div class="tdloop"><button class="btn wide" id="tdNew">' + ic('twisty') + 'Plan a loop for today</button></div>' : '';
    return '<div class="tdloop"><button class="btn small ghost" id="tdNew">Plan a loop anyway</button></div>';
  }
  function cardHtml() {
    const f = OR.todayFrom();
    if (!f) return '<div class="today none"><div class="td-top">' + ic('hills') + '<span><b>Today</b><small>Waiting for your position to say whether it\'s a riding day…</small></span></div>' +
      '<button class="btn small" id="tdHome">Set my home</button></div>';
    if (!st.wx) return '<div class="today none"><div class="td-top">' + ic('cloud') + '<span><b>Today</b><small>' + (st.busy ? 'Getting the forecast…' : esc(st.err || (OR.online() ? 'Getting the forecast…' : 'The forecast needs a signal'))) + '</small></span></div></div>';
    const v = OR.todayVerdict(st.wx), old = Date.now() - st.wx.at > 3 * H;
    return '<div class="today ' + v.tone + '"><div class="td-top"><span class="td-mark" aria-hidden="true">' + ic(v.tone === 'bad' ? 'warn' : v.tone === 'wait' ? 'time' : 'sun') + '</span>' +
      '<span><b>' + esc(v.head) + '</b><small>' + esc(v.sub) + '</small></span>' +
      '<button class="icon td-re" id="tdRe" aria-label="Refresh the forecast">' + ic('update') + '</button></div>' + bars(v) +
      '<p class="td-from small muted">Forecast for ' + (f.home ? 'home' : 'where you are') + (old ? ', from ' + OR.clock(new Date(st.wx.at)) : '') + '. Open-Meteo.</p>' + loopHtml(f, v) + '</div>';
  }
  OR.todayHtml = () => OR.cfg.today === false ? '' : '<div id="today">' + cardHtml() + '</div>';
  function draw() { const el = $('#today'); if (!el) return; el.innerHTML = cardHtml(); bind(el); }
  OR.bindToday = function (v) { const el = $('#today', v); if (el) bind(el); };
  function bind(el) {
    const on = (id, fn) => { const b = $('#' + id, el); if (b) b.onclick = fn; };
    on('tdRe', () => OR.todayRefresh(true));
    on('tdHome', () => OR.openSetup ? OR.openSetup('home') : null);
    on('tdRide', () => { const o = OR.todayLoop(); if (o) OR.startRideUi(o); });
    on('tdSee', () => { if (loopOk(OR.todayFrom()) && OR.useLoop) OR.useLoop(st.loop.opts, st.loop.from); });
    on('tdNew', () => { const f = OR.todayFrom(); if (f) planLoop(f, st.wx ? OR.todayVerdict(st.wx) : { r: {} }, true); });
  }

  // ---------- the home-screen widget (Android) ----------
  function toWidget() {
    if (!A || !A.widgetUpdate || !st.wx) return;
    const f = OR.todayFrom(); if (!f) return;
    const v = OR.todayVerdict(st.wx), o = loopOk(f) ? st.loop.opts[0] : null;
    try { A.widgetUpdate(JSON.stringify({ head: v.head, sub: v.sub, tone: v.tone, at: Date.now(), lat: f.lat, lng: f.lng, units: OR.cfg.units,
      loop: o ? OR.fmtDist(o.dist) + ' twisty loop ready' : '', loopAt: o ? st.loop.at : 0 })); } catch (e) { }
  }
  // the widget's buttons open the app with what to do
  window.onWidgetAction = function (a) {
    const go = () => {
      if (a === 'record') { if (!OR.ride.on) { OR.startRideUi(null); OR.toast('Recording your ride'); } return; }
      if (a === 'loop') {
        if (OR.ride.on) return;
        const o = OR.todayLoop(); if (o) { OR.startRideUi(o); return; }
        OR.tab('plan'); OR.toast('Planning today\'s loop…');
        const plan = () => { const f = OR.todayFrom(); if (f) planLoop(f, st.wx ? OR.todayVerdict(st.wx) : { r: {} }); return !!f; };
        if (!plan()) { let done = false; OR.on('fix', () => { if (!done) { done = true; plan(); } }); }
      }
    };
    if (OR.map && OR.startRideUi) go(); else setTimeout(go, 1500);
  };

  // ---------- when ----------
  let first = true;
  OR.on('fix', () => { if (first) { first = false; setTimeout(() => OR.todayRefresh(), 300); } });
  setTimeout(() => { if (first && OR.cfg.home) { first = false; OR.todayRefresh(); } else draw(); }, 2500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !first) OR.todayRefresh(); });
  OR.on('tab', t => { if (t === 'plan' && !first) setTimeout(() => OR.todayRefresh(), 50); });
})(window.OR);
