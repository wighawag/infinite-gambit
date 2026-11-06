#!/usr/bin/env bash
# Regenerates the piece set and the mock scene. Needs python3, rsvg-convert, magick.
# On NixOS: nix shell nixpkgs#librsvg -c ./build.sh
# rsvg is used here (not inkscape): inkscape drops the scene's shadowed piece groups.
set -euo pipefail
cd "$(dirname "$0")"
python3 pieces.py
rsvg-convert -w 1920 scene.svg -o /tmp/scene@2x.png && magick /tmp/scene@2x.png -resize 960x -strip scene.png
rsvg-convert -w 2400 set.svg -o /tmp/set@2x.png && magick /tmp/set@2x.png -resize 1200x -strip pieces.png
echo ok
