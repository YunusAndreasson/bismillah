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

## Phase 2 — Library

Choose a library root; Rust path validation (traversal and symlinks); tree with docked/overlay behaviour (DESIGN.md §7); quick open with parent paths; command palette with aliases; library actions in the native menu; file actions (new, rename, new folder, trash with undo); watcher plus conflict bar.

**Accept:** keyboard-only use of every library action; duplicate filenames can be told apart; attempts to escape the root are rejected in tests.

## Phase 3 — Spelling and grammar

`bismillah-lint` crate (Harper + the chosen Arabic adapter); script-run routing with a `lang:` override; UTF-16 offset conversion; revision tagging and discarding of stale results; diagnostics with distinct underline patterns; suggestion popover; `F7` navigation; personal dictionary; switches for spelling and grammar.

**Accept:** fixture suites for English, Arabic (with and without diacritics), mixed text and masked regions; a stale-result test; no flagging of unsupported scripts.

## Phase 4 — Preview

markdown-it with the shared dialect (ARCHITECTURE.md §11), raw HTML disabled, DOMPurify; preview typography (fuller scale, hyphenation, `text-wrap: pretty` with fallbacks); scoped local images and a placeholder for remote images; Basmallah in preview; footnotes in editor and preview; **Copy as rich text** (HTML and plain text on the clipboard, using the preview pipeline).

**Accept:** the specimen in preview at all test widths; an XSS fixture suite renders inert.

## Phase 5 — Themes and settings complete

Declarative theme files with validation and contrast warnings; a high-contrast built-in override; full settings screen (Appearance · Writing · Language & checking · Files & privacy); `keybindings.toml` with live reload; About screen with a short statement of the project's inspiration and the licences.

## Phase 6 — Personal 1.0 (Linux, this machine)

bismillah stays private and runs only on the author's machine for now (2026-10-18 interview). 1.0 means the author's daily-driver release: the polished local `PKGBUILD` and a `.desktop` entry with the Markdown MIME types and icon, so "Open with bismillah" works; README, PRIVACY.md and user documentation; a final accessibility, contrast and offline audit; performance budgets measured (ARCHITECTURE.md §14); package size recorded.

## Later (not scheduled)

- Publishing: a GitHub repo on the author's personal account, CI on Linux, macOS and Windows, public packages (AppImage, .deb, .rpm, AUR, Flathub without network permission), and macOS and Windows releases.
- Print / PDF and HTML export.
- Jump to heading (palette list of headings, `Alt-↑/↓`).
- Executable plugins, only after an ADR settles isolation (ADR-0005).
- Side-by-side preview, only as an explicit command with minimum measures for both panes.
- More writing fonts, only after the first set is excellent.
- Interface localisation, starting with Arabic.

## Out of scope (permanently)

See DESIGN.md §3.
