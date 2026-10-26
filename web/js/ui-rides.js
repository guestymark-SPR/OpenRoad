/* After the ride: replay a ride on the map, make a picture of it to share, and your season in numbers. */
'use strict';
(function (OR) {
  const $ = OR.$, $$ = OR.$$, esc = OR.esc, ic = (n, c) => OR.ic(n, c), MI = 1609.344;

  // ---------- replay ----------
  let rp = null;
  OR.replayRide = function (r) {
    stopReplay();
    const pts = OR.rides.pts(r), times = OR.rides.times(r);
    if (pts.length < 2) return OR.toast('This ride has too few points to replay');
    const cum = OR.cumulative(pts);
    OR.setData('rideview', { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: pts } }] });
    if (innerWidth < 900) $('#panel').classList.remove('open');
    const el = document.createElement('div'); el.className = 'rp-dot'; el.innerHTML = ic('moto');
    const mk = new maplibregl.Marker({ element: el }).setLngLat(pts[0]).addTo(OR.map);
    const bar = document.createElement('div'); bar.id = 'replayBar';
    bar.innerHTML = '<div class="rp-info"><b>' + esc(r.name) + '</b><span id="rpNow"></span></div><input type="range" id="rpPos" min="0" max="1000" value="0" aria-label="Position in the ride">' +
      '<div class="rp-btns"><button id="rpPlay" class="btn small pri">Pause</button><button id="rpSpeed" class="btn small">×1</button><button id="rpFollow" class="btn small">Follow</button><button id="rpX" class="btn small ghost">Close</button></div>';
    document.body.appendChild(bar);
    const total = times[times.length - 1] - times[0], dur = Math.min(60000, Math.max(15000, total / 240)); // a ride plays in 15 to 60 seconds at ×1
    rp = { r, pts, times, cum, mk, bar, f: 0, speed: 1, playing: true, follow: false, last: performance.now() };
    OR.map.fitBounds(OR.bbox(pts), { padding: 70, pitch: 0, bearing: 0 });
    const at = f => {
      const t = times[0] + f * total; let i = 1; while (i < times.length - 1 && times[i] < t) i++;
      const k = times[i] > times[i - 1] ? Math.min(1, Math.max(0, (t - times[i - 1]) / (times[i] - times[i - 1]))) : 1;
      const p = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
      // speed over the last 20 s of the ride
      let j = i; while (j > 0 && times[i] - times[j] < 20000) j--;
      const v = times[i] > times[j] ? (cum[i] - cum[j]) / ((times[i] - times[j]) / 1000) : 0;
      return { p, t, d: cum[i - 1] + (cum[i] - cum[i - 1]) * k, v };
    };
    const show = () => {
      const s = at(rp.f); rp.mk.setLngLat(s.p);
      $('#rpNow', bar).textContent = OR.clock(new Date(s.t)) + ' · ' + OR.fmtDist(s.d) + ' · ' + OR.speed(s.v) + ' ' + OR.speedUnit();
      $('#rpPos', bar).value = Math.round(rp.f * 1000);
      OR.setData('done', { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: pts.filter((_, i) => times[i] <= s.t).concat([s.p]) } }] });
      if (rp.follow) OR.map.easeTo({ center: s.p, duration: 0 });
    };
    const loop = now => {
      if (!rp) return;
      if (rp.playing) { rp.f = Math.min(1, rp.f + (now - rp.last) / dur * rp.speed); if (rp.f >= 1) { rp.playing = false; $('#rpPlay', bar).textContent = 'Play'; } }
      rp.last = now; show(); requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    $('#rpPlay', bar).onclick = () => { if (rp.f >= 1) rp.f = 0; rp.playing = !rp.playing; $('#rpPlay', bar).textContent = rp.playing ? 'Pause' : 'Play'; };
    $('#rpSpeed', bar).onclick = () => { rp.speed = rp.speed === 1 ? 4 : rp.speed === 4 ? 10 : 1; $('#rpSpeed', bar).textContent = '×' + rp.speed; };
    $('#rpFollow', bar).onclick = () => { rp.follow = !rp.follow; $('#rpFollow', bar).classList.toggle('pri', rp.follow); if (rp.follow) OR.map.easeTo({ zoom: 13 }); };
    $('#rpPos', bar).oninput = e => { rp.f = e.target.value / 1000; };
    $('#rpX', bar).onclick = stopReplay;
  };
  function stopReplay() {
    if (!rp) return;
    rp.mk.remove(); rp.bar.remove(); OR.setData('done', null); rp = null;
  }
  OR.stopReplay = stopReplay;

  // ---------- picture to share ----------
  function mapShot() {
    return new Promise(res => {
      const m = OR.map;
      m.once('render', () => { try { res(m.getCanvas().toDataURL('image/png')); } catch (e) { res(null); } });
      m.triggerRepaint();
    });
  }
  OR.rideCard = async function (r) {
    const pts = OR.rides.pts(r);
    if (innerWidth < 900) $('#panel').classList.remove('open');
    OR.toast('Making the picture…');
    OR.setData('rideview', { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: pts } }] });
    OR.map.fitBounds(OR.bbox(pts), { padding: 50, pitch: 0, bearing: 0, duration: 0 });
    await new Promise(r2 => OR.map.once('idle', r2));
    const shot = await mapShot();
    const W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--green').trim() || '#0b6b3a'; g.fillRect(0, 0, W, H);
    // the map, cropped to fill the top
    if (shot) {
      const img = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = shot; });
      if (img) {
        const box = { x: 40, y: 150, w: W - 80, h: 820 }, s = Math.max(box.w / img.width, box.h / img.height);
        const sw = box.w / s, sh = box.h / s, sx = (img.width - sw) / 2, sy = (img.height - sh) / 2;
        g.save(); round(g, box.x, box.y, box.w, box.h, 34); g.clip(); g.drawImage(img, sx, sy, sw, sh, box.x, box.y, box.w, box.h); g.restore();
      }
    }
    // title
    g.fillStyle = '#f5c518'; g.font = '800 44px Overpass, sans-serif'; g.fillText('OpenRoad', 40, 80);
    g.fillStyle = '#fff'; g.font = '700 34px Overpass, sans-serif';
    g.fillText(clip(g, r.name, W - 80), 40, 126);
    // numbers
    const stats = [[OR.fmtDist(r.dist), 'distance'], [OR.fmtTime(r.moving), 'riding'], [OR.speed(r.moving ? r.dist / r.moving : 0) + ' ' + OR.speedUnit(), 'average'], [OR.speed(r.max) + ' ' + OR.speedUnit(), 'top speed']];
    if (r.leanL || r.leanR) stats.push([(r.leanL || 0) + '° / ' + (r.leanR || 0) + '°', 'lean left / right']);
    const cols = 3, cw = (W - 80) / cols;
    stats.forEach((s, i) => {
      const x = 40 + (i % cols) * cw, y = 1040 + Math.floor(i / cols) * 130;
      g.fillStyle = '#fff'; g.font = '800 52px Overpass, sans-serif'; g.fillText(s[0], x, y);
      g.fillStyle = 'rgba(255,255,255,.75)'; g.font = '600 28px Overpass, sans-serif'; g.fillText(s[1], x, y + 40);
    });
    g.fillStyle = 'rgba(255,255,255,.75)'; g.font = '600 26px Overpass, sans-serif';
    g.fillText(new Date(r.start).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), 40, H - 40);
    g.textAlign = 'right'; g.fillText('Map © OpenStreetMap', W - 40, H - 40);
    const data = cv.toDataURL('image/png');
    const name = OR.fileName(r.name) + '.png';
    OR.sheet('<h2>Share your ride</h2><img class="cardimg" src="' + data + '" alt="Picture of the ride"><div class="row"><button class="btn pri" id="cardShare">' + ic('share') + 'Share</button><button class="btn" id="cardSave">' + ic('dl') + 'Save</button></div>', b => {
      $('#cardShare', b).onclick = () => shareImg(name, data, true);
      $('#cardSave', b).onclick = () => shareImg(name, data, false);
    });
  };
  function shareImg(name, data, share) {
    const A = OR.native;
    if (A && A.saveImage) { const msg = A.saveImage(name, data.split(',')[1], !!share); if (msg) OR.toast(msg); return; }
    const a = document.createElement('a'); a.href = data; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }
  function round(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function clip(g, t, w) { if (g.measureText(t).width <= w) return t; while (t.length > 3 && g.measureText(t + '…').width > w) t = t.slice(0, -1); return t + '…'; }

  // ---------- your season ----------
  const placeCache = () => OR.store.get('ridePlaces', {});
  // countries and counties for a ride, from a few points along it (looked up once, then kept)
  async function placesOf(r) {
    const c = placeCache(); if (c[r.id]) return c[r.id];
    const pts = OR.rides.pts(r); if (pts.length < 2) return { cc: [], regions: [] };
    const n = Math.min(6, Math.max(2, Math.ceil(r.dist / 30000))), sample = [];
    for (let i = 0; i <= n; i++) sample.push(pts[Math.round(i * (pts.length - 1) / n)]);
    const cc = new Set(), regions = new Set();
    for (const p of sample) {
      try {
        const j = await OR.json('https://photon.komoot.io/reverse?lang=en&lon=' + p[0].toFixed(4) + '&lat=' + p[1].toFixed(4) + '&limit=1');
        const q = j.features && j.features[0] && j.features[0].properties; if (!q) continue;
        if (q.countrycode) cc.add(q.countrycode.toUpperCase());
        const reg = q.county || q.state; if (reg) regions.add(reg);
      } catch (e) { }
    }
    const out = { cc: Array.from(cc), regions: Array.from(regions) };
    if (out.cc.length) { const c2 = placeCache(); c2[r.id] = out; OR.store.set('ridePlaces', c2); }
    return out;
  }
  const FLAG = cc => cc.length === 2 ? String.fromCodePoint(...cc.split('').map(c => 127397 + c.charCodeAt(0))) : '';
  const COUNTRY = { GB: 'United Kingdom', IE: 'Ireland', FR: 'France', BE: 'Belgium', NL: 'Netherlands', LU: 'Luxembourg', DE: 'Germany', CH: 'Switzerland', AT: 'Austria', IT: 'Italy', ES: 'Spain', PT: 'Portugal', DK: 'Denmark', NO: 'Norway', SE: 'Sweden', CZ: 'Czechia', SI: 'Slovenia', HR: 'Croatia', IM: 'Isle of Man', AD: 'Andorra', LI: 'Liechtenstein' };

  OR.seasonStats = function (year) {
    const all = OR.rides.list(), years = Array.from(new Set(all.map(r => new Date(r.start).getFullYear()))).sort((a, b) => b - a);
    year = year || years[0] || new Date().getFullYear();
    const rs = all.filter(r => new Date(r.start).getFullYear() === year);
    const months = new Array(12).fill(0); rs.forEach(r => { months[new Date(r.start).getMonth()] += r.dist / MI; });
    const tot = rs.reduce((a, r) => ({ d: a.d + r.dist, t: a.t + (r.moving || 0), lean: Math.max(a.lean, r.leanL || 0, r.leanR || 0), max: Math.max(a.max, r.max || 0) }), { d: 0, t: 0, lean: 0, max: 0 });
    const longest = rs.slice().sort((a, b) => b.dist - a.dist)[0];
    const bendy = rs.map(r => ({ r, b: OR.bendiness(OR.rides.pts(r), []) })).filter(x => x.r.dist > 15000).sort((a, b) => b.b - a.b).slice(0, 3);
    const top = Math.max(1, ...months), unit = OR.cfg.units === 'km' ? 'km' : 'mi', k = unit === 'km' ? 1.609344 : 1;
    const bars = '<div class="mbars">' + months.map((v, i) => '<div class="mb"><i style="height:' + Math.round(100 * v / top) + '%"></i><b>' + (v ? Math.round(v * k) : '') + '</b><span>' + 'JFMAMJJASOND'[i] + '</span></div>').join('') + '</div>';
    OR.sheet('<h2>' + ic('rides') + 'Your riding in ' + year + '</h2>' +
      (years.length > 1 ? '<div class="seg">' + years.map(y => '<button data-y="' + y + '" class="' + (y === year ? 'on' : '') + '">' + y + '</button>').join('') + '</div>' : '') +
      '<div class="stats"><div><b>' + OR.fmtDist(tot.d) + '</b><span>ridden</span></div><div><b>' + rs.length + '</b><span>rides</span></div><div><b>' + OR.fmtTime(tot.t) + '</b><span>riding</span></div>' + (tot.lean ? '<div><b>' + tot.lean + '°</b><span>best lean</span></div>' : '') + '</div>' +
      '<h3 class="gh">' + unit + ' per month</h3>' + bars +
      (longest ? '<p class="small">Longest ride: <b>' + esc(longest.name) + '</b>, ' + OR.fmtDist(longest.dist) + ' on ' + new Date(longest.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + '.</p>' : '') +
      (bendy.length ? '<h3 class="gh">Bendiest rides</h3><ol class="bendy">' + bendy.map(x => '<li><b>' + esc(x.r.name) + '</b> · ' + OR.bendLabel(x.b) + ', ' + OR.fmtDist(x.r.dist) + '</li>').join('') + '</ol>' : '') +
      '<h3 class="gh">Where you\'ve been</h3><div id="placesOut" class="small muted">' + (rs.length ? 'Looking up countries and counties…' : 'No rides yet this year.') + '</div>' +
      '<button class="btn wide" id="allMap">' + ic('map') + 'Show every ride on the map</button>', b => {
      $$('[data-y]', b).forEach(x => x.onclick = () => OR.seasonStats(+x.dataset.y));
      $('#allMap', b).onclick = () => {
        OR.closeSheet();
        const feats = rs.map(r => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: OR.rides.pts(r) } })).filter(f => f.geometry.coordinates.length > 1);
        if (!feats.length) return;
        OR.setData('rideview', { type: 'FeatureCollection', features: feats });
        OR.map.fitBounds(OR.bbox([].concat(...feats.map(f => f.geometry.coordinates))), { padding: 50, pitch: 0, bearing: 0 });
        if (innerWidth < 900) $('#panel').classList.remove('open');
      };
      if (!rs.length) return;
      (async () => {
        const cc = {}, regions = {};
        for (const r of rs) { const p = await placesOf(r); p.cc.forEach(c => cc[c] = (cc[c] || 0) + 1); p.regions.forEach(x => regions[x] = 1); const o = $('#placesOut', b); if (!o) return; o.innerHTML = placesHtml(cc, regions); }
      })();
    });
  };
  function placesHtml(cc, regions) {
    const cs = Object.keys(cc).sort((a, b) => cc[b] - cc[a]), rg = Object.keys(regions).sort();
    if (!cs.length) return 'Couldn\'t look up places (it needs a signal).';
    return '<div class="flags">' + cs.map(c => '<span>' + FLAG(c) + ' ' + esc(COUNTRY[c] || c) + '</span>').join('') + '</div>' +
      '<p class="small">' + rg.length + ' ' + (rg.length === 1 ? 'county or region' : 'counties and regions') + ': ' + esc(rg.join(', ')) + '</p>';
  }
})(window.OR);
