/* OpenRoad safety while riding: crash detection (the alarm and texting run in the Android app), the over-the-limit
   warning and break reminders. */
'use strict';
(function (OR) {
  const N = () => OR.native, MI = 1609.344;
  OR.safetyCfg = () => {
    const s = OR.cfg.safety = OR.cfg.safety || {};
    if (s.crash === undefined) s.crash = false;
    if (s.overLimit === undefined) s.overLimit = 'off';     // off, any, guide
    if (s.breakEvery === undefined) s.breakEvery = 2;       // hours, 0 = off
    return s;
  };

  // ---------- crash detection ----------
  // the contact is the safety check-in contact, or the emergency card contact if that's empty
  OR.crashContact = () => {
    const ci = OR.cfg.checkin || {}, ice = OR.cfg.ice || {};
    return ci.phone ? { name: ci.name || 'your contact', phone: ci.phone } : ice.contactPhone ? { name: ice.contactName || 'your contact', phone: ice.contactPhone } : null;
  };
  OR.crashSync = function () {
    const n = N(); if (!n || !n.crashConfig) return;
    const s = OR.safetyCfg(), c = OR.crashContact(), ice = OR.cfg.ice || {};
    n.crashConfig(JSON.stringify({ on: !!s.crash, phone: c ? c.phone.replace(/\s/g, '') : '', name: c ? c.name : '', rider: ice.name || (OR.cfg.group && OR.cfg.group.name) || '',
      medical: [ice.blood ? 'blood group ' + ice.blood : '', ice.medical || ''].filter(Boolean).join('. ') }));
  };
  let shown = '';
  function crashPoll() {
    const n = N(); if (!n || !n.crashState || !document.getElementById('panel')) return; // the phone screen only, not the car's
    let st; try { st = JSON.parse(n.crashState()); } catch (e) { return; }
    let el = document.getElementById('crashBox');
    if (st.phase === 'alarm') {
      if (!el) {
        el = document.createElement('div'); el.id = 'crashBox';
        el.innerHTML = '<div class="cb-in"><div class="cb-t"></div><div class="cb-n"></div><div class="cb-s"></div><button id="crashOk" class="btn wide">I\'m OK</button></div>';
        document.body.appendChild(el);
        el.querySelector('#crashOk').onclick = () => { n.crashCancel(); el.remove(); OR.toast('Alarm cancelled. Nothing was sent.'); };
      }
      const c = OR.crashContact();
      el.querySelector('.cb-t').textContent = (st.test ? 'TEST: ' : '') + 'Crash detected. Are you OK?';
      el.querySelector('.cb-n').textContent = st.left;
      el.querySelector('.cb-s').textContent = st.test ? 'This is a test. Nothing will be sent.' : (c ? c.name + ' will be texted your position' : 'Your group will be told') + ' when this reaches zero.';
    } else {
      if (el) el.remove();
      if (st.result && st.result !== 'cancelled' && st.result !== shown) { shown = st.result; OR.sheet('<h2>Crash alert</h2><p>' + OR.esc(st.result) + '</p>'); }
    }
  }
  setInterval(() => { if ((OR.ride && OR.ride.on) || (OR.group && OR.group.state.on) || document.getElementById('crashBox')) crashPoll(); }, 1000);
  OR.crashPoll = crashPoll;

  // ---------- over the speed limit ----------
  let audio = null;
  OR.chime = function () {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.22].forEach((t, i) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = 'sine'; o.frequency.value = i ? 1320 : 880; o.connect(g); g.connect(audio.destination);
        const at = audio.currentTime + t; g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.5, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
        o.start(at); o.stop(at + 0.22);
      });
    } catch (e) { }
  };
  // how far over counts, in km/h: "any" allows 2 mph for GPS wobble; "guide" is 10% + 2 mph
  OR.overBy = function (kph, limitKph, mode) {
    if (!limitKph || mode === 'off' || !mode) return 0;
    const allow = mode === 'guide' ? limitKph * 0.1 + 3.2 : 3.2;
    return kph - (limitKph + allow);
  };
  let overSince = 0, lastWarn = 0, lastWarnLimit = 0;
  OR.on('ride', e => {
    const s = OR.safetyCfg(), p = OR.pos;
    if (!p || e.free || !e.limit || s.overLimit === 'off') { overSince = 0; return; }
    const kph = (p.speed || 0) * 3.6;
    if (OR.overBy(kph, e.limit, s.overLimit) > 0) {
      if (!overSince) overSince = Date.now();
      const due = Date.now() - overSince > 3000 && (e.limit !== lastWarnLimit || Date.now() - lastWarn > 45000);
      if (due) { lastWarn = Date.now(); lastWarnLimit = e.limit; OR.chime(); setTimeout(() => OR.say('Speed limit ' + OR.limitSign(e.limit)), 500); OR.emit('overLimit', e.limit); }
    } else overSince = 0;
  });

  // ---------- break reminders ----------
  let moving = 0, stoppedFor = 0, lastT = 0, lastRemind = 0;
  OR.breakState = () => ({ moving, stoppedFor });
  OR.on('fix', p => {
    if (!OR.ride || !OR.ride.on) { moving = 0; stoppedFor = 0; lastT = 0; return; }
    const t = p.t || Date.now(), dt = lastT ? Math.min(30, (t - lastT) / 1000) : 0; lastT = t;
    if ((p.speed || 0) > 2) { moving += dt; stoppedFor = 0; } else { stoppedFor += dt; if (stoppedFor > 600) moving = 0; } // 10 minutes stopped counts as a break
    const every = parseFloat(OR.safetyCfg().breakEvery) || 0;
    if (!every || moving < every * 3600 || Date.now() - lastRemind < 30 * 60000) return;
    lastRemind = Date.now();
    remindBreak(p);
  });
  // a point about 8 km further along the route (or here on a free ride)
  function ahead(p) {
    const r = OR.ride.route; if (!r) return [p.lng, p.lat];
    const want = Math.min(r.dist, OR.ride.along + 8000);
    for (let i = 1; i < r.shape.length; i++) if (r.cum[i] >= want) return r.shape[i];
    return r.shape[r.shape.length - 1];
  }
  async function remindBreak(p) {
    const hrs = moving / 3600, at = ahead(p);
    const intro = 'You\'ve been riding for ' + (hrs < 1.75 ? 'an hour and a half' : Math.round(hrs) + ' hours') + ' without a break.';
    let pick = null;
    for (const kind of ['cafe', 'fuel']) {
      try {
        const list = (await OR.nearby(kind, at[0], at[1], 5000)).filter(x => x.name);
        if (list.length) { list.sort((a, b) => a.d - b.d); pick = list[0]; pick.kind = kind; break; }
      } catch (e) { }
    }
    let line = intro;
    if (pick) {
      const d = OR.dist([p.lng, p.lat], [pick.lng, pick.lat]);
      line += ' There\'s ' + (pick.kind === 'cafe' ? 'a café, ' : 'a fuel station, ') + pick.name + ', about ' + OR.spokenDist(d) + (OR.ride.route ? ' ahead.' : ' away.');
    }
    OR.say(line);
    OR.emit('breakDue', { line, pick });
  }
  OR.remindBreakNow = remindBreak; // for testing
})(window.OR);
