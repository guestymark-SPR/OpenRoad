/* OpenRoad tour diary: a page for each day of a trip with the map of what you rode, the numbers, where you stayed,
   your notes, and your photos placed where you took them. Kept on the phone; print or save as PDF to share. */
'use strict';
(function (OR) {
  const $ = OR.$, $$ = OR.$$, esc = OR.esc, ic = (n, c) => OR.ic(n, c);

  // ---------- photos, kept in the phone's browser storage (IndexedDB) ----------
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open('openroad-diary', 1); r.onupgradeneeded = () => r.result.createObjectStore('photos'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const put = async (k, v) => { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction('photos', 'readwrite'); tx.objectStore('photos').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); };
  const get = async k => { const d = await db(); return new Promise(res => { const q = d.transaction('photos').objectStore('photos').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); };
  const del = async k => { const d = await db(); return new Promise(res => { const tx = d.transaction('photos', 'readwrite'); tx.objectStore('photos').delete(k); tx.oncomplete = res; tx.onerror = res; }); };

  // ---------- reading when and where a photo was taken (EXIF in JPEGs) ----------
  OR.readExif = function (buf) {
    const v = new DataView(buf); if (v.getUint16(0) !== 0xFFD8) return {};
    let o = 2;
    while (o < v.byteLength - 4) {
      const mark = v.getUint16(o), len = v.getUint16(o + 2);
      if (mark === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) return tiff(v, o + 10);
      if ((mark & 0xFF00) !== 0xFF00) break;
      o += 2 + len;
    }
    return {};
  };
  function tiff(v, t) {
    const le = v.getUint16(t) === 0x4949, u16 = p => v.getUint16(p, le), u32 = p => v.getUint32(p, le);
    const ifd = (p, fn) => { const n = u16(p); for (let i = 0; i < n; i++) { const e = p + 2 + i * 12; fn(u16(e), u16(e + 2), u32(e + 4), e + 8); } };
    const str = (off, n) => { let s = ''; for (let i = 0; i < n - 1; i++) s += String.fromCharCode(v.getUint8(t + off + i)); return s; };
    const rat = (off, n) => { const a = []; for (let i = 0; i < n; i++) a.push(u32(t + off + i * 8) / (u32(t + off + i * 8 + 4) || 1)); return a; };
    const out = {}; let exifP = 0, gpsP = 0;
    ifd(t + u32(t + 4), (tag, type, n, vo) => { if (tag === 0x8769) exifP = u32(vo); if (tag === 0x8825) gpsP = u32(vo); if (tag === 0x0132 && !out.when) out.when = str(u32(vo), n); });
    if (exifP) ifd(t + exifP, (tag, type, n, vo) => { if (tag === 0x9003) out.when = str(u32(vo), n); });
    if (gpsP) {
      const g = {};
      ifd(t + gpsP, (tag, type, n, vo) => { if (tag === 1 || tag === 3) g[tag] = String.fromCharCode(v.getUint8(vo)); if (tag === 2 || tag === 4) g[tag] = rat(u32(vo), 3); });
      if (g[2] && g[4]) { const dms = a => a[0] + a[1] / 60 + a[2] / 3600; out.lat = dms(g[2]) * (g[1] === 'S' ? -1 : 1); out.lng = dms(g[4]) * (g[3] === 'W' ? -1 : 1); }
    }
    if (out.when) { const m = out.when.match(/(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/); out.t = m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : null; }
    return out;
  }
  // a smaller copy for the diary (long side 1600 px)
  async function shrink(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const s = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.82);
    } finally { URL.revokeObjectURL(url); }
  }

  // ---------- the diary data ----------
  const key = t => 'diary_' + t.id;
  const diaryOf = t => OR.store.get(key(t), { days: {} });
  const saveDiary = (t, d) => OR.store.set(key(t), d);
  const dayKey = (t, i) => OR.isoDate(OR.dayDate(t, i));
  const ridesOn = date => OR.rides.list().filter(r => OR.isoDate(new Date(r.start)) === date);
  // where a photo without GPS was taken: the point on that day's rides nearest in time
  function placeByTime(rides, when) {
    let best = null, bd = 30 * 60000;
    rides.forEach(r => { const pts = OR.rides.pts(r), ts = OR.rides.times(r); ts.forEach((tt, i) => { const d = Math.abs(tt - when); if (d < bd) { bd = d; best = pts[i]; } }); });
    return best;
  }
  async function addPhotos(t, di, files, stop) {
    const d = diaryOf(t), k = dayKey(t, di), day = d.days[k] = d.days[k] || { notes: '', photos: [] }, rides = ridesOn(k);
    let n = 0;
    for (const f of files) {
      try {
        const ex = OR.readExif(await f.arrayBuffer()), id = OR.uid();
        await put(id, await shrink(f));
        let at = ex.lat != null ? [ex.lng, ex.lat] : ex.t ? placeByTime(rides, ex.t) : null;
        if (stop && ex.lat == null) at = [stop.lng, stop.lat];
        day.photos.push({ id, t: ex.t || (stop ? stop.t + 60000 : f.lastModified || Date.now()), lng: at ? at[0] : null, lat: at ? at[1] : null, caption: stop && stop.name ? stop.name : '', placed: ex.lat != null ? 'gps' : at ? (stop ? 'stop' : 'time') : '' });
        n++;
      } catch (e) { }
    }
    day.photos.sort((a, b) => a.t - b.t); saveDiary(t, d);
    OR.toast(n + ' photo' + (n === 1 ? '' : 's') + ' added');
  }

  // ---------- the diary screen ----------
  const mapShot = () => new Promise(res => { const m = OR.map; m.once('render', () => { try { res(m.getCanvas().toDataURL('image/jpeg', 0.85)); } catch (e) { res(null); } }); m.triggerRepaint(); });
  async function dayMap(rides, photos) {
    const tracks = rides.map(r => OR.rides.pts(r)).filter(p => p.length > 1); if (!tracks.length) return null;
    OR.setData('rideview', { type: 'FeatureCollection', features: tracks.map(c => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: c } })) });
    OR.setData('pois', { type: 'FeatureCollection', features: photos.filter(p => p.lng != null).map((p, i) => ({ type: 'Feature', properties: { kind: 'view', name: String(i + 1), id: 'ph' + i }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })) });
    OR.map.fitBounds(OR.bbox([].concat(...tracks)), { padding: 40, pitch: 0, bearing: 0, duration: 0 });
    await new Promise(r => OR.map.once('idle', r));
    return mapShot();
  }
  OR.openDiary = function (t) {
    const d = diaryOf(t);
    let h = '<h2>' + ic('trips') + 'Tour diary: ' + esc(t.name) + '</h2><p class="small muted">A page for each day: what you rode, where you stayed, your notes and photos. It fills in from your recorded rides on each date.</p><div class="diary">';
    t.days.forEach((day, di) => {
      const k = dayKey(t, di), dd = d.days[k] || { notes: '', photos: [] }, rides = ridesOn(k), dist = rides.reduce((s, r) => s + r.dist, 0), mov = rides.reduce((s, r) => s + (r.moving || 0), 0);
      const lean = Math.max(0, ...rides.map(r => Math.max(r.leanL || 0, r.leanR || 0)));
      h += '<div class="dday"><div class="dd-h"><b>Day ' + (di + 1) + '</b><span>' + OR.dayDate(t, di).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + (day.title ? ' · ' + esc(day.title) : '') + '</span></div>' +
        (rides.length ? '<div class="stats"><div><b>' + OR.fmtDist(dist) + '</b><span>ridden</span></div><div><b>' + OR.fmtTime(mov) + '</b><span>riding</span></div>' + (lean ? '<div><b>' + lean + '°</b><span>best lean</span></div>' : '') + '</div>' : '<p class="small muted">No ride recorded on this date yet.</p>') +
        (day.hotel ? '<p class="small">' + ic('bed') + ' Night at <b>' + esc(day.hotel.name) + '</b></p>' : '') +
        stopsHtml(dd, di) +
        '<div class="dphotos" data-day="' + di + '">' + dd.photos.map(p => '<button class="dph" data-ph="' + p.id + '" data-day="' + di + '"><span class="ph-load"></span></button>').join('') + '</div>' +
        '<label class="f"><span>Notes</span><textarea class="dnotes" data-day="' + di + '" rows="3" placeholder="What happened today…">' + esc(dd.notes || '') + '</textarea></label>' +
        '<div class="row"><label class="btn small">' + ic('plus') + 'Add photos<input type="file" accept="image/*" multiple hidden data-addph="' + di + '"></label>' + (rides.length ? '<button class="btn small" data-dmap="' + di + '">' + ic('map') + 'Show on the map</button>' : '') + '</div></div>';
    });
    h += '</div><button class="btn wide pri" id="dPrint">' + ic('print') + 'Print or save the diary as a PDF</button>';
    OR.sheet(h, async b => {
      // photo thumbnails
      for (const el of $$('.dph', b)) { const src = await get(el.dataset.ph); if (src) el.innerHTML = '<img src="' + src + '" alt="">'; }
      $$('.dph', b).forEach(el => el.onclick = () => photoSheet(t, +el.dataset.day, el.dataset.ph));
      $$('.dnotes', b).forEach(el => el.onchange = () => { const d2 = diaryOf(t), k = dayKey(t, +el.dataset.day); (d2.days[k] = d2.days[k] || { notes: '', photos: [] }).notes = el.value; saveDiary(t, d2); });
      $$('[data-addph]', b).forEach(el => el.onchange = async () => { const files = Array.from(el.files || []); if (!files.length) return; OR.toast('Adding ' + files.length + ' photo' + (files.length > 1 ? 's' : '') + '…'); await addPhotos(t, +el.dataset.addph, files); OR.openDiary(t); });
      $$('[data-dmap]', b).forEach(el => el.onclick = () => {
        const di = +el.dataset.dmap, k = dayKey(t, di), rides = ridesOn(k), ph = (diaryOf(t).days[k] || { photos: [] }).photos;
        OR.closeSheet(); dayMap(rides, ph); if (innerWidth < 900) $('#panel').classList.remove('open');
      });
      $('#dPrint', b).onclick = () => printDiary(t);
      $$('[data-stopph]', b).forEach(el => el.onchange = async () => { const files = Array.from(el.files || []); if (!files.length) return; const [di, si] = el.dataset.stopph.split(':').map(Number); await addPhotos(t, di, files, (diaryOf(t).days[dayKey(t, di)].stops || [])[si]); OR.openDiary(t); });
      // stops on rides you've recorded on trip days: look for any new ones, and show them when found
      findAllStops(t).then(n => { if (n && document.querySelector('.diary')) OR.openDiary(t); });
    });
  };
  async function photoSheet(t, di, id) {
    const d = diaryOf(t), k = dayKey(t, di), p = (d.days[k] || { photos: [] }).photos.find(x => x.id === id); if (!p) return;
    const src = await get(id);
    OR.sheet('<img class="dbig" src="' + (src || '') + '" alt="">' + OR.field('phCap', 'Caption', p.caption || '', 'text', 'e.g. Top of the Col') +
      '<p class="small muted">' + (p.t ? new Date(p.t).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '') + (p.placed === 'gps' ? ' · placed from the photo\'s GPS' : p.placed === 'time' ? ' · placed from your ride at that time' : ' · no location') + '</p>' +
      '<div class="row">' + (p.lng != null ? '<button class="btn small" id="phMap">Show where</button>' : '') + '<button class="btn small ghost" id="phDel">Remove from diary</button><button class="btn small pri" id="phBack">Done</button></div>', b => {
      const save = () => { p.caption = $('#phCap', b).value.trim(); saveDiary(t, d); };
      $('#phBack', b).onclick = () => { save(); OR.openDiary(t); };
      const m = $('#phMap', b); if (m) m.onclick = () => { save(); OR.closeSheet(); OR.map.flyTo({ center: [p.lng, p.lat], zoom: 14 }); if (innerWidth < 900) $('#panel').classList.remove('open'); };
      $('#phDel', b).onclick = async () => { d.days[k].photos = d.days[k].photos.filter(x => x.id !== id); saveDiary(t, d); await del(id); OR.openDiary(t); };
    });
  }
  // one printable page: each day's map, numbers, hotel, notes and photos with captions
  async function printDiary(t) {
    OR.closeSheet(); OR.toast('Putting the diary together…', 8000);
    const d = diaryOf(t); let body = '';
    for (let di = 0; di < t.days.length; di++) {
      const day = t.days[di], k = dayKey(t, di), dd = d.days[k] || { notes: '', photos: [] }, rides = ridesOn(k);
      if (!rides.length && !dd.photos.length && !dd.notes) continue;
      const map = rides.length ? await dayMap(rides, dd.photos) : null;
      const dist = rides.reduce((s, r) => s + r.dist, 0), mov = rides.reduce((s, r) => s + (r.moving || 0), 0);
      let ph = ''; for (const p of dd.photos) { const src = await get(p.id); if (src) ph += '<figure><img src="' + src + '"><figcaption>' + esc(p.caption || '') + '</figcaption></figure>'; }
      body += '<section><h2>Day ' + (di + 1) + ' · ' + OR.dayDate(t, di).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + (day.title ? ' · ' + esc(day.title) : '') + '</h2>' +
        (map ? '<img class="map" src="' + map + '">' : '') + (rides.length ? '<p class="nums"><b>' + OR.fmtDist(dist) + '</b> ridden in <b>' + OR.fmtTime(mov) + '</b>' + (day.hotel ? ' · night at <b>' + esc(day.hotel.name) + '</b>' : '') + '</p>' : '') +
        ((dd.stops || []).filter(x => x.name).length ? '<p class="stops">' + dd.stops.filter(x => x.name).map(x => '<b>' + OR.clock(new Date(x.t)) + '</b> ' + esc(x.name) + ' (' + esc(KIND_WORD[x.kind] || 'stop') + ', ' + Math.round((x.until - x.t) / 60000) + ' min' + (x.wx ? ', ' + esc(x.wx) : '') + ')').join('<br>') + '</p>' : '') +
        (dd.notes ? '<p class="notes">' + esc(dd.notes).replace(/\n/g, '<br>') + '</p>' : '') + (ph ? '<div class="photos">' + ph + '</div>' : '') + '</section>';
    }
    if (!body) return OR.toast('Nothing in the diary yet: record rides on the trip dates, or add photos and notes', 6000);
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(t.name) + '</title><style>body{font-family:sans-serif;color:#1c2226;margin:24px}h1{color:#0b6b3a}h2{border-bottom:3px solid #f5c518;padding-bottom:4px}section{page-break-after:always}' +
      '.map{width:100%;border-radius:10px}.nums{font-size:18px}.notes{font-size:16px;line-height:1.5}.stops{font-size:15px;line-height:1.6}.photos{display:grid;grid-template-columns:1fr 1fr;gap:10px}figure{margin:0}figure img{width:100%;border-radius:8px}figcaption{font-size:13px;color:#5c666e}</style></head><body>' +
      '<h1>' + esc(t.name) + '</h1><p>' + OR.dayDate(t, 0).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + ' · made with OpenRoad · map © OpenStreetMap</p>' + body + '</body></html>';
    OR.printHtml(t.name + ' diary', html);
  }

  // a nudge at the end of a riding day on a trip
  // ---------- stops that write themselves ----------
  // A stop of 15 minutes or more on a trip day, at a café, pub or viewpoint, goes in that day's diary with the place's
  // name, how long you stopped and the weather then. Found from your recorded rides (a gap of 15 minutes or more with
  // the bike hardly moving, or between two rides), and live while you're stopped, with a prompt to take a photo.
  const STOP_MS = 15 * 60000, KIND_WORD = { cafe: 'café', pub: 'pub', view: 'viewpoint' };
  function stopsHtml(dd, di) {
    const l = (dd.stops || []).map((x, i) => [x, i]).filter(([x]) => x.name);
    if (!l.length) return '';
    return '<ul class="dstops">' + l.map(([x, i]) => '<li><span class="ds-t">' + OR.clock(new Date(x.t)) + '</span><span><b>' + esc(x.name) + '</b><small>' + esc(KIND_WORD[x.kind] || 'stop') + ', ' + Math.round((x.until - x.t) / 60000) + ' min' + (x.wx ? ' · ' + esc(x.wx) : '') + '</small></span>' +
      '<label class="mini txt">' + ic('cam') + '<input type="file" accept="image/*" capture="environment" multiple hidden data-stopph="' + di + ':' + i + '"></label></li>').join('') + '</ul>';
  }
  function tripOn(when) {
    const k = OR.isoDate(new Date(when));
    for (const t of OR.trips.list()) { const i = t.days.findIndex((_, n) => dayKey(t, n) === k); if (i >= 0) return { t, i, k }; }
    return null;
  }
  // stops in a day's recorded rides
  OR.stopsIn = function (rides) {
    const out = [], rs = rides.slice().sort((a, b) => a.start - b.start);
    rs.forEach((r, n) => {
      const pts = OR.rides.pts(r), ts = OR.rides.times(r);
      for (let i = 1; i < pts.length; i++) if (ts[i] - ts[i - 1] >= STOP_MS && OR.dist(pts[i - 1], pts[i]) < 200) out.push({ t: ts[i - 1], until: ts[i], lng: pts[i - 1][0], lat: pts[i - 1][1] });
      const nx = rs[n + 1];
      if (nx && pts.length) { const a = pts[pts.length - 1], b = OR.rides.pts(nx)[0], t0 = ts[ts.length - 1], t1 = nx.t0 || nx.start; if (b && t1 - t0 >= STOP_MS && OR.dist(a, b) < 300) out.push({ t: t0, until: t1, lng: a[0], lat: a[1] }); }
    });
    return out;
  };
  // what's there: the nearest named café, pub or viewpoint
  async function placeAt(lng, lat) {
    for (const [kind, r] of [['cafe', 150], ['pub', 150], ['view', 250]]) {
      try { const l = (await OR.nearby(kind, lng, lat, r)).filter(x => x.name && x.name !== OR.KINDS[kind].label.replace(/s$/, '')); if (l.length) return { kind, name: l[0].name }; } catch (e) { }
    }
    return null;
  }
  async function weatherAt(lng, lat, when) {
    try {
      const j = await OR.json('https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(3) + '&longitude=' + lng.toFixed(3) + '&hourly=temperature_2m,weather_code&past_days=7&forecast_days=1&timeformat=unixtime');
      const h = j.hourly; let k = 0; h.time.forEach((tt, i) => { if (Math.abs(tt * 1000 - when) < Math.abs(h.time[k] * 1000 - when)) k = i; });
      if (Math.abs(h.time[k] * 1000 - when) > 2 * 3600000) return '';
      return OR.wmo(h.weather_code[k])[0].toLowerCase() + ', ' + Math.round(h.temperature_2m[k]) + '°';
    } catch (e) { return ''; }
  }
  // add a stop to the diary once (stops already looked at are remembered, named or not)
  async function addStop(t, k, st) {
    let d = diaryOf(t), day = d.days[k] = d.days[k] || { notes: '', photos: [] };
    day.stops = day.stops || [];
    const same = day.stops.find(x => Math.abs(x.t - st.t) < 20 * 60000 && OR.dist([x.lng, x.lat], [st.lng, st.lat]) < 300);
    if (same) { if (st.until > same.until) { same.until = st.until; saveDiary(t, d); } return null; }
    if (!OR.online()) return null;
    const place = await placeAt(st.lng, st.lat), wx = place ? await weatherAt(st.lng, st.lat, st.t) : '';
    d = diaryOf(t); day = d.days[k] = d.days[k] || { notes: '', photos: [] }; day.stops = day.stops || [];
    const s2 = Object.assign({}, st, place ? { kind: place.kind, name: place.name, wx } : { name: null });
    day.stops.push(s2); day.stops.sort((a, b) => a.t - b.t); saveDiary(t, d);
    return s2.name ? s2 : null;
  }
  async function findAllStops(t) {
    let n = 0;
    for (let i = 0; i < t.days.length; i++) {
      const k = dayKey(t, i), rides = ridesOn(k); if (!rides.length) continue;
      for (const st of OR.stopsIn(rides)) if (await addStop(t, k, st)) n++;
    }
    return n;
  }
  OR.findDiaryStops = findAllStops;
  // live: stopped for 15 minutes in one place on a trip day while recording
  let still = null;
  OR.on('fix', p => {
    if (!OR.ride || !OR.ride.on) { still = null; return; }
    const here = [p.lng, p.lat], now = p.t || Date.now();
    if ((p.speed || 0) > 1.5 || (still && OR.dist(still.p, here) > 80)) { still = { p: here, t: now, done: false }; return; }
    if (!still) { still = { p: here, t: now, done: false }; return; }
    if (still.done || now - still.t < STOP_MS) return;
    still.done = true;
    const tr = tripOn(now); if (!tr) return;
    addStop(tr.t, tr.k, { t: still.t, until: now, lng: still.p[0], lat: still.p[1] }).then(st => {
      if (!st) return;
      OR.toast('Added to today\'s diary: ' + st.name, 6000);
      const nb = document.getElementById('hudNote'); if (!nb) return;
      nb.hidden = false; nb.textContent = 'At ' + st.name + '. Tap to add a photo to today\'s diary.';
      nb.onclick = () => {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment'; inp.multiple = true;
        inp.onchange = async () => { const files = Array.from(inp.files || []); if (files.length) { const d = diaryOf(tr.t), s3 = (d.days[tr.k].stops || []).find(x => x.t === st.t); await addPhotos(tr.t, tr.i, files, s3); } };
        inp.click(); nb.hidden = true; nb.onclick = null;
      };
    });
  });
  // after a ride on a trip day: look for stops in it
  OR.on('ridestop', saved => {
    if (!saved) return;
    const tr = tripOn(saved.start);
    if (tr) setTimeout(() => findAllStops(tr.t).then(n => { if (n) OR.toast(n + ' stop' + (n > 1 ? 's' : '') + ' added to the ' + tr.t.name + ' diary', 5000); }), 4000);
  });
  OR.on('ridestop', saved => {
    if (!saved) return;
    const today = OR.isoDate(new Date()), t = OR.trips.list().find(x => x.days.some((_, i) => OR.isoDate(OR.dayDate(x, i)) === today));
    if (t) setTimeout(() => OR.toast('Ride added to today\'s page in the ' + t.name + ' diary. Add photos and notes from the trip page.', 7000), 1500);
  });
})(window.OR);
