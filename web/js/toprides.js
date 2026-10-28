/* OpenRoad top rides: the best biking roads near a place, to add to your route or a trip day.
   From OpenStreetMap: A and B roads (primary, secondary and tertiary) within about 15 km, joined into whole roads by
   their number or name, and ranked by how much they bend per mile and how long they are. Motorways, dual carriageways,
   town streets and lanes are left out. */
'use strict';
(function (OR) {
  const $ = OR.$, $$ = OR.$$, esc = OR.esc, ic = (n, c) => OR.ic(n, c), MI = 1609.344;
  const cache = {};

  function twistOf(pts) {
    const p = OR.resample(pts, 40); let len = 0, turn = 0;
    for (let i = 1; i < p.length; i++) { len += OR.dist(p[i - 1], p[i]); if (i > 1) { const d = OR.angDiff(OR.bearing(p[i - 2], p[i - 1]), OR.bearing(p[i - 1], p[i])); if (d < 75) turn += d; } } // over 75° is a junction, not a bend
    return { len, twist: len ? Math.round(turn / (len / MI)) : 0 };
  }
  // ways that carry on from each other (same number or name, sharing an end) joined into one road
  function chains(ways) {
    const byKey = {};
    ways.forEach(w => { const k = w.ref || w.name; (byKey[k] = byKey[k] || []).push(w); });
    const out = [];
    Object.entries(byKey).forEach(([k, list]) => {
      const ends = {}; list.forEach((w, i) => [w.nodes[0], w.nodes[w.nodes.length - 1]].forEach(n => (ends[n] = ends[n] || []).push(i)));
      const used = new Array(list.length).fill(false);
      list.forEach((w, i) => {
        if (used[i]) return; used[i] = true;
        let pts = w.pts.slice(), a = w.nodes[0], b = w.nodes[w.nodes.length - 1];
        for (let grow = true; grow;) {
          grow = false;
          for (const side of ['b', 'a']) {
            const at = side === 'b' ? b : a, n = (ends[at] || []).find(j => !used[j]); if (n == null) continue;
            used[n] = true; const q = list[n], fwd = q.nodes[0] === at, qp = fwd ? q.pts : q.pts.slice().reverse(), other = fwd ? q.nodes[q.nodes.length - 1] : q.nodes[0];
            if (side === 'b') { pts = pts.concat(qp.slice(1)); b = other; } else { pts = qp.slice().reverse().slice(0, -1).concat(pts); a = other; }
            grow = true;
          }
        }
        out.push({ key: k, ref: list[0].ref, name: list[0].name, pts, cls: w.cls });
      });
    });
    return out;
  }
  OR.topRides = async function (lng, lat, km) {
    const r = Math.round((km || 15) * 1000), ck = lng.toFixed(2) + ',' + lat.toFixed(2) + ',' + r;
    if (cache[ck]) return cache[ck];
    const q = '[out:json][timeout:50];way["highway"~"^(primary|secondary|tertiary)$"]["oneway"!="yes"]["dual_carriageway"!="yes"](around:' + r + ',' + lat.toFixed(5) + ',' + lng.toFixed(5) + ');out body geom qt;';
    const els = await OR.overpassRaw(q);
    const ways = els.filter(e => e.type === 'way' && e.geometry && e.nodes && (e.tags.ref || e.tags.name) && !/^(M|A\d+\(M\))/.test(e.tags.ref || ''))
      .map(e => ({ ref: (e.tags.ref || '').split(';')[0].trim(), name: e.tags.name || '', cls: e.tags.highway, nodes: e.nodes, pts: e.geometry.map(g => [g.lon, g.lat]) }));
    const here = [lng, lat];
    const roads = chains(ways).map(c => {
      const t = twistOf(c.pts); let d = 1e12; for (const p of c.pts) d = Math.min(d, OR.dist(here, p));
      return Object.assign(c, t, { d, a: c.pts[0], b: c.pts[c.pts.length - 1], label: c.ref && c.name ? c.ref + ' · ' + c.name : c.ref || c.name });
    }).filter(x => x.len >= 4000 && x.twist >= 95);
    // the best stretch of each road only (a number can turn up twice when the road leaves and comes back)
    const best = {}; roads.forEach(x => { const s = x.twist * Math.sqrt(x.len / 1000); x.score = s; if (!best[x.key] || best[x.key].score < s) best[x.key] = x; });
    const list = Object.values(best).sort((a, b) => b.score - a.score).slice(0, 8);
    await Promise.all(list.map(async x => { if (!x.ref || x.name) return; const n = await OR.reverseName(x.pts[Math.floor(x.pts.length / 2)][0], x.pts[Math.floor(x.pts.length / 2)][1]).catch(() => null); if (n) x.near = n.split(',')[0]; }));
    return (cache[ck] = list);
  };

  // where to put a road in a list of points: between the pair it adds least distance to, entered at its nearer end
  OR.insertRoad = function (wps, road) {
    const mk = (p, end) => ({ lng: p[0], lat: p[1], name: road.label + (end ? ' (end)' : ' (start)'), type: 'through' });
    if (!wps.length) return [Object.assign(mk(road.a), { type: 'break' }), Object.assign(mk(road.b, true), { type: 'break' })];
    if (wps.length === 1) { const w = [wps[0].lng, wps[0].lat], fwd = OR.dist(w, road.a) <= OR.dist(w, road.b); return [wps[0], mk(fwd ? road.a : road.b), Object.assign(mk(fwd ? road.b : road.a, true), { type: 'break' })]; }
    let bestK = 0, bestCost = 1e15, bestFwd = true;
    for (let k = 0; k < wps.length - 1; k++) {
      const p = [wps[k].lng, wps[k].lat], q = [wps[k + 1].lng, wps[k + 1].lat], base = OR.dist(p, q);
      for (const fwd of [true, false]) { const s = fwd ? road.a : road.b, e = fwd ? road.b : road.a, c = OR.dist(p, s) + road.len + OR.dist(e, q) - base; if (c < bestCost) { bestCost = c; bestK = k; bestFwd = fwd; } }
    }
    const out = wps.slice(); out.splice(bestK + 1, 0, mk(bestFwd ? road.a : road.b), mk(bestFwd ? road.b : road.a, true));
    return out;
  };

  function showRoads(list, focus) {
    OR.setData('great', { type: 'FeatureCollection', features: list.map(x => ({ type: 'Feature', properties: { name: x.ref || x.name }, geometry: { type: 'LineString', coordinates: x.pts } })) });
    const pts = focus ? focus.pts : [].concat(...list.map(x => x.pts));
    if (pts.length) OR.map.fitBounds(OR.bbox(pts), { padding: 60, duration: 600 });
  }
  OR.clearTopRides = () => OR.setData('great', null);

  // the list: place = {lng, lat, name}; add(road) puts it in the route or trip day
  OR.topRidesSheet = function (place, add, addLabel) {
    const head = '<h2>' + ic('twisty') + 'Top rides near ' + esc((place.name || 'here').split(',')[0]) + '</h2>';
    OR.sheet(head + '<p class="small muted">Looking at the A and B roads within about 10 miles…</p>');
    OR.topRides(place.lng, place.lat, 15).then(list => {
      if (!list.length) return OR.sheet(head + '<p>No really bendy A or B roads within about 10 miles. Try a place in hillier country.</p>');
      showRoads(list);
      OR.sheet(head + '<p class="small muted">The bendiest A and B roads within about 10 miles, from OpenStreetMap. Shown in purple on the map.</p><div class="menu">' +
        list.map((x, i) => '<div class="tr-row"><span class="tr-n">' + (i + 1) + '</span><span class="tr-t"><b>' + esc(x.label) + (x.near ? ' near ' + esc(x.near) : '') + '</b><small>' + OR.fmtDist(x.len) + ' · ' + OR.bendLabel(x.twist) + ' · ' + (x.d < 500 ? 'starts here' : OR.fmtDist(x.d) + ' away') + '</small></span>' +
          '<button class="btn small ghost" data-trs="' + i + '">Show</button><button class="btn small pri" data-tra="' + i + '">' + esc(addLabel || 'Add') + '</button></div>').join('') + '</div>' +
        '<p class="small muted">Adding a road puts its two ends in as via points, so the route rides the whole of it. Check the roads are open and suitable before you go.</p>', b => {
        $$('[data-trs]', b).forEach(x => x.onclick = () => { OR.closeSheet(); if (innerWidth < 900) $('#panel').classList.remove('open'); showRoads(list, list[+x.dataset.trs]); });
        $$('[data-tra]', b).forEach(x => x.onclick = () => { OR.closeSheet(); add(list[+x.dataset.tra]); });
      });
    }).catch(e => OR.sheet(head + '<p class="err">Couldn\'t look up roads: ' + esc(e.message) + '</p>'));
  };

  // in Plan: put a road into the route and plan again
  OR.addRideToPlan = function (road) {
    OR.plan.wps = OR.insertRoad(OR.plan.wps, road);
    OR.clearTopRides(); OR.toast('Added ' + road.label + '. Planning…'); OR.planChanged(true);
  };
})(window.OR);
