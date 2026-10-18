# 0002 — iA-style visible-markup editing with a separate preview

- **Status:** Accepted
- **Date:** 2026-10-18

## Context
Markdown editors either show the syntax (iA Writer) or hide it until the caret arrives (Typora, Obsidian's live preview). Hiding syntax makes the text jump as the caret moves and blurs what is actually in the file.

## Decision
Markdown marks are always visible, styled in `syntax-marker`, with heading, quote and list marks hanging in a reserved gutter. Headings get restrained size and weight in the editor. A separate preview mode (`Mod-R`) shows the fully rendered document in the same column. Side-by-side preview is not part of v1.

## Consequences
- What you see is what is in the file. No reflow as the caret moves.
- Hanging marks require careful decoration work (bidi isolation, caret consistency, remeasuring after font changes). This is a Phase 0 spike.
- Marks count as meaningful text, so they must meet 4.5:1 contrast.
