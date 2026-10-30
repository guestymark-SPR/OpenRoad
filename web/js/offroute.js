/* OpenRoad offline planning: with no signal, routes are planned on the phone from the map's own tiles (the country
   packs in the Maps tab). Every road in the tiles carries its class, one-way, number and name, which is enough to
   find a way and say where to turn. Rougher than online planning: no turn restrictions or lane advice, turns worked
   out from the shape of each junction, and slip roads and roundabouts described as plain turns. */
'use strict';
(function (OR) {
  const Z = 14, NT = 1 << Z, G = NT * 4096;    // zoom 14 tiles; positions on one grid across them all (4096 per tile)
  const MAX_TILES = 1600;
  const NEAR_END = 6000;                       // every road this close to a start, stop or end; only bigger roads between
  const KMH = { motorway: 100, trunk: 75, primary: 56, secondary: 48, tertiary: 42, minor: 28, service: 12 }; // average speeds, towns and bends included
  const MAJOR = { motorway: 1, trunk: 1, primary: 1, secondary: 1, tertiary: 1 };
  // what each class of road costs on top of its time, per riding style (under 1 = preferred)
  const PREF = {
    fast: { motorway: 1, trunk: 1, primary: 1, secondary: 1.05, tertiary: 1.1, minor: 1.3, service: 2 },
    scenic: { motorway: 8, trunk: 1.3, primary: 1, secondary: 1, tertiary: 1.05, minor: 1.3, service: 2 },
    twisty: { motorway: 10, trunk: 1.8, primary: 1.3, secondary: 1, tertiary: 0.95, minor: 1.2, service: 2 },
    extra: { motorway: 12, trunk: 2.2, primary: 1.5, secondary: 1.05, tertiary: 0.9, minor: 1.1, service: 2 }
  };
  const BEST = 100 / 3.6 / 0.9; // fastest any road can be after its preference: keeps the A* estimate a lower bound

  const gxOf = lng => (lng + 180) / 360 * G;
  const gyOf = lat => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * G;
  const lngOf = x => x / G * 360 - 180;
  const latOf = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / G))) * 180 / Math.PI;
  const key = (x, y) => x * G + y;

  // ---------- which tiles to read: a band along each leg, wider for longer legs ----------
  function tilesFor(pts) {
    const out = new Map(), tile = p => [Math.floor(gxOf(p[0]) / 4096), Math.floor(gyOf(p[1]) / 4096)];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], L = OR.dist(a, b), W = Math.min(20000, Math.max(6000, L * 0.2));
      const tm = 40075016 * Math.cos((a[1] + b[1]) / 2 * Math.PI / 180) / NT; // tile width in metres here
      const pad = Math.ceil(W / tm) + 1, ta = tile(a), tb = tile(b);
      for (let x = Math.min(ta[0], tb[0]) - pad; x <= Math.max(ta[0], tb[0]) + pad; x++) {
        for (let y = Math.min(ta[1], tb[1]) - pad; y <= Math.max(ta[1], tb[1]) + pad; y++) {
          const c = [lngOf((x + 0.5) * 4096), latOf((y + 0.5) * 4096)];
          if (OR.projSeg(c, a, b).d > W + tm) continue;
          const full = pts.some(p => OR.dist(c, p) < NEAR_END + tm);
          const k = x + ',' + y; out.set(k, out.get(k) || full);
        }
      }
    }
    return out;
  }

  // ---------- roads from one tile: pieces cut to the tile's own square, on the shared grid ----------
  const cache = new Map();
  async function tileRoads(tk, full) {
    const ck = tk + (full ? '' : 'm');
    if (cache.has(ck)) return cache.get(ck);
    const [x, y] = tk.split(',').map(Number);
    let buf;
    try { buf = await OR.vt.getTile(Z, x, y); } catch (e) { return null; }
    if (!buf || !buf.length) { return null; }
    const roads = OR.vt.decodeTile(buf, 'transportation'), names = OR.vt.decodeTile(buf, 'transportation_name');
    if (!roads) return null;
    const s = 4096 / roads.extent, ox = x * 4096, oy = y * 4096;
    // names and numbers, found by the points they share with the road lines
    const named = new Map();
    if (names) names.features.forEach(f => { const p = f.props, n = { name: p.name || p['name:latin'] || '', ref: String(p.ref || '').split(';')[0].trim() };
      if (n.name || n.ref) f.lines.forEach(l => l.forEach(q => named.set(key(Math.round(ox + q[0] * s), Math.round(oy + q[1] * s)), n))); });
    const pieces = [];
    roads.features.forEach(f => {
      const p = f.props, cls = p.class;
      if (f.type !== 2 || !KMH[cls] || (!full && !MAJOR[cls])) return;
      if (p.surface === 'unpaved' || p.access === 'no' || p.access === false) return;
      f.lines.forEach(l => OR.vt.clip(l, roads.extent).forEach(c => {
        const g = []; let label = null;
        c.forEach(q => { const X = Math.round(ox + q[0] * s), Y = Math.round(oy + q[1] * s);
          if (!g.length || g[g.length - 1][0] !== X || g[g.length - 1][1] !== Y) g.push([X, Y]);
          if (!label) label = named.get(key(X, Y)) || null; });
        if (g.length > 1) pieces.push({ g, cls, ramp: p.ramp === 1 || p.ramp === true, oneway: p.oneway === 1 ? 1 : p.oneway === -1 ? -1 : 0,
          toll: p.toll === 1 || p.toll === true, name: label ? label.name : '', ref: label ? label.ref : '' });
      }));
    });
    if (cache.size > 2500) cache.delete(cache.keys().next().value);
    cache.set(ck, pieces);
    return pieces;
  }

  // ---------- the road network: junctions where pieces share a point, joined across tile edges ----------
  function network(cached) {
    const pieces = cached.map(pc => Object.assign({}, pc, { g: pc.g.map(q => q.slice()) })); // joining moves points: keep the cache as read
    // a piece cut at a tile edge ends within a step or two of its neighbour's end: treat them as one point
    const edgeEnds = new Map(), alias = new Map();
    const onEdge = q => q[0] % 4096 === 0 || q[1] % 4096 === 0;
    pieces.forEach(pc => [pc.g[0], pc.g[pc.g.length - 1]].forEach(q => {
      if (!onEdge(q)) return; const k = key(q[0], q[1]);
      if (alias.has(k) || edgeEnds.has(k)) return;
      for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) { const n = key(q[0] + dx, q[1] + dy); if (edgeEnds.has(n) && n !== k) { alias.set(k, n); return; } }
      edgeEnds.set(k, 1);
    }));
    const K = q => { const k = key(q[0], q[1]); return alias.has(k) ? alias.get(k) : k; };
    // a side road meeting a main road where the main road's line has no point of its own (the map leaves out
    // points along straight stretches): join it to the nearest spot on that line, within about 5 m
    const CELL = 256, TOL = 14, grid = new Map(), occ = new Map(), ins = [];
    pieces.forEach(pc => pc.g.forEach(q => { const k = K(q); occ.set(k, (occ.get(k) || 0) + 1); }));
    pieces.forEach((pc, pi) => {
      for (let i = 0; i < pc.g.length - 1; i++) {
        const a = pc.g[i], b = pc.g[i + 1];
        for (let cx = Math.floor((Math.min(a[0], b[0]) - TOL) / CELL); cx <= Math.floor((Math.max(a[0], b[0]) + TOL) / CELL); cx++)
          for (let cy = Math.floor((Math.min(a[1], b[1]) - TOL) / CELL); cy <= Math.floor((Math.max(a[1], b[1]) + TOL) / CELL); cy++) {
            const ck = cx * 1e6 + cy; if (!grid.has(ck)) grid.set(ck, []); grid.get(ck).push([pi, i]);
          }
      }
    });
    pieces.forEach((pc, pi) => [0, pc.g.length - 1].forEach(idx => {
      const q = pc.g[idx]; if (occ.get(K(q)) > 1) return;
      let best = null;
      for (const [pj, i] of grid.get(Math.floor(q[0] / CELL) * 1e6 + Math.floor(q[1] / CELL)) || []) {
        if (pj === pi) continue;
        const a = pieces[pj].g[i], b = pieces[pj].g[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
        const t = L ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L)) : 0;
        const x = a[0] + t * dx, y = a[1] + t * dy, d = Math.hypot(q[0] - x, q[1] - y);
        if (d <= TOL && (!best || d < best.d)) best = { d, pj, i, t, x, y };
      }
      if (!best) return;
      const a = pieces[best.pj].g[best.i], b = pieces[best.pj].g[best.i + 1];
      if (Math.hypot(best.x - a[0], best.y - a[1]) < 1.5) pc.g[idx] = a.slice();
      else if (Math.hypot(best.x - b[0], best.y - b[1]) < 1.5) pc.g[idx] = b.slice();
      else { const pt = [Math.round(best.x), Math.round(best.y)]; pc.g[idx] = pt; ins.push({ pj: best.pj, i: best.i, t: best.t, pt }); }
    }));
    ins.sort((u, v) => u.pj - v.pj || v.i - u.i || v.t - u.t).forEach(n => pieces[n.pj].g.splice(n.i + 1, 0, n.pt));
    // a point used by two pieces (or a piece's end) is a junction
    const uses = new Map();
    pieces.forEach(pc => pc.g.forEach((q, i) => { const k = K(q); uses.set(k, (uses.get(k) || 0) + (i === 0 || i === pc.g.length - 1 ? 2 : 1)); }));
    const id = new Map(), nodes = [], adj = [];
    const node = (k, q) => { if (!id.has(k)) { id.set(k, nodes.length); nodes.push(q); adj.push([]); } return id.get(k); };
    pieces.forEach(pc => {
      let from = 0;
      for (let i = 1; i < pc.g.length; i++) {
        if (i < pc.g.length - 1 && uses.get(K(pc.g[i])) < 2) continue;
        const geo = pc.g.slice(from, i + 1).map(q => [lngOf(q[0]), latOf(q[1])]);
        const a = node(K(pc.g[from]), pc.g[from]), b = node(K(pc.g[i]), pc.g[i]);
        if (a !== b) {
          let len = 0; for (let j = 1; j < geo.length; j++) len += OR.dist(geo[j - 1], geo[j]);
          const kmh = pc.ramp ? Math.min(KMH[pc.cls], 60) : KMH[pc.cls];
          const e = { a, b, geo, len, time: len / (kmh / 3.6), cls: pc.cls, ramp: pc.ramp, toll: pc.toll, name: pc.name, ref: pc.ref };
          if (pc.oneway !== -1) adj[a].push({ to: b, e, fwd: true });
          if (pc.oneway !== 1) adj[b].push({ to: a, e, fwd: false });
          // junction size counts roads in either direction, for telling turns from bends
          if (pc.oneway === 1) adj[b].push({ to: a, e, fwd: false, blocked: true });
          if (pc.oneway === -1) adj[a].push({ to: b, e, fwd: true, blocked: true });
        }
        from = i;
      }
    });
    return { nodes, adj };
  }

  // nearest junction to a point, on a road a bike can start or finish on (within 1 km)
  function nearest(net, p) {
    const X = gxOf(p[0]), Y = gyOf(p[1]); let best = -1, bd = Infinity;
    net.nodes.forEach((q, i) => { if (!net.adj[i].some(x => !x.blocked)) return; const d = (q[0] - X) ** 2 + (q[1] - Y) ** 2; if (d < bd) { bd = d; best = i; } });
    if (best < 0) return -1;
    const q = net.nodes[best];
    return OR.dist(p, [lngOf(q[0]), latOf(q[1])]) < 1000 ? best : -1;
  }

  // ---------- A* on time weighted by the riding style ----------
  function search(net, s, t, style, heading) {
    const pref = PREF[style] || PREF.twisty, tolls = OR.cfg.avoidTolls ? 5 : 1;
    const n = net.nodes.length, g = new Float64Array(n).fill(Infinity), via = new Array(n), done = new Uint8Array(n);
    const T = net.nodes[t], tp = [lngOf(T[0]), latOf(T[1])];
    const h = i => { const q = net.nodes[i]; return OR.dist([lngOf(q[0]), latOf(q[1])], tp) / BEST; };
    const heap = [[h(s), s]]; g[s] = 0;
    const push = it => { heap.push(it); let i = heap.length - 1; while (i) { const pi = (i - 1) >> 1; if (heap[pi][0] <= heap[i][0]) break; [heap[pi], heap[i]] = [heap[i], heap[pi]]; i = pi; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    while (heap.length) {
      const [, u] = pop(); if (done[u]) continue; done[u] = 1;
      if (u === t) break;
      for (const x of net.adj[u]) {
        if (x.blocked || done[x.to]) continue;
        let c = g[u] + x.e.time * (x.e.ramp ? pref.motorway === 1 ? 1 : 2 : pref[x.e.cls]) * (x.e.toll ? tolls : 1);
        // rerouting while riding: turning round costs a couple of minutes, so carry on the way you're going if it's close
        if (u === s && heading != null) { const geo = x.fwd ? x.e.geo : x.e.geo.slice().reverse(); if (OR.angDiff(heading, headingAt(geo, false)) > 100) c += 120; }
        if (c < g[x.to]) { g[x.to] = c; via[x.to] = x; push([c + h(x.to), x.to]); }
      }
    }
    if (!done[t]) return null;
    const path = []; for (let v = t; v !== s; v = via[v].fwd ? via[v].e.a : via[v].e.b) path.unshift(via[v]);
    return path;
  }

  // ---------- directions: a turn wherever the way through a junction isn't the obvious one ----------
  const road = e => e.ref && e.name ? e.ref + ' ' + e.name : e.ref || e.name || '';
  const roadKey = e => e.ref || e.name || e.cls;
  const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  function headingAt(geo, end) { // bearing over the first (or last) 25 m or so of a stretch
    const g = end ? geo.slice().reverse() : geo; let i = 1, d = 0;
    while (i < g.length - 1 && d < 25) { d += OR.dist(g[i - 1], g[i]); i++; }
    const b = OR.bearing(g[0], g[i]); return end ? (b + 180) % 360 : b;
  }
  function turnOf(a) { // a: signed change of heading, right positive
    const x = Math.abs(a), R = a > 0;
    if (x > 165) return [R ? 12 : 13, 'Make a U-turn'];
    if (x > 120) return [R ? 11 : 14, 'Turn sharp ' + (R ? 'right' : 'left')];
    if (x > 45) return [R ? 10 : 15, 'Turn ' + (R ? 'right' : 'left')];
    if (x > 20) return [R ? 9 : 16, 'Bear ' + (R ? 'right' : 'left')];
    return [8, 'Continue'];
  }
  function directions(net, legs, wps) {
    const shape = [], man = [], legEnds = [];
    let mway = 0;
    legs.forEach((path, li) => {
      const segs = path.map(x => ({ e: x.e, geo: x.fwd ? x.e.geo : x.e.geo.slice().reverse(), node: x.fwd ? x.e.b : x.e.a }));
      segs.forEach((s, i) => {
        const startIdx = shape.length ? shape.length - 1 : 0;
        s.geo.forEach((p, j) => { if (j || !shape.length) shape.push(p); });
        if (s.e.cls === 'motorway') mway += s.e.len;
        if (i === 0) {
          if (li === 0) { const b = headingAt(s.geo, false), r = road(s.e);
            const t = 'Head ' + dirs[Math.round(b / 45) % 8] + (r ? ' on ' + r : '');
            man.push({ idx: 0, type: 1, text: t, alert: '', pre: t, street: r }); }
          return;
        }
        const prev = segs[i - 1], at = prev.node, deg = net.adj[at].length;
        const inH = headingAt(prev.geo, true), turn = h => ((h - inH + 540) % 360) - 180;
        const a = turn(headingAt(s.geo, false));
        const changed = roadKey(s.e) !== roadKey(prev.e);
        // the obvious way through: the gentlest of the roads you could take here, on the same road or one of its class
        const others = net.adj[at].filter(x => !x.blocked && x.e !== prev.e && x.e !== s.e)
          .map(x => Math.abs(turn(headingAt(x.fwd ? x.e.geo : x.e.geo.slice().reverse(), false))));
        const obvious = Math.abs(a) < 45 && others.every(o => o > Math.abs(a) + 20) && (!changed || s.e.cls === prev.e.cls && !(s.e.ref || s.e.name));
        let [type, verb] = turnOf(a);
        if (s.e.ramp && !prev.e.ramp && prev.e.cls === 'motorway') { type = a >= 0 ? 20 : 21; verb = 'Take the exit'; }
        else if (prev.e.ramp && !s.e.ramp && s.e.cls === 'motorway') { type = 25; verb = 'Join the motorway'; }
        else if (deg <= 2 || obvious || (type === 8 && !(s.e.ref && s.e.ref !== prev.e.ref))) return; // a bend, the obvious way on, or a street changing name
        const r = road(s.e), t = verb + (r && (changed || type === 8) ? ' onto ' + r : '');
        const last = man[man.length - 1];
        if (last && last.text === t && OR.dist(shape[last.idx], shape[startIdx]) < 200) return; // the same thing twice in a row
        // a road number starting just after a turn: said as part of the turn
        if (type === 8 && last && last.type !== 1 && last.type !== 4 && OR.dist(shape[last.idx], shape[startIdx]) < 120) {
          const lt = last.text.replace(/ onto .*$/, '') + ' onto ' + r; Object.assign(last, { text: lt, alert: lt, pre: lt, street: r }); return;
        }
        // two turns a few metres apart (crossing a dual carriageway): said as one
        if (last && last.type !== 1 && last.type !== 4 && OR.dist(shape[last.idx], shape[startIdx]) < 30 && type !== 25) {
          Object.assign(last, { type, text: t, alert: t, pre: t, street: r }); return;
        }
        man.push({ idx: startIdx, type, text: t, alert: t, pre: t, street: r });
      });
      legEnds.push(shape.length - 1);
      const w = wps[li + 1], endT = li === legs.length - 1 ? 'You have arrived' + (w && w.name && !/^(Here|End|Chosen point)$/.test(w.name) ? ' at ' + w.name : '') : 'You have reached ' + ((w && w.name) || 'your stop');
      man.push({ idx: shape.length - 1, type: 4, text: endT, alert: '', pre: endT, street: '', leg: true });
    });
    // lengths and times of each instruction's stretch
    const cum = OR.cumulative(shape), allSegs = [].concat.apply([], legs);
    const timeOver = (from, to) => { let t = 0, d = 0; for (const x of allSegs) { const s0 = d; d += x.e.len; if (d > from && s0 < to) t += x.e.time * (Math.min(d, to) - Math.max(s0, from)) / Math.max(1, x.e.len); } return t; };
    man.forEach((m, i) => { const nx = man[i + 1]; m.end = nx ? nx.idx : shape.length - 1; m.at = cum[m.idx]; m.len = cum[m.end] - m.at;
      m.time = timeOver(m.at, cum[m.end]); m.post = m.len > 50 ? 'Continue for ' + OR.spokenDist(m.len) : ''; m.exit = 0; m.toll = false; });
    return { shape, cum, man, legEnds: legEnds.map(i => cum[i]), mway };
  }

  // ---------- plan: one route through the given points, in a riding style ----------
  OR.offlinePlan = async function (wps, styleKey) {
    const pts = wps.map(w => [w.lng, w.lat]);
    for (let i = 0; i < pts.length - 1; i++) if (OR.dist(pts[i], pts[i + 1]) > 250000) throw new Error('Offline planning works up to about 150 miles between points. Add stops along the way, or plan it when you have a signal.');
    const want = tilesFor(pts);
    if (want.size > MAX_TILES) throw new Error('That route is too long to plan offline in one go. Add stops along the way, or plan it when you have a signal.');
    const list = [...want.entries()], got = [];
    let missing = 0; // no tile there: sea, or a part of the map this phone doesn't have
    for (let i = 0; i < list.length; i += 8) {
      const part = await Promise.all(list.slice(i, i + 8).map(([k, full]) => tileRoads(k, full)));
      part.forEach(p => { if (p) got.push.apply(got, p); else missing++; });
    }
    const noMap = 'Offline planning needs the map of this area on your phone: download the country in the Maps tab when you have Wi-Fi.';
    if (!got.length) throw new Error(noMap);
    const net = network(got), legs = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const s = nearest(net, pts[i]), t = nearest(net, pts[i + 1]);
      if (s < 0 || t < 0) throw new Error('No road found near ' + (s < 0 ? (wps[i].name || 'the start') : (wps[i + 1].name || 'the end')) + ' on the offline map.' + (missing ? ' ' + noMap : ''));
      const path = s === t ? [] : search(net, s, t, styleKey, i === 0 ? wps[0].heading : null);
      if (!path) throw new Error('Could not find a way through the offline map between ' + (wps[i].name || 'here') + ' and ' + (wps[i + 1].name || 'there') + '.' + (missing > list.length * 0.2 ? ' ' + noMap : ' Some roads may be missing from the map.'));
      if (path.length) legs.push(path);
    }
    if (!legs.length) throw new Error('The start and end are the same place');
    const d = directions(net, legs, wps), dist = d.cum[d.cum.length - 1];
    const refLen = {};
    legs.forEach(p => p.forEach(x => { if (x.e.ref) refLen[x.e.ref] = (refLen[x.e.ref] || 0) + x.e.len; }));
    const roads = Object.keys(refLen).sort((a, b) => refLen[b] - refLen[a]).slice(0, 4);
    // moving time, plus a few seconds at each junction passed and more where you turn
    let junctions = 0; legs.forEach(p => p.forEach(x => { if (net.adj[x.fwd ? x.e.b : x.e.a].length > 2) junctions++; }));
    const time = d.man.reduce((t, m) => t + m.time, 0) + junctions * 5 + d.man.length * 8;
    return { roads, hasToll: legs.some(p => p.some(x => x.e.toll)), hasFerry: false, id: OR.uid(), shape: d.shape, cum: d.cum, man: d.man,
      legEnds: d.legEnds, dist, time, twist: OR.bendiness(d.shape, d.man), mwayPct: dist ? Math.round(100 * Math.min(d.mway, dist) / dist) : 0,
      created: Date.now(), mode: styleKey, variant: 'Planned offline', offline: true,
      wps: wps.map(w => Object.assign({}, w)), name: (wps[0].name || 'Start') + ' to ' + (wps[wps.length - 1].name || 'End') };
  };

  OR.offlinePlan.parts = { tilesFor, tileRoads, network, nearest, search }; // for testing

  // a network failure (no signal, server unreachable), as opposed to the planner saying no
  OR.isNetErr = e => /no connection|timed out|failed to fetch|networkerror|load failed|network request failed/i.test(String(e && e.message || e));
})(window.OR);
