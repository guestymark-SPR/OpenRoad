/* OpenRoad group ride events: plan a ride for a date with a meeting point and a route, invite by QR code,
   see who's coming, get reminders, and start the group ride on the day with one tap. */
'use strict';
(function (OR) {
  const $ = OR.$, $$ = OR.$$, esc = OR.esc, ic = (n, c) => OR.ic(n, c), N = () => OR.native;
  const list = () => OR.store.get('events', []);
  const save = l => OR.store.set('events', l);
  const put = ev => { const l = list().filter(x => x.code !== ev.code); l.push(ev); l.sort((a, b) => a.when - b.when); save(l); };
  OR.eventLink = code => 'openroad://event/' + OR.group.pretty(code);
  const when = t => new Date(t).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const waiting = {};
  window.onEventPeek = (code, json) => { let r; try { r = JSON.parse(json); } catch (e) { r = { ok: false }; } const f = waiting[code]; delete waiting[code]; if (f) f(r); };
  const peek = (code, kind, obj) => new Promise(res => { if (!N() || !N().eventPeek) return res({ ok: false, why: 'Needs the Android app' }); waiting[code] = res; N().eventPeek(code, kind || null, obj ? JSON.stringify(obj) : ''); });

  function remind(ev) {
    if (!N() || !N().eventRemind) return;
    const d = new Date(ev.when); const eve = new Date(d); eve.setDate(eve.getDate() - 1); eve.setHours(19, 0, 0, 0);
    N().eventRemind(ev.code, eve.getTime(), 'Group ride tomorrow: ' + ev.title, 'Meet at ' + ev.meet.name + ', ' + OR.clock(d) + '. Check the forecast and fill up tonight.');
    N().eventRemind(ev.code, ev.when - 3600000, ev.title + ' in an hour', 'Meet at ' + ev.meet.name + ' at ' + OR.clock(d) + '. Open OpenRoad to start the group ride.');
  }

  // ---------- making an event ----------
  OR.eventSheet = function (draft) {
    const st = draft || { title: '', date: OR.isoDate(new Date(Date.now() + 3 * 864e5)), time: '10:00', meet: OR.pos ? { lng: OR.pos.lng, lat: OR.pos.lat, name: 'My position' } : null, route: null, notes: '' };
    const saved = OR.routes.list();
    OR.sheet('<h2>' + ic('group') + 'Plan a group ride</h2>' + OR.field('evT', 'What it is', st.title, 'text', 'e.g. Sunday breakfast run to Matlock Bath') +
      '<div class="two">' + OR.field('evD', 'Date', st.date, 'date') + '<label class="f"><span>Meet at</span><input type="time" id="evH" value="' + esc(st.time) + '"></label></div>' +
      '<label class="f"><span>Meeting point</span></label><div class="row"><button class="btn" id="evMeet">' + ic('flag') + (st.meet ? esc(st.meet.name) : 'Choose on the map') + '</button>' + (OR.pos ? '<button class="btn small ghost" id="evHere">Here</button>' : '') + '</div>' +
      '<label class="f"><span>Route</span><select id="evR"><option value="">No route (just meet up)</option>' + (OR.plan.route ? '<option value="plan"' + (st.route === 'plan' ? ' selected' : '') + '>The route I\'ve planned: ' + esc(OR.plan.route.name || '') + '</option>' : '') +
      saved.map(r => '<option value="' + r.id + '"' + (st.route === r.id ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select></label>' +
      OR.field('evN', 'Notes', st.notes, 'text', 'e.g. Full tanks please, breakfast at the Red Lion') +
      '<button class="btn wide go" id="evGo">Create and invite</button><p class="small muted" id="evMsg"></p>', b => {
      const keep = () => { st.title = $('#evT', b).value.trim(); st.date = $('#evD', b).value; st.time = $('#evH', b).value; st.route = $('#evR', b).value; st.notes = $('#evN', b).value.trim(); };
      $('#evMeet', b).onclick = () => { keep(); OR.closeSheet(); if (innerWidth < 900) $('#panel').classList.remove('open'); OR.toast('Tap the meeting point on the map, or search for it', 5000); OR.pickHook = p => { st.meet = p; OR.eventSheet(st); }; };
      const hb = $('#evHere', b); if (hb) hb.onclick = () => { keep(); OR.reverseName(OR.pos.lng, OR.pos.lat).catch(() => null).then(n => { st.meet = { lng: OR.pos.lng, lat: OR.pos.lat, name: n || 'Here' }; OR.eventSheet(st); }); };
      $('#evGo', b).onclick = async () => {
        keep();
        if (!st.title) return OR.toast('Give the ride a name');
        if (!st.meet) return OR.toast('Choose where to meet');
        const [h, m] = st.time.split(':').map(Number), d = new Date(st.date + 'T00:00:00'); d.setHours(h, m, 0, 0);
        if (d < Date.now()) return OR.toast('That time has passed');
        const r = st.route === 'plan' ? OR.plan.route : st.route ? OR.routes.get(st.route) : null;
        const pr = r ? OR.packRoute(r) : null; if (pr) { delete pr.limits; delete pr.cams; delete pr.wx; }
        const ev = { code: OR.group.newCode(), title: st.title, when: d.getTime(), meet: { lng: st.meet.lng, lat: st.meet.lat, name: st.meet.name }, notes: st.notes, route: pr, routeName: r ? r.name : '', host: (OR.cfg.group && OR.cfg.group.name) || 'The organiser' };
        $('#evGo', b).disabled = true; $('#evMsg', b).textContent = 'Saving the ride…';
        const res = await peek(ev.code, 'e', ev);
        if (!res.ok) { $('#evMsg', b).textContent = 'Couldn\'t save it online (' + (res.why || 'no connection') + '). Try again with a signal.'; $('#evGo', b).disabled = false; return; }
        ev.mine = true; ev.answers = res.answers || []; put(ev); remind(ev);
        OR.closeSheet(); OR.showEvent(ev.code);
      };
    });
  };

  // ---------- one event ----------
  OR.showEvent = async function (code, fresh) {
    let ev = list().find(x => OR.group.pretty(x.code) === OR.group.pretty(code));
    const draw = () => {
      const me = OR.store.get('eventMe', {})[ev.code], ans = ev.answers || [], yes = ans.filter(a => a.go === 'yes'), no = ans.filter(a => a.go === 'no');
      const soon = ev.when - Date.now() < 2 * 3600000 && ev.when - Date.now() > -6 * 3600000;
      const img = N() && N().qrImage ? N().qrImage(OR.eventLink(ev.code)) : '';
      OR.sheet('<h2>' + ic('group') + esc(ev.title) + '</h2><div class="evcard"><p><b>' + esc(when(ev.when)) + '</b></p><p>' + ic('flag') + ' Meet at <b>' + esc(ev.meet.name) + '</b></p>' +
        (ev.routeName ? '<p>' + ic('plan') + ' Route: <b>' + esc(ev.routeName) + '</b>' + (ev.route ? ', ' + OR.fmtDist(ev.route.dist) : '') + '</p>' : '') + (ev.notes ? '<p>' + esc(ev.notes) + '</p>' : '') + '<p class="small muted">Organised by ' + esc(ev.mine ? 'you' : ev.host) + '</p></div>' +
        '<h3 class="gh">Coming (' + (yes.length + (ev.mine ? 1 : 0)) + ')</h3><p>' + (ev.mine ? '<span class="tag okc">You</span> ' : '') + (yes.map(a => '<span class="tag okc">' + esc(a.n) + '</span>').join(' ') || (ev.mine ? '' : 'Nobody yet')) + (no.length ? '<br><span class="small muted">Can\'t make it: ' + no.map(a => esc(a.n)).join(', ') + '</span>' : '') + '</p>' +
        (ev.mine ? '' : '<div class="row"><button class="btn ' + (me === 'yes' ? 'pri' : '') + '" data-go="yes">I\'m coming</button><button class="btn ' + (me === 'no' ? 'pri' : 'ghost') + '" data-go="no">Can\'t make it</button></div>') +
        (soon ? '<button class="btn wide go" id="evStart">' + ic('moto') + 'Start the group ride</button>' : '<p class="small muted">On the day, a "Start the group ride" button appears here two hours before. You\'ll get a reminder the evening before and an hour before.</p>') +
        '<div class="row"><button class="btn" id="evMap">' + ic('map') + 'Show on map</button><button class="btn" id="evRef">' + ic('update') + 'Refresh</button></div>' +
        (img ? '<h3 class="gh">Invite riders</h3><img class="qrimg" src="' + img + '" alt="QR code for this ride"><p class="small muted center">Riders scan it in OpenRoad (Group tab, Scan a QR code), or you can send it.</p>' : '') +
        '<button class="btn wide" id="evShare">' + ic('share') + 'Send the invite</button>' + '<button class="btn wide ghost" id="evDel">' + (ev.mine ? 'Delete this ride' : 'Remove from my list') + '</button>', b => {
        $$('[data-go]', b).forEach(x => x.onclick = async () => {
          const name = (OR.cfg.group && OR.cfg.group.name) || ''; if (!name) { OR.toast('Put your name in on the Group tab first'); return; }
          x.disabled = true; const r = await peek(ev.code, 'v', { n: name, go: x.dataset.go });
          if (!r.ok) { OR.toast('No connection: try again'); x.disabled = false; return; }
          const m = OR.store.get('eventMe', {}); m[ev.code] = x.dataset.go; OR.store.set('eventMe', m);
          ev.answers = r.answers; put(ev); if (x.dataset.go === 'yes') remind(ev); OR.toast(x.dataset.go === 'yes' ? 'See you there' : 'Thanks for letting them know'); draw();
        });
        const sb = $('#evStart', b); if (sb) sb.onclick = () => startEvent(ev);
        $('#evMap', b).onclick = () => { OR.closeSheet(); OR.map.flyTo({ center: [ev.meet.lng, ev.meet.lat], zoom: 13 }); if (ev.route) { const r = OR.unpackRoute(ev.route); OR.setData('rideview', { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: r.shape } }] }); } if (innerWidth < 900) $('#panel').classList.remove('open'); };
        $('#evRef', b).onclick = async () => { const r = await peek(ev.code); if (r.ok) { if (r.event && !ev.mine) Object.assign(ev, r.event, { mine: false }); ev.answers = r.answers; put(ev); draw(); } else OR.toast('No connection'); };
        $('#evShare', b).onclick = () => OR.share('Group ride: ' + ev.title + '\n' + when(ev.when) + ', meet at ' + ev.meet.name + '.\n\nIn OpenRoad: Group tab, Scan a QR code, or "Join an event" with the code ' + OR.group.pretty(ev.code) + '.\nGet OpenRoad: https://github.com/guestymark-SPR/OpenRoad/releases/download/app/OpenRoad.apk', ev.title);
        $('#evDel', b).onclick = () => { if (!confirm(ev.mine ? 'Delete this ride? Riders who have it will still see it until they remove it.' : 'Remove this ride from your list?')) return; save(list().filter(x => x.code !== ev.code)); OR.closeSheet(); OR.renderGroupTab && OR.renderGroupTab(); };
      });
    };
    if (!ev || fresh) {
      OR.sheet('<h2>Getting the ride details…</h2><div class="spin"></div>');
      const r = await peek(code);
      if (!r.ok || !r.event) { OR.sheet('<h2>Group ride</h2><p>' + (r.ok ? 'There\'s no ride saved under that code yet. Check it with the organiser.' : 'Couldn\'t connect (' + esc(r.why || 'no signal') + '). Try again with a signal.') + '</p>'); return; }
      ev = Object.assign(ev || {}, r.event, { code: OR.group.pretty(code), answers: r.answers, mine: ev ? ev.mine : false }); put(ev);
    }
    draw();
  };
  // on the day: join the group with the event's code, show the route and set the meeting point as the regroup point
  function startEvent(ev) {
    OR.closeSheet();
    const g = OR.cfg.group = OR.cfg.group || {};
    if (!g.name) { OR.toast('Put your name in on the Group tab first'); return OR.openMore('group'); }
    OR.group.start(ev.code);
    setTimeout(() => {
      if (ev.mine) { OR.group.setMeet([ev.meet.lng, ev.meet.lat], ev.meet.name); if (ev.route) { const r = OR.unpackRoute(ev.route); OR.group.shareRoute(r); } }
      if (ev.route) { const r = OR.unpackRoute(ev.route); OR.loadRoute(r); }
      OR.openMore('group'); OR.toast('Group ride started: ' + ev.title, 5000);
    }, 1500);
  }
  OR.upcomingEvents = () => list().filter(e => e.when > Date.now() - 6 * 3600000);
  OR.eventsHtml = function () {
    const l = OR.upcomingEvents();
    return '<h3 class="gh">Planned group rides</h3>' + (l.length ? '<div class="menu">' + l.map(e => '<button data-ev="' + esc(e.code) + '">' + OR.badge('group', e.mine ? '#00703c' : '#1e88e5') + '<span><b>' + esc(e.title) + '</b><small>' + esc(when(e.when)) + ' · ' + esc(e.meet.name) + ' · ' + ((e.answers || []).filter(a => a.go === 'yes').length + (e.mine ? 1 : 0)) + ' coming</small></span>' + ic('chev', 'chev') + '</button>').join('') + '</div>' : '<p class="small muted">Plan a ride for a date, invite your mates with a QR code, and see who\'s coming.</p>') +
      '<div class="row"><button class="btn" id="evNew">' + ic('plus') + 'Plan a group ride</button><button class="btn ghost" id="evJoin">Join with a code</button></div>';
  };
  OR.bindEvents = function (box) {
    $$('[data-ev]', box).forEach(b => b.onclick = () => OR.showEvent(b.dataset.ev));
    const n = $('#evNew', box); if (n) n.onclick = () => OR.eventSheet();
    const j = $('#evJoin', box); if (j) j.onclick = () => OR.sheet('<h2>Join a planned ride</h2>' + OR.field('evCode', 'Ride code', '', 'text', 'e.g. 7KQ4-9MZT-H2XB') + '<button class="btn wide pri" id="evCodeGo">Find the ride</button>', b => {
      $('#evCodeGo', b).onclick = () => { const c = OR.group.codeFrom($('#evCode', b).value); if (!c) return OR.toast('That doesn\'t look like a ride code'); OR.showEvent(c, true); };
    });
  };
  window.onEventLink = url => { const c = OR.group.codeFrom(decodeURIComponent(url)); if (c) OR.showEvent(c, true); };
})(window.OR);
