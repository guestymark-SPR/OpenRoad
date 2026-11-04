/* OpenRoad backup and restore: Settings, Back up. Saves your rides, routes, trips, bike, settings and keys to one file
   (in Downloads), and restores them on a new phone. Photos (documents wallet, bike photo, trip diary) and downloaded
   maps are not in the file: they are too big. Keep the file private, it holds your keys. */
'use strict';
(function (OR) {
  const A = OR.native;
  const SKIP = /^(jn9_|inc_|gtrackNow$|rideInProgress$|recentPlaces$|wxcache|tile)/;
  function keys() {
    if (A && A.kvKeys) { try { return JSON.parse(A.kvKeys()).filter(k => k.startsWith('or_')).map(k => k.slice(3)); } catch (e) { return []; } }
    const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('or_')) out.push(k.slice(3)); } } catch (e) { }
    return out;
  }
  OR.backupData = function () {
    const data = {}; let n = 0;
    keys().forEach(k => { if (SKIP.test(k)) return; const v = OR.store.get(k, undefined); if (v !== undefined) { data[k] = v; n++; } });
    return { app: 'OpenRoad', format: 1, when: new Date().toISOString(), items: n, data };
  };
  OR.restoreData = function (b) {
    if (!b || b.app !== 'OpenRoad' || !b.data || typeof b.data !== 'object') throw new Error('That is not an OpenRoad backup file');
    let n = 0; Object.keys(b.data).forEach(k => { if (/^[A-Za-z0-9_.-]{1,80}$/.test(k) && !SKIP.test(k)) { OR.store.set(k, b.data[k]); n++; } });
    return n;
  };
  OR.backupSheet = function () {
    OR.sheet('<h2>' + OR.ic('save') + 'Back up and restore</h2>' +
      '<p class="small">One file with your rides, saved routes, trips, bike, settings and keys. Use it to move to a new phone, or keep a copy safe.</p>' +
      '<button class="btn go wide" id="bkMake">' + OR.ic('save') + 'Back up now</button>' +
      '<label class="btn wide file">' + OR.ic('dl') + 'Restore from a backup file<input type="file" id="bkIn" accept=".json,application/json,*/*" hidden></label>' +
      '<p class="small muted">Not included: photos (documents wallet, bike photo, trip diary photos) and downloaded maps. The file holds your keys (TomTom, AI planner), so keep it private.</p>', b => {
      b.querySelector('#bkMake').onclick = () => { const d = OR.backupData(), day = new Date().toISOString().slice(0, 10); OR.saveFile('OpenRoad-backup-' + day + '.json', JSON.stringify(d), 'application/json'); };
      b.querySelector('#bkIn').onchange = e => {
        const f = e.target.files[0]; if (!f) return;
        f.text().then(t => {
          const d = JSON.parse(t); if (!d || d.app !== 'OpenRoad') throw new Error('That is not an OpenRoad backup file');
          const n = Object.keys(d.data || {}).length, when = d.when ? new Date(d.when).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'an earlier date';
          OR.sheet('<h2>Restore this backup?</h2><p>' + n + ' items saved on ' + when + '. They replace the same things on this phone (rides, routes, trips, settings). Anything not in the file is left alone.</p>' +
            '<button class="btn go wide" id="bkYes">Restore</button><button class="btn wide ghost" id="bkNo">Cancel</button>', c => {
            c.querySelector('#bkNo').onclick = () => OR.closeSheet();
            c.querySelector('#bkYes').onclick = () => { try { const k = OR.restoreData(d); OR.toast('Restored ' + k + ' items. Restarting…', 3000); setTimeout(() => location.reload(), 1200); } catch (x) { OR.toast(x.message, 5000); } };
          });
        }).catch(err => OR.toast('Could not read that file: ' + err.message, 5000));
      };
    });
  };
})(window.OR);
