#!/usr/bin/env bash
# Records the allowlist (os/PLAN.md, OS-4): builds the debug image whole (no pruning),
# runs every debug VM scenario with the file recorder on, merges what they opened into
# os/mkosi/allowlist.txt, then rebuilds both images pruned. Review the list's diff and
# commit it; then run os/scripts/verify.sh.
# Usage: os/scripts/trace.sh [--no-build]
set -euo pipefail
root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
build=1
[ "${1:-}" = --no-build ] && build=
# The scenarios that boot the debug image: the recorder is only there.
scenarios=(debug-ssd home-round-trip home-interrupted home-damaged home-two-sticks home-saved
  suspend-lock power tour)

[ -z "$build" ] || "$root/os/scripts/build.sh" --unpruned debug
BISMILLAH_TRACE=1 node "$root/os/scripts/test.ts" "${scenarios[@]}"
node "$root/os/scripts/allowlist.ts"
if [ -n "$build" ]; then
  "$root/os/scripts/build.sh" release
  "$root/os/scripts/build.sh" debug
fi
git -C "$root" diff --stat -- os/mkosi/allowlist.txt
