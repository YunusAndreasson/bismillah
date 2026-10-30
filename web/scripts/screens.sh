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
echo "copied $(ls src/assets/screens | wc -l) screens to src/assets/screens/"
