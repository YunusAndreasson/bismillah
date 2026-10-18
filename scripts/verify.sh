#!/usr/bin/env bash
# The gate before every commit (AGENTS.md): every check, fastest first. Stops at the
# first failure.
#
#   pnpm verify            all checks
#   pnpm verify --fast     skip the real-app suites (build, e2e, visual)
#
# cargo-deny refreshes its advisory database when the network is available and falls
# back to the cached copy when it isn't, so the gate also works offline.
set -euo pipefail
cd "$(dirname "$0")/.."

fast=false
[[ "${1:-}" == "--fast" ]] && fast=true

step() {
  printf '\n\033[1m▸ %s\033[0m\n' "$*"
  "$@"
}

deny() {
  cargo deny check || {
    echo "cargo deny: retrying with the cached advisory database (--offline)"
    cargo deny --offline check
  }
}

step pnpm check
step pnpm lint
step pnpm test
step cargo fmt --all --check
step cargo clippy --workspace --all-targets -- -D warnings
step cargo test --workspace
step deny

if ! $fast; then
  step pnpm app:build
  step pnpm test:e2e
  step pnpm test:visual
fi

printf '\n\033[1mverify: all checks passed\033[0m\n'
