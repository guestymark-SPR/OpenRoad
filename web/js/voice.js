/* OpenRoad voice commands: tap the mic (or the intercom button, if switched on) and say what you want.
   Everything is answered out loud, so you don't need to look at the screen. */
'use strict';
(function (OR) {
  const N = () => OR.native;
  OR.VOICE_HELP = [
    ['"Find fuel" / "find coffee" / "find a hotel"', 'the nearest one ahead, read out, and shown on the map'],
    ['"Tell the group stopping for coffee"', 'sends that to the group chat'],
    ['"Tell Dave I\'m behind you"', 'a private message to one rider'],
    ['"Read my messages"', 'reads the latest group messages'],
    ['"How far to go?"', 'distance left and arrival time'],
    ['"Where\'s Dave?" / "Where is everyone?"', 'how far away and which way'],
    ['"Gravel" / "Diesel on the road" / "Pothole"', 'marks a hazard for the riders behind'],
    ['"Regroup here"', 'sets the regroup point where you are'],
    ['"Catch up with Dave"', 'navigates to Dave as he rides'],
    ['"Skip the next stop"', 'goes straight to the stop after'],
    ['"Weather"', 'the weather ahead on the route'],
    ['"Voice off" / "Voice on"', 'turns spoken directions off or on']];

  OR.voiceListen = () => { if (N() && N().voiceListen) N().voiceListen(); else OR.toast('Voice commands need the Android app'); };
  window.onVoiceState = s => OR.emit('voiceState', s);
  window.onVoiceError = m => { OR.emit('voiceState', 'idle'); OR.say(m); OR.toast(m); };
  window.onVoice = text => { OR.emit('voiceState', 'idle'); OR.voiceCommand(text); };

  const rider = name => {
    const n = name.toLowerCase().trim();
    return (OR.group && OR.group.state.on ? OR.group.state.riders : []).find(r => (r.n || '').toLowerCase() === n || (r.n || '').toLowerCase().split(' ')[0] === n.split(' ')[0]) || null;
  };
  const here = () => OR.pos ? [OR.pos.lng, OR.pos.lat] : OR.map.getCenter().toArray();
  // a point a few miles ahead on the route, so "find fuel" doesn't send you back where you came from
  const ahead = () => {
    const r = OR.ride.on && OR.ride.route; if (!r) return here();
    const want = Math.min(r.dist, OR.ride.along + 4000);
    for (let i = 1; i < r.shape.length; i++) if (r.cum[i] >= want) return r.shape[i];
    return here();
  };
  async function find(kind, label) {
    OR.say('Looking for ' + label);
    try {
      const at = ahead(), list = (await OR.nearby(kind, at[0], at[1], 8000)).filter(p => p.name).sort((a, b) => a.d - b.d);
      if (!list.length) return OR.say('I couldn\'t find ' + label + ' nearby.');
      const p = list[0], d = OR.pos ? OR.dist([OR.pos.lng, OR.pos.lat], [p.lng, p.lat]) : p.d;
      OR.say('Nearest ' + label + ': ' + p.name + ', ' + OR.spokenDist(d) + ' away.' + (list[1] ? ' Then ' + list[1].name + '.' : ''));
      OR.lastPois = list; OR.setData('pois', OR.poiGeo(list));
    } catch (e) { OR.say('Search failed. ' + (OR.online() ? '' : 'There\'s no signal.')); }
  }

  OR.voiceCommand = function (raw) {
    const t = String(raw || '').trim(), s = t.toLowerCase().replace(/[.?!]+$/, '');
    if (!s) return OR.say('I didn\'t catch that');
    OR.toast('🎤 ' + t, 4000);
    const inGroup = OR.group && OR.group.state.on;
    let m;
    // messages
    if ((m = s.match(/^(?:tell|message|send(?: a message to)?)\s+(?:the\s+)?(?:group|everyone|everybody|all)\s*(?:that\s+)?(.+)$/))) {
      if (!inGroup) return OR.say('You\'re not in a group ride');
      OR.group.chatSend(cap(m[1]), '', false); return OR.say('Sent to the group: ' + m[1]);
    }
    if ((m = s.match(/^(?:tell|message)\s+(\w+)\s+(?:that\s+)?(.+)$/))) {
      const r = inGroup && rider(m[1]);
      if (r) { OR.group.chatSend(cap(m[2]), r.id, false); return OR.say('Sent to ' + r.n + ': ' + m[2]); }
    }
    if (/^(?:read|any|check)\b.*messages?|^messages?$/.test(s)) {
      if (!inGroup) return OR.say('You\'re not in a group ride');
      const last = OR.group.chatList().filter(x => !x.mine).slice(-3);
      OR.group.chatSeen();
      return OR.say(last.length ? last.map(x => x.n + ' said: ' + (x.x || 'shared their location')).join('. ') : 'No messages yet.');
    }
    if ((m = s.match(/speedo(?: says| reads| shows| is)?\s+(\d{2,3})/))) { const r = OR.speedoRecord(+m[1]); return OR.say(r.error ? r.error : 'Saved. GPS says ' + Math.round(r.pair.gps) + '.'); }
    // places
    if (/\b(fuel|petrol|diesel station|gas station|filling station)\b/.test(s) && /find|need|where|nearest|get|look/.test(s)) return find('fuel', 'fuel');
    if (/\b(coffee|cafe|café|food|eat|tea|lunch|breakfast)\b/.test(s) && !/tell|message/.test(s)) return find('cafe', 'a café');
    if (/\b(hotel|stay|room|b ?& ?b|bed)\b/.test(s)) return find('stay', 'somewhere to stay');
    if (/\b(pub|beer)\b/.test(s)) return find('pub', 'a pub');
    // hazards
    const hz = [['gravel', /gravel|loose chippings|chippings/], ['diesel', /diesel|oil|spill/], ['pothole', /pot ?hole/], ['mud', /\bmud\b/], ['roadworks', /road ?works/], ['animal', /animal|sheep|cows?|deer|horses?/], ['crash', /accident|crash ahead/], ['flood', /flood|water on/], ['leaves', /leaves/], ['debris', /debris|something in the road/]]
      .find(h => h[1].test(s));
    if (hz && (/hazard|mark|on the road|ahead|there's|watch/.test(s) || s.split(' ').length <= 3)) {
      if (!inGroup) return OR.say('Hazards are shared in a group ride. You\'re not in one.');
      N().groupHazard(hz[0], ''); return;
    }
    // where things are
    if (/how (?:far|long)|when (?:will|do) (?:we|i) (?:get|arrive)|eta|time to go|distance/.test(s)) {
      const r = OR.ride.on && OR.ride.route;
      if (!r) return OR.say(OR.ride.on ? 'You\'re on a free ride, with no destination. ' + OR.spokenDist(OR.ride.dist) + ' ridden so far.' : 'No route is running.');
      const left = r.dist - OR.ride.along, sec = OR.myTime ? OR.myTime(r.time * left / r.dist) : r.time * left / r.dist;
      return OR.say(OR.spokenDist(left) + ' to go. You should arrive about ' + OR.clock(new Date(Date.now() + sec * 1000)) + '.');
    }
    if ((m = s.match(/^where(?:'s| is| are)\s+(.+)$/))) {
      if (!inGroup) return OR.say('You\'re not in a group ride');
      const who = m[1].replace(/^the\s+/, '');
      const list = /everyone|everybody|the group|all/.test(who) ? OR.group.state.riders : [rider(who)].filter(Boolean);
      if (!list.length) return OR.say('I don\'t know who ' + who + ' is in this group');
      return OR.say(list.map(r => { const i = OR.riderInfo(r); return r.n + ' is ' + (i.dist != null ? OR.spokenDist(i.dist) + ' ' + i.dir : 'somewhere') + (i.stale ? ', last seen ' + i.seen : ''); }).join('. ') + '.');
    }
    if ((m = s.match(/catch(?:\s+up)?\s+(?:with\s+)?(\w+)/))) {
      const r = inGroup && rider(m[1]); if (!r) return OR.say('I can\'t find ' + m[1] + ' in the group');
      return OR.catchUp(r.id);
    }
    if (/regroup|meet (?:up )?here/.test(s)) {
      if (!inGroup || !OR.pos) return OR.say('You need to be in a group ride');
      OR.group.setMeet([OR.pos.lng, OR.pos.lat], 'Here'); return OR.say('Regroup point set where you are.');
    }
    if (/skip/.test(s)) return OR.skipNextStop().then(ok => { if (!ok) OR.say('There\'s no stop to skip'); });
    if (/weather|rain/.test(s)) {
      const r = OR.ride.on && OR.ride.route;
      if (!r) return OR.say('Weather ahead works on a planned route');
      return OR.weatherAlong(r, new Date()).then(w => { const a = w.filter(x => x.along >= OR.ride.along - 100), warns = Array.from(new Set(a.map(OR.weatherWarn).filter(Boolean))); OR.say(warns.length ? 'Weather ahead: ' + warns.join('. ') : a[0] ? 'Weather ahead: ' + OR.wmo(a[0].code)[0] + ', ' + Math.round(a[0].temp) + ' degrees' : 'No weather information'); }).catch(() => OR.say('Weather unavailable'));
    }
    if (/voice off|mute|quiet|stop talking/.test(s)) { OR.say('Voice off'); setTimeout(() => { OR.cfg.voice = false; OR.saveCfg(); OR.emit('voiceToggled'); }, 1200); return; }
    if (/voice on|unmute|speak/.test(s)) { OR.cfg.voice = true; OR.saveCfg(); OR.emit('voiceToggled'); return OR.say('Voice on'); }
    if (/^(what can|help|commands)/.test(s)) return OR.say('You can say: find fuel. Tell the group, then a message. Read my messages. How far to go. Where is Dave. Gravel, to mark a hazard. Regroup here. Or weather.');
    OR.say('Sorry, I don\'t know how to do: ' + t + '. Say help to hear what I can do.');
  };
  const cap = x => x.charAt(0).toUpperCase() + x.slice(1);

  // the intercom button and watch alerts follow the settings
  OR.voiceApply = () => { const n = N(); if (n && n.voiceButton) n.voiceButton(!!OR.cfg.voiceButton && OR.ride.on); };
  OR.on('ridestart', OR.voiceApply); OR.on('ridestop', () => { const n = N(); if (n && n.voiceButton) n.voiceButton(false); });
})(window.OR);
