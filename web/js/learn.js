/* OpenRoad learns your bike: real fuel economy from fill-ups, your riding pace and breaks, tyre life and running costs. */
'use strict';
(function (OR) {
  const MI = 1609.344, GAL = 4.54609;

  // ---------- bike profiles (official manufacturer figures) ----------
  OR.BIKES = {
    'hd-fxlrs-2025': {
      name: 'Harley-Davidson Low Rider S (2025)', short: 'Low Rider S', tankL: 18.9, euL100: 5.5, oilL: 4.7,
      tyres: { front: 'Michelin Scorcher 31, 110/90B19', rear: 'Michelin Scorcher 31, 180/70B16' },
      facts: [['Engine', 'Milwaukee-Eight 117 High Output, 1,923 cc'], ['Fuel tank', '18.9 litres'], ['Engine oil with filter', '4.7 litres'], ['Official economy', '5.5 L/100 km (EU 134/2014 test), about 51 mpg'],
        ['Weight in running order', '304 kg'], ['Seat height', '715 mm'], ['Tyres', 'Michelin Scorcher 31: 110/90B19 front, 180/70B16 rear'], ['Final drive', 'Belt']],
      pressureNote: 'Harley prints the cold tyre pressures on the label on the frame and in the owner\'s manual: enter them in Maintenance, Tyres.',
      // Harley-Davidson regular service intervals for Softail models (first service at 1,000 miles)
      service: [['Engine oil and filter', 5000, 12], ['Primary chaincase lubricant', 10000, 0], ['Transmission lubricant', 20000, 0], ['Air cleaner (inspect, service)', 5000, 0],
        ['Spark plugs', 30000, 24], ['Brake and clutch fluid (DOT 4)', 0, 24], ['Tyres and pressures (inspect)', 5000, 12], ['Drive belt and sprockets (inspect, adjust)', 5000, 0],
        ['Battery (test, clean connections)', 0, 12], ['Steering head bearings (lubricate)', 10000, 0], ['Front forks (rebuild, new oil)', 50000, 0], ['Fuel filter', 100000, 0]],
      sources: ['https://www.harley-davidson.com/aa/en/motorcycles/2025/low-rider-s.html', 'https://serviceinfo.harley-davidson.com/sip/service/procedure/2189739583583989456/BLAISE/498834/en_US?nid=6695']
    }
  };
  OR.applyBike = function (id) {
    const b = OR.BIKES[id]; if (!b) return;
    const c = OR.cfg.bike; c.profile = id; c.name = b.short; c.tankL = b.tankL; if (!c.mpg) c.mpg = Math.round(100 / b.euL100 * GAL / 1.609344 * 10) / 10;
    OR.saveCfg();
    const m = OR.maint.get(), old = m.items;
    m.items = b.service.map(([name, miles, months]) => {
      const prev = old.find(o => o.name.split(' ')[0] === name.split(' ')[0] && o.name.split(' ')[1] === name.split(' ')[1]);
      return { id: OR.uid(), name, miles, months, lastMiles: prev ? prev.lastMiles : '', lastDate: prev ? prev.lastDate : '' };
    });
    ['front', 'rear'].forEach(w => { m.tyres[w] = m.tyres[w] || {}; if (!m.tyres[w].model) m.tyres[w].model = b.tyres[w]; });
    OR.maint.save(m);
  };

  // ---------- fuel: fill-ups ----------
  OR.fuelLog = { list: () => OR.store.get('fuelLog', []), save: l => OR.store.set('fuelLog', l) };
  // Each full-to-full stretch gives a real mpg. The riding style comes from the rides in that stretch.
  const styleOf = mph => mph < 33 ? 'slow' : mph < 52 ? 'mixed' : 'fast';
  OR.STYLE_NAMES = { slow: 'Towns and twisties', mixed: 'Mixed A and B roads', fast: 'Fast roads and motorways' };
  OR.fuelStretches = function () {
    const fills = OR.fuelLog.list().slice().sort((a, b) => a.t - b.t), rides = OR.rides.list();
    const out = []; let lastFull = null, litres = 0, cost = 0;
    for (const f of fills) {
      if (lastFull) { litres += +f.litres || 0; cost += (+f.litres || 0) * (+f.price || 0); }
      if (f.full) {
        if (lastFull) {
          const rs = rides.filter(r => r.start > lastFull.t && r.start <= f.t);
          let miles = f.odo && lastFull.odo ? f.odo - lastFull.odo : rs.reduce((s, r) => s + r.dist, 0) / MI;
          const moving = rs.reduce((s, r) => s + (r.moving || 0), 0), rd = rs.reduce((s, r) => s + r.dist, 0);
          if (miles > 20 && litres > 1) out.push({ from: lastFull.t, to: f.t, miles, litres, mpg: miles / (litres / GAL), cost, style: moving > 0 ? styleOf(rd / MI / (moving / 3600)) : 'mixed' });
        }
        lastFull = f; litres = 0; cost = 0;
      }
    }
    return out;
  };
  OR.learnedMpg = function (style) {
    const st = OR.fuelStretches().slice(-12), use = style ? st.filter(s => s.style === style) : st;
    if (!use.length) return null;
    const mi = use.reduce((s, x) => s + x.miles, 0), L = use.reduce((s, x) => s + x.litres, 0);
    return { mpg: mi / (L / GAL), n: use.length, miles: mi };
  };
  // the mpg OpenRoad uses: learned from your fill-ups when it can, otherwise what you entered
  OR.mpg = function (style) {
    const l = (style && OR.learnedMpg(style)) || OR.learnedMpg();
    if (l && l.n >= 1) return l.mpg;
    const v = parseFloat(OR.cfg.bike.mpg); return v > 0 ? v : null;
  };
  // which mpg suits a route, from how fast it is
  OR.routeStyle = r => styleOf(r.dist / MI / (r.time / 3600));
  OR.mpgForRoute = r => OR.mpg(OR.routeStyle(r));

  // ---------- your pace and breaks ----------
  // Every ride on a planned route compares your moving time with the planner's estimate for the same stretch.
  OR.pace = function () {
    const rs = OR.rides.list().filter(r => r.pred > 300 && r.moving > 300).slice(0, 15);
    if (rs.length < 2) return null;
    const pred = rs.reduce((s, r) => s + r.pred, 0), act = rs.reduce((s, r) => s + r.moving, 0);
    const f = act / pred; return { factor: Math.min(1.6, Math.max(0.7, f)), n: rs.length };
  };
  OR.breaks = function () {
    const rs = OR.rides.list().filter(r => r.end && r.moving > 1800).slice(0, 20);
    if (rs.length < 2) return null;
    const stopped = rs.reduce((s, r) => s + Math.max(0, (r.end - r.start) / 1000 - r.moving), 0), moving = rs.reduce((s, r) => s + r.moving, 0);
    return { perHour: stopped / (moving / 3600), n: rs.length }; // seconds stopped per hour of riding
  };
  // a planner time adjusted to how you actually ride, with or without your usual breaks
  OR.myTime = function (sec, withBreaks) {
    const p = OR.pace(), b = OR.breaks();
    let t = sec * (p ? p.factor : 1);
    if (withBreaks && b) t += (t / 3600) * b.perHour;
    return t;
  };

  // ---------- wear and running costs ----------
  OR.monthlyMiles = function () {
    const rs = OR.rides.list(); if (rs.length < 3) return null;
    const first = Math.min.apply(null, rs.map(r => r.start)), span = Math.max(30, (Date.now() - first) / 864e5);
    return rs.reduce((s, r) => s + r.dist, 0) / MI / span * 30.44;
  };
  OR.tyreLife = function (w) {
    const h = (OR.maint.get().tyreHistory || []).filter(x => x.w === w && x.miles > 500);
    if (!h.length) return null;
    return { miles: h.reduce((s, x) => s + x.miles, 0) / h.length, n: h.length };
  };
  // tread wear per 1,000 miles from the tread log of the current tyre, and when it reaches 2 mm
  OR.treadForecast = function (w) {
    const m = OR.maint.get(), t = m.tyres[w] || {}, log = (t.tread || []).filter(x => x.odo != null).slice().sort((a, b) => a.odo - b.odo);
    if (log.length < 2) return null;
    const a = log[0], b = log[log.length - 1]; if (b.odo - a.odo < 300) return null;
    const rate = (parseFloat(a.mm) - parseFloat(b.mm)) / ((b.odo - a.odo) / 1000); if (!(rate > 0)) return null;
    const milesTo2 = (parseFloat(b.mm) - 2) / rate * 1000, mm = OR.monthlyMiles();
    return { rate, milesTo2: Math.max(0, milesTo2), months: mm ? Math.max(0, milesTo2) / mm : null };
  };
  OR.runningCosts = function () {
    const yearAgo = Date.now() - 365 * 864e5, m = OR.maint.get();
    const fuel = OR.fuelLog.list().filter(f => f.t > yearAgo).reduce((s, f) => s + (+f.litres || 0) * (+f.price || 0), 0);
    const work = (m.log || []).filter(l => new Date(l.date) > yearAgo).reduce((s, l) => s + (parseFloat(l.cost) || 0), 0);
    const miles = OR.rides.list().filter(r => r.start > yearAgo).reduce((s, r) => s + r.dist, 0) / MI;
    return { fuel, work, miles, perMile: miles > 50 ? (fuel + work) / miles : null };
  };
  // when a service due by miles is likely to come round, at your usual mileage
  OR.dueWhen = function (milesLeft) {
    const mm = OR.monthlyMiles(); if (!mm || milesLeft <= 0) return null;
    return new Date(Date.now() + milesLeft / mm * 30.44 * 864e5);
  };
})(window.OR);
