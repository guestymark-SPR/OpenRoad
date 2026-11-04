/* OpenRoad rain dodger: while you ride a planned route, the forecast along the rest of it is checked every
   15 minutes. If heavy rain is coming, it says so and offers a drier way round, or a café to wait it out. */
'use strict';
(function (OR) {
  const METEO = 'https://api.open-meteo.com/v1/forecast';
  const $ = s => document.querySelector(s), esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let timer = 0, lastPrompt = 0, lastZone = null, busy = false;

  OR.rainDodgeOn = () => OR.cfg.rainDodge !== false;
  // heavy enough to be worth riding round: likely, and at least moderate rain (or a storm)
  const heavy = h => h && ((h.p >= 60 && h.mm >= 1) || h.code >= 95 || (h.code >= 63 && h.code <= 67 && h.p >= 50) || (h.code >= 81 && h.code <= 82 && h.p >= 50));

  // points every ~10 km along what's left of the route (up to 2 hours ahead), with the time you'd reach each
  function ahead(route, along) {
    const speed = route.dist / Math.max(60, route.time); // m/s on this route's own timing
    const pts = [];
    for (let d = along + 5000; d < route.dist && pts.length < 14; d += 10000) {
      const t = (d - along) / speed; if (t > 7200) break;
      pts.push({ d, t: Date.now() + t * 1000, p: nearest(route, d) });
    }
    return pts;
  }
  function nearest(route, d) { let i = 0; while (i < route.cum.length - 1 && route.cum[i] < d) i++; return route.shape[i]; }

  async function forecast(pts) {
    const q = '?latitude=' + pts.map(x => x.p[1].toFixed(3)).join(',') + '&longitude=' + pts.map(x => x.p[0].toFixed(3)).join(',') +
      '&hourly=precipitation_probability,precipitation,weather_code&timeformat=unixtime&forecast_days=2';
    let j = await OR.json(METEO + q, { timeout: 20000 }); if (!Array.isArray(j)) j = [j];
    return pts.map((x, i) => {
      const h = j[i] && j[i].hourly; if (!h) return null;
      const at = k => ({ p: h.precipitation_probability[k], mm: h.precipitation[k], code: h.weather_code[k], t: h.time[k] * 1000 });
      let k = 0, best = 1e15; h.time.forEach((tt, n) => { const d = Math.abs(tt * 1000 - x.t); if (d < best) { best = d; k = n; } });
      // when it's dry again at that spot
      let clear = null; for (let n = k + 1; n < h.time.length && n < k + 8; n++) if (!heavy(at(n)) && (h.precipitation[n] || 0) < 0.3) { clear = h.time[n] * 1000; break; }
      return Object.assign(x, { wx: at(k), clear });
    }).filter(Boolean);
  }

  // a score for how wet the rest of a route is (as smartroute's rainScore, from a list of points)
  const wetScore = list => list.reduce((s, x) => s + (x.wx.p || 0) / 100 * Math.max(0.3, x.wx.mm || 0), 0);

  async function check(force) {
    const ride = OR.ride, r = ride && ride.route;
    if (busy || !ride || !ride.on || !r || r.free || !OR.rainDodgeOn() || !OR.online() || !OR.pos) return;
    if (!force && Date.now() - lastPrompt < 30 * 60000) return;
    busy = true;
    try {
      const pts = ahead(r, ride.along); if (pts.length < 2) return;
      const wx = await forecast(pts);
      const wet = wx.find(x => heavy(x.wx)); if (!wet) { if (force) OR.toast('No heavy rain on the route in the next 2 hours'); return; }
      // the same wet patch we already told you about: don't keep repeating it
      if (!force && lastZone && OR.dist(lastZone, wet.p) < 15000 && Date.now() - lastPrompt < 45 * 60000) return;
      const miles = OR.fmtDist(wet.d - ride.along), mins = Math.max(1, Math.round((wet.t - Date.now()) / 60000));
      const what = wet.wx.code >= 95 ? 'Thunderstorms' : 'Heavy rain';
      // look for a drier way to the same stops
      let drier = null;
      try {
        const rest = OR.remainingStops ? OR.remainingStops(r, ride.along) : [r.wps[r.wps.length - 1]];
        const wps = [{ lng: OR.pos.lng, lat: OR.pos.lat, name: 'Here', type: 'break' }].concat(rest);
        const opts = await OR.planOptions(wps, OR.STYLES[r.mode] ? r.mode : 'twisty');
        const base = wetScore(wx);
        for (const o of opts) {
          const ow = await forecast(ahead(o, 0)).catch(() => null); if (!ow) continue;
          const sc = wetScore(ow), stillWet = ow.some(x => heavy(x.wx));
          if (!stillWet && sc < base * 0.6 && (!drier || sc < drier.score)) drier = { route: o, score: sc, extra: o.time - OR.timeLeftOn(r, ride.along) };
        }
      } catch (e) { }
      // a café near you to wait it out, if the rain passes within a couple of hours
      let cafe = null;
      if (wet.clear && wet.clear - Date.now() < 3 * 3600e3) {
        try { const list = await OR.nearby('cafe', OR.pos.lng, OR.pos.lat, 6000); cafe = list && list[0]; } catch (e) { }
      }
      lastPrompt = Date.now(); lastZone = wet.p;
      const clearAt = wet.clear ? OR.clock(new Date(wet.clear)) : '';
      const line = what + ' on the route in about ' + miles + (mins < 90 ? ', ' + mins + ' minutes away' : '') + '.' +
        (drier ? ' A drier way is ' + (drier.extra > 90 ? Math.round(drier.extra / 60) + ' minutes longer' : 'about the same time') + '.' : '') +
        (clearAt ? ' It should clear there by ' + clearAt + '.' : '');
      OR.say(line.replace(miles, OR.spokenDist(wet.d - ride.along)));
      prompt(line, drier, cafe);
    } catch (e) { if (force) OR.toast('Could not check the weather ahead: ' + e.message, 5000); }
    finally { busy = false; }
  }
  OR.rainCheck = () => check(true);

  function prompt(line, drier, cafe) {
    OR.sheet('<h2>' + OR.ic('cloud') + 'Rain ahead</h2><p>' + esc(line) + '</p><div class="bigbtns">' +
      (drier ? '<button class="btn go" id="rdDry">' + OR.ic('loop') + 'Take the drier way</button>' : '') +
      (cafe ? '<button class="btn wide" id="rdCafe">' + OR.ic('cup') + 'Wait it out: ' + esc(cafe.name || 'café') + ', ' + OR.fmtDist(cafe.d) + '</button>' : '') +
      '<button class="btn wide ghost" id="rdOn">Carry on</button></div>', b => {
      const d = b.querySelector('#rdDry'); if (d) d.onclick = () => { OR.closeSheet(); OR.swapRoute(Object.assign(drier.route, { name: OR.ride.route.name, variant: 'Drier way' }), 'Taking the drier way.'); };
      const c = b.querySelector('#rdCafe'); if (c) c.onclick = () => {
        OR.closeSheet();
        const r = OR.ride.route, rest = OR.remainingStops ? OR.remainingStops(r, OR.ride.along) : [r.wps[r.wps.length - 1]];
        OR.planWaypoints([{ lng: OR.pos.lng, lat: OR.pos.lat, name: 'Here', type: 'break' }, { lng: cafe.lng, lat: cafe.lat, name: cafe.name || 'Café', type: 'break' }].concat(rest), r.mode)
          .then(nr => OR.swapRoute(Object.assign(nr, { name: r.name }), 'Heading to ' + (cafe.name || 'the café') + ' to wait out the rain.')).catch(e => OR.toast('Could not plan: ' + e.message));
      };
      b.querySelector('#rdOn').onclick = () => OR.closeSheet();
    });
  }

  OR.on('ridestart', () => { clearInterval(timer); lastPrompt = 0; lastZone = null; setTimeout(() => check(), 2 * 60000); timer = setInterval(() => check(), 15 * 60000); });
  OR.on('ridestop', () => clearInterval(timer));
})(window.OR);
