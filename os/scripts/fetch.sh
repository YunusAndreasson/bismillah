#!/usr/bin/env bash
# The only networked stage of the stick's build (os/PLAN.md, *Development environment*):
# fetches every input recorded in os/inputs.lock into os/cache/, then builds the app
# and both images once, which fills mkosi's package cache. Every later stage
# (pnpm os:app, pnpm os:build) runs with the network off, from os/cache/ alone.
# Usage: os/scripts/fetch.sh   (pnpm os:fetch)
set -euo pipefail
root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
# shellcheck source=../inputs.lock
source "$root/os/inputs.lock"
cache=$root/os/cache
mkdir -p "$cache"
tag=$("$root/os/build/container-tag.sh")

echo "== the build container ($tag)"
docker build -q -t "$tag" \
  --build-arg CONTAINER_BASE="$CONTAINER_BASE" \
  --build-arg DEBIAN_SNAPSHOT="$DEBIAN_SNAPSHOT" \
  --build-arg RUST_VERSION="$RUST_VERSION" \
  --build-arg RUSTUP_VERSION="$RUSTUP_VERSION" \
  --build-arg RUSTUP_INIT_SHA256="$RUSTUP_INIT_SHA256" \
  --build-arg NODE_VERSION="$NODE_VERSION" \
  --build-arg NODE_SHA256="$NODE_SHA256" \
  --build-arg PNPM_VERSION="$PNPM_VERSION" \
  -f "$root/os/build/Containerfile" "$root/os/build"
docker save "$tag" -o "$cache/container.tar"

echo "== the app's crates and node packages, from the committed lockfiles"
docker run --rm -v "$root:/repo:ro" -v "$cache:/cache" -e OWNER="$(id -u):$(id -g)" \
  "$tag" bash -euc '
    git config --global --add safe.directory "*"
    git clone -q /repo /src/bismillah && cd /src/bismillah
    rm -rf /cache/cargo-vendor
    cargo vendor --locked /cache/cargo-vendor >/dev/null
    pnpm fetch --frozen-lockfile --store-dir /cache/pnpm-store --cache-dir /cache/pnpm-cache
    chown -R "$OWNER" /cache/cargo-vendor /cache/pnpm-store /cache/pnpm-cache'

echo "== the app (offline) and both images (online once, for the package cache)"
"$root/os/build/build-app.sh"
"$root/os/scripts/build.sh" --online release
"$root/os/scripts/build.sh" --online debug
# The tools tree they were built with, kept for the offline builds.
rm -rf "$cache/mkosi.tools"
mv "$root/os/mkosi/mkosi.tools" "$cache/mkosi.tools"
rm -f "$root/os/mkosi/mkosi.tools.manifest"

echo "== what was fetched: os/cache/SHA256SUMS"
(cd "$cache" && find . -path ./mkosi.tools -prune -o -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum) \
  >"$cache/SHA256SUMS"
du -sh "$cache"/* | sort -h
