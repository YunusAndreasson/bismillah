# 0005 — Declarative themes first; executable plugins deferred

- **Status:** Accepted
- **Date:** 2026-10-18

## Context
We want users to extend bismillah. Revision 1 of the plan proposed JS plugins imported into the app's webview with a permission-gated API. JS in the same context has the app's full authority, so a wrapper API cannot enforce per-plugin permissions. Tauri capabilities are scoped per window or webview, not per script. Exposing arbitrary CodeMirror extensions or markdown-it callbacks is incompatible with any restricted API.

## Decision
- **v1 ships declarative themes:** token files (JSON/TOML) that set semantic token values, validated in Rust (known keys, parsed colours, contrast checks). No CSS and no code.
- **No user-supplied JavaScript is loaded** until a future ADR accepts an isolation model. Candidates: a sandboxed iframe or Web Worker with a narrow message-based API (commands, text transforms, export formats), or WASM.
- Internally, features are built on a clean command registry and extension points, so a later plugin API has a sound base.

## Consequences
- Fewer extension possibilities at 1.0, but every promise we make about extensions is true.
- The plugin system becomes a dedicated, post-1.0 design task with its own threat model.

## Phase 5 result (2026-10-19)
Built as decided; nothing here changed. What the building settled (ARCHITECTURE.md §8–9, DESIGN.md §9.5, §13):
- **A theme sets token values only**, as `[light]` and `[dark]` tables of `#rgb`/`#rrggbb` colours in TOML or JSON. Anything else in the file is reported and ignored; contrast below DESIGN.md §9.4 is a warning, not a refusal, because the theme is the writer's choice.
- **bismillah's own themes are theme files too** (`src-tauri/themes/`), checked by the same code and held by a test to no problems, so a future set (the author plans one) is added as files, with no code.
- **Shortcuts are declarative as well:** `keybindings.toml` maps command ids to keys and nothing else. Like themes, it can't add behaviour, only rebind what the command registry already has.
