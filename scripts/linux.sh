#!/usr/bin/env bash
# Runs a command on Linux from a Mac, in the container scripts/linux/Dockerfile
# describes: by default the whole gate, `pnpm verify`. The working tree is copied into
# the container (git's ignore rules apply), so the container builds its own target/ and
# node_modules/ and never touches the Mac's.
#
#   scripts/linux.sh                  pnpm verify, on Linux
#   scripts/linux.sh pnpm test:e2e    any command, run in the copy of the repo
#
# The image is built on first use (it needs the network once, for Arch, crates and npm).
# Visual diffs land in target/linux/visual/ on the Mac.
set -euo pipefail
cd "$(dirname "$0")/.."

image=bismillah-linux
volume=bismillah-linux-work
[ $# -gt 0 ] || set -- pnpm verify

if ! docker image inspect "$image" >/dev/null 2>&1; then
  docker build --platform linux/amd64 -t "$image" scripts/linux
fi

# The volume keeps the build and the installed packages between runs.
docker volume create "$volume" >/dev/null
docker run --rm --platform linux/amd64 --user root -v "$volume:/work" "$image" \
  chown writer:writer /work

mkdir -p target/linux
# Without debug info or incremental caches the build is a fraction of the size, which
# Docker Desktop's disk, shared with every other container, can spare. The code, the
# tests and the debug assertions are the same.
docker run --rm --platform linux/amd64 --init \
  -e CARGO_PROFILE_DEV_DEBUG=0 -e CARGO_INCREMENTAL=0 \
  -v "$PWD:/src:ro" -v "$volume:/work" -v "$PWD/target/linux:/out" \
  "$image" bash -c '
    set -euo pipefail
    rsync -a --delete --filter=":- .gitignore" --exclude=.git --exclude=/target \
      --exclude=node_modules /src/ /work/repo/
    pnpm install --frozen-lockfile --reporter=silent
    status=0
    "$@" || status=$?
    rm -rf /out/visual
    [ -d target/visual ] && cp -r target/visual /out/visual
    exit $status
  ' linux "$@"
