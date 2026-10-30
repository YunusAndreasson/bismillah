# 0019 — A formatting bar over the selection

- **Status:** Accepted
- **Date:** 2026-10-30 (the author's request: "similar to how Notion works")

## Context
bismillah had no formatting commands: a writer typed every Markdown mark by hand. The author asked for a bar over selected text, as in Notion, with formatting and the font.

Two things stand in the way. Chrome that appears over the text by itself sits against DESIGN.md §2, principles 1 and 8 (*the text comes first*, *no unsolicited prompts*). And Markdown can't store a font for a span of text: the only way would be raw HTML, which live preview shows as text (ADR-0012) and which other Markdown tools may strip. Notion's selection bar has no font control either; it sets the font per page.

## Decision
- **A bar appears over a selection the writer made**, on the mouse's release or after a pause in `Shift`+arrows. It holds Bold, Italic, Strikethrough, Code, *Turn into* (Text, Heading 1–3, Quote, Bulleted list, Numbered list) and the writing font.
- **It keeps the writing calm.** It never appears while typing or for a match from Find; typing or collapsing the selection puts it away; nothing about it moves; focus stays in the text until `F6`; and Settings › Writing › *Formatting bar* turns it off.
- **Everything it writes is Markdown (the author's condition).** It only inserts or removes standard marks: CommonMark's, and GFM's `~~`, which bismillah's dialect already reads. Before a mark is added, the app's own parser must read the result as that mark; if it wouldn't (`**"word"**x` is only asterisks), the button is disabled and the command does nothing. There is no empty pair at a caret: `****` is a rule and `~~~~` a code fence, so a caret takes the word it is in, or nothing. There is no underline, colour or per-word font, because Markdown has none of them.
- **The font control is the app-wide writing font,** the same setting as Settings › Font. It changes how every document is shown and never touches a file, and the menu says so.
- **Every action is also a command** with a rebindable shortcut, under a new *Format* menu (DESIGN.md §13).
- **No link button:** `Mod-K` is Search, links never open (ADR-0015), and it would need an address field.

## Consequences
- The writer's text is still only changed by explicit, undoable actions: each is one undo step, and the words between the marks are never rewritten. A mark can't land between a letter and its vowel marks.
- A disabled button can puzzle: `"word"x` can't be bold until a space follows the quotation mark. That is what Markdown does, and writing asterisks that don't work would be worse.
- `Mod-I` takes the place of CodeMirror's select-parent-syntax, and `F6` was unused. `Alt-F10`, the usual toolbar key, isn't available: `F10` is the menu's and `Alt` alone opens it.
- The bar covers the row above the selection while it shows, as any such bar does.
- Tests: `src/editor/format.test.ts`, `formatBar.test.ts`, `tests/e2e/format-bar.e2e.ts`, `tests/visual/format-bar.visual.ts`.
