/* OpenRoad empty-state pictures: a small scene (hills, a winding road, the sun) with a prop for what the page is about. */
'use strict';
(function (OR) {
  const PROPS = {
    plan: '<path d="M100 20c-8 0-14 6-14 14 0 10 14 26 14 26s14-16 14-26c0-8-6-14-14-14z" fill="#e53935"/><circle cx="100" cy="34" r="5" fill="#fff"/>',
    trips: '<rect x="82" y="30" width="36" height="26" rx="5" fill="#8d5a2b"/><rect x="92" y="24" width="16" height="8" rx="3" fill="none" stroke="#8d5a2b" stroke-width="3"/><rect x="82" y="40" width="36" height="4" fill="#f5c518"/>',
    save: '<path d="M88 22h24a4 4 0 0 1 4 4v34l-16-9-16 9V26a4 4 0 0 1 4-4z" fill="#1565c0"/><path d="M96 34l4 4 8-9" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
    rides: '<g transform="translate(78 28)"><circle cx="8" cy="22" r="8" fill="none" stroke="#1c2226" stroke-width="3"/><circle cx="38" cy="22" r="8" fill="none" stroke="#1c2226" stroke-width="3"/><path d="M8 22l10-12h14l6 12M18 10l4-6h8M14 22h20" fill="none" stroke="#0b6b3a" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></g>'
  };
  OR.art = kind => '<svg class="art" viewBox="0 0 200 120" aria-hidden="true">' +
    '<circle cx="158" cy="30" r="15" fill="#f5c518" opacity=".9"/>' +
    '<path d="M0 82c30-26 52-18 78-4 26 14 46 12 66-6 18-16 38-10 56 2v46H0z" fill="var(--green-2)" opacity=".28"/>' +
    '<path d="M0 96c36-20 60-8 90 2 30 10 70 4 110-14v36H0z" fill="var(--green-2)" opacity=".5"/>' +
    '<path d="M62 120c30-10 8-24 38-30s52 6 70-8" fill="none" stroke="var(--ink-3)" stroke-width="13" stroke-linecap="round" opacity=".55"/>' +
    '<path d="M62 120c30-10 8-24 38-30s52 6 70-8" fill="none" stroke="#f5c518" stroke-width="2.2" stroke-dasharray="6 7" stroke-linecap="round"/>' +
    (PROPS[kind] || PROPS.plan) + '</svg>';
})(window.OR);
