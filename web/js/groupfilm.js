/* OpenRoad group ride film: one 3D flyover with every rider's line in their own colour.
   During a group ride the app keeps each rider's positions as they arrive (while OpenRoad is open), and saves them
   with your ride. Riders it didn't catch can be added from a GPX file they send you (exported from their ride). */
'use strict';
(function (OR) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let cur = null, saveT = 0; // { id: { n, c, p: [[lng, lat, t]] } }

  // ---------- recording during the ride ----------
  OR.on('ridestart', () => { cur = {}; OR.store.set('gtrackNow', null); });
  OR.on('group', st => {
    if (!cur || !OR.ride || !OR.ride.on || !st || !st.on) return;
    const now = Date.now();
    for (const r of st.riders) {
      if (r.la == null || r.age > 30) continue;
      const t = Math.round(now - r.age * 1000), x = cur[r.id] = cur[r.id] || { n: r.n || 'Rider', c: r.c || '#e53935', p: [] };
      const last = x.p[x.p.length - 1];
      if (last && (t - last[2] < 4000 || (Math.abs(last[0] - r.lo) < 2e-5 && Math.abs(last[1] - r.la) < 2e-5))) continue;
      x.p.push([+r.lo.toFixed(5), +r.la.toFixed(5), t]);
    }
    if (now - saveT > 60000) { saveT = now; OR.store.set('gtrackNow', cur); } // survives the app being restarted mid-ride
  });
  OR.on('ridestop', saved => {
    const g = cur || OR.store.get('gtrackNow', null); cur = null; OR.store.set('gtrackNow', null);
    if (!saved || !g) return;
    const keep = {}; for (const id in g) if (g[id].p.length >= 10) keep[id] = g[id];
    if (Object.keys(keep).length) OR.store.set('gtracks_' + saved.id, keep);
  });
  OR.groupTracks = id => OR.store.get('gtracks_' + id, {});

  // a rider's track from a GPX file (with times if the file has them)
  function fromGpx(text, file) {
    const x = new DOMParser().parseFromString(text, 'application/xml');
    if (x.getElementsByTagName('parsererror').length) throw new Error('not a readable GPX file');
    const pts = Array.from(x.getElementsByTagName('trkpt')).map(e => { const tm = e.getElementsByTagName('time')[0]; return [parseFloat(e.getAttribute('lon')), parseFloat(e.getAttribute('lat')), tm ? Date.parse(tm.textContent) || 0 : 0]; });
    if (pts.length < 10) throw new Error('no ride track in it');
    const nm = (file || '').replace(/\.gpx$/i, '').replace(/^OpenRoad[ _-]*/i, '').slice(0, 24) || 'Rider';
    return { n: nm, c: OR.GROUP_COLOURS[(Math.random() * OR.GROUP_COLOURS.length) | 0], p: pts, timed: pts.every(p => p[2]) };
  }

  // ---------- the sheet: who's in the film ----------
  OR.groupFilmSheet = function (ride) {
    const got = OR.groupTracks(ride.id), added = [];
    const draw = () => {
      const all = Object.keys(got).map(id => Object.assign({ id }, got[id])).concat(added);
      OR.sheet('<h2>Group ride film</h2><p class="small">A 3D flyover of the ride with each rider\'s line in their colour, moving at the times they rode it.</p>' +
        '<div class="optcard">' + '<label class="opt-row"><span><b>You</b><small>' + OR.fmtDist(ride.dist) + '</small></span><input type="checkbox" class="switch" checked disabled></label>' +
        all.map((x, i) => '<label class="opt-row"><span><b><i class="gdot" style="background:' + esc(x.c) + '"></i>' + esc(x.n) + '</b><small>' + (x.file ? 'from ' + esc(x.file) : 'recorded on the ride') + ', ' + x.p.length + ' points</small></span><input type="checkbox" class="switch" data-gi="' + i + '" checked></label>').join('') + '</div>' +
        (all.length ? '' : '<p class="small muted">No other riders were recorded on this ride. Riders are kept when you ride in a group with OpenRoad open. Ask your mates to send you their ride (Rides, the ride, GPX file) and add it here.</p>') +
        '<label class="btn wide file">' + OR.ic('dl') + 'Add a rider\'s GPX file<input type="file" id="gfIn" accept=".gpx,application/gpx+xml,application/xml,text/xml,*/*" hidden></label>' +
        '<button class="btn go wide" id="gfGo"' + (all.length ? '' : ' disabled') + '>' + OR.ic('cam') + 'Make the film</button>', b => {
        b.querySelector('#gfIn').onchange = e => {
          const f = e.target.files[0]; if (!f) return;
          f.text().then(t => { const x = fromGpx(t, f.name); x.file = f.name; added.push(x); draw(); }).catch(err => OR.toast('Couldn\'t use that file: ' + err.message, 5000));
        };
        b.querySelector('#gfGo').onclick = () => {
          const pick = all.filter((x, i) => { const c = b.querySelector('[data-gi="' + i + '"]'); return c && c.checked; });
          OR.closeSheet(); if (innerWidth < 900) document.querySelector('#panel').classList.remove('open');
          OR.flyover(ride, { others: pick.map(x => ({ n: x.n, c: x.c, p: x.p })) });
        };
      });
    };
    draw();
  };
})(window.OR);
