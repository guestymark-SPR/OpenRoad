/* OpenRoad documents wallet: photos and details of your licence, V5C, insurance, MOT and breakdown cover,
   kept only on this phone and shown full screen at a roadside check. Expiry dates are shared with Maintenance. */
'use strict';
(function (OR) {
  const $ = OR.$, $$ = OR.$$, esc = OR.esc, ic = (n, c) => OR.ic(n, c);
  // [id, name, what to note, maintenance date key]
  OR.PAPERS = [
    ['licence', 'Driving licence', 'Licence number, and the date the photocard expires', 'licence'],
    ['v5c', 'V5C log book', 'Registration and VIN (the original is needed to ride abroad: a photo helps if asked)', null],
    ['insurance', 'Insurance certificate', 'Insurer, policy number, and the phone number for claims abroad', 'insurance'],
    ['mot', 'MOT certificate', 'Test number and expiry', 'mot'],
    ['breakdown', 'Breakdown cover', 'Provider, membership number, and the number to call from abroad', 'breakdown'],
    ['ghic', 'GHIC or EHIC card', 'Health cover in the EU', null],
    ['passport', 'Passport', 'Number and expiry', null],
    ['other', 'Other (ferry tickets, hotel bookings…)', '', null]];

  // photos in the phone's browser storage, separate from the diary
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open('openroad-papers', 1); r.onupgradeneeded = () => r.result.createObjectStore('img'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const put = async (k, v) => { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction('img', 'readwrite'); tx.objectStore('img').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); };
  const get = async k => { const d = await db(); return new Promise(res => { const q = d.transaction('img').objectStore('img').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); };
  const del = async k => { const d = await db(); return new Promise(res => { const tx = d.transaction('img', 'readwrite'); tx.objectStore('img').delete(k); tx.oncomplete = res; tx.onerror = res; }); };
  async function shrink(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const s = Math.min(1, 2000 / Math.max(img.width, img.height)), c = document.createElement('canvas'); // big enough to read small print
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.88);
    } finally { URL.revokeObjectURL(url); }
  }

  const papers = () => OR.store.get('papers', {});
  const savePapers = p => OR.store.set('papers', p);
  const dateOf = (key, p) => { if (!key) return p.expiry || ''; const m = OR.maint.get(); return (m.docs && m.docs[key]) || p.expiry || ''; };
  function setDate(key, p, v) { p.expiry = v; if (key && key !== 'licence') { const m = OR.maint.get(); m.docs = m.docs || {}; m.docs[key] = v; OR.maint.save(m); } }
  const dueText = d => { if (!d) return ''; const x = OR.docDue(d); return !x ? '' : x.days < 0 ? 'Expired ' + (-x.days) + ' days ago' : x.days <= 30 ? 'Expires in ' + x.days + ' days' : 'Valid until ' + new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };

  OR.pagePapers = function (box) {
    const all = papers();
    box.innerHTML = '<p class="small">Photos and details of your papers, for a roadside check abroad or a breakdown. They stay on this phone only: nothing is uploaded or shared unless you send it.</p>' +
      '<button id="ppShow" class="btn wide pri">' + ic('id') + 'Show my papers full screen</button>' +
      '<div class="menu">' + OR.PAPERS.map(([id, name, , key]) => {
        const p = all[id] || {}, n = (p.photos || []).length, d = dateOf(key, p), due = d ? OR.docDue(d) : null;
        return '<button data-pp="' + id + '"><span class="ppthumb" data-thumb="' + ((p.photos || [])[0] || '') + '">' + ic('id') + '</span><span><b>' + esc(name) + '</b><small>' +
          [n ? n + ' photo' + (n > 1 ? 's' : '') : 'No photo yet', p.number ? esc(p.number) : '', due ? '<i class="' + due.state + '">' + esc(dueText(d)) + '</i>' : ''].filter(Boolean).join(' · ') + '</small></span>' + ic('chev', 'chev') + '</button>';
      }).join('') + '</div>' +
      '<p class="small muted">Riding abroad you also need the originals with you: your licence, the V5C (or a VE103 if the bike is hired or leased), and your insurance details.</p>';
    $$('[data-thumb]', box).forEach(async el => { if (!el.dataset.thumb) return; const src = await get(el.dataset.thumb); if (src) el.innerHTML = '<img src="' + src + '" alt="">'; });
    $$('[data-pp]', box).forEach(b => b.onclick = () => paperSheet(b.dataset.pp, () => OR.pagePapers(box)));
    $('#ppShow', box).onclick = () => showAll();
  };

  async function paperSheet(id, after) {
    const def = OR.PAPERS.find(x => x[0] === id), all = papers(), p = all[id] = all[id] || { photos: [] }, key = def[3];
    const thumbs = await Promise.all((p.photos || []).map(async k => [k, await get(k)]));
    OR.sheet('<h2>' + ic('id') + esc(def[1]) + '</h2>' + (def[2] ? '<p class="small muted">' + esc(def[2]) + '</p>' : '') +
      '<div class="ppgrid">' + thumbs.map(([k, src]) => '<button class="pph" data-big="' + k + '">' + (src ? '<img src="' + src + '" alt="">' : '') + '</button>').join('') +
      '<label class="pph add">' + ic('plus') + '<span>Add a photo</span><input type="file" accept="image/*" multiple hidden id="ppAdd"></label></div>' +
      OR.field('ppNum', id === 'breakdown' ? 'Membership or policy number' : 'Number', p.number || '', 'text') +
      (id === 'breakdown' || id === 'insurance' ? OR.field('ppTel', id === 'breakdown' ? 'Number to call for help (from abroad)' : 'Claims number (from abroad)', p.tel || '', 'tel', '+44 …') : '') +
      '<label class="f"><span>Expires</span><input id="ppExp" type="date" value="' + esc(dateOf(key, p)) + '"></label>' +
      OR.field('ppNote', 'Notes', p.note || '', 'text') +
      (p.tel ? '<a class="btn wide go" href="tel:' + esc(p.tel.replace(/\s/g, '')) + '">' + ic('helmet') + 'Call ' + esc(id === 'breakdown' ? 'breakdown' : 'insurer') + '</a>' : '') +
      '<button class="btn wide pri" id="ppSave">Save</button>', b => {
      const save = () => { p.number = $('#ppNum', b).value.trim(); const t = $('#ppTel', b); if (t) p.tel = t.value.trim(); p.note = $('#ppNote', b).value.trim(); setDate(key, p, $('#ppExp', b).value); savePapers(all); };
      $('#ppSave', b).onclick = () => { save(); OR.closeSheet(); OR.toast('Saved on this phone'); after && after(); };
      $('#ppAdd', b).onchange = async e => {
        const files = Array.from(e.target.files || []); if (!files.length) return; save();
        for (const f of files) { try { const k = OR.uid(); await put(k, await shrink(f)); p.photos.push(k); } catch (x) { } }
        savePapers(all); paperSheet(id, after);
      };
      $$('[data-big]', b).forEach(x => x.onclick = () => bigPhoto(x.dataset.big, async () => { save(); p.photos = p.photos.filter(k => k !== x.dataset.big); savePapers(all); await del(x.dataset.big); paperSheet(id, after); }, () => paperSheet(id, after)));
    });
  }
  async function bigPhoto(k, onDelete, back) {
    const src = await get(k);
    OR.sheet('<img class="ppbig" src="' + (src || '') + '" alt=""><p class="small muted">Pinch to zoom.</p><div class="row"><button class="btn ghost" id="pbDel">Remove photo</button><button class="btn pri" id="pbBack">Back</button></div>', b => {
      $('#pbDel', b).onclick = () => { if (confirm('Remove this photo from the phone?')) onDelete(); };
      $('#pbBack', b).onclick = back;
    });
  }
  // roadside: every paper, large and bright, one after another
  async function showAll() {
    const all = papers(), list = [];
    for (const [id, name] of OR.PAPERS) { const p = all[id]; if (!p) continue; for (const k of p.photos || []) list.push({ name, p, src: await get(k) }); if (!(p.photos || []).length && p.number) list.push({ name, p, src: null }); }
    if (!list.length) return OR.toast('Add a photo of your papers first');
    const el = document.createElement('div'); el.id = 'ppFull';
    el.innerHTML = '<button class="ppx" aria-label="Close">' + ic('x') + '</button><div class="ppscroll">' + list.map(x => '<figure>' + (x.src ? '<img src="' + x.src + '" alt="">' : '') + '<figcaption><b>' + esc(x.name) + '</b>' + (x.p.number ? ' · ' + esc(x.p.number) : '') + '</figcaption></figure>').join('') + '</div>';
    document.body.appendChild(el);
    el.querySelector('.ppx').onclick = () => { el.remove(); if (OR.native && OR.native.keepScreenOn && !OR.ride.on) OR.native.keepScreenOn(false); };
    if (OR.native && OR.native.keepScreenOn) OR.native.keepScreenOn(true);
  }
  OR.showPapers = showAll;
})(window.OR);
