#!/usr/bin/env bash
# The offline-rebuild proof (os/PLAN.md, OS-1 and OS-5): clones the committed HEAD into
# os/out/clean/, gives it this checkout's os/cache/ and nothing else, and builds the app
# from nothing and both images in a network namespace with only loopback. The images
# land in os/out/clean/bismillah/os/out/image/.
# Usage: os/scripts/rebuild-offline.sh
set -euo pipefail
root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
clean=$root/os/out/clean
[ -f "$root/os/cache/SHA256SUMS" ] || { echo "No os/cache/: run pnpm os:fetch first." >&2; exit 1; }

rm -rf "$clean"
mkdir -p "$clean"
git clone -q "$root" "$clean/bismillah"
ln -s "$root/os/cache" "$clean/bismillah/os/cache"
echo "clean checkout of $(git -C "$clean/bismillah" rev-parse --short HEAD); building with only loopback"
# A user unit with its own network namespace: only lo exists inside. Docker's
# containers run with --network=none as well; the daemon is reached over its socket.
systemd-run --user --wait --pipe --quiet -p PrivateNetwork=yes -p PrivateUsers=yes \
  --working-directory="$clean/bismillah" -- bash -euc '
    echo "network interfaces: $(ls /sys/class/net | tr "\n" " ")"
    os/build/build-app.sh --clean
    os/scripts/build.sh release
    os/scripts/build.sh debug'
ls -l "$clean/bismillah/os/out/image/"*.raw
