#!/usr/bin/env bash
# Builds the stick's image with mkosi (pnpm os:build): os/out/image/bismillah-<profile>.raw.
# Offline, from mkosi's package cache and tools tree in os/cache/, unless --online
# (fetch.sh only), which builds a fresh tools tree in os/mkosi/mkosi.tools.
# Refuses an mkosi or a Debian snapshot other than the ones os/inputs.lock records.
# --unpruned keeps every file the packages installed (os/mkosi/prune.py), for
# recording the allowlist (os/scripts/trace.sh).
# Usage: os/scripts/build.sh [--online] [--unpruned] [release|debug]
set -euo pipefail
root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
# shellcheck source=../inputs.lock
source "$root/os/inputs.lock"
cache_only=always tools=()
[ "${1:-}" = --online ] && { cache_only=never tools=(--tools-tree=yes); shift; }
unpruned=()
[ "${1:-}" = --unpruned ] && { unpruned=(--environment=BISMILLAH_UNPRUNED=1); shift; }
profile=${1:-release}
case $profile in
  release | debug) ;;
  *) echo "usage: build.sh [--online] [--unpruned] [release|debug]" >&2; exit 2 ;;
esac

have=$(mkosi --version | awk '{print $2}')
[ "$have" = "$MKOSI_VERSION" ] || {
  echo "mkosi is $have, but os/inputs.lock records $MKOSI_VERSION." >&2
  exit 1
}
for key in Snapshot ToolsTreeSnapshot; do
  grep -qx "$key=$DEBIAN_SNAPSHOT" "$root/os/mkosi/mkosi.conf" || {
    echo "os/mkosi/mkosi.conf: $key= differs from os/inputs.lock ($DEBIAN_SNAPSHOT)." >&2
    exit 1
  }
done
[ -x "$root/os/out/app/usr/bin/bismillah" ] || { echo "No app build: run pnpm os:app first." >&2; exit 1; }
# About names the snapshot the system was built from.
echo "$DEBIAN_SNAPSHOT" >"$root/os/out/app/usr/share/bismillah/snapshot"

mkdir -p "$root/os/cache/mkosi" "$root/os/cache/mkosi-metadata" "$root/os/out/image" "$root/os/out/work"
cd "$root/os/mkosi"
[ ${#tools[@]} -gt 0 ] || [ -d "$root/os/cache/mkosi.tools" ] ||
  { echo "No os/cache/mkosi.tools: run pnpm os:fetch first." >&2; exit 1; }
mkosi "${tools[@]}" "${unpruned[@]}" --profile="$profile" --output="bismillah-$profile" --cache-only="$cache_only" -f build
echo "$root/os/out/image/bismillah-$profile.raw"
