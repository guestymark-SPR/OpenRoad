/* OpenRoad flyover: a 30-second 3D video of a ride, flying along it over the hills, to share.
   The map is drawn with terrain (AWS Terrain Tiles, free open elevation data) and the camera follows your track.
   Each frame waits for the map to finish drawing, then is encoded at a fixed 30 frames a second (WebCodecs, H.264)
   and put in an MP4 file, so the video is smooth however long each frame takes to draw. */
'use strict';
(function (OR) {
  const $ = OR.$, esc = OR.esc, ic = (n, c) => OR.ic(n, c);
  const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  const FPS = 30, SECONDS = 30;

  // ---------- a small MP4 writer (one H.264 video track) ----------
  const enc = new TextEncoder();
  function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
  function u16(n) { return [(n >>> 8) & 255, n & 255]; }
  function box(type, ...parts) {
    const body = []; let len = 8;
    parts.forEach(p => { const a = p instanceof Uint8Array ? p : Uint8Array.from(p); body.push(a); len += a.length; });
    const out = new Uint8Array(len); out.set(u32(len), 0); out.set(enc.encode(type), 4);
    let o = 8; body.forEach(a => { out.set(a, o); o += a.length; });
    return out;
  }
  const full = (type, v, flags, ...parts) => box(type, [v, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...parts);
  const zeros = n => new Array(n).fill(0);
  const MATRIX = [].concat(u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000));
  OR.mp4 = function (samples, avcC, W, H, fps) {
    const ts = 90000, delta = ts / fps, n = samples.length, dur = n * delta, durMs = Math.round(n * 1000 / fps);
    const stsd = full('stsd', 0, 0, u32(1), box('avc1', zeros(6), u16(1), zeros(16), u16(W), u16(H), u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(0x18), u16(0xffff), box('avcC', avcC)));
    const stts = full('stts', 0, 0, u32(1), u32(n), u32(delta));
    const keys = samples.map((s, i) => s.key ? i + 1 : 0).filter(Boolean);
    const stss = full('stss', 0, 0, u32(keys.length), ...keys.map(u32));
    const stsc = full('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1));
    const stsz = full('stsz', 0, 0, u32(0), u32(n), ...samples.map(s => u32(s.data.length)));
    const build = off => {
      const stco = full('stco', 0, 0, u32(1), u32(off));
      const stbl = box('stbl', stsd, stts, stss, stsc, stsz, stco);
      const minf = box('minf', full('vmhd', 0, 1, zeros(8)), box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))), stbl);
      const mdia = box('mdia', full('mdhd', 0, 0, u32(0), u32(0), u32(ts), u32(dur), u16(0x55c4), u16(0)), full('hdlr', 0, 0, u32(0), enc.encode('vide'), zeros(12), enc.encode('OpenRoad\0')), minf);
      const tkhd = full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(durMs), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(W << 16), u32(H << 16));
      const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(durMs), u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(2));
      return box('moov', mvhd, box('trak', tkhd, mdia));
    };
    const ftyp = box('ftyp', enc.encode('isom'), u32(512), enc.encode('isomiso2avc1mp41'));
    const size = samples.reduce((s, x) => s + x.data.length, 0);
    const moov = build(0), off = ftyp.length + moov.length + 8;
    const parts = [ftyp, build(off), new Uint8Array(u32(size + 8)), enc.encode('mdat'), ...samples.map(s => s.data)];
    return new Blob(parts, { type: 'video/mp4' });
  };

  // ---------- the camera path ----------
  function path(pts) {
    const P = OR.resample(pts, Math.max(10, OR.cumulative(pts).slice(-1)[0] / 1500)), c = OR.cumulative(P), L = c[c.length - 1];
    const at = d => { d = Math.max(0, Math.min(L, d)); let lo = 0, hi = c.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= d) lo = m; else hi = m; } const k = (d - c[lo]) / ((c[hi] - c[lo]) || 1); return [P[lo][0] + (P[hi][0] - P[lo][0]) * k, P[lo][1] + (P[hi][1] - P[lo][1]) * k]; };
    return { P, c, L, at, upto: d => { const out = []; for (let i = 0; i < P.length && c[i] <= d; i++) out.push(P[i]); out.push(at(d)); return out; } };
  }
  const ease = x => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  const angDelta = (a, b) => ((b - a + 540) % 360) - 180;

  // once the map has drawn this view with its tiles (or after a while: a frame with gaps beats a stall), copy it,
  // inside the map's own drawing step so the picture is still there to copy
  function capture(m, max, draw) {
    return new Promise(res => {
      const t0 = performance.now();
      const h = () => { if (m.areTilesLoaded() || performance.now() - t0 > max) { m.off('render', h); draw(); res(); } else m.triggerRepaint(); };
      m.on('render', h); m.triggerRepaint();
    });
  }
  const FLY = ['fly-all', 'fly-done-case', 'fly-done'];
  function layers(m, all) {
    const add = (id, data) => { if (m.getSource(id)) m.getSource(id).setData(data); else m.addSource(id, { type: 'geojson', data }); };
    add('fly-all', { type: 'Feature', geometry: { type: 'LineString', coordinates: all } }); add('fly-done', { type: 'Feature', geometry: { type: 'LineString', coordinates: [all[0], all[0]] } });
    if (!m.getLayer('fly-all')) {
      m.addLayer({ id: 'fly-all', type: 'line', source: 'fly-all', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-opacity': 0.55, 'line-width': 4 } });
      m.addLayer({ id: 'fly-done-case', type: 'line', source: 'fly-done', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#15191c', 'line-width': 9 } });
      m.addLayer({ id: 'fly-done', type: 'line', source: 'fly-done', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': getComputedStyle(document.documentElement).getPropertyValue('--yellow').trim() || '#ffd200', 'line-width': 5.5 } });
    }
  }
  function unlayers(m) { FLY.forEach(id => { if (m.getLayer(id)) m.removeLayer(id); }); ['fly-all', 'fly-done'].forEach(id => { if (m.getSource(id)) m.removeSource(id); }); }
  async function encoderFor(W, H) {
    if (!window.VideoEncoder) return null;
    for (const codec of ['avc1.4D401F', 'avc1.42E01F', 'avc1.640028', 'avc1.42001F']) {
      const cfg = { codec, width: W, height: H, bitrate: 6e6, framerate: FPS, avc: { format: 'avc' } };
      try { const s = await VideoEncoder.isConfigSupported(cfg); if (s.supported) return cfg; } catch (e) { }
    }
    return null;
  }

  OR.flyover = async function (ride, opts) {
    const m = OR.map, pts = OR.rides.pts(ride); if (pts.length < 10) return OR.toast('This ride is too short for a flyover');
    const portrait = innerHeight > innerWidth, W = portrait ? 720 : 1280, H = portrait ? 1280 : 720;
    const cfg = await encoderFor(W, H);
    if (!cfg) return OR.toast('This phone can\'t make videos here (no H.264 encoder available to the app)', 7000);
    const pth = path(pts), km = pth.L / 1000, frames = FPS * ((opts && opts.seconds) || SECONDS);
    const zoom = Math.max(10.3, Math.min(14, 13.6 - Math.log2(Math.max(1, km / 25))));
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
    // the screen while filming: just the map, and a progress card
    document.body.classList.add('filming');
    const card = document.createElement('div'); card.id = 'flyCard'; card.innerHTML = '<b>' + ic('cam') + 'Making the flyover</b><span id="flyPct">Loading the hills…</span><button class="btn small ghost" id="flyX">Stop</button>'; document.body.appendChild(card);
    let stop = false; $('#flyX', card).onclick = () => { stop = true; };
    const before = { c: m.getCenter(), z: m.getZoom(), b: m.getBearing(), p: m.getPitch() };
    const follow = OR.ride && OR.ride.follow; if (OR.ride) OR.ride.follow = false;
    try {
      if (!m.getSource('fly-dem')) m.addSource('fly-dem', { type: 'raster-dem', tiles: [DEM], tileSize: 256, encoding: 'terrarium', maxzoom: 14 });
      m.setTerrain({ source: 'fly-dem', exaggeration: 1.5 });
      layers(m, pth.P);
      const samples = []; let desc = null, err = null;
      const ve = new VideoEncoder({ output: (chunk, meta) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); samples.push({ data: b, key: chunk.type === 'key' }); if (meta && meta.decoderConfig && meta.decoderConfig.description) desc = new Uint8Array(meta.decoderConfig.description); }, error: e => { err = e; } });
      ve.configure(cfg);
      // camera: a wide look first, then along the ride, then pull back to see it all
      const intro = Math.round(frames / 10), outro = Math.round(frames / 10), mid = frames - intro - outro;
      let hd = OR.bearing(pth.at(0), pth.at(Math.min(pth.L, 1500)));
      const box = OR.bbox(pts), over = m.cameraForBounds(box, { padding: 80 }) || { center: m.getCenter(), zoom: 9 };
      for (let f = 0; f < frames && !stop && !err; f++) {
        let cam, d;
        if (f < intro) { const k = ease(f / intro); d = 0; const p0 = pth.at(0); cam = { center: [over.center.lng + (p0[0] - over.center.lng) * k, over.center.lat + (p0[1] - over.center.lat) * k], zoom: over.zoom + (zoom - over.zoom) * k, pitch: 30 + 32 * k, bearing: hd * k }; }
        else if (f < intro + mid) {
          d = pth.L * ease((f - intro) / mid);
          const ahead = OR.bearing(pth.at(d), pth.at(d + Math.max(300, pth.L / 25)));
          hd = (hd + angDelta(hd, ahead) * 0.06 + 360) % 360; // turn smoothly towards where the road goes
          cam = { center: pth.at(d), zoom, pitch: 62, bearing: hd };
        } else { const k = ease((f - intro - mid) / outro); d = pth.L; const pe = pth.at(pth.L); cam = { center: [pe[0] + (over.center.lng - pe[0]) * k, pe[1] + (over.center.lat - pe[1]) * k], zoom: zoom + (over.zoom - zoom) * k, pitch: 62 - 40 * k, bearing: hd * (1 - k) }; }
        const done = pth.upto(d); m.getSource('fly-done').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: done.length > 1 ? done : [done[0], done[0]] } });
        m.jumpTo(cam);
        // copy the map into the frame, filling it (cropped to the video's shape), then the words on top
        await capture(m, f === 0 ? 8000 : 2500, () => { const src = m.getCanvas(), sw = src.width, sh = src.height, sc = Math.max(W / sw, H / sh), dw = sw * sc, dh = sh * sc; g.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh); });
        overlay(g, W, H, ride, Math.min(1, d / pth.L), pth.L);
        const vf = new VideoFrame(cv, { timestamp: Math.round(f * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
        ve.encode(vf, { keyFrame: f % (FPS * 2) === 0 }); vf.close();
        if (ve.encodeQueueSize > 10) await new Promise(r => setTimeout(r, 20));
        $('#flyPct', card).textContent = Math.round(100 * f / frames) + '%';
      }
      await ve.flush(); ve.close();
      if (err) throw err;
      if (stop) { OR.toast('Flyover stopped'); return; }
      if (!desc) throw new Error('the encoder gave no setup data');
      const blob = OR.mp4(samples, desc, W, H, FPS);
      await save(blob, OR.fileName('OpenRoad flyover ' + ride.name) + '.mp4');
    } catch (e) { OR.toast('Couldn\'t make the flyover: ' + (e.message || e), 7000); }
    finally {
      try { m.setTerrain(null); } catch (e) { }
      unlayers(m);
      card.remove(); document.body.classList.remove('filming');
      if (OR.ride) OR.ride.follow = follow;
      m.jumpTo({ center: before.c, zoom: before.z, bearing: before.b, pitch: before.p });
    }
  };
  function overlay(g, W, H, ride, k, L) {
    const u = Math.min(W, H) / 720, pad = 28 * u;
    g.save();
    const grad = g.createLinearGradient(0, 0, 0, 190 * u); grad.addColorStop(0, 'rgba(0,0,0,.55)'); grad.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grad; g.fillRect(0, 0, W, 190 * u);
    g.fillStyle = '#fff'; g.font = '800 ' + Math.round(38 * u) + 'px Overpass, Roboto, sans-serif'; g.fillText(ride.name || 'My ride', pad, pad + 36 * u, W - pad * 2);
    g.font = '600 ' + Math.round(24 * u) + 'px Overpass, Roboto, sans-serif';
    g.fillText(new Date(ride.start).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ' · ' + OR.fmtDist(ride.dist || L) + (ride.moving ? ' in ' + OR.fmtTime(ride.moving) : ''), pad, pad + 72 * u, W - pad * 2);
    // progress along the ride
    const by = H - pad - 70 * u;
    g.fillStyle = 'rgba(15,18,20,.6)'; g.beginPath(); g.roundRect(pad, by, W - pad * 2, 56 * u, 14 * u); g.fill();
    g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(pad + 18 * u, by + 38 * u, W - pad * 2 - 36 * u, 6 * u);
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--yellow').trim() || '#ffd200'; g.fillRect(pad + 18 * u, by + 38 * u, (W - pad * 2 - 36 * u) * k, 6 * u);
    g.fillStyle = '#fff'; g.font = '800 ' + Math.round(22 * u) + 'px Overpass, Roboto, sans-serif'; g.fillText(OR.fmtDist((ride.dist || L) * k), pad + 18 * u, by + 28 * u);
    g.textAlign = 'right'; g.font = '700 ' + Math.round(18 * u) + 'px Overpass, Roboto, sans-serif'; g.fillText('OpenRoad', W - pad - 18 * u, by + 28 * u);
    g.font = '500 ' + Math.round(13 * u) + 'px Overpass, Roboto, sans-serif'; g.fillStyle = 'rgba(255,255,255,.8)'; g.fillText('Map © OpenStreetMap contributors · terrain: AWS Terrain Tiles', W - pad, H - 10 * u);
    g.restore();
  }
  async function save(blob, name) {
    const A = OR.native;
    if (A && A.videoOpen) {
      const id = A.videoOpen(name, 'video/mp4'); if (!id) throw new Error('couldn\'t save to the phone');
      const buf = new Uint8Array(await blob.arrayBuffer());
      for (let i = 0; i < buf.length; i += 512 * 1024) { let s = ''; const ch = buf.subarray(i, i + 512 * 1024); for (let j = 0; j < ch.length; j += 8192) s += String.fromCharCode.apply(null, ch.subarray(j, j + 8192)); A.videoChunk(id, btoa(s)); }
      OR.toast(A.videoClose(id, true) || 'Saved', 6000);
    } else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); OR.toast('Saved: ' + name); }
  }
})(window.OR);
