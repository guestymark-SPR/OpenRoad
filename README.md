# OpenRoad

Free motorbike navigation for the UK and Europe, built on open data. Sister app to [OpenHelm](https://github.com/guestymark-SPR/OpenHelm).

**Install on Android:** open the latest **OpenRoad** build under [Releases](../../releases) on your phone or tablet and tap the `.apk`. After that, the app tells you when there's an update.

## What it does

- **Route planner** with three riding styles: *Twisty roads*, *No motorways* and *Fastest*. Up to three options are shown with miles, time, a bendiness score and how much is motorway. Tap the map to add via points or stops; drag them to change the route.
- **Turn-by-turn ride mode**: big arrow and distance, spoken directions through your helmet headset (music is turned down while it speaks), automatic rerouting when you go off route, re-centre and overview.
- **GPX**: import routes and tracks (follow a track exactly, or plan through its points), export any route or ride.
- **Offline maps**: download country packs on Wi-Fi (Maps tab), or save the map along a planned route. Saved routes keep their directions with no signal.
- **Trip tools**: fuel range from tank size and mpg, fuel stations along a route with warnings for gaps too long for your range, low-fuel voice warning, places to stay, campsites, cafés and pubs nearby, ride log with season totals, ICE card.
- **Safety check-in**: set a time; if you don't tap "I'm OK", the phone alarms, then texts your contact your last position.

## Where the data comes from

| What | Service |
| --- | --- |
| Map tiles | [OpenFreeMap](https://openfreemap.org) (OpenMapTiles schema) |
| Routing and turn instructions | [Valhalla](https://github.com/valhalla/valhalla) motorcycle costing on the FOSSGIS public server |
| Place search | [Photon](https://photon.komoot.io) by Komoot |
| Fuel, stays, cafés | OpenStreetMap via the [Overpass API](https://overpass-api.de) |
| Offline packs | Built from [Geofabrik](https://download.geofabrik.de) extracts with [Planetiler](https://github.com/onthegomap/planetiler) |

Map data © OpenStreetMap contributors. Route planning and search need a signal; maps and saved routes work offline.

## Building

- `web/` is the app itself (plain HTML/JS/CSS with MapLibre GL). It also runs in a browser.
- `android/` wraps it for Android and adds offline maps, voice, screen-off recording, check-in texts and updates.
- **Build OpenRoad APK** workflow runs on every push to `main` and publishes a signed APK.
- **Build map packs** workflow (run it from the Actions tab) builds offline packs for the countries you list, e.g. `great-britain,france,belgium`. Countries over ~1.8 GB are split into parts automatically.

## Not yet

- iPhone app (the web version runs in Safari; a proper iOS app needs an Apple Developer account).
- Route planning with no signal (needs an on-device router).

Road data can be out of date. Follow road signs and the law.
