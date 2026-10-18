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

## Phase 5 — Themes and settings complete

Declarative theme files with validation and contrast warnings; a high-contrast built-in override; full settings screen (Appearance · Writing · Language & checking · Files & privacy); `keybindings.toml` with live reload; About screen with a short statement of the project's inspiration and the licences.

## Phase 6 — Personal 1.0 (Linux, this machine)

bismillah stays private and runs only on the author's machine for now (2026-10-18 interview). 1.0 means the author's daily-driver release: the polished local `PKGBUILD` and a `.desktop` entry with the Markdown MIME types and icon, so "Open with bismillah" works; README, PRIVACY.md and user documentation; a final accessibility, contrast and offline audit; performance budgets measured (ARCHITECTURE.md §14); package size recorded.

## Later (not scheduled)

- Publishing: a GitHub repo on the author's personal account, CI on Linux, macOS and Windows, public packages (AppImage, .deb, .rpm, AUR, Flathub without network permission), and macOS and Windows releases.
- Print / PDF and HTML export.
- Jump to heading (palette list of headings, `Alt-↑/↓`).
- Executable plugins, only after an ADR settles isolation (ADR-0005).
- More writing fonts, only after the first set is excellent.
- Interface localisation, starting with Arabic.

## Out of scope (permanently)

See DESIGN.md §3.
