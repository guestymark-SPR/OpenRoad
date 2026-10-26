/* OpenRoad maintenance screen (More, Maintenance). */
'use strict';
(function (OR) {
  const $ = OR.$, $$ = OR.$$, esc = OR.esc, ic = n => OR.ic(n);
  const STATE = { over: ['Overdue', 'bad'], soon: ['Due soon', 'warnc'], ok: ['OK', 'okc'], unknown: ['Not set', 'muted'] };
  const today = () => OR.isoDate(new Date());
  const fmtDate = s => s ? new Date(s + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  OR.pageMaint = function render(box) {
    const m = OR.maint.get(), odo = OR.maint.odoMiles(m), unit = m.odoUnit || 'mi';
    const alerts = OR.maintAlerts();
    let h = '<div class="odo"><div><span>Odometer</span><b>' + (m.odo === '' ? '–' : Number(m.odo).toLocaleString('en-GB')) + ' ' + unit + '</b><small>' + (m.odo === '' ? 'Enter it once: rides you record are added automatically' : 'Rides you record are added automatically') + '</small></div>' +
      '<button class="btn small" id="mOdo">Update</button></div>';
    if (alerts.length) h += '<div class="alerts">' + alerts.map(a => '<div class="al ' + a.state + '"><b>' + esc(a.what) + '</b><span>' + esc(a.text) + '</span></div>').join('') + '</div>';
    else if (odo != null) h += '<p class="ok small">Nothing due. Ride on.</p>';

    // services
    h += '<details open><summary>' + ic('wrench') + 'Services and intervals</summary><div class="list">' + m.items.map((it, i) => {
      const d = OR.dueOf(it, m), st = STATE[d.state];
      return '<div class="li svc ' + d.state + '"><div class="svc-h"><b>' + esc(it.name) + '</b><span class="tag ' + st[1] + '">' + st[0] + '</span></div>' +
        '<span>Every ' + [it.miles ? Number(it.miles).toLocaleString('en-GB') + ' mi' : '', it.months ? it.months + ' month' + (it.months > 1 ? 's' : '') : ''].filter(Boolean).join(' or ') +
        (it.lastDate || it.lastMiles !== '' ? '. Last done ' + [fmtDate(it.lastDate), it.lastMiles !== '' ? Number(it.lastMiles).toLocaleString('en-GB') + ' mi' : ''].filter(Boolean).join(' at ') : '') + '</span>' +
        '<span class="due">' + esc(d.text) + (d.state !== 'over' && d.milesLeft > 0 && OR.dueWhen && OR.dueWhen(d.milesLeft) ? ' (about ' + OR.dueWhen(d.milesLeft).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) + ' at your usual riding)' : '') + '</span><div class="row"><button class="btn small pri" data-done="' + i + '">Done today</button><button class="btn small ghost" data-edit="' + i + '">Edit</button></div></div>';
    }).join('') + '</div><button class="btn wide ghost" id="mAdd">' + ic('plus') + 'Add a service item</button>' +
      '<p class="small muted">These are typical intervals to start you off. Change them to match the service schedule in your bike\'s handbook.</p></details>';

    // tyres
    h += '<details open><summary>' + ic('locate') + 'Tyres</summary><div class="tyres">' + ['front', 'rear'].map(w => {
      const t = m.tyres[w] || {}, s = OR.tyreState(t, m);
      return '<div class="li tyre"><div class="svc-h"><b>' + (w === 'front' ? 'Front' : 'Rear') + (t.model ? ': ' + esc(t.model) : '') + '</b>' + (s.last ? '<span class="tag ' + (parseFloat(s.last.mm) <= 1 ? 'bad' : parseFloat(s.last.mm) <= 2 ? 'warnc' : 'okc') + '">' + esc(s.last.mm) + ' mm</span>' : '') + '</div>' +
        (t.fittedDate ? '<span>Fitted ' + fmtDate(t.fittedDate) + (t.fittedMiles !== undefined && t.fittedMiles !== '' ? ' at ' + Number(t.fittedMiles).toLocaleString('en-GB') + ' mi' : '') + (s.ageYears != null ? ', ' + s.ageYears.toFixed(1) + ' years old' : '') + '</span>' : '<span class="muted">No tyre recorded yet</span>') +
        (s.used != null ? '<span>' + Math.round(s.used).toLocaleString('en-GB') + ' mi on this tyre' + (t.life ? ' of about ' + Number(t.life).toLocaleString('en-GB') : '') + '</span>' : '') +
        (s.pct != null ? '<span class="bar tw"><i style="width:' + s.pct + '%;background:' + (s.pct >= 90 ? 'var(--red)' : s.pct >= 75 ? '#ef8f00' : 'var(--green-2)') + '"></i></span>' : '') +
        (s.ageYears != null && s.ageYears >= 5 ? '<span class="warn small">Over 5 years old: have it checked even if the tread is fine</span>' : '') +
        '<div class="row"><button class="btn small" data-tread="' + w + '">Log tread</button><button class="btn small ghost" data-newtyre="' + w + '">New tyre fitted</button></div></div>';
    }).join('') + '</div>' +
      '<div class="two">' + OR.field('mPf', 'Front pressure (' + (m.pressures.unit || 'psi') + ')', m.pressures.front, 'number', 'from the handbook') + OR.field('mPr', 'Rear pressure (' + (m.pressures.unit || 'psi') + ')', m.pressures.rear, 'number', 'solo, cold') + '</div>' +
      '<p class="small muted">UK law for motorbikes over 50cc: at least 1 mm of tread across three-quarters of the width, with visible tread on the rest. Most riders change well before that. Check pressures cold, at least once a week.</p></details>';

    // pre-ride check
    const checkedToday = m.checkedOn === today(), ticksToday = m.checksDay === today();
    h += '<details' + (checkedToday ? '' : ' open') + '><summary>' + ic('shield') + 'Pre-ride check (T-CLOCS)' + (checkedToday ? ' <span class="tag okc">Done today</span>' : '') + '</summary><ul class="kit pre">' +
      OR.PRERIDE.map((p, i) => '<li><label><input type="checkbox" data-pre="' + i + '"' + ((checkedToday || ticksToday) && m.checks[i] ? ' checked' : '') + '><span><b>' + p[0] + '</b><small>' + p[1] + '</small></span></label></li>').join('') + '</ul>' +
      (m.checkedOn && !checkedToday ? '<p class="small muted">Last full check ' + fmtDate(m.checkedOn) + '.</p>' : '') + '</details>';

    // documents
    h += '<details><summary>' + ic('id') + 'MOT, insurance and tax</summary>' + [['mot', 'MOT due'], ['insurance', 'Insurance renewal'], ['tax', 'Road tax due'], ['breakdown', 'Breakdown cover renewal']].map(([k, l]) => {
      const d = OR.docDue(m.docs[k]);
      return '<div class="docrow"><label class="f"><span>' + l + (d ? ' <span class="tag ' + (d.state === 'over' ? 'bad' : d.state === 'soon' ? 'warnc' : 'okc') + '">' + (d.days < 0 ? 'expired' : d.days + ' days') + '</span>' : '') + '</span><input type="date" data-doc="' + k + '" value="' + esc(m.docs[k] || '') + '"></label></div>';
    }).join('') + '</details>';

    // history
    h += '<details><summary>' + ic('save') + 'Service history (' + m.log.length + ')</summary><button class="btn wide" id="mLog">' + ic('plus') + 'Add work done</button>' +
      (m.log.length ? '<div class="list">' + m.log.map((l, i) => '<div class="li"><div class="svc-h"><b>' + esc(l.what) + '</b>' + (l.cost ? '<span class="tag okc">£' + esc(l.cost) + '</span>' : '') + '</div><span>' + fmtDate(l.date) + (l.miles ? ', ' + Number(l.miles).toLocaleString('en-GB') + ' mi' : '') + (l.who ? ', ' + esc(l.who) : '') + '</span>' + (l.notes ? '<span>' + esc(l.notes) + '</span>' : '') + '<div class="row"><button class="mini" data-dellog="' + i + '" aria-label="Delete">' + OR.ic('x') + '</button></div></div>').join('') + '</div>' : '<p class="muted small">Services, repairs and parts you record appear here.</p>') + '</details>';
    box.innerHTML = h;
    bind(box, m);
  };

  function bind(box, m) {
    const re = () => OR.pageMaint(box), save = () => OR.maint.save(m);
    $('#mOdo', box).onclick = () => OR.sheet('<h2>Odometer</h2><div class="two">' + OR.field('oVal', 'Reading', m.odo, 'number') + '<label class="f"><span>Units</span><select id="oU"><option value="mi"' + (m.odoUnit !== 'km' ? ' selected' : '') + '>miles</option><option value="km"' + (m.odoUnit === 'km' ? ' selected' : '') + '>km</option></select></label></div><button class="btn wide pri" id="oSave">Save</button>',
      b => $('#oSave', b).onclick = () => { m.odo = $('#oVal', b).value === '' ? '' : parseFloat($('#oVal', b).value); m.odoUnit = $('#oU', b).value; save(); OR.closeSheet(); re(); });
    $$('[data-done]', box).forEach(x => x.onclick = () => {
      const it = m.items[+x.dataset.done]; it.lastDate = today(); it.lastMiles = OR.maint.odoMiles(m) != null ? Math.round(OR.maint.odoMiles(m)) : '';
      m.log.unshift({ date: today(), miles: it.lastMiles, what: it.name, cost: '', who: '', notes: '' }); save(); OR.toast(it.name + ' recorded'); re();
    });
    const itemSheet = (it, isNew) => OR.sheet('<h2>' + (isNew ? 'Add a service item' : esc(it.name)) + '</h2>' + OR.field('iN', 'What', it.name, 'text', 'e.g. Primary chaincase oil') +
      '<div class="two">' + OR.field('iM', 'Every (miles, 0 for none)', it.miles, 'number') + OR.field('iT', 'Or every (months, 0 for none)', it.months, 'number') + '</div>' +
      '<div class="two">' + OR.field('iLD', 'Last done', it.lastDate, 'date') + OR.field('iLM', 'At (miles)', it.lastMiles, 'number') + '</div>' +
      '<button class="btn wide pri" id="iSave">Save</button>' + (isNew ? '' : '<button class="btn wide ghost" id="iDel">Remove this item</button>'), b => {
      $('#iSave', b).onclick = () => { it.name = $('#iN', b).value.trim() || 'Service item'; it.miles = parseFloat($('#iM', b).value) || 0; it.months = parseFloat($('#iT', b).value) || 0; it.lastDate = $('#iLD', b).value; it.lastMiles = $('#iLM', b).value === '' ? '' : parseFloat($('#iLM', b).value); if (isNew) m.items.push(it); save(); OR.closeSheet(); re(); };
      const d = $('#iDel', b); if (d) d.onclick = () => { m.items.splice(m.items.indexOf(it), 1); save(); OR.closeSheet(); re(); };
    });
    $$('[data-edit]', box).forEach(x => x.onclick = () => itemSheet(m.items[+x.dataset.edit], false));
    $('#mAdd', box).onclick = () => itemSheet({ id: OR.uid(), name: '', miles: 0, months: 12, lastDate: '', lastMiles: '' }, true);
    $$('[data-tread]', box).forEach(x => x.onclick = () => OR.sheet('<h2>' + (x.dataset.tread === 'front' ? 'Front' : 'Rear') + ' tread depth</h2>' + OR.field('tMm', 'Shallowest tread (mm)', '', 'number', 'e.g. 3.5') + '<p class="small muted">Measure in the main grooves with a tread gauge, at a few points round the tyre.</p><button class="btn wide pri" id="tSave">Save</button>',
      b => $('#tSave', b).onclick = () => { const mm = $('#tMm', b).value; if (!mm) return; const t = m.tyres[x.dataset.tread] = m.tyres[x.dataset.tread] || {}; (t.tread = t.tread || []).unshift({ date: today(), mm, odo: OR.maint.odoMiles(m) }); save(); OR.closeSheet(); re(); }));
    $$('[data-newtyre]', box).forEach(x => x.onclick = () => {
      const w = x.dataset.newtyre, t = m.tyres[w] || {};
      OR.sheet('<h2>New ' + w + ' tyre</h2>' + OR.field('nM', 'Make and model', t.model || '', 'text', 'e.g. Dunlop Elite 4') + '<div class="two">' + OR.field('nD', 'Fitted on', today(), 'date') + OR.field('nMi', 'At (miles)', OR.maint.odoMiles(m) != null ? Math.round(OR.maint.odoMiles(m)) : '', 'number') + '</div>' +
        OR.field('nL', 'Expected life (miles)', t.life || '', 'number', 'your best guess for this tyre') + OR.field('nMm', 'New tread depth (mm)', '', 'number', 'optional') + '<button class="btn wide pri" id="nSave">Save</button>', b => {
        $('#nSave', b).onclick = () => { const mm = $('#nMm', b).value, old = m.tyres[w] || {}, odoNow = OR.maint.odoMiles(m);
          if (old.fittedMiles !== undefined && old.fittedMiles !== '' && odoNow != null) (m.tyreHistory = m.tyreHistory || []).push({ w, model: old.model || '', miles: odoNow - parseFloat(old.fittedMiles), removed: today() });
          m.tyres[w] = { model: $('#nM', b).value.trim(), fittedDate: $('#nD', b).value, fittedMiles: $('#nMi', b).value === '' ? '' : parseFloat($('#nMi', b).value), life: $('#nL', b).value, tread: mm ? [{ date: $('#nD', b).value, mm, odo: $('#nMi', b).value === '' ? null : parseFloat($('#nMi', b).value) }] : [] };
          m.log.unshift({ date: $('#nD', b).value, miles: m.tyres[w].fittedMiles, what: 'New ' + w + ' tyre' + (m.tyres[w].model ? ': ' + m.tyres[w].model : ''), cost: '', who: '', notes: '' }); save(); OR.closeSheet(); re(); };
      });
    });
    $('#mPf', box).onchange = e => { m.pressures.front = e.target.value; save(); };
    $('#mPr', box).onchange = e => { m.pressures.rear = e.target.value; save(); };
    $$('[data-pre]', box).forEach(c => c.onchange = () => {
      if (m.checksDay !== today()) { m.checks = {}; m.checksDay = today(); }
      m.checks[c.dataset.pre] = c.checked;
      const all = OR.PRERIDE.every((_, i) => m.checks[i]);
      if (all) m.checkedOn = today(); save();
      if (all) { OR.toast('Pre-ride check done. Enjoy the ride'); re(); }
    });
    $$('[data-doc]', box).forEach(i => i.onchange = () => { m.docs[i.dataset.doc] = i.value; save(); re(); });
    $('#mLog', box).onclick = () => OR.sheet('<h2>Add work done</h2>' + OR.field('lW', 'What was done', '', 'text', 'e.g. 10,000 mile service') + '<div class="two">' + OR.field('lD', 'Date', today(), 'date') + OR.field('lM', 'Miles', OR.maint.odoMiles(m) != null ? Math.round(OR.maint.odoMiles(m)) : '', 'number') + '</div>' +
      '<div class="two">' + OR.field('lC', 'Cost (£)', '', 'number') + OR.field('lB', 'Who did it', '', 'text', 'garage or me') + '</div>' + OR.field('lN', 'Notes', '', 'text', 'parts, oil used…') + '<button class="btn wide pri" id="lSave">Save</button>', b => {
      $('#lSave', b).onclick = () => { const w = $('#lW', b).value.trim(); if (!w) { OR.toast('Say what was done'); return; } m.log.unshift({ what: w, date: $('#lD', b).value, miles: $('#lM', b).value, cost: $('#lC', b).value, who: $('#lB', b).value.trim(), notes: $('#lN', b).value.trim() }); m.log.sort((a, c) => String(c.date).localeCompare(String(a.date))); save(); OR.closeSheet(); re(); };
    });
    $$('[data-dellog]', box).forEach(x => x.onclick = () => { if (confirm('Delete this entry?')) { m.log.splice(+x.dataset.dellog, 1); save(); re(); } });
  }

  // once a day, mention anything overdue
  setTimeout(() => {
    const a = OR.maintAlerts().filter(x => x.state === 'over'); if (!a.length) return;
    const k = 'maintNag' + new Date().toDateString(); if (OR.store.get(k, false)) return; OR.store.set(k, true);
    OR.toast('Maintenance due: ' + a.map(x => x.what).slice(0, 3).join(', ') + '. See Bike, Maintenance', 7000);
  }, 6000);
})(window.OR);

/* "My bike": profile, fuel log and what OpenRoad has learned. */
(function (OR) {
  const $ = OR.$, $$ = OR.$$, esc = OR.esc, MI = 1609.344;
  const fmtD = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const money = (v, cur) => (cur === 'EUR' ? '€' : '£') + (v >= 100 ? Math.round(v) : v.toFixed(2));

  // ---------- filling up ----------
  OR.fillUpSheet = function () {
    const m = OR.maint.get(), odo = OR.maint.odoMiles(m);
    const cur = OR.pos && OR.inUK && !OR.inUK(OR.pos.lng, OR.pos.lat) ? 'EUR' : 'GBP';
    const last = OR.fuelLog.list()[0];
    OR.sheet('<h2>' + OR.ic('fuel') + 'Filled up</h2>' +
      '<div class="two">' + OR.field('fL', 'Litres', '', 'number', 'from the pump') + OR.field('fP', 'Price a litre (' + (cur === 'EUR' ? '€' : '£') + ')', last && last.cur === cur ? last.price : '', 'number', cur === 'EUR' ? 'e.g. 1.79' : 'e.g. 1.42') + '</div>' +
      OR.field('fO', 'Odometer (' + (m.odoUnit || 'mi') + ')', m.odo === '' ? '' : m.odo, 'number', 'optional, makes it more accurate') +
      '<label class="chk"><input type="checkbox" id="fF" checked> Filled to the top</label>' +
      '<p class="small muted">Fill to the top each time if you can: OpenRoad works out your real mpg between two full tanks.</p>' +
      '<button class="btn wide pri" id="fSave">Save fill-up</button>', b => {
      $('#fSave', b).onclick = () => {
        const L = parseFloat($('#fL', b).value); if (!(L > 0)) { OR.toast('Enter the litres'); return; }
        const o = $('#fO', b).value === '' ? null : parseFloat($('#fO', b).value), full = $('#fF', b).checked;
        const odoMi = o == null ? null : (m.odoUnit === 'km' ? o / 1.609344 : o);
        const list = OR.fuelLog.list();
        list.unshift({ id: OR.uid(), t: Date.now(), litres: L, price: parseFloat($('#fP', b).value) || 0, cur, full, odo: odoMi, lat: OR.pos && OR.pos.lat, lng: OR.pos && OR.pos.lng });
        OR.fuelLog.save(list.slice(0, 400));
        if (o != null) { m.odo = o; OR.maint.save(m); }
        if (full) OR.filledUp(); else { OR.cfg.fuelSince = Math.max(0, (OR.cfg.fuelSince || 0) - L / 4.54609 * (OR.mpg() || 40) * MI); OR.saveCfg(); }
        OR.closeSheet();
        const l = OR.learnedMpg(); OR.toast(l ? 'Saved. Your real economy: ' + l.mpg.toFixed(1) + ' mpg' : 'Saved. Two full fill-ups and OpenRoad knows your real mpg', 5000);
        if ($('#bikePage')) OR.pageBike($('#bikePage').parentNode);
      };
    });
  };

  // ---------- the page ----------
  function speedoCard() {
    const r = OR.speedoResult(), n = OR.speedoList().length;
    return '<div class="card"><b>' + OR.ic('lean') + ' Speedo check</b><p class="small">' + (r ? 'Your speedo reads <b>' + Math.abs(r.pct).toFixed(1) + '% ' + (r.pct >= 0 ? 'high' : 'low') + '</b>, from ' + r.n + ' readings' + (r.sd > 3 ? ' (they vary quite a bit: a few more will make it surer)' : '') + '. At an indicated ' + (OR.cfg.units === 'km' ? '100 km/h you\'re doing about ' + Math.round(100 / (1 + r.pct / 100)) + ' km/h' : '70 mph you\'re doing about ' + Math.round(70 / (1 + r.pct / 100)) + ' mph') + '.' :
      'Compare your speedo with GPS' + (n ? ': ' + n + ' of 3 readings so far' : '') + '. While riding steadily, open Ride options, Speedo check, and tap what the speedo shows (or say "speedo 50").') + '</p>' +
      (n ? '<button class="btn small ghost" id="spReset">Start again</button>' : '') + '</div>';
  }
  OR.pageBike = function (box) {
    setTimeout(() => { const el = document.createElement('div'); el.innerHTML = speedoCard(); box.appendChild(el); const rs = el.querySelector('#spReset'); if (rs) rs.onclick = () => { if (confirm('Clear your speedo readings?')) { OR.store.set('speedo', []); OR.pageBike(box); } }; }, 0);
    const b = OR.cfg.bike, prof = OR.BIKES[b.profile], range = OR.fuelRange(), left = OR.fuelLeft();
    const lm = OR.learnedMpg(), pace = OR.pace(), brk = OR.breaks(), mm = OR.monthlyMiles(), costs = OR.runningCosts();
    let h = '<div id="bikePage"></div>';
    // which bike
    h += '<div class="bikecard"><div class="bk-h">' + OR.badge('moto', '#0e9f57') + '<div><b>' + esc(prof ? prof.name : (b.name || 'Your bike')) + '</b><span>' + (prof ? 'Set up with Harley-Davidson\'s figures' : 'Choose your bike to load its figures and service schedule') + '</span></div></div>' +
      '<label class="f"><span>Bike</span><select id="bProf"><option value="">Other (enter your own)</option>' + Object.keys(OR.BIKES).map(k => '<option value="' + k + '"' + (b.profile === k ? ' selected' : '') + '>' + esc(OR.BIKES[k].name) + '</option>').join('') + '</select></label>' +
      (prof ? '<table class="facts">' + prof.facts.map(f => '<tr><td>' + esc(f[0]) + '</td><td>' + esc(f[1]) + '</td></tr>').join('') + '</table><p class="small muted">' + esc(prof.pressureNote) + ' <a href="' + prof.sources[0] + '" target="_blank">Harley spec</a>, <a href="' + prof.sources[1] + '" target="_blank">service intervals</a>.</p>'
        : OR.field('bName', 'Name', b.name, 'text', 'e.g. Low Rider S')) + '</div>';

    // fuel
    h += '<h3>' + OR.ic('fuel') + 'Fuel</h3><div class="stats">' +
      '<div><b>' + (lm ? lm.mpg.toFixed(1) : '–') + '</b><span>' + (lm ? 'mpg, your real economy' : 'real mpg: log 2 full tanks') + '</span></div>' +
      '<div><b>' + (range ? OR.fmtDist(range) : '–') + '</b><span>range on a full tank</span></div>' +
      '<div><b>' + (left != null ? OR.fmtDist(left) : '–') + '</b><span>left now (estimate)</span></div></div>' +
      '<button class="btn wide pri" id="bFill">' + OR.ic('fuel') + 'I\'ve filled up</button>';
    const byStyle = ['slow', 'mixed', 'fast'].map(s => [s, OR.learnedMpg(s)]).filter(x => x[1]);
    if (byStyle.length) h += '<div class="learned"><p class="lbl">By riding style</p>' + byStyle.map(([s, l]) => '<div class="lr"><span>' + OR.STYLE_NAMES[s] + '</span><b>' + l.mpg.toFixed(1) + ' mpg</b></div>').join('') +
      '<p class="small muted">Routes and trips use the economy that fits their roads.</p></div>';
    h += '<div class="two">' + OR.field('bTank', 'Tank size (litres)', b.tankL, 'number') + OR.field('bMpg', lm ? 'Your mpg before learning' : 'Starting mpg (until it learns)', b.mpg, 'number') + '</div>' +
      OR.field('bRes', 'Warn me with this many miles left', b.reserveMi, 'number') +
      '<label class="f"><span>Fuel for live prices abroad</span><select id="bGrade">' + Object.keys(OR.FUEL_GRADES).map(k => '<option value="' + k + '"' + ((OR.cfg.fuelGrade || 'e10') === k ? ' selected' : '') + '>' + OR.FUEL_GRADES[k] + '</option>').join('') + '</select></label>';
    const fl = OR.fuelLog.list();
    if (fl.length) h += '<details><summary>' + OR.ic('fuel') + 'Fill-ups (' + fl.length + ')</summary><div class="list">' + fl.slice(0, 30).map((f, i) => '<div class="li fill"><div class="svc-h"><b>' + f.litres.toFixed(1) + ' L' + (f.price ? ' at ' + money(f.price, f.cur) : '') + '</b>' + (f.price ? '<span class="tag okc">' + money(f.litres * f.price, f.cur) + '</span>' : '') + '</div><span>' + fmtD(f.t) + (f.full ? ', full tank' : ', part fill') + (f.odo ? ', ' + Math.round(f.odo).toLocaleString('en-GB') + ' mi' : '') + '</span><div class="row"><button class="mini" data-delfill="' + i + '" aria-label="Delete">' + OR.ic('x') + '</button></div></div>').join('') + '</div></details>';

    // riding
    h += '<h3>' + OR.ic('lean') + 'How you ride</h3><div class="learned">' +
      '<div class="lr"><span>Pace</span><b>' + (pace ? (Math.abs(pace.factor - 1) < 0.03 ? 'Same as the planner' : Math.round(Math.abs(pace.factor - 1) * 100) + '% ' + (pace.factor > 1 ? 'slower' : 'quicker') + ' than the planner') : 'Ride 2 planned routes to learn') + '</b></div>' +
      '<div class="lr"><span>Breaks</span><b>' + (brk ? 'about ' + Math.round(brk.perHour / 60) + ' min per hour of riding' : 'learning') + '</b></div>' +
      '<div class="lr"><span>Usual mileage</span><b>' + (mm ? Math.round(mm).toLocaleString('en-GB') + ' mi a month' : 'learning') + '</b></div>' +
      '<p class="small muted">' + (pace ? 'Arrival times, route times and trip timetables now use your pace' + (brk ? ' and your usual breaks' : '') + '. ' : '') + 'Learned from your recorded rides' + (pace ? ' (' + pace.n + ' on planned routes)' : '') + '.</p></div>';

    // wear and costs
    const tf = OR.treadForecast('front'), tr = OR.treadForecast('rear'), lf = OR.tyreLife('front'), lr = OR.tyreLife('rear');
    h += '<h3>' + OR.ic('wrench') + 'Wear and running costs</h3><div class="learned">' +
      '<div class="lr"><span>Cost per mile (last 12 months)</span><b>' + (costs.perMile != null ? '£' + costs.perMile.toFixed(2) : 'learning') + '</b></div>' +
      '<div class="lr"><span>Fuel spent (12 months)</span><b>£' + Math.round(costs.fuel) + '</b></div>' +
      '<div class="lr"><span>Servicing and parts (12 months)</span><b>£' + Math.round(costs.work) + '</b></div>' +
      [['Front', tf, lf], ['Rear', tr, lr]].map(([n, f, l]) => '<div class="lr"><span>' + n + ' tyre</span><b>' + (f ? (f.milesTo2 < 1 ? 'down to 2 mm' : '2 mm in about ' + Math.round(f.milesTo2).toLocaleString('en-GB') + ' mi' + (f.months != null ? ' (' + (f.months < 1 ? 'within a month' : 'about ' + Math.round(f.months) + ' month' + (Math.round(f.months) === 1 ? '' : 's')) + ')' : '')) : l ? 'your tyres last about ' + Math.round(l.miles).toLocaleString('en-GB') + ' mi' : 'log tread twice to forecast') + '</b></div>').join('') +
      '<p class="small muted">Costs come from your fill-ups (pounds only) and the prices in Maintenance, Service history. Tyre forecasts come from your tread readings.</p></div>';
    box.innerHTML = h;
    bind(box);
  };

  function bind(box) {
    const b = OR.cfg.bike, re = () => OR.pageBike(box);
    $('#bProf', box).onchange = e => {
      const id = e.target.value;
      if (!id) { b.profile = ''; OR.saveCfg(); re(); return; }
      if (confirm('Set up as ' + OR.BIKES[id].name + '? This loads Harley\'s service schedule into Maintenance (keeping any dates you\'ve already recorded).')) { OR.applyBike(id); OR.toast('Set up as ' + OR.BIKES[id].short); }
      re();
    };
    const keep = (id, key) => { const el = $('#' + id, box); if (el) el.onchange = () => { b[key] = el.value === '' ? '' : (key === 'name' ? el.value.trim() : parseFloat(el.value)); OR.saveCfg(); re(); }; };
    keep('bName', 'name'); keep('bTank', 'tankL'); keep('bMpg', 'mpg'); keep('bRes', 'reserveMi');
    { const gs = box.querySelector('#bGrade'); if (gs) gs.onchange = () => { OR.cfg.fuelGrade = gs.value; OR.saveCfg(); }; }
    $('#bFill', box).onclick = OR.fillUpSheet;
    $$('[data-delfill]', box).forEach(x => x.onclick = () => { if (!confirm('Delete this fill-up?')) return; const l = OR.fuelLog.list(); l.splice(+x.dataset.delfill, 1); OR.fuelLog.save(l); re(); });
  }
})(window.OR);
