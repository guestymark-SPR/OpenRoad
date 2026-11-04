/* OpenRoad corner marker (the drop-off system) for group rides on a shared route.
   At each turn off the road, the rider just behind the leader is asked to pull in and mark it; once the sweep
   has gone past, the marker is told to rejoin (they then ride in front of the sweep). Every phone works this
   out for itself from the group's positions, so everyone needs it switched on and the same route. */
'use strict';
(function (OR) {
  const $ = s => document.querySelector(s);
  // Valhalla manoeuvres worth marking: left and right turns (plain and sharp) and roundabouts
  const MARK_TYPES = { 10: 'right turn', 11: 'sharp right turn', 14: 'sharp left turn', 15: 'left turn', 26: 'roundabout' };
  let marking = null, done = {}, lastSay = 0;

  OR.markerOn = () => !!(OR.cfg.group && OR.cfg.group.marker);
  const fresh = r => r && r.age <= 60 && r.la != null;

  // how far along the route a point is, or null if it's more than 150 m off it
  function alongOf(route, lng, lat) {
    let best = 150, a = null;
    for (let i = 0; i < route.shape.length - 1; i++) {
      const q = OR.projSeg([lng, lat], route.shape[i], route.shape[i + 1]);
      if (q.d < best) { best = q.d; a = route.cum[i] + q.t * (route.cum[i + 1] - route.cum[i]); }
    }
    return a;
  }

  // the turns on the route that need a marker, from the manoeuvres
  function turns(route) {
    if (route.__turns) return route.__turns;
    route.__turns = route.man.map((m, k) => MARK_TYPES[m.type] && k > 0 ? { k, at: m.at, kind: MARK_TYPES[m.type], text: m.text, p: route.shape[m.idx] } : null).filter(Boolean);
    return route.__turns;
  }

  function tick(st) {
    const ride = OR.ride, r = ride && ride.route;
    if (!OR.markerOn() || !st || !st.on || !ride || !ride.on || !r || !OR.pos) { if (marking) clear(); return; }
    const role = (OR.cfg.group || {}).role || '';
    const riders = st.riders.filter(fresh).map(x => ({ id: x.id, n: x.n, role: x.r || '', a: alongOf(r, x.lo, x.la) })).filter(x => x.a != null);
    const me = { id: 'me', role, a: ride.along };
    const lead = riders.find(x => x.role === 'lead') || (role === 'lead' ? me : null);
    const sweep = riders.find(x => x.role === 'sweep') || (role === 'sweep' ? me : null);

    if (marking) {
      // release: the sweep has gone past the junction (or, with no sweep, everyone has)
      const behind = sweep && sweep !== me ? [sweep] : riders.filter(x => x.a < marking.at);
      const allPast = sweep && sweep !== me ? sweep.a > marking.at + 40 : !behind.length;
      if (allPast) {
        OR.say(sweep ? 'Sweep\'s through. Rejoin in front of the sweep.' : 'Everyone\'s through. Rejoin at the back.');
        clear(); return;
      }
      if (sweep && sweep !== me) note('Marking the ' + marking.kind + '. Sweep is ' + OR.fmtDist(Math.max(0, marking.at - sweep.a)) + ' away.');
      return;
    }
    if (!lead || role === 'lead' || role === 'sweep') return;
    // am I the first rider behind the leader?
    const behindLead = riders.filter(x => x !== lead && x.a <= lead.a).concat(me.a <= lead.a ? [me] : []).sort((x, y) => y.a - x.a);
    if (behindLead[0] !== me) return;
    // the next turn the leader has already taken and I'm now closing on
    const t = turns(r).find(x => x.at > me.a && x.at < lead.a + 30 && x.at - me.a < 400 && !done[x.k]);
    if (!t) return;
    done[t.k] = 1; marking = t;
    if (Date.now() - lastSay > 5000) { lastSay = Date.now(); OR.say('Corner marker. Pull in safely at this ' + t.kind + ' and show the way. Wait for the sweep.'); }
    note('Mark this ' + t.kind + '. Wait for the sweep.');
  }
  function note(text) { const n = $('#hudNote'); if (!n) return; n.hidden = false; n.textContent = text; n.onclick = () => { clear(); OR.say('Marking stopped.'); }; }
  function clear() { marking = null; const n = $('#hudNote'); if (n && /Mark|Sweep|marking/i.test(n.textContent)) n.hidden = true; }

  OR.on('group', st => { try { tick(st); } catch (e) { console.warn(e); } });
  OR.on('ridestart', () => { done = {}; marking = null; });
  OR.markerState = () => marking;
  OR.markerTick = tick;
})(window.OR);
