#!/usr/bin/env bash
# Checks a built bismillah package (PLAN.md Phase 6) without installing it:
#   1. it holds the binary, the desktop entry, the icons, the guide and the licences;
#   2. the desktop entry is valid and offers bismillah for Markdown files;
#   3. "Open with bismillah" opens the file: the entry is launched the way a file
#      manager launches it, inside scripts/headless.sh, and the app records the file;
#   4. `bismillah --version` gives the package's version;
#   5. every library the binary links against belongs to a package it depends on;
#   6. it prints the package's sizes, for PLAN.md and ARCHITECTURE.md §14.
#
#   packaging/check.sh packaging/arch/bismillah-<version>-x86_64.pkg.tar.zst
set -euo pipefail
cd "$(dirname "$0")/.."

pkg="$(realpath "${1:?the package to check}")"
work="$(mktemp -d "${TMPDIR:-/tmp}/bismillah-package.XXXXXX")"
trap 'rm -rf "$work"' EXIT
bsdtar -xf "$pkg" -C "$work"
root="$work/usr"
fail() {
  echo "package: $*" >&2
  exit 1
}

# 1. Files.
for file in bin/bismillah share/applications/bismillah.desktop \
  share/icons/hicolor/scalable/apps/bismillah.svg share/icons/hicolor/32x32/apps/bismillah.png \
  share/icons/hicolor/512x512/apps/bismillah.png share/doc/bismillah/guide.md \
  share/doc/bismillah/PRIVACY.md share/licenses/bismillah/LICENSE \
  share/licenses/bismillah/fonts/Amiri.txt share/licenses/bismillah/dictionaries/Ayaspell-COPYING.txt; do
  [[ -s "$root/$file" ]] || fail "/usr/$file is missing"
done
cmp -s "$root/share/doc/bismillah/guide.md" docs/guide.md || fail "the guide isn't the repository's"

# 2. The desktop entry, and the Markdown types a file manager reads from it.
desktop-file-validate "$root/share/applications/bismillah.desktop"
registered=$(XDG_DATA_HOME="$work/home" XDG_DATA_DIRS="$root/share" gio mime text/markdown)
grep -q "bismillah.desktop" <<<"$registered" || fail "bismillah isn't offered for text/markdown"

# 3. Open with bismillah: launched from its entry with a file, as a file manager does,
# under the harness's private display and folders. The app remembers the file it
# opened in its state.json, which is read once it quits.
note="$work/notes"
mkdir -p "$note"
printf '# Opened with bismillah\n' >"$note/letter.md"
PATH="$root/bin:$PATH" XDG_DATA_DIRS="$root/share:/usr/share" scripts/headless.sh bash -c '
  gio launch "$1" "$2" &
  for _ in $(seq 1 60); do
    grep -qs "letter.md" "$XDG_DATA_HOME/bismillah/state.json" && break
    sleep 0.5
  done
  cp "$XDG_DATA_HOME/bismillah/state.json" "$3" 2>/dev/null || true
  pkill -x bismillah || true
' launch "$root/share/applications/bismillah.desktop" "$note/letter.md" "$work/state.json" \
  >/dev/null 2>&1 || true
grep -qs "$note/letter.md" "$work/state.json" || fail "Open with bismillah didn't open the file"

# 4. The version.
version=$(sed -n 's/^pkgver = \([0-9.]*\)\.r.*/\1/p' "$work/.PKGINFO")
[[ "$("$root/bin/bismillah" --version)" == "bismillah $version" ]] ||
  fail "bismillah --version doesn't say $version"

# 5. Linked libraries and the packages they come from.
depends=$(sed -n 's/^depend = //p' "$work/.PKGINFO")
for lib in $(readelf -d "$root/bin/bismillah" | sed -n 's/.*(NEEDED).*\[\(.*\)\]/\1/p'); do
  owner=$(pacman -Qoq "/usr/lib/$lib" 2>/dev/null) || fail "no package has $lib"
  grep -qx "$owner" <<<"$depends" || fail "$lib comes from $owner, which isn't in depends"
done

# 6. Sizes.
installed=$(sed -n 's/^size = //p' "$work/.PKGINFO")
binary=$(stat -c %s "$root/bin/bismillah")
mib() { awk -v b="$1" 'BEGIN { printf "%.1f MiB", b / 1048576 }'; }
echo "package: $(basename "$pkg") checked"
echo "  package file   $(mib "$(stat -c %s "$pkg")")"
echo "  installed      $(mib "$installed")"
echo "  binary         $(mib "$binary")"
