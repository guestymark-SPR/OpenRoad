/* OpenRoad automatic recording: with the app open (on the bike mount, say), setting off at riding speed starts a
   ride by itself, so none are lost to a forgotten button. If a route is planned and you're near its start, it
   navigates that route; otherwise it just records. A ride it started ends by itself once you've been parked
   for 15 minutes (a fuel or coffee stop is shorter than that). Turn it off in Settings. */
'use strict';
(function (OR) {
  const FAST = 6.7, NEED = 25000, PARKED = 15 * 60000, COOL = 10 * 60000;
  let since = 0, lastStop = 0, lastMove = 0, startedBy = null;
  OR.autoRecordOn = () => OR.cfg.autoRecord !== false;

  OR.on('ridestop', () => { lastStop = Date.now(); since = 0; startedBy = null; });
  OR.on('ridestart', () => { since = 0; lastMove = Date.now(); });

  OR.on('fix', p => {
    const now = p.t || Date.now();
    if (OR.ride.on) { if ((p.speed || 0) > 2) lastMove = now; return; }
    if (!OR.autoRecordOn() || p.rough || (p.acc || 99) > 50 || now - lastStop < COOL || document.hidden) { since = 0; return; }
    if (OR.recordingVideo || document.body.classList.contains('filming')) return;
    if ((p.speed || 0) < FAST) { since = 0; return; }
    if (!since) { since = now; return; }
    if (now - since < NEED) return;
    since = 0; start(p);
  });

  function start(p) {
    if (!OR.startRideUi || OR.ride.on) return;
    const r = OR.plan.route;
    const nearStart = r && r.shape && OR.dist([p.lng, p.lat], r.shape[0]) < 400;
    startedBy = 'auto';
    OR.startRideUi(nearStart ? r : null);
    OR.ride.auto = true;
    OR.toast(nearStart ? 'You\'re riding: following your planned route' : 'You\'re riding: recording this ride. Tap End if you\'re not on the bike', 6000);
    if (nearStart) OR.say('Riding detected. Following your route.');
  }

  // parked for a while after a ride it started: save it
  setInterval(() => {
    if (!OR.ride.on || startedBy !== 'auto' || document.hidden) return;
    if (OR.pullNativeTrack) OR.pullNativeTrack(); // points the ride service recorded with the screen off
    const still = !OR.pos || (OR.pos.speed || 0) < 1, moved = Math.max(lastMove, OR.ride.lastT || 0);
    if (still && moved && Date.now() - moved > PARKED) { OR.toast('Parked for 15 minutes: your ride is saved', 6000); OR.endRideUi(); }
  }, 30000);
})(window.OR);
