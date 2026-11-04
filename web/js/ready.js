/* OpenRoad "ready to ride" card on a planned route: one list pulling together what you'd check before leaving: fuel
   range against the distance, offline maps on the phone, documents and service due, the phone's battery, and
   daylight. A tick if fine, an amber note if not. Each line is worked out from what the app already knows. */
'use strict';
(function (OR) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let batt = null;
  try { if (navigator.getBattery) navigator.getBattery().then(b => { const set = () => { batt = { level: Math.round(b.level * 100), charging: b.charging }; const el = document.querySelector('#readyCard'); if (el && OR.plan.route) el.outerHTML = OR.readyHtml(OR.plan.route); }; set(); b.addEventListener('levelchange', set); b.addEventListener('chargingchange', set); }).catch(() => { }); } catch (e) { }

  OR.readyItems = function (r) {
    const out = [], ok = (t) => out.push({ ok: true, t }), no = (t) => out.push({ ok: false, t });
    // fuel
    const range = OR.fuelRange && OR.fuelRange(), left = OR.fuelLeft && OR.fuelLeft();
    if (range == null) no('Set up your bike (Bike tab) so OpenRoad can check your fuel range');
    else {
      const usable = left != null ? left : range;
      if (r.dist > usable * 0.9) no('Fuel: about ' + OR.fmtDist(usable) + ' of range and this ride is ' + OR.fmtDist(r.dist) + '. Plan a fuel stop (Fuel check)');
      else ok('Fuel: about ' + OR.fmtDist(usable) + ' of range, ride is ' + OR.fmtDist(r.dist));
    }
    // offline maps
    if (OR.native && OR.native.mapPacks) {
      const n = (OR.packs.installed() || []).length;
      n ? ok('Offline maps on the phone (' + n + ' ' + (n === 1 ? 'pack' : 'packs') + ')') : no('No offline maps downloaded: the map and routes need a signal (Maps tab)');
    }
    // documents and service
    let alerts = []; try { alerts = OR.maintAlerts ? OR.maintAlerts() : []; } catch (e) { }
    const over = alerts.filter(a => a.state === 'over'), soon = alerts.filter(a => a.state === 'soon');
    if (over.length) no('Overdue: ' + over.slice(0, 3).map(a => a.what).join(', ') + (over.length > 3 ? ' and ' + (over.length - 3) + ' more' : ''));
    if (soon.length) no('Due soon: ' + soon.slice(0, 3).map(a => a.what).join(', '));
    if (!over.length && !soon.length) ok('No documents or service due');
    // the phone
    if (batt) (batt.level < 40 && !batt.charging) ? no('Phone is at ' + batt.level + '%. Charge it or take a battery pack') : ok('Phone ' + batt.level + '%' + (batt.charging ? ', charging' : ''));
    // daylight
    try {
      const d = OR.duskInfo && OR.duskInfo(r, OR.plan.depart ? new Date(OR.plan.depart) : new Date());
      if (d) d.dark ? no(d.allDark ? 'This ride is in the dark (sunset ' + OR.clock(d.set) + ')' : 'Last ' + OR.fmtDist(d.inDark) + ' is after sunset (' + OR.clock(d.set) + ')') : ok('Finishes before sunset (' + OR.clock(d.set) + ')');
    } catch (e) { }
    // rough road warning on a closure
    if (r.closures && r.closures.left && r.closures.left.length) no('Route goes through a road closure');
    return out;
  };

  OR.readyHtml = function (r) {
    if (!r || r.free) return '<div id="readyCard"></div>';
    const items = OR.readyItems(r), bad = items.filter(i => !i.ok).length;
    return '<div id="readyCard" class="card ready' + (bad ? ' warn' : ' okc') + '"><b>' + OR.ic(bad ? 'warn' : 'check') + (bad ? 'Before you go' : 'Ready to ride') + '</b><ul>' +
      items.map(i => '<li class="' + (i.ok ? 'ok' : 'no') + '"><i>' + (i.ok ? '✓' : '!') + '</i>' + esc(i.t) + '</li>').join('') + '</ul></div>';
  };
})(window.OR);
