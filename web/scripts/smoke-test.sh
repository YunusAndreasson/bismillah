#!/usr/bin/env bash
# After a deploy (`pnpm ship` runs it last): the home page serves the site, and an
# unknown path is a real 404, not a 200. Retries while the deploy reaches every edge.
#
#   scripts/smoke-test.sh <base-url>
set -euo pipefail

base="${1:?usage: smoke-test.sh <base-url>}"
base="${base%/}"
opts=(--silent --show-error --max-time 20 --retry 6 --retry-delay 5 --retry-all-errors)

home="$(curl "${opts[@]}" --fail "$base/")"
if [[ "$home" != *"<title>bismillah</title>"* ]]; then
  echo "$base/ served something other than the site" >&2
  exit 1
fi
echo "ok  $base/"

status="$(curl "${opts[@]}" --output /dev/null --write-out '%{http_code}' "$base/smoke-test-no-such-page")"
if [[ "$status" != 404 ]]; then
  echo "an unknown path answered $status, not 404" >&2
  exit 1
fi
echo "ok  $base/smoke-test-no-such-page → 404"
