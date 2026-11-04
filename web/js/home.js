/* OpenRoad map-first home: the Plan screen opens with "Where to?", today's riding verdict and your last ride.
   Searching happens right in the card (a sheet with recent places), so the map stays clear. */
'use strict';
(function (OR) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const recents = () => OR.store.get('recentPlaces', []);
  const remember = p => { const l = recents().filter(x => x.name !== p.name); l.unshift({ name: p.name, sub: p.sub || '', lng: p.lng, lat: p.lat }); OR.store.set('recentPlaces', l.slice(0, 6)); };

  OR.homeHtml = function () {
    const last = OR.rides && OR.rides.list ? OR.rides.list().filter(r => r.end)[0] : null;
    const home = OR.cfg.home && OR.cfg.home.lng != null ? OR.cfg.home : null;
    let h = '<button class="whereto" id="whereBtn">' + OR.ic('search') + '<span><b>Where to?</b><small>Search a place, postcode or road</small></span></button>';
    if (home) h += '<div class="chips homechips"><button class="btn small" id="goHome">' + OR.ic('home') + 'Home</button></div>';
    h += OR.parkedHtml ? OR.parkedHtml() : '';
    if (last) h += '<button class="lastride" id="lastRide"><span class="lr-t">Last ride</span><b>' + esc(last.name) + '</b><small>' + OR.fmtDist(last.dist) + ' on ' + new Date(last.start).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + '</small>' + OR.ic('chev', 'chev') + '</button>';
    return h;
  };
  OR.bindHome = function (v) {
    const w = v.querySelector('#whereBtn'); if (w) w.onclick = () => OR.whereSheet();
    if (OR.parkedBind) OR.parkedBind(v);
    const l = v.querySelector('#lastRide'); if (l) l.onclick = () => OR.tab('rides');
    const g = v.querySelector('#goHome'); if (g) g.onclick = () => OR.goTo({ lng: OR.cfg.home.lng, lat: OR.cfg.home.lat, name: 'Home' });
  };

  OR.whereSheet = function () {
    let timer = 0;
    OR.sheet('<h2>Where to?</h2><input id="whIn" type="search" class="whin" placeholder="Search places, postcodes, roads" autocomplete="off" enterkeyhint="search"><div id="whList"></div>', b => {
      const inp = b.querySelector('#whIn'), list = b.querySelector('#whList');
      const pick = r => { remember(r); OR.closeSheet(); OR.map.flyTo({ center: [r.lng, r.lat], zoom: Math.max(OR.map.getZoom(), 12) }); if (OR.placeMenu) OR.placeMenu([r.lng, r.lat], r.name); else OR.goTo(r); };
      const show = (items, title) => {
        list.innerHTML = (title ? '<h3 class="grp">' + title + '</h3>' : '') + (items.length ? '<div class="menu">' + items.map((r, i) => '<button data-i="' + i + '"><span><b>' + esc(r.name) + '</b><small>' + esc(r.sub || '') + '</small></span></button>').join('') + '</div>' : '<p class="small muted">Nothing found. Try a town, postcode or road name.</p>');
        list.querySelectorAll('[data-i]').forEach(x => x.onclick = () => pick(items[+x.dataset.i]));
      };
      const go = async () => {
        const s = inp.value.trim(); if (s.length < 2) { const r = recents(); if (r.length) show(r, 'Recent'); else list.innerHTML = ''; return; }
        const ll = OR.parseLatLon && OR.parseLatLon(s); if (ll) { show([ll]); return; }
        list.innerHTML = '<p class="small muted">Searching…</p>';
        try { show(await OR.search(s)); } catch (e) { list.innerHTML = '<p class="small muted">Search needs a signal (' + esc(e.message) + ')</p>'; }
      };
      inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(go, 400); });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(timer); go(); } });
      go(); setTimeout(() => inp.focus(), 250);
    });
  };

  // the card that peeks above the tab bar while the panel is closed: Where to? and today's verdict
  function peek() {
    const el = document.querySelector('#peek'); if (!el) return;
    if (OR.ride && OR.ride.on) { el.hidden = true; document.body.classList.remove('haspeek'); return; }
    const t = OR.todayLine && OR.todayLine();
    el.innerHTML = '<button class="whereto slim" id="pkWhere">' + OR.ic('search') + '<span><b>Where to?</b></span>' +
      (t ? '</button><button class="verdict ' + t.tone + '" id="pkDay">' + OR.ic(t.icon) + '<span><b>' + esc(t.head) + '</b></span></button>' : '</button>');
    el.hidden = false; document.body.classList.add('haspeek');
    el.querySelector('#pkWhere').onclick = () => OR.whereSheet();
    const d = el.querySelector('#pkDay'); if (d) d.onclick = () => { OR.tab('plan'); document.querySelector('#panel').classList.add('open'); };
  }
  OR.peekDraw = peek;
  OR.on('ridestart', peek); OR.on('ridestop', peek); OR.on('today', peek);
})(window.OR);
