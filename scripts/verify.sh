#!/usr/bin/env bash
# The gate before every commit (AGENTS.md): every check, fastest first. Stops at the
# first failure.
#
#   pnpm verify            all checks
#   pnpm verify --fast     skip the real-app suites (build, e2e, visual)
#   pnpm verify --online   also require fresh Rust advisories and a pnpm audit
#                         (can be combined with --fast)
#
# cargo-deny refreshes its advisory database when the network is available and falls
# back to the cached copy when it isn't, so the gate also works offline.
set -euo pipefail
cd "$(dirname "$0")/.."

fast=false
online=false
for arg in "$@"; do
  case "$arg" in
    --fast) fast=true ;;
    --online) online=true ;;
    *) echo "Usage: pnpm verify [--fast] [--online]" >&2; exit 2 ;;
  esac
done

step() {
  printf '\n\033[1m▸ %s\033[0m\n' "$*"
  "$@"
}

deny() {
  if $online; then
    cargo deny check
    return
  fi
  cargo deny check || {
    echo "cargo deny: retrying with the cached advisory database (--offline)"
    cargo deny --offline check
  }
}

step pnpm check
step pnpm lint
step pnpm test
step cargo fmt --all --check
step cargo clippy --workspace --all-targets --locked -- -D warnings
step cargo test --workspace --locked
step deny
if $online; then
  step pnpm audit
fi

if ! $fast; then
  step pnpm app:build
  step pnpm test:e2e
  step pnpm test:visual
fi

printf '\n\033[1mverify: all checks passed\033[0m\n'
