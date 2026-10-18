# 0012 — Live preview: Markdown shows in the caret's paragraph

- **Status:** Accepted
- **Date:** 2026-10-18 (the author's decision after the Phase 1 build)
- **Supersedes:** [0002](0002-visible-markup-editing.md)

## Context
ADR-0002 kept every Markdown mark visible (iA-style) and offered a separate preview on `Mod-R`, because hiding marks makes text jump as the caret moves. After writing with Phase 1, the author wants to see the document rendered while writing and meet the Markdown only where they are working.

Phase 0 showed that heading, quote and list marks hang in a reserved gutter through line CSS alone. Those marks can therefore appear and disappear without moving any text. Only inline marks (`**`, `_`, `` ` ``, `[…](url)`) take room inside the line.

## Decision
- **Live preview is the default.** Outside the block that holds the caret (a paragraph, heading, list item, quote paragraph or table), marks are hidden and the text is drawn rendered:
  - emphasis, strong, strike and code are styled without their marks
  - links show only their text; heading marks are hidden; list markers become bullets; quotes get a bar in the gutter; a thematic break becomes a rule
  - the frontmatter folds to one quiet line
  - local images appear below their line; remote images show a placeholder with their address.
- **The caret's block shows its Markdown,** exactly as Phase 1 draws it: marks in `syntax-marker`, block marks hanging in the gutter. The caret never sits next to a hidden mark.
- **Reveal follows the caret, never the mouse.** Text never moves under the pointer. Hovering a link or image may show its address in a tooltip, which moves nothing; the same address is in the source once the caret is in that block.
- **"Always show Markdown"** (Settings › Writing, key `always_show_markdown`, default off) keeps the Phase 1 view: every mark visible, iA-style. `Mod-R` toggles it (`view.toggleMarkdown`, *Show all Markdown*).
- **No separate preview mode.** *Copy as rich text* stays, rendered with markdown-it (raw HTML disabled) and sanitised with DOMPurify.
- Headings keep the editor's restrained scale in both states, so revealing a heading moves nothing.

## Consequences
- Entering a paragraph reflows it once if it has inline marks; writing inside it is stable. Clicking into a rendered paragraph must leave the caret on the clicked character after the reveal.
- Selecting and copying copies the Markdown source. Screen readers read the rendered text outside the caret's block.
- Hidden marks need no contrast; visible ones keep the 4.5:1 rule.
- ADR-0008's "shared component in preview" no longer applies: the Basmallah opening appears in the editor only.
- **Phase 4 starts with a spike in WebKitGTK:**
  - caret motion, selection and mouse placement across hidden marks on RTL and mixed lines
  - clicking into a rendered paragraph
  - typewriter scrolling while a block reveals
  - IME composition at the edge of the revealed block.
