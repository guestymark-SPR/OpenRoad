/* OpenRoad: weather shown automatically on planned routes, and the route brief. */
'use strict';
(function (OR) {
  const $ = OR.$, $$ = OR.$$, esc = OR.esc, ic = n => OR.ic(n);
  let strip = { key: '', html: '' };
  OR.plan.depart = null; // null = leave now

  const depTime = () => OR.plan.depart || new Date();
  const hhmm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  OR.wxStripHtml = () => '<div id="wxStrip">' + (strip.html || '') + '</div>';

  // ---------- weather strip under the chosen route ----------
  OR.on('routeShown', r => loadStrip(r));
  async function loadStrip(r) {
    if (!r || !OR.online()) return;
    const dep = depTime(), key = r.id + ':' + Math.round(dep.getTime() / 600000);
    if (strip.key === key) { put(); return; }
    strip = { key, html: '<div class="wxs"><span class="muted small">Getting the weather along the route…</span></div>' }; put();
    try {
      const w = await OR.weatherAlong(r, dep);
      if (strip.key !== key) return;
      OR.setData('wx', { type: 'FeatureCollection', features: w.map(x => ({ type: 'Feature', properties: { name: Math.round(x.temp) + '°' }, geometry: { type: 'Point', coordinates: [x.lng, x.lat] } })) });
      const warns = Array.from(new Set(w.map(OR.weatherWarn).filter(Boolean)));
      strip.html = '<div class="wxs"><div class="wxs-top"><b>Weather on the way</b><label>Leave <input type="time" id="wxsDep" value="' + hhmm(dep) + '"></label></div>' +
        '<div class="wxs-row">' + w.map(x => { const c = OR.wmo(x.code); return '<div class="wxc' + (OR.weatherWarn(x) ? ' bad' : '') + '"><span>' + OR.clock(new Date(x.at)) + '</span><i aria-hidden="true">' + c[1] + '</i><b>' + Math.round(x.temp) + '°</b><small>' + Math.round(x.rainP || 0) + '%</small></div>'; }).join('') + '</div>' +
        (warns.length ? '<p class="wxs-warn">' + esc(warns.join('. ')) + '</p>' : '<p class="wxs-ok">No bad weather expected on this route.</p>') + '</div>';
      put();
    } catch (e) { if (strip.key === key) { strip.html = '<div class="wxs"><span class="muted small">Weather unavailable: ' + esc(e.message) + '</span></div>'; put(); } }
  }
  function put() {
    const el = $('#wxStrip'); if (!el) return;
    el.innerHTML = strip.html;
    const t = $('#wxsDep', el); if (t) t.onchange = () => {
      const [h, m] = t.value.split(':').map(Number); if (isNaN(h)) return;
      const d = new Date(); d.setHours(h, m, 0, 0); if (d < Date.now() - 1800000) d.setDate(d.getDate() + 1);
      OR.plan.depart = d; strip.key = ''; loadStrip(OR.plan.route);
    };
  }
  OR.on('planCleared', () => { strip = { key: '', html: '' }; OR.setData('wx', null); });

  // ---------- the route brief ----------
  OR.openBrief = async function (route) {
    if (!route) return;
    OR.sheet('<div class="brief"><h2>' + ic('shield') + 'Route brief</h2><p class="muted">Checking weather, hazards, traffic and the rules for each country on the route…</p><div class="spin"></div></div>');
    let b;
    try { b = await OR.buildBrief(route, depTime()); } catch (e) { OR.sheet('<h2>Route brief</h2><p class="err">Couldn\'t build the brief: ' + esc(e.message) + '</p>'); return; }
    OR.lastBrief = b;
    OR.sheet(briefHtml(b, false), box => {
      $('#bSay', box).onclick = () => { const was = OR.cfg.voice; OR.cfg.voice = true; OR.say(OR.briefText(b)); OR.cfg.voice = was; };
      $('#bShare', box).onclick = () => OR.share(OR.briefText(b), 'Route brief: ' + route.name);
      $('#bPdf', box).onclick = () => OR.printHtml('Route brief ' + route.name, '<!doctype html><html><head><meta charset="utf-8"><title>Route brief</title><style>' + PRINT_CSS + '</style></head><body>' + briefHtml(b, true) + '</body></html>');
      $$('.kit input', box).forEach(c => c.onchange = () => { const k = OR.store.get('kitTicks', {}); k[c.dataset.k] = c.checked; OR.store.set('kitTicks', k); });
      $$('[data-goto]', box).forEach(a => a.onclick = () => { const [lng, lat] = a.dataset.goto.split(',').map(Number); OR.closeSheet(); OR.map.flyTo({ center: [lng, lat], zoom: 15 }); if (innerWidth < 900) $('#panel').classList.remove('open'); });
      const tk = $('#bKey', box); if (tk) tk.onclick = () => { OR.closeSheet(); OR.openMore('settings'); };
    });
  };
  const PRINT_CSS = 'body{font:11pt/1.45 Arial,sans-serif;color:#1c2226;margin:16mm}h2{color:#0b6b3a;margin:0 0 4mm}h3{margin:6mm 0 2mm;padding:1.5mm 3mm;background:#0b6b3a;color:#fff;border-radius:2mm;font-size:12pt}' +
    'svg,.no-print,.spin{display:none}table{border-collapse:collapse;width:100%}td{padding:1mm 2mm;border-bottom:.3mm solid #ddd}.chips span{display:inline-block;border:.3mm solid #c62828;color:#c62828;border-radius:2mm;padding:.5mm 2mm;margin:0 1mm 1mm 0}' +
    'ul{margin:1mm 0 2mm 5mm;padding:0}.kit li{list-style:none}.kit input{margin-right:2mm}a{color:#0b6b3a}';

  function briefHtml(b, print) {
    const r = b.route, e = esc;
    let h = '<div class="brief"><h2>' + ic('shield') + 'Route brief: ' + e(r.name) + '</h2>' +
      '<div class="bsum"><div><b>' + OR.fmtDist(r.dist) + '</b><span>' + OR.fmtTime(r.time) + ' riding</span></div><div><b>' + OR.clock(b.dep) + ' to ' + OR.clock(b.arrive) + '</b><span>leave and arrive</span></div>' +
      (b.sunset ? '<div><b>' + OR.clock(b.sunset) + '</b><span>sunset</span></div>' : '') + '<div><b>' + OR.bendLabel(r.twist) + '</b><span>' + (r.mwayPct ? r.mwayPct + '% motorway' : 'no motorway') + '</span></div></div>';
    if (b.warnings.length) h += '<h3>Watch out for</h3><div class="chips bad">' + b.warnings.map(w => '<span>' + e(w) + '</span>').join('') + '</div>';

    // weather
    h += '<h3>' + ic('cloud') + 'Weather</h3>';
    if (b.wx && b.wx.length) h += '<ol class="wxl">' + b.wx.map(x => { const c = OR.wmo(x.code); return '<li><span class="t">' + OR.clock(new Date(x.at)) + '</span><span class="e">' + c[1] + '</span><span class="d">' + c[0] + (x.end ? ', at the end' : x.along < 200 ? ', at the start' : ', ' + OR.fmtDist(x.along) + ' in') + '</span><b>' + Math.round(x.temp) + '°</b><span class="s">' + Math.round(x.rainP || 0) + '% rain, gusts ' + Math.round(x.gust) + ' mph</span></li>'; }).join('') + '</ol>';
    else h += '<p class="muted">' + e(b.errors.wx || 'No forecast for this time') + '</p>';

    // hazards
    h += '<h3>' + ic('pass') + 'On the road</h3>';
    const hz = b.hazards || [];
    if (b.errors.hazards) h += '<p class="muted">Hazard check unavailable: ' + e(b.errors.hazards) + '</p>';
    else if (!hz.length) h += '<p>No level crossings, fords, cattle grids or marked hazards found on the route.</p>';
    else h += '<p>' + e(OR.summariseHazards(hz)) + '</p><ul class="hz">' + hz.slice(0, 25).map(x => '<li><button class="linkish" data-goto="' + x.lng + ',' + x.lat + '">' + e(x.what) + '</button> at ' + OR.fmtDist(x.at) + '</li>').join('') + '</ul>';
    if (b.cams && b.cams.length) h += '<p>' + b.cams.length + ' speed camera' + (b.cams.length > 1 ? 's' : '') + ' on the UK or Irish part of the route.</p>';
    h += '<p class="small muted">From OpenStreetMap. Not every hazard is mapped: ride to what you can see.</p>';

    // traffic
    h += '<h3>' + ic('time') + 'Traffic</h3>';
    if (b.traffic == null && !b.errors.traffic) h += '<p>Live traffic needs a free TomTom key. ' + (print ? '' : '<button class="linkish" id="bKey">Add one in Settings</button>') + '</p>';
    else if (b.errors.traffic) h += '<p class="muted">Traffic unavailable: ' + e(b.errors.traffic) + '</p>';
    else if (!b.traffic.length) h += '<p class="ok">No incidents reported on the route right now.</p>';
    else h += '<ul class="hz">' + b.traffic.map(t => '<li><button class="linkish" data-goto="' + t.lng + ',' + t.lat + '">' + e(t.what) + '</button>' + (t.roads ? ' on ' + e(t.roads) : '') + ' at ' + OR.fmtDist(t.at) + (t.delay ? ', ' + Math.round(t.delay / 60) + ' min delay' : t.size ? ', ' + e(t.size) : '') + (t.text ? '<br><small>' + e(t.text) + '</small>' : '') + '</li>').join('') + '</ul>';

    // rules
    h += '<h3>' + ic('flag') + 'Rules on this route</h3>';
    if (!b.countries.length) h += '<p class="muted">Couldn\'t work out which countries the route crosses' + (b.errors.countries ? ' (' + e(b.errors.countries) + ')' : '') + '.</p>';
    b.countries.forEach(c => {
      const x = OR.RULES[c];
      if (!x) { h += '<div class="rule"><b>' + e(c) + '</b><p class="muted">No rules saved for this country yet. Check the EU\'s Your Europe road rules page before you go.</p></div>'; return; }
      h += '<div class="rule"><div class="rule-h"><span class="fl">' + x.flag + '</span><b>' + e(x.name) + '</b><span class="side">Ride on the ' + x.side + '</span></div>' +
        '<table>' + x.limits.map(l => '<tr><td>' + e(l[0]) + '</td><td><b>' + e(l[1]) + '</b></td></tr>').join('') + '</table>' +
        (x.must.length ? '<p class="lbl">You must</p><ul>' + x.must.map(m => '<li>' + e(m) + '</li>').join('') + '</ul>' : '') +
        (x.carry.length ? '<p class="lbl">Carry</p><ul>' + x.carry.map(m => '<li>' + e(m) + '</li>').join('') + '</ul>' : '') +
        (x.know.length ? '<p class="lbl">Good to know</p><ul>' + x.know.map(m => '<li>' + e(m) + '</li>').join('') + '</ul>' : '') +
        '<p class="small"><a href="' + x.src + '" target="_blank">Official source</a>, checked ' + OR.RULES_CHECKED + '. Rules change: check before you travel.</p></div>';
    });

    // kit
    const ticks = OR.store.get('kitTicks', {});
    h += '<h3>' + ic('helmet') + 'Kit checklist</h3><ul class="kit">' + b.kit.map(k => { const id = k[0].replace(/\W+/g, '').slice(0, 30); return '<li><label><input type="checkbox" data-k="' + id + '"' + (ticks[id] ? ' checked' : '') + '><span><b>' + e(k[0]) + '</b>' + (k[1] ? '<small>' + e(k[1]) + '</small>' : '') + '</span></label></li>'; }).join('') + '</ul>';
    if (!print) h += '<div class="row no-print"><button class="btn" id="bSay">' + ic('vol') + 'Read aloud</button><button class="btn" id="bShare">' + ic('share') + 'Share</button><button class="btn" id="bPdf">' + ic('print') + 'PDF</button></div>';
    return h + '</div>';
  }
})(window.OR);
