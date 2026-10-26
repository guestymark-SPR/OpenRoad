/* OpenRoad bike colours: take a photo of your bike, find its paint colours, and use them for the app's
   main colour (the sign-style tab bar, buttons, headers) and highlight (the selected tab, route refs, icons at night).
   Colours are adjusted for readability: the main colour is darkened until white text on it passes WCAG AA (4.5:1),
   and the highlight is lightened until dark text on it does. The photo stays on this phone. */
'use strict';
(function (OR) {
  const $ = OR.$, $$ = OR.$$, esc = OR.esc;
  const DEFAULT = { main: '#00703c', hi: '#ffd200' };
  const INK = [21, 25, 28], WHITE = [255, 255, 255], NIGHT_SURF = [38, 46, 51];

  // ---------- colour maths: sRGB, OKLab/OKLCH, WCAG contrast ----------
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const delin = c => { c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.round(Math.max(0, Math.min(1, c)) * 255); };
  function toLab(rgb) {
    const [r, g, b] = rgb.map(lin);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  }
  function labToLinear([L, a, b]) {
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3), m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3), s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  }
  const toLch = rgb => { const [L, a, b] = toLab(rgb); return [L, Math.hypot(a, b), Math.atan2(b, a)]; };
  function fromLch(L, C, h) { // reduce chroma until it fits in sRGB
    for (let c = C; c >= 0; c -= 0.005) { const v = labToLinear([L, c * Math.cos(h), c * Math.sin(h)]); if (v.every(x => x >= -0.0005 && x <= 1.0005)) return v.map(delin); }
    return labToLinear([L, 0, 0]).map(delin);
  }
  const lum = rgb => { const [r, g, b] = rgb.map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (x, y) => { const a = lum(x), b = lum(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  const hex = rgb => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
  const rgbOf = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  OR.colourContrast = (a, b) => contrast(rgbOf(a), rgbOf(b));

  // main colour: same hue, darkened until white text reads on it; never so dark it vanishes into night mode
  function asMain(rgb) {
    let [L, C, h] = toLch(rgb);
    L = Math.min(L, 0.62);
    let out = fromLch(L, C, h);
    while (contrast(out, WHITE) < 4.6 && L > 0.2) { L -= 0.01; out = fromLch(L, C, h); }
    if (L < 0.3 && C < 0.04) out = fromLch(0.3, C, h); // black paint: a deep charcoal, so the sign still has an edge at night
    return out;
  }
  // highlight: same hue, lightened until dark text reads on it
  function asHi(rgb) {
    let [L, C, h] = toLch(rgb);
    L = Math.max(L, 0.75);
    let out = fromLch(L, Math.max(C, 0.02), h);
    while (contrast(out, INK) < 7 && L < 0.97) { L += 0.01; out = fromLch(L, C, h); }
    return out;
  }
  // a brighter main colour for small icons and bars on the night background
  function nightMain(rgb) {
    let [L, C, h] = toLch(rgb), out = rgb;
    while (contrast(out, NIGHT_SURF) < 3.2 && L < 0.9) { L += 0.01; out = fromLch(L, C, h); }
    return out;
  }

  // ---------- reading the photo ----------
  async function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
  async function shrink(file, max) {
    const url = URL.createObjectURL(file);
    try { const img = await loadImg(url), s = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.86); }
    finally { URL.revokeObjectURL(url); }
  }
  // k-means in OKLab on a small copy. Pixels near the middle count more (the bike is usually in the middle),
  // and coloured pixels count more than grey ones (paint over tarmac, sky and tyres).
  OR.bikeColours = async function (src) {
    const img = await loadImg(src), W = 96, H = Math.max(1, Math.round(96 * img.height / img.width)), c = document.createElement('canvas');
    c.width = W; c.height = H; const g = c.getContext('2d'); g.drawImage(img, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data, px = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, rgb = [d[i], d[i + 1], d[i + 2]], lab = toLab(rgb), C = Math.hypot(lab[1], lab[2]);
      const dx = (x / W - 0.5) / 0.32, dy = (y / H - 0.55) / 0.36, centre = Math.exp(-(dx * dx + dy * dy) / 2);
      if (lab[0] > 0.95 && C < 0.03) continue; // blown-out sky and walls
      const edge = x < W * 0.1 || x >= W * 0.9 || y < H * 0.1 || y >= H * 0.9;
      px.push({ lab, edge, w: centre * (0.35 + Math.min(C, 0.25) * 6) });
    }
    const K = 7; let cen = [];
    for (let k = 0; k < K; k++) cen.push(px[Math.floor((k + 0.5) * px.length / K)].lab.slice());
    let asg = new Array(px.length).fill(0);
    for (let it = 0; it < 12; it++) {
      px.forEach((p, i) => { let b = 0, bd = 1e9; cen.forEach((q, k) => { const dd = (p.lab[0] - q[0]) ** 2 + (p.lab[1] - q[1]) ** 2 + (p.lab[2] - q[2]) ** 2; if (dd < bd) { bd = dd; b = k; } }); asg[i] = b; });
      const sum = cen.map(() => [0, 0, 0, 0]);
      px.forEach((p, i) => { const s = sum[asg[i]]; s[0] += p.lab[0] * p.w; s[1] += p.lab[1] * p.w; s[2] += p.lab[2] * p.w; s[3] += p.w; });
      cen = cen.map((q, k) => sum[k][3] ? [sum[k][0] / sum[k][3], sum[k][1] / sum[k][3], sum[k][2] / sum[k][3]] : q);
    }
    // colours that reach the edges of the photo are usually the background (sky, grass, road, wall)
    const wt = cen.map(() => 0), n = cen.map(() => 0), ne = cen.map(() => 0);
    px.forEach((p, i) => { wt[asg[i]] += p.w; n[asg[i]]++; if (p.edge) ne[asg[i]]++; });
    const edgeAll = px.filter(p => p.edge).length / px.length;
    cen.forEach((q, k) => { const f = n[k] ? ne[k] / n[k] : 0; wt[k] *= Math.pow(Math.max(0.05, 1 - Math.min(1, f / (edgeAll * 1.6))), 2); });
    const tot = wt.reduce((a, b) => a + b, 0) || 1;
    const list = cen.map((q, k) => { const v = labToLinear(q).map(delin); return { rgb: v, share: wt[k] / tot, C: Math.hypot(q[1], q[2]), h: Math.atan2(q[2], q[1]), L: q[0] }; })
      .filter(x => x.share > 0.02).sort((a, b) => b.share - a.share);
    // merge near-duplicates
    const out = []; list.forEach(x => { if (!out.some(y => Math.abs(y.L - x.L) < 0.06 && Math.hypot(y.C * Math.cos(y.h) - x.C * Math.cos(x.h), y.C * Math.sin(y.h) - x.C * Math.sin(x.h)) < 0.04)) out.push(x); });
    return out;
  };
  // the paint: the biggest coloured area if there is one, otherwise the biggest area (black or grey paint)
  function pick(cols) {
    const coloured = cols.filter(c => c.C > 0.06 && c.share > 0.06 && c.share >= cols[0].share * 0.45); // a small stripe on black paint is the highlight, not the main colour
    const main = (coloured.length ? coloured.sort((a, b) => b.share * (0.3 + b.C) - a.share * (0.3 + a.C))[0] : cols[0]);
    const hueGap = (a, b) => { const d = Math.abs(a - b) % (2 * Math.PI); return Math.min(d, 2 * Math.PI - d); };
    const second = cols.filter(c => c !== main && c.C > 0.07 && (main.C < 0.06 || hueGap(c.h, main.h) > 0.6)).sort((a, b) => b.share * b.C - a.share * a.C)[0];
    return { main: hex(asMain(main.rgb)), hi: second ? hex(asHi(second.rgb)) : main.C > 0.06 ? hex(asHi(main.rgb)) : DEFAULT.hi };
  }

  // ---------- applying ----------
  function css(t) {
    const m = rgbOf(t.main), n = hex(nightMain(m));
    return ':root:root{--green:' + t.main + ';--green-2:' + t.main + ';--yellow:' + t.hi + '}' +
      ':root[data-theme=night]{--green:' + t.main + ';--green-2:' + n + ';--yellow:' + t.hi + '}' +
      '.navsign{box-shadow:inset 0 0 0 2px var(--green),inset 0 0 0 4px #fff,0 6px 16px -8px color-mix(in srgb,var(--green) 70%,#000)!important}';
  }
  OR.applyBikeTheme = function () {
    const t = OR.store.get('bikeTheme', null);
    let el = document.getElementById('bikeTheme');
    if (!t || !t.on) { if (el) el.textContent = ''; return; }
    if (!el) { el = document.createElement('style'); el.id = 'bikeTheme'; document.head.appendChild(el); }
    el.textContent = t.css = css(t);
  };
  const save = t => { t.css = css(t); OR.store.set('bikeTheme', t); OR.applyBikeTheme(); };

  // photo kept in this phone's browser storage
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open('openroad-bike', 1); r.onupgradeneeded = () => r.result.createObjectStore('img'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const put = async (k, v) => { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction('img', 'readwrite'); tx.objectStore('img').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); };
  const get = async k => { const d = await db(); return new Promise(res => { const q = d.transaction('img').objectStore('img').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); };
  const del = async k => { const d = await db(); return new Promise(res => { const tx = d.transaction('img', 'readwrite'); tx.objectStore('img').delete(k); tx.oncomplete = res; tx.onerror = res; }); };

  // ---------- the card on the Bike screen ----------
  OR.bikePhotoCard = function () {
    return '<div class="bikephoto" id="bikePhoto"><div class="bp-img" id="bpImg"></div><div class="bp-body" id="bpBody"></div></div>';
  };
  OR.bindBikePhoto = async function (box) {
    const host = $('#bikePhoto', box); if (!host) return;
    const t = OR.store.get('bikeTheme', null), src = t && t.photo ? await get('photo') : null;
    const img = $('#bpImg', host), body = $('#bpBody', host);
    img.innerHTML = src ? '<img src="' + src + '" alt="Your bike">' : '<div class="bp-empty">' + OR.ic('moto') + '</div>';
    const sw = (c, on, k) => '<button class="sw' + (on ? ' on' : '') + '" data-' + k + '="' + c + '" style="background:' + c + '" aria-label="' + c + '"></button>';
    if (!src) {
      body.innerHTML = '<b>Your bike\'s colours</b><span class="small">Add a photo of your bike and OpenRoad takes its paint colours for the tab bar, buttons and highlights.</span>' +
        '<label class="btn wide pri file">' + OR.ic('cam') + 'Add a photo<input type="file" accept="image/*" hidden id="bpAdd"></label>';
    } else {
      const mains = (t.mains || []), his = (t.his || []);
      body.innerHTML = '<label class="sw-row tgl"><input type="checkbox" id="bpOn"' + (t.on ? ' checked' : '') + '><span>Use my bike\'s colours in the app</span></label>' +
        '<div class="sw-l">Main colour</div><div class="sw-row">' + mains.filter(c => c !== DEFAULT.main).map(c => sw(c, c === t.main, 'm')).join('') + sw(DEFAULT.main, t.main === DEFAULT.main, 'm') + '</div>' +
        '<div class="sw-l">Highlight</div><div class="sw-row">' + his.filter(c => c !== DEFAULT.hi).map(c => sw(c, c === t.hi, 'h')).join('') + sw(DEFAULT.hi, t.hi === DEFAULT.hi, 'h') + '</div>' +
        '<div class="bp-prev" style="--pm:' + t.main + ';--ph:' + t.hi + '"><span>Plan</span><span class="on">Trips</span><span>Group</span><span class="ref">A5</span></div>' +
        '<p class="small muted">Adjusted so white text reads on the main colour and dark text on the highlight. The last swatch in each row is OpenRoad\'s own.</p>' +
        '<div class="row"><label class="btn small file">' + OR.ic('cam') + 'New photo<input type="file" accept="image/*" hidden id="bpAdd"></label><button class="btn small ghost" id="bpDel">Remove photo</button></div>';
      $('#bpOn', body).onchange = e => { t.on = e.target.checked; save(t); };
      $$('[data-m]', body).forEach(b => b.onclick = () => { t.main = b.dataset.m; t.on = true; save(t); OR.bindBikePhoto(box); });
      $$('[data-h]', body).forEach(b => b.onclick = () => { t.hi = b.dataset.h; t.on = true; save(t); OR.bindBikePhoto(box); });
      $('#bpDel', body).onclick = async () => { if (!confirm('Remove the photo and go back to OpenRoad\'s colours?')) return; await del('photo'); OR.store.set('bikeTheme', null); OR.applyBikeTheme(); OR.bindBikePhoto(box); };
    }
    $('#bpAdd', body).onchange = async e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      body.innerHTML = '<p class="small">Reading your bike\'s colours…</p>';
      try {
        const data = await shrink(f, 1400); await put('photo', data);
        const cols = await OR.bikeColours(data), p = pick(cols);
        const mains = [], his = [];
        [p.main].concat(cols.map(c => hex(asMain(c.rgb)))).forEach(c => { if (!mains.includes(c) && mains.length < 5) mains.push(c); });
        [p.hi].concat(cols.filter(c => c.C > 0.04).map(c => hex(asHi(c.rgb)))).forEach(c => { if (!his.includes(c) && his.length < 5) his.push(c); });
        save({ on: true, photo: true, main: p.main, hi: p.hi, mains, his });
        OR.toast('Colours taken from your bike');
      } catch (x) { OR.toast('Could not read that photo'); }
      OR.bindBikePhoto(box);
    };
  };
  OR._bikePick = pick; OR._asMain = asMain; OR._asHi = asHi; // for tests
  OR.applyBikeTheme();
})(window.OR);
