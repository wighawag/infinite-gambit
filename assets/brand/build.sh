#!/usr/bin/env bash
# Regenerates every derived brand asset from the authored sources.
#   authored:  logo.svg, icon.svg, src/preview.src.svg, src/lockup.src.svg
#   generated: preview.svg, preview.png, lockup.svg, logo-light.svg, lockup-light.svg,
#              icon.png, icon-192.png, icon-512.png, favicon-32.png, and the copies in landing/brand + landing/fonts and web/
# Needs inkscape and magick. On NixOS: nix shell nixpkgs#inkscape -c ./build.sh
set -euo pipefail
cd "$(dirname "$0")"

# 1. Drift: the prism and the king must be the same geometry everywhere.
geom() { grep -o 'd="M128 4[^"]*"\|d="M101 55[^"]*"\|d="M74 98[^"]*"' "$1" | sort -u; }
for f in icon.svg src/preview.src.svg src/lockup.src.svg; do
	if [ "$(geom logo.svg)" != "$(geom "$f")" ]; then
		echo "error: mark geometry in $f has drifted from logo.svg" >&2
		diff <(geom logo.svg) <(geom "$f") >&2 || true
		exit 1
	fi
done

# 2. Fonts from the vendored directory only, so the build does not depend on the machine.
FC=$(mktemp -d)
cat > "$FC/fonts.conf" <<CONF
<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig><dir>$PWD/fonts</dir><cachedir>$FC/cache</cachedir></fontconfig>
CONF
export FONTCONFIG_FILE="$FC/fonts.conf"
command -v inkscape >/dev/null || { echo "error: inkscape not found" >&2; exit 1; }
echo "rasteriser: $(command -v inkscape)"

# 3. Text to outlines, so no consumer needs Cinzel installed.
inkscape src/preview.src.svg --export-text-to-path --export-plain-svg -o preview.svg >/dev/null 2>&1
inkscape src/lockup.src.svg --export-text-to-path --export-plain-svg -o lockup.svg >/dev/null 2>&1
# Inkscape resolves currentColor while outlining; put it back so one file serves light and dark.
sed -i 's/fill:#1b1410/fill:currentColor/g' lockup.svg
sed -i 's/fill:#f6efe4;/fill:currentColor;/g' preview.svg

# 4. Rasters, at 2x then downsampled.
inkscape preview.svg -o "$FC/preview@2x.png" -w 2560 >/dev/null 2>&1
magick "$FC/preview@2x.png" -resize 1280x640 -strip preview.png
inkscape icon.svg -o "$FC/icon@2x.png" -w 1024 >/dev/null 2>&1
magick "$FC/icon@2x.png" -resize 512x512 -strip icon-512.png
magick "$FC/icon@2x.png" -resize 512x512 -strip icon.png
magick "$FC/icon@2x.png" -resize 192x192 -strip icon-192.png
magick "$FC/icon@2x.png" -resize 32x32 -strip favicon-32.png
# 5. Light-ink variants for <img> on dark pages (an <img> cannot inherit currentColor).
sed 's/color: #1b1410/color: #f6efe4/' logo.svg > logo-light.svg
sed 's/color: #1b1410/color: #f6efe4/' lockup.svg > lockup-light.svg

# 6. The landing page ships its own copy, so landing/ deploys as one folder.
L=../../landing
mkdir -p "$L/brand" "$L/fonts"
cp logo-light.svg lockup-light.svg icon.svg favicon-32.png icon-192.png preview.png "$L/brand/"
cp fonts/Cinzel-VariableFont_wght.ttf fonts/OFL.txt "$L/fonts/"

# 7. The game's web app: the icon, social card and lockup it is configured with
#    (web/src/web-config.json), the mark its home page shows, and the heading font
#    (imported by the home page's CSS, so Vite fingerprints it and keeps the build
#    portable to IPFS).
W=../../web
cp logo-light.svg lockup-light.svg icon.svg preview.png "$W/static/"
mkdir -p "$W/src/lib/brand/fonts"
cp fonts/Cinzel-VariableFont_wght.ttf fonts/OFL.txt "$W/src/lib/brand/fonts/"

rm -rf "$FC"
echo "ok"
