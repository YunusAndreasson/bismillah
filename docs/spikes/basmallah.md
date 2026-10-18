# Spike: the Basmallah opening

*Phase 0, 2026-10-18.* Question (PLAN.md): does a block widget above line 1, outside the document, work with scrolling, typewriter mode, the caret at the start and scroll restoration? Tested in the real app by `tests/e2e/spikes/basmallah.e2e.ts` (6 tests).

**Verdict: go** for the widget. Its *rendering* is affected by the WebKit Arabic bug ([arabic-rendering.md](arabic-rendering.md)).

## How

`src/editor/basmallah.ts`: a `Decoration.widget({ block: true, side: -1 })` at position 0, provided by a state field (block widgets that change layout must not come from a view plugin), switchable through a compartment. Amiri at 28px × the writing-size preference, centred in the reading column, `lang="ar" dir="rtl"`, with one body line above and one and a half below.

## Verified

- It is never in the document: the text equals the file, nothing enters the undo history.
- Caret at the start: `Mod-Home` and `ArrowUp` stay at position 0; clicking the Basmallah puts the caret at 0 and changes nothing.
- Typing at position 0 inserts below it; it stays above line 1.
- It scrolls with the document pixel for pixel and appears once.
- A scroll snapshot (`view.scrollSnapshot()`) restores the same first visible line after the document is reloaded.
- **Typewriter mode:** the caret line's top sits at 42.0% (±0.5%) for every line, line 1 included, with the Basmallah fully visible above it.

## Typewriter scrolling (also settled here)

`src/editor/typewriter.ts`. A first version used `scrollMargins` that left a one-line band at 42%; CodeMirror's "nearest" scroll then drifted by up to ±20px (its own 5px margin, tall heading lines). The final version adds an explicit scroll target (`y: "start"`, margin 42% of the writing area) to every transaction that would scroll the caret into view. Mouse clicks don't scroll, so text never jumps away from the pointer; keyboard motion and typing recentre.

## Open points for Phase 1

- Selecting and copying the Basmallah itself (DESIGN.md §11.2) wasn't settled: the widget lets the browser handle its events, but CodeMirror owns the selection model. Decide between native selection inside the widget and a dedicated copy action.
- Deduplication against a first block that already is a Basmallah is Phase 1 work, as planned.
- Rendering: option 4 in arabic-rendering.md (pre-shaped outlines with the real text kept for selection and screen readers) would make the opening exact regardless of the WebKit bug.
