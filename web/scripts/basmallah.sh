#!/usr/bin/env bash
# Copy the app's Basmallah outline (Amiri's ﷽, pre-shaped by HarfBuzz) into the site, so
# the page draws the opening exactly as the editor does, with no Arabic web font. Run
# it again when ../src/editor/basmallahInk.ts is regenerated; the copy is committed
# (the site builds from web/ alone), like public/favicon.svg.
set -euo pipefail
cd "$(dirname "$0")/.."
cp ../src/editor/basmallahInk.ts src/assets/basmallah.ts
echo "copied src/assets/basmallah.ts"
