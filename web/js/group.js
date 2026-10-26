/* OpenRoad group ride: see everyone in your group on the map, live. The Android side (GroupService) does the sharing,
   with the screen off too; this reads its state, draws the riders and works out who is where. */
'use strict';
(function (OR) {
  const N = () => OR.native; // read when used (the bridge is there from the start in the app)
  OR.GROUP_COLOURS = ['#e53935', '#1e88e5', '#0e9f57', '#f5a300', '#8e24aa', '#00897b', '#ef6c00', '#d81b60', '#3949ab', '#6d4c41'];
  OR.GROUP_LOST = 180; // seconds without news before a rider shows as lost
  OR.QUICK = [['fuel', 'Stopping for fuel', 'fuel', '#e53935'], ['stop', 'Pulling over', 'park', '#1565c0'], ['wait', 'Wait for me', 'time', '#ef8f00'],
    ['lost', 'I\'m lost', 'near', '#8e24aa'], ['ok', 'All good', 'check', '#0e9f57'], ['go', 'Setting off', 'moto', '#00897b'], ['help', 'Need help', 'helmet', '#c62828']];
  OR.groupAvailable = () => !!(N() && N().groupStart);
  let state = { on: false, riders: [], msgs: [] }, timer = null, seen = {};

  OR.group = {
    get state() { return state; },
    newCode: () => N().groupNewCode(),
    codeOk: c => N().groupCodeOk(c),
    pretty: c => { const x = String(c || '').toUpperCase().replace(/[^0-9A-Z]/g, ''); return x.replace(/(.{4})(?=.)/g, '$1-'); },
    start(code) {
      const g = OR.cfg.group = OR.cfg.group || {};
      g.code = OR.group.pretty(code); OR.saveCfg();
      N().groupStart(g.code, g.name || 'Rider', g.colour || OR.GROUP_COLOURS[0], OR.cfg.voice !== false, parseFloat(g.splitMi) || 2, OR.cfg.units === 'km' ? 'km' : 'mi');
      poll(); watch();
    },
    leave() { N().groupStop(); const g = OR.cfg.group || {}; g.code = ''; OR.saveCfg(); setTimeout(poll, 400); },
    say(kind, text) { N().groupSay(kind, text || ''); setTimeout(poll, 300); },
    shareText(code) {
      return 'Join my OpenRoad group ride.\n\nGroup code: ' + OR.group.pretty(code) + '\n\nIn OpenRoad: Rides, Group ride, Join with a code.\nGet OpenRoad for Android: https://github.com/guestymark-SPR/OpenRoad/releases/download/app/OpenRoad.apk';
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
    OR.emit('group', state);
  }
  OR.groupPoll = poll;
  function draw() {
    if (!OR.map) return;
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
    poll(); watch(); // a cheap local call, so it keeps checking (the group may be started from the phone while the car screen is up)
    document.addEventListener('visibilitychange', () => { if (!document.hidden && state.on) poll(); });
  };
})(window.OR);
