#!/usr/bin/env bash
# The OS gate (os/PLAN.md): for any change under os/ or crates/bismillah-appliance/.
# Builds the app and both images offline from os/cache/, checks what they contain,
# then runs the VM scenarios and compares the boot stages and sizes with the committed
# baseline (perf.ts; a regression fails). --fast: the contents check, one boot of each
# image and the sizes.
# Usage: os/scripts/verify.sh [--fast] [--no-build]
set -euo pipefail
root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
fast= build=1
for arg; do
  case $arg in
    --fast) fast=1 ;;
    --no-build) build= ;;
    *) echo "usage: verify.sh [--fast] [--no-build]" >&2; exit 2 ;;
  esac
done
step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

if [ -n "$build" ]; then
  step "app (offline, from os/cache/)"
  "$root/os/build/build-app.sh"
  step "release image (offline)"
  "$root/os/scripts/build.sh" release
  step "debug image (offline)"
  "$root/os/scripts/build.sh" debug
fi
step "the reflash tool (made-up sticks)"
node --test "$root/os/tests/stick.test.ts"
step "flash inspection failures (no devices)"
node --test "$root/os/tests/flash-safety.test.ts"
step "boot timing measurements"
node --test "$root/os/tests/boot-timing.test.ts"
step "offline capture evidence"
node --test "$root/os/tests/capture.test.ts"
step "VM monitor failures"
node --test "$root/os/tests/qmp.test.ts"
step "firmware cache failures"
node --test "$root/os/tests/vars.test.ts"
step "image contents"
node "$root/os/tests/image-contents.ts" release debug
step "VM scenarios"
if [ -n "$fast" ]; then
  node "$root/os/scripts/test.ts" release-both debug-ssd
else
  node "$root/os/scripts/test.ts"
fi
step "boot stages and sizes against os/perf-baseline.json"
if [ -n "$fast" ]; then
  node "$root/os/scripts/perf.ts" --sizes
else
  node "$root/os/scripts/perf.ts"
fi
printf '\n\033[1mos verify: all checks passed\033[0m\n'
