/* OpenRoad regroup prompt: on the leader's phone, when the back of the group has fallen well behind for a minute, it
   says so and offers a regroup point a little way ahead (a fuel stop, café or pub if there is one, otherwise just
   the road ahead), which sets the group's regroup point for everyone. Not more than once every 10 minutes. */
'use strict';
(function (OR) {
  const GAP = 1800, HOLD = 60000, COOL = 600000; // metres behind, how long it must last, quiet time after a prompt
  let since = 0, last = 0, busy = false;
  OR.regroupOn = () => OR.cfg.regroup !== false;

  const along = (route, p) => { let best = 300, a = null; for (let i = 0; i < route.shape.length - 1; i++) { const q = OR.projSeg([p.lo, p.la], route.shape[i], route.shape[i + 1]); if (q.d < best) { best = q.d; a = route.cum[i] + q.t * (route.cum[i + 1] - route.cum[i]); } } return a; };
  const pointAhead = (route, d) => { let i = 0; while (i < route.cum.length - 1 && route.cum[i] < d) i++; return route.shape[Math.min(i, route.shape.length - 1)]; };

  function tick(st) {
    if (!OR.regroupOn() || !st || !st.on || !OR.ride || !OR.ride.on || !OR.pos || busy) { since = 0; return; }
    if ((OR.cfg.group || {}).role !== 'lead') return;
    const riders = st.riders.filter(r => r.la != null && r.age <= 60); if (!riders.length) { since = 0; return; }
    const route = OR.ride.route;
    // how far behind each rider is: along the route if there is one, otherwise how far away they are
    const gaps = riders.map(r => { if (route) { const a = along(route, r); return a == null ? OR.dist([OR.pos.lng, OR.pos.lat], [r.lo, r.la]) : Math.max(0, OR.ride.along - a); } return OR.dist([OR.pos.lng, OR.pos.lat], [r.lo, r.la]); });
    const worst = Math.max.apply(null, gaps), who = riders[gaps.indexOf(worst)];
    if (worst < GAP) { since = 0; return; }
    if (!since) since = Date.now();
    if (Date.now() - since < HOLD || Date.now() - last < COOL) return;
    last = Date.now(); since = 0; prompt(worst, who, route);
  }

  async function prompt(gap, who, route) {
    busy = true;
    try {
      // somewhere to wait: a stop a little way ahead, if the map knows one
      const ahead = route ? pointAhead(route, Math.min(route.dist, OR.ride.along + 3000)) : [OR.pos.lng, OR.pos.lat];
      let stop = null;
      if (OR.online() && OR.nearby) { for (const k of ['fuel', 'cafe', 'pub']) { try { const l = await OR.nearby(k, ahead[0], ahead[1], 2500); if (l && l[0]) { stop = l[0]; break; } } catch (e) { } } }
      const mi = OR.fmtDist(gap);
      OR.say((who.n ? who.n + ' is' : 'The back of the group is') + ' about ' + OR.spokenDist(gap) + ' behind. Pull in somewhere safe to regroup.');
      const name = stop ? stop.name : 'the road ahead';
      OR.sheet('<h2>' + OR.ic('group') + 'Group is spread out</h2><p>' + (who.n ? '<b>' + OR.esc(who.n) + '</b> is' : 'The back of the group is') + ' about ' + mi + ' behind you.</p>' +
        '<div class="bigbtns"><button class="btn go" id="rgSet">' + OR.ic('flag') + 'Regroup ' + (stop ? 'at ' + OR.esc(stop.name) : 'ahead') + '</button><button class="btn wide ghost" id="rgNo">Carry on</button></div>' +
        '<p class="small muted">Setting a regroup point tells everyone in the group where to head. Only stop somewhere safe, off the road.</p>', b => {
        b.querySelector('#rgNo').onclick = () => OR.closeSheet();
        b.querySelector('#rgSet').onclick = () => {
          OR.closeSheet(); const ll = stop ? [stop.lng, stop.lat] : ahead;
          OR.group.setMeet(ll, stop ? stop.name : 'Regroup ahead'); OR.toast('Regroup point set: ' + name, 5000);
        };
      });
    } finally { busy = false; }
  }
  OR.on('group', st => { try { tick(st); } catch (e) { console.warn(e); } });
  OR.on('ridestart', () => { since = 0; last = 0; });
  OR.regroupTick = tick; OR.regroupReset = () => { since = 0; last = 0; };
})(window.OR);
