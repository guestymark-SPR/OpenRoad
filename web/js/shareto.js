/* OpenRoad "Share to OpenRoad": in Google Maps, WhatsApp, Messages and other apps, Share a place or a link and choose
   OpenRoad. The text (and, for short Google links, the places they lead to, which the Android app follows) is read
   for a place: map coordinates in the link, a place name, or an address that is then looked up.
   A full multi-stop Google Maps route link is read when its stops are in the link itself; Google does not always
   put the stops in a shared link, in which case only what is in the link can be used. */
'use strict';
(function (OR) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const N = '(-?\\d{1,3}(?:\\.\\d+)?)', SEP = '\\s*,\\s*';
  const okLL = (la, lo) => isFinite(la) && isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180 && !(la === 0 && lo === 0);
  const pair = (m, a, b) => { const la = parseFloat(m[a]), lo = parseFloat(m[b]); return okLL(la, lo) ? { lat: la, lng: lo } : null; };
  const dec = s => { try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch (e) { return String(s); } };

  // coordinates written in one piece of text or one link, the most exact kind first
  function coordsIn(t) {
    t = dec(t); let m;
    if ((m = t.match(new RegExp('!3d' + N + '!4d' + N)))) return pair(m, 1, 2);              // a Google place pin
    if ((m = t.match(new RegExp('[?&](?:q|query|ll|destination|daddr|center|sll|saddr)=' + N + SEP + N)))) return pair(m, 1, 2);
    if ((m = t.match(new RegExp('[?&]mlat=' + N + '&mlon=' + N)))) return pair(m, 1, 2);       // OpenStreetMap
    if ((m = t.match(new RegExp('#map=\\d+/' + N + '/' + N)))) return pair(m, 1, 2);
    if ((m = t.match(new RegExp('^\\s*geo:' + N + SEP + N)))) return pair(m, 1, 2);            // geo:53.2,-1.9
    if ((m = t.match(new RegExp('@' + N + SEP + N)))) return pair(m, 1, 2);                    // the map's centre in a Google link
    if ((m = t.match(new RegExp('(?:^|[\\s(:])' + N + SEP + N + '(?=$|[\\s),])'))) && /\./.test(m[1]) && /\./.test(m[2])) return pair(m, 1, 2); // "53.2587, -1.9116"
    return null;
  }
  const urlsIn = t => (String(t).match(/https?:\/\/[^\s<>"]+/g) || []).map(u => u.replace(/[).,;]+$/, ''));
  // links that carry another link (Google's consent page)
  function unwrap(u) { const m = u.match(/[?&]continue=([^&]+)/); return m ? dec(m[1]) : u; }

  // the place or places in a shared text
  OR.parseShared = function (text, subject, hops) {
    const all = [].concat((hops || []).slice().reverse().map(unwrap), urlsIn(text).map(unwrap));
    const res = { stops: [], label: '', query: '' };
    // a Google directions link: /maps/dir/A/B/C/ (stops as names or coordinates)
    for (const u of all) {
      const d = u.match(/google\.[a-z.]+\/maps\/dir\/([^?#@]*)/i);
      if (d) {
        const segs = d[1].split('/').map(s => dec(s).trim()).filter(Boolean);
        const stops = segs.map(s => { const c = coordsIn(s); return c ? { lat: c.lat, lng: c.lng, name: '' } : { q: s, name: s }; });
        if (stops.length >= 1) { res.stops = stops; res.dir = true; break; }
      }
      const dd = u.match(/[?&]destination=([^&]+)/); // the "api=1" directions form
      if (dd && /google\.[a-z.]+\/maps\/dir/i.test(u)) {
        const dest = dec(dd[1]), c = coordsIn('q=' + dest), o = u.match(/[?&]origin=([^&]+)/), way = u.match(/[?&]waypoints=([^&]+)/);
        const mk = s => { const k = coordsIn('q=' + s); return k ? { lat: k.lat, lng: k.lng, name: '' } : { q: s, name: s }; };
        res.stops = (o ? [mk(dec(o[1]))] : []).concat(way ? dec(way[1]).split('|').map(mk) : [], [c ? { lat: c.lat, lng: c.lng, name: '' } : { q: dest, name: dest }]);
        res.dir = true; break;
      }
    }
    if (!res.stops.length) {
      let c = null, nameFromUrl = '', q = '';
      for (const u of all.concat([String(text)])) {
        c = coordsIn(u); if (!c && /^\s*geo:/i.test(u)) { const g = u.match(/[?&]q=([^&]+)/); if (g) q = dec(g[1]); }
        const p = u.match(/\/maps\/place\/([^/@?#]+)/i); if (p && !nameFromUrl) nameFromUrl = dec(p[1]);
        const qq = u.match(/[?&](?:q|query|destination)=([^&]+)/); if (qq && !q && !coordsIn('q=' + dec(qq[1]))) q = dec(qq[1]);
        if (c) break;
      }
      // Google's "Share" text is: name, address, link. The first line that isn't a link is the name.
      const lines = String(text).split(/\r?\n/).map(s => s.trim()).filter(s => s && !/^https?:\/\//i.test(s) && !/^geo:/i.test(s));
      const first = lines[0] ? lines[0].replace(/\s*https?:\/\/\S+/g, '').replace(/^(location|my location|live location)\s*:\s*/i, '').trim() : '';
      const name = first || nameFromUrl || q || subject || '';
      if (c) res.stops = [{ lat: c.lat, lng: c.lng, name: name.slice(0, 80) }];
      else if (q || nameFromUrl || first) res.stops = [{ q: (q || nameFromUrl || lines.slice(0, 2).join(', ')).slice(0, 160), name: (name).slice(0, 80) }];
    }
    return res;
  };

  // look up the stops that came as words
  async function resolve(res) {
    const out = [];
    for (const s of res.stops) {
      if (s.lat != null) { out.push(s); continue; }
      if (/^(your|my) location$|^current location$/i.test(s.q)) { if (OR.pos) out.push({ lat: OR.pos.lat, lng: OR.pos.lng, name: 'My position' }); continue; }
      const l = await OR.search(s.q).catch(() => []);
      if (l && l[0]) out.push({ lat: l[0].lat, lng: l[0].lng, name: s.name && !res.dir ? s.name : l[0].name, sub: l[0].sub });
      else out.push({ missing: s.q });
    }
    return out;
  }

  OR.onSharedText = async function (text, subject, hops) {
    try {
      OR.closeSheet && OR.closeSheet();
      OR.toast('Looking for the place…', 2500);
      const parsed = OR.parseShared(text, subject, hops);
      if (!parsed.stops.length) { OR.toast('No place found in what was shared', 6000); return; }
      const stops = await resolve(parsed), bad = stops.filter(s => s.missing);
      const good = stops.filter(s => !s.missing);
      if (!good.length) { OR.toast('Could not find "' + bad[0].missing + '"', 6000); return; }
      const multi = good.length > 1;
      const nm = s => s.name || (s.lat.toFixed(4) + ', ' + s.lng.toFixed(4));
      OR.sheet('<h2>' + OR.ic('flag') + (multi ? 'Route shared with you' : 'Go here?') + '</h2>' +
        '<div class="optcard">' + good.map((s, i) => '<div class="opt-row"><span><b>' + (multi ? (i + 1) + '. ' : '') + esc(nm(s)) + '</b><small>' + esc(s.sub || (s.lat.toFixed(4) + ', ' + s.lng.toFixed(4))) + '</small></span></div>').join('') + '</div>' +
        (bad.length ? '<p class="small muted">Could not find: ' + bad.map(b => esc(b.missing)).join('; ') + '</p>' : '') +
        (multi ? '<p class="small muted">Shared Google routes only carry the stops written in the link. Check them, then plan your own twisty way between them.</p>' : '') +
        '<button class="btn go wide" id="stGo">' + OR.ic('moto') + (multi ? 'Plan this route' : 'Take me there') + '</button>' +
        (multi ? '' : '<button class="btn wide" id="stAdd">' + OR.ic('plus') + 'Add as a stop</button><button class="btn wide ghost" id="stPin">Just show on the map</button>'), b => {
        const go = () => { OR.closeSheet(); document.querySelector('[data-tab=plan]') && document.querySelector('[data-tab=plan]').click(); };
        b.querySelector('#stGo').onclick = () => {
          go();
          if (!multi) { OR.goTo(good[0]); return; }
          const w = good.map(s => ({ lng: s.lng, lat: s.lat, name: nm(s), type: 'through' })); w[0].type = 'break'; w[w.length - 1].type = 'break';
          OR.plan.wps = w; OR.planChanged && OR.planChanged(true);
        };
        const add = b.querySelector('#stAdd'); if (add) add.onclick = () => { go(); OR.addStop ? OR.addStop(good[0]) : OR.goTo(good[0]); };
        const pin = b.querySelector('#stPin'); if (pin) pin.onclick = () => { OR.closeSheet(); OR.map.flyTo({ center: [good[0].lng, good[0].lat], zoom: 14 }); };
      });
    } catch (e) { OR.toast('Could not use what was shared: ' + e.message, 6000); }
  };
  window.onSharedText = OR.onSharedText;
})(window.OR);
