#!/usr/bin/env bash
# Prints the build container's tag: a hash of its recorded inputs, so an image built
# from other inputs is never reused by mistake.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
echo "bismillah-os-build:$(cat "$here/../inputs.lock" "$here/Containerfile" | sha256sum | cut -c1-12)"
