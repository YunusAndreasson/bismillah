#!/usr/bin/env bash
# After a deploy (`pnpm ship` runs it last): the home page serves the site with its
# Content-Security-Policy, the film and the loops serve with their media types, and an
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

csp="$(curl "${opts[@]}" --head "$base/" | tr -d '\r' | grep -i '^content-security-policy:' || true)"
if [[ "$csp" != *"default-src 'self'"* ]]; then
  echo "$base/ has no same-origin Content-Security-Policy" >&2
  exit 1
fi
echo "ok  $base/ has its Content-Security-Policy"

# The film's first files, as Safari, Chrome and Firefox ask for them.
for check in \
  "media/film/cut-v35/hls/master.m3u8 mpegurl" \
  "media/film/cut-v35/hls/1080p/init_0.mp4 video/mp4" \
  "media/film/cut-v35/hls/1080p/000.m4s video/" \
  "media/film/cut-v35/film-av1.mp4 video/mp4" \
  "media/loops/v1/night/index.m3u8 mpegurl" \
  "media/captions/cut-v35.en.vtt text/vtt"; do
  read -r path type <<<"$check"
  got="$(curl "${opts[@]}" --fail --head "$base/$path" | tr -d '\r' | grep -i '^content-type:' || true)"
  if [[ "$got" != *"$type"* ]]; then
    echo "$base/$path answered '${got:-no content type}', not $type" >&2
    exit 1
  fi
  echo "ok  $base/$path ($type)"
done

# The install commands' scripts, as text (`irm … | iex` runs only text), whole (their
# last line calls what they define), and the stick's `current`, never cached.
for check in "install.sh main \"\$@\"" "install.ps1 }" "stick/current"; do
  read -r path last <<<"$check"
  head="$(curl "${opts[@]}" --fail --head "$base/$path" | tr -d '\r')"
  if [[ "$head" != *[Cc]ontent-[Tt]ype:\ text/plain* || "$head" != *[Cc]ache-[Cc]ontrol:\ no-cache* ]]; then
    echo "$base/$path isn't served as uncached text" >&2
    exit 1
  fi
  body="$(curl "${opts[@]}" --fail "$base/$path")"
  if [[ -n "$last" && "$(tail -n 1 <<<"$body")" != "$last" ]]; then
    echo "$base/$path doesn't end as the script does" >&2
    exit 1
  fi
  echo "ok  $base/$path"
done
