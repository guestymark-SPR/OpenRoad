#!/usr/bin/env bash
# Builds the app's assets: the OpenRoad web app, the map engine and label fonts, so it starts with no signal.
set -eu
A=app/src/main/assets
rm -rf $A && mkdir -p $A
cp -r ../web/. $A/
rm -rf $A/vendor && mkdir -p $A/vendor

# the Overpass typeface (SIL Open Font Licence), so the app looks right with no signal
mkdir -p $A/fonts && : > $A/fonts.css
for sub in latin latin-ext; do for w in 400 600 700 800; do
  f="overpass-$sub-$w-normal.woff2"
  if curl -fsSL "https://cdn.jsdelivr.net/npm/@fontsource/overpass@5/files/$f" -o "$A/fonts/$f"; then
    r=$([ $sub = latin ] && echo "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" || echo "U+0100-02AF,U+0304,U+0308,U+0329,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF")
    echo "@font-face{font-family:'Overpass';font-style:normal;font-weight:$w;font-display:swap;src:url(fonts/$f) format('woff2');unicode-range:$r}" >> $A/fonts.css
  else echo "warning: could not fetch $f"; fi
done; done
curl -fsSL -o $A/fonts/OFL.txt "https://cdn.jsdelivr.net/npm/@fontsource/overpass@5/LICENSE" || true

ML=5.24.0
curl -fsSL -o /tmp/ml.zip "https://github.com/maplibre/maplibre-gl-js/releases/download/v$ML/dist.zip"
unzip -q -o /tmp/ml.zip -d /tmp/ml
cp /tmp/ml/dist/maplibre-gl.js /tmp/ml/dist/maplibre-gl.css $A/vendor/

# label fonts (Latin, Greek and Cyrillic ranges cover the UK and Europe)
mkdir -p /tmp/fonts && curl -fsSL -o /tmp/fonts/f.zip https://github.com/openmaptiles/fonts/releases/download/v2.0/v2.0.zip
(cd /tmp/fonts && unzip -q -o f.zip)
for fam in "Noto Sans Regular" "Noto Sans Bold" "Noto Sans Italic"; do
  mkdir -p "$A/glyphs/$fam"
  for s in $(seq 0 256 8960); do
    r="$s-$((s+255))"
    src=$(find /tmp/fonts -path "*/$fam/$r.pbf" | head -1)
    [ -n "$src" ] && cp "$src" "$A/glyphs/$fam/$r.pbf"
  done
  test -s "$A/glyphs/$fam/0-255.pbf"
done
du -sh $A $A/glyphs
test -s $A/vendor/maplibre-gl.js
test -s $A/index.html
