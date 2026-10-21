#!/usr/bin/env bash
# Builds the bismillah release binary for Debian 13 inside the build container.
# The repository is mounted read-only and the build clones its committed HEAD,
# so the author's working tree and target/ are never touched.
# Usage: os/build/build-app.sh <out-dir> [git-ref]
set -euo pipefail

root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
out=$(realpath -m "${1:?usage: build-app.sh <out-dir> [git-ref]}")
ref="${2:-HEAD}"
mkdir -p "$out"

docker build -q -t bismillah-os-build -f "$root/os/build/Containerfile" "$root/os/build" >/dev/null
docker run --rm \
  -v "$root:/repo:ro" -v "$out:/out" \
  -v bismillah-os-cargo:/opt/cargo/registry \
  -v bismillah-os-pnpm:/root/.local/share/pnpm \
  -e REF="$ref" -e OWNER="$(id -u):$(id -g)" \
  bismillah-os-build bash -euc '
    git config --global --add safe.directory "*"
    git clone -q /repo /src/bismillah && cd /src/bismillah && git checkout -q "$REF"
    pnpm install --frozen-lockfile
    pnpm tauri build --no-bundle
    install -m755 target/release/bismillah /out/bismillah
    git rev-parse HEAD > /out/bismillah.commit
    chown -R "$OWNER" /out'
echo "$out/bismillah"
