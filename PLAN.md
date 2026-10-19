# bismillah — Roadmap

What gets built, in what order, and how each phase is accepted. **The how lives elsewhere:** design in [DESIGN.md](DESIGN.md), architecture in [ARCHITECTURE.md](ARCHITECTURE.md), decisions in [docs/decisions/](docs/decisions/).

*Revision 2, 2026-10-18.* Incorporates the [plan review](docs/reviews/2026-10-18-plan-review.md). Main changes from revision 1:
- Declarative themes first; executable plugins deferred.
- A file-safety contract with recovery, and `Mod-S` kept.
- A smaller font set with per-font profiles; stable writing size (no viewport scaling); a corrected contrast floor of 4.5:1.
- Script-run language routing with UTF-16 offsets and stale-result discarding.
- Zuhd mode; the Basmallah opening.
- Native window decorations by default; settings, accessibility, recovery and real Tauri e2e testing moved earlier.

---

## Phase 0 — Spikes (decide before building)

Each spike ends with a short written result in its ADR: **go**, **adjust** or **no-go**.

| Spike | Question | Accept when |
|---|---|---|
| Hanging marks | Can headings, quotes and nested list marks hang in the gutter in Duo and Source Serif, in LTR and RTL, without breaking caret motion, selection, mouse placement or IME? | All behave correctly in WebKitGTK on the specimen |
| Bidi | Do per-line direction and bidi isolation work for mixed paragraphs, wrapped RTL headings and URLs inside Arabic? | Cursor movement and selection match the visible order |
| Font profiles | Do the four starting profiles (DESIGN.md §8.3) hold up with real text, including vocalised Arabic and mixed lines? | No clipped diacritics; measures close to target; values recorded as tokens |
| Arabic speller | `spellbook` vs `hunspell-rs` with Ayaspell: correctness and suggestions on a word benchmark | A choice recorded in ADR-0004 |
| Harper | Latency on a 50k-word document, block by block | < 50ms per typical batch |
| Basmallah | Block widget above line 1, outside the document: does it work with scrolling, typewriter mode, caret at the start, restoring scroll? | No caret or scroll anomalies |
| Real-app testing | Run `tauri-driver` on Linux headless (`xvfb-run`), with an offline run via `unshare -rn` and a screenshot capture for visual regression. Build the helpers the `run-app` skill names (`pnpm app:shot`, `pnpm test:e2e`). | One green e2e test and one screenshot comparison in `pnpm verify`; one command produces specimen screenshots at the four widths without touching the author's desktop |
| Uthmani + transliteration glyphs | Do Amiri Quran (for runs with Qur'anic marks) and the Latin fonts (for IJMES ā ī ū ḥ ṣ ḍ ṭ ẓ ʿ ʾ) render correctly in WebKitGTK, including caret movement through stacked marks? **Duo lacks ḥ ṣ ḍ ṭ ẓ ʿ ʾ**: choose and build the matched fallback (see the options in fonts/README.md). | Pasted Uthmani verses from tanzil/quran.com render and round-trip unchanged; no missing glyphs |
| Native menu | Can a menu generated from the command registry be hidden on Linux and revealed with `Alt`/`F10`, with accelerators that don't fight CodeMirror's keymap? | Works under Hyprland and GNOME |
| Keyboard input | Do XKB layout switching (English ↔ Arabic), dead keys and compose sequences behave in the editor? Does the proposed transliteration table (DESIGN.md §11.3) avoid collisions on a corpus of English and transliterated prose? | No lost or doubled characters; transliteration table finalised |

### Phase 0 result (2026-10-18): accepted by the author

Evidence and verdicts per spike: [docs/spikes/](docs/spikes/README.md). Results are recorded in ADRs 0002, 0004 and 0007–0010.

| Spike | Verdict |
|---|---|
| Hanging marks · Bidi · Basmallah · Real-app testing · Native menu · Keyboard input | **go** |
| Arabic speller | **go: spellbook** (Hunspell binding rejected) |
| Font profiles | **adjust**: Serif measure 30em; taller line boxes for vocalised and Qur'anic runs |
| Harper | **adjust**: p95 over 50 ms; suggestions on demand; masking; curated defaults |
| Uthmani + transliteration glyphs | **adjust**: Bismillah Duo/Mono close the IJMES gap; WebKitGTK misplaces Arabic marks |
| Transliteration table | **adjust**: `a=` for macrons, guards for abbreviations and code |

**The author's decisions (2026-10-18)**
1. **Arabic mark rendering:** [ADR-0011](docs/decisions/0011-arabic-mark-rendering.md) accepted as proposed: Amiri pairing everywhere, the Basmallah opening drawn from pre-shaped outlines, the rendering check in `pnpm test:visual`, and a choice between a patched WebKitGTK and accepting the errors after daily use.
2. **WebKit bug 255972:** we draft the comment and patch; the author posts it.
3. **Typing aids:** `a=` for macrons and the alef-wasla Qur'anic trigger confirmed.

**Manual checks only the author can do (≈5 minutes, live Hyprland session)**
- `pnpm tauri dev`, then type with fcitx5 active: Swedish dead keys (´ e → é), Compose (Shift+Caps, - a → ā), and, if an Arabic layout is added, switch layouts mid-word. Nothing should be lost or doubled.
- Press `Alt` alone and `F10`: the menu bar appears with File focused; `Esc` hides it. `Ctrl+Z`, `Ctrl+T` act once.
- Look at the specimen's Arabic and Qur'anic sections (`pnpm app:shot -- --profiles duo,serif,amiri --scroll-to "## Arabic"` writes screenshots to `target/shots/`).


## Phase 1 — Writing core

- Scaffold (Tauri 2 + Svelte 5 + TS + Vite + Bits UI), local git, `pnpm verify` (all checks, `cargo deny` included), lint/format/check.
- Local `PKGBUILD` so bismillah can be installed and used daily on this machine from Phase 1.
- `tokens.css` (primitive + semantic, light and dark), contrast unit test, bundled fonts with licences, writing profiles.
- Editor: visible-markup styling, hanging marks, caret and selection rules, bidi, heading hierarchy, frontmatter styling.
- **File-safety contract:** open/save a single file, serialised atomic writes, line endings/BOM preserved, `Mod-S`, typed failures, conflict detection, recovery journal.
- Zuhd mode (paragraph by default), typewriter scrolling (on by default, about 42%), status line with honest save state, Basmallah opening (on by default, can be turned off).
- Typing aids (DESIGN.md §11.3): smart punctuation (on by default, « » in Arabic runs) and IJMES transliteration mode, both undone by an immediate Backspace.
- Minimal settings: theme, writing profile, size, measure, line height, chrome fading, all persisted.
- Desktop basics (ADR-0009): native menu, remembered window state, minimum size, `filename — bismillah` title, open a file from the command line or by drag-and-drop, single instance, flush saves on quit.
- Accessibility pass on everything above.

**Accept:**
- The specimen looks right in the real app at all four test widths, in both themes.
- Saving round-trips vocalised Arabic, mixed text and CRLF unchanged.
- A killed process leaves restorable text.
- Fault-injected saves fail visibly with the text preserved.

### Phase 1 result (2026-10-18): built; the author moved on to Phase 2 the same day

Everything above is in place and `pnpm verify` passes (159 unit and contrast tests, 39 Rust tests, 84 real-app e2e tests, the visual suite with the Arabic rendering check) and so does `pnpm test:offline`. Acceptance, with its evidence:

| Accept | Evidence |
|---|---|
| The specimen at 640/1280/1920/2560, both themes | `pnpm app:shot` screenshots; visual baselines re-recorded (headings now hang on the reading edge, status line at the bottom) |
| Saving round-trips vocalised Arabic, mixed text and CRLF | `tests/e2e/file-safety.e2e.ts` (LF, CRLF, BOM + CRLF, no final newline) and `documents.rs` unit tests |
| A killed process leaves restorable text | `tests/e2e/recovery.e2e.ts`: SIGKILL while saves fail, restart, *Restore*, saved |
| Fault-injected saves fail visibly with the text preserved | disk-full and rename faults injected in the real app: notice, *Not saved — …*, original intact, text in recovery, *Try again* saves |
| Offline | `pnpm test:offline`: the whole e2e suite with no network, loopback-only socket calls |

Choices made along the way (recorded in ARCHITECTURE.md): the frontend never sends a path; recovery entries are kept per session; a Unix socket replaces `tauri-plugin-single-instance` (its `zbus` stack is flagged unmaintained) and `state.rs` replaces `tauri-plugin-window-state`; other files' recovered text is mentioned at launch only. New command: `file.open` (*Open…*, `Mod-O`); `file.quickOpen` is renamed *Quick open…* for Phase 2.

**Not done in Phase 1**
- Collapsible frontmatter (DESIGN.md §11): styled, not yet foldable; it needs a fold control that fits the visible-markup design.
- Screen-reader check with Orca: headless runs have no accessibility bus, so it is a manual check below.

**For the author**
1. **Install and use it:** `cd packaging/arch && makepkg -si` builds the committed HEAD and installs `bismillah` with its desktop entry (Open with… for Markdown files).
2. **Post the WebKit comment** when you're ready: `docs/upstream/webkit-255972.md` has the text, the steps and the patch.
3. **A design question (DESIGN.md §7):** a gutter for hanging marks is *always* reserved, sized for `###### `. In a narrow window with very large text (480 px at 3×, or 640 px at 2×), the two gutters take most of the width. Options: keep it; cap the gutter and let only rarer marks overflow; or stop hanging marks below a width. Not changed without your call.
4. **Manual checks (live session, about 10 minutes):** Orca reads headings, the Settings controls and a save failure; typing with fcitx5 (dead keys, Compose, an Arabic layout); a file dropped from the file manager opens; `bismillah file.md` from a terminal while the app runs hands the file over; the window comes back at its size.

## Phase 2 — Library

Choose a library root; Rust path validation (traversal and symlinks); tree with docked/overlay behaviour (DESIGN.md §7); quick open with parent paths; command palette with aliases; library actions in the native menu; file actions (new, rename, new folder, trash with undo); watcher plus conflict bar.

**Accept:** keyboard-only use of every library action; duplicate filenames can be told apart; attempts to escape the root are rejected in tests.

### Phase 2 result (2026-10-18): accepted by the author

Everything above is in place and `pnpm verify` passes (178 unit and contrast tests, 60 Rust tests, 98 real-app e2e tests in 11 suites, 7 visual checks including two new library baselines), and so does `pnpm test:offline`.

| Accept | Evidence |
|---|---|
| Keyboard-only use of every library action | `tests/e2e/library.e2e.ts`, all through real key presses: `Mod-\` into the tree, arrows, `→`/`←`, type-ahead, `Enter` to open, `F2` rename (taken names explained, nothing replaced), `Mod-Shift-N` new folder, `Delete` then *Undo*, `Mod-P` quick open, `Mod-Shift-P` palette by alias, `Esc` back to the text, and the narrow-window overlay |
| Duplicate filenames can be told apart | Quick open shows each file's folders (`notes.md · Notes`, `notes.md · Essays`); `src/core/fuzzy.test.ts` |
| Attempts to escape the root are rejected in tests | `library.rs` unit tests (`..`, absolute paths, empty parts, links out, creating through a link, the root itself) and the e2e suite calling the Rust commands directly with escaping paths: every one refused, nothing outside touched |

What else came with it: the watcher (another program's change reloads a clean document quietly and shows the conflict bar over local edits, with no focus event or polling); trash with *Undo* (the private trash in tests, a stand-in in Rust tests); a rename moves the open document, its recovered text and the remembered files with it; folders from the command line, a drop or a second launch; *Open folder…* on the first screen; natural, catalogue-style order ("ʿIlm" under I, "Ḥadīth" under H, Arabic-Indic numbers by value); matching that ignores diacritics, vocalisation and ʿ ʾ.

**Changed from the plan (DESIGN.md §13)**
- *Move to trash* is `Delete` in the library, not `Mod-Backspace`: `Ctrl+Backspace` deletes the previous word in every Linux text field and must never trash a file.
- `Mod-\` from the keyboard moves focus into a library that is already shown; pressed in the library, it hides it. The menu and the status-line button simply show or hide it.

**Not done in Phase 2**
- Which folders are open in the tree is kept for the session only, not across launches.
- Changes inside a folder reached through a link are found on focus, not by the watcher, which doesn't follow links.

**For the author**
1. **Install and try it:** `cd packaging/arch && makepkg -si`, then *Open folder…* (`Ctrl+Shift+O`) on your writing folder.
2. **Confirmed (2026-10-18):** `Delete` for *Move to trash* (above), and file endings shown quietly in the library (`letter` + `.md` in `text-secondary`) rather than hidden.
3. **Still open from Phase 1:** the hanging-mark gutter in narrow windows at large text (DESIGN.md §7), and the manual checks listed there.
4. **Manual checks (live session, about 10 minutes):** Orca reads the tree (levels, open/closed folders, the selected file) and the palette; dropping a folder from the file manager makes it the library; *Move to trash* puts a file in your real trash and *Undo* brings it back, also on a USB disk (its own `.Trash-1000`); `Alt` shows the File menu with the new library items.

## Phase 3 — Spelling and grammar

`bismillah-lint` crate (Harper + the chosen Arabic adapter); script-run routing with a `lang:` override; UTF-16 offset conversion; revision tagging and discarding of stale results; diagnostics with distinct underline patterns; suggestion popover; `F7` navigation; personal dictionary; switches for spelling and grammar.

**Accept:** fixture suites for English, Arabic (with and without diacritics), mixed text and masked regions; a stale-result test; no flagging of unsupported scripts.

### Phase 3 result (2026-10-18): accepted by the author

Everything above is in place (ARCHITECTURE.md §7, ADR-0004 "Phase 3 result"), and `pnpm verify` passes (210 unit tests, 113 Rust tests including the checking fixtures and the Arabic benchmark, 112 real-app e2e tests in 12 suites, 7 visual checks with the specimen baselines re-recorded for the new underlines), and so does `pnpm test:offline`.

| Accept | Evidence |
|---|---|
| Fixture suites: English, Arabic (with and without diacritics), mixed text, masked regions | `crates/bismillah-lint/tests/fixtures/*.txt`, one block per line with the expected marks: `english`, `arabic`, `mixed`, `masked`, `routing`; plus the Phase 0 Arabic benchmark (all 414 correct words accepted, corrections for ≥ 80% of misspellings) and the `hunspell` oracle |
| A stale-result test | `src/editor/linter.test.ts`: a block edited while its request is out drops its results and is checked again, and an untouched block's results move with the text; `diagnostics.test.ts`: an edit touching a mark removes it |
| No flagging of unsupported scripts | `mixed.txt` (Greek, Cyrillic, Hebrew, Devanagari, Japanese), `routing.txt` (`lang: fa`, `ur`, `de`, `sv`), and the Qur'anic and IJMES lines in the fixtures and the real app |

In the real app (`tests/e2e/checking.e2e.ts`): marks in both scripts and none on Qur'anic text, transliteration, code or URLs; `F7`, `Shift-F7`, `Mod-.` and a right-click open the suggestions, all by keyboard; *Replace* is undoable; *Ignore*; *Add to dictionary* writes `dictionary.txt`, and edits made to it elsewhere apply on focus; the switches and the dialect in Settings.

What else came with it:
- **What is prose is decided by the editor's own syntax tree**, so code, URLs, link targets, HTML, footnote references and Markdown marks are never read, and a correction can never delete a mark.
- **`lang:` in frontmatter routes the runs of its own script** (`lang: fa` leaves Arabic-script runs alone, `en-US` chooses American spelling); British spelling by default, as the docs are written.
- **Grammar means grammar:** no style advice (title case, the Oxford comma, long sentences, "very good" → "excellent"), nothing smart punctuation already does, no judging of words.
- **Common Arabic misspellings** that the dictionary's affix rules accept (حتي، متي، ذالك، الرحمان، قالو…) are caught, with the correction first.
- Measured: one edited paragraph takes 8–25 ms at the median and up to 160 ms at p95 on 50,000-word texts, so results land within 500 ms of a typing pause (ARCHITECTURE.md §14). A first pass over 50,000 words runs in the background, visible blocks first; a reopened document is answered from the session cache.
- Fixed on the way: a settings change rebuilt every editor switch (and the Basmallah opening, dropping a selection in it) even when nothing about it had changed.

**Changed from the plan**
- Superseded requests are never queued in Rust rather than dropped there: the editor keeps one request in flight (ADR-0004, Phase 3 result).
- A paragraph longer than about 3,000 words (only pasted text makes one) gets spelling only, and one longer than about 16,000 words isn't checked: Harper's cost grows faster than the text.
- Two switches were added to the Edit menu and the palette, *Check spelling* and *Grammar suggestions* (no default shortcut), beside the commands of DESIGN.md §13.

**Not done in Phase 3**
- Words written in plain Latin letters but taken from Arabic (*Ibn*, *Taymiyya*, *Uthmani*, *Qur'anic* with a straight apostrophe) are unknown words until added to the dictionary; no list of them ships, because each entry would be a guess about how the writer spells.
- Spelling for transliterated words (IJMES letters): they are never marked, so a typo in *ḥadīth* goes unnoticed.

**For the author**
1. **Confirmed (2026-10-18):** it looks right in the real app, with the defaults as built (British spelling, both switches on).
2. **Add your recurring names and terms** with *Add to dictionary*, or list them in `~/.config/bismillah/dictionary.txt`, one per line.
3. **Manual checks (live session, a few minutes):** the first correction is highlighted when the suggestions open (headless runs can't show focus); Orca reads a marked word as a spelling or grammar issue and announces the menu's kind and explanation; a right-click on a marked word opens the suggestions rather than WebKit's menu.
4. **Still open from earlier phases:** the hanging-mark gutter question (Phase 1, item 3) and the manual checks of Phases 1 and 2.

## Phase 4 — Live preview

*Changed 2026-10-18 (ADR-0012): live preview in the editor replaces the separate preview mode.*

- **Spike first** (WebKitGTK, the specimen): caret motion, selection and mouse placement across hidden marks on RTL and mixed lines; clicking into a rendered paragraph; typewriter scrolling while a block reveals; IME composition at the edge of the revealed block. Verdict recorded in ADR-0012.
- Rendered state outside the caret's block: styled emphasis without marks, link text only, bullets, quote bars, rules, folded frontmatter, local images below their line (scoped to the library root), placeholders for remote images, footnote references. The caret's block shows its Markdown as in Phase 1.
- Link and image addresses in a tooltip on hover (moves nothing). "Always show Markdown" setting and `Mod-R` (*Show all Markdown*).
- **Copy as rich text:** markdown-it with the shared dialect (ARCHITECTURE.md §11), raw HTML disabled, DOMPurify; HTML and plain text on the clipboard.

**Accept:** the specimen at all test widths in both themes, rendered and revealed; caret, selection and mouse placement tests pass on RTL and mixed lines in both states; clicking into a rendered paragraph keeps the caret on the clicked character; "Always show Markdown" matches Phase 1 exactly; an XSS fixture suite stays inert in the editor and on the clipboard.

### Phase 4 result (2026-10-19): built; the author moved on to Phase 5 the same day

The spike came first and its verdict is **go** ([docs/spikes/live-preview.md](docs/spikes/live-preview.md), ADR-0012). Everything above is in place, and `pnpm verify` passes (259 unit tests, 118 Rust tests, 153 real-app e2e tests in 15 suites, 13 visual checks with six new rendered baselines, counted after the tables and code below), and so does `pnpm test:offline`.

| Accept | Evidence |
|---|---|
| The specimen at all test widths in both themes, rendered and revealed | `pnpm app:shot -- --markdown rendered` and `--markdown shown` at 640/1280/1920/2560, light and dark, reviewed (the caret's block revealed in each); visual baselines of the rendered specimen: top, lists and quotes, code, table, Arabic, mixed lines |
| Caret, selection and mouse placement on RTL and mixed lines, in both states | Rendered: `tests/e2e/spikes/live-preview.e2e.ts` (clicks on eight mixed, RTL, list, quote and heading lines, every letter beside a hidden mark included; selections into rendered lines; ↓ through the document; → and ← across hidden edge marks; typewriter scrolling at 42 %). Shown: the Phase 0 bidi and hanging-mark spikes, now run with *Always show Markdown* on |
| Clicking into a rendered paragraph keeps the caret on the clicked character | The same spike: a click on the left or right quarter of a letter leaves the caret on that side of it after the reveal, its row at the same height; a double-click selects the clicked word although the first click moved it. In tables, `tests/e2e/live-preview-blocks.e2e.ts` does the same on an English and an Arabic grid (letters beside hidden marks included), with the caret drawn in the clicked row during the press |
| "Always show Markdown" matches Phase 1 exactly | With it on, the specimen screenshots matched the Phase 1 baselines unchanged. Those baselines also held a stray panel: the library visual spec's folder, remembered within a run and missing by then ("Writing" isn't available). The specimen spec now closes the library first, and the two baselines were re-recorded without the panel. `tests/e2e/live-preview.e2e.ts`: after `Mod-R` no rendered decoration is left and every line is drawn as its source, and `Mod-R` brings live preview back |
| An XSS fixture suite stays inert in the editor and on the clipboard | `tests/fixtures/xss.md` (script, event handlers, scripted and data URLs in links, images, autolinks and references, SVG, iframes, forms, styles, HTML in footnotes, tables and tasks): `src/richText/render.test.ts` and `live-preview.e2e.ts` (the caret through every block and the links hovered and clicked: no script ran, no element that can run or load anything, no CSP violation; the copied HTML checked the same way) |

What else came with it:
- **The rendered look** (DESIGN.md §11): bullets, numbers, task boxes, quote bars through every row, a short centred rule, inline code on a quiet ground, underlined link text, raised footnote references, all drawn where the marks stand so revealing them moves nothing. A scholarly `[sic]` keeps its brackets: reference links and footnotes render only when defined.
- **The frontmatter** folds to one line of its keys, and a newly opened document starts on its first line of text below it.
- **Local images** below their line, through bismillah's own image scheme with the library's path checks (`images.rs`: `..`, absolute paths, `file:` URLs and links out of the library refused alike). Images from the web are never loaded; a quiet note shows the address. Addresses of links and images in a tooltip on hover.
- **Copy as rich text** (`Mod-Shift-C`, Edit menu): the selection or the whole document without its frontmatter, as sanitised HTML and plain text through GTK's clipboard; another X client reads both (`spikes/webview/rich-text-clipboard.ts`).
- **The mouse:** the reveal waits for the button's release, so nothing moves under a press or a drag.

**After the author's first look (2026-10-19):** tables and code blocks weren't rendered, and now are (DESIGN.md §11, ADR-0012).
- **Tables** are drawn as grids (`previewTables.ts`): columns aligned as the delimiter row says, the header over a rule that takes the delimiter row's line, every row one line high, so a table whose cells don't wrap reveals without moving. Cells are drawn as the text around them, an Arabic table reads from the right, and wide tables wrap their cells within the measure. A click lands on the clicked character, a double-click selects the clicked word, and ↑ ↓ step into a table (CodeMirror's vertical motion would skip the grid).
- **Code blocks** sit on a ground with their fences painted out and the info string as a quiet label; revealing one moves nothing.
- **Code's ground is now `surface-code`**, translucent, for inline code too: the opaque `surface-panel` hid the selection CodeMirror draws behind the text. It draws the panel's colour on the editor (a contrast test checks it, and text on it with a selection behind).
- Quote marks inside a quoted code or HTML block now get their bars as well.

**Changed from the plan**
- The command is labelled *Always show Markdown*, the setting's own name (DESIGN.md §6 asks for one name everywhere), not *Show all Markdown*.
- Local images come through a custom scheme checked by our own path code instead of Tauri's asset protocol, and the clipboard is GTK's instead of `tauri-plugin-clipboard-manager` (ARCHITECTURE.md §2, §6).

**Not done in Phase 4**
- Tables inside quotes and list items keep their Markdown (with inline marks hidden). Spelling marks, search matches and the address tooltip aren't drawn inside a rendered grid; they appear once the caret is in the table.
- A code block's `>` marks inside a quote don't hang (a Phase 1 rule for code lines), so its bars sit at the text rather than in the gutter.
- Opening a link in the browser on `Mod-click` (ARCHITECTURE.md §10, planned with `tauri-plugin-opener`).
- Hovering the image itself shows no address (hovering its line does).
- On a document's last screen, where it can't scroll further, a click's reveal may push the clicked row down.

**For the author**
1. **Install and try it:** `cd packaging/arch && makepkg -si`, then write in a document with emphasis, links and quotes: click into paragraphs, move through them with the arrows, and press `Ctrl+R` for *Always show Markdown*.
2. **Design questions (none blocks acceptance):** the rule for `---` is short and centred (6em) rather than the full measure; a done task is a box with a filled centre rather than a check mark; a code block's fences leave a full line of ground above and below the code.
3. **Manual checks (live session, a few minutes):** composing with fcitx5 at the start and end of a block; the address tooltip on hover; Orca reads rendered text without its marks; pasting *Copy as rich text* into a mail client or LibreOffice on Wayland.
4. **Still open from earlier phases:** the hanging-mark gutter question (Phase 1, item 3) and the manual checks of Phases 1–3.

## Phase 5 — Themes and settings complete

Declarative theme files with validation and contrast warnings; a high-contrast built-in override; full settings screen (Appearance · Writing · Language & checking · Files & privacy); `keybindings.toml` with live reload; About screen with a short statement of the project's inspiration and the licences.

**Accept** (set when the phase was built): a theme file applies as soon as it is saved and its problems are listed in plain words; high contrast holds 7:1 for text in both variants and overrides any theme; every setting DESIGN.md describes is on the one Settings screen and works from the keyboard; `keybindings.toml` changes shortcuts in the editor, the menu and the palette as soon as it is saved, and refuses keys that belong to the text; About states the inspiration and every shipped part's licence.

### Phase 5 result (2026-10-19): built; the author moved on to Phase 6 the same day

*Changed while building, at the author's word (2026-10-19): only a few themes for now, because the author plans a set of their own.* So two themes are built in, Sepia and Slate, as theme files in the very format a writer uses (`src-tauri/themes/`): the coming set is files, not code.

Everything above is in place, and `pnpm verify` passes (335 unit tests, 139 Rust tests, 166 real-app e2e tests in 16 suites, 16 visual checks with three new baselines: the specimen in high contrast, light and dark, and Settings), and so does `pnpm test:offline`.

| Accept | Evidence |
|---|---|
| A theme file applies as soon as it is saved, its problems listed in plain words | `tests/e2e/settings.e2e.ts`: a file written into the config folder appears in Settings, applies per variant, and an edit applies without the window regaining focus; unknown keys and low contrast are listed ("Dark: text-secondary is 2.2:1 on surface-editor, 1.9:1 on surface-panel and 1.9:1 on surface-code, and text needs 4.5:1."); a broken chosen theme falls back with a notice and *Show in Settings*. `themes.rs` tests: TOML and JSON, every kind of problem, line numbers, names taken, the 64 KiB limit, built-in themes without a single problem and prose above 7:1, bismillah's colours equal to `tokens.css` |
| High contrast holds 7:1 for text in both variants and overrides any theme | `tokens.test.ts` (every text pair ≥ 7:1, both variants set every colour themselves); the e2e test switches it on over Slate in light and dark; visual baselines of the specimen in high contrast |
| Every setting DESIGN.md describes is on one screen and works from the keyboard | Settings has Appearance · Writing · Language & checking · Files & privacy, with links to each; new: Colours, High contrast, *Another font*, Other text (Zuhd mode's faint text), and Files & privacy (library folder, shortcuts, where the files are, unsaved text, privacy). The e2e tests choose a theme with arrows and `Space`, move between sections by their links, and type a font's name |
| `keybindings.toml` changes shortcuts everywhere as soon as it is saved, and refuses the text's keys | e2e: a new shortcut runs Zuhd mode in the real editor and the old one stops, the palette shows it, unusable lines are listed by line number, and *Create keybindings.toml* writes a file that, uncommented, gives every command its own shortcut back. `src/core/shortcuts.test.ts`: both notations, refused keys, Undo/Redo/Select all fixed, one key given to two commands, a shortcut taken from its previous command |
| About states the inspiration and every shipped part's licence | e2e: About opens at its start with *Close* focused and returns focus to the text; `src/core/about.test.ts` fails if a package bismillah ships isn't credited |

What else came with it:
- **The configuration folder is watched** like the library, so `settings.toml`, `keybindings.toml`, themes and `dictionary.txt` edited elsewhere apply at once (focus still re-reads them).
- ***Another font*** is used only when the system's font list has it: WebKitGTK draws an unknown name in a substitute font rather than falling back, so Rust asks fontconfig (`fc-list`), and Settings says *No installed font is called “…”, so iA Writer Duo is used.*
- The native menu gained **Help › About bismillah**; its accelerators follow `keybindings.toml`.
- `pnpm app:shot` can open Settings or About (`--open`), apply settings (`--settings`) and seed theme files (`--config`).
- **Fixed on the way (a Phase 2 race):** when another program changed the open file and the writer had no unsaved edits, text typed while the new version was being read was replaced unseen. It is now kept in recovery and offered with the new version (ARCHITECTURE.md §5.4). The offline run's slow keys found it; the conflict tests now hold saves back while typing, so they no longer depend on timing.

**Not done in Phase 5**
- No way to open the configuration folder or a file from Settings: the folders are shown as text. *Show in file manager* waits for `tauri-plugin-opener` (planned with `Mod-click` on links).
- Settings has no list of every shortcut; the starting `keybindings.toml` is that list.
- Interface zoom at 200% was checked only through the writing size, not with the webview's own zoom.

**For the author**
1. **Install and try it:** `cd packaging/arch && makepkg -si`, then Settings (`Ctrl+,`): try Sepia and Slate in light and dark, High contrast, and *Create keybindings.toml* under Files & privacy, then change a shortcut in the file and save.
2. **Your own set of themes:** add files to `src-tauri/themes/` (and the `BUILT_IN` list in `themes.rs`); `cargo test` holds each to the contrast rules. Sepia and Slate can go whenever your set replaces them.
3. **Design questions (none blocks acceptance):** the About text (DESIGN.md §6, `src/core/copy.ts`), which states the inspiration in two short paragraphs; *Faint* for Zuhd mode at about 2.3:1 (light) and 3:1 (dark); and whether theme names should be shown with a small preview of their colours.
4. **Manual checks (live session, a few minutes):** Orca reads the Settings sections, the radio groups and a theme's problems; `Alt` shows the new Help menu with *About bismillah*, and a changed shortcut shows in the File, Edit and View menus; a theme saved from your editor applies while bismillah stays in the background.
5. **Still open from earlier phases:** Phase 4's design questions and manual checks, the hanging-mark gutter question (Phase 1, item 3) and the manual checks of Phases 1–3.

## Phase 6 — Personal 1.0 (Linux, this machine)

bismillah stays private and runs only on the author's machine for now (2026-10-18 interview). 1.0 means the author's daily-driver release: the polished local `PKGBUILD` and a `.desktop` entry with the Markdown MIME types and icon, so "Open with bismillah" works; README, PRIVACY.md and user documentation; a final accessibility, contrast and offline audit; performance budgets measured (ARCHITECTURE.md §14); package size recorded.

### Phase 6 result (2026-10-19): built; waiting for the author's acceptance

*Decided by the author at the start (2026-10-19):* build Ctrl+click on links for 1.0 (PRIVACY.md already promised it, and no phase owned it); put the user guide inside the app (Help › Guide); and make the icon the letter bāʾ, "as clean as possible", in the theme's green.

Everything above is in place, and `pnpm verify` passes (350 unit tests, 145 Rust tests, 182 real-app e2e tests in 18 suites, 16 visual checks), and so do `pnpm test:offline`, `pnpm a11y` and `packaging/check.sh`. The audit, with every number, is [docs/audits/2026-10-19-personal-1.0.md](docs/audits/2026-10-19-personal-1.0.md).

| Accept | Evidence |
|---|---|
| The polished local `PKGBUILD` | Version 1.0.0 from one place (the workspace's `Cargo.toml`; `package.json` repeats it and a test keeps them equal; `pkgver` is `1.0.0.r<commits>.g<hash>`). `depends` lists exactly what the binary links against (`readelf`), plus fontconfig for *Another font*; the stale `xdotool` dependency is gone (`libxdo` isn't linked any more). The guide, README and PRIVACY go to `/usr/share/doc/bismillah/`. `packaging/check.sh` checks a built package: its files, the desktop entry, `--version`, and every linked library against `depends` |
| A `.desktop` entry with the Markdown types and the icon, so "Open with bismillah" works | `desktop-file-validate` passes with no hints; `gio mime text/markdown` offers bismillah from the package; and `packaging/check.sh` launches the entry with a Markdown file as a file manager does (`gio launch`, under the harness) and finds that file opened. Its name, the Wayland app id and `StartupWMClass` are all `bismillah` (checked on X11: `bismillah`/`Bismillah`). The icon is the bāʾ (DESIGN.md §7), from 32 px to scalable |
| README, PRIVACY.md and user documentation | README says what 1.0 is and how to install it; every claim in PRIVACY.md was checked against the code (links, logs, the Flatpak that doesn't exist yet). The guide (`docs/guide.md`) covers every feature, setting file and shortcut; it opens inside the app on `F1` as a sample (`tests/e2e/guide.e2e.ts`: no spelling or grammar marks, never saved), and `src/core/guide.test.ts` keeps its shortcut table equal to the command registry. `bismillah --help` |
| A final accessibility, contrast and offline audit | New `pnpm a11y` reads the tree Orca gets in eleven screens and states: two problems found and fixed (the writing surface had no name; Settings' headings reached screen readers in capitals). Contrast tests pass. `pnpm test:offline` passes with the new suites (189 socket calls, all loopback); no networking crate, no name resolution in the binary; `cargo deny` and `pnpm audit` clean |
| Performance budgets measured (ARCHITECTURE.md §14) | New `pnpm perf` on the release build, headless: launch to an editable caret 524 ms (budget 400 ms: not met; 274 ms of it is GTK and WebKit starting); typing in a 1 MB book 19 ms a key in prose, 24 ms on a line with code (10 ms in a short document; 4 % of frames long at 1 MB: not quite met); lint within 500 ms (Phase 3's measurement); idle 90 ms of CPU a minute (met); 761 MiB resident with a short document |
| Package size recorded | `packaging/check.sh` prints a package's sizes; the 1.0 package's are in the audit |

What else came with it:
- **Links open on Ctrl+click** (Cmd on macOS), in the text, in tables drawn as grids and in Arabic, and *Open link* opens the one at the caret. Only web and email addresses go to the browser or mail app, through the desktop (GIO); Rust checks each (`links.rs`), and under the test harness records them instead. The address tooltip says *Ctrl+click to open*; the pointer is a hand while Ctrl is held over a link. ADR-0003 already decided this; it was planned with `tauri-plugin-opener`, whose D-Bus stack cargo-deny flags, so GIO (already in the tree) does it.
- ***Show in file manager*** for the library, the settings folder and the recovery folder (Settings › Files & privacy).
- **Typing in a 1 MB document** went from about a second a key to 19 ms: drawn tables, images and link definitions are kept across edits that can't change them. **Launch** is 190 ms faster (716 → 524 ms): fewer fonts before the first screen, the menu after it, and no HTML/CSS/JavaScript grammars (ARCHITECTURE.md §2).
- **The library's watcher reacts only to Markdown files and folders**, so a build or an install inside a library folder no longer makes it list everything again (found when the author's own instance had this repository as its library).
- `bismillah --help` and `--version`.

**Not done in Phase 6**
- What Orca says aloud is still a manual check: `pnpm a11y` checks the tree it reads, not its speech.
- Links to other Markdown files (`[next](chapter-2.md)`) don't open in bismillah; Ctrl+click says only web and email links open.
- The caret keeps blinking in a focused window that is otherwise idle (two small repaints a second); GTK stops after ten seconds.
- The budgets for launch (524 ms against 400 ms) and for typing in a 1 MB document (19 ms a key against one frame) are not met on this machine under the harness: what limits each is in the audit.

**For the author**
1. **Install and try it:** `cd packaging/arch && makepkg -si`. Then `F1` for the guide, Ctrl+click a link, *Show in file manager* in Settings, and look at the new icon in your launcher.
2. **Your running `target/debug/bismillah`** had this repository as its library, so every build I ran kept it busy (a full CPU core): the new watcher stops that. Choose your writing folder as the library in the installed app.
3. **Design questions (none blocks acceptance):** pasting a web address over selected text makes it a link (CodeMirror's default, on since Phase 1, never recorded in DESIGN.md): keep it, or paste the address as text? Should Ctrl+click on a link to another Markdown file open it in bismillah? And DESIGN.md's opening paragraph has a typo, "desi2zgn".
4. **Manual checks (live session, a few minutes):** Orca reads the editor by its file name and Settings' headings as written; Ctrl+click opens Zen with the page in front (Wayland activation); *Open with › bismillah* from your file manager; the icon at your launcher's size; `F1`.
5. **When you accept it,** tag the commit `v1.0.0`.
6. **Still open from earlier phases:** Phase 5's design questions and manual checks, Phase 4's, the hanging-mark gutter question (Phase 1, item 3) and the manual checks of Phases 1–3.

## Later (not scheduled)

- Opening links to other Markdown files in the library from the editor (`[next](chapter-2.md)`).
- Stopping the caret's blink after a while without typing, as GTK does.

- Publishing: a GitHub repo on the author's personal account, CI on Linux, macOS and Windows, public packages (AppImage, .deb, .rpm, AUR, Flathub without network permission), and macOS and Windows releases.
- Print / PDF and HTML export.
- Jump to heading (palette list of headings, `Alt-↑/↓`).
- Executable plugins, only after an ADR settles isolation (ADR-0005).
- More writing fonts, only after the first set is excellent.
- Interface localisation, starting with Arabic.

## Out of scope (permanently)

See DESIGN.md §3.
