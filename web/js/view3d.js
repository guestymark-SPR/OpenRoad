/* OpenRoad 3D view: the tilt button on the map, and new routes that draw themselves along the road while the camera
   sweeps over them tilted, then settle on the whole route. */
'use strict';
(function (OR) {
  const $ = OR.$;
  OR.revealing = false;
  let anim = 0, token = 0;
  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  OR.revealOn = () => OR.cfg.reveal !== false && !reduced();
  const line = c => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } }] });

  // the start of a line, up to distance d along it
  function upto(shape, cum, d) {
    if (d <= 0) return [shape[0], shape[0]];
    let i = 1; while (i < shape.length && cum[i] < d) i++;
    if (i >= shape.length) return shape;
    const a = shape[i - 1], b = shape[i], k = (d - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    return shape.slice(0, i).concat([[a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]]);
  }

  function stop() { token++; if (anim) cancelAnimationFrame(anim); anim = 0; if (OR.revealing) { OR.revealing = false; OR.emit('revealed', null); } }
  OR.stopReveal = stop;

  // Draw route r along the road from its start, flying over it tilted, then show the alternatives and the whole route.
  // pad: the map padding the route should fit inside (the planner panel covers part of the map). Returns false if it can't.
  OR.revealRoute = function (r, alts, pad) {
    stop();
    const m = OR.map; if (!m || !r || !r.shape || r.shape.length < 2 || !OR.revealOn() || (OR.ride && OR.ride.on)) return false;
    const cum = r.cum && r.cum.length === r.shape.length ? r.cum : OR.cumulative(r.shape), L = cum[cum.length - 1];
    const turn = (() => { const b = OR.bearing(r.shape[0], r.shape[r.shape.length - 1]); return ((b + 540) % 360 - 180) > 0 ? -18 : 18; })();
    const fly = m.cameraForBounds(OR.bbox(r.shape), { padding: pad, bearing: turn, maxZoom: 13.5 });
    const end = m.cameraForBounds(OR.bbox(r.shape), { padding: pad, maxZoom: 14 });
    if (!fly || !end) return false;
    const my = ++token; OR.revealing = true;
    const full = { type: 'FeatureCollection', features: [OR.routeGeo(r)] };
    OR.setData('alts', null); OR.setData('route', line([r.shape[0], r.shape[0]]));
    const dur = Math.round(Math.min(2800, 1500 + L / 1000 * 5));
    m.easeTo({ center: fly.center, zoom: fly.zoom - 0.35, bearing: turn, pitch: OR.hills3dOn() ? 52 : 40, duration: dur, easing: t => 1 - Math.pow(1 - t, 2) });
    const t0 = performance.now();
    const tick = now => {
      if (my !== token) return;
      const k = Math.min(1, (now - t0) / dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      if (k < 1) { OR.setData('route', line(upto(r.shape, cum, e * L))); anim = requestAnimationFrame(tick); return; }
      anim = 0; OR.revealing = false;
      OR.setData('route', full); OR.setData('alts', alts);
      m.easeTo({ center: end.center, zoom: end.zoom, bearing: 0, pitch: OR.hills3dOn() ? 24 : 0, duration: 1100 });
      updateTilt(24);
      OR.emit('revealed', r);
    };
    anim = requestAnimationFrame(tick);
    return true;
  };
  OR.on('ridestart', stop);
  OR.on('planCleared', stop);

  // ---------- the tilt button ----------
  function updateTilt(p) {
    const b = $('#tiltBtn'); if (!b) return;
    const on = (p != null ? p : OR.map ? OR.map.getPitch() : 0) > 8;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function bindTilt() {
    const b = $('#tiltBtn'); if (!b || !OR.map) return setTimeout(bindTilt, 300);
    b.innerHTML = '<b>3D</b>';
    b.onclick = () => {
      const m = OR.map, flat = m.getPitch() < 8;
      if (flat && !OR.hills3dOn() && OR.cfg.hills !== false) OR.toast('Tilted. Turn on 3D hills in Map to raise the ground too', 4000);
      m.easeTo({ pitch: flat ? 60 : 0, bearing: flat ? m.getBearing() : 0, zoom: flat ? Math.max(m.getZoom(), 10.5) : m.getZoom(), duration: 900 });
      updateTilt(flat ? 60 : 0);
    };
    OR.map.on('pitchend', () => updateTilt());
    updateTilt();
  }
  if (document.readyState === 'complete') bindTilt(); else document.addEventListener('DOMContentLoaded', () => setTimeout(bindTilt, 0));
})(window.OR);
