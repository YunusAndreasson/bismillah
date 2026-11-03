#!/usr/bin/env bash
# PreToolUse hook: blocks adding networking or telemetry dependencies (ADR-0003).
# Rust names come from deny.toml (single source of truth); npm names are listed below.
# Exit 2 blocks the tool call and shows stderr to Claude.
set -euo pipefail

input=$(cat)
tool=$(jq -r '.tool_name // empty' <<<"$input")
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"

banned=(
  axios node-fetch got ky superagent undici
  @tauri-apps/plugin-http @tauri-apps/plugin-updater
  @tauri-apps/plugin-websocket @tauri-apps/plugin-upload
  @sentry/browser @sentry/svelte posthog-js @vercel/analytics
)
# Plain bash 3.2 and perl, not mapfile or grep -P, so the guard also runs on macOS.
if [[ -f "$root/deny.toml" ]]; then
  while IFS= read -r name; do banned+=("$name"); done \
    < <(perl -nle 'print $1 while /\{\s*crate\s*=\s*"([^"]+)/g' "$root/deny.toml")
fi

block() {
  echo "Blocked: '$1' is a networking/telemetry dependency. bismillah stays fully offline (ADR-0003, AGENTS.md 'The writer's trust' rule 1). Solve this with local code, or propose an ADR if you believe an exception is needed." >&2
  exit 2
}

# Matches a whole package name: not preceded or followed by a name character.
contains_name() { # $1 = haystack, $2 = name
  HAY="$1" NAME="$2" perl -e 'exit($ENV{HAY} =~ m{(?<![A-Za-z0-9_@/.-])\Q$ENV{NAME}\E(?![A-Za-z0-9_-])} ? 0 : 1)'
}

case "$tool" in
  Bash)
    cmd=$(jq -r '.tool_input.command // empty' <<<"$input")
    if CMD="$cmd" perl -e 'exit($ENV{CMD} =~ /\b(cargo\s+add|pnpm\s+(add|install|i)\s|npm\s+(install|i|add)\s|yarn\s+add|bun\s+add)/ ? 0 : 1)'; then
      for name in "${banned[@]}"; do
        contains_name "$cmd" "$name" && block "$name"
      done
    fi
    ;;
  Edit|Write|MultiEdit)
    file=$(jq -r '.tool_input.file_path // empty' <<<"$input")
    case "$(basename "$file")" in
      Cargo.toml|package.json)
        new=$(jq -r '[.tool_input.content, .tool_input.new_string, (.tool_input.edits // [] | .[].new_string)] | map(select(. != null)) | join("\n")' <<<"$input")
        for name in "${banned[@]}"; do
          contains_name "$new" "$name" && block "$name"
        done
        ;;
    esac
    ;;
esac
exit 0
