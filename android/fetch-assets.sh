#!/usr/bin/env bash
# Builds the app's assets: the OpenRoad web app, the map engine and label fonts, so it starts with no signal.
set -eu
A=app/src/main/assets
rm -rf $A && mkdir -p $A
cp -r ../web/. $A/
rm -rf $A/vendor && mkdir -p $A/vendor

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
