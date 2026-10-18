#!/usr/bin/env bash
# Offline proof (ARCHITECTURE.md §10, ADR-0003). Runs the real-app e2e suite inside a
# private network namespace that has only a loopback interface, under strace, then
# fails if anything tried to reach a non-loopback address.
#
#   pnpm test:offline [strace-log]      (needs `pnpm app:build` first)
#
# The test tooling itself talks to tauri-driver over 127.0.0.1, which is why loopback
# is brought up inside the namespace; nothing can leave the machine either way.
set -euo pipefail
cd "$(dirname "$0")/.."

log="$(realpath -m "${1:-target/offline-strace.log}")"
mkdir -p "$(dirname "$log")"

unshare --map-root-user --net sh -c '
  ip link set lo up
  exec strace -f -qq -e trace=connect,sendto,sendmsg -o "$1" \
    scripts/headless.sh node_modules/.bin/wdio run tests/wdio.conf.ts --suite e2e
' offline "$log"

# connect()/sendto() to IPv4 or IPv6 addresses other than loopback.
remote=$(grep -E 'sa_family=AF_INET6?' "$log" |
  grep -vE 'inet_addr\("127\.[0-9.]+"\)|inet_pton\(AF_INET6, "::1"' || true)

if [[ -n "$remote" ]]; then
  echo "offline: non-loopback network attempts found:" >&2
  echo "$remote" | head -20 >&2
  exit 1
fi
attempts=$(grep -cE 'sa_family=AF_INET6?' "$log" || true)
echo "offline: e2e suite passed with no network; ${attempts} socket calls, all to loopback (log: $log)"
