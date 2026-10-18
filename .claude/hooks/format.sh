#!/usr/bin/env bash
# PostToolUse hook: formats the file Claude just edited, when the formatter is available.
# Never blocks: formatting problems surface later in `cargo fmt --check` / `pnpm lint`.
set -uo pipefail

file=$(jq -r '.tool_input.file_path // empty')
[[ -n "$file" && -f "$file" ]] || exit 0
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"

case "$file" in
  *.rs)
    command -v rustfmt >/dev/null && rustfmt --edition 2024 --quiet "$file" 2>/dev/null
    ;;
  *.ts|*.js|*.svelte|*.css|*.json)
    [[ "$file" == *-lock.json || "$file" == *pnpm-lock.yaml ]] && exit 0
    [[ -x "$root/node_modules/.bin/prettier" ]] && "$root/node_modules/.bin/prettier" --write --log-level silent "$file"
    ;;
esac
exit 0
