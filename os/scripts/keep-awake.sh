#!/usr/bin/env bash
# Keeps this machine awake during long unattended OS work (image builds, VM suites):
# blocks sleep, idle actions and the lid switch for a bounded time, then lets go.
# Needs no root; the active session may take these locks. Usage: keep-awake.sh [hours]
set -euo pipefail

hours="${1:-12}"
[[ "$hours" =~ ^[0-9]+$ ]] || { echo "usage: keep-awake.sh [hours]" >&2; exit 2; }

exec systemd-inhibit \
  --what=sleep:idle:handle-lid-switch \
  --who="bismillah OS work" \
  --why="Long build or VM test run" \
  --mode=block \
  sleep "$((hours * 3600))"
