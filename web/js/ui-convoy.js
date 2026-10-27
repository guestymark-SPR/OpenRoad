/* OpenRoad group ride on the move: hazard drops (warned to the riders behind), the convoy strip
   (who's where along the route), and catch-up mode (navigate to a rider as they move). */
'use strict';
(function (OR) {
  const $ = OR.$, $$ = OR.$$, esc = OR.esc, ic = (n, c) => OR.ic(n, c);
  const N = () => OR.native;
  OR.HAZARDS = [['gravel', 'Gravel'], ['diesel', 'Diesel or oil'], ['pothole', 'Pothole'], ['mud', 'Mud on the road'], ['roadworks', 'Roadworks'], ['animal', 'Animals on the road'],
    ['crash', 'Accident'], ['flood', 'Water on the road'], ['debris', 'Something in the road'], ['leaves', 'Wet leaves'], ['other', 'Other hazard']];
  const hazName = k => (OR.HAZARDS.find(h => h[0] === k) || [0, 'Hazard'])[1];

  // ---------- hazards ----------
  let hazards = [];
  OR.groupHazards = () => hazards;
  // shared with every OpenRoad rider (Android app), anonymous, 6 hours
  const pubOn = () => !!(N() && N().pubHazards) && OR.cfg.pubHazards !== false;
  function pullHazards() {
    let g = [], pub = [];
    if (OR.group.state.on && N() && N().groupHazards) { try { g = JSON.parse(N().groupHazards()); } catch (e) { } }
    if (pubOn()) { try { pub = JSON.parse(N().pubHazards()).map(h => Object.assign(h, { key: 'p:' + h.hid, pub: true })); } catch (e) { } }
    hazards = g.concat(pub);
    if (!hazards.length) { OR.setData('haz', null); return; }
    OR.setData('haz', { type: 'FeatureCollection', features: hazards.map(h => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [h.lo, h.la] }, properties: { key: h.key, name: hazName(h.k) } })) });
  }
  OR.hazardSheet = function () {
    const grp = OR.group.state.on, pub = pubOn();
    if (!grp && !pub) return OR.toast(N() && N().pubHazards ? 'Sharing hazards with other riders is switched off in Safety' : 'Hazard drops work in the Android app');
    let to = grp ? 'group' : 'all';
    OR.sheet('<h2>' + ic('warn') + 'Mark a hazard here</h2>' +
      (grp && pub ? '<div class="seg" id="hzTo"><button data-v="group" class="on">My group</button><button data-v="all">All OpenRoad riders</button></div>' : '') +
      '<p class="small muted" id="hzWho">' + (to === 'group' ? 'Riders in your group hear a warning as they get close. It stays for 8 hours.' : 'Any OpenRoad rider coming this way hears a warning. It\'s anonymous, and goes after 6 hours or when two riders say it\'s gone.') + '</p><div class="hzgrid">' +
      OR.HAZARDS.map(h => '<button data-hz="' + h[0] + '">' + esc(h[1]) + '</button>').join('') + '</div>' + OR.field('hzNote', 'Add a few words (optional)', '', 'text', 'e.g. on the left-hand bend'), b => {
      $$('#hzTo button', b).forEach(x => x.onclick = () => { to = x.dataset.v; $$('#hzTo button', b).forEach(y => y.classList.toggle('on', y === x)); $('#hzWho', b).textContent = to === 'group' ? 'Riders in your group hear a warning as they get close. It stays for 8 hours.' : 'Any OpenRoad rider coming this way hears a warning. It\'s anonymous, and goes after 6 hours or when two riders say it\'s gone.'; });
      $$('[data-hz]', b).forEach(x => x.onclick = () => {
        if (!OR.pos) return OR.toast('Waiting for your position');
        const k = x.dataset.hz, note = $('#hzNote', b).value.trim();
        if (to === 'group') { N().groupHazard(k, note); OR.toast(hazName(k) + ' marked for the group'); }
        else { if (N().pubHazPos) N().pubHazPos(OR.pos.lat, OR.pos.lng); const ok = N().pubHazAdd(k, note); OR.toast(ok ? hazName(k) + ' marked for all OpenRoad riders' : 'Not marked: no connection yet, or 10 marked in the last hour'); }
        OR.closeSheet(); setTimeout(pullHazards, 500);
      });
    });
  };
  OR.on('ready', () => { });
  function hazTap(key) {
    const h = hazards.find(x => x.key === key); if (!h) return;
    if (h.pub) {
      const age = Math.round((Date.now() - h.t) / 60000), d = OR.pos ? OR.dist([OR.pos.lng, OR.pos.lat], [h.lo, h.la]) : null;
      return OR.sheet('<h2>' + ic('warn') + esc(hazName(h.k)) + '</h2><p>' + (h.x ? esc(h.x) + '<br>' : '') + 'Marked by ' + (h.mine ? 'you' : 'an OpenRoad rider') + ' ' + (age < 1 ? 'just now' : age < 90 ? age + ' min ago' : Math.round(age / 60) + ' h ago') + (d != null ? ', ' + OR.fmtDist(d) + ' from you' : '') + '.' + (h.gone ? ' One rider has said it\'s gone.' : '') + '</p>' +
        (h.voted ? '<p class="small muted">You\'ve said it\'s gone.</p>' : '<button class="btn wide ghost" id="hzGone">' + (h.mine ? 'Remove it' : 'It\'s gone') + '</button>'), b => {
        const g = $('#hzGone', b); if (g) g.onclick = () => { N().pubHazGone(h.hid); OR.closeSheet(); OR.toast(h.mine ? 'Removed' : 'Thanks: it goes when one more rider agrees'); setTimeout(pullHazards, 600); };
      });
    }
    const age = Math.round((Date.now() - h.t) / 60000), d = OR.pos ? OR.dist([OR.pos.lng, OR.pos.lat], [h.lo, h.la]) : null;
    OR.sheet('<h2>' + ic('warn') + esc(hazName(h.k)) + '</h2><p>' + (h.x ? esc(h.x) + '<br>' : '') + 'Marked by ' + (h.mine ? 'you' : esc(h.n)) + ' ' + (age < 1 ? 'just now' : age < 90 ? age + ' min ago' : Math.round(age / 60) + ' h ago') + (d != null ? ', ' + OR.fmtDist(d) + ' from you' : '') + '.</p>' +
      (h.mine ? '<button class="btn wide ghost" id="hzDel">Remove it (it\'s gone)</button>' : ''), b => {
      const del = $('#hzDel', b); if (del) del.onclick = () => { N().groupHazardRemove(h.t); OR.closeSheet(); setTimeout(pullHazards, 500); };
    });
  }

  // ---------- convoy: where everyone is along the route ----------
  const idxCache = {};
  // distance along the route for a point, or null if it's more than 300 m off it
  function alongOf(route, p, id) {
    const s = route.shape, n = s.length; let best = { d: 1e12, i: 0, t: 0 };
    const scan = (a, b) => { for (let i = Math.max(0, a); i < Math.min(n - 1, b); i++) { const r = OR.projSeg(p, s[i], s[i + 1]); if (r.d < best.d) best = { d: r.d, i, t: r.t }; } };
    const c = idxCache[id]; if (c != null && c < n) scan(c - 200, c + 800);
    if (best.d > 300) scan(0, n);
    if (best.d > 300) return null;
    idxCache[id] = best.i;
    return route.cum[best.i] + best.t * (route.cum[best.i + 1] - route.cum[best.i]);
  }
  OR.convoy = function () {
    const st = OR.group.state, r = OR.ride.route; if (!st.on || !OR.pos) return [];
    const me = [OR.pos.lng, OR.pos.lat];
    return st.riders.map(x => {
      const p = [x.lo, x.la], stale = x.age > OR.GROUP_LOST;
      if (r) {
        const a = alongOf(r, p, x.id);
        if (a == null) return { r: x, off: true, d: OR.dist(me, p), stale };
        const gap = a - OR.ride.along, sec = Math.abs(gap) / Math.max(1, r.dist) * r.time;
        return { r: x, gap, sec, stale };
      }
      return { r: x, off: true, d: OR.dist(me, p), stale };
    }).sort((a, b) => (b.gap != null ? b.gap : -1e9) - (a.gap != null ? a.gap : -1e9));
  }
  function drawConvoy() {
    let el = $('#convoy');
    const show = OR.ride.on && OR.group.state.on && OR.group.state.riders.length;
    if (!show) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'convoy'; el.onclick = () => OR.groupSheet(); $('#hud').appendChild(el); }
    const list = OR.convoy(), mins = s => s < 60 ? '<1 min' : Math.round(s / 60) + ' min';
    el.innerHTML = list.map(c => '<span class="cv' + (c.stale ? ' lost' : '') + (c.off ? ' off' : '') + '" style="--c:' + esc(c.r.c || '#e53935') + '"><b>' + esc(c.r.n) + '</b>' +
      (c.off ? OR.fmtDist(c.d) + (OR.ride.route ? ' · off route' : '') : (Math.abs(c.gap) < 80 ? 'with you' : OR.fmtDist(Math.abs(c.gap)) + (c.gap > 0 ? ' ahead' : ' behind') + ' · ' + mins(c.sec))) + '</span>').join('');
  }
  let cvT = 0;
  OR.on('ride', () => { if (Date.now() - cvT > 2500) { cvT = Date.now(); drawConvoy(); } });

  // ---------- catch-up mode ----------
  let chase = null;
  OR.catchUp = async function (id) {
    const r = OR.group.state.riders.find(x => x.id === id); if (!r) return;
    if (!OR.pos) return OR.toast('Waiting for your position');
    OR.closeSheet(); OR.toast('Planning a route to ' + r.n + '…');
    try {
      const rt = await route(r);
      chase = { id, name: r.n, at: [r.lo, r.la], t: Date.now() };
      if (OR.ride.on) OR.swapRoute(rt, 'Catching up with ' + r.n + '.'); else { OR.startRideUi(rt); OR.say('Catching up with ' + r.n + '.'); }
      OR.emit('chase', chase);
    } catch (e) { OR.toast('Could not plan a route: ' + e.message, 6000); }
  };
  async function route(r) {
    const rt = await OR.planWaypoints([{ lng: OR.pos.lng, lat: OR.pos.lat, name: 'My position', type: 'break' }, { lng: r.lo, lat: r.la, name: r.n, type: 'break' }], 'fast');
    rt.name = 'Catching up with ' + r.n; return rt;
  }
  OR.stopCatchUp = () => { if (chase) { chase = null; OR.toast('Catch-up stopped'); OR.emit('chase', null); } };
  OR.chasing = () => chase;
  // every 45 s, if they've moved on more than 400 m, re-plan to where they are now
  setInterval(async () => {
    if (!chase || !OR.ride.on || !OR.pos) return;
    const r = OR.group.state.riders.find(x => x.id === chase.id); if (!r) return;
    const d = OR.dist([OR.pos.lng, OR.pos.lat], [r.lo, r.la]);
    if (d < 150) { OR.say('You\'ve caught up with ' + r.n + '.'); chase = null; OR.emit('chase', null); return; }
    if (OR.dist(chase.at, [r.lo, r.la]) > 400 && Date.now() - chase.t > 40000 && OR.online()) {
      try { const rt = await route(r); chase.at = [r.lo, r.la]; chase.t = Date.now(); if (chase && OR.ride.on) OR.swapRoute(rt); } catch (e) { }
    }
  }, 15000);
  OR.on('ridestop', () => { chase = null; });

  // ---------- hooks: polling, map taps, buttons ----------
  const hazBtn = () => { const hb = $('#hHaz'); if (hb) { hb.hidden = !(OR.group.state.on || pubOn()); if (!hb.onclick) { hb.innerHTML = ic('warn'); hb.onclick = OR.hazardSheet; } } };
  OR.on('group', st => { pullHazards(); drawConvoy(); hazBtn(); });
  OR.on('ridestart', hazBtn);
  // public hazards: watch the area around you while the app is open, and refresh the map
  let lastArea = 0;
  setInterval(() => {
    if (!pubOn() || document.hidden) return;
    if (OR.pos && !OR.ride.on && Date.now() - lastArea > 60000 && N().pubHazPos) { lastArea = Date.now(); N().pubHazPos(OR.pos.lat, OR.pos.lng); }
    pullHazards();
  }, 10000);
  OR.on('hazTap', hazTap);
  OR.on('chase', c => { const n = $('#hudNote'); if (c) { n.hidden = false; n.textContent = 'Catching up with ' + c.name + '. The route follows them as they ride. Tap to stop.'; n.onclick = () => { OR.stopCatchUp(); n.hidden = true; n.onclick = null; }; } });
})(window.OR);
