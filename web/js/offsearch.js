/* OpenRoad search with no signal: towns, villages, fuel, cafés, pubs, stays, sights and UK postcodes, from a small
   index for each country with a map pack on the phone (built by the "Build place search" workflow, tools/places.py).
   Kept in the page's own database (IndexedDB): the places of each country as one block of text, read into memory the
   first time they're needed, and each postcode sector as its own record so a postcode only reads its sector. */
'use strict';
(function (OR) {
  const A = OR.native;
  const KIND = { c: 'City', t: 'Town', v: 'Village', h: 'Hamlet', s: 'Area', f: 'Fuel', k: 'Café', p: 'Pub', o: 'Stay', m: 'Campsite', a: 'Sight', w: 'Viewpoint', b: 'Motorbike shop' };
  const WEIGHT = { c: 40, t: 32, v: 22, s: 16, h: 10, a: 9, w: 8, b: 8, f: 7, k: 6, p: 6, o: 6, m: 6 };
  const PC_FULL = /^([A-Z]{1,2}\d[A-Z\d]?)(\d)([A-Z]{2})$/, PC_PART = /^([A-Z]{1,2}\d[A-Z\d]?)(\d)?$/;
  const off = OR.offSearch = {
    list: OR.PACKS_URL.replace(/[^/]+$/, 'search.json'),
    have: () => OR.store.get('offSearch', {}), // country id -> { name, date, places, postcodes }
    ready: () => Object.keys(off.have()).length > 0,
    busy: null                                 // country being downloaded
  };

  // ---------- the database ----------
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((ok, fail) => {
    const r = indexedDB.open('orsearch', 1);
    r.onupgradeneeded = () => ['places', 'pc'].forEach(s => r.result.createObjectStore(s));
    r.onsuccess = () => ok(r.result); r.onerror = () => { dbp = null; fail(r.error); };
  }));
  const done = r => new Promise((ok, fail) => { r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
  async function store(name, mode) { return (await db()).transaction(name, mode).objectStore(name); }

  // ---------- downloading ----------
  const countryOf = packId => packId.replace(/-\d+$/, '');
  off.wanted = () => Array.from(new Set(OR.packs.installed().map(p => countryOf(p.id))));
  off.catalogue = () => OR.json(off.list + '?t=' + Math.floor(Date.now() / 600000)).then(j => j.countries || {});
  // every country with a pack on the phone whose index is missing or older; force: download again anyway
  off.sync = async function (force) {
    if (off.busy || !OR.online()) return;
    const cat = await off.catalogue(), have = off.have();
    for (const id of off.wanted()) {
      const c = cat[id];
      if (c && (force || !have[id] || have[id].date < c.date)) await fetchCountry(c);
    }
    // indexes for countries whose packs were deleted
    const keep = new Set(off.wanted());
    for (const id of Object.keys(have)) if (!keep.has(id)) await off.remove(id);
  };
  async function fetchCountry(c) {
    off.busy = c.id; OR.emit('offsearch', { id: c.id, done: 0, total: c.files.length });
    try {
      const places = [], sectors = {};
      for (let i = 0; i < c.files.length; i++) {
        const text = await OR.http(c.base + c.files[i].name, { timeout: 120000 });
        for (const ln of text.split('\n')) {
          if (!ln) continue;
          if (ln[0] === 'P' && ln[1] === '\t') { const t = ln.indexOf('\t', 2); sectors[ln.slice(2, t)] = ln; } else places.push(ln);
        }
        OR.emit('offsearch', { id: c.id, done: i + 1, total: c.files.length });
      }
      await off.remove(c.id, true);
      const t = (await db()).transaction(['places', 'pc'], 'readwrite'), pc = t.objectStore('pc');
      t.objectStore('places').put(places.join('\n'), c.id);
      for (const k in sectors) pc.put({ c: c.id, l: sectors[k] }, k);
      await new Promise((ok, fail) => { t.oncomplete = ok; t.onerror = t.onabort = () => fail(t.error || new Error('could not save the search index')); });
      const have = off.have(); have[c.id] = { name: c.name, date: c.date, places: c.places, postcodes: c.postcodes };
      OR.store.set('offSearch', have); loaded.delete(c.id);
      OR.emit('offsearch', { id: c.id, state: 'done' });
    } catch (e) {
      OR.emit('offsearch', { id: c.id, state: 'error', error: e.message });
    } finally { off.busy = null; }
  }
  off.remove = async function (id, keepListed) {
    loaded.delete(id);
    try {
      (await store('places', 'readwrite')).delete(id);
      const pc = await store('pc', 'readwrite'), cur = pc.openCursor();
      await new Promise(ok => { cur.onsuccess = () => { const c = cur.result; if (!c) return ok(); if (c.value.c === id) c.delete(); c.continue(); }; cur.onerror = ok; });
    } catch (e) { }
    if (!keepListed) { const have = off.have(); delete have[id]; OR.store.set('offSearch', have); }
  };

  // ---------- searching ----------
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’`.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const loaded = new Map(); // country id -> [{ k, name, keys, lng, lat, in, inKey }]
  async function placesOf(id) {
    if (loaded.has(id)) return loaded.get(id);
    const text = await done((await store('places', 'readonly')).get(id)) || '';
    const list = text.split('\n').filter(Boolean).map(ln => {
      const f = ln.split('\t'), names = f[1].split('|');
      return { k: f[0], name: names[0], keys: names.map(norm), lng: +f[2], lat: +f[3], in: f[4] || '', inKey: norm(f[4] || '') };
    });
    loaded.set(id, list); return list;
  }
  const words = s => ' ' + s + ' ';
  function score(p, q, toks) {
    let best = 0;
    for (const key of p.keys) {
      if (key === q) best = Math.max(best, 100);
      else if (key.startsWith(q)) best = Math.max(best, 70);
      else if (words(key).includes(' ' + q)) best = Math.max(best, 50);
    }
    // "costa matlock": the first words in the name, the rest in the town it's in
    if (!best && toks.length > 1 && p.inKey) {
      const all = words(p.keys[0] + ' ' + p.inKey);
      if (words(p.keys[0]).includes(' ' + toks[0]) && toks.every(t => all.includes(' ' + t))) best = 45;
    }
    return best ? best + WEIGHT[p.k] : 0;
  }
  function nearTown(lng, lat, lists) {
    let best = null, bd = 25000;
    for (const l of lists) for (const p of l) if (p.k === 't' || p.k === 'c') { const d = OR.dist([lng, lat], [p.lng, p.lat]); if (d < bd) { bd = d; best = p; } }
    return best ? best.name : '';
  }
  async function postcode(typed, ids, lists) {
    const s = typed.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const pc = await store('pc', 'readonly'), out = [];
    const unpack = rec => {
      const f = rec.l.split('\t'), x0 = +f[2], y0 = +f[3]; let x = x0, y = y0;
      const units = (f[4] || '').split(' ').filter(Boolean).map(u => { const [l, dx, dy] = u.split(':'); x += +dx; y += +dy; return { l, lng: x / 1e4, lat: y / 1e4 }; });
      return { sector: f[1], lng: x0 / 1e4, lat: y0 / 1e4, units };
    };
    const sub = (lng, lat, what) => [what, nearTown(lng, lat, lists) && 'near ' + nearTown(lng, lat, lists)].filter(Boolean).join(', ');
    let m = s.match(PC_FULL);
    if (m) {
      const rec = await done(pc.get(m[1] + ' ' + m[2]));
      if (rec && ids.includes(rec.c)) {
        const sec = unpack(rec), u = sec.units.find(x => x.l === m[3]);
        if (u) out.push({ name: m[1] + ' ' + m[2] + m[3], sub: sub(u.lng, u.lat, 'Postcode'), lng: u.lng, lat: u.lat });
        else out.push({ name: sec.sector, sub: sub(sec.lng, sec.lat, 'Postcode area (' + m[2] + m[3] + ' not found)'), lng: sec.lng, lat: sec.lat });
      }
      return out;
    }
    // part of one: "DE4" or "DE4 3". Without the space "DE43" could be either, so both are tried
    const tries = [];
    const sp = typed.trim().toUpperCase().split(/\s+/);
    if (sp.length === 2 && /^[A-Z]{1,2}\d[A-Z\d]?$/.test(sp[0]) && /^\d$/.test(sp[1])) tries.push(sp[0] + ' ' + sp[1]);
    else if ((m = s.match(PC_PART))) {
      tries.push(m[1] + ' ' + (m[2] || ''));
      if (!m[2] && /\d$/.test(s) && s.length > 2 && PC_PART.test(s.slice(0, -1))) tries.push(s.slice(0, -1) + ' ' + s.slice(-1));
    }
    for (const from of tries) {
      const recs = await done(pc.getAll(IDBKeyRange.bound(from, from + '￿'), 12));
      recs.filter(r => ids.includes(r.c)).forEach(r => { const sec = unpack(r); out.push({ name: sec.sector, sub: sub(sec.lng, sec.lat, 'Postcode area'), lng: sec.lng, lat: sec.lat }); });
    }
    return out.slice(0, 6);
  }
  // the same shape of results as online search: { name, sub, lng, lat }
  off.find = async function (text) {
    const ids = Object.keys(off.have()), q = norm(text), toks = q.split(' ').filter(Boolean);
    if (!ids.length || !q) return [];
    const lists = await Promise.all(ids.map(placesOf));
    const pcs = await postcode(text, ids, lists).catch(() => []);
    const c = OR.map ? OR.map.getCenter() : { lng: 0, lat: 0 }, hits = [];
    lists.forEach((l, li) => { for (const p of l) { const s = score(p, q, toks); if (s) hits.push({ p, s, li }); } });
    // nearer places first among equals: up to 30 points off for 300 km away
    hits.forEach(h => { h.s -= Math.min(30, OR.dist([c.lng, c.lat], [h.p.lng, h.p.lat]) / 10000); });
    hits.sort((a, b) => b.s - a.s);
    const many = ids.length > 1, have = off.have();
    return pcs.concat(hits.slice(0, 7 - Math.min(pcs.length, 3)).map(({ p, li }) => ({
      name: p.name, lng: p.lng, lat: p.lat,
      sub: [KIND[p.k], p.in && 'near ' + p.in, many ? have[ids[li]].name : ''].filter(Boolean).join(', ')
    }))).slice(0, 7);
  };

  // ---------- keeping it up to date ----------
  // on Wi-Fi (or when the phone doesn't say), soon after opening and when a map pack has finished installing
  const wifiOrUnknown = () => { const c = navigator.connection; return !c || !c.type || c.type !== 'cellular'; };
  if (A && window.indexedDB) {
    setTimeout(() => { if (wifiOrUnknown()) off.sync().catch(() => { }); }, 20000);
    OR.on('pack', s => { if (s.state === 'done') setTimeout(() => off.sync().catch(() => { }), 2000); });
  }
})(window.OR);
