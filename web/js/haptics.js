/* OpenRoad feel: a short buzz on taps (Settings can switch it off), and swipe up or down on the panel's handle
   or the strip above the tab bar to open and close it. */
'use strict';
(function (OR) {
  OR.hapticsOn = () => OR.cfg.haptics !== false;
  OR.haptic = ms => { try { if (OR.hapticsOn() && navigator.vibrate) navigator.vibrate(ms || 8); } catch (e) { } };
  const TAP = 'button,.tile,.tool,.opt,.li,.res,.oc,[role=button],input.switch,input[type=checkbox],.seg button,#nav button';
  document.addEventListener('pointerdown', e => {
    const t = e.target.closest && e.target.closest(TAP); if (!t || t.disabled) return;
    OR.haptic(t.classList.contains('end') || t.id === 'hEnd' ? 28 : t.classList.contains('go') ? 16 : 8);
  }, { passive: true, capture: true });

  // swipe the handle / peek strip
  let y0 = 0, x0 = 0, track = false;
  document.addEventListener('touchstart', e => { const t = e.target.closest && e.target.closest('#grab,#peek'); track = !!t && e.touches.length === 1; if (track) { y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; } }, { passive: true });
  document.addEventListener('touchend', e => {
    if (!track) return; track = false; const t = e.changedTouches[0], dy = t.clientY - y0, dx = t.clientX - x0;
    if (Math.abs(dy) < 40 || Math.abs(dy) < Math.abs(dx)) return;
    const p = document.querySelector('#panel'); if (innerWidth >= 900) return;
    if (dy < 0 && !p.classList.contains('open')) { p.classList.add('open'); OR.haptic(10); }
    else if (dy > 0 && p.classList.contains('open')) { p.classList.remove('open'); OR.haptic(10); }
  }, { passive: true });
})(window.OR);
