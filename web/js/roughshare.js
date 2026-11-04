/* OpenRoad rough road tips: the jolts your phone felt on a ride (already kept for the rough-road map) are grouped into
   rough spots. You choose which to share, and each goes to other riders as a "rough road surface" tip that lasts 60
   days. Nothing is shared without your say. The phone must have been on the bike for the jolts to mean much. */
'use strict';
(function (OR) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const CELL = 0.0025; // about 250 m

  // rough spots in this ride: places with at least 3 jolts close together, the worst first
  OR.roughSpots = function (ride) {
    const list = OR.store.get('rough', []).filter(x => x[3] >= ride.start - 1000 && x[3] <= (ride.end || Date.now()) + 1000);
    const g = new Map();
    list.forEach(x => { const k = Math.floor(x[0] / CELL) + ',' + Math.floor(x[1] / CELL); const c = g.get(k) || { n: 0, lng: 0, lat: 0, max: 0 }; c.n++; c.lng += x[0]; c.lat += x[1]; c.max = Math.max(c.max, x[2]); g.set(k, c); });
    return Array.from(g.values()).filter(c => c.n >= 3).map(c => ({ n: c.n, lng: c.lng / c.n, lat: c.lat / c.n, max: c.max })).sort((a, b) => b.max * b.n - a.max * a.n).slice(0, 6);
  };

  OR.roughShareSheet = function (ride) {
    if (!OR.tipsAvailable || !OR.tipsAvailable()) { OR.toast('Sharing needs the OpenRoad Android app'); return; }
    if (!OR.tipsOn()) { OR.toast('Riders\' tips are switched off. Turn them on in Settings, Road-ahead warnings.', 5000); return; }
    const spots = OR.roughSpots(ride);
    if (!spots.length) { OR.sheet('<h2>' + OR.ic('warn') + 'Rough road</h2><p>No rough spots were felt on this ride. They are only noticed while you record a ride in the Android app with the phone on the bike.</p>'); return; }
    OR.sheet('<h2>' + OR.ic('warn') + 'Warn riders about rough road</h2><p class="small">Tick the ones that really were rough. Each goes to riders nearby as an anonymous tip for 60 days.</p><div class="optcard">' +
      spots.map((s, i) => '<label class="opt-row"><span><b id="rg' + i + '">Rough spot ' + (i + 1) + '</b><small>' + s.n + ' jolts, worst ' + s.max.toFixed(1) + ' g</small></span><input type="checkbox" class="switch" data-i="' + i + '" checked></label>').join('') + '</div>' +
      '<button class="btn go wide" id="rgGo">' + OR.ic('send') + 'Share the ticked ones</button>', b => {
      spots.forEach((s, i) => { OR.reverseName && OR.reverseName(s.lng, s.lat).then(n => { s.place = n; const el = b.querySelector('#rg' + i); if (el && n) el.textContent = 'Near ' + n; }).catch(() => { }); });
      b.querySelector('#rgGo').onclick = () => {
        let ok = 0, no = 0;
        spots.forEach((s, i) => { const c = b.querySelector('[data-i="' + i + '"]'); if (!c || !c.checked) return; (OR.native.tipAdd('rough', ('Rough road' + (s.place ? ' near ' + s.place : '')).slice(0, 40), 'Felt ' + s.n + ' jolts here', s.lat, s.lng) ? ok++ : no++); });
        OR.closeSheet(); OR.toast(ok ? ok + ' shared with riders nearby' + (no ? ', ' + no + ' not sent (no connection, or 10 tips already today)' : '') : 'Not shared: no connection yet, or 10 tips already today', 5000);
        setTimeout(OR.tipsRefresh, 800);
      };
    });
  };
})(window.OR);
