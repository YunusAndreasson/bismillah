# 0002 — iA-style visible-markup editing with a separate preview

- **Status:** Superseded by [0012](0012-live-preview.md) (2026-10-18). The hanging-marks and bidi results below still hold: the caret's block and "Always show Markdown" draw marks this way.
- **Date:** 2026-10-18
- **Amended:** 2026-10-18 (Phase 0). Hanging marks and bidi spikes: go.

## Context
Markdown editors either show the syntax (iA Writer) or hide it until the caret arrives (Typora, Obsidian's live preview). Hiding syntax makes the text jump as the caret moves and blurs what is actually in the file.

## Decision
Markdown marks are always visible, styled in `syntax-marker`, with heading, quote and list marks hanging in a reserved gutter. Headings get restrained size and weight in the editor. A separate preview mode (`Mod-R`) shows the fully rendered document in the same column. Side-by-side preview is not part of v1.

## Consequences
- What you see is what is in the file. No reflow as the caret moves.
- Hanging marks require careful decoration work (bidi isolation, caret consistency, remeasuring after font changes). This is a Phase 0 spike.
- Marks count as meaningful text, so they must meet 4.5:1 contrast.

## Phase 0 result (2026-10-18)

**Hanging marks: go. Bidi: go.** Evidence: [docs/spikes/hanging-marks-and-bidi.md](../spikes/hanging-marks-and-bidi.md).
- Marks hang through line CSS only (`padding-inline-start` + negative `text-indent`, widths measured in the editor's own font), so text, DOM order and the caret model are untouched. Verified in WebKitGTK for Duo and Source Serif, LTR and RTL: reading edges align, wrapped headings return to the edge, arrow keys, Home and clicks work on the marks.
- Nested list items indent by their ancestors' marker widths, not by the source's spaces, so nesting looks right in proportional fonts.
- Each line's direction comes from the first strong character of its Markdown block, ignoring syntax; inline code and URLs are isolated and registered with CodeMirror. Caret motion, selection and mouse placement match the visible order on mixed lines.
- At a direction boundary two logical positions share one caret slot (as in WebKit's own text fields); a character of the other script typed there lands across the embedded run. Accepted as platform behaviour.
