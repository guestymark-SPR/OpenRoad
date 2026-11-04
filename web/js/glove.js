/* OpenRoad glove mode: above about 15 mph the ride screen drops to a few big buttons (voice, hazard, end) and the
   map stops being dragged by accident. Swipe up for an overview of the whole route (it comes back by itself after
   8 seconds); swipe down to put the map back on you. It comes off again when you slow to a stop. Settings can switch it off. */
'use strict';
(function (OR) {
  const $ = s => document.querySelector(s);
  const ON_MS = 6.7, OFF_MS = 2.5; // m/s: about 15 mph and 5.5 mph
  let on = false, slowSince = 0, back = 0;
  OR.gloveOn = () => OR.cfg.glove !== false;

  function set(v) {
    if (v === on) return; on = v;
    document.body.classList.toggle('glove', v);
    try { if (OR.map) { v ? OR.map.dragPan.disable() : OR.map.dragPan.enable(); } } catch (e) { }
  }
  OR.on('fix', p => {
    if (!OR.ride || !OR.ride.on || !OR.gloveOn()) { if (on) set(false); return; }
    const s = p.speed || 0;
    if (s >= ON_MS) { slowSince = 0; set(true); }
    else if (on && s < OFF_MS) { slowSince = slowSince || Date.now(); if (Date.now() - slowSince > 5000) set(false); }
    else if (on) slowSince = 0;
  });
  OR.on('ridestop', () => set(false));

  function overview() {
    const r = OR.ride && OR.ride.route; if (!r || !r.shape || !r.shape.length) return;
    OR.ride.follow = false; clearTimeout(back);
    let b = new maplibregl.LngLatBounds(r.shape[0], r.shape[0]); r.shape.forEach(q => b.extend(q));
    OR.map.fitBounds(b, { padding: { top: 80, bottom: 260, left: 40, right: 40 }, pitch: 0, bearing: 0, duration: 700 });
    back = setTimeout(recentre, 8000);
  }
  function recentre() { clearTimeout(back); if (OR.ride && OR.ride.on) { OR.ride.follow = true; const b = $('#recentre'); if (b) b.hidden = true; if (OR.haptic) OR.haptic(); } }

  // swipes anywhere on the map while in glove mode
  let sx = 0, sy = 0, st = 0;
  document.addEventListener('touchstart', e => { if (!on || e.touches.length !== 1) return; sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); }, { passive: true });
  document.addEventListener('touchend', e => {
    if (!on || !st) return; const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy; const quick = Date.now() - st < 700; st = 0;
    if (!quick || Math.abs(dy) < 70 || Math.abs(dy) < Math.abs(dx) * 1.5) return;
    if (e.target.closest && e.target.closest('#hudBar,#turn,.sheet,#sheet')) return;
    dy < 0 ? overview() : recentre();
  }, { passive: true });
  OR.gloveSwipe = d => (d === 'up' ? overview() : recentre());
  OR.gloveState = () => on;
})(window.OR);
