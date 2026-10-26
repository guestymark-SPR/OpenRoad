/* OpenRoad offline maps: country map packs (Android app) and saving the map along a route. */
'use strict';
(function (OR) {
  const A = OR.native;
  OR.PACKS_URL = 'https://github.com/guestymark-SPR/OpenRoad/releases/download/maps/packs.json';

  OR.packs = {
    installed() { try { return A && A.mapPacks ? JSON.parse(A.mapPacks()) : []; } catch (e) { return []; } },
    catalogue() { return OR.json(OR.PACKS_URL + '?t=' + Math.floor(Date.now() / 600000)).then(j => j.packs || []); },
    download(p) { if (A && A.packDownload) A.packDownload(p.id, p.url); },
    del(id) { if (A && A.packDelete) A.packDelete(id); }
  };
  window.onPackProgress = (id, done, total, state) => OR.emit('pack', { id, done, total, state });

  // Tiles covering a band either side of the route, zoom 6 to 14, so the map works with no signal on that ride.
  const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * (1 << z));
  const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * (1 << z)); };
  OR.corridorTiles = function (shape) {
    const set = new Set(), pts = OR.resample(shape, 800);
    for (let z = 6; z <= 14; z++) {
      const pad = z >= 13 ? 1 : 0;
      for (const p of pts) {
        const x = lon2x(p[0], z), y = lat2y(p[1], z);
        for (let dx = -pad; dx <= pad; dx++) for (let dy = -pad; dy <= pad; dy++) set.add(z + '/' + (x + dx) + '/' + (y + dy));
      }
    }
    return Array.from(set);
  };
  OR.saveRouteMap = function (route) {
    if (!A || !A.saveTiles) { OR.toast('Saving the map for offline use works in the Android app'); return; }
    const tiles = OR.corridorTiles(route.shape);
    A.saveTiles(JSON.stringify(tiles));
    OR.toast('Saving ' + tiles.length + ' map tiles along the route…', 5000);
  };
  window.onTilesProgress = (done, total, failed) => OR.emit('tiles', { done, total, failed });
  OR.cacheInfo = () => { try { return A && A.cacheInfo ? JSON.parse(A.cacheInfo()) : null; } catch (e) { return null; } };
})(window.OR);
