/* OpenRoad welcome: after an update, a swipe-through of what's new, each with a "Try it" button; on a new phone,
   a three-step setup (units, home, bike) instead of a wall of text. Shown once each; Settings, About opens it again. */
'use strict';
(function (OR) {
  const $ = OR.$, $$ = OR.$$, esc = OR.esc, A = OR.native, ic = (n, c) => OR.ic(n, c);
  const NEWS_ID = '2026-10-30';

  // ---------- the pictures (simple drawings, so they work offline and in both themes) ----------
  const ART = {
    today: '<svg viewBox="0 0 260 130" class="art"><rect x="20" y="14" width="220" height="102" rx="16" class="a-card"/><circle cx="52" cy="46" r="13" class="a-sun"/>' +
      '<rect x="76" y="36" width="110" height="10" rx="5" class="a-ink"/><rect x="76" y="52" width="78" height="7" rx="3.5" class="a-ink2"/>' +
      [0, 1, 2, 3, 4, 5, 6, 7].map(i => '<rect x="' + (36 + i * 24) + '" y="76" width="18" height="26" rx="5" class="' + (i < 5 ? 'a-ok' : i < 6 ? 'a-wait' : 'a-bad') + '"/>').join('') + '</svg>',
    hills: '<svg viewBox="0 0 260 130" class="art"><path d="M0 118 L58 52 L96 86 L150 28 L206 92 L232 70 L260 96 V130 H0Z" class="a-hill2"/><path d="M0 130 L40 96 L88 112 L140 74 L196 110 L260 90 V130Z" class="a-hill"/>' +
      '<path d="M18 126 C60 112 70 96 104 98 S150 70 170 76 S214 100 246 84" class="a-route draw"/></svg>',
    reveal: '<svg viewBox="0 0 260 130" class="art"><path d="M24 104 C52 40 92 120 124 70 S180 20 236 40" class="a-road"/><path d="M24 104 C52 40 92 120 124 70 S180 20 236 40" class="a-route draw"/>' +
      '<circle cx="24" cy="104" r="8" class="a-a"/><circle cx="236" cy="40" r="8" class="a-b"/></svg>',
    weather: '<svg viewBox="0 0 260 130" class="art"><path d="M20 100 C70 100 80 40 130 50 S200 100 240 36" class="a-route"/><path d="M98 56 C112 48 124 48 136 52 S160 66 172 76" class="a-rain"/>' +
      '<path d="M128 16c4 7 7 11 7 15a7 7 0 0 1-14 0c0-4 3-8 7-15z" class="a-drop"/><path d="M150 22c3 5 5 8 5 11a5 5 0 0 1-10 0c0-3 2-6 5-11z" class="a-drop"/>' +
      '<rect x="104" y="84" width="74" height="22" rx="11" class="a-tag"/><text x="141" y="99.5" text-anchor="middle" class="a-tagt">Rain 14:00</text></svg>',
    rec: '<svg viewBox="0 0 260 130" class="art"><path d="M10 112 H250" class="a-road2"/><g transform="translate(86 34) scale(3.6)" class="a-moto">' +
      '<circle cx="5" cy="16.5" r="3.3"/><circle cx="19" cy="16.5" r="3.3"/><path d="M5 16.5 9 13.2h5l1.8-2.6h2.6M9 13.2 7.6 9.6H4.8M14 13.2l5 3.3M12 9.6h3"/></g>' +
      '<circle cx="214" cy="34" r="12" class="a-rec"/><circle cx="214" cy="34" r="20" class="a-recr"/></svg>',
    widget: '<svg viewBox="0 0 260 130" class="art"><rect x="74" y="6" width="112" height="124" rx="16" class="a-phone"/><rect x="84" y="20" width="92" height="44" rx="10" class="a-wdg"/>' +
      '<circle cx="98" cy="34" r="6" class="a-sun"/><rect x="110" y="30" width="56" height="7" rx="3.5" class="a-wt"/><rect x="92" y="48" width="38" height="10" rx="5" class="a-wb"/><rect x="134" y="48" width="36" height="10" rx="5" class="a-wb2"/>' +
      [0, 1, 2, 3].map(i => '<rect x="' + (86 + i * 23) + '" y="76" width="16" height="16" rx="4" class="a-app"/>').join('') + '</svg>'
  };

  const NEWS = [
    { art: 'today', title: 'Should I ride today?', text: 'The Plan screen now opens with today\'s riding weather where you are: when it\'s dry, how warm, how windy. And a twisty loop from your door, planned to fit the dry hours. One tap and you\'re riding.',
      tryLabel: 'Show me', go: () => { OR.tab('plan'); OR.setPlanMode && OR.setPlanMode('ab'); OR.todayRefresh && OR.todayRefresh(); } },
    { art: 'hills', title: '3D hills', text: 'The map shows the shape of the land, and tilts into real 3D hills. Tap the new 3D button on the map, or tilt with two fingers. Riding mode tilts too, so you see the climb ahead.',
      tryLabel: 'Tilt the map', go: () => { const m = OR.map; m.easeTo({ pitch: 62, bearing: m.getBearing() - 25, zoom: Math.max(11, Math.min(13, m.getZoom())), duration: 1600 }); } },
    { art: 'reveal', title: 'Routes draw themselves', text: 'Plan a route and watch it draw along the road while the map flies over it, then settle so you can see it all.',
      tryLabel: 'Show me', go: () => { if (OR.plan.route && OR.showOptions) OR.showOptions(true); else { OR.tab('plan'); OR.toast('Search for a place or tap the map to plan a route', 5000); } } },
    { art: 'weather', title: 'Weather on the route', text: 'The route line turns blue where it\'s likely to rain when you get there, and shows storms, strong gusts and icy stretches too, with the time on the line. No more guessing which bit will be wet.',
      tryLabel: 'Show me', go: () => { if (OR.plan.route && OR.showOptions) OR.showOptions(true); else { OR.tab('plan'); OR.toast('Plan a route: its weather shows on the line', 5000); } } },
    { art: 'rec', title: 'Rides record themselves', text: 'Forgot to press record? Not any more. With OpenRoad open, set off at riding speed and it starts recording by itself, and saves the ride when you\'ve been parked a while. Near the start of a planned route, it follows the route.',
      tryLabel: 'Settings', go: () => { OR.openMore && OR.openMore('settings'); } },
    { art: 'widget', title: 'On your home screen', text: 'Add the OpenRoad widget to see today\'s riding weather without opening the app, with buttons to ride today\'s loop or start recording.',
      android: true, tryLabel: 'Add the widget', go: () => { if (A && A.pinWidget && A.pinWidget()) return; OR.toast('Press and hold an empty part of your home screen, tap Widgets, then find OpenRoad', 8000); } }
  ];

  // ---------- the slide show ----------
  function deck(slides, opts) {
    close();
    const el = document.createElement('div'); el.id = 'welcome'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', opts.label);
    el.innerHTML = '<div class="wl-box"><button class="wl-x" aria-label="Close">' + ic('x') + '</button><div class="wl-track">' + slides.map((s, i) =>
      '<section class="wl-s" aria-hidden="' + (i ? 'true' : 'false') + '">' + s.html + '</section>').join('') + '</div>' +
      '<div class="wl-foot"><div class="wl-dots">' + slides.map((_, i) => '<i class="' + (i ? '' : 'on') + '"></i>').join('') + '</div>' +
      '<div class="wl-nav"><button class="btn ghost" id="wlBack">Back</button><button class="btn pri" id="wlNext">Next</button></div></div></div>';
    document.body.appendChild(el);
    let i = 0;
    const show = n => {
      i = Math.max(0, Math.min(slides.length - 1, n));
      $('.wl-track', el).style.transform = 'translateX(' + (-100 * i) + '%)';
      $$('.wl-s', el).forEach((s, k) => { s.setAttribute('aria-hidden', k === i ? 'false' : 'true'); s.classList.toggle('on', k === i); });
      $$('.wl-dots i', el).forEach((d, k) => d.classList.toggle('on', k === i));
      $('#wlBack', el).style.visibility = i ? 'visible' : 'hidden';
      $('#wlNext', el).textContent = i === slides.length - 1 ? opts.doneLabel : 'Next';
      if (slides[i].onShow) slides[i].onShow($$('.wl-s', el)[i]);
    };
    const finish = () => { close(); if (opts.done) opts.done(); };
    $('#wlNext', el).onclick = () => { if (slides[i].before && slides[i].before() === false) return; if (i === slides.length - 1) finish(); else show(i + 1); };
    $('#wlBack', el).onclick = () => show(i - 1);
    $('.wl-x', el).onclick = finish;
    let x0 = null;
    el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 60 && !/INPUT|SELECT/.test(document.activeElement && document.activeElement.tagName)) show(i + (dx < 0 ? 1 : -1)); }, { passive: true });
    slides.forEach((s, k) => s.bind && s.bind($$('.wl-s', el)[k], { next: () => show(k + 1), finish }));
    requestAnimationFrame(() => { el.classList.add('in'); show(opts.start || 0); });
    return { finish };
  }
  function close() { const el = $('#welcome'); if (el) el.remove(); }

  OR.showNews = function () {
    const list = NEWS.filter(n => !n.android || A);
    let d = null;
    const slides = [{ html: '<div class="wl-hero">' + ic('spark') + '</div><h2>OpenRoad just got better</h2><p>' + list.length + ' new things that make every ride easier. Swipe through, or tap <b>Try it</b> on any of them.</p>' +
      '<div class="wl-list">' + list.map(n => '<span>' + esc(n.title) + '</span>').join('') + '</div>' }]
      .concat(list.map(n => ({ html: '<div class="wl-art">' + ART[n.art] + '</div><span class="wl-kicker">' + ic('spark') + 'New</span><h2>' + esc(n.title) + '</h2><p>' + esc(n.text) + '</p>' +
        '<button class="btn yellow wl-try">' + esc(n.tryLabel || 'Try it') + '</button>',
        bind: (s, ctl) => { $('.wl-try', s).onclick = () => { OR.store.set('seenNews', NEWS_ID); ctl.finish(); setTimeout(n.go, 250); }; } })));
    d = deck(slides, { label: 'What\'s new in OpenRoad', doneLabel: 'Let\'s ride', done: () => OR.store.set('seenNews', NEWS_ID) });
  };

  // ---------- first time on a new phone ----------
  OR.openSetup = function (only) {
    const c = OR.cfg, b = c.bike;
    const units = { html: '<div class="wl-hero">' + ic('moto') + '</div><h2>Welcome to OpenRoad</h2><p>Free navigation made for riding: twisty roads, tours across the Channel, group rides and your bike\'s fuel range. Three quick questions and you\'re ready.</p>' +
      '<h3 class="wl-q">Distances in</h3><div class="seg big" id="wlUnits"><button data-v="mi" class="' + (c.units !== 'km' ? 'on' : '') + '">Miles and mph</button><button data-v="km" class="' + (c.units === 'km' ? 'on' : '') + '">Kilometres</button></div>',
      bind: s => $$('#wlUnits button', s).forEach(x => x.onclick = () => { c.units = x.dataset.v; OR.saveCfg(); $$('#wlUnits button', s).forEach(y => y.classList.toggle('on', y === x)); }) };
    let picked = c.home || null;
    const homeLine = () => picked ? ic('check') + '<b>' + esc(picked.name) + '</b>' : '<span class="muted">Not set yet</span>';
    const home = { html: '<div class="wl-hero">' + ic('hills') + '</div><h2>Where\'s home?</h2><p>For today\'s riding weather and a loop from your door. It stays on this phone.</p>' +
      '<div class="wl-home" id="wlHomeNow">' + homeLine() + '</div>' +
      '<button class="btn wide" id="wlHere">' + ic('locate') + 'Use where I am now</button>' +
      '<label class="f"><span>Or search for a town or postcode</span><input id="wlQ" type="search" autocomplete="off" placeholder="e.g. Sheldon, Birmingham"></label><div id="wlRes"></div>',
      bind: s => {
        const set = p => { picked = p; c.home = p; OR.saveCfg(); $('#wlHomeNow', s).innerHTML = homeLine(); $('#wlRes', s).innerHTML = ''; OR.todayRefresh && OR.todayRefresh(true); };
        $('#wlHere', s).onclick = async () => {
          if (!OR.pos) { OR.toast('Still finding where you are. Try again in a moment, or search below', 5000); OR.gpsAtStart(); return; }
          let name = 'Home'; try { const r = OR.reverseName ? await OR.reverseName(OR.pos.lng, OR.pos.lat) : null; if (r) name = r; } catch (e) { }
          set({ lng: OR.pos.lng, lat: OR.pos.lat, name });
        };
        let t = 0; const q = $('#wlQ', s);
        q.oninput = () => { clearTimeout(t); t = setTimeout(() => { const v = q.value.trim(); if (v.length < 2) return; OR.search(v).then(list => {
          const r = $('#wlRes', s); r.innerHTML = list.slice(0, 5).map((x, i) => '<button class="li" data-i="' + i + '"><b>' + esc(x.name) + '</b><span>' + esc(x.sub || '') + '</span></button>').join('') || '<p class="small muted">Nothing found.</p>';
          $$('[data-i]', r).forEach(el => el.onclick = () => { const x = list[+el.dataset.i]; set({ lng: x.lng, lat: x.lat, name: x.name }); });
        }).catch(() => { $('#wlRes', s).innerHTML = '<p class="small muted">Search needs a signal.</p>'; }); }, 350); };
      } };
    const ids = Object.keys(OR.BIKES || {});
    const bike = { html: '<div class="wl-hero">' + ic('fuel') + '</div><h2>Your bike</h2><p>So OpenRoad can warn you before the tank runs dry. You can change this any time in Bike.</p>' +
      (ids.length ? '<div class="wl-bikes">' + ids.map(k => '<button class="btn' + (b.profile === k ? ' on' : '') + '" data-bk="' + k + '">' + esc(OR.BIKES[k].short) + '</button>').join('') + '</div>' : '') +
      '<label class="f"><span>Name</span><input id="wlName" value="' + esc(b.name || '') + '" placeholder="e.g. Low Rider S"></label>' +
      '<div class="two"><label class="f"><span>Tank (litres)</span><input id="wlTank" type="number" inputmode="decimal" value="' + esc(b.tankL || '') + '"></label>' +
      '<label class="f"><span>Miles per gallon</span><input id="wlMpg" type="number" inputmode="decimal" value="' + esc(b.mpg || '') + '"></label></div>',
      bind: s => {
        const fill = () => { $('#wlName', s).value = b.name || ''; $('#wlTank', s).value = b.tankL || ''; $('#wlMpg', s).value = b.mpg || ''; };
        $$('[data-bk]', s).forEach(x => x.onclick = () => { OR.applyBike(x.dataset.bk); fill(); $$('[data-bk]', s).forEach(y => y.classList.toggle('on', y === x)); OR.toast('Set up as ' + OR.BIKES[x.dataset.bk].short); });
        const keep = (id, k, num) => { $('#' + id, s).onchange = e => { const v = e.target.value.trim(); b[k] = num ? (v === '' ? '' : +v) : v; OR.saveCfg(); }; };
        keep('wlName', 'name'); keep('wlTank', 'tankL', true); keep('wlMpg', 'mpg', true);
      } };
    const done = () => { OR.store.set('seenIntro', true); OR.store.set('seenNews', NEWS_ID); OR.renderAll && OR.renderAll(); OR.todayRefresh && OR.todayRefresh(true); };
    if (only === 'home') { deck([home], { label: 'Set your home', doneLabel: 'Done', done }); return; }
    deck([units, home, bike], { label: 'Set up OpenRoad', doneLabel: 'Let\'s ride', done });
  };

  OR.welcomeBoot = function () {
    setTimeout(() => {
      if (OR.ride && OR.ride.on) return;
      if (!OR.store.get('seenIntro', false)) OR.openSetup();
      else if (OR.store.get('seenNews', '') !== NEWS_ID) OR.showNews();
    }, 900);
  };
})(window.OR);
