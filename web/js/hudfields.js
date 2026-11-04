/* OpenRoad ride screen fields: choose what the three big numbers at the bottom of the ride screen show
   (Settings, Ride screen). Left alone, they are speed, distance to go and arrival time as before. */
'use strict';
(function (OR) {
  const $ = s => document.querySelector(s);
  const DEFAULT = ['speed', 'remain', 'eta'];
  let last = null; OR.rideState = () => last && !last.free ? last : null;
  OR.on('ridestart', () => { last = null; });
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const F = {
    speed: { name: 'Speed', v: () => [OR.speed(OR.pos && OR.pos.speed) || 0, OR.speedUnit()] },
    remain: { name: 'Distance to go', v: () => { const s = OR.rideState && OR.rideState(); return [s && s.remain != null ? OR.fmtDist(s.remain) : OR.fmtDist(OR.ride.dist), s && s.remain != null ? 'to go' : 'ridden']; } },
    eta: { name: 'Arrival time', v: () => { const s = OR.rideState && OR.rideState(); return s && s.eta ? [OR.clock(s.eta), 'arrive'] : [OR.fmtTime((Date.now() - OR.ride.start) / 1000), 'riding for']; } },
    left: { name: 'Time left', v: () => { const s = OR.rideState && OR.rideState(); return s && s.eta ? [OR.fmtTime(Math.max(0, (s.eta - Date.now()) / 1000)), 'left'] : ['–', 'left']; } },
    clock: { name: 'Clock', v: () => [OR.clock(new Date()), 'time now'] },
    dist: { name: 'Ridden so far', v: () => [OR.fmtDist(OR.ride.dist), 'ridden'] },
    elapsed: { name: 'Time on the bike', v: () => [OR.fmtTime((Date.now() - OR.ride.start) / 1000), 'riding for'] },
    moving: { name: 'Moving time', v: () => [OR.fmtTime(OR.ride.moving), 'moving'] },
    avg: { name: 'Average speed', v: () => [OR.ride.moving > 30 ? OR.speed(OR.ride.dist / OR.ride.moving) : '–', OR.speedUnit() + ' avg'] },
    max: { name: 'Top speed', v: () => [OR.speed(OR.ride.max) || 0, OR.speedUnit() + ' top'] },
    heading: { name: 'Heading', v: () => { const h = OR.pos && OR.pos.heading; return h == null || isNaN(h) ? ['–', 'heading'] : [dirs[Math.round(h / 45) % 8], Math.round(h) + '°']; } },
    fuel: { name: 'Fuel range left', v: () => { const l = OR.fuelLeft && OR.fuelLeft(); return [l == null ? '–' : OR.fmtDist(l), 'fuel range']; } }
  };
  OR.HUD_FIELDS = F;
  const cur = () => { const a = OR.cfg.hudFields; return Array.isArray(a) && a.length === 3 && a.every(k => F[k]) ? a : DEFAULT; };
  const slots = [['#hSpeed', '#hSpeedU'], ['#hRemain', '#hRemainL'], ['#hEta', '#hEtaL']];

  function apply() {
    if (!OR.ride || !OR.ride.on) return;
    const c = cur(); if (c.join() === DEFAULT.join()) return;
    c.forEach((k, i) => {
      if (k === DEFAULT[i]) return;
      const a = $(slots[i][0]), b = $(slots[i][1]); if (!a || !b) return;
      const r = F[k].v(); a.textContent = r[0]; b.textContent = r[1];
    });
  }
  const later = () => setTimeout(apply, 0);
  OR.on('ride', s => { last = s; later(); }); OR.on('fix', later);
  setInterval(apply, 1000);

  OR.hudFieldsSheet = function () {
    const c = cur(), lab = ['Left', 'Middle', 'Right'];
    OR.sheet('<h2>Ride screen numbers</h2><p class="small">Choose what the three big numbers at the bottom of the ride screen show.</p>' +
      [0, 1, 2].map(i => '<label class="f"><span>' + lab[i] + '</span><select data-i="' + i + '">' + Object.keys(F).map(k => '<option value="' + k + '"' + (c[i] === k ? ' selected' : '') + '>' + F[k].name + '</option>').join('') + '</select></label>').join('') +
      '<button class="btn wide" id="hfReset">Back to the usual three</button>', b => {
      const save = () => { OR.cfg.hudFields = Array.from(b.querySelectorAll('select')).map(s => s.value); OR.saveCfg(); };
      b.querySelectorAll('select').forEach(s => s.onchange = () => { save(); OR.toast('Saved'); });
      b.querySelector('#hfReset').onclick = () => { delete OR.cfg.hudFields; OR.saveCfg(); OR.closeSheet(); OR.toast('Back to the usual numbers'); };
    });
  };
})(window.OR);
