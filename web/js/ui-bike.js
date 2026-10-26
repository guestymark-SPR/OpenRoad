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
        '<span class="due">' + esc(d.text) + '</span><div class="row"><button class="btn small pri" data-done="' + i + '">Done today</button><button class="btn small ghost" data-edit="' + i + '">Edit</button></div></div>';
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
      b => $('#tSave', b).onclick = () => { const mm = $('#tMm', b).value; if (!mm) return; const t = m.tyres[x.dataset.tread] = m.tyres[x.dataset.tread] || {}; (t.tread = t.tread || []).unshift({ date: today(), mm }); save(); OR.closeSheet(); re(); }));
    $$('[data-newtyre]', box).forEach(x => x.onclick = () => {
      const w = x.dataset.newtyre, t = m.tyres[w] || {};
      OR.sheet('<h2>New ' + w + ' tyre</h2>' + OR.field('nM', 'Make and model', t.model || '', 'text', 'e.g. Dunlop Elite 4') + '<div class="two">' + OR.field('nD', 'Fitted on', today(), 'date') + OR.field('nMi', 'At (miles)', OR.maint.odoMiles(m) != null ? Math.round(OR.maint.odoMiles(m)) : '', 'number') + '</div>' +
        OR.field('nL', 'Expected life (miles)', t.life || '', 'number', 'your best guess for this tyre') + OR.field('nMm', 'New tread depth (mm)', '', 'number', 'optional') + '<button class="btn wide pri" id="nSave">Save</button>', b => {
        $('#nSave', b).onclick = () => { const mm = $('#nMm', b).value; m.tyres[w] = { model: $('#nM', b).value.trim(), fittedDate: $('#nD', b).value, fittedMiles: $('#nMi', b).value === '' ? '' : parseFloat($('#nMi', b).value), life: $('#nL', b).value, tread: mm ? [{ date: $('#nD', b).value, mm }] : [] };
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
    OR.toast('Maintenance due: ' + a.map(x => x.what).slice(0, 3).join(', ') + '. See More, Maintenance', 7000);
  }, 6000);
})(window.OR);
