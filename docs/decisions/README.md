# Architecture Decision Records

Short records of decisions with lasting consequences. Each one says what was decided, why, and what it costs.

- Number them sequentially and never reuse a number.
- To change a decision, write a new ADR that **supersedes** the old one and update the old one's status. Don't rewrite history.
- Keep them short: one screen is ideal.
- Until Phase 1 code exists, an ADR may be amended in place with a dated `Amended:` line. After that, supersede it. (Phase 0 spike code doesn't count; Phase 0 results were recorded as amendments.)

| # | Title | Status |
|---|---|---|
| [0001](0001-stack.md) | Tauri 2 + Svelte 5 + CodeMirror 6 + Bits UI | Accepted |
| [0002](0002-visible-markup-editing.md) | iA-style visible-markup editing with a separate preview | Superseded by 0012 |
| [0003](0003-offline-boundary.md) | Offline boundary and privacy claims | Accepted |
| [0004](0004-spelling-and-grammar.md) | Spelling and grammar engines | Accepted |
| [0005](0005-extensibility.md) | Declarative themes first; executable plugins deferred | Accepted |
| [0006](0006-file-safety.md) | File-safety contract (amanah) | Accepted |
| [0007](0007-typography-foundation.md) | Initial font set and writing profiles | Accepted |
| [0008](0008-basmallah-opening.md) | Basmallah as a presentation element | Accepted |
| [0009](0009-desktop-only.md) | Desktop only | Accepted |
| [0010](0010-typing-aids.md) | Typing aids: smart punctuation and transliteration mode | Accepted |
| [0011](0011-arabic-mark-rendering.md) | Arabic mark rendering in WebKitGTK | Accepted |
| [0012](0012-live-preview.md) | Live preview: Markdown shows in the caret's paragraph | Accepted |
| [0013](0013-appliance-os.md) | Appliance OS: bismillah on a bootable stick | Accepted |
| [0014](0014-stick-stays-on-debian.md) | The stick stays on Debian | Proposed |

## Template

```markdown
# NNNN — Title

- **Status:** Proposed | Accepted | Superseded by NNNN
- **Date:** YYYY-MM-DD

## Context
What forces are at play? What problem needs deciding?

## Decision
What we will do.

## Consequences
What becomes easier, what becomes harder, and what we must now test or maintain.
```
