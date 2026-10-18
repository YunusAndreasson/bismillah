---
paths:
  - "src/editor/**"
---

# CodeMirror editor conventions

- One concern per extension file: `markdownStyling.ts`, `hangingMarks.ts`, `zuhd.ts`, `typewriter.ts`, `diagnostics.ts`, `basmallah.ts`, `bidi.ts`. Each exports a single `Extension` and has its own unit tests on decoration ranges and classes.
- Decorations must respect bidi isolation and keep cursor motion consistent with what is drawn ([CodeMirror bidi guide](https://codemirror.net/examples/bidi/)). Check caret movement, selection and mouse placement on RTL and mixed lines in `docs/specimen.md`.
- After fonts load or typography settings change, call `view.requestMeasure()` so the caret, selection, hanging marks and scrolling match the rendered text. Wait for `document.fonts.ready` before the first measurement.
- Only explicit, undoable user actions change the document. Extensions decorate; they never rewrite text (AGENTS.md, "The writer's trust" rule 3).
- The Basmallah is a block widget outside the document, never inserted text (ADR-0008).
- Diagnostics from Rust carry a revision. Drop any result older than the current revision instead of mapping it onto newer text (ARCHITECTURE.md §7.1).
- Selected text renders in `text-primary`, marks included, because `syntax-marker` fails contrast on the selection colour (DESIGN.md §9.4).
