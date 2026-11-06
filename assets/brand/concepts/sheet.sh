#!/usr/bin/env bash
# Contact sheet: per variant, mark on light, on dark, then icon at 64/32/16.
set -euo pipefail
cd "$(dirname "$0")"
LIGHT='#f6efe4'; DARK='#16110d'; T=$(mktemp -d)
rows=()
for v in "$@"; do
  sed 's/color: #1b1410/color: #f6efe4/' "$v.svg" > "$T/$v-dark.svg"
  rsvg-convert -w 512 "$v.svg" -o "$T/$v-l.png"
  rsvg-convert -w 512 "$T/$v-dark.svg" -o "$T/$v-d.png"
  rsvg-convert -w 512 "$v-icon.svg" -o "$T/$v-i.png"
  magick "$T/$v-l.png" -background "$LIGHT" -flatten -resize 240x240 "$T/L.png"
  magick "$T/$v-d.png" -background "$DARK" -flatten -resize 240x240 "$T/D.png"
  for s in 64 32 16; do
    magick "$T/$v-i.png" -background "$LIGHT" -flatten -resize ${s}x${s} -background "$LIGHT" -gravity center -extent 120x240 "$T/S$s.png"
  done
  magick "$T/L.png" "$T/D.png" "$T/S64.png" "$T/S32.png" "$T/S16.png" +append -bordercolor '#b9ab98' -border 1 "$T/row-$v.png"
  rows+=("$T/row-$v.png")
done
magick "${rows[@]}" -append sheet.png
