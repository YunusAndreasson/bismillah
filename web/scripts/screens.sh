#!/usr/bin/env bash
# Copy the stick's real screens into the site (src/assets/screens/), from a run of
# `pnpm os:shots` in the repository root (os/scripts/shots.ts: the stick in a VM, a
# 2880×1800 screen at 2×). Run it again when the app's look changes; the copies are
# committed (the site builds from web/ alone), like scripts/basmallah.sh's.
set -euo pipefail
cd "$(dirname "$0")/.."
shots=../os/out/shots
mkdir -p src/assets/screens
for name in page-light zuhd-light arabic-light suggestion-light files-light setup-passphrase; do
  [ -f "$shots/$name.png" ] || { echo "no $shots/$name.png: run pnpm os:shots first" >&2; exit 1; }
  cp "$shots/$name.png" "src/assets/screens/$name.png"
done
# For phones, where a whole laptop screen is too small to read: a detail of the part
# that matters, 1300 pixels wide, as narrow as her page's longest line allows from its
# heading's # to its end, so its text stays legible and no line is cut, all one shape so
# the words under them never move (WIDTHxHEIGHT+X+Y on the 2880×1800 capture).
crop() { magick "src/assets/screens/$1.png" -crop "$2" +repage "src/assets/screens/$1-crop.png"; }
crop page-light 1300x938+560+230
# Zuhd: the paragraph in ink with the caret, and the grey ones above and below it.
crop zuhd-light 1300x938+600+500
crop arabic-light 1300x938+940+380
crop suggestion-light 1300x938+1100+300
# Files: what was typed, and the one text it finds, closer, as the panel's type is smaller
# than the page's (the same shape, so it is shown larger).
crop files-light 832x600+0+100
echo "copied $(ls src/assets/screens | wc -l) screens to src/assets/screens/"
