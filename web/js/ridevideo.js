/* OpenRoad helmet-cam overlay: line up a video (GoPro, Insta360, phone) with a recorded ride and make a copy with
   your speed, lean, distance, the time and a little map of the ride drawn on top.
   The video's start time comes from the file itself (the "created" time inside the MP4). GoPro and some other
   cameras store local time there rather than UTC, so both readings are tried, and you can nudge the timing by hand.
   Making the copy plays the video through once at normal speed, so a 10 minute clip takes about 10 minutes. */
'use strict';
(function (OR) {
  const $ = OR.$, esc = OR.esc, ic = (n, c) => OR.ic(n, c), G = 9.81;
  const N = () => OR.native;

  // ---------- reading when the video was made (MP4 / MOV "mvhd" box) ----------
  async function bytes(file, at, n) { return new Uint8Array(await file.slice(at, at + n).arrayBuffer()); }
  const u32 = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  OR.videoTimes = async function (file) {
    let at = 0;
    while (at < file.size) {
      const h = await bytes(file, at, 16); if (h.length < 8) break;
      let size = u32(h, 0); const type = String.fromCharCode(h[4], h[5], h[6], h[7]);
      let head = 8; if (size === 1) { size = u32(h, 8) * 4294967296 + u32(h, 12); head = 16; } else if (size === 0) size = file.size - at;
      if (type === 'moov') {
        const m = await bytes(file, at + head, Math.min(size - head, 64 * 1024 * 1024));
        for (let i = 0; i + 8 < m.length; i++) {
          if (m[i + 4] === 0x6d && m[i + 5] === 0x76 && m[i + 6] === 0x68 && m[i + 7] === 0x64) { // 'mvhd'
            const v = m[i + 8], o = i + 12;
            const created = v === 1 ? u32(m, o) * 4294967296 + u32(m, o + 4) : u32(m, o);
            const scale = v === 1 ? u32(m, o + 16) : u32(m, o + 8), dur = v === 1 ? u32(m, o + 20) * 4294967296 + u32(m, o + 24) : u32(m, o + 12);
            const ms = (created - 2082844800) * 1000; // seconds since 1904
            return { created: created ? new Date(ms) : null, duration: scale ? dur / scale : null };
          }
        }
        return { created: null, duration: null };
      }
      if (size < 8) break;
      at += size;
    }
    return { created: null, duration: null };
  };
  // the start time that puts the video inside the ride: as stored, or read as local time
  OR.videoStart = function (vt, ride, lastModified) {
    const r0 = ride.t0, r1 = OR.rides.times(ride).slice(-1)[0], cands = [];
    if (vt.created) { cands.push({ t: vt.created.getTime(), how: 'from the video file' }); cands.push({ t: vt.created.getTime() + vt.created.getTimezoneOffset() * 60000, how: 'from the video file (camera on local time)' }); }
    if (lastModified && vt.duration) cands.push({ t: lastModified - vt.duration * 1000, how: 'from when the file was saved' });
    const fits = c => c.t + (vt.duration || 0) * 1000 > r0 && c.t < r1;
    return cands.find(fits) || cands[0] || { t: r0, how: 'not found: set it by hand' };
  };

  // ---------- the ride at any moment ----------
  function telemetry(ride) {
    const pts = OR.rides.pts(ride), times = OR.rides.times(ride), cum = OR.cumulative(pts);
    const lean = pts.map((_, i) => {
      if (i < 2) return 0; const dt = (times[i] - times[i - 1]) / 1000; if (dt <= 0) return 0;
      const a = ((OR.bearing(pts[i - 1], pts[i]) - OR.bearing(pts[i - 2], pts[i - 1]) + 540) % 360) - 180, v = OR.dist(pts[i - 1], pts[i]) / dt;
      return Math.max(-55, Math.min(55, Math.atan(v * (a * Math.PI / 180 / dt) / G) * 180 / Math.PI));
    });
    const at = t => {
      if (t <= times[0]) return { p: pts[0], v: 0, lean: 0, d: 0, before: true };
      let lo = 0, hi = times.length - 1; if (t >= times[hi]) return { p: pts[hi], v: 0, lean: 0, d: cum[hi], after: true };
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m; else hi = m; }
      const k = (t - times[lo]) / Math.max(1, times[hi] - times[lo]);
      let j = lo; while (j > 0 && times[lo] - times[j] < 4000) j--;
      const v = times[hi] > times[j] ? (cum[hi] - cum[j]) / ((times[hi] - times[j]) / 1000) : 0;
      return { p: [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * k, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * k], v, lean: lean[lo] + (lean[hi] - lean[lo]) * k, d: cum[lo] + (cum[hi] - cum[lo]) * k, i: lo };
    };
    return { pts, times, cum, at, box: OR.bbox(pts) };
  }

  // ---------- drawing the overlay ----------
  function drawOverlay(g, W, H, T, t) {
    const s = T.at(t), u = H / 720, pad = 24 * u;
    g.save();
    g.font = '700 ' + Math.round(22 * u) + 'px Overpass, Roboto, sans-serif'; g.textBaseline = 'alphabetic';
    const panel = (x, y, w, h) => { g.fillStyle = 'rgba(15,18,20,.55)'; g.beginPath(); g.roundRect(x, y, w, h, 16 * u); g.fill(); };
    // speed
    const sp = OR.speed(s.v) || 0, pw = 220 * u, ph = 130 * u, py = H - ph - pad;
    panel(pad, py, pw, ph);
    g.fillStyle = '#fff'; g.font = '800 ' + Math.round(76 * u) + 'px Overpass, Roboto, sans-serif'; g.fillText(String(sp), pad + 18 * u, py + 88 * u);
    g.font = '700 ' + Math.round(24 * u) + 'px Overpass, Roboto, sans-serif'; g.fillText(OR.speedUnit(), pad + 18 * u, py + 118 * u);
    // lean gauge
    const lx = pad + pw + 14 * u, lw = 170 * u; panel(lx, py, lw, ph);
    const cx = lx + lw / 2, cy = py + 100 * u, rr = 62 * u, ang = (s.lean || 0) * Math.PI / 180;
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 6 * u; g.beginPath(); g.arc(cx, cy, rr, Math.PI * 1.17, Math.PI * 1.83); g.stroke();
    g.strokeStyle = Math.abs(s.lean) > 35 ? '#ff7043' : Math.abs(s.lean) > 20 ? '#ffd200' : '#7bd88f'; g.lineWidth = 8 * u; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(ang) * rr, cy - Math.cos(ang) * rr); g.stroke();
    g.fillStyle = '#fff'; g.font = '800 ' + Math.round(26 * u) + 'px Overpass, Roboto, sans-serif'; g.textAlign = 'center'; g.fillText(Math.round(Math.abs(s.lean)) + '°', cx, py + 34 * u); g.textAlign = 'left';
    // distance and time
    const tx = W - pad - 250 * u; panel(tx, py, 250 * u, ph);
    g.font = '800 ' + Math.round(34 * u) + 'px Overpass, Roboto, sans-serif'; g.fillText(OR.fmtDist(s.d), tx + 18 * u, py + 54 * u);
    g.font = '700 ' + Math.round(26 * u) + 'px Overpass, Roboto, sans-serif'; g.fillText(new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), tx + 18 * u, py + 100 * u);
    // little map of the ride, with where you are
    const mw = 230 * u, mh = 170 * u, mx = W - pad - mw, my = pad; panel(mx, my, mw, mh);
    const b = T.box, lat0 = (b[0][1] + b[1][1]) / 2, kx = Math.cos(lat0 * Math.PI / 180);
    const sx = (mw - 24 * u) / Math.max(1e-9, (b[1][0] - b[0][0]) * kx), sy = (mh - 24 * u) / Math.max(1e-9, b[1][1] - b[0][1]), sc = Math.min(sx, sy);
    const ox = mx + mw / 2 - ((b[0][0] + b[1][0]) / 2) * kx * sc, oy = my + mh / 2 + ((b[0][1] + b[1][1]) / 2) * sc;
    const P = q => [ox + q[0] * kx * sc, oy - q[1] * sc];
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 3 * u; g.beginPath(); T.pts.forEach((q, i) => { const [x, y] = P(q); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
    if (s.i != null) { g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--yellow').trim() || '#ffd200'; g.lineWidth = 4 * u; g.beginPath(); for (let i = 0; i <= s.i; i++) { const [x, y] = P(T.pts[i]); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
    const [dx, dy] = P(s.p); g.fillStyle = '#fff'; g.beginPath(); g.arc(dx, dy, 7 * u, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#e53935'; g.lineWidth = 3 * u; g.stroke();
    g.restore();
  }
  OR.drawRideOverlay = drawOverlay;

  // ---------- the screen ----------
  OR.rideVideo = function (ride) {
    const T = telemetry(ride);
    if (T.pts.length < 10) return OR.toast('This ride has too few points for an overlay');
    OR.sheet('<h2>' + ic('cam') + 'Helmet-cam video</h2><p class="small">Pick a video from this ride. OpenRoad lines it up by the time it was filmed and draws your speed, lean, distance, the time and a map of the ride on a copy of it. The original isn\'t changed.</p>' +
      '<label class="btn wide pri file">' + ic('cam') + 'Choose a video<input type="file" accept="video/*" hidden id="rvFile"></label><div id="rvBox"></div>', b => {
      $('#rvFile', b).onchange = e => { const f = e.target.files && e.target.files[0]; if (f) setup(ride, T, f, $('#rvBox', b)); };
    });
  };
  async function setup(ride, T, file, box) {
    box.innerHTML = '<p class="small muted">Reading the video…</p>';
    let vt = { created: null, duration: null };
    try { vt = await OR.videoTimes(file); } catch (e) { }
    let st = OR.videoStart(vt, ride, file.lastModified);
    let start = st.t, offset = 0;
    const url = URL.createObjectURL(file);
    box.innerHTML = '<div class="rvprev"><video id="rvV" src="' + url + '" playsinline muted preload="metadata"></video><canvas id="rvC"></canvas></div>' +
      '<p class="small" id="rvWhen"></p>' +
      '<label class="f"><span>Nudge the timing (seconds): line the speed up with the video</span><input type="range" id="rvOff" min="-120" max="120" step="1" value="0"></label>' +
      '<div class="row"><button class="btn small" data-n="-3600">−1 h</button><button class="btn small" data-n="-60">−1 min</button><button class="btn small" data-n="60">+1 min</button><button class="btn small" data-n="3600">+1 h</button></div>' +
      '<button class="btn wide pri" id="rvGo">' + ic('dl') + 'Make the video with the overlay</button><p class="small muted" id="rvMsg">It plays through once at normal speed while it\'s made. Keep OpenRoad open until it\'s done.</p>';
    const v = $('#rvV', box), c = $('#rvC', box), g = c.getContext('2d');
    const when = () => { const s = new Date(start + offset * 1000), e = new Date(start + offset * 1000 + (v.duration || vt.duration || 0) * 1000); $('#rvWhen', box).textContent = 'Filmed ' + s.toLocaleTimeString('en-GB') + ' to ' + e.toLocaleTimeString('en-GB') + ' (' + st.how + ').' + (e < T.times[0] || s > T.times[T.times.length - 1] ? ' That\'s outside this ride: adjust it, or pick another video.' : ''); };
    const preview = () => { const W = c.width = 640, H = c.height = 360; g.clearRect(0, 0, W, H); try { g.drawImage(v, 0, 0, W, H); } catch (e) { } drawOverlay(g, W, H, T, start + (offset + (v.currentTime || 0)) * 1000); };
    v.addEventListener('loadeddata', () => { v.currentTime = Math.min(5, (v.duration || 10) / 3); });
    v.addEventListener('seeked', preview);
    v.addEventListener('loadedmetadata', () => { if (!vt.duration && v.duration) { vt.duration = v.duration; st = OR.videoStart(vt, ride, file.lastModified); start = st.t; } when(); });
    $('#rvOff', box).oninput = e => { offset = +e.target.value; when(); preview(); };
    box.querySelectorAll('[data-n]').forEach(x => x.onclick = () => { start += (+x.dataset.n) * 1000; when(); preview(); });
    $('#rvGo', box).onclick = () => render(file, v, T, start + offset * 1000, $('#rvMsg', box), $('#rvGo', box));
    when();
  }

  // ---------- making the copy ----------
  function pickType() {
    const list = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    return list.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
  }
  async function render(file, pv, T, t0, msg, btn) {
    if (!window.MediaRecorder) return OR.toast('This phone can\'t record video here');
    btn.disabled = true;
    const type = pickType();
    const v = document.createElement('video'); v.src = pv.src; v.playsInline = true; v.preload = 'auto'; v.muted = false;
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('this video format can\'t be read here')); }).catch(e => { msg.textContent = 'Couldn\'t open the video: ' + e.message; btn.disabled = false; throw e; });
    const sc = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight)), W = Math.round(v.videoWidth * sc / 2) * 2, H = Math.round(v.videoHeight * sc / 2) * 2;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const stream = c.captureStream(30);
    try { const ac = new AudioContext(), src = ac.createMediaElementSource(v), dst = ac.createMediaStreamDestination(); src.connect(dst); dst.stream.getAudioTracks().forEach(tr => stream.addTrack(tr)); } catch (e) { v.muted = true; } // no sound if the phone won't share it
    const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 6e6 } : { videoBitsPerSecond: 6e6 });
    const A = N(), native = !!(A && A.videoOpen);
    let id = null, name = '', mime = '';
    const parts = []; let queue = Promise.resolve();
    rec.ondataavailable = e => {
      if (!e.data || !e.data.size) return;
      if (!native) { parts.push(e.data); return; }
      queue = queue.then(async () => { const buf = new Uint8Array(await e.data.arrayBuffer()); for (let i = 0; i < buf.length; i += 512 * 1024) { let s = ''; const ch = buf.subarray(i, i + 512 * 1024); for (let j = 0; j < ch.length; j += 8192) s += String.fromCharCode.apply(null, ch.subarray(j, j + 8192)); A.videoChunk(id, btoa(s)); } });
    };
    const done = new Promise(res => { rec.onstop = res; });
    const frame = () => {
      g.drawImage(v, 0, 0, W, H); drawOverlay(g, W, H, T, t0 + v.currentTime * 1000);
      msg.textContent = 'Making it: ' + Math.round(100 * v.currentTime / (v.duration || 1)) + '%';
      if (!v.ended) (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(frame) : requestAnimationFrame(frame));
    };
    v.onended = () => setTimeout(() => rec.stop(), 300);
    rec.start(1000); if (A && A.keepScreenOn) A.keepScreenOn(true);
    // what the phone actually records (it may not do MP4)
    mime = (rec.mimeType || type || 'video/webm').split(';')[0]; const ext = /mp4/.test(mime) ? 'mp4' : 'webm';
    name = OR.fileName('OpenRoad ' + new Date(t0).toLocaleDateString('en-GB').replace(/\//g, '-') + ' overlay') + '.' + ext;
    if (native) id = A.videoOpen(name, mime);
    try { await v.play(); } catch (e) { msg.textContent = 'Couldn\'t play the video: ' + e.message; rec.stop(); btn.disabled = false; return; }
    frame();
    await done; await queue; if (A && A.keepScreenOn && !(OR.ride && OR.ride.on)) A.keepScreenOn(false);
    if (native) { const r = A.videoClose(id, true); msg.textContent = r || 'Saved'; }
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(parts, { type: mime })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); msg.textContent = 'Saved: ' + name; }
    btn.disabled = false;
  }
})(window.OR);
