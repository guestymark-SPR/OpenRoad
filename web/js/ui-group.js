/* OpenRoad group ride screens: start or join a group, see who is where, quick messages, ride to a rider. */
'use strict';
(function (OR) {
  const $ = OR.$, $$ = OR.$$, esc = OR.esc, ic = (n, c) => OR.ic(n, c);
  const G = () => OR.cfg.group = OR.cfg.group || {};
  let pageBox = null;

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
      '<div class="joinrow">' + OR.field('gCode', 'Or join with a code', g.lastCode || '', 'text', 'e.g. 7KQ4-9MZT-H2XB') + '<button id="gJoin" class="btn">Join</button></div>' +
      '<div class="card note"><b>How it works</b><p class="small">Starting a group gives you a code to send to your mates. Anyone with the code can see the group, so only share it with the people riding. ' +
      'Positions are encrypted with the code on your phone before they leave it, and pass through free public relay servers (HiveMQ and EMQX), which can\'t read them. Those servers are free test services with no guarantee they\'ll always be up, so the app uses both at once. ' +
      'It sends your position every 5 seconds when moving and every 30 seconds when stopped, using about 1 to 3 MB of data an hour. Leaving the group removes your position.</p></div>';
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
      '<button id="gShare" class="btn small">' + ic('share') + 'Send code</button></div>' +
      (lost.length ? '<div class="card warnc"><b>' + lost.map(r => esc(r.n)).join(', ') + ' not heard from for 3 minutes or more.</b><p class="small">They may have no signal or have stopped the app. They\'re shown where they were last seen.</p></div>' : '') +
      '<button id="gAll" class="btn wide">' + ic('map') + 'Show everyone on the map</button>' +
      '<h3 class="gh">Riders (' + (rs.length + 1) + ' including you)</h3>' +
      (rs.length ? '<div class="riders">' + rs.map(riderRow).join('') + '</div>' : '<p class="small muted">Nobody else yet. Send them the code: they open Rides, Group ride, and join with it.</p>') +
      '<h3 class="gh">Quick message to the group</h3>' + quickTiles() + msgList(st) +
      '<button id="gLeave" class="btn wide ghost">Leave the group</button>' +
      '<p class="small muted">Messages and warnings are read out, with the screen off too. Turn voice off in Settings to stop them.</p>';
    bindCommon(box);
    $('#gShare', box).onclick = () => OR.share(OR.group.shareText(st.code), 'OpenRoad group ride');
    $('#gAll', box).onclick = showAll;
    $('#gLeave', box).onclick = () => { if (!confirm('Leave the group? The others will stop seeing you.')) return; OR.group.leave(); setTimeout(() => OR.pageGroup(box), 700); };
  }

  // a quick sheet for use while riding (from Ride options or the map button)
  OR.groupSheet = function () {
    const st = OR.group.state;
    if (!st.on) return OR.openMore('group');
    const rs = st.riders.slice().sort((a, b) => (OR.riderInfo(a).dist || 0) - (OR.riderInfo(b).dist || 0));
    OR.sheet('<h2>Group ride</h2>' + quickTiles() + (rs.length ? '<div class="riders">' + rs.map(riderRow).join('') + '</div>' : '<p class="small muted">Nobody else in the group yet.</p>') +
      '<button id="gsAll" class="btn wide">Show everyone</button><button id="gsMore" class="btn wide ghost">Group page</button>', b => {
      bindCommon(b);
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
      '<div class="row"><button class="btn pri" data-to="' + r.id + '">Ride to ' + esc(r.n || 'them') + '</button><button class="btn" id="rtAll">Show everyone</button></div>', b => {
      bindCommon(b);
      $('#rtAll', b).onclick = () => { OR.closeSheet(); showAll(); };
    });
  });

  // keep the page, the map button and the Rides button up to date
  OR.on('group', st => {
    const fb = $('#groupBtn');
    if (fb) {
      fb.hidden = !st.on;
      if (st.on) {
        const lost = st.riders.filter(r => OR.riderInfo(r).stale).length;
        fb.dataset.n = st.riders.length; fb.classList.toggle('alert', lost > 0);
        if (!fb.onclick) fb.onclick = () => OR.groupSheet();
      }
    }
    const v = $('#v-more');
    if (pageBox && document.body.contains(pageBox) && v && !v.closest('[hidden]')) {
      const typing = document.activeElement && pageBox.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName);
      if (st.on && !typing) { const sc = $('#views').scrollTop; inGroup(pageBox, st); $('#views').scrollTop = sc; }
    }
    const gr = $('#groupRide');
    if (gr) gr.innerHTML = ic('group') + (st.on ? 'Group ride: ' + st.riders.length + ' other' + (st.riders.length === 1 ? '' : 's') : 'Group ride');
  });
})(window.OR);
