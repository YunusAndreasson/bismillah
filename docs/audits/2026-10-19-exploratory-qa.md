# Exploratory QA — 2026-10-19

Requested by the author: drive the app, test extensively, fix confirmed bugs and
report every fix. Testing uses the real debug Tauri application through
`tauri-driver`, inside `scripts/headless.sh` with private settings, data and trash.
Documents are synthetic scratch files; the author's documents and running app are
not used. This audit follows the separate performance investigation from the same
day; its optimisations are documented in `2026-10-19-hot-paths.md`.

## Fixed issues

### 1. Frontmatter delimiter edits left previews stale

**Reproduce:** open metadata whose opening delimiter is `--- ` (with a trailing
space), with an image and reference definition inside the metadata. Type `x` after
that space and move the caret to the document's end. The metadata is now ordinary
Markdown, but the image placeholder and reference link do not appear. Toggling
Always show Markdown twice makes them appear. Conversely, appending `x` to a spaced
closing delimiter leaves an image visible even though the now-unclosed metadata
contains it.

**Cause:** the preview optimisation treated ordinary characters after column three
as local edits. A delimiter with trailing spaces defeats that assumption and can
change the interpretation of the entire document.

**Fix:** edits in old or newly recognised frontmatter rebuild the document-wide
preview fields. Ordinary prose retains its existing fast path. Undo also rebuilds
when it restores a valid delimiter. No document text is rewritten.

**Regression coverage:** unit tests for opening, closing and interior metadata
edits and creating frontmatter by deleting an invalidating character; two real-app
cases check image and reference rendering, exact text and undo.

### 2. Unclosed frontmatter contributed to the word count

**Reproduce:** open `---`, followed by `title: Hidden words` and `lang: en`, with no
closing delimiter. The status line reports five words even though the editor treats
the entire document as metadata.

**Cause:** the counter's separate regular expression excluded only closed metadata.

**Fix:** both whole-document and cached counters use the dialect's existing
`frontmatterEnd` rule. Unclosed metadata counts as zero; prose counts as soon as a
valid closing delimiter appears. Empty metadata and `...` closing delimiters follow
the same rule. This only changes the displayed count and reading-time input.

**Regression coverage:** explicit expected counts for unclosed, closed, reopened and
empty metadata, both delimiters and Arabic prose; a real-app status-line test closes
an unfinished block and checks the count changes from zero to two.

### 3. Commands could act on the document after it was trashed

**Reproduce:** open a scratch file, move it to trash, then open the command palette
on the welcome screen. Copy as rich text remains available and copies the closed
document's text to the clipboard.

**Cause:** the workspace retained its reusable editor and exposed its view through
the command context after disposing the document session. The registry promises
that this view is null when no document is open.

**Fix:** the command context now requires an active document session. Copy,
link-opening, transliteration and checking commands become unavailable after close.
Save now, Undo, Redo and Select all also explicitly require a document, so the palette
does not offer them on the welcome screen. Registry execution checks the same rule.
The reusable editor and trash Undo workflow remain intact.

**Regression coverage:** the real-app test seeds the clipboard, trashes another
file, checks seven document commands disappear, attempts rich-text copy through the
registry and checks that the clipboard is unchanged. Trash Undo restores the exact
file contents.

### 4. Enlarged text expanded narrow windows horizontally

**Reproduce:** show the specimen at 200% text size in a 640 × 600 CSS-pixel window,
then scroll to Arabic. The writing surface becomes 984 pixels wide; part of the RTL
text is off-screen and the whole page acquires a horizontal scrollbar. This was
found by inspecting real-app screenshots after the first three fixes.

**Cause:** both application grids used implicit columns with automatic minimum
sizes. The document and status line's intrinsic widths could make these columns
wider than the window.

**Fix:** both grids explicitly use `minmax(0, 1fr)`, keeping their columns within the
window. The editor's own wrapping and scrolling can then use the actual available
width. Applying just these two declarations in the real webview reduced the page,
writing surface and editor from 984 to 640 pixels without changing document text.

**Regression coverage:** the full mixed-script specimen at window widths 480, 640
and 1280, each at 200% and 300% text size. The real-app test checks both page and
editor widths against the viewport and checks the exact source after every resize.

## Exploratory checks

The scratch driver exercised actual keyboard input and app commands, beyond the
existing test suite:

| Area | Observation |
|---|---|
| Initial specimen | Opened and inspected in the actual webview |
| Undo across files | Undo in a newly opened file did not apply another file's history |
| Cut and undo | Whole-document cut/undo preserved vocalised Arabic, Latin, emoji, metadata and table source exactly |
| Palette | Unmatched query showed the empty state; Escape closed it and returned to editing |
| Settings | Escape closed the dialog without changing document text |
| Trash | Welcome appeared; Undo restored the file |
| Links | Web and mail addresses reached the harness handoff; script and file URLs were refused |
| Scrolling | Page navigation followed by typewriter movement kept the caret visible, around 42% of the scroller height, with source unchanged |
| Frontmatter and counts | Reproductions above failed before the fixes |

The first four new real-app cases failed against the original embedded frontend before
rebuilding: both delimiter cases had incorrect image counts, the unfinished block
never reached zero words, and Copy as rich text remained offered after trash.
The fifth case was added after the screenshot review found horizontal overflow.

## Verification

| Check | Result |
|---|---|
| Frontend unit tests | 357 passed across 30 files, including contrast and the added metadata regressions |
| Rust tests | 147 passed (102 + 27 + 4 + 5 + 9) |
| Real-app e2e | 188 passed across 19 spec files, including the five added regression cases |
| Type checking, formatting and typed ESLint | Passed, no errors or warnings |
| Rust formatting, Clippy and dependency checks | Passed through the standard `pnpm verify` gate |
| Accessibility | Passed: eleven screens and states, no AT-SPI problems found |
| Visual inspection | Eight standard-size and four enlarged-text screenshots inspected after all fixes |
| Visual regression and final gate | All 16 visual checks passed across four spec files; `pnpm verify` passed |
| Offline proof | Passed: 187 e2e cases passed, one expected permission case skipped; 208 network socket calls, all loopback, no external network attempts |

The tested debug binary's SHA-256 is
`1932408c491e2ab031e5a4b92c13e65057f009f9fae1224125923939cb32e71b`.
The Node-only import and both word-count implementations were also checked, because
the performance harness imports this module outside the webview.

The offline run uses `unshare --map-root-user --net` and `strace`; its trace is
`target/offline-strace.log`. The read-only-folder e2e case deliberately skips when
the process is root, because root ignores the permission bits used by that fixture.
It passed in the ordinary, non-root gate. Disk-full and rename-failure cases still
ran and passed offline. All five new regression cases passed in both runs.

The full suites cover durable saves and honest save status; injected disk-full,
rename and read-only failures; external-change conflicts; recovery after killing
the app; byte preservation and line endings; path traversal and escaping symlinks;
library creation, rename, trash, restore and watchers; quick open; spelling and
grammar suggestions and dictionaries; smart punctuation and transliteration;
Markdown reveal, tables, images, footnotes and rich-text clipboard sanitisation;
inert XSS fixtures and CSP; safe link handoff; settings and custom themes; and Arabic
shaping, caret movement, selection, hanging marks and typewriter scrolling.

## Design review

**Verdict: pass, with the manual platform checks listed below still pending.**

The review follows DESIGN.md §§2, 7–9, 11, 17–18. Fresh screenshots of the fixed
build were inspected at widths 640, 1280, 1920 and 2560 in both themes, and at 200%
text size in short 640 × 600 and 1280 × 600 windows in both themes. Vocalised Arabic
retains its marks and wraps within the writing surface. The original enlarged-text
failure is documented above; the corrected screenshots show the prose within the
window. The five review questions resolve as follows:

1. The document remains the primary content; failure and recovery controls retain
   their existing presentation.
2. File, mode and save state remain labelled; the count and closed-document command
   context now describe the current state correctly.
3. The existing grouping and alignment are retained. Grid columns fit the window.
4. Palette keyboard use and Escape were exercised, along with the existing keyboard
   tests; the accessibility tree audit covers eleven states.
5. Both themes, the four requested widths and enlarged Arabic text were inspected;
   the added real-app test also covers 300% and the 480-pixel minimum width.

Screenshots are session artifacts under `/tmp/bismillah-qa-shots-fixed/` and
`/tmp/bismillah-qa-zoom-fixed/`. Earlier overflow screenshots are in
`/tmp/bismillah-qa-zoom/`. These are scratch artifacts, not replacement baselines.
No colours, typography tokens or visual baselines were changed.

Session image evidence for the layout fix:
[before, 200% at 640 pixels](/tmp/bismillah-qa-zoom/duo-light-640.png),
[after, 200% at 640 pixels](/tmp/bismillah-qa-zoom-fixed/duo-light-640.png).

## Limits and remaining observations

- Ctrl+F did not open a Find panel. No Find command is registered. This is a missing
  capability observed during exploration, not an implemented feature repaired by
  this pass; no new search feature was added.
- Headless WebDriver testing does not establish native Wayland input/IME behaviour,
  desktop activation when opening a link, or what Orca says aloud. Existing manual
  acceptance checks remain with the author.
- One concurrent screenshot batch exited before completing. A complete rerun
  produced all eight standard-size screenshots successfully; its initial failure's
  cause was not established, so no app fix is claimed for that capture attempt.
- These fixes address reproduced failures. Passing tests do not establish that the
  application has no other bugs. Personal 1.0 acceptance remains pending.
