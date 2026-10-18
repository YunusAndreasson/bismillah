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
