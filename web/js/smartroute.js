/* OpenRoad smarter routes: live fuel prices in France on fuel stops, the driest of the route options,
   and when to leave to arrive in the golden hour before sunset. */
'use strict';
(function (OR) {
  // ---------- France: live pump prices (official open data, prix-carburants) ----------
  const FR_API = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';
  OR.FUEL_GRADES = { e10: 'SP95-E10', sp95: 'SP95 (E5)', sp98: 'SP98', gazole: 'Diesel' };
  const inFrance = p => p.lng > -5.3 && p.lng < 9.7 && p.lat > 41.3 && p.lat < 51.2;
  const cache = {};
  async function near(lng, lat) {
    const k = lng.toFixed(2) + ',' + lat.toFixed(2);
    if (cache[k] && Date.now() - cache[k].t < 20 * 60000) return cache[k].list;
    const where = "within_distance(geom, geom'POINT(" + lng.toFixed(4) + ' ' + lat.toFixed(4) + ")', 12km)";
    const j = await OR.json(FR_API + '?limit=100&select=id,adresse,ville,geom,e10_prix,sp95_prix,sp98_prix,gazole_prix,e10_maj,sp95_maj,sp98_maj,gazole_maj&where=' + encodeURIComponent(where));
    const list = (j.results || []).filter(r => r.geom).map(r => ({ lng: r.geom.lon, lat: r.geom.lat, adresse: r.adresse, ville: r.ville,
      prices: { e10: r.e10_prix, sp95: r.sp95_prix, sp98: r.sp98_prix, gazole: r.gazole_prix }, maj: { e10: r.e10_maj, sp95: r.sp95_maj, sp98: r.sp98_maj, gazole: r.gazole_maj } }));
    cache[k] = { t: Date.now(), list }; return list;
  }
  // adds p.price = { eur, grade, at } to French stations in the list (matched to the official list within 250 m)
  OR.addFuelPrices = async function (stations) {
    const fr = stations.filter(inFrance); if (!fr.length) return stations;
    const grade = OR.cfg.fuelGrade || 'e10';
    const groups = {}; fr.forEach(p => { const k = (Math.round(p.lng / 0.15) * 0.15).toFixed(2) + ',' + (Math.round(p.lat / 0.15) * 0.15).toFixed(2); (groups[k] = groups[k] || []).push(p); });
    await Promise.all(Object.values(groups).slice(0, 40).map(async g => {
      const c = g.reduce((a, p) => [a[0] + p.lng / g.length, a[1] + p.lat / g.length], [0, 0]);
      let off; try { off = await near(c[0], c[1]); } catch (e) { return; }
      g.forEach(p => {
        let best = null, bd = 250;
        off.forEach(o => { const d = OR.dist([p.lng, p.lat], [o.lng, o.lat]); if (d < bd) { bd = d; best = o; } });
        if (!best) return;
        const g2 = best.prices[grade] != null ? grade : ['e10', 'sp95', 'sp98'].find(x => best.prices[x] != null);
        if (g2) p.price = { eur: best.prices[g2], grade: g2, at: best.maj[g2] };
      });
    }));
    return stations;
  };
  OR.priceLabel = p => p.price ? '€' + p.price.eur.toFixed(3) + ' ' + OR.FUEL_GRADES[p.price.grade] : '';
  OR.priceAge = at => { if (!at) return ''; const h = (Date.now() - new Date(at)) / 3600000; return h < 1 ? 'updated in the last hour' : h < 24 ? 'updated ' + Math.round(h) + ' h ago' : 'updated ' + Math.round(h / 24) + ' days ago'; };

  // ---------- the driest route ----------
  // a rain score for a route: for each hour of riding, the chance of rain times how heavy (at least a little)
  OR.rainScore = async function (route, depart) {
    const w = await OR.weatherAlong(route, depart || new Date());
    const wet = w.filter(x => (x.rainP || 0) >= 50 && (x.rain || 0) >= 0.2).length;
    const score = w.reduce((s, x) => s + (x.rainP || 0) / 100 * Math.max(0.3, x.rain || 0), 0);
    return { score, wet, maxP: Math.max(0, ...w.map(x => x.rainP || 0)), points: w.length };
  };

  // ---------- golden hour ----------
  // the hour before sunset at the destination, and when to leave to get there as it starts
  OR.goldenHour = function (route, day) {
    const end = route.shape[route.shape.length - 1], d = day || new Date();
    const s = OR.sunTimes(end[1], end[0], d); if (!s || !s.set) return null;
    const start = new Date(s.set.getTime() - 3600000);
    const ride = OR.myTime ? OR.myTime(route.time, true) : route.time;
    const leave = new Date(start.getTime() - ride * 1000);
    return { start, set: s.set, leave };
  };
})(window.OR);
