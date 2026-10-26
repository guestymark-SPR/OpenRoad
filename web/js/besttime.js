/* OpenRoad best time to ride: the hourly forecast along a route, tried for every departure time in the next
   12 hours, to find when you'd stay driest and warmest (and finish in daylight). */
'use strict';
(function (OR) {
  const METEO = 'https://api.open-meteo.com/v1/forecast';
  OR.bestTime = async function (route) {
    // up to 12 places along the route, each with its share of the riding time
    const n = Math.min(12, Math.max(3, Math.round(route.dist / 25000))), pts = [];
    for (let i = 0; i <= n; i++) { const f = i / n, a = route.dist * f; let k = 0; while (k < route.cum.length - 1 && route.cum[k] < a) k++; pts.push({ p: route.shape[k], f }); }
    const q = '?latitude=' + pts.map(x => x.p[1].toFixed(3)).join(',') + '&longitude=' + pts.map(x => x.p[0].toFixed(3)).join(',') +
      '&hourly=temperature_2m,precipitation_probability,precipitation,wind_gusts_10m&wind_speed_unit=mph&timeformat=unixtime&forecast_days=2';
    let j = await OR.json(METEO + q); if (!Array.isArray(j)) j = [j];
    const ride = OR.myTime ? OR.myTime(route.time, true) : route.time;
    const at = (h, t) => { let k = 0, best = 1e15; h.time.forEach((tt, m) => { const d = Math.abs(tt * 1000 - t); if (d < best) { best = d; k = m; } }); return k; };
    const start = new Date(); start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
    const tries = [];
    for (let s = 0; s <= 12 * 4; s++) {
      const dep = start.getTime() + s * 900000;
      let score = 0, wet = 0, tmin = 99, tmax = -99, gmax = 0, dark = false;
      pts.forEach((x, i) => {
        const h = j[i] && j[i].hourly; if (!h) return;
        const t = dep + ride * x.f * 1000, k = at(h, t);
        const p = h.precipitation_probability[k] || 0, mm = h.precipitation[k] || 0, temp = h.temperature_2m[k], g = h.wind_gusts_10m[k] || 0;
        const sun = OR.sunTimes(x.p[1], x.p[0], new Date(t)); const isDark = sun && (t > sun.set.getTime() + 15 * 60000 || t < sun.rise.getTime());
        score += p / 100 * Math.max(0.2, mm) * 3 + Math.max(0, 10 - temp) * 0.12 + Math.max(0, g - 35) * 0.05 + (isDark ? 1.5 : 0);
        wet = Math.max(wet, p); tmin = Math.min(tmin, temp); tmax = Math.max(tmax, temp); gmax = Math.max(gmax, g); dark = dark || isDark;
      });
      tries.push({ dep, score: score / pts.length, wet, tmin, tmax, gmax, dark });
    }
    const best = tries.reduce((b, x) => x.score < b.score ? x : b, tries[0]);
    // the window: neighbouring start times almost as good as the best
    const ok = x => x.score <= best.score + Math.max(0.12, best.score * 0.15);
    let i0 = tries.indexOf(best), i1 = i0; while (i0 > 0 && ok(tries[i0 - 1])) i0--; while (i1 < tries.length - 1 && ok(tries[i1 + 1])) i1++;
    const now = tries[0], later = tries.find(x => x.dep > tries[i1].dep && x.wet >= 50);
    return { best, from: tries[i0].dep, to: tries[i1].dep, now, laterWet: later ? later.dep : null, ride, tries };
  };
  OR.describeWeather = x => (x.wet < 20 ? 'dry' : x.wet < 50 ? 'a small chance of showers' : 'showers likely') + ', ' + Math.round(x.tmin) + (Math.round(x.tmax) !== Math.round(x.tmin) ? '–' + Math.round(x.tmax) : '') + '°' + (x.gmax >= 35 ? ', gusts to ' + Math.round(x.gmax) + ' mph' : '') + (x.dark ? ', part in the dark' : '');
})(window.OR);
