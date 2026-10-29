/* OpenRoad icons: two-tone line icons (24 grid) and coloured map pins. Each place type has its own colour. */
'use strict';
(function (OR) {
  // class "d" = the soft fill in the icon's colour; everything else is a 1.9 px rounded stroke
  const I = {
    // a cruiser, side on
    moto: '<circle cx="5" cy="16.5" r="3.3"/><circle cx="19" cy="16.5" r="3.3"/><circle class="d" cx="5" cy="16.5" r="3.3"/><circle class="d" cx="19" cy="16.5" r="3.3"/><path class="d" d="M9 13.2h5l1.2 2.2H9.6z"/><path d="M5 16.5 8.6 12.6h5.6l1.6 2.6H19"/><path d="M19 16.5 15.8 7.2"/><path d="M14.2 7h3.3"/><path d="M9.4 12.4c.9-2.2 2.6-3 4.6-2.7l2.1.3"/><path d="M2.4 11.6c1.6-.9 3.6-1 5.3-.4l.9 1.4"/><path d="M8.6 18h5.6"/>',
    // three riders together (group ride)
    group: '<circle class="d" cx="12" cy="8" r="3.2"/><circle cx="12" cy="8" r="3.2"/><path class="d" d="M6.5 19.5c0-3.3 2.5-5.6 5.5-5.6s5.5 2.3 5.5 5.6z"/><path d="M6.5 19.5c0-3.3 2.5-5.6 5.5-5.6s5.5 2.3 5.5 5.6z"/><circle cx="5" cy="10" r="2.3"/><circle cx="19" cy="10" r="2.3"/><path d="M1.8 18c0-2.4 1.5-4 3.6-4.2M22.2 18c0-2.4-1.5-4-3.6-4.2"/>',
    check: '<circle class="d" cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="m8 12.3 2.7 2.7L16.2 9.4"/>',
    full: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><path class="d" d="M8 8h8v8H8z"/>',
    send: '<path class="d" d="M3.5 11.2 20.5 4l-5.6 16.5-3.6-6.9z"/><path d="M3.5 11.2 20.5 4l-5.6 16.5-3.6-6.9z"/><path d="m11.3 13.6 9.2-9.6"/>',
    noentry: '<circle class="d" cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="M7.5 12h9"/>',
    warn: '<path class="d" d="M12 3.5 21.5 20h-19z"/><path d="M12 3.5 21.5 20h-19z"/><path d="M12 9.5v5M12 17.3v.2"/>',
    qr: '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><path class="d" d="M5.5 5.5h3v3h-3zM15.5 5.5h3v3h-3zM5.5 15.5h3v3h-3z"/><path d="M13.5 13.5h3v3M20.5 13.5v.1M13.5 20.5h.1M17 20.5h3.5V17"/>',
    mic: '<rect class="d" x="9" y="3" width="6" height="11" rx="3"/><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
    // a speech bubble (group message)
    chat: '<path class="d" d="M4 5.5h16v10H10l-4 3.5v-3.5H4z"/><path d="M4 5.5h16v10H10l-4 3.5v-3.5H4z"/><path d="M8 9.5h8M8 12.5h5"/>',
    // a rider leaning into a bend (lean angle)
    lean: '<path class="d" d="M3.5 18.5a8.5 8.5 0 0 1 17 0z"/><path d="M3.5 18.5a8.5 8.5 0 0 1 17 0"/><path d="M12 18.5 16.5 10"/><circle cx="12" cy="18.5" r="1.6"/><path d="M3 18.5h18M5.2 13.4l1.6.9M12 10v1.8M18.8 13.4l-1.6.9"/>',
    plan: '<path class="d" d="M4 6.5 9 4.5l6 2 5-2v13l-5 2-6-2-5 2z"/><path d="M4 6.5 9 4.5l6 2 5-2v13l-5 2-6-2-5 2z"/><path d="M7 15.5c2.2 0 2-4.5 5-4.5s2.4-3.5 5-3.5" stroke-dasharray="0.1 2.6"/>',
    trips: '<rect class="d" x="3.5" y="7" width="17" height="12.5" rx="2.2"/><rect x="3.5" y="7" width="17" height="12.5" rx="2.2"/><path d="M9 7V5.3c0-.7.6-1.3 1.3-1.3h3.4c.7 0 1.3.6 1.3 1.3V7"/><path d="M3.5 12.5h17"/><path d="M8 11v3M16 11v3"/>',
    near: '<path class="d" d="M12 21.2s-6.8-5.8-6.8-11a6.8 6.8 0 0 1 13.6 0c0 5.2-6.8 11-6.8 11z"/><path d="M12 21.2s-6.8-5.8-6.8-11a6.8 6.8 0 0 1 13.6 0c0 5.2-6.8 11-6.8 11z"/><circle cx="12" cy="10.2" r="2.4"/>',
    more: '<rect class="d" x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect class="d" x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
    fuel: '<rect class="d" x="4" y="4" width="9.5" height="16.5" rx="1.6"/><path d="M4 20.5V5.6C4 4.7 4.7 4 5.6 4h6.3c.9 0 1.6.7 1.6 1.6v14.9"/><path d="M2.8 20.5h11.9"/><path d="M6.5 7.5h4.5v4H6.5z"/><path d="M13.5 10h1.7c1 0 1.8.8 1.8 1.8v4.4a1.4 1.4 0 0 0 2.8 0V8.6L17.5 6"/>',
    bed: '<path class="d" d="M3 13.5h18v4H3z"/><path d="M3 6v12.5M21 18.5v-5H3"/><path d="M21 13.5V12c0-1.7-1.3-3-3-3h-6.5v4.5"/><circle cx="7" cy="10.5" r="1.8"/>',
    tent: '<path class="d" d="M12 5 3 19.5h18z"/><path d="M12 5 3 19.5h18z"/><path d="M12 5v14.5"/><path d="M9.2 19.5 12 14.5l2.8 5"/><path d="M10.5 3 12 5l1.5-2"/>',
    cup: '<path class="d" d="M5 8.5h11v5.2a5.5 5.5 0 0 1-11 0z"/><path d="M5 8.5h11v5.2a5.5 5.5 0 0 1-11 0z"/><path d="M16 10h1.5a2.3 2.3 0 0 1 0 4.6H16"/><path d="M8.5 3.5c-.6.8-.6 1.6 0 2.4M11.5 3.5c-.6.8-.6 1.6 0 2.4"/><path d="M4 21h13"/>',
    pint: '<path class="d" d="M7.2 9h9.6l-1.2 11.5H8.4z"/><path d="M6.6 4h10.8l-1.8 16.5H8.4z"/><path d="M7.2 9h9.6"/><path d="M9.5 6.2c.8-.7 1.7-.7 2.5 0s1.7.7 2.5 0"/>',
    view: '<path class="d" d="M8.5 13.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0zM22.5 13.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z"/><circle cx="5" cy="13.5" r="3.5"/><circle cx="19" cy="13.5" r="3.5"/><path d="M8.5 13.5h7M3 10.5l2-5h3l1 4M21 10.5l-2-5h-3l-1 4"/>',
    pass: '<path class="d" d="M2.5 19.5 9 8.5l3.8 6 2.7-3.6 6 8.6z"/><path d="M2.5 19.5 9 8.5l3.8 6 2.7-3.6 6 8.6z"/><path d="M7.3 11.4 9 12.6l1.6-1.4"/><path d="M15 4.5v4M15 4.5h3.5l-.8 1.2.8 1.2H15"/>',
    wrench: '<path class="d" d="M14.7 3.8a4.6 4.6 0 0 0-5 6.3l-6.2 6.2a2 2 0 0 0 2.8 2.8l6.2-6.2a4.6 4.6 0 0 0 6.3-5l-2.7 2.7-2.6-.5-.5-2.6z"/><path d="M14.7 3.8a4.6 4.6 0 0 0-5 6.3l-6.2 6.2a2 2 0 0 0 2.8 2.8l6.2-6.2a4.6 4.6 0 0 0 6.3-5l-2.7 2.7-2.6-.5-.5-2.6z"/>',
    park: '<rect class="d" x="3.5" y="3.5" width="17" height="17" rx="4"/><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M9.5 17V7.5h3.6a3 3 0 0 1 0 6H9.5"/>',
    cam: '<rect class="d" x="3" y="7" width="13" height="9" rx="1.8"/><rect x="3" y="7" width="13" height="9" rx="1.8"/><path d="m16 10 5-2.5v8L16 13"/><path d="M7 16v4.5M5 20.5h4"/>',
    shield: '<path class="d" d="M12 3.2 19 6v5.8c0 4.6-3.2 7.8-7 9-3.8-1.2-7-4.4-7-9V6z"/><path d="M12 3.2 19 6v5.8c0 4.6-3.2 7.8-7 9-3.8-1.2-7-4.4-7-9V6z"/><path d="m9 12 2.2 2.2 4-4.2"/>',
    helmet: '<path class="d" d="M3.5 15.5a8.5 8.5 0 0 1 17-1.5v4H8.5c-2.8 0-5-1.1-5-2.5z"/><path d="M3.5 15.5a8.5 8.5 0 0 1 17-1.5v4H8.5c-2.8 0-5-1.1-5-2.5z"/><path d="M20.5 11.5h-6.8a1.7 1.7 0 0 0 0 3.4h6.8"/>',
    id: '<rect class="d" x="3" y="5.5" width="18" height="13" rx="2"/><rect x="3" y="5.5" width="18" height="13" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M5.8 16c.6-1.6 4.8-1.6 5.4 0M14 10h4.5M14 13.5h4.5"/><path d="M15.3 8.2v0" stroke-width="0"/>',
    map: '<path class="d" d="M3.5 6.3 9 4.3l6 2 5.5-2v13.4l-5.5 2-6-2-5.5 2z"/><path d="M3.5 6.3 9 4.3l6 2 5.5-2v13.4l-5.5 2-6-2-5.5 2zM9 4.3v13.4M15 6.3v13.4"/>',
    layers: '<path class="d" d="M12 3.5 3 8.3l9 4.8 9-4.8z"/><path d="M12 3.5 3 8.3l9 4.8 9-4.8z"/><path d="m3 12.6 9 4.8 9-4.8M3 16.6l9 4.8 9-4.8"/>',
    gear: '<circle class="d" cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5"/><circle cx="12" cy="12" r="6.6"/>',
    update: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20.2 3.8v4.6h-4.6"/><path class="d" d="M12 8v4l2.6 1.6"/><path d="M12 8v4l2.6 1.6"/>',
    locate: '<circle class="d" cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22"/>',
    north: '<path class="d" d="M12 3 18 20l-6-4-6 4z"/><path d="M12 3 18 20l-6-4-6 4z"/>',
    cloud: '<path class="d" d="M7 18.5a4.2 4.2 0 0 1-.6-8.4 6.2 6.2 0 0 1 11.9 1.4 3.6 3.6 0 0 1-.3 7z"/><path d="M7 18.5a4.2 4.2 0 0 1-.6-8.4 6.2 6.2 0 0 1 11.9 1.4 3.6 3.6 0 0 1-.3 7z"/>',
    sun: '<circle class="d" cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="4"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3 7 7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7"/>',
    flag: '<path class="d" d="M5.5 4h12.5l-2.4 4.2L18 12.5H5.5z"/><path d="M5.5 21V4h12.5l-2.4 4.2L18 12.5H5.5"/>',
    ferry: '<path class="d" d="M3.5 14.5h17l-2.8 5H6.3z"/><path d="M3.5 14.5h17l-2.8 5H6.3z"/><path d="M6.5 14.5V9.5h11v5M12 9.5V5.5M9.5 7.5h5"/><path d="M2.5 22c1.5 0 1.5-.9 3-.9s1.5.9 3 .9 1.5-.9 3-.9 1.5.9 3 .9 1.5-.9 3-.9 1.5.9 3 .9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    loop: '<path class="d" d="M12 20.5a7 7 0 1 0-6.6-9.3"/><path d="M12 20.5a7 7 0 1 0-6.6-9.3"/><path d="M3.2 7.8 5.4 11.2 8.8 9"/><circle cx="12" cy="20.5" r="1.6"/>',
    share: '<path class="d" d="M4.5 12v7.5h15V12"/><path d="M4.5 12v7.5h15V12M12 3.5v11.5M7.5 8 12 3.5 16.5 8"/>',
    save: '<path class="d" d="M5 3.5h11l3.5 3.5v13.5H5z"/><path d="M5 3.5h11l3.5 3.5v13.5H5z"/><path d="M8 3.5v4.8h7.5V3.5M8 20.5V14h8.5v6.5"/>',
    dl: '<path class="d" d="M4.5 16v4h15v-4"/><path d="M12 3.5v12M7 10.8l5 5 5-5M4.5 16v4h15v-4"/>',
    skip: '<path class="d" d="M5 5.5 13.5 12 5 18.5z"/><path d="M5 5.5 13.5 12 5 18.5z"/><path d="M18 5.5v13"/>',
    print: '<rect class="d" x="3.5" y="9.5" width="17" height="8" rx="1.6"/><path d="M6.5 9.5V3.5h11v6M6.5 17.5H5.1c-.9 0-1.6-.7-1.6-1.6v-4.8c0-.9.7-1.6 1.6-1.6h13.8c.9 0 1.6.7 1.6 1.6v4.8c0 .9-.7 1.6-1.6 1.6h-1.4"/><rect x="6.5" y="14" width="11" height="7" rx="1"/>',
    star: '<path class="d" d="m12 3.2 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.2l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/><path d="m12 3.2 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.2l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    time: '<circle class="d" cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="M12 7.2V12l3 2"/>',
    twisty: '<path d="M7 21c0-3.5 9-3 9-7s-8-3.2-8-7c0-2.2 2.2-3.5 5-3.5"/><path class="d" d="M5 21c0-4.5 9-4 9-7.2S6 10.5 6 7c0-3 3.2-5 7-5h1.2v3h-1.2c-2 0-3.4.8-3.4 2 0 2.4 8.4 2.6 8.4 6.8 0 5-9 4.8-9 7.4z"/>',
    back: '<path d="m15 5.5-6.5 6.5 6.5 6.5"/>', chev: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
    up: '<path d="m6 15 6-6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>', x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    vol: '<path class="d" d="M4 9.2v5.6h3.8l5 4.2V5L7.8 9.2z"/><path d="M4 9.2v5.6h3.8l5 4.2V5L7.8 9.2zM16 9a4.2 4.2 0 0 1 0 6M18.6 6.4a7.8 7.8 0 0 1 0 11.2"/>',
    mute: '<path class="d" d="M4 9.2v5.6h3.8l5 4.2V5L7.8 9.2z"/><path d="M4 9.2v5.6h3.8l5 4.2V5L7.8 9.2zM16 9.5l5 5M21 9.5l-5 5"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    search: '<circle class="d" cx="10.5" cy="10.5" r="6.5"/><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>'
  };
  I.rides = I.moto; I.bike = I.moto;
  OR.I = I;
  OR.ic = (n, cls) => '<svg viewBox="0 0 24 24"' + (cls ? ' class="' + cls + '"' : '') + ' aria-hidden="true">' + (I[n] || '') + '</svg>';

  // ---------- colours for places, used on the map and in lists ----------
  OR.POI = {
    meet: { c: '#d81b60', i: 'flag', label: 'Regroup point' }, hazard: { c: '#f59f00', i: 'warn', label: 'Hazard' }, fuel: { c: '#e53935', i: 'fuel', label: 'Fuel' }, stay: { c: '#7e57c2', i: 'bed', label: 'Stay' }, camp: { c: '#2e7d32', i: 'tent', label: 'Campsite' },
    cafe: { c: '#8d5a3b', i: 'cup', label: 'Café' }, pub: { c: '#ef8f00', i: 'pint', label: 'Pub' }, view: { c: '#00897b', i: 'view', label: 'Viewpoint' },
    pass: { c: '#5d6d7e', i: 'pass', label: 'Mountain pass' }, bikeshop: { c: '#1565c0', i: 'wrench', label: 'Motorbike shop' }, motopark: { c: '#0277bd', i: 'park', label: 'Motorbike parking' },
    cam: { c: '#f9a825', i: 'cam', label: 'Speed camera', dark: true }, wx: { c: '#1e88e5', i: 'cloud', label: 'Weather' },
    closed: { c: '#d50000', i: 'noentry', label: 'Road closed' }, works: { c: '#ef6c00', i: 'warn', label: 'Roadworks' }
  };

  // Map pins: a coloured teardrop with a white icon, drawn on a canvas so it can be added to the map at once.
  const PIN = { w: 34, h: 44 };
  OR.pinImage = function (kind, ratio) {
    const k = OR.POI[kind] || OR.POI.fuel, r = ratio || 2, W = PIN.w * r, H = PIN.h * r;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'); g.scale(r, r);
    // shadow
    g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(17, 41.5, 6, 2, 0, 0, Math.PI * 2); g.fill();
    // teardrop
    g.beginPath(); g.moveTo(17, 41); g.bezierCurveTo(13, 34, 2, 28, 2, 17); g.arc(17, 17, 15, Math.PI, 0); g.bezierCurveTo(32, 28, 21, 34, 17, 41); g.closePath();
    g.fillStyle = k.c; g.fill(); g.lineWidth = 2.2; g.strokeStyle = '#fff'; g.stroke();
    // icon, from the same paths as the app's icons
    g.save(); g.translate(17 - 10.8, 17 - 10.8); g.scale(0.9, 0.9);
    const col = k.dark ? '#1c2226' : '#fff';
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2.1; g.lineCap = 'round'; g.lineJoin = 'round';
    const tmp = document.createElement('div'); tmp.innerHTML = '<svg>' + I[k.i] + '</svg>';
    tmp.firstChild.childNodes.forEach(el => {
      const tag = el.nodeName.toLowerCase(), soft = el.getAttribute('class') === 'd';
      let p;
      if (tag === 'path') p = new Path2D(el.getAttribute('d'));
      else if (tag === 'circle') { p = new Path2D(); const cx = +el.getAttribute('cx'), cy = +el.getAttribute('cy'), rr = +el.getAttribute('r'); p.arc(cx, cy, rr, 0, Math.PI * 2); }
      else if (tag === 'rect') { p = new Path2D(); const x = +el.getAttribute('x'), y = +el.getAttribute('y'), w = +el.getAttribute('width'), h = +el.getAttribute('height'), rr = +(el.getAttribute('rx') || 0); if (p.roundRect) p.roundRect(x, y, w, h, rr); else p.rect(x, y, w, h); }
      if (!p) return;
      if (soft) { g.globalAlpha = 0.35; g.fill(p); g.globalAlpha = 1; } else g.stroke(p);
    });
    g.restore();
    return { width: W, height: H, data: new Uint8Array(g.getImageData(0, 0, W, H).data.buffer) };
  };
})(window.OR);
