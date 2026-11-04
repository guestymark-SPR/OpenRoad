/* OpenRoad "where's my bike": when a ride ends, the spot is kept and shown on the map with a P pin, and on the Plan
   screen. Tap it to see how long ago and get walking directions back. It clears when your next ride starts. */
'use strict';
(function (OR) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let marker = null;
  const get = () => OR.store.get('parkedBike', null);
  const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 2 ? 'just now' : m < 90 ? m + ' minutes ago' : m < 36 * 60 ? Math.round(m / 60) + ' hours ago' : Math.round(m / 1440) + ' days ago'; };

  function draw() {
    const p = get();
    if (marker) { marker.remove(); marker = null; }
    if (!p || !OR.map) return;
    const el = document.createElement('button'); el.className = 'parkpin'; el.setAttribute('aria-label', 'Where you parked the bike');
    el.innerHTML = '<span>P</span>'; el.onclick = e => { e.stopPropagation(); OR.parkedSheet(); };
    marker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lng, p.lat]).addTo(OR.map);
  }
  OR.parkedHere = () => { const p = get(); return p; };
  OR.parkedSet = (lng, lat, name) => { OR.store.set('parkedBike', { lng, lat, t: Date.now(), name: name || '' }); draw(); if (OR.renderPlan) OR.renderPlan(); };
  OR.parkedClear = () => { OR.store.set('parkedBike', null); draw(); if (OR.renderPlan) OR.renderPlan(); };

  OR.parkedSheet = function () {
    const p = get(); if (!p) return;
    OR.sheet('<h2>' + OR.ic('moto') + 'Your bike</h2><p>Parked ' + ago(p.t) + (p.name ? ' near ' + esc(p.name) : '') + '.</p>' +
      '<div class="bigbtns"><button class="btn go" id="pkShow">' + OR.ic('flag') + 'Show on the map</button>' +
      '<a class="btn wide" id="pkWalk" href="https://www.google.com/maps/dir/?api=1&destination=' + p.lat + ',' + p.lng + '&travelmode=walking" target="_blank" rel="noopener">' + OR.ic('walk') + 'Walking directions back</a>' +
      '<button class="btn wide ghost" id="pkClear">I have the bike, forget this</button></div>', b => {
      b.querySelector('#pkShow').onclick = () => { OR.closeSheet(); OR.map.flyTo({ center: [p.lng, p.lat], zoom: 17 }); };
      b.querySelector('#pkClear').onclick = () => { OR.closeSheet(); OR.parkedClear(); OR.toast('Forgotten'); };
    });
  };

  OR.on('ridestop', saved => { if (saved && OR.pos) OR.parkedSet(OR.pos.lng, OR.pos.lat, ''); });
  OR.on('ridestart', () => { if (get()) OR.parkedClear(); });
  OR.parkedStart = draw;
  // a line for the home card
  OR.parkedHtml = () => { const p = get(); return p ? '<button class="lastride parked" id="parkedRow"><span class="lr-t">Your bike</span><b>Parked ' + ago(p.t) + '</b><small>Tap for the pin and the way back</small>' + OR.ic('chev', 'chev') + '</button>' : ''; };
  OR.parkedBind = v => { const r = v.querySelector('#parkedRow'); if (r) r.onclick = () => OR.parkedSheet(); };
})(window.OR);
