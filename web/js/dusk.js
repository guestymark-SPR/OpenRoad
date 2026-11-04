/* OpenRoad dusk: if a planned ride runs past sunset it says so with how much of it is in the dark and the latest you
   can leave to finish in daylight; while riding, it tells you sunset is half an hour away and again when it falls. */
'use strict';
(function (OR) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const secs = r => (OR.myTime ? OR.myTime(r.time) : r.time);

  OR.duskInfo = function (r, dep) {
    if (!r || !r.shape || !r.shape.length || !OR.sunTimes) return null;
    const end = r.shape[r.shape.length - 1], t = secs(r) * 1000, arrive = new Date(dep.getTime() + t);
    const s = OR.sunTimes(end[1], end[0], arrive); if (!s || !s.set) return null;
    const set = s.set.getTime();
    if (arrive.getTime() <= set) return { dark: false, set: s.set };
    const start = dep.getTime() >= set ? 0 : (set - dep.getTime()) / t; // how far along the sun goes down
    const inDark = Math.round(r.dist * (1 - Math.min(1, Math.max(0, start))));
    return { dark: true, set: s.set, inDark, allDark: start <= 0, latest: new Date(set - t), arrive };
  };

  OR.duskHtml = function (r, dep) {
    const d = OR.duskInfo(r, dep); if (!d || !d.dark) return '';
    const line = d.allDark ? 'This ride is in the dark: sunset is at ' + OR.clock(d.set) + '.'
      : 'Sunset is at ' + OR.clock(d.set) + ', so the last ' + OR.fmtDist(d.inDark) + ' is in the dark. Leave by ' + OR.clock(d.latest) + ' to finish in daylight.';
    return '<p class="wxs-warn duskline">' + OR.ic('time') + esc(line) + '</p>';
  };

  // while riding
  let said = { half: 0, set: 0 };
  OR.on('ridestart', () => { said = { half: 0, set: 0 }; });
  OR.on('ride', s => {
    if (!OR.pos || !OR.sunTimes || !OR.ride.on) return;
    const sun = OR.sunTimes(OR.pos.lat, OR.pos.lng, new Date()); if (!sun || !sun.set) return;
    const to = sun.set.getTime() - Date.now(), day = new Date().toDateString();
    if (to > 20 * 60000 && to < 40 * 60000 && said.half !== day) {
      said.half = day;
      const ahead = s && s.remain != null ? ' ' + OR.spokenDist(s.remain) + ' to go.' : '';
      OR.say('Sunset in about half an hour.' + ahead); OR.toast('Sunset at ' + OR.clock(sun.set), 5000);
    } else if (to <= 0 && to > -20 * 60000 && said.set !== day) {
      said.set = day; OR.say('The sun has set. Visor clear and lights on.'); OR.toast('Sun has set. Take care in the dark.', 5000);
    }
  });
})(window.OR);
