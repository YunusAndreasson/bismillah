# Spikes: hanging marks and bidi

*Phase 0, 2026-10-18, WebKitGTK 2.54.1, Tauri 2.12, CodeMirror 6.43.* Both questions were answered in the real app with WebDriver tests that read where WebKit actually draws the caret, glyphs and selection: `tests/e2e/spikes/hanging-marks.e2e.ts` and `bidi.e2e.ts`, with `tests/fixtures/bidi.md`.

**Hanging marks: go. Bidi: go,** with one documented property of all bidi editors (boundary slots, below).

## Hanging marks

**How:** `src/editor/hangingMarks.ts` gives each line with marks a line decoration that sets `padding-inline-start` and a negative `text-indent` (via CSS variables). The prefix (`# `, `> > `, `10. `) is measured once per typography in a hidden element inside the editor, so the width is exact in any font, size or weight, and re-measured when fonts load or the profile changes. Only CSS changes: the text, DOM order and CodeMirror's caret model are untouched. Logical properties mirror everything on RTL lines.

**Rules settled by the spike:**
- Heading `#`s, every quote `>` and the list marker hang; task boxes `[ ]` stay on the reading edge.
- **Nested lists indent by marker widths, not by the source's spaces.** The first version used the width of the leading spaces, which only worked in duospaced Duo; in Source Serif a nested marker landed 12px off. Now a nested item's marker sits under its parent's text in any font, and continuation lines align with the item's text.
- The gutter is the width of the widest standard prefix (`###### ` at h6 size), measured per profile.

**Verified in WebKitGTK, Duo and Source Serif, LTR and RTL** (14 tests): heading, list, quote and `10.` text starts on the paragraph's reading edge (±0.5px); marks sit in the gutter; nested markers sit under the parent's text; wrapped headings return to the reading edge in both directions at 640px; ArrowLeft/Right and Home move through the marks; clicking a mark places the caret on it.

**Not testable headless: IME composition.** Hanging changes only line CSS, never text during composition, so it can't interrupt an IME; dead keys and compose (which use the same composition path in GTK) were tested in the keyboard spike.

**Follow-up for Phase 1:** at 640px the measure drops to ~36 characters because the gutter reserves room for `###### ` on both sides. Consider sizing it for `### ` and letting h4–h6 marks use the outer padding.

## Bidi

**How:** `src/editor/bidi.ts` sets each line's `dir` from the first strong character of its Markdown block, skipping marks, URLs, inline code and link destinations, so `- عنصر` is RTL and `[الصفحة](https://…) inside English text` is LTR. Lines of one paragraph share its direction; blank lines follow the text above; code and frontmatter are LTR. Inline code and URLs are wrapped in `unicode-bidi: isolate` with `dir=ltr` **and** registered through `EditorView.bidiIsolatedRanges`, so CodeMirror's cursor motion knows about the isolates. `EditorView.perLineTextDirection` is on.

**Verified** on five mixed lines (Arabic inside English, Latin inside Arabic, a URL and inline code inside Arabic, numbers inside Arabic), 16 tests:
- every line gets the expected direction;
- **cursor movement matches the visible order:** walking ArrowRight from the visual left end, the drawn caret always moves right, never stands still, and visits every glyph edge of the line;
- **selection matches:** for a selection crossing direction boundaries, every selected glyph (and no other) lies inside the drawn selection;
- **mouse placement matches:** clicking the left or right quarter of a letter puts the caret on that side of it, for Arabic and Latin letters.

**Boundary slots (a property, not a bug).** Where an embedded run meets the paragraph (e.g. *Markdown* inside Arabic), two logical positions share one visual caret slot. CodeMirror stops there once and assigns one of them; WebKit's native `<textarea>` does the same but assigns the other one at the run's trailing edge (probe in the spike log). At such a slot, a character of the *other* script lands on the far side of the embedded run. Both editors behave this way; a direction-aware insertion at boundary slots could be a later refinement, not a Phase 1 requirement.

## Found on the way

- **The CSP blocked CodeMirror's base styles.** CodeMirror injects a `<style>` element; `style-src 'self'` blocks it, which silently broke caret drawing, the selection layer and `white-space: pre-wrap`. Tauri adds a fresh nonce to inline `<style>` elements in `index.html` on each load, so `index.html` carries an empty one and `setup.ts` passes its nonce to `EditorView.cspNonce`. The policy stays strict (an e2e test asserts no CSP violations).
- `setAttribute("style", …)` is also blocked by the CSP; style changes must go through CSSOM (CodeMirror already does).
- CodeMirror parses big documents in the background; screenshots and probes must call `forceParsing` first (the test hooks' `settle()` does).
