/* OpenRoad cleaner planner: hold a stop's letter and drag to reorder, swipe a stop left to delete it, and the route
   choices are swipeable cards over the map (tap one to ride it). A route is planned as soon as a start and an end are set. */
'use strict';
(function (OR) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let cards = null;

  function gestures(v, move, remove) {
    const ol = v.querySelector('ol.wps'); if (!ol) return;
    ol.querySelectorAll('li[data-k]').forEach(li => {
      const k = +li.dataset.k, badge = li.querySelector('.wp');
      let sx = 0, sy = 0, dx = 0, mode = '', timer = 0, pid = null;
      const reset = () => { clearTimeout(timer); li.style.transform = ''; li.style.opacity = ''; li.classList.remove('dragging', 'swiping'); ol.classList.remove('dragmode'); mode = ''; pid = null; };
      li.addEventListener('pointerdown', e => {
        if (e.target.closest('button.mini')) return;
        sx = e.clientX; sy = e.clientY; dx = 0; mode = ''; pid = e.pointerId;
        if (e.target.closest('.wp')) timer = setTimeout(() => { mode = 'drag'; li.classList.add('dragging'); ol.classList.add('dragmode'); try { li.setPointerCapture(pid); } catch (x) { } if (navigator.vibrate) navigator.vibrate(12); }, 280);
      });
      li.addEventListener('pointermove', e => {
        if (pid == null) return;
        const mx = e.clientX - sx, my = e.clientY - sy;
        if (mode === 'drag') { e.preventDefault(); li.style.transform = 'translateY(' + my + 'px) scale(1.02)'; return; }
        if (!mode && (Math.abs(mx) > 10 || Math.abs(my) > 10)) {
          clearTimeout(timer);
          if (Math.abs(mx) > Math.abs(my) * 1.5 && mx < 0) { mode = 'swipe'; li.classList.add('swiping'); try { li.setPointerCapture(pid); } catch (x) { } } else { pid = null; return; }
        }
        if (mode === 'swipe') { dx = Math.min(0, mx); li.style.transform = 'translateX(' + dx + 'px)'; li.style.opacity = String(Math.max(.35, 1 - Math.abs(dx) / 260)); }
      });
      const end = e => {
        clearTimeout(timer);
        if (pid == null) { reset(); return; }
        if (mode === 'drag') {
          const rows = Array.from(ol.querySelectorAll('li[data-k]')), y = e.clientY; let to = k;
          rows.forEach(r => { const b = r.getBoundingClientRect(); if (y >= b.top && y <= b.bottom) to = +r.dataset.k; });
          reset(); if (to !== k) { move(k, to); if (navigator.vibrate) navigator.vibrate(8); }
        } else if (mode === 'swipe' && dx < -90) { reset(); remove(k); if (navigator.vibrate) navigator.vibrate(8); }
        else reset();
      };
      li.addEventListener('pointerup', end); li.addEventListener('pointercancel', () => reset());
      if (badge) badge.style.touchAction = 'none';
    });
  }

  // route choices as cards over the map
  function drawCards(choose) {
    const opts = OR.plan.options || [];
    if (!cards) { cards = document.createElement('div'); cards.id = 'optCards'; document.body.appendChild(cards); }
    if (opts.length < 2 || OR.plan.route == null || (OR.ride && OR.ride.on)) { cards.hidden = true; return; }
    const keep = cards.scrollLeft;
    cards.innerHTML = opts.map((o, i) => '<button class="oc' + (i === OR.plan.choice ? ' on' : '') + '" data-i="' + i + '"><b>' + esc(o.variant) + '</b><span class="nums">' + OR.fmtDist(o.dist) + ' · ' + OR.fmtTime(OR.myTime ? OR.myTime(o.time) : o.time) + '</span><small>' + esc(OR.bendLabel ? OR.bendLabel(o.twist) : '') + (o.mwayPct ? ', ' + o.mwayPct + '% motorway' : ', no motorway') + '</small></button>').join('');
    cards.hidden = false; cards.scrollLeft = keep;
    cards.querySelectorAll('.oc').forEach(c => c.onclick = () => { if (OR.haptic) OR.haptic(); choose(+c.dataset.i); });
    const on = cards.querySelector('.oc.on'); if (on && !keep) on.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  OR.bindPlanGestures = function (v, move, remove, choose) { gestures(v, move, remove); drawCards(choose); };
  OR.on('planCleared', () => { if (cards) cards.hidden = true; });
})(window.OR);
