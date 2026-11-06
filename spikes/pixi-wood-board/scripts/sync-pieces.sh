#!/bin/sh
# Copy the piece data from the brand folder, where pieces.py writes it.
set -e
cd "$(dirname "$0")/.."
cp ../../assets/brand/game/pieces.json src/pieces.json
echo "src/pieces.json updated"
