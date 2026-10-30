#!/usr/bin/env bash
# Subset the editor's own typeface for the site. Run by hand when ../fonts/build/
# changes; the WOFF2 files are committed (the site builds from web/ alone).
#
#   scripts/fonts.sh
#
# Bismillah Duo is a renamed Modified Version of iA Writer Duo under the OFL, and the
# name is not reserved, so a further subset may keep it. --name-IDs='*' keeps the
# copyright and licence records, which the OFL requires.
set -euo pipefail
cd "$(dirname "$0")/.."

src=../fonts/build
out=src/assets/fonts
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$out"

# Latin, the IJMES letters (ḥ ṣ ḍ ṭ ẓ in Latin Extended Additional, ʿ ʾ), combining marks,
# general punctuation and the few symbols prose uses.
unicodes="U+0020-007E,U+00A0-017F,U+0300-036F,U+02BE-02BF,U+02BC,U+1E00-1EFF,U+2000-206F,U+20AC,U+2122,U+2212"

for style in Regular Italic; do
  # The spacing axis is always 0 on the site, so pin it; the weight axis stays.
  fonttools varLib.instancer "$src/BismillahDuo-$style.ttf" SPCG=0 -q -o "$work/$style.ttf"
  pyftsubset "$work/$style.ttf" --flavor=woff2 --output-file="$out/BismillahDuo-$style.woff2" \
    --unicodes="$unicodes" --layout-features='*' --name-IDs='*' --no-hinting
done
cp "$src/LICENSE.md" "$out/LICENSE.md"

# Amiri, for Arabic a visitor writes on the page, the app's own Arabic face. The Arabic
# blocks, with its ligatures and marks; loaded only when such a character is drawn.
pyftsubset ../fonts/source/amiri/Amiri-Regular.ttf --flavor=woff2 \
  --output-file="$out/Amiri-Regular.woff2" \
  --unicodes="U+0020,U+00A0,U+0600-06FF,U+0750-077F,U+08A0-08FF,U+200C-200F,U+FB50-FDFF,U+FE70-FEFF" \
  --layout-features='*' --name-IDs='*' --no-hinting
cp ../fonts/source/amiri/OFL.txt "$out/Amiri-OFL.txt"
ls -l "$out"
