#!/usr/bin/env bash
# Regenerates the piece set and the mock scene. Needs python3, rsvg-convert, magick.
# On NixOS: nix shell nixpkgs#librsvg -c ./build.sh
# rsvg is used here (not inkscape): inkscape drops the scene's shadowed piece groups.
set -euo pipefail
cd "$(dirname "$0")"
python3 pieces.py
rsvg-convert -w 1920 scene.svg -o /tmp/scene@2x.png && magick /tmp/scene@2x.png -resize 960x -strip scene.png
args=()
for k in king queen rook bishop knight pawn; do rsvg-convert -w 400 "pieces/$k.svg" -o "/tmp/piece-$k.png"; args+=("/tmp/piece-$k.png"); done
magick "${args[@]}" +append -resize 1200x -background '#f6efe4' -alpha remove -strip pieces.png
echo ok
