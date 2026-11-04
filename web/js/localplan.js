/* OpenRoad "Describe a ride": type what you fancy and OpenRoad plans it, with no key, no account and no internet
   service beyond the map's own: the sentence is read on the phone (hours or miles, direction, twisty or fast, a pub or
   café stop, "to Whitby", "from home") and handed to the same planner as Round trip and A to B.
   It understands plain, common wording. It is not an AI, so unusual phrasing may be missed: the sheet says what it
   understood before it plans. (With your own Anthropic key, aiplan.js reads anything.) */
'use strict';
(function (OR) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const DIRN = { north: 'N', northeast: 'NE', east: 'E', southeast: 'SE', south: 'S', southwest: 'SW', west: 'W', northwest: 'NW' };
  const STOPS = [[/\bpubs?\b|\blunch\b|\bpint\b|\bdinner\b/i, 'pub', 'pub stop'], [/\bcaf[eé]s?\b|\bcoffee\b|\bbreakfast\b|\bcake\b|\bbrew\b|\btea\b|\bbacon\b/i, 'cafe', 'café stop'],
    [/\bfuel\b|\bpetrol\b/i, 'fuel', 'fuel stop'], [/\bview(?:point)?s?\b/i, 'view', 'viewpoint stop']];
  const bearing = (a, b) => { const r = Math.PI / 180, y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r), x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r); return (Math.atan2(y, x) / r + 360) % 360; };
  const octant = d => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(d / 45) % 8];

  // the sentence, read into a ride
  OR.parseRide = function (text) {
    const t = ' ' + String(text).trim() + ' ', low = t.toLowerCase(), r = { secs: 0, miles: 0, dir: '', style: '', stop: null, dest: '', via: '', from: '', back: false, notes: [] };
    let m;
    if (/\b(?:an?|one) hour and a half\b/.test(low)) r.secs = 5400;
    else if ((m = low.match(/(\d+(?:\.\d+)?)\s*(?:and a half\s*)?(?:hours?|hrs?|h)\b/))) { r.secs = parseFloat(m[1]) * 3600 + (/and a half/.test(m[0]) ? 1800 : 0); }
    else if (/half an? hour/.test(low)) r.secs = 1800;
    else if (/half an? day|half-day|morning|afternoon/.test(low)) r.secs = 4 * 3600;
    else if (/all day|full day|whole day/.test(low)) r.secs = 6 * 3600;
    else if (/couple of hours/.test(low)) r.secs = 2 * 3600;
    else if (/\ban hour\b|\bone hour\b/.test(low)) r.secs = 3600;
    if ((m = low.match(/(\d+)\s*(?:minutes?|mins?)\b/))) r.secs += parseInt(m[1], 10) * 60;
    if ((m = low.match(/(\d+(?:\.\d+)?)\s*(miles?|mi)\b/))) { r.miles = parseFloat(m[1]); r.secs = 0; }
    else if ((m = low.match(/(\d+(?:\.\d+)?)\s*(km|kilomet(?:re|er)s?)\b/))) { r.miles = parseFloat(m[1]) / 1.609; r.secs = 0; }
    if ((m = t.match(/\b(?:head(?:ing)?|go(?:ing)?|out|towards?|to the|ride)\s+(?:the\s+)?(north ?east|north ?west|south ?east|south ?west|north|south|east|west)\b/i)) && !/^\s+[A-Z]/.test(t.slice(m.index + m[0].length))) r.dir = DIRN[m[1].toLowerCase().replace(/\s/g, '')] || '';
    r.style = /\b(extra|really|most|very)\s+(twisty|bendy|winding|curvy)\b|\bas twisty\b/.test(low) ? 'extra' : /\btwisty|bendy|winding|curvy|bends\b/.test(low) ? 'twisty' : /\bno motorways?|avoid motorways?|scenic|views?\b/.test(low) ? 'scenic' : /\bfast|quick|quickest|speedy|get there\b/.test(low) ? 'fast' : '';
    for (const [re, kind, label] of STOPS) if (re.test(low)) { r.stop = { kind, label }; if (kind === 'pub' && /\bcaf[eé]|coffee\b/.test(low) && !/\bpub\b/.test(low)) r.stop = { kind: 'cafe', label: 'café stop' }; break; }
    r.back = /\bback\b|\breturn|\bloop\b|\bround trip|\broundtrip|\bcircular|\bcircuit/.test(low);
    const place = '([A-Z][A-Za-z\'’.-]*(?:\\s+(?:(?:upon|on|le|de|under|in|by|the)\\s+)?[A-Z][A-Za-z\'’.-]*)*)';
    if ((m = t.match(new RegExp('\\b[Ff]rom\\s+' + place)))) r.from = m[1];
    else if (/\bfrom (home|here|my (?:house|place|door))\b/.test(low)) r.from = /home|house|place|door/.test(low.match(/\bfrom (home|here|my (?:house|place|door))\b/)[1]) ? 'home' : '';
    if ((m = t.match(new RegExp('\\b(?:to|towards|up to|down to|out to)\\s+(?:the\\s+)?' + place)))) { if (!/^(?:The|A|An|Back)$/.test(m[1])) r.dest = m[1]; }
    if ((m = t.match(new RegExp('\\b(?:through|via|around|across|in|into)\\s+(?:the\\s+)?' + place)))) r.via = m[1];
    if (r.dest && r.dest === r.from) r.dest = '';
    return r;
  };
  OR.rideSummary = r => [r.dest ? 'to ' + r.dest + (r.back ? ' and back' : '') : r.miles ? Math.round(r.miles) + ' mile loop' : (r.secs ? (r.secs % 3600 ? Math.round(r.secs / 60) + ' minute' : r.secs / 3600 + ' hour') + ' loop' : '2 hour loop (you did not say how long)'),
    r.from ? 'from ' + (r.from === 'home' ? 'home' : r.from) : 'from where you are', r.style ? ({ twisty: 'twisty', extra: 'extra twisty', scenic: 'no motorways', fast: 'fast' })[r.style] : 'twisty', r.dir ? 'heading ' + r.dir : '', r.via && !r.dest ? 'towards ' + r.via : '', r.stop ? r.stop.label : ''].filter(Boolean).join(', ');

  const find = async (q, near, far) => { const l = await OR.search(q).catch(() => []); return (l || []).find(x => !near || OR.dist(near, [x.lng, x.lat]) < (far || 400000)) || null; };
  const nearShape = (shape, p, lim) => { for (let i = 0; i < shape.length; i += 3) if (OR.dist(shape[i], p) < lim) return true; return false; };

  async function run(r, out) {
    let start = null;
    if (r.from === 'home' && OR.cfg.home && OR.cfg.home.lng != null) start = { lng: OR.cfg.home.lng, lat: OR.cfg.home.lat, name: OR.cfg.home.name || 'Home' };
    else if (r.from && r.from !== 'home') { const f = await find(r.from, OR.pos ? [OR.pos.lng, OR.pos.lat] : null, 600000); if (!f) throw new Error('Could not find "' + r.from + '" on the map to start from.'); start = { lng: f.lng, lat: f.lat, name: f.name }; }
    else if (OR.pos) start = { lng: OR.pos.lng, lat: OR.pos.lat, name: 'My position' };
    else if (OR.cfg.home && OR.cfg.home.lng != null) start = { lng: OR.cfg.home.lng, lat: OR.cfg.home.lat, name: 'Home' };
    if (!start) throw new Error('OpenRoad does not know where you are yet. Say where to start, like "from Buxton", or set your Home.');
    const here = [start.lng, start.lat];
    if (r.style) OR.cfg.style = r.style;
    let stopPlace = null;
    const withStop = async (shape, wps) => {
      if (!r.stop) return wps;
      const mid = shape[Math.floor(shape.length * (r.dest && !r.back ? 0.5 : 0.45))];
      const list = await OR.nearby(r.stop.kind, mid[0], mid[1], 9000).catch(() => []);
      const pick = list.filter(p => nearShape(shape, [p.lng, p.lat], 1800)).sort((a, b) => OR.dist(mid, [a.lng, a.lat]) - OR.dist(mid, [b.lng, b.lat]))[0];
      if (!pick) return wps;
      stopPlace = pick.name;
      let bi = 1, best = 1e12;
      for (let i = 0; i < wps.length - 1; i++) { const a = [wps[i].lng, wps[i].lat], b = [wps[i + 1].lng, wps[i + 1].lat], d = OR.dist(a, [pick.lng, pick.lat]) + OR.dist([pick.lng, pick.lat], b) - OR.dist(a, b); if (d < best) { best = d; bi = i + 1; } }
      const w = wps.map(x => Object.assign({}, x)); w.splice(bi, 0, { lng: pick.lng, lat: pick.lat, name: pick.name, type: 'break' }); return w;
    };
    const go = () => { OR.closeSheet(); const tab = document.querySelector('[data-tab=plan]'); if (tab) tab.click(); };
    if (r.dest) {
      const d = await find(r.dest, here, 700000); if (!d) throw new Error('Could not find "' + r.dest + '" on the map.');
      let wps = [Object.assign({}, start, { type: 'break' }), { lng: d.lng, lat: d.lat, name: d.name, type: 'break' }];
      if (r.back) wps.push(Object.assign({}, start, { type: 'break', name: start.name === 'My position' ? 'Back to start' : start.name }));
      out.innerHTML = '<p class="small" style="text-align:center">Planning…</p>';
      const first = await OR.planWaypoints(wps, r.style || 'twisty');
      wps = await withStop(first.shape, wps);
      go(); OR.plan.wps = wps; OR.planChanged(true);
      return stopPlace ? 'Added ' + stopPlace + ' as a stop.' : '';
    }
    let dir = r.dir || 'any';
    if (!r.dir && r.via) { const v = await find(r.via, here, 300000); if (v) dir = octant(bearing(here, [v.lng, v.lat])); }
    out.innerHTML = '<div class="spin"></div><p class="small" style="text-align:center">Finding loops…</p>';
    const opts = r.miles ? await OR.roundTrip(here, r.miles, dir) : await OR.roundTripByTime(here, r.secs || 7200, dir);
    opts.forEach(o => { o.name = 'Round trip from ' + start.name; });
    go(); OR.useLoop(opts, { lng: start.lng, lat: start.lat, name: start.name === 'My position' ? 'here' : start.name, home: start.name === 'Home' });
    if (r.stop) {
      const wps = await withStop(opts[0].shape, opts[0].wps.map(w => Object.assign({}, w)));
      if (stopPlace) { OR.plan.wps = wps; OR.planChanged(true); return 'Added ' + stopPlace + ' as a stop.'; }
      return 'No ' + r.stop.label.replace(' stop', '') + ' found near the route, so there is no stop.';
    }
    return '';
  }

  OR.localPlanSheet = function (preset) {
    const eg = ['2 hour twisty loop with a pub lunch', '3 hours heading north, no motorways', '60 miles with a café stop', 'to Whitby and back, scenic'];
    OR.sheet('<h2>' + OR.ic('spark') + 'Describe your ride</h2>' +
      '<textarea class="aitext" id="rpWant" rows="3" maxlength="300" placeholder="e.g. a 3 hour twisty loop with a pub lunch">' + esc(preset || '') + '</textarea>' +
      '<div class="chips rpeg">' + eg.map(e => '<button class="btn small" data-e="' + esc(e) + '">' + esc(e) + '</button>').join('') + '</div>' +
      '<p class="small muted" id="rpSay">Say how long or how far, and add things like twisty, no motorways, a pub or café stop, "from home" or "to Whitby and back".</p>' +
      '<button class="btn go wide" id="rpGo">' + OR.ic('moto') + 'Plan it</button><div id="rpOut"></div>' +
      '<p class="small muted">Worked out on your phone, with no key and no account. <a class="lnk" href="#" id="rpAi">Use my own AI key for anything-goes wording</a></p>', b => {
      const q = s => b.querySelector(s), want = q('#rpWant'), say = q('#rpSay');
      const show = () => { const t = want.value.trim(); say.textContent = t.length > 4 ? 'Understood: ' + OR.rideSummary(OR.parseRide(t)) + '.' : 'Say how long or how far, and add things like twisty, no motorways, a pub or café stop, "from home" or "to Whitby and back".'; };
      want.oninput = show; show();
      b.querySelectorAll('[data-e]').forEach(x => x.onclick = () => { want.value = x.dataset.e; show(); });
      q('#rpAi').onclick = e => { e.preventDefault(); OR.aiKeySheet(); };
      q('#rpGo').onclick = async () => {
        const t = want.value.trim(), out = q('#rpOut'); if (t.length < 4) { OR.toast('Say a little more about the ride'); return; }
        if (!OR.online()) { OR.toast('No signal: planning a new route needs the internet'); return; }
        q('#rpGo').disabled = true; out.innerHTML = '<div class="spin"></div>';
        try { const note = await run(OR.parseRide(t), out); if (note) OR.toast(note, 5000); }
        catch (e) { q('#rpGo').disabled = false; out.innerHTML = '<p class="card warnc">' + esc(e.message) + '</p>'; }
      };
    });
  };
})(window.OR);
