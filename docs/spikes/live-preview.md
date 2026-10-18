# Spike: live preview in WebKitGTK

*Phase 4, 2026-10-19, WebKitGTK 2.54.1, Tauri 2.12, CodeMirror 6.43.* Question (PLAN.md, ADR-0012): with the Markdown hidden outside the caret's block, do caret motion, selection and mouse placement still match what is drawn on RTL and mixed lines? Does a click into a rendered paragraph leave the caret on the clicked character after the reveal? Does typewriter scrolling hold while blocks reveal, and does IME composition survive at the edge of the revealed block?

**Verdict: go.** Evidence: `tests/e2e/spikes/live-preview.e2e.ts` (21 tests on `tests/fixtures/live-preview.md`), `spikes/webview/composition.ts` (6 cases with real dead keys) and `src/editor/livePreview.test.ts`.

## How it is built (`src/editor/livePreview.ts`)

- **Two kinds of hiding.** Marks inside the line (`**`, `_`, `` ` ``, `[`, `](url)`, `\`) are *replaced*, so the text closes up; entering such a block reflows it once, as ADR-0012 accepts. Marks that hang in the gutter or fill their own line (`#`, `>`, list markers, task boxes, `---`) stay in the text and are only *painted out*. Bullets, quote bars, task boxes and rules are drawn as backgrounds where the marks stand, so revealing them moves nothing and the caret model and DOM order never change.
- **The revealed block** is the leaf block holding the selection's head (a paragraph, heading, task, table, code block, frontmatter, rule), all its lines, together with the caret's own line, so the caret never sits beside a hidden mark.
- **`[sic]` keeps its brackets.** A shortcut or full reference link is shown as a link only when its label is defined in the document, as CommonMark says; footnote references only when their note exists.

## Results

| Question | Result |
|---|---|
| Mouse placement | Clicking the left or right quarter of a letter in a rendered line puts the caret on that side of it after the reveal, for Arabic and Latin letters, including every letter next to a hidden mark (8 lines: mixed, RTL, list items, a quote, an Arabic heading) |
| Clicking into a rendered paragraph | The block reveals when the button is released, and the caret's row keeps its height on screen (within 3 px), even when the reveal rewraps the paragraph above the caret |
| Double-click | Selects the word that was clicked, although the first click's reveal moved the text under the pointer |
| Selection | A selection reaching into a rendered line highlights exactly its glyphs; the anchor's line stays rendered |
| Caret motion | Walking the document with ↓ reveals the caret's block at every step; → and ← into a block land beside its hidden edge mark (`**` at an RTL line's start, the closing `` ` `` of an Arabic heading) and reveal it |
| Typewriter scrolling | The caret stays at 42 % (±2 px) while blocks reveal and fold above it |
| IME composition | A dead key (GTK's input method, real `compositionstart`/`compositionend`) composes exactly at a block's start before a hidden mark, at its end beside a rendered block, at a list marker, on a blank line, in an RTL line, and on a line that joins the rendered paragraph above (which reveals mid-composition) |

## Rules settled by the spike

- **The reveal waits for the button's release.** Revealing on mousedown moved text under a drag. At the release the view scrolls so the caret's row stays put. The one exception is a document's last screen: when the document can't scroll further, the row may move down by the rows the reveal added.
- **A double- or triple-click after a revealing click is anchored to the character the first click chose,** not to the pointer (CodeMirror reads the second click's position fresh; without the anchor it selected the neighbouring word).
- **In rendered lines, bidi isolates cover only drawn text:** the code without its hidden backticks, an autolink without its brackets, nothing for a link's hidden address. An isolate whose edges are hidden marks is measured from those marks, and the selection missed the first letter of `notes.md` inside Arabic (`bidi.ts`).
- **Stand-ins are backgrounds, never masks or generated content.** WebKitGTK paints a CSS mask on an inline span inverted (the box became a filled rectangle), and an inline-block shifted the text.
- **The Phase 0 bidi and hanging-mark spikes test the Phase 1 view,** so they now run with *Always show Markdown* on.

## Not covered headless

- fcitx5 on Wayland (the author's input path), as in the Phase 0 keyboard spike: a manual check.
- Hover tooltips and focus rings, which need a focused window.
