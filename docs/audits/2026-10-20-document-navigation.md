# Document navigation and framework follow-up — 2026-10-20

The author authorized the three recommendations from the framework investigation: document search and navigation, bulk native menu creation, and selective Svelte dependency tracking.

## Changes

- CodeMirror Search 6.7.2 provides Find (`Ctrl+F`), Replace (`Ctrl+H`), next/previous match (`F3` / `Shift+F3`) and Go to line (`Ctrl+Alt+G`). The command registry supplies menu entries, palette entries and rebindable shortcuts. Zuhd and Theme keep `Ctrl+D` and `Ctrl+Shift+L`.
- Search retains CodeMirror’s case/word/regex options, accessible announcements and replacement history. Escape closes search before the editor’s pen-down command. Panels use interface typography, semantic colours, visible keyboard focus and measured contrast tokens. The unsupported Select all matches button is hidden because the editor keeps one caret.
- Searching compares Unicode-equivalent forms on a temporary copy. Arabic marks remain significant. Only explicit replacement writes text; replace-all is one undo step, preserves unrelated bytes, and skips imprecise matches inside a compatibility character’s expansion. Read-only documents offer search without replacement controls.
- Go to line accepts a line, relative line offset, percentage of lines or line:column (zero-based columns). It changes selection and scroll, never text.
- Native menu descriptions are created in one recursive `Menu.new` request. Root enumeration plus four section enumerations retrieve handles for later synchronization. No startup latency improvement is claimed: the menu already initializes after the editor becomes editable.
- The settings effect snapshots settings, explicitly tracks colour-theme changes and uses `untrack` around editor/DOM work. Menu readiness is reactive and a separate effect tracks menu context. Opening documents or changing the library no longer reapplies appearance settings, while native availability and actual settings changes still propagate.

## Verification

`src/editor/search.test.ts` checks Arabic UTF-16 offsets beside supplementary characters, normalized matching without rewriting, one-step replacement undo, compatibility-character boundaries, Escape precedence, replacement focus and read-only protection.

`tests/e2e/search.e2e.ts` drives the real Tauri/WebKitGTK app: keyboard opening, match wrapping, vocalised Arabic and frontmatter, exact-byte restoration and save, regex captures and invalid patterns, line/offset/column/percentage navigation, closed-document availability, read-only controls, and independent settings/menu synchronization. It checks the specimen at 640/1280/1920/2560 in both themes, plus enlarged text in a short 640px window. Review screenshots are written under `/tmp/bismillah-search-review/`.

Design review: panels stay within the window, use the interface’s reading order and explicit action labels, keep the document prominent, preserve the file/status context, and expose named fields and keyboard dismissal. The real-app screenshots were inspected; a low-contrast placeholder was corrected. Existing specimen baselines are retained.

`pnpm verify` passed: 409 frontend tests, 153 Rust tests, all 24 real-app suites and 16 visual checks, with type checking, formatting, linting, clippy and dependency policy checks. `pnpm a11y` passed all 13 states, including both new panels. The installed package and the author’s personal 1.0 acceptance check remain unchanged.
