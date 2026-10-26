/* OpenRoad group ride screens: start or join a group, see who is where, quick messages, ride to a rider. */
'use strict';
(function (OR) {
  const $ = OR.$, $$ = OR.$$, esc = OR.esc, ic = (n, c) => OR.ic(n, c);
  const G = () => OR.cfg.group = OR.cfg.group || {};
  let pageBox = null, lastSig = '';

  function dot(c) { return '<span class="rdot" style="--c:' + esc(c || '#e53935') + '"></span>'; }
  function serverLine(st) {
    const sv = Object.values(st.servers || {}), on = sv.filter(x => x === 'online').length;
    if (!sv.length) return '<span class="gst wait">Connecting…</span>';
    return on ? '<span class="gst ok">Connected' + (sv.length > 1 ? ' (' + on + ' of ' + sv.length + ' servers)' : '') + '</span>' : '<span class="gst bad">No connection. Retrying, and positions send as soon as there\'s signal.</span>';
  }
  function riderRow(r) {
    const i = OR.riderInfo(r), bits = [];
    if (i.dist != null) bits.push('<b>' + OR.fmtDist(i.dist) + '</b> ' + i.dir);
    if (!i.stale) bits.push(i.moving ? OR.speed(r.s) + ' ' + OR.speedUnit() : 'stopped');
    bits.push('seen ' + i.seen);
    if (r.b >= 0) bits.push('battery ' + r.b + '%');
    return '<div class="rider' + (i.stale ? ' lost' : '') + '">' + dot(r.c) + '<div class="ri"><b>' + esc(r.n || 'Rider') + '</b>' +
      (i.stale ? '<span class="lostx">Not heard from for ' + i.seen.replace(' ago', '') + '. Shown where last seen.</span>' : '') +
      '<span>' + bits.join(' · ') + '</span></div>' +
      '<div class="rb"><button class="btn small" data-show="' + r.id + '">Show</button><button class="btn small pri" data-to="' + r.id + '">Ride to</button></div></div>';
  }
  function msgList(st) {
    const m = (st.msgs || []).slice(-12).reverse();
    if (!m.length) return '';
    return '<h3 class="gh">Messages</h3><ol class="gmsgs">' + m.map(x => '<li class="' + (x.sys ? 'sys' : x.mine ? 'mine' : '') + '">' + (x.sys ? '' : dot(x.c)) +
      '<span><b>' + esc(x.n) + '</b> ' + esc(x.text) + '</span><time>' + OR.clock(new Date(x.t)) + '</time></li>').join('') + '</ol>';
  }
  function quickTiles() {
    return '<div class="tiles qm">' + OR.QUICK.map(q => '<button class="tile" data-q="' + q[0] + '">' + OR.badge(q[2], q[3]) + '<span>' + q[1] + '</span></button>').join('') + '</div>';
  }

  function showRider(id) {
    const r = OR.group.state.riders.find(x => x.id === id); if (!r) return;
    if (OR.ride.on) { OR.ride.follow = false; const rc = $('#recentre'); if (rc) rc.hidden = false; }
    OR.map.flyTo({ center: [r.lo, r.la], zoom: Math.max(OR.map.getZoom(), 13) });
    if (innerWidth < 900) $('#panel').classList.remove('open');
  }
  function rideTo(id) {
    const r = OR.group.state.riders.find(x => x.id === id); if (!r) return;
    OR.closeSheet();
    if (OR.ride.on) { OR.toast('End this ride first, or use Show to see where ' + (r.n || 'they') + ' are.', 6000); return showRider(id); }
    if (OR.routeTo([r.lo, r.la], (r.n || 'Rider') + '\'s position')) OR.toast('Route to where ' + (r.n || 'they') + ' were ' + OR.riderInfo(r).seen + '. They may have moved on.', 6000);
  }
  function showAll() {
    const st = OR.group.state, pts = st.riders.map(r => [r.lo, r.la]);
    if (OR.pos) pts.push([OR.pos.lng, OR.pos.lat]);
    if (!pts.length) return OR.toast('Nobody else in the group yet');
    if (OR.ride.on) { OR.ride.follow = false; const rc = $('#recentre'); if (rc) rc.hidden = false; }
    if (pts.length === 1) OR.map.flyTo({ center: pts[0], zoom: 13 }); else OR.map.fitBounds(OR.bbox(pts), { padding: 90, maxZoom: 15, pitch: 0, bearing: 0 });
    if (innerWidth < 900) $('#panel').classList.remove('open');
  }
  function bindCommon(b) {
    $$('[data-show]', b).forEach(x => x.onclick = () => { OR.closeSheet(); showRider(x.dataset.show); });
    $$('[data-to]', b).forEach(x => x.onclick = () => rideTo(x.dataset.to));
    $$('[data-q]', b).forEach(x => x.onclick = () => {
      const q = OR.QUICK.find(k => k[0] === x.dataset.q);
      if (q[0] === 'help' && !confirm('Tell the group you need help? They\'ll get your position.')) return;
      OR.group.say(q[0]); OR.toast('Sent: ' + q[1]);
    });
  }

  // ---------- the Group ride page ----------
  OR.pageGroup = function (box) {
    pageBox = box;
    const st = OR.group ? OR.group.state : { on: false };
    if (!OR.groupAvailable()) {
      box.innerHTML = '<p>Group ride needs the OpenRoad Android app. Everyone in the group has it open with location allowed.</p>';
      return;
    }
    if (st.on) return inGroup(box, st);
    const g = G();
    box.innerHTML = '<p class="small">Everyone in the group sees each other live on the map, with names, so if the pack splits or someone takes a wrong turn you can see where they are. It keeps sharing with the screen off.</p>' +
      OR.field('gName', 'Your name on the map', g.name || '', 'text', 'e.g. Mark') +
      '<label class="f"><span>Your colour</span><div class="swatches">' + OR.GROUP_COLOURS.map(c => '<button type="button" class="sw' + (c === (g.colour || OR.GROUP_COLOURS[0]) ? ' on' : '') + '" data-c="' + c + '" style="--c:' + c + '" aria-label="Colour"></button>').join('') + '</div></label>' +
      '<label class="f"><span>Tell me when a rider is more than</span><select id="gSplit">' + [1, 2, 3, 5, 10].map(n => '<option value="' + n + '"' + (n === (parseFloat(g.splitMi) || 2) ? ' selected' : '') + '>' + (OR.cfg.units === 'km' ? Math.round(n * 1.609) + ' km' : n + (n === 1 ? ' mile' : ' miles')) + ' away</option>').join('') + '</select></label>' +
      '<button id="gNew" class="btn wide pri">' + ic('group') + 'Start a new group</button>' +
      (OR.native.scanQr ? '<button id="gScan" class="btn wide">' + ic('qr') + 'Scan a QR code to join</button>' : '') +
      '<div class="joinrow">' + OR.field('gCode', 'Or type the code', g.lastCode || '', 'text', 'e.g. 7KQ4-9MZT-H2XB') + '<button id="gJoin" class="btn">Join</button></div>' +
      '<div class="card note"><b>How it works</b><p class="small">Starting a group gives you a code to send to your mates. Anyone with the code can see the group, so only share it with the people riding. ' +
      'Positions are encrypted with the code on your phone before they leave it, and pass through free public relay servers (HiveMQ and EMQX), which can\'t read them. Those servers are free test services with no guarantee they\'ll always be up, so the app uses both at once. ' +
      'It sends your position every 5 seconds when moving and every 30 seconds when stopped, using about 1 to 3 MB of data an hour. Leaving the group removes your position.</p></div>';
    { const ev = document.createElement('div'); ev.innerHTML = OR.eventsHtml ? OR.eventsHtml() : ''; box.insertBefore(ev, box.querySelector('.card.note')); OR.bindEvents && OR.bindEvents(ev); }
    const save = () => { g.name = $('#gName', box).value.trim().slice(0, 24); g.splitMi = parseFloat($('#gSplit', box).value); OR.saveCfg(); };
    $('#gName', box).onchange = save; $('#gSplit', box).onchange = save;
    $$('.sw', box).forEach(s => s.onclick = () => { $$('.sw', box).forEach(x => x.classList.remove('on')); s.classList.add('on'); g.colour = s.dataset.c; OR.saveCfg(); });
    const go = code => {
      save();
      if (!g.name) { OR.toast('Put your name in first, so the others know who you are'); $('#gName', box).focus(); return; }
      g.lastCode = OR.group.pretty(code); OR.group.start(code);
      OR.toast('Joining the group…'); setTimeout(() => OR.pageGroup(box), 600);
    };
    $('#gNew', box).onclick = () => go(OR.group.newCode());
    const sc = $('#gScan', box); if (sc) sc.onclick = () => { save(); OR.native.scanQr(); };
    $('#gJoin', box).onclick = () => {
      const c = $('#gCode', box).value;
      if (!OR.group.codeOk(c)) { OR.toast('That code looks too short. It\'s 12 letters and numbers, like 7KQ4-9MZT-H2XB.', 6000); return; }
      go(c);
    };
  };
  function inGroup(box, st) {
    const lost = st.riders.filter(r => OR.riderInfo(r).stale);
    const rs = st.riders.slice().sort((a, b) => (OR.riderInfo(a).dist || 0) - (OR.riderInfo(b).dist || 0));
    box.innerHTML = '<div class="gcard">' + dot(st.colour) + '<div><span class="small">Group code</span><b class="gcode">' + esc(OR.group.pretty(st.code)) + '</b>' + serverLine(st) + '</div>' +
      '<div class="gbtns"><button id="gQr" class="btn small pri">' + ic('qr') + 'QR code</button><button id="gShare" class="btn small">' + ic('share') + 'Send link</button></div></div>' +
      (lost.length ? '<div class="card warnc"><b>' + lost.map(r => esc(r.n)).join(', ') + ' not heard from for 3 minutes or more.</b><p class="small">They may have no signal or have stopped the app. They\'re shown where they were last seen.</p></div>' : '') +
      '<label class="f"><span>My role in the group</span><select id="gRole"><option value="">Rider</option><option value="lead">Leader (out front)</option><option value="sweep">Sweep (back marker)</option></select></label>' +
      roleLine(st) +
      '<button id="gChat" class="btn wide pri">' + ic('chat') + 'Group chat' + (st.unread ? ' (' + st.unread + ' new)' : '') + '</button>' +
      '<button id="gAll" class="btn wide">' + ic('map') + 'Show everyone on the map</button>' +
      routeSection(st) + meetSection(st) + hazSection() +
      '<h3 class="gh">Riders (' + (rs.length + 1) + ' including you)</h3>' +
      (rs.length ? '<div class="riders">' + rs.map(riderRow).join('') + '</div>' : '<p class="small muted">Nobody else yet. Send them the code: they open the Group tab and scan your QR code or type the code.</p>') +
      '<h3 class="gh">Quick message to the group</h3>' + quickTiles() + msgList(st) +
      '<button id="gLeave" class="btn wide ghost">Leave the group</button>' +
      '<p class="small muted">Messages and warnings are read out, with the screen off too. Turn voice off in Settings to stop them.</p>';
    bindCommon(box);
    $('#gShare', box).onclick = () => OR.share(OR.group.shareText(st.code), 'OpenRoad group ride');
    $('#gQr', box).onclick = () => OR.showGroupQr();
    $('#gAll', box).onclick = showAll;
    $('#gChat', box).onclick = () => OR.openChat();
    $('#gRole', box).value = G().role || '';
    $('#gRole', box).onchange = e => { OR.group.setRole(e.target.value); OR.toast(e.target.value === 'sweep' ? 'You\'re the sweep. You\'ll hear when anyone drops behind you.' : e.target.value === 'lead' ? 'You\'re the leader. The sweep sees how far ahead you are.' : 'Role set'); };
    bindShared(box, st);
    const hn = $('#gHazNow', box); if (hn) hn.onclick = () => OR.hazardSheet();
    $('#gLeave', box).onclick = () => { if (!confirm('Leave the group? The others will stop seeing you.')) return; OR.group.leave(); setTimeout(() => OR.pageGroup(box), 700); };
  }

  // ---------- QR codes ----------
  OR.showGroupQr = function () {
    const st = OR.group.state; if (!st.on) return;
    const img = OR.native.qrImage ? OR.native.qrImage(OR.group.joinLink(st.code)) : '';
    OR.sheet('<h2>' + ic('qr') + 'Scan to join</h2>' + (img ? '<img class="qrimg" src="' + img + '" alt="QR code for the group ride">' : '<p>QR codes need the Android app.</p>') +
      '<p class="gcode center">' + esc(OR.group.pretty(st.code)) + '</p><p class="small muted center">Riders open OpenRoad, go to the Group tab, and tap "Scan a QR code to join". It joins them straight away. They can also type the code underneath.</p>' +
      '<button id="qrShare" class="btn wide">' + ic('share') + 'Send the code by message instead</button>', b => { $('#qrShare', b).onclick = () => OR.share(OR.group.shareText(st.code), 'OpenRoad group ride'); });
  };
  // join from a scanned code or an opened link, asking for your name first if it isn't set
  OR.joinFromCode = function (code) {
    if (!code) return OR.toast('That QR code isn\'t an OpenRoad group ride', 5000);
    const st = OR.group.state, g = G();
    if (st.on && OR.group.pretty(st.code) === code) { OR.openMore('group'); return OR.toast('You\'re already in this group'); }
    const go = () => {
      if (st.on) OR.group.leave();
      g.lastCode = code; OR.saveCfg();
      setTimeout(() => { OR.group.start(code); OR.toast('Joining the group…'); setTimeout(() => OR.openMore('group'), 700); }, st.on ? 800 : 0);
    };
    if (g.name) { if (!st.on || confirm('Leave your current group and join ' + code + '?')) go(); return; }
    OR.sheet('<h2>Join the group ride</h2><p>Group code <b>' + esc(code) + '</b></p>' + OR.field('jName', 'Your name on the map', '', 'text', 'e.g. Mark') + '<button id="jGo" class="btn wide pri">Join</button>', b => {
      $('#jGo', b).onclick = () => { const n = $('#jName', b).value.trim().slice(0, 24); if (!n) return OR.toast('Put your name in first'); g.name = n; OR.saveCfg(); OR.closeSheet(); go(); };
    });
  };
  window.onQrScanned = text => { if (text == null) return; if (/event\//i.test(text)) return OR.showEvent(OR.group.codeFrom(text), true); OR.joinFromCode(OR.group.codeFrom(text)); };
  window.onJoinLink = url => OR.joinFromCode(OR.group.codeFrom(decodeURIComponent(url)));

  // ---------- roles ----------
  // who is further from the leader than me (when I'm the sweep)
  function behindMe(st) {
    const lead = OR.group.leader(); if (!lead || !OR.pos || st.role !== 'sweep') return [];
    const mine = OR.dist([OR.pos.lng, OR.pos.lat], [lead.lo, lead.la]);
    return st.riders.filter(r => r !== lead && r.age <= OR.GROUP_LOST && OR.dist([lead.lo, lead.la], [r.lo, r.la]) > mine + 600);
  }
  function roleLine(st) {
    if (st.role !== 'sweep') return '';
    const lead = OR.group.leader();
    if (!lead) return '<p class="small muted">Nobody has chosen Leader yet. Once they do, you\'ll see how far ahead they are and hear when anyone drops behind you.</p>';
    const i = OR.riderInfo(lead), b = behindMe(st);
    return '<div class="card ' + (b.length ? 'warnc' : 'okc') + '"><b>' + esc(lead.n) + ' (leader) is ' + (i.dist != null ? OR.fmtDist(i.dist) + ' ' + i.dir : 'ahead') + '</b>' +
      '<p class="small">' + (b.length ? esc(b.map(r => r.n).join(', ')) + (b.length === 1 ? ' has' : ' have') + ' dropped behind you.' : 'Everyone is between you and the leader.') + '</p></div>';
  }

  function hazSection() {
    const hz = OR.groupHazards ? OR.groupHazards() : [];
    return '<h3 class="gh">Hazards</h3>' + (hz.length ? '<div class="list">' + hz.slice().sort((a, b) => b.t - a.t).map(h => '<div class="li"><b>' + ic('warn') + esc((OR.HAZARDS.find(x => x[0] === h.k) || [0, 'Hazard'])[1]) + '</b><span>' + (h.x ? esc(h.x) + ' · ' : '') + (h.mine ? 'you' : esc(h.n)) + ', ' + OR.clock(new Date(h.t)) + (OR.pos ? ' · ' + OR.fmtDist(OR.dist([OR.pos.lng, OR.pos.lat], [h.lo, h.la])) + ' away' : '') + '</span></div>').join('') + '</div>' : '<p class="small muted">None marked. While riding, tap the warning button in the ride bar to mark gravel, diesel, a pothole and so on: riders behind you are warned as they get close.</p>') +
      '<button class="btn wide" id="gHazNow">' + ic('warn') + 'Mark a hazard here</button>';
  }
  // ---------- shared routes ----------
  function routeSection(st) {
    const mine = (st.routes || []).find(r => r.id === st.me), others = (st.routes || []).filter(r => r.id !== st.me), plan = OR.plan.route;
    let h = '<h3 class="gh">Route</h3>';
    others.forEach(r => { h += '<div class="card"><b>' + dot(r.c) + ' ' + esc(r.n) + '\'s route: ' + esc(r.name) + '</b><p class="small">' + OR.fmtDist(r.dist) + ', about ' + OR.fmtTime(r.time) + '. Shared ' + OR.clock(new Date(r.t)) + '.</p>' +
      '<div class="row"><button class="btn small" data-rload="' + r.id + '">Show it</button><button class="btn small go" data-rride="' + r.id + '">Ride it</button></div></div>'; });
    if (mine) h += '<div class="card okc"><b>You\'re sharing: ' + esc(mine.name) + '</b><p class="small">Everyone in the group can load it, including anyone who joins later.</p><div class="row">' +
      (plan && plan.name !== mine.name ? '<button class="btn small" id="gShareR">Share the route on the map instead</button>' : '') + '<button class="btn small ghost" id="gUnshareR">Stop sharing</button></div></div>';
    else if (plan) h += '<button id="gShareR" class="btn wide">' + ic('share') + 'Share my planned route: ' + esc(plan.name || 'route') + ' (' + OR.fmtDist(plan.dist) + ')</button>';
    else if (!others.length) h += '<p class="small muted">Plan a route on the Plan tab, then come back here to share it. Everyone gets exactly the same roads and turn-by-turn.</p>';
    return h;
  }
  function sharedRoute(id) { const r = (OR.group.state.routes || []).find(x => x.id === id); return r && r.route ? OR.unpackRoute(r.route) : null; }
  OR.on('groupRoute', r => {
    OR.sheet('<h2>' + dot(r.c) + ' ' + esc(r.n) + ' shared a route</h2><p><b>' + esc(r.name) + '</b>: ' + OR.fmtDist(r.dist) + ', about ' + OR.fmtTime(r.time) + '.</p>' +
      '<div class="row"><button class="btn pri" data-rload="' + r.id + '">Show it</button><button class="btn go" data-rride="' + r.id + '">Ride it now</button></div><button class="btn wide ghost" id="rLater">Later</button>', b => {
      bindShared(b, OR.group.state); $('#rLater', b).onclick = OR.closeSheet;
    });
  });

  // ---------- regroup point ----------
  function meetSection(st) {
    const pt = OR.group.meet();
    let h = '<h3 class="gh">Regroup point</h3>';
    if (pt) {
      const a = OR.group.atMeet(pt), d = OR.pos ? OR.dist([OR.pos.lng, OR.pos.lat], [pt.lo, pt.la]) : null;
      h += '<div class="card ' + (a.there === a.of ? 'okc' : '') + '"><b>' + esc(pt.name) + '</b><p class="small">Set by ' + (pt.id === st.me ? 'you' : esc(pt.n)) + ' at ' + OR.clock(new Date(pt.t)) + (d != null ? (d <= 250 ? '. You\'re there' : '. ' + OR.fmtDist(d) + ' from you') : '') + '.<br><strong>' + a.there + ' of ' + a.of + ' there</strong>' + (a.there === a.of ? ': everyone\'s in.' : '.') + '</p>' +
        '<div class="row"><button class="btn small" id="gMeetShow">Show</button><button class="btn small pri" id="gMeetGo">Route there</button>' + (pt.id === st.me ? '<button class="btn small ghost" id="gMeetClear">Remove</button>' : '') + '</div></div>';
    }
    h += '<div class="row"><button id="gMeetHere" class="btn small">' + ic('flag') + (pt ? 'Move it to here' : 'Regroup here') + '</button><button id="gMeetPick" class="btn small">' + ic('map') + 'Pick on the map</button></div>';
    return h;
  }
  function meetHere() {
    if (!OR.pos) return OR.toast('Waiting for your position');
    OR.reverseName(OR.pos.lng, OR.pos.lat).catch(() => null).then(n => { OR.group.setMeet([OR.pos.lng, OR.pos.lat], n || 'Here'); OR.toast('Regroup point set. Everyone is told.'); });
  }
  function meetPick() {
    OR.toast('Tap the map where everyone should meet', 6000);
    if (innerWidth < 900) $('#panel').classList.remove('open');
    OR.pickHook = p => { OR.group.setMeet([p.lng, p.lat], p.name); OR.toast('Regroup point set: ' + p.name); };
  }
  function bindShared(b, st) {
    $$('[data-rload]', b).forEach(x => x.onclick = () => { const r = sharedRoute(x.dataset.rload); if (!r) return; OR.closeSheet(); OR.loadRoute(r); });
    $$('[data-rride]', b).forEach(x => x.onclick = () => { const r = sharedRoute(x.dataset.rride); if (!r) return; OR.closeSheet(); if (OR.ride.on) return OR.toast('End this ride first'); OR.startRideUi(r); });
    const on = (id, fn) => { const e = $('#' + id, b); if (e) e.onclick = fn; };
    on('gShareR', () => { const r = OR.plan.route; if (!r) return; OR.group.shareRoute(r); OR.toast('Route shared with the group'); });
    on('gUnshareR', () => OR.group.unshareRoute());
    on('gMeetHere', meetHere); on('gMeetPick', meetPick);
    on('gMeetClear', () => OR.group.clearMeet());
    on('gMeetShow', () => { const pt = OR.group.meet(); if (!pt) return; OR.closeSheet(); OR.map.flyTo({ center: [pt.lo, pt.la], zoom: 14 }); if (innerWidth < 900) $('#panel').classList.remove('open'); });
    on('gMeetGo', () => { const pt = OR.group.meet(); if (!pt) return; OR.closeSheet(); if (OR.ride.on) return OR.toast('End this ride first, or use Show'); OR.routeTo([pt.lo, pt.la], pt.name); });
  }

  // a quick sheet for use while riding (from Ride options or the map button)
  OR.groupSheet = function () {
    const st = OR.group.state;
    if (!st.on) return OR.openMore('group');
    const rs = st.riders.slice().sort((a, b) => (OR.riderInfo(a).dist || 0) - (OR.riderInfo(b).dist || 0));
    OR.sheet('<h2>Group ride</h2>' + quickTiles() + (rs.length ? '<div class="riders">' + rs.map(riderRow).join('') + '</div>' : '<p class="small muted">Nobody else in the group yet.</p>') +
      roleLine(st) + '<button id="gMeetHere" class="btn wide">' + ic('flag') + 'Regroup here</button><button id="gsHaz" class="btn wide">' + ic('warn') + 'Mark a hazard here</button>' +
      '<button id="gsAll" class="btn wide">Show everyone</button><button id="gsMore" class="btn wide ghost">Group page</button>', b => {
      bindCommon(b); bindShared(b, st);
      $('#gsHaz', b).onclick = () => { OR.closeSheet(); OR.hazardSheet(); };
      $('#gsAll', b).onclick = () => { OR.closeSheet(); showAll(); };
      $('#gsMore', b).onclick = () => { OR.closeSheet(); OR.openMore('group'); };
    });
  };

  // tap a rider on the map
  OR.on('riderTap', id => {
    const r = OR.group.state.riders.find(x => x.id === id); if (!r) return;
    const i = OR.riderInfo(r);
    OR.sheet('<h2>' + dot(r.c) + ' ' + esc(r.n || 'Rider') + '</h2>' + (i.stale ? '<div class="card warnc"><b>Not heard from for ' + i.seen.replace(' ago', '') + '</b><p class="small">This is where they were last seen.</p></div>' : '') +
      '<div class="stats">' + (i.dist != null ? '<div><b>' + OR.fmtDist(i.dist) + '</b><span>' + i.dir + ' of you</span></div>' : '') +
      '<div><b>' + (i.moving ? OR.speed(r.s) : 0) + '</b><span>' + OR.speedUnit() + '</span></div><div><b>' + i.seen + '</b><span>last update</span></div>' + (r.b >= 0 ? '<div><b>' + r.b + '%</b><span>battery</span></div>' : '') + '</div>' +
      '<button class="btn wide go" id="rtChase">' + ic('moto') + 'Catch up with ' + esc(r.n || 'them') + '</button>' + '<div class="row"><button class="btn" id="rtMsg">' + ic('chat') + 'Message</button><button class="btn pri" data-to="' + r.id + '">Ride to ' + esc(r.n || 'them') + '</button><button class="btn" id="rtAll">Show everyone</button></div>', b => {
      bindCommon(b);
      $('#rtAll', b).onclick = () => { OR.closeSheet(); showAll(); };
      $('#rtMsg', b).onclick = () => { OR.closeSheet(); OR.chatTo(r.id); };
      $('#rtChase', b).onclick = () => OR.catchUp(r.id);
    });
  });

  // keep the page, the map button and the Rides button up to date
  OR.on('group', st => {
    const fb = $('#groupBtn');
    if (fb) {
      fb.hidden = !st.on;
      if (st.on) {
        const lost = st.riders.filter(r => OR.riderInfo(r).stale).length, n = st.riders.length;
        fb.innerHTML = ic('group') + '<span><b>' + n + ' rider' + (n === 1 ? '' : 's') + '</b>' + (st.unread ? ' · ' + st.unread + ' new' : lost ? ' · ' + lost + ' lost' : '') + '</span>';
        fb.classList.toggle('alert', lost > 0); fb.classList.toggle('unread', !!st.unread);
        if (!fb.onclick) fb.onclick = () => OR.ride.on ? OR.groupSheet() : OR.openMore('group');
      }
    }
    if (pageBox && document.body.contains(pageBox) && OR.curTab && OR.curTab() === 'group') {
      const typing = document.activeElement && pageBox.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
      // redraw only when something you'd notice has changed (not every few seconds)
      const sig = st.on ? [st.riders.map(r => r.id + (OR.riderInfo(r).stale ? 's' : '') + (OR.riderInfo(r).dist != null ? Math.round(OR.riderInfo(r).dist / 400) : '') + (r.s > 2 ? 'm' : '')).join(','), st.unread, st.role, (st.routes || []).length, (st.meets || []).map(m => m.t).join(), (OR.groupHazards ? OR.groupHazards().length : 0), Object.values(st.servers || {}).join(), (st.msgs || []).length].join('|') : 'off';
      if (!typing && sig !== lastSig) { lastSig = sig; const sc = $('#views').scrollTop; if (st.on) inGroup(pageBox, st); else OR.pageGroup(pageBox); $('#views').scrollTop = sc; }
    }
    const nb = document.querySelector('#nav [data-tab=group]'); if (nb) { nb.dataset.n = st.on ? (st.unread || '') : ''; nb.classList.toggle('live', !!st.on); }
    const gr = $('#groupRide');
    if (gr) gr.innerHTML = ic('group') + (st.on ? 'Group ride: ' + st.riders.length + ' other' + (st.riders.length === 1 ? '' : 's') : 'Group ride');
  });
})(window.OR);
