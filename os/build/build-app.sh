#!/usr/bin/env bash
# Builds the bismillah release binary and its helper for Debian 13 in the build container, with the
# network off, from a committed ref and os/cache/ alone (pnpm os:app). The repository
# is mounted read-only and the build clones the ref, so the working tree and target/
# are never touched. The result is the image's app tree, os/out/app/, which records
# the commit it was built from, and os/out/app-debug/ with what only the debug image
# carries: the file recorder for the allowlist (os/PLAN.md, OS-4).
# Usage: os/build/build-app.sh [--clean] [git-ref]
#   --clean   compile from nothing (otherwise a Docker volume keeps Cargo's target/)
set -euo pipefail
root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
clean=
[ "${1:-}" = --clean ] && { clean=1; shift; }
ref=${1:-HEAD}
cache=$root/os/cache
out=$root/os/out/app
debug=$root/os/out/app-debug
tag=$("$root/os/build/container-tag.sh")

for input in container.tar cargo-vendor pnpm-store pnpm-cache; do
  [ -e "$cache/$input" ] || { echo "No os/cache/$input: run pnpm os:fetch first." >&2; exit 1; }
done
docker image inspect "$tag" >/dev/null 2>&1 || docker load -q -i "$cache/container.tar"

rm -rf "$out" "$debug"
mkdir -p "$out" "$debug"
target=()
[ -n "$clean" ] || target=(-v bismillah-os-target:/src/bismillah/target)
docker run --rm --network=none \
  -v "$root:/repo:ro" -v "$cache:/cache" -v "$out:/out" -v "$debug:/out-debug" "${target[@]}" \
  -e REF="$ref" -e OWNER="$(id -u):$(id -g)" \
  "$tag" bash -euc '
    git config --global --add safe.directory "*"
    git init -q /src/bismillah && cd /src/bismillah
    git fetch -q /repo "$REF" && git checkout -q FETCH_HEAD
    printf "%s\n" "[source.crates-io]" "replace-with = \"vendored\"" \
      "[source.vendored]" "directory = \"/cache/cargo-vendor\"" "[net]" "offline = true" \
      >"$CARGO_HOME/config.toml"
    pnpm install --offline --frozen-lockfile --store-dir /cache/pnpm-store --cache-dir /cache/pnpm-cache
    pnpm tauri build --no-bundle -- --locked
    cargo build --release --locked -p bismillah-appliance --bin bismillah-helper
    install -D -m755 target/release/bismillah /out/usr/bin/bismillah
    install -D -m755 target/release/bismillah-helper /out/usr/libexec/bismillah-helper
    cargo build --release --locked -p bismillah-appliance --features trace --bin bismillah-trace --bin bismillah-probe
    install -D -m755 target/release/bismillah-trace /out-debug/usr/libexec/bismillah-trace
    install -D -m755 target/release/bismillah-probe /out-debug/usr/libexec/bismillah-probe
    # The licences the desktop package installs (About names their folder): the
    # binary embeds the fonts and the Arabic dictionary.
    lic=/out/usr/share/licenses/bismillah
    install -D -m644 LICENSE "$lic/LICENSE"
    install -D -m644 fonts/build/LICENSE.md "$lic/fonts/BismillahDuo-Mono.md"
    install -D -m644 fonts/source/amiri/OFL.txt "$lic/fonts/Amiri.txt"
    install -D -m644 fonts/source/source-serif-4/LICENSE.md "$lic/fonts/SourceSerif4.md"
    install -D -m644 fonts/source/ibm-plex-sans-arabic/LICENSE.txt "$lic/fonts/IBMPlexSansArabic.txt"
    install -D -m644 dictionaries/ar/COPYING.txt "$lic/dictionaries/Ayaspell-COPYING.txt"
    install -D -m644 dictionaries/ar/AUTHORS.txt "$lic/dictionaries/Ayaspell-AUTHORS.txt"
    mkdir -p /out/usr/share/bismillah
    git rev-parse HEAD >/out/usr/share/bismillah/commit
    chown -R "$OWNER" /out /out-debug'
echo "$out/usr/bin/bismillah, usr/libexec/bismillah-helper ($(cat "$out/usr/share/bismillah/commit"))"
