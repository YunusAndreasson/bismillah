# 0008 — Basmallah as a presentation element

- **Status:** Accepted
- **Date:** 2026-10-18
- **Amended:** 2026-10-18 (interview). On by default, with a setting to turn it off.
- **Amended:** 2026-10-18 (Phase 0). Block-widget spike: go.
- **Amended:** 2026-10-19 (author's request: "too prominent… calligraphy and dimmed, almost like a wordmark"). Drawn as Amiri's calligraphic ligature ﷽ at 17px, in `text-secondary`; the real text underneath is unchanged.
- **Amended:** 2026-10-19 (author: "a bit more dimmed"). `text-faint` instead of `text-secondary`.

## Context
Every document should open with a beautifully typeset, centred بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ. Writing it into files would change the writer's documents, create edits just by opening a file, and pollute counts, linting and exports.

## Decision
- Render the Basmallah as a **presentation element** above the first line: a CodeMirror block widget outside the editable document in the editor, and a shared component in preview.
- It is never written to disk and never counted, spellchecked or included in the outline.
- A quiet calligraphic wordmark: Amiri's Basmallah ligature (﷽), starting at 17px / 1.8, `text-faint`, `lang="ar" dir="rtl"`, centred in the reading column. It scales with the writing-size preference. (Until 2026-10-19: the vocalised text in Amiri regular at 28px, `text-primary`.)
- If the first content block already is a standalone Basmallah (allowing for common vocalisation and whitespace differences), the element is suppressed. This is a narrow, tested comparison, not general detection.
- **On by default; can be turned off** in Settings › Appearance (`basmallah_opening`), out of respect for an open-source audience of any faith or none.

## Consequences
- The Phase 0 spike must confirm the block widget works with scrolling, typewriter mode, caret placement at the start, and scroll restoration.
- Any future export feature must state whether it exports the source or the composed presentation.

## Phase 0 result (2026-10-18)

**Go.** Evidence: [docs/spikes/basmallah.md](../spikes/basmallah.md). The block widget at position 0 (from a state field) stays out of the text and the undo history; `Mod-Home`, `ArrowUp` and clicks keep the caret at position 0; it scrolls with the document and appears once; scroll snapshots restore exactly; in typewriter mode line 1 sits at 42% with the Basmallah visible above it. Its *rendering* suffers from the WebKitGTK mark bug (ADR-0011); drawing it from pre-shaped outlines, with the real text kept for selection and screen readers, would make it exact. Selecting and copying the Basmallah itself is left for Phase 1.
