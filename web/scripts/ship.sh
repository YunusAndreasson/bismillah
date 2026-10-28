#!/usr/bin/env bash
# Ship the site to production from this machine, the only deploy path. CI verifies
# every push but never deploys, so no Cloudflare credential lives in GitHub. Uses
# your logged-in wrangler (OAuth, see `pnpm exec wrangler whoami`).
#
# Refuses unless web/ matches a commit on main, so every live version maps to a
# commit (its message is the deploy message in the dashboard). Uncommitted work in
# the app, elsewhere in the repo, doesn't block it: the site builds from web/ alone.
set -euo pipefail
cd "$(dirname "$0")/.."

URL="https://bismillah.jonas-268.workers.dev"

if [[ -n "$(git status --porcelain -- .)" ]]; then
  echo "Uncommitted changes in web/: commit or stash them before shipping." >&2
  exit 1
fi
branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" != "main" ]]; then
  echo "On '$branch': ship from main." >&2
  exit 1
fi

# The last commit that changed the site, not HEAD, which may be an app commit.
commit="$(git log -1 --format='%h %s' -- .)"
if git fetch --quiet origin main 2>/dev/null && [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  echo "Note: main is not what origin/main points at. Push after shipping."
fi

pnpm verify
pnpm exec wrangler deploy --message "$commit"
scripts/smoke-test.sh "$URL"
echo "Shipped ${commit%% *} to $URL"
