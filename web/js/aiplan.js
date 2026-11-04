/* OpenRoad AI ride planner: describe the ride you want in your own words ("a relaxed 3 hour loop from home through
   the Peaks with a pub lunch, no motorways") and it is turned into a planned route.
   It uses YOUR OWN Anthropic API key (Settings, AI ride planner), kept only on this phone, and the request goes from the
   phone straight to Anthropic: nothing goes through an OpenRoad server (there isn't one). What is sent: what you type,
   and where you are, rounded to about 10 km. The AI only suggests place names; OpenRoad looks them up on the map and
   plans the actual roads itself, so a made-up place is dropped rather than ridden to. Needs the Android app. */
'use strict';
(function (OR) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const URL_ = 'https://api.anthropic.com/v1/messages', VERSION = '2023-06-01';
  OR.AI_MODELS = [['claude-sonnet-5-5', 'Sonnet 5.5 (better plans)'], ['claude-haiku-5-5', 'Haiku 5.5 (cheaper)']];
  OR.aiKey = () => (OR.cfg.aiKey || '').trim();
  const model = () => OR.cfg.aiModel || OR.AI_MODELS[0][0];

  const SYSTEM = 'You help a motorcyclist plan a ride. Reply with ONE JSON object and nothing else, no markdown. Shape: ' +
    '{"name": short title, "style": "twisty" | "extra" | "scenic" | "fast", "loop": true if the ride should return to the start, ' +
    '"stops": [ {"place": "a real, well known place that can be found on a map, with town and county or region and country", "why": "five words", "kind": "via" | "break"} ], ' +
    '"summary": "one or two plain sentences on the ride"}. ' +
    'Rules: 2 to 6 stops in riding order, not including the start. Use only places you are sure exist and are on rideable public roads (villages, junctions, named passes, cafes, pubs, viewpoints). ' +
    'Use "break" for a place the rider stops at (lunch, coffee, a view), "via" for a place just to pass through and steer the road. ' +
    'Pick style "twisty" for bendy roads, "extra" for the most winding, "scenic" for no motorways but quicker, "fast" if they want speed. ' +
    'Spread stops so the ride matches the length or time asked (a motorbike averages about 30 mph on A and B roads). ' +
    'If the request is not about riding somewhere, return {"error": "why"}. Never invent coordinates.';

  function parse(text) {
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a < 0 || b < a) throw new Error('That did not look like a ride. Copy all of the AI\'s reply and try again.');
    return JSON.parse(text.slice(a, b + 1));
  }

  async function ask(want, here) {
    const around = here ? 'The rider is currently near latitude ' + here.lat.toFixed(1) + ', longitude ' + here.lng.toFixed(1) + ' (rounded). Start there unless they name another start.' : 'The rider has not shared where they are: use the start they name.';
    const body = JSON.stringify({ model: model(), max_tokens: 900, system: SYSTEM, messages: [{ role: 'user', content: around + '\n\nRide wanted: ' + want }] });
    const t = await OR.http(URL_, { method: 'POST', body, headers: { 'x-api-key': OR.aiKey(), 'anthropic-version': VERSION, 'content-type': 'application/json' }, timeout: 60000 });
    const j = JSON.parse(t);
    const txt = (j.content || []).filter(x => x.type === 'text').map(x => x.text).join('');
    return parse(txt);
  }

  function friendly(e) {
    const m = String(e.message || e);
    if (/401|authentication|invalid x-api-key/i.test(m)) return 'Anthropic did not accept the key. Check it in Settings, AI ride planner.';
    if (/402|credit|billing/i.test(m)) return 'Your Anthropic account is out of credit.';
    if (/429|rate/i.test(m)) return 'Too many requests just now. Try again in a minute.';
    if (/timed out/i.test(m)) return 'The AI took too long. Try again.';
    return 'Could not ask the AI: ' + m.slice(0, 160);
  }

  // look each suggested place up on the map, close to the start
  async function lookUp(stops, start) {
    const out = [], dropped = [];
    for (const s of stops) {
      const l = await OR.search(s.place).catch(() => []);
      const hit = (l || []).find(x => !start || OR.dist([start.lng, start.lat], [x.lng, x.lat]) < 250000);
      if (hit) out.push({ lng: hit.lng, lat: hit.lat, name: hit.name || s.place, sub: hit.sub, why: s.why || '', type: s.kind === 'break' ? 'break' : 'through' });
      else dropped.push(s.place);
    }
    return { out, dropped };
  }

  async function finish(plan, out, here) {
    if (plan.error) throw new Error(plan.error);
    if (!Array.isArray(plan.stops) || !plan.stops.length) throw new Error('The AI gave no places to ride to');
    out.innerHTML = '<div class="spin"></div><p class="small" style="text-align:center">Finding the places on the map…</p>';
    const { out: found, dropped } = await lookUp(plan.stops.slice(0, 6), here);
    if (!found.length) throw new Error('None of the places could be found on the map');
    show(plan, found, dropped, here);
  }
  OR.aiPlanSheet = function (preset) {
    if (!OR.aiKey() || !(OR.native && OR.native.fetchTextH)) { OR.localPlanSheet(preset); return; }
    OR.sheet('<h2>' + OR.ic('spark') + 'Describe your ride</h2>' +
      '<p class="small">Say it how you would to a mate. For example: <i>a relaxed three hour loop through the Peaks with a pub lunch</i>, or <i>fast run to Whitby, coming back on the twisty roads</i>.</p>' +
      '<textarea id="aiWant" rows="4" maxlength="500" placeholder="What kind of ride?">' + esc(preset || '') + '</textarea>' +
      '<button class="btn go wide" id="aiGo">' + OR.ic('spark') + 'Plan it</button><div id="aiOut"></div>' +
      '<p class="small muted">Sends what you type and roughly where you are (to about 10 km) to Anthropic using your own key. The AI suggests places; OpenRoad finds them on the map and plans the roads. <a href="#" id="aiKeyLink">Change key</a></p>', b => {
      b.querySelector('#aiKeyLink').onclick = e => { e.preventDefault(); keySheet(); };
      b.querySelector('#aiGo').onclick = async () => {
        const want = b.querySelector('#aiWant').value.trim(), out = b.querySelector('#aiOut');
        if (want.length < 5) { OR.toast('Say a little more about the ride'); return; }
        if (!OR.online()) { OR.toast('No signal: the AI planner needs the internet'); return; }
        out.innerHTML = '<div class="spin"></div><p class="small" style="text-align:center">Thinking up a ride…</p>'; b.querySelector('#aiGo').disabled = true;
        try {
          const here = OR.pos ? { lat: OR.pos.lat, lng: OR.pos.lng } : null;
          const plan = await ask(want, here);
          await finish(plan, out, here);
        } catch (e) { b.querySelector('#aiGo').disabled = false; out.innerHTML = '<p class="card warnc">' + esc(friendly(e)) + '</p>'; }
      };
    });
  };

  function show(plan, found, dropped, here) {
    const style = OR.STYLES[plan.style] ? plan.style : 'twisty';
    OR.sheet('<h2>' + OR.ic('spark') + esc(plan.name || 'Your ride') + '</h2><p>' + esc(plan.summary || '') + '</p>' +
      '<div class="optcard">' + (here ? '<div class="opt-row"><span><b>Start: where you are</b><small>' + esc(OR.STYLES[style].label) + (plan.loop ? ', back to the start' : '') + '</small></span></div>' : '') +
      found.map((s, i) => '<div class="opt-row"><span><b>' + (i + 1) + '. ' + esc(s.name) + '</b><small>' + esc([s.type === 'break' ? 'Stop' : 'Via', s.why, s.sub].filter(Boolean).join(', ')) + '</small></span></div>').join('') + '</div>' +
      (dropped.length ? '<p class="small muted">Could not find on the map, so left out: ' + dropped.map(esc).join('; ') + '</p>' : '') +
      '<p class="small muted">Suggested by the AI from what it knows. Check the stops, and opening times, before you rely on them.</p>' +
      '<button class="btn go wide" id="aiPlan">' + OR.ic('moto') + 'Plan the roads</button><button class="btn wide ghost" id="aiBack">Change what I asked</button>', b => {
      b.querySelector('#aiBack').onclick = () => OR.aiPlanSheet();
      b.querySelector('#aiPlan').onclick = () => {
        OR.closeSheet(); const tab = document.querySelector('[data-tab=plan]'); if (tab) tab.click();
        const w = [];
        if (here) w.push({ lng: here.lng, lat: here.lat, name: 'My position', type: 'break' });
        found.forEach(s => w.push({ lng: s.lng, lat: s.lat, name: s.name, type: s.type }));
        if (plan.loop && w.length) w.push(Object.assign({}, w[0], { type: 'break', name: w[0].name === 'My position' ? 'Back to start' : w[0].name }));
        if (w.length) { w[0].type = 'break'; w[w.length - 1].type = 'break'; }
        OR.cfg.style = style; OR.plan.wps = w; OR.planChanged(true);
      };
    });
  }

  function keySheet() {
    OR.sheet('<h2>' + OR.ic('spark') + 'AI ride planner key</h2>' +
      '<p class="small">Optional. Without a key, Describe a ride still works from simple wording. With a key it understands anything you type. The planner uses your own Anthropic account, so there is no OpenRoad fee and nothing runs on a server of ours. Each ride costs a small fraction of a penny to a few pence, billed by Anthropic to your account.</p>' +
      '<ol class="small"><li>Go to <b>console.anthropic.com</b>, sign in and add a little credit.</li><li>Make an API key and paste it here.</li></ol>' +
      '<label class="f"><span>Anthropic API key</span><input id="aiKeyIn" type="password" autocomplete="off" placeholder="sk-ant-…" value="' + esc(OR.cfg.aiKey || '') + '"></label>' +
      '<label class="f"><span>Model</span><select id="aiModelIn">' + OR.AI_MODELS.map(m => '<option value="' + m[0] + '"' + (m[0] === model() ? ' selected' : '') + '>' + m[1] + '</option>').join('') + '</select></label>' +
      '<p class="small muted">The key stays on this phone and goes only to Anthropic. Anyone who can open your phone\'s OpenRoad settings could see it.</p>' +
      '<button class="btn go wide" id="aiSave">Save</button>' + (OR.aiKey() ? '<button class="btn wide ghost" id="aiClear">Remove the key</button>' : ''), b => {
      b.querySelector('#aiSave').onclick = () => { OR.cfg.aiKey = b.querySelector('#aiKeyIn').value.trim(); OR.cfg.aiModel = b.querySelector('#aiModelIn').value; OR.saveCfg(); OR.closeSheet(); if (OR.cfg.aiKey) OR.aiPlanSheet(); };
      const c = b.querySelector('#aiClear'); if (c) c.onclick = () => { delete OR.cfg.aiKey; OR.saveCfg(); OR.closeSheet(); OR.toast('Key removed'); };
    });
  }
  OR.aiKeySheet = keySheet;
})(window.OR);
