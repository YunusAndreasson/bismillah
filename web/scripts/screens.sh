#!/usr/bin/env bash
# Copy the stick's real screens into the site (src/assets/screens/), from a run of
# `pnpm os:shots` in the repository root (os/scripts/shots.ts: the stick in a VM, a
# 2880×1800 screen at 2×). Run it again when the app's look changes; the copies are
# committed (the site builds from web/ alone), like scripts/basmallah.sh's.
set -euo pipefail
cd "$(dirname "$0")/.."
shots=../os/out/shots
mkdir -p src/assets/screens
for name in page-light zuhd-light arabic-light suggestion-light setup-passphrase; do
  [ -f "$shots/$name.png" ] || { echo "no $shots/$name.png: run pnpm os:shots first" >&2; exit 1; }
  cp "$shots/$name.png" "src/assets/screens/$name.png"
done
# For phones, where a whole laptop screen is too small to read: a detail of the part
# that matters, about 1000 pixels wide so its text stays legible, all one shape so the
# words under them never move (WIDTHxHEIGHT+X+Y on the 2880×1800 capture).
crop() { magick "src/assets/screens/$1.png" -crop "$2" +repage "src/assets/screens/$1-crop.png"; }
crop page-light 1040x750+540+240
crop zuhd-light 1040x750+580+700
crop arabic-light 1040x750+1200+220
crop suggestion-light 1040x750+1340+360
echo "copied $(ls src/assets/screens | wc -l) screens to src/assets/screens/"
