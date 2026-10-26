/* Riding rules for the countries OpenRoad routes through. Checked against official sources in October 2026
   (EU "Your Europe" road-rules pages, gov.uk, national vignette sites). Rules change: each country links to its source. */
'use strict';
(function (OR) {
  const YE = c => 'https://europa.eu/youreurope/citizens/travel/driving-abroad/road-rules-and-safety/' + c + '/index_en.htm';
  OR.RULES_CHECKED = 'October 2026';
  OR.RULES = {
    GB: { name: 'United Kingdom', flag: '🇬🇧', side: 'left', units: 'mph',
      limits: [['Built-up areas', '30 mph'], ['Single carriageways', '60 mph'], ['Dual carriageways and motorways', '70 mph']],
      must: ['Wear a motorcycle helmet that meets the safety standard (Sikhs wearing a turban are exempt)', 'Visors and goggles must meet the safety standard'],
      carry: [], know: ['Signs show limits in miles per hour'],
      src: 'https://www.gov.uk/guidance/the-highway-code/rules-for-motorcyclists-83-to-88' },
    IE: { name: 'Ireland', flag: '🇮🇪', side: 'left', units: 'km/h',
      limits: [['Towns', '50 km/h'], ['Regional and local roads', 'as signed (many were lowered in 2025)'], ['National roads', '100 km/h unless signed'], ['Motorways', '120 km/h']],
      must: ['Wear a motorcycle helmet'], carry: [], know: ['Speed limits are in km/h, not mph', 'Many rural speed limits were cut in 2025: follow the signs'],
      src: YE('ireland') },
    FR: { name: 'France', flag: '🇫🇷', side: 'right', units: 'km/h',
      limits: [['Towns', '50 km/h'], ['Other roads', '80 km/h (90 where signed)'], ['Dual carriageways', '110 km/h, 100 in rain'], ['Motorways', '130 km/h, 110 in rain'], ['Visibility under 50 m', '50 km/h everywhere']],
      must: ['Certified motorcycle gloves for rider and passenger', 'Helmet with reflective stickers on the front, back and both sides', 'Dipped headlights on'],
      carry: ['A reflective (hi-vis) vest, to wear if you break down or stop at an accident', 'A breathalyser is officially required, though there is no fine for not having one'],
      know: ['Earphones and headphones are banned while riding: check your helmet intercom is allowed before relying on it', 'Speed camera detectors and apps that warn of camera locations are illegal (OpenRoad doesn\'t warn here)',
        'Some cities have low-emission zones that need a Crit\'Air sticker for motorbikes too: check certificat-air.gouv.fr before you go', 'Motorway tolls: motorbikes pay a lower class than cars'],
      src: YE('france') },
    BE: { name: 'Belgium', flag: '🇧🇪', side: 'right', units: 'km/h',
      limits: [['Towns', '50 km/h (30 in Brussels)'], ['Other roads', '70 km/h in Flanders, 90 in Wallonia'], ['Motorways', '120 km/h']],
      must: ['Gloves, a long-sleeved jacket, long trousers and boots that cover the ankles, for rider and passenger', 'A motorcycle helmet'],
      carry: ['A reflective vest, worn if you\'re outside a broken-down vehicle on a motorway'],
      know: ['Filtering between queues is allowed up to 50 km/h and no more than 20 km/h faster than the traffic; on motorways only between the two left-hand lanes',
        'Low-emission zones (Brussels, Antwerp, Ghent): you may need to register before entering'],
      src: YE('belgium') },
    NL: { name: 'Netherlands', flag: '🇳🇱', side: 'right', units: 'km/h',
      limits: [['Towns', '50 km/h'], ['Other roads', '80 km/h'], ['Motorways', '100 km/h from 06:00 to 19:00, up to 130 at night where signed']],
      must: ['A motorcycle helmet'], carry: [], know: ['Hand-held phones are banned: hands-free only'],
      src: YE('netherlands') },
    LU: { name: 'Luxembourg', flag: '🇱🇺', side: 'right', units: 'km/h',
      limits: [['Towns', '50 km/h'], ['Other roads', '90 km/h'], ['Motorways', '130 km/h, 110 in rain']],
      must: ['A motorcycle helmet'], carry: [], know: ['Cheap fuel: a good place to fill up'],
      src: YE('luxembourg') },
    DE: { name: 'Germany', flag: '🇩🇪', side: 'right', units: 'km/h',
      limits: [['Towns', '50 km/h'], ['Other roads', '100 km/h'], ['Motorways', '130 km/h recommended, follow any signed limit']],
      must: ['A motorcycle helmet'], carry: [],
      know: ['Speed camera detectors and camera-warning apps are illegal while riding (OpenRoad doesn\'t warn here)', 'Under-21s and new riders: zero alcohol'],
      src: YE('germany') },
    CH: { name: 'Switzerland', flag: '🇨🇭', side: 'right', units: 'km/h',
      limits: [['Towns', '50 km/h'], ['Other roads', '80 km/h'], ['Expressways', '100 km/h'], ['Motorways', '120 km/h']],
      must: ['A motorway vignette for motorbikes too (buy the e-vignette before you go)', 'Dipped headlights on, day and night'],
      carry: [], know: ['Speed camera detectors are illegal', 'Speeding fines are high and based on how far over the limit you are'],
      src: 'https://www.e-vignette.ch' },
    AT: { name: 'Austria', flag: '🇦🇹', side: 'right', units: 'km/h',
      limits: [['Towns', '50 km/h'], ['Other roads', '100 km/h'], ['Motorways', '130 km/h']],
      must: ['A motorbike motorway vignette (digital or sticker)', 'A motorcycle helmet'], carry: [], know: ['Some Alpine passes have their own tolls'],
      src: 'https://www.asfinag.at/en/toll/vignette/' }
  };
  // things every UK rider taking a bike abroad needs, whichever country
  OR.ABROAD = ['UK identifier: a UK sticker, or UK on your number plate', 'Your full driving licence (and its photocard)', 'The bike\'s V5C log book', 'Insurance that covers you abroad, and breakdown cover for Europe', 'A GHIC or EHIC card, and travel insurance'];

  // Which countries the route passes through, from place lookups along it (needs a signal)
  OR.routeCountries = async function (route) {
    const n = Math.min(14, Math.max(2, Math.ceil(route.dist / 40000)));
    const pts = []; for (let i = 0; i <= n; i++) pts.push(route.shape[Math.min(route.shape.length - 1, Math.round(i * (route.shape.length - 1) / n))]);
    const codes = [];
    await Promise.all(pts.map(async (p, i) => {
      try {
        const j = await OR.json('https://photon.komoot.io/reverse?lon=' + p[0] + '&lat=' + p[1] + '&limit=1');
        const c = j.features && j.features[0] && j.features[0].properties && j.features[0].properties.countrycode;
        if (c) codes[i] = c.toUpperCase();
      } catch (e) { }
    }));
    const out = []; codes.forEach(c => { if (c && out.indexOf(c) < 0) out.push(c); });
    return out;
  };
})(window.OR);
