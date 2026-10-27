/* OpenRoad group ride: see everyone in your group on the map, live. The Android side (GroupService) does the sharing,
   with the screen off too; this reads its state, draws the riders and works out who is where. */
'use strict';
(function (OR) {
  const N = () => OR.native; // read when used (the bridge is there from the start in the app)
  OR.GROUP_COLOURS = ['#e53935', '#1e88e5', '#0e9f57', '#f5a300', '#8e24aa', '#00897b', '#ef6c00', '#d81b60', '#3949ab', '#6d4c41'];
  OR.GROUP_LOST = 180; // seconds without news before a rider shows as lost
  OR.QUICK = [['fuel', 'Stopping for fuel', 'fuel', '#e53935'], ['stop', 'Pulling over', 'park', '#1565c0'], ['wait', 'Wait for me', 'time', '#ef8f00'],
    ['lost', 'I\'m lost', 'near', '#8e24aa'], ['ok', 'All good', 'check', '#0e9f57'], ['go', 'Setting off', 'moto', '#00897b'], ['help', 'Need help', 'helmet', '#c62828']];
  // ready-made chat messages, one tap to send (changed in More, Chat)
  OR.CHAT_PRESETS = ['Yes', 'No', 'OK 👍', 'Stop', 'Food?', 'Need fuel', 'Coffee?', 'Toilet stop', 'Wait for me', 'Slow down', 'Where are you?', 'On my way', 'All good', 'Lost', 'Setting off'];
  OR.chatCfg = () => {
    const c = OR.cfg.chat = OR.cfg.chat || {};
    if (c.voice === undefined) c.voice = !(OR.cfg.group && OR.cfg.group.chatVoice === false);
    if (c.notify === undefined) c.notify = true;
    if (c.showPresets === undefined) c.showPresets = true;
    if (!Array.isArray(c.presets) || !c.presets.length) c.presets = OR.CHAT_PRESETS.slice();
    return c;
  };
  OR.chatApply = () => { const c = OR.chatCfg(), n = OR.native; if (n && n.groupChatVoice) n.groupChatVoice(!!c.voice); if (n && n.groupChatNotify) n.groupChatNotify(!!c.notify); };
  OR.groupAvailable = () => !!(N() && N().groupStart);
  let state = { on: false, riders: [], msgs: [] }, timer = null, seen = {}, chatT = 0;

  OR.group = {
    get state() { return state; },
    newCode: () => N().groupNewCode(),
    codeOk: c => N().groupCodeOk(c),
    pretty: c => { const x = String(c || '').toUpperCase().replace(/[^0-9A-Z]/g, ''); return x.replace(/(.{4})(?=.)/g, '$1-'); },
    start(code) {
      const g = OR.cfg.group = OR.cfg.group || {};
      g.code = OR.group.pretty(code); OR.saveCfg();
      N().groupStart(g.code, g.name || 'Rider', g.colour || OR.GROUP_COLOURS[0], OR.cfg.voice !== false, parseFloat(g.splitMi) || 2, OR.cfg.units === 'km' ? 'km' : 'mi');
      if (N().groupRole) N().groupRole(g.role || '');
      if (N().bikeLinkSet && OR.cfg.bikeLink !== false) N().bikeLinkSet(true); // asks for Bluetooth permission the first time
      OR.chatApply();
      poll(); watch();
    },
    leave() { N().groupStop(); const g = OR.cfg.group || {}; g.code = ''; OR.saveCfg(); setTimeout(poll, 400); },
    say(kind, text) { N().groupSay(kind, text || ''); setTimeout(poll, 300); },
    setRole(r) { const g = OR.cfg.group = OR.cfg.group || {}; g.role = r; OR.saveCfg(); if (N().groupRole) N().groupRole(r); },
    // share the planned route: the whole route, so everyone gets exactly the same roads and turn instructions
    shareRoute(r) {
      const p = OR.packRoute(r); delete p.limits; delete p.cams; delete p.wx;
      N().groupShare('r', JSON.stringify({ name: r.name || 'Route', dist: r.dist, time: r.time, route: p }));
      setTimeout(poll, 400);
    },
    unshareRoute() { N().groupShare('r', ''); setTimeout(poll, 400); },
    setMeet(ll, name) { N().groupShare('x', JSON.stringify({ la: ll[1], lo: ll[0], name: name || 'Regroup point' })); setTimeout(poll, 400); },
    clearMeet() { N().groupShare('x', ''); setTimeout(poll, 400); },
    meet() { return (state.meets || []).slice().sort((a, b) => b.t - a.t)[0] || null; },
    // riders at the regroup point (within 250 m)
    atMeet(pt) {
      const near = (la, lo) => OR.dist([pt.lo, pt.la], [lo, la]) <= 250;
      const others = state.riders.filter(r => r.age <= OR.GROUP_LOST);
      return { there: others.filter(r => near(r.la, r.lo)).length + (OR.pos && near(OR.pos.lat, OR.pos.lng) ? 1 : 0), of: others.length + 1 };
    },
    leader() { return state.riders.find(r => r.r === 'lead') || null; },
    // ---------- chat ----------
    chatList() { return state.code ? OR.store.get('chat_' + OR.group.pretty(state.code), []) : []; },
    chatSend(text, to, withLocation) { N().groupChat(text || '', to || '', !!withLocation); setTimeout(poll, 350); },
    chatSeen() { const l = OR.group.chatList(), t = l.length ? l[l.length - 1].t : 0; if (t && N().groupChatSeen) N().groupChatSeen(t); setTimeout(poll, 300); },
    // the ticks on my message: 1 sent, 2 arrived with everyone it was for, 3 everyone has read it
    ticks(m) {
      const who = state.riders.filter(r => m.to ? r.id === m.to : true);
      if (!who.length) return 1;
      if (who.every(r => (r.cs || 0) >= m.t)) return 3;
      if (who.every(r => (r.cr || 0) >= m.t)) return 2;
      return 1;
    },
    // what the QR code holds: an OpenRoad link that opens the app and joins (the scanner in OpenRoad reads it too)
    joinLink: code => 'openroad://join/' + OR.group.pretty(code),
    codeFrom(text) { const m = String(text || '').toUpperCase().replace(/%2D/g, '-').match(/([0-9A-Z]{4})-?([0-9A-Z]{4})-?([0-9A-Z]{4})(?![0-9A-Z])/); return m ? m[1] + '-' + m[2] + '-' + m[3] : null; },
    shareText(code) {
      return 'Join my OpenRoad group ride.\n\nGroup code: ' + OR.group.pretty(code) + '\n\nIn OpenRoad: the Group tab, then scan my QR code or type the code.\nGet OpenRoad for Android: https://github.com/guestymark-SPR/OpenRoad/releases/download/app/OpenRoad.apk';
    }
  };

  // ---------- who is where ----------
  const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  OR.compass = deg => COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
  OR.riderInfo = function (r) {
    const me = OR.pos, out = { stale: r.age > OR.GROUP_LOST };
    if (me) { out.dist = OR.dist([me.lng, me.lat], [r.lo, r.la]); out.dir = OR.compass(OR.bearing([me.lng, me.lat], [r.lo, r.la])); }
    out.seen = r.age < 20 ? 'now' : r.age < 90 ? Math.round(r.age) + ' s ago' : r.age < 5400 ? Math.round(r.age / 60) + ' min ago' : Math.round(r.age / 3600) + ' h ago';
    out.moving = r.s > 2;
    return out;
  };

  function poll() {
    if (!OR.groupAvailable()) return;
    try { state = JSON.parse(N().groupState()); } catch (e) { return; }
    draw();
    // show new messages from the group (the phone speaks them already)
    (state.msgs || []).forEach(m => {
      if (seen[m.key]) return; seen[m.key] = 1;
      if (!m.mine && !m.sys && Date.now() - m.t < 60000) OR.toast(m.n + ': ' + m.text, 7000);
    });
    // new chat messages since the last look, kept on this phone for the group (the newest 400)
    if (state.on && N().groupChatSince && state.chatLast > chatT) {
      try {
        const add = JSON.parse(N().groupChatSince(chatT)); const key = 'chat_' + OR.group.pretty(state.code);
        const have = OR.store.get(key, []), keys = new Set(have.map(m => m.key));
        add.forEach(m => { chatT = Math.max(chatT, m.rx || m.t); if (!keys.has(m.key)) { have.push(m); keys.add(m.key); } });
        have.sort((a, b) => a.t - b.t); OR.store.set(key, have.slice(-400));
        if (add.some(m => !m.mine)) OR.emit('chat', add);
      } catch (e) { }
    }
    // a route someone else shared that we haven't offered yet
    (state.routes || []).forEach(r => { const k = 'r' + r.id + r.t; if (r.id !== state.me && !seen[k]) { seen[k] = 1; OR.emit('groupRoute', r); } });
    OR.emit('group', state);
  }
  OR.groupPoll = poll;
  function draw() {
    if (!OR.map) return;
    const pt = state.on && OR.group.meet();
    OR.setData('meet', { type: 'FeatureCollection', features: pt ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [pt.lo, pt.la] }, properties: { name: 'Regroup: ' + (pt.name || '') } }] : [] });
    OR.setData('riders', { type: 'FeatureCollection', features: (state.on ? state.riders : []).map(r => {
      const i = OR.riderInfo(r);
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [r.lo, r.la] },
        properties: { id: r.id, c: r.c || '#e53935', stale: i.stale, label: r.n + (i.stale ? ' · ' + i.seen : '') } };
    }) });
  }
  function watch() { if (!timer) timer = setInterval(() => { if (!document.hidden) poll(); }, 3000); }
  OR.on('style', draw);
  OR.groupBoot = function () {
    if (!OR.groupAvailable()) return;
    OR.chatApply(); poll(); watch(); // a cheap local call, so it keeps checking (the group may be started from the phone while the car screen is up)
    document.addEventListener('visibilitychange', () => { if (!document.hidden && state.on) poll(); });
  };
})(window.OR);
