/* OpenRoad riders' tips: good places shared with every OpenRoad rider, the way public hazards are (anonymous,
   kept by map square on the free relay servers). A biker café, a bike night, a great view, secure bike parking,
   a great road, a good fuel stop. Each lasts 60 days from the last "still good"; two "it's gone" take it down.
   The sharing runs in the Android app (PublicHazards.java). */
'use strict';
(function (OR) {
  const N = () => OR.native, $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  OR.TIP_KINDS = [['cafe', 'Biker café', 'cup', 'tipcafe'], ['night', 'Bike night or meet', 'moto', 'tipnight'], ['view', 'Great view', 'view', 'tipview'],
    ['park', 'Secure bike parking', 'park', 'tippark'], ['road', 'Great road', 'twisty', 'tiproad'], ['fuel', 'Good fuel stop', 'fuel', 'tipfuel'], ['rough', 'Rough road surface', 'warn', 'tiprough']];
  const kindOf = k => OR.TIP_KINDS.find(x => x[0] === k) || OR.TIP_KINDS[0];
  OR.tipsOn = () => OR.cfg.pubTips !== false;
  OR.tipsAvailable = () => !!(N() && N().tips);
  let list = [], sig = '';

  function draw() {
    if (!OR.tipsAvailable()) return;
    try { list = OR.tipsOn() ? JSON.parse(N().tips()) : []; } catch (e) { list = []; }
    const s = list.map(t => t.tid + t.u + t.good).join();
    if (s === sig) return; sig = s;
    OR.setData('tips', { type: 'FeatureCollection', features: list.map(t => ({ type: 'Feature', properties: { id: t.tid, kind: kindOf(t.k)[3], name: t.n || kindOf(t.k)[1] }, geometry: { type: 'Point', coordinates: [t.lo, t.la] } })) });
  }
  OR.tipsRefresh = () => { sig = ''; draw(); };

  // what a tip says, for the sheet when you tap one
  OR.tipSheet = function (id) {
    const t = list.find(x => x.tid === id); if (!t) return;
    const k = kindOf(t.k), days = Math.max(0, Math.round((Date.now() - t.t) / 864e5));
    OR.sheet('<h2>' + OR.badge(k[2], OR.POI[k[3]].c) + ' ' + esc(t.n || k[1]) + '</h2><p class="small muted">' + esc(k[1]) + '. Shared by a rider ' + (days ? days + (days === 1 ? ' day' : ' days') + ' ago' : 'today') +
      (t.good > 1 ? ', ' + (t.good - 1) + ' more ' + (t.good === 2 ? 'rider says' : 'riders say') + ' it\'s good' : '') + '.</p>' + (t.x ? '<p>' + esc(t.x) + '</p>' : '') +
      '<div class="bigbtns"><button class="btn go" id="tpGo">' + OR.ic('moto') + 'Go here</button>' +
      (t.mine ? '<button class="btn wide ghost" id="tpDel">Take my tip down</button>' : t.voted ? '<p class="small muted">Thanks, you\'ve had your say on this one.</p>' :
        '<div class="row"><button class="btn" id="tpGood">' + OR.ic('check') + 'Still good</button><button class="btn" id="tpGone">It\'s gone</button></div>') + '</div>' +
      '<p class="small muted">Tips come from other riders and aren\'t checked. Opening times and events change.</p>', b => {
      b.querySelector('#tpGo').onclick = () => { OR.closeSheet(); OR.goTo && OR.goTo({ lng: t.lo, lat: t.la, name: t.n || k[1] }); };
      const g = b.querySelector('#tpGood'); if (g) g.onclick = () => { N().tipVote(id, true); OR.closeSheet(); OR.toast('Thanks. It stays up another 60 days.'); setTimeout(OR.tipsRefresh, 600); };
      const x = b.querySelector('#tpGone'); if (x) x.onclick = () => { N().tipVote(id, false); OR.closeSheet(); OR.toast('Thanks. It comes down when another rider agrees.'); setTimeout(OR.tipsRefresh, 600); };
      const d = b.querySelector('#tpDel'); if (d) d.onclick = () => { N().tipRemove(id); OR.closeSheet(); OR.toast('Tip taken down'); setTimeout(OR.tipsRefresh, 600); };
    });
  };

  // share a tip at a place on the map
  OR.tipAddSheet = function (ll, placeName) {
    if (!OR.tipsAvailable()) { OR.toast('Sharing tips needs the OpenRoad Android app'); return; }
    if (!OR.tipsOn()) { OR.toast('Riders\' tips are switched off. Turn them on in Settings, Road-ahead warnings.'); return; }
    let kind = 'cafe';
    OR.sheet('<h2>Share a tip with other riders</h2><p class="small">Everyone using OpenRoad nearby sees it on their map. Anonymous: your name isn\'t shared.</p>' +
      '<div class="chips tipkinds">' + OR.TIP_KINDS.map(k => '<button class="btn small' + (k[0] === kind ? ' on' : '') + '" data-k="' + k[0] + '">' + OR.ic(k[2]) + k[1] + '</button>').join('') + '</div>' +
      '<label class="f"><span>Name</span><input id="tpName" maxlength="40" value="' + esc(placeName || '') + '" placeholder="e.g. Jacob\'s Ladder café"></label>' +
      '<label class="f"><span>What\'s good (optional)</span><input id="tpNote" maxlength="120" placeholder="e.g. Bike night Wednesdays from 7, big car park"></label>' +
      '<button class="btn go wide" id="tpSend">' + OR.ic('send') + 'Share the tip</button>', b => {
      b.querySelectorAll('[data-k]').forEach(x => x.onclick = () => { kind = x.dataset.k; b.querySelectorAll('[data-k]').forEach(y => y.classList.toggle('on', y === x)); });
      b.querySelector('#tpSend').onclick = () => {
        const name = b.querySelector('#tpName').value.trim(), note = b.querySelector('#tpNote').value.trim();
        if (!name) { OR.toast('Give it a name'); return; }
        const ok = N().tipAdd(kind, name, note, ll[1], ll[0]);
        OR.closeSheet(); OR.toast(ok ? 'Tip shared with riders nearby' : 'Not shared: no connection yet, or 10 tips already today', 5000);
        setTimeout(OR.tipsRefresh, 800);
      };
    });
  };

  // watch the area being looked at, and redraw now and then (tips arrive from the relay servers)
  let areaT = 0;
  OR.on('ready', () => { });
  function start() {
    const m = OR.map; if (!m || !OR.tipsAvailable()) return;
    if (N().tipsOn) N().tipsOn(OR.tipsOn());
    const look = () => { clearTimeout(areaT); areaT = setTimeout(() => { if (!OR.tipsOn() || m.getZoom() < 8) return; const c = m.getCenter(); N().tipArea(c.lat, c.lng); setTimeout(draw, 3000); }, 1500); };
    m.on('moveend', look); look();
    setInterval(draw, 20000);
  }
  OR.tipsStart = start;
})(window.OR);
