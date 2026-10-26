/* OpenRoad bike maintenance: odometer, service intervals, tyres, pre-ride checks, service history, documents. */
'use strict';
(function (OR) {
  const MI = 1609.344;
  // Typical intervals to start from. Every bike differs: the rider changes them to match the handbook.
  const START = [
    ['Service (dealer or full)', 5000, 12], ['Engine oil and filter', 5000, 12], ['Air filter', 10000, 24], ['Spark plugs', 10000, 24],
    ['Brake fluid', 0, 24], ['Brake pads (check)', 3000, 6], ['Drive belt or chain (check)', 1000, 3], ['Battery (check)', 0, 6], ['Lights and horn (check)', 0, 1]
  ].map(([name, miles, months]) => ({ id: OR.uid(), name, miles, months, lastMiles: '', lastDate: '' }));
  // T-CLOCS, the standard pre-ride check
  OR.PRERIDE = [
    ['Tyres and wheels', 'Pressures, tread depth, cuts or bulges, wheel bearings, spokes'], ['Controls', 'Levers, cables, throttle snaps back, clutch and brake free play'],
    ['Lights and electrics', 'Headlight high and low, indicators, brake light from both levers, horn'], ['Oil and fluids', 'Engine oil level, brake fluid, coolant if fitted, no leaks'],
    ['Chassis', 'Suspension, steering moves freely, belt or chain tension, mirrors'], ['Stands', 'Side stand springs back, cut-out switch works']
  ];

  const blank = () => ({ odo: '', odoUnit: 'mi', items: START.map(x => Object.assign({}, x)), tyres: { front: {}, rear: {} }, pressures: { front: '', rear: '', unit: 'psi' },
    log: [], checks: {}, checkedOn: '', docs: { mot: '', insurance: '', tax: '', breakdown: '' } });
  OR.maint = {
    get() { const m = OR.store.get('maint', null) || blank(); m.tyres = m.tyres || { front: {}, rear: {} }; m.docs = m.docs || {}; m.log = m.log || []; m.checks = m.checks || {}; return m; },
    save(m) { OR.store.set('maint', m); },
    odoMiles(m) { const v = parseFloat(m.odo); return isNaN(v) ? null : (m.odoUnit === 'km' ? v / 1.609344 : v); }
  };

  // every recorded ride adds to the odometer (once one has been entered)
  OR.on('ridestop', saved => {
    if (!saved) return;
    const m = OR.maint.get(); const v = parseFloat(m.odo); if (isNaN(v)) return;
    const add = saved.dist / (m.odoUnit === 'km' ? 1000 : MI);
    m.odo = Math.round((v + add) * 10) / 10; OR.maint.save(m);
  });

  const months = (a, b) => (b - a) / (30.44 * 864e5);
  OR.dueOf = function (item, m) {
    const odo = OR.maint.odoMiles(m), now = Date.now();
    let byMiles = null, byDate = null;
    if (item.miles > 0 && item.lastMiles !== '' && odo != null) byMiles = (parseFloat(item.lastMiles) + item.miles) - odo;
    if (item.months > 0 && item.lastDate) { const d = new Date(item.lastDate); d.setMonth(d.getMonth() + item.months); byDate = d; }
    if (byMiles == null && byDate == null) return { state: 'unknown', text: 'Not recorded yet' };
    const daysLeft = byDate ? (byDate - now) / 864e5 : null;
    const over = (byMiles != null && byMiles <= 0) || (daysLeft != null && daysLeft <= 0);
    const soon = !over && ((byMiles != null && byMiles <= Math.max(300, item.miles * 0.1)) || (daysLeft != null && daysLeft <= 30));
    const date = byDate && byDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    let text;
    if (over) {
      const p = [];
      if (byMiles != null && byMiles <= 0) p.push(Math.round(-byMiles).toLocaleString('en-GB') + ' mi overdue');
      if (daysLeft != null && daysLeft <= 0) p.push('was due ' + date);
      text = p.join(', ');
    } else {
      const p = [];
      if (byMiles != null) p.push('in ' + Math.round(byMiles).toLocaleString('en-GB') + ' mi');
      if (byDate) p.push('by ' + date);
      text = 'Next due ' + p.join(' or ');
    }
    return { state: over ? 'over' : soon ? 'soon' : 'ok', text: text.charAt(0).toUpperCase() + text.slice(1), milesLeft: byMiles };
  };
  OR.docDue = function (dateStr) {
    if (!dateStr) return null;
    const d = (new Date(dateStr + 'T12:00:00') - Date.now()) / 864e5;
    return { days: Math.ceil(d), state: d < 0 ? 'over' : d <= 30 ? 'soon' : 'ok' };
  };
  OR.tyreState = function (t, m) {
    const odo = OR.maint.odoMiles(m); const used = t.fittedMiles !== undefined && t.fittedMiles !== '' && odo != null ? odo - parseFloat(t.fittedMiles) : null;
    const life = parseFloat(t.life); const pct = used != null && life > 0 ? Math.min(100, Math.round(100 * used / life)) : null;
    const last = (t.tread || [])[0];
    const ageYears = t.fittedDate ? (Date.now() - new Date(t.fittedDate)) / (365.25 * 864e5) : null;
    return { used, pct, last, ageYears };
  };
  // anything overdue or due soon, for the reminder when the app opens
  OR.maintAlerts = function () {
    const m = OR.maint.get(), out = [];
    m.items.forEach(i => { const d = OR.dueOf(i, m); if (d.state === 'over' || d.state === 'soon') out.push({ what: i.name, state: d.state, text: d.text }); });
    [['mot', 'MOT'], ['insurance', 'Insurance'], ['tax', 'Road tax'], ['breakdown', 'Breakdown cover']].forEach(([k, l]) => { const d = OR.docDue(m.docs[k]); if (d && d.state !== 'ok') out.push({ what: l, state: d.state, text: d.days < 0 ? 'expired ' + (-d.days) + ' days ago' : 'due in ' + d.days + ' days' }); });
    ['front', 'rear'].forEach(w => { const s = OR.tyreState(m.tyres[w] || {}, m); if (s.last && parseFloat(s.last.mm) <= 2) out.push({ what: (w === 'front' ? 'Front' : 'Rear') + ' tyre', state: parseFloat(s.last.mm) <= 1 ? 'over' : 'soon', text: s.last.mm + ' mm tread left' }); });
    return out;
  };
})(window.OR);
