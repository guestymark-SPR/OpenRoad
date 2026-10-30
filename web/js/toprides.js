/* OpenRoad top rides: the best biking roads near a place, to add to your route or a trip day.
   From the map's own tiles (OpenStreetMap data): numbered and named A and B roads (trunk, primary, secondary and
   tertiary) within about 15 km, joined into whole roads and ranked by how much they bend per mile and how long they
   are. Motorways, tunnels, unnamed lanes and town streets are left out. */
'use strict';
(function (OR) {
  const $ = OR.$, $$ = OR.$$, esc = OR.esc, ic = (n, c) => OR.ic(n, c), MI = 1609.344;
  const cache = {};

  function twistOf(pts) {
    const p = OR.resample(pts, 40); let len = 0, turn = 0;
    for (let i = 1; i < p.length; i++) { len += OR.dist(p[i - 1], p[i]); if (i > 1) { const d = OR.angDiff(OR.bearing(p[i - 2], p[i - 1]), OR.bearing(p[i - 1], p[i])); if (d < 75) turn += d; } } // over 75° is a junction, not a bend
    return { len, twist: len ? Math.round(turn / (len / MI)) : 0 };
  }
  // ---------- reading the map's own vector tiles ----------
  // The map tiles already carry every named road with its number, name and class, so this works anywhere the map
  // works (offline too, with a country pack) and doesn't depend on a busy public database.
  function pb(buf) {
    let p = 0; const b = buf;
    const varint = () => { let r = 0, s = 0, x; do { x = b[p++]; r += (x & 0x7f) * Math.pow(2, s); s += 7; } while (x & 0x80); return r; };
    return { get pos() { return p; }, set pos(v) { p = v; }, varint, end: b.length,
      bytes() { const n = varint(), o = b.subarray(p, p + n); p += n; return o; },
      skip(wt) { if (wt === 0) varint(); else if (wt === 1) p += 8; else if (wt === 2) p += varint(); else if (wt === 5) p += 4; } };
  }
  const td = new TextDecoder();
  function decodeLayer(bytes, want) {
    const r = pb(bytes); let name = '', extent = 4096; const keys = [], vals = [], feats = [];
    while (r.pos < r.end) {
      const tag = r.varint(), f = tag >> 3, wt = tag & 7;
      if (f === 1 && wt === 2) name = td.decode(r.bytes());
      else if (f === 2 && wt === 2) feats.push(r.bytes());
      else if (f === 3 && wt === 2) keys.push(td.decode(r.bytes()));
      else if (f === 4 && wt === 2) { const v = pb(r.bytes()); let val = null; while (v.pos < v.end) { const t2 = v.varint(), f2 = t2 >> 3, w2 = t2 & 7; if (f2 === 1) val = td.decode(v.bytes()); else if (f2 === 4 || f2 === 5) val = v.varint(); else if (f2 === 6) { const n = v.varint(); val = n % 2 ? -(n + 1) / 2 : n / 2; } else if (f2 === 7) val = !!v.varint(); else v.skip(w2); } vals.push(val); }
      else if (f === 5 && wt === 0) extent = r.varint();
      else r.skip(wt);
    }
    if (name !== want) return null;
    return { extent, features: feats.map(fb => {
      const r2 = pb(fb), props = {}; let geom = [], type = 0;
      while (r2.pos < r2.end) {
        const tag = r2.varint(), f = tag >> 3, wt = tag & 7;
        if (f === 2 && wt === 2) { const t = pb(r2.bytes()); while (t.pos < t.end) { const k = t.varint(), v = t.varint(); props[keys[k]] = vals[v]; } }
        else if (f === 3) type = r2.varint();
        else if (f === 4 && wt === 2) { const g = pb(r2.bytes()); while (g.pos < g.end) geom.push(g.varint()); }
        else r2.skip(wt);
      }
      // geometry commands: move to, line to (zigzag-encoded steps)
      const lines = []; let x = 0, y = 0, i = 0, cur = null;
      while (i < geom.length) {
        const c = geom[i++], cmd = c & 7, n = c >> 3;
        if (cmd === 7) continue;
        for (let k = 0; k < n; k++) { const dx = geom[i++], dy = geom[i++]; x += (dx >> 1) ^ -(dx & 1); y += (dy >> 1) ^ -(dy & 1); if (cmd === 1) { cur = [[x, y]]; lines.push(cur); } else cur.push([x, y]); }
      }
      return { type, props, lines };
    }) };
  }
  function decodeTile(buf, want) {
    const r = pb(buf);
    while (r.pos < r.end) { const tag = r.varint(), f = tag >> 3, wt = tag & 7; if (f === 3 && wt === 2) { const l = decodeLayer(r.bytes(), want); if (l) return l; } else r.skip(wt); }
    return null;
  }
  // a line cut to the tile's own square (tiles overlap a little at the edges), as one or more pieces
  function clip(line, E) {
    const out = []; let cur = null;
    const inside = p => p[0] >= 0 && p[0] <= E && p[1] >= 0 && p[1] <= E;
    for (let i = 0; i < line.length - 1; i++) {
      let [x0, y0] = line[i], [x1, y1] = line[i + 1], t0 = 0, t1 = 1; const dx = x1 - x0, dy = y1 - y0;
      let ok = true;
      for (const [pp, qq] of [[-dx, x0], [dx, E - x0], [-dy, y0], [dy, E - y0]]) {
        if (pp === 0) { if (qq < 0) { ok = false; break; } continue; }
        const r = qq / pp; if (pp < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; } else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
      }
      if (!ok) { cur = null; continue; }
      const a = [x0 + t0 * dx, y0 + t0 * dy], b = [x0 + t1 * dx, y0 + t1 * dy];
      if (!cur) { cur = [a]; out.push(cur); }
      cur.push(b);
      if (t1 < 1) cur = null;
    }
    return out.filter(l => l.length > 1);
  }
  let tileUrl = null;
  async function tileTemplate() {
    if (tileUrl) return tileUrl;
    if (OR.native) return (tileUrl = 'https://openroad.maps/t/{z}/{x}/{y}.pbf');
    const j = await OR.json('https://tiles.openfreemap.org/planet'); return (tileUrl = j.tiles[0]);
  }
  async function getTile(z, x, y) {
    const r = await fetch((await tileTemplate()).replace('{z}', z).replace('{x}', x).replace('{y}', y));
    if (!r.ok) throw new Error('map tile ' + r.status);
    let buf = new Uint8Array(await r.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b && window.DecompressionStream) buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    return buf;
  }
  OR.vt = { decodeTile, clip, getTile }; // shared with offline planning (offroute.js)
  const CLASS_OK = { trunk: 1, primary: 1, secondary: 1, tertiary: 1 };
  async function roadsFromTiles(lng, lat, km) {
    const z = 12, n = 1 << z, R = km * 1000, dLat = R / 111320, dLng = R / (111320 * Math.cos(lat * Math.PI / 180));
    const tx = lo => Math.floor((lo + 180) / 360 * n), ty = la => Math.floor((1 - Math.asinh(Math.tan(la * Math.PI / 180)) / Math.PI) / 2 * n);
    const x0 = tx(lng - dLng), x1 = tx(lng + dLng), y0 = ty(lat + dLat), y1 = ty(lat - dLat), jobs = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push([x, y]);
    const pieces = [];
    const one = async ([x, y]) => {
      let l; try { l = decodeTile(await getTile(z, x, y), 'transportation_name'); } catch (e) { return; }
      if (!l) return;
      const toLL = p => [(x + p[0] / l.extent) / n * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + p[1] / l.extent) / n))) * 180 / Math.PI];
      l.features.forEach(f => {
        const pr = f.props; if (f.type !== 2 || !CLASS_OK[pr.class] || pr.brunnel === 'tunnel') return;
        const ref = String(pr.ref || '').split(';')[0].trim(), name = pr.name || pr['name:latin'] || '';
        if (!ref && !name) return; if (/^M\d|\(M\)/.test(ref)) return;
        f.lines.forEach(ln => clip(ln, l.extent).forEach(c => pieces.push({ key: ref || name, ref, name, cls: pr.class, pts: c.map(toLL) })));
      });
    };
    for (let i = 0; i < jobs.length; i += 6) await Promise.all(jobs.slice(i, i + 6).map(one));
    if (!pieces.length && !jobs.length) throw new Error('no map tiles here');
    // pieces of the same road joined where their ends meet (within about 25 m)
    const byKey = {}; pieces.forEach(p => (byKey[p.key] = byKey[p.key] || []).push(p));
    const out = [];
    Object.values(byKey).forEach(list => {
      const used = new Array(list.length).fill(false), near = (a, b) => OR.dist(a, b) < 25;
      list.forEach((pc, i) => {
        if (used[i]) return; used[i] = true; let pts = pc.pts.slice();
        for (let grow = true; grow;) {
          grow = false;
          for (let j = 0; j < list.length; j++) {
            if (used[j]) continue; const q = list[j].pts, s = pts[0], e = pts[pts.length - 1];
            if (near(e, q[0])) pts = pts.concat(q.slice(1)); else if (near(e, q[q.length - 1])) pts = pts.concat(q.slice(0, -1).reverse());
            else if (near(s, q[q.length - 1])) pts = q.slice(0, -1).concat(pts); else if (near(s, q[0])) pts = q.slice(1).reverse().concat(pts);
            else continue;
            used[j] = true; grow = true;
          }
        }
        out.push({ key: pc.key, ref: pc.ref, name: pc.name, cls: pc.cls, pts });
      });
    });
    return out;
  }
  OR.topRides = async function (lng, lat, km) {
    km = km || 15; const ck = lng.toFixed(2) + ',' + lat.toFixed(2) + ',' + km;
    if (cache[ck]) return cache[ck];
    const here = [lng, lat], chainsList = await roadsFromTiles(lng, lat, km);
    const roads = chainsList.map(c => {
      const t = twistOf(c.pts); let d = 1e12; for (const p of c.pts) d = Math.min(d, OR.dist(here, p));
      return Object.assign(c, t, { d, a: c.pts[0], b: c.pts[c.pts.length - 1], label: c.ref && c.name ? c.ref + ' · ' + c.name : c.ref || c.name });
    }).filter(x => x.len >= 4000 && x.twist >= 95 && x.d <= km * 1000);
    // the best stretch of each road only (a number can turn up twice when the road leaves and comes back)
    const best = {}; roads.forEach(x => { const s = x.twist * Math.sqrt(x.len / 1000); x.score = s; if (!best[x.key] || best[x.key].score < s) best[x.key] = x; });
    const list = Object.values(best).sort((a, b) => b.score - a.score).slice(0, 8);
    await Promise.all(list.map(async x => { if (x.name) return; const m = x.pts[Math.floor(x.pts.length / 2)], nm = await OR.reverseName(m[0], m[1]).catch(() => null); const parts = (nm || '').split(',').map(t => t.trim()).filter(t => t && !/\d/.test(t)); if (parts.length) x.near = parts[parts.length > 2 ? 1 : 0]; }));
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
    OR.sheet(head + '<p class="small muted">Looking at the roads within about 10 miles…</p>');
    OR.topRides(place.lng, place.lat, 15).then(list => {
      if (!list.length) return OR.sheet(head + '<p>No really bendy A or B roads within about 10 miles. Try a place in hillier country.</p>');
      showRoads(list);
      OR.sheet(head + '<p class="small muted">The bendiest numbered and named roads within about 10 miles, from the map (OpenStreetMap). Shown in purple on the map.</p><div class="menu">' +
        list.map((x, i) => '<div class="tr-row"><span class="tr-n">' + (i + 1) + '</span><span class="tr-t"><b>' + esc(x.label) + (x.near ? ' near ' + esc(x.near) : '') + '</b><small>' + OR.fmtDist(x.len) + ' · ' + OR.bendLabel(x.twist) + ' · ' + (x.d < 500 ? 'starts here' : OR.fmtDist(x.d) + ' away') + '</small></span>' +
          '<button class="btn small ghost" data-trs="' + i + '">Show</button><button class="btn small pri" data-tra="' + i + '">' + esc(addLabel || 'Add') + '</button></div>').join('') + '</div>' +
        '<p class="small muted">Adding a road puts its two ends in as via points, so the route rides the whole of it. Check the roads are open and suitable before you go.</p>', b => {
        $$('[data-trs]', b).forEach(x => x.onclick = () => { OR.closeSheet(); if (innerWidth < 900) $('#panel').classList.remove('open'); showRoads(list, list[+x.dataset.trs]); });
        $$('[data-tra]', b).forEach(x => x.onclick = () => { OR.closeSheet(); add(list[+x.dataset.tra]); });
      });
    }).catch(e => OR.sheet(head + '<p class="err">Couldn\'t read the roads here: ' + esc(e.message) + '</p>'));
  };

  // in Plan: put a road into the route and plan again
  OR.addRideToPlan = function (road) {
    OR.plan.wps = OR.insertRoad(OR.plan.wps, road);
    OR.clearTopRides(); OR.toast('Added ' + road.label + '. Planning…'); OR.planChanged(true);
  };
})(window.OR);
