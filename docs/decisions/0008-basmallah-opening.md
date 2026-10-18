# 0008 — Basmallah as a presentation element

- **Status:** Accepted
- **Date:** 2026-10-18
- **Amended:** 2026-10-18 (interview). On by default, with a setting to turn it off.

## Context
Every document should open with a beautifully typeset, centred بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ. Writing it into files would change the writer's documents, create edits just by opening a file, and pollute counts, linting and exports.

## Decision
- Render the Basmallah as a **presentation element** above the first line: a CodeMirror block widget outside the editable document in the editor, and a shared component in preview.
- It is never written to disk and never counted, spellchecked or included in the outline.
- Amiri regular, starting at 28px / 1.8, `text-primary`, `lang="ar" dir="rtl"`, centred in the reading column. It scales with the writing-size preference.
- If the first content block already is a standalone Basmallah (allowing for common vocalisation and whitespace differences), the element is suppressed. This is a narrow, tested comparison, not general detection.
- **On by default; can be turned off** in Settings › Appearance (`basmallah_opening`), out of respect for an open-source audience of any faith or none.

## Consequences
- The Phase 0 spike must confirm the block widget works with scrolling, typewriter mode, caret placement at the start, and scroll restoration.
- Any future export feature must state whether it exports the source or the composed presentation.
