# bismillah — Architecture

This document describes how bismillah is built and the contracts each part must keep. Product and visual decisions live in [DESIGN.md](DESIGN.md). Lasting decisions are recorded as ADRs in [docs/decisions/](docs/decisions/). If code and this document disagree, fix one of them in the same change.

> **Status:** Phase 6 (personal 1.0). The file-safety contract, the recovery journal, settings, the desktop basics, the library (path checks, listing, watcher, file actions), checking (`bismillah-lint`, its thread, the suggestions and the personal dictionary), live preview (with local images), Copy as rich text, colour themes, `keybindings.toml`, the watched configuration folder, links handed to the browser, the bundled guide and the local package are real; the performance budgets are measured (§14).

---

## 1. Overview

```
┌──────────────────────── Tauri window (system webview) ────────────────────────┐
│  Svelte 5 UI (library, palette, settings, status)   CodeMirror 6 editor       │
│  Bits UI primitives + plain CSS tokens              live preview (Phase 4)    │
│                │                                          │                   │
│                └──────────── core/ (commands, state, bridge) ─────────────┘    │
│                                        │  Tauri IPC (typed commands + events)  │
└────────────────────────────────────────┼──────────────────────────────────────┘
┌────────────────────────────────────────┼──────────────────────────────────────┐
│ Rust (src-tauri)                       ▼                                      │
│  library (path validation) · documents (save contract) · recovery · watch    │
│  settings · themes                    bismillah-lint (Harper + Arabic speller)│
└──────────────────────────────────────────────────────────────────────────────┘
```

**Rust owns** everything that touches the disk or needs real computation: library access and validation, saving, recovery, watching, settings, linting. **The frontend owns** presentation and editing. The frontend never builds file-system paths on its own authority; it asks Rust, and Rust validates.

## 2. Stack and dependency policy

A dependency is added only when it replaces difficult correctness, accessibility or security work. Each one is listed here with its job. Adding a dependency means adding a row (and an ADR if it is architectural).

| Dependency | Job |
|---|---|
| Tauri 2 | Desktop shell, IPC, packaging, system webview |
| Svelte 5 + TypeScript + Vite | Small UI with compile-time reactivity |
| Bits UI | Unstyled, accessible primitives (dialog, popover, menu, listbox, select): focus management and keyboard behaviour we would otherwise hand-write |
| CodeMirror 6 + `@codemirror/lang-markdown` (Lezer) + `@codemirror/search` | Editing, IME, bidi, undo, search, accessibility |
| markdown-it | Copy as rich text: the document as HTML (raw HTML disabled, no typographer); loaded on first use |
| markdown-it-footnote | Footnotes in that HTML, from the same project |
| DOMPurify | Sanitises that HTML after all rendering extensions have run (an allow-list of tags and attributes; styles only for table alignment) |
| `harper-core` | English spelling and grammar, offline. Embeds a small chunking model via `burn` (allowed by ADR-0004's AI policy); build without the thesaurus feature. Its `zip` and `burn` dependencies carry advisories that can't apply here (`deny.toml` gives the reason for each ignore; drop them when Harper updates) |
| `spellbook` | Arabic spelling behind the `ArabicSpeller` adapter (ADR-0004; chosen in Phase 0). The Ayaspell dictionary (`dictionaries/ar/`, 7 MB) is compiled into the binary and parsed on the first Arabic word that needs checking |
| `notify` | File watching |
| `trash` | Move to the system trash instead of deleting, and restore from it for Undo (freedesktop.org trash on Linux) |
| `icu_normalizer` (already in Tauri's tree, through URL handling) | Canonical decomposition for the library's sort order, on a copy of each name (§6) |
| `libc` (Linux only, already in the tree) | `renameat2(RENAME_NOREPLACE)`, so a rename can never replace a file (`platform.rs`) |
| `dirs` / Tauri path API | Platform config, data and cache directories |
| `tauri-plugin-dialog` | Native open-folder and save-as dialogs |
| `url` (already in Tauri's tree) | Parses a link's address before it is handed to the browser, so only web and email addresses go, written out in ASCII (`links.rs`) |
| `serde`, `serde_json`, `thiserror` | IPC payloads, the recovery sidecars and typed errors |
| `toml_edit` | `settings.toml` rewritten without losing the writer's comments, layout or unknown keys (§9) |
| `gtk` (Linux only, already in Tauri's tree) | Focus the native menu bar on `Alt`/`F10`; put Copy as rich text on the clipboard as `text/html` and text; hand a checked link or folder to the desktop's default app through GIO (`platform.rs`), instead of `tauri-plugin-clipboard-manager` and `tauri-plugin-opener` |

**Development only** (never shipped): WebdriverIO + `tauri-driver` (real-app e2e), `pixelmatch` + `pngjs` (screenshot comparison), Vitest + jsdom, ESLint + Prettier, svelte-check. Spike and font tooling run through `uv`: fontTools (font build), `uharfbuzz` (rendering reference, and the pre-shaped Basmallah outlines in `src/editor/basmallahInk.ts`), `python-xlib` (raw X input and clipboard).

The editor's Markdown language is built from `@codemirror/lang-markdown`'s own parser and language data (`src/editor/dialect.ts`), not with its `markdown()`, which would also bundle and load the HTML, CSS and JavaScript grammars at every launch to highlight HTML that bismillah shows as text. Its Enter/Backspace keymap for lists and quotes and its link on pasting an address over a selection are kept as they were.

`@codemirror/view@6.43.14` has a pinned pnpm patch in
`patches/@codemirror__view.patch` (ESM and CommonJS). Its default text-size probe
always uses its existing undecorated measuring line. Sampling a short heading or
code line instead can give unseen prose the heading's padding/font metrics, causing
viewport estimates to oscillate and leaving visible virtual spacers after the
measure retry limit. The patch changes only the default estimate, preserving actual
per-line measurements, typography and virtualization. The scrolling regression
(`tests/e2e/scrolling.e2e.ts`) covers all four bundled profiles. Re-evaluate this
patch when upgrading CodeMirror; do not silently carry it to a new version.


Whether the writer's *Another font* is installed is asked of fontconfig's `fc-list -q` (`platform.rs`), a program that comes with fontconfig, which WebKitGTK needs anyway; the webview can't tell, because WebKitGTK draws an unknown family in a substitute font.

A later launch hands its file to the running app over a socket in the user's private runtime directory (`platform.rs`, std only), rather than `tauri-plugin-single-instance`, whose D-Bus stack (`zbus` 5) is flagged unmaintained. Window size and the last document are remembered by `state.rs` in one small JSON file, rather than `tauri-plugin-window-state`, so everything bismillah stores sits in its own two folders (§9); on Wayland the compositor places windows anyway.

No CSS framework, state-management library, layout library, icon font or component kit. CSS is plain and uses tokens (DESIGN.md §9). No browser test stack: bismillah is desktop-only (ADR-0009), so it is tested in the real app.

## 3. Repository layout

Real since Phase 0 unless marked *(planned)*.

```
bismillah/
├─ AGENTS.md  DESIGN.md  ARCHITECTURE.md  PLAN.md  README.md  CONTRIBUTING.md
├─ PRIVACY.md  SECURITY.md  LICENSE  deny.toml  Cargo.toml (workspace)  package.json
├─ .claude/                  agent config: path-scoped rules/, hooks/, skills/ (design-review, run-app)
├─ index.html                carries the CSP nonce element CodeMirror's styles need (§10)
├─ src-tauri/
│  ├─ src/
│  │  ├─ main.rs, lib.rs      app setup, navigation guard, window events (drop, close), menu commands
│  │  ├─ app.rs               app state and the document, recovery and settings commands (§4)
│  │  ├─ documents.rs         the save contract: decode/encode, atomic write, conflicts (§5)
│  │  ├─ recovery.rs          the recovery journal (§5.7)
│  │  ├─ settings.rs          settings.toml (§9)
│  │  ├─ state.rs             remembered window size and last document
│  │  ├─ platform.rs          all cfg(target_os) code (menu-bar focus, directory fsync, permissions,
│  │  │                       no-replace rename, the system trash)
│  │  ├─ library.rs           the library boundary: path checks, listing, natural order, new folder,
│  │  │                       rename, trash (§6)
│  │  ├─ watch.rs             the debounced file watcher (§5.4)
│  │  ├─ app/library_commands.rs  the library's state and commands (§4)
│  │  ├─ lint.rs              the checker's thread and the personal dictionary file (§7)
│  │  ├─ images.rs            local images for live preview: resolved and checked (§6)
│  │  ├─ themes.rs            colour themes: read, checked, contrast-tested (§8)
│  │  ├─ keybindings.rs       reading keybindings.toml, and its starting file (§9)
│  │  ├─ config.rs            which configuration file changed; folders named from ~ (§9)
│  │  └─ links.rs             what may be handed to another app: web and email links (§10)
│  ├─ themes/                 bismillah's built-in colour themes, in the theme-file format
│  └─ capabilities/           minimal Tauri capability set
├─ crates/bismillah-lint/     spelling and grammar, pure Rust with no Tauri dependency (§7): offsets
│                             (UTF-16 ↔ chars ↔ bytes), segment (script runs, Qur'anic trigger,
│                             transliteration), routing (lang:), english (Harper), arabic
│                             (spellbook), personal; fixture suites in tests/
├─ src/
│  ├─ core/                   command registry, native menu, typed IPC bridge, workspace (open,
│  │                          save, notices, library actions), save session, settings, copy (all
│  │                          interface sentences), appearance, library store, tree keyboard model,
│  │                          fuzzy matching, library layout, checking (the suggestions and what
│  │                          was ignored), colour themes, shortcuts (the rules of keybindings.toml)
│  │                          and keybindings (the writer's shortcuts now), about (the credits),
│  │                          test hooks (only with BISMILLAH_TEST=1)
│  ├─ editor/                 CodeMirror setup + one extension per concern: dialect (frontmatter),
│  │                          markdownStyling, hangingMarks, bidi, scriptRuns, basmallah, typewriter,
│  │                          zuhd, typingAids (smart punctuation, transliteration mode), paragraphs
│  │                          (Enter as a paragraph break), rest (Escape puts the pen down), lintBlocks
│  │                          (what is prose), linter (when to check), diagnostics, livePreview
│  │                          (what is revealed, the rendered look, the mouse), previewBlocks
│  │                          (folded frontmatter, images, addresses on hover), previewTables
│  │                          (tables as grids, clicks and arrows into them), links (Ctrl+click);
│  │                          wordCount
│  ├─ richText/               markdown-it + DOMPurify for Copy as rich text, and its plain text
│  ├─ ui/                     Svelte components: status line, notices, first screen, Settings,
│  │                          About, library panel and tree, quick open / palette, name prompt,
│  │                          suggestions
│  └─ styles/                 tokens.css, fonts.css, profiles.css, editor.css
├─ fonts/  source/ (upstream) · build/ (Bismillah Duo/Mono) · tools/ (build + verify scripts,
│                             the icon)
├─ dictionaries/              Arabic dictionary + licence
├─ scripts/                   headless.sh, verify.sh, offline.sh, app-shot.ts, perf.ts (§14),
│                             a11y.ts + a11y_tree.py (the accessibility audit, §13)
├─ packaging/                 arch/PKGBUILD (local install), linux/bismillah.desktop, check.sh
├─ tests/                     e2e/ (incl. spikes/), visual/ (baselines), fixtures/ (bidi, profiles,
│                             quran, library)
├─ spikes/                    Phase 0 experiments: arabic-speller, harper-latency, transliteration, webview
└─ docs/  decisions/ · spikes/ · specimen.md · guide.md (also Help › Guide) · audits/ · reviews/
          · interviews/
```

## 4. IPC surface

All commands are typed on both sides (Rust structs ↔ TS types in `src/core/ipc.ts`). **The frontend never sends an absolute path.** Files come from the command line, a native dialog Rust shows, a drop on the window or a second launch; the frontend refers to the open document by an id. Inside the library it names entries by their path relative to the library root (`/`-separated), and every such path is checked in Rust before anything is touched (§6). The capability file grants the main window only the core event system, the menu, and the window calls it needs (title, close, fullscreen).

| Command | Purpose |
|---|---|
| `startup()` → document, first screen or failure | What to show at launch (DESIGN.md §15) |
| `doc_open_dialog()` / `doc_new_dialog()` → document or `null` | File › Open… and New file… through the native dialogs (New never replaces a file) |
| `doc_open_requested()` / `doc_open_recovered(token)` | Open the file a drop or second launch asked for, or one with recovered text |
| `doc_open_guide()` → document | Help › Guide: the bundled guide as a sample, never saved |
| `doc_save(id, text, revision, force)` → `revision` or a typed `SaveError` | Save (§5); `force` is "Keep mine" |
| `doc_save_as(id, text)` · `doc_check(id)` · `doc_reload(id, local_text?)` | Save mine as…, the focus check, and reloading (Load theirs keeps the local text in recovery) |
| `recovery_settle(id)` | The writer restored or discarded recovered text |
| `app_info()` → test mode, process id, version, the configuration and data folders as the writer reads them | About and Settings › Files & privacy |
| `settings_get()` / `settings_set(patch)` / `settings_reload()` | Settings (§9) |
| `themes_list()` → every colour theme, each with its tokens per variant and its problems | Settings › Appearance and applying the chosen theme (§8) |
| `keybindings_get()` → the lines of `keybindings.toml` · `keybindings_create(text)` | The writer's shortcuts (§9); the starting file is never written over an existing one |
| `font_installed(family)` → `true`, `false` or `null` (unknown) | *Another font* (DESIGN.md §8.2) |
| `library_get(refresh)` → the listing and whether the library is shown · `library_remember_open(open)` | The panel (refresh: on focus, or *Try again*) |
| `library_open_dialog()` → listing or `null` | File › Open folder… |
| `library_open_file(path)` → document | Open a file from the library |
| `library_new_folder(parent, name)` · `library_rename(path, name)` | New folder…, Rename… (never replaces; the open document, recovered text and remembered files follow a rename) |
| `library_trash(path)` → token · `library_untrash(token)` | Move to trash and its Undo (the open document closes if it went too) |
| `lint_check(request)` → one list of diagnostics per block, with the request's revision | Spelling and grammar for some blocks, as the settings say (§7) |
| `lint_suggest(word, lang, doc_lang)` → corrections | Spelling corrections, only when the writer asks (an Arabic search stops after ~300 ms) |
| `lint_add_word(word)` · `lint_refresh()` → changed | *Add to dictionary*; re-reading `dictionary.txt` on focus |
| `clipboard_write(html, text)` | Copy as rich text: the sanitised HTML and its plain text, through GTK |
| `link_open(address)` → `null` or `not_web` / `no_app` | Ctrl+click and *Open link*: the address as the document writes it; Rust hands on web and email addresses only (§10) |
| `folder_show(folder)` with `settings`, `recovery` or `library` | *Show in file manager*: the frontend names which folder, Rust knows where it is |
| `test_open(path)`, `test_fault(kind)`, `test_dialog(path)`, `test_library(path)`, `test_clipboard(target)`, `test_handed()` | Debug builds under the test harness only: stand-ins for the native dialogs, fault injection, reading the clipboard back, and the links and folders recorded instead of opened (§13) |

Images reach the webview through one custom scheme, not a command: `bismillah-image://localhost/<document id>/<destination as written>` (built with `convertFileSrc`). Rust answers with the checked image or an empty 404 (§6).

Events (Rust → UI): `open-requested` (a drop or a second launch), `library-changed` (a new listing, sent whenever it differs from the last), `document-changed` (the watcher found the open file changed or removed on disk), `config-changed` (which of `settings.toml`, `keybindings.toml`, `themes/` and `dictionary.txt` another program changed). A listing carries a generation that changes with the folder; within one folder the frontend keeps track of the open file itself, because a listing sent before a file opened may arrive after it.

## 5. File-safety contract (amanah)

The writer's text is a trust. These rules are requirements, each with a test.

### 5.1 Revisions and serialised writes
- Every edit increments the in-memory document revision.
- Writes to a given file are **serialised**: at most one in flight, and the newest pending content replaces any queued older content. A save carries the revision it represents. The UI shows *Saved* only when the latest revision has been durably written.

### 5.2 Durable atomic write
1. Write to a temporary file in the **same directory**.
2. Copy the original's permissions to the temporary file.
3. `fsync` the temporary file.
4. `rename` it over the target.
5. `fsync` the directory (where the platform supports it).

If any step fails, the original file is untouched, the temporary file is removed, and the typed error is surfaced.

Temporary basenames have bounded length: a stable local path identifier plus process
and counter values, opened with `create_new`. They do not append to the document's
basename, so a legal 255-byte filename can still be saved. Opening a document cleans
up its interrupted-save temporaries, including the earlier basename-based pattern;
other documents' temporaries and malformed names are retained. Tests cover maximum
ASCII and Arabic filename lengths, a rename-stage failure and retry, and cleanup.

### 5.3 Preserving the file
- Text is written back **byte-for-byte as edited**: no Unicode normalisation, no diacritic stripping, no punctuation or whitespace rewriting, no frontmatter rewriting.
- **Line endings** (LF/CRLF) are detected on open and preserved on save. A UTF-8 BOM is preserved if present.
- **Encoding:** UTF-8 only. A non-UTF-8 file opens read-only with a clear notice; it is never re-encoded silently.

### 5.4 External changes and conflicts
- Before replacing a file, the save checks that its mtime and size still match what was last read or written; if either differs, the bytes are read and their hash compared, so a `touch` alone is not a conflict.
- If they don't:
  - No local edits: reload quietly, keeping the caret and scroll as close as possible. Reading the new version takes a moment; text the writer types meanwhile is kept in recovery and the new version opens with it on offer (*Restore* · *Discard*), so it is never replaced unseen (`src/core/reload.ts`; found by the offline run in Phase 5).
  - Local edits: **do not overwrite**. Show the persistent conflict bar: *Keep mine* (save over) · *Load theirs* (local text goes to recovery first) · *Save mine as…*
- Regaining window focus runs the same check, and the watcher (`watch.rs`, `notify`) runs it as soon as another program changes the library: bursts of events are gathered until the folder is quiet for 150 ms, hidden names and our own save temporaries are ignored, and the open file is reported only if it no longer matches what we last read or wrote, so our own saves never are. Only changes count: `notify` also reports files and folders being opened and closed unwritten, and the listing opens every folder, so counting reads made each listing set off the next for as long as a library was open (found in Phase 6: 5 % of a core with 1,000 files, 60 % with this repository as the library). In the library only Markdown files and folders count, so a build writing thousands of other files there costs no listing. No polling: an idle library costs nothing. Links are not followed by the watcher, so changes in a linked folder are found on focus. The save-time check is the authority.
- A file removed while open is reported (*Save it again* · *Save elsewhere…*), never silently recreated.

### 5.5 Autosave and Save now
- Autosave runs about 500ms after typing pauses, when switching documents, on window blur and when quitting.
- `Mod-S` (`file.save`) flushes immediately and confirms visibly. Quitting waits for pending writes (with a timeout that leaves the text in recovery).
- `Workspace.saveNow` acknowledges an explicit request only after `DocumentSession.save` succeeds and the same session still has state `saved`. Edits/document switches clear passing feedback. Samples and non-UTF-8 files instead receive an explanatory notice. This does not alter the durable-write or recovery protocol.

### 5.6 Failures
- Disk full, read-only volume, permission denied, file removed or volume unmounted: each has a typed error and a plain message (DESIGN.md §14).
- The failure state persists until a save succeeds or the writer acts. Text is placed in recovery.

### 5.7 Recovery journal
- Before every save, the text is mirrored to `<app-data>/recovery/<file-id>.<session>.md` plus a small JSON sidecar (original path, revision, timestamp); a clean save removes the mirror, a failed or refused save makes it durable (fsync). So a crash mid-save, a failing disk or a conflict always leaves the text there. Files get `0600` and the folder `0700` permissions where supported.
- Entries are kept **per app session**, so a new session's mirrors never overwrite text left by an earlier one. *Load theirs* keeps the writer's version as its own entry.
- When a file is opened, the newest earlier entry that is newer than the file and differs from it is offered (*Restore* · *Discard*); other files with entries are mentioned. *Restore* is one undoable edit, and the entries go only once the restored text is saved.
- A rename in the library moves the entries of the renamed file, or of every file in a renamed folder, to the new path (`Recovery::moved`), so recovered text is never stranded under an old name.
- Bounded: per-file and total size caps, and a maximum age.
- This is the one deliberate exception to "no hidden files". It lives outside the writing folder and is documented in PRIVACY.md.

### 5.8 Destructive actions
- Delete means move to the system trash (`trash` crate). The session keeps each trashed path and when it went; *Undo* finds the newest trash entry from that path and puts it back, refusing if something new now has its name.
- Rename never replaces anything: on Linux the check and the rename are one atomic step (`renameat2` with `RENAME_NOREPLACE`); elsewhere it checks first. A file name without `.md` or `.markdown` gets `.md`.
- Renaming or trashing a link acts on the link, never on what it points to.
- Before the open document is renamed or trashed, the frontend saves it and refuses if its changes still aren't on disk or recovered text for it is still on offer. A trashed open document closes.

## 6. Library boundary

- The library root is chosen by the writer through the native dialog (or the command line, a dropped folder, a second launch), then stored canonicalised. Opening a file outside it makes the file's folder the library (§12.2). A remembered root that has gone missing is shown as unavailable and tried again on focus.
- Every incoming path must be made of plain names: no empty parts, `.`, `..`, absolute paths or NUL. It is then resolved against the root and canonicalised, and rejected if it ends up outside (`Outside`), which catches **symlinks resolving outside the root**. Entries that are renamed or trashed resolve their folder this way and act on the final name itself, so a link is never followed for them. Symlinks inside the root are followed; symlinks pointing outside, and links back up the tree, are listed but marked unavailable. Each check happens just before its operation; a race with another program swapping links at that moment is outside the local, single-user threat model.
- Only folders and `.md`/`.markdown` files are listed. Hidden names (a leading dot: `.git`, our save temporaries) are not, nor are names that aren't UTF-8 (they can't cross the IPC boundary). A listing stops at 20,000 entries or 64 levels and says so.
- **Order:** folders first, then natural order on a sort key: canonical decomposition, combining marks (Latin diacritics, Arabic vocalisation and Qur'anic marks) dropped, ʿ ʾ, apostrophes and tatweel skipped, lower case, numbers compared by value (ASCII and Arabic-Indic digits). Names equal under that key fall back to their exact text. Quick open folds the same way (`src/core/fuzzy.ts`). Names themselves are never changed.
- New names are checked (`validate_name`): not empty, no `/`, no leading dot (it would hide the entry), no control characters, at most 255 bytes. Spaces, Arabic and every other printable character are kept exactly as typed.
- **Local images shown by live preview** come through the `bismillah-image` scheme (`images.rs`), not Tauri's asset protocol, so they pass the same checks as every other path: the destination as the document writes it (relative to the document, absolute, or a `file:` URL; `%`-escapes decoded) is canonicalised and served only if it is inside the library root and has an image ending (PNG, JPEG, GIF, WebP, AVIF, BMP, SVG), up to 64 MiB. Links out of the library are refused like `..`. Anything refused gets the same empty "not found", so a document can't probe what lies outside the library. Responses carry `Cache-Control: no-store` and a sandboxing CSP. Web addresses never reach Rust: the editor shows a note instead (DESIGN.md §11).

## 7. Spelling and grammar pipeline

Detailed in ADR-0004. The checker is the `bismillah-lint` crate (pure Rust, no Tauri); the app runs it on one long-lived thread (`src-tauri/src/lint.rs`), because Harper's rule group mutates its caches as it works.

### 7.1 Request and response
```text
LintRequest  { revision, lang?, blocks: [{ text, skip: [[from, to]], marks: [[from, to]] }] }
LintResponse { revision, blocks: [[Diagnostic]] }          // one list per block, in order
Diagnostic   { from_utf16, to_utf16, kind: spelling|grammar, lang: en|ar, message, suggestions[], rule_id }
```
- **The editor decides what is prose** (`src/editor/lintBlocks.ts`), from its own syntax tree, so the checker and the editor share one dialect (§11). Paragraphs, headings, task items and table cells are sent, each as its exact text with two kinds of ranges: `skip` for text that stands for words but isn't prose (inline code, URLs, autolinks, HTML, entities, link labels and titles, footnote references) and `marks` for Markdown punctuation (`#`, `**`, `>`, `[`, `](`, `|`, task boxes, hard breaks, the backslash of an escape). Code blocks, frontmatter, HTML blocks and link definitions are never sent, and the Basmallah isn't in the document. `lang` is the frontmatter `lang:`.
- **When** (`src/editor/linter.ts`): a newly opened document is checked from the visible blocks outwards, about 6,000 UTF-16 units per request, so a long document never holds up the first results; afterwards only blocks that changed, about 300 ms after typing pauses. A change to fences, HTML or frontmatter marks everything after it (unchanged blocks come from the cache), and text that stopped being prose loses its results.
- **At most one request is in flight.** What changes meanwhile waits for the next request, so nothing superseded is ever queued in Rust.
- **Offsets crossing the boundary are UTF-16 code units, relative to the block.** Rust converts (UTF-16 ↔ chars ↔ bytes) in one tested module, `offsets.rs`, with tests for emoji, combining marks, Arabic diacritics and CRLF.
- **Stale results are discarded:** the editor keeps the edits made while a request was out; a block they touched is dropped (and checked again), and an untouched block's results are moved to where it now is. A diagnostic is mapped through later edits only while its own text is untouched; an edit touching it removes it. A result is never put on text it didn't see.
- **Cache:** results are kept per block (text, ranges, settings, dictionary generation) for the session, so reopening a document or undoing costs nothing.
- A checker panic costs that block's underlines, never the app (`catch_unwind` per block).
- **Size limits:** grammar is checked in blocks up to 20,000 UTF-16 units (about 3,000 words, under half a second) and spelling up to 100,000; a longer block isn't checked. Harper's cost grows faster than the text (8,000 words in one block: 1.1 s; a whole novel pasted as one paragraph: minutes), and only pasted text without blank lines makes paragraphs this long.

### 7.2 Language routing
- Text is segmented into **script runs** (`segment.rs`): Arabic-script runs go to the Arabic speller; the rest of the prose goes to Harper.
- Script alone does not establish language, so a frontmatter `lang:` routes **the runs of its own script**: `lang: fa` (or another Arabic-script language) leaves Arabic-script runs unchecked, `lang: de` leaves Latin runs unchecked, and `lang: en-US`/`en-GB`/`en-CA`/`en-AU`/`en-IN` chooses the English dialect over the setting (`english_dialect`, British by default). An English document still has its Arabic phrases checked. Grammar runs only on English.
- Text in other scripts (Greek, Cyrillic, Hebrew, Devanagari, CJK…) is left unchecked; it is never flagged.
- **Qur'anic text is skipped automatically.** Any Arabic run containing alef wasla (U+0671) or Qur'anic annotation characters (U+0610–U+061A, U+06D6–U+06ED, U+08D3–U+08FF) is not spellchecked, because Uthmani orthography differs from modern spelling. The test is purely on characters, so no text is ever classified by meaning. (`src/editor/scriptRuns.ts` uses the same alef wasla and annotation-mark trigger to set such runs in Amiri Quran.)
- **IJMES transliteration is the writer's own:** a word (with its hyphenated compound, *al-Raḥmān*, *wa-l-ʿilm*) containing ʿ ʾ, a macron or a letter with a dot, line or breve below is never checked as English. ʿ and ʾ split Harper's tokens, and its suggestions for such words are absurd (Fātiḥa → Fatima). Plain Latin names (*Ibn*, *Taymiyya*) are ordinary words: unknown until added to the dictionary. The article of "al-Jawziyya" is never flagged.
- **Harper sees only allowed text** (`english.rs`): its `Mask` parser reads the block minus skipped text, marks, Arabic runs, transliterated words and other scripts, with spans still in block offsets. Grammar suggestions that touch text standing for words (skipped text, an Arabic run, a transliterated word), spaces included, are dropped: "The word أمانة means trust" would otherwise read as a missing "to". A correction whose span contains a Markdown mark is offered without replacements, so applying it can never delete the mark.
- **English spelling** is our own pass over Harper's word tokens, with Harper's own test (in the dictionary, in this dialect, in this case or lower case) plus the personal dictionary. Words in capitals (acronyms), single letters and words with digits are never flagged. Of a possessive only the word is flagged, so *Add to dictionary* adds "Taymiyya", not "Taymiyya’s". Corrections are computed only when the writer asks, from the same dictionary, in the dialect, capitalised like the word.
- **Grammar** is Harper's curated rule set without its opinionated rules: `SpellCheck` (replaced above), `UseTitleCase`, `OxfordComma`, `NoOxfordComma`, `LongSentences`, `BoringWords`, `AvoidCurses`, `CompoundNouns` (open compounds such as "lower case" are standard British usage), and the dash and ellipsis rules that duplicate smart punctuation. Lints of kind Enhancement, Readability or Style ("very good" → "excellent") are advice on style, not grammar, and are dropped. Two lints on one span ("Their is": there / they're) become one diagnostic with both corrections; a grammar hint on exactly a misspelled word ("blockquote" → "block quote") becomes one more correction of the spelling diagnostic.

### 7.3 Arabic analysis
- Lookup normalisation happens on a **temporary analysis copy**. The document is never changed, and a diagnostic keeps the word's own range, so no offset map is needed for whole-word lookups.
- Strip only what the dictionary's rules allow: the `.aff` file's `IGNORE` characters (harakat, tatweel, dagger alif), read from the file.
- **No unconditional alef or hamza normalisation**, which would hide real spelling mistakes. Ayaspell spells hamza strictly, so a bare alef for أ or إ is flagged.
- The `ArabicSpeller` trait is implemented with `spellbook` (Phase 0 benchmark: same verdicts as Hunspell, faster, pure Rust). Words are letters, marks, tatweel and joiners; Arabic punctuation and digits end a word.
- **Common misspellings** that Ayaspell's affix rules accept by accident (حتي، متي، ذالك، الرحمان، قالو…, also after و or ف) are refused, with their correction offered first. Only forms that are no word in any reading are listed; real words such as لدية or مدرسه are left alone.
- Corrections run off the request thread: the quick edit-based search first, the thorough similarity search only if it finds nothing, the whole within ~300 ms; whatever hasn't finished is left out.
- The dictionary is compiled into the binary and parsed (about 0.5 s, 45 MiB) on the first Arabic word that needs checking, never at launch.
- Tests: the Phase 0 benchmark (414 correct words, all accepted; 157 misspellings, the known misses listed; corrections for at least 80%) and a differential test against the system `hunspell` CLI as oracle, where installed.

### 7.4 Personal dictionary
- `<config>/bismillah/dictionary.txt`, one word per line, shared across languages; blank lines and lines starting with `#` are the writer's notes. bismillah only appends to it (atomically, keeping the rest byte for byte) and re-reads it when the window regains focus.
- A lower-case entry also accepts the word capitalised; any entry accepts the word in capitals; an Arabic entry matches with or without vocalisation.
- A failed write shows a notice and changes nothing.
- *Ignore* is per document and per app session, in memory only: the word (spelling) or the rule and text (grammar).

### 7.5 Threads and warm-up
- The checker's thread builds Harper's dictionary and rule group on the first block containing unmasked English prose. Punctuation, numbers and whitespace around masked runs alone do not load English. There is no speculative idle warm-up: empty, disabled and Arabic-only sessions retain no English checker. Once English is used it stays warm for fast subsequent checks and navigation. Memory: about 200 MiB after warm-up (§14), plus 45 MiB once Arabic is checked.
- Corrections are found on a second long-lived thread through a `Suggester` handle that shares the dictionaries. Harper keeps its search automata per thread (1–2 s to build), so that thread is warmed after the first English check, once the dictionary exists, and serves every popover; a fresh thread per request would pay the cost again.

## 8. Extensibility

See ADR-0005.

- **v1 ships declarative themes only.** A theme is a JSON or TOML file in `<config>/bismillah/themes/` that sets **semantic token values** (DESIGN.md §9.2) for light and/or dark.
  - Rust validates it (`themes.rs`): known keys only, colours parsed, contrast checked against the rules. Failures produce a warning and are listed in Settings.
  - No CSS, no selectors, no code.
- **The format** (Phase 5): optional `schema = 1` and `name`, then `[light]` and/or `[dark]` tables of tokens as `#rgb` or `#rrggbb` (opaque, so contrast can be measured):
  ```toml
  schema = 1
  name = "Sepia"
  [light]
  surface-editor = "#f4ecdd"
  text-primary = "#2b2117"
  ```
  JSON has the same shape. The file's name without its ending is the theme's id, which `colour_theme` holds. Files up to 64 KiB, at most 100 listed, hidden names skipped.
- **Checking:** each problem is typed (`Problem` in `themes.rs`, worded by `src/core/copy.ts`): unreadable (with the line where TOML or JSON stopped), too large, another schema, an unknown key, a wrong type, a colour that can't be read, no colours at all, a name another theme has. Unknown keys and bad colours are ignored and the rest applies. Contrast is checked on the theme's colours over bismillah's own (tokens a theme leaves out, aliases following their source), with every pair of DESIGN.md §9.4, and is a warning: the theme still applies.
- **Built-in themes** (`src-tauri/themes/*.toml`, compiled in) go through the same code, and a Rust test holds them to no problems at all. bismillah's own colours stay in `tokens.css`; a Rust test keeps its copy of them (for merging and contrast) equal to the stylesheet.
- **Applying** (`src/core/themes.svelte.ts`): the frontend sets the chosen theme's tokens for the variant on screen as custom properties on the root element (CSSOM, for the CSP), and follows the system's light/dark switch under System. `surface-code` is derived in Rust (`text-primary` at the alpha that draws `surface-panel` on the editor) whenever a theme changes one of those. High contrast is a block of `tokens.css` (`data-contrast="high"`); while it is on, no theme tokens are set.
- **Executable plugins are deferred.** No code path loads user-supplied JavaScript until an ADR settles the isolation model. JS imported into the app context runs with the app's full authority, and a wrapper API cannot enforce per-plugin permissions.
- Candidates to evaluate: a sandboxed iframe or Web Worker with a message-based API, and WASM. Arbitrary CodeMirror extensions and markdown-it callbacks are incompatible with a restricted API, so a future plugin API is expected to be message-based and narrow (commands, text transforms, export formats).
- Internally, features are still built against a clean command registry and extension points, so a future plugin API has something solid to expose.

## 9. Settings

- `settings.toml` and `keybindings.toml` live in the platform config dir (`$XDG_CONFIG_HOME/bismillah/` on Linux). What the app remembers but isn't a setting (window size, the last document) and the recovery journal live in the data dir (`$XDG_DATA_HOME/bismillah/`).
- The schema is versioned (`schema = 1`) and keys are `snake_case`: `theme`, `colour_theme` (a theme's id, `bismillah` for the app's own), `high_contrast`, `writing_profile` (`custom` for *Another font*), `custom_font` (a family name; no quotes, backslashes, `;`, `{` or `}`, so it can't end the CSS string it is set in), `text_scale`, `measure`, `line_height` (absent = the profile's), `fade_chrome`, `basmallah_opening`, `smart_punctuation`, `typewriter_scrolling`, `always_show_markdown`, `focus_mode`, `focus_granularity`, `focus_dimming` (`quiet` or `faint`), `check_spelling`, `check_grammar`, `english_dialect` (`settings.rs` holds the table with each key's range).
- Comments, layout and unknown keys are preserved when rewriting (`toml_edit`). An invalid value falls back to its default with a notice; an unreadable file is kept as `settings.toml.invalid` while the defaults apply. It never crashes, and a value the UI sends that fails validation is refused whole.
- **The configuration folder is watched** (`watch.rs`, as the library is; `config.rs` sorts what changed): `settings.toml`, `keybindings.toml`, `themes/` and `dictionary.txt` edited in another program apply as soon as they are saved, with no polling. Our own writes are recognised by their modification time and change nothing. Regaining window focus reads them again too, in case the folder couldn't be watched. The folder is created at launch so it can be watched.
- **`keybindings.toml`** (DESIGN.md §13): Rust reads it (`keybindings.rs`), flattening tables into dotted ids, so `"file.save" = …`, `file.save = …` and `[file]` `save = …` name the same command, and hands over each line with its number. The frontend checks the lines against the command registry, which it owns (`src/core/shortcuts.ts`: the notation, which keys a command may take, two commands given one key), and keeps each command's shortcut now (`src/core/keybindings.svelte.ts`), which the editor keymap (a compartment), the native menu (`setAccelerator`), the palette and the window's own handler follow. A file that can't be read leaves every command its own shortcut. bismillah writes the file only on *Create keybindings.toml*, never over an existing one.

## 10. Privacy and the network boundary

See ADR-0003 and PRIVACY.md. Two claims are kept distinct:

- **"bismillah works without a network."** Tested: the full e2e suite runs inside a network namespace with no network (`unshare -rn`).
- **"bismillah contains no networking features."** Supported by:
  - **CSP** (in `tauri.conf.json`): `default-src 'self'`; `connect-src` only Tauri IPC; `img-src 'self' bismillah-image: data:` (plus `http://bismillah-image.localhost`, the scheme's form on Windows); `font-src 'self'`; `script-src 'self'`; `style-src 'self'`; `object-src 'none'`; `frame-src 'none'`; `base-uri 'none'`; `form-action 'none'`. CodeMirror injects its base styles with a `<style>` element; Tauri gives inline style elements in `index.html` a fresh nonce on each load, and `src/editor/setup.ts` passes that nonce to `EditorView.cspNonce`. Style changes go through CSSOM, never `setAttribute("style")`. An e2e test asserts no CSP violations.
  - **Navigation guard:** the main webview refuses all navigation away from the app origin, and new windows are denied. Links in the editor are never followed by the webview.
  - **Links go to the writer's browser, never through bismillah** (Phase 6, ADR-0003): only on an explicit `Mod-click` or *Open link*. The frontend sends the address as the document writes it; `links.rs` parses it with `url` and hands on `https:`, `http:` and `mailto:` only (`www.` gets `https://`, a bare email address `mailto:`), refusing files, scripts and other programs' schemes; `platform.rs` gives it to the desktop's default app through GIO with a launch context. *Show in file manager* hands a `file://` URI of one of three folders Rust names itself. Addresses are never logged. Under the test harness nothing is launched: Rust records what it would hand on (`test_handed`).
  - **No network-capable Tauri plugins** (http, updater, websocket, upload), enforced by `deny.toml` (`cargo deny check bans`) in `pnpm verify` and a project hook. cargo-deny checks the feature set and desktop targets the app is actually built for: Tauri's optional networking features and its Android/iOS-only `reqwest` dependency are not in that tree.
  - **Native feature audit:** each release reviews the Rust dependency tree for socket use. 1.0 (docs/audits/2026-10-19-personal-1.0.md): no HTTP, TLS or DNS crate; `tokio` without `net`, `mio` from `notify` for inotify; the release binary's socket imports serve Unix-domain sockets (the single-instance socket, D-Bus, the display).
  - **Runtime test:** `strace -f -e trace=connect,sendto` over an e2e run shows no non-local connections.

We do **not** claim that the app *cannot* reach the network: a CSP is not an OS sandbox. Distribution channels may add OS-level confinement (e.g. a Flatpak without network permission).

**Logs:** local only, errors and warnings, never document contents, file contents or diagnostics text. Paths may be logged only at debug level, which is off by default.

## 11. Markdown dialect

The same dialect is used by the editor (and its live preview, ADR-0012) and by Copy as rich text:
- CommonMark plus the GFM extensions: tables, strikethrough, task lists, autolinks.
- Footnotes: the editor recognises `[^label]` references and `[^label]:` notes from its link syntax (live preview raises a reference only when its note exists); markdown-it-footnote renders them for Copy as rich text.
- **Links follow CommonMark:** a reference or shortcut link is a link only when its label is defined, so `[sic]` stays text in both live preview and Copy as rich text.
- YAML frontmatter delimited by `---` on the first line.
- **Raw HTML is never rendered:** live preview shows it as text, and Copy as rich text disables it and sanitises the result. `tests/fixtures/xss.md` is the fixture for both.
- Remote images are not loaded; they render as a placeholder showing their URL.

## 12. Desktop platform

bismillah is a desktop application only. It will never be a web or mobile app (ADR-0009).

### 12.1 Desktop-only frontend
- The frontend targets the three Tauri webviews and nothing else. It uses `@tauri-apps/api` directly.
- None of the following: `isTauri()` guards, browser fallbacks, `localStorage` persistence (settings live in Rust), service workers, web manifests, responsive or mobile meta tags, touch gestures, or a web build target.
- The Vite build target matches the oldest supported webview engine.
- Unit tests stub IPC with `@tauri-apps/api/mocks` (`mockIPC`) instead of keeping a browser mode alive.

The command context exposes no editor view after the document is closed, even
though the workspace keeps the editor instance to reuse when another document
opens. The application grids constrain their single columns with `minmax(0, 1fr)`,
so enlarged document text cannot increase the page width beyond the desktop window.

### 12.2 Desktop integration
- **Native application menu**, generated from the command registry (`src/core/commands.ts` → `src/core/menu.ts`, Tauri's JS menu API) with the same labels, IDs and accelerators as the palette and the editor keymap.
  - On macOS it lives in the global menu bar and must include the standard App and Edit menus, because without them `Cmd-C`/`Cmd-V`/`Cmd-Q` do not work in the webview.
  - On Linux and Windows the menu bar is hidden by default to keep the window calm, and is revealed with `Alt` (pressed and released alone) or `F10`, which also focus its first menu (`menu_reveal` → `platform.rs`); it hides again when it closes. While hidden, GTK fires no menu accelerators, so the editor keymap handles shortcuts exactly once.
- **The command line:** `bismillah [file | folder]`; `--help` and `--version` answer in the terminal and exit before any window or socket exists.
- **Help › Guide** (`F1`) opens the bundled `docs/guide.md` as a sample that is never saved (`doc_open_guide`); the package installs the same file in `/usr/share/doc/bismillah/`.
- **Opening files:**
  - `bismillah [file.md | folder]` from the command line.
  - "Open with" from the file manager: a `.desktop` entry with `MimeType=text/markdown;text/x-markdown;` on Linux, and file associations in the bundle config elsewhere.
  - Dropping a file onto the window opens it; dropping a folder makes it the library.
  - File › Open… (`Mod-O`) and New file… (`Mod-N`) through the native dialogs, shown by Rust.
  - A second launch hands its arguments to the running instance over `$XDG_RUNTIME_DIR/bismillah.sock` and exits; the running app saves, opens the file and focuses its window.
  - Opening a file outside the current library opens its parent folder as the library, so path validation (§6) always has a root.
- `bismillah folder/` (or a second launch with a folder) makes the folder the library and shows it; the last document opens only if it belongs to it.
- **Windows:** v1 has one main window. Size and maximised state are remembered (`state.rs`; the window starts hidden and is shown at its remembered size). The minimum window size is 480×360. The title shows `filename — bismillah`.
- **Native dialogs** for choosing a library folder and for "Save mine as…" (conflicts).
- **Quitting** flushes pending saves first (§5.5), including from the window manager's close and from `Mod-Q`.

#### Document navigation and UI synchronization

`src/editor/search.ts` installs CodeMirror search state and Escape handling; the command registry supplies only bismillah’s chosen search shortcuts. CodeMirror owns Unicode-aware match offsets, explicit undoable replacement, accessible announcements and line navigation panels. These editor-owned panels use semantic interface styles rather than custom dialog machinery. The unused Select all matches control is hidden because the editor has a single caret; Replace all is available. Search normalization never changes the document; full-form replacement is explicit and imprecise partial compatibility-character matches cannot be replaced.

`src/editor/goToLine.ts` adds examples and validation to CodeMirror's existing navigation panel. Capture handlers retain invalid submissions for correction, while CodeMirror still parses valid numeric positions, clamps them, moves the caret and manages closing/focus. No parallel navigation calculation or document transformation is introduced.

The native menu is created from fresh recursive option objects in one `Menu.new` request. One root and four section enumerations retrieve item handles for availability, accelerators and check marks. Settings application snapshots settings and tracks colour-theme changes explicitly, then uses Svelte `untrack` around editor/DOM work. A separate effect tracks menu readiness and the context read by menu synchronization, so document/library changes keep menu availability current without reapplying settings.

Search feedback extends CodeMirror's existing panel with a polite status region and an accessible field description. It uses the same `SearchQuery` cursor, stops at the first match, and does not rescan on selection-only transactions. No document edits or parallel search implementation are involved. Picker recovery actions close the modal before opening a native file dialog; visible Close controls preserve focus return.

### 12.3 Platforms
- **For now bismillah runs only on the author's Linux machine.** It is installed with a local Arch `PKGBUILD` (`makepkg -si`), so it appears in the launcher and opens `.md` files from the file manager. The package holds the binary (fonts, the dictionary and the guide compiled in), the desktop entry (`text/markdown`, `text/x-markdown`; its name, the Wayland app id and `StartupWMClass` are all `bismillah`), the icon from 32 px to scalable, the guide, README and PRIVACY under `/usr/share/doc/bismillah/`, and the licences. `packaging/check.sh` checks a built package: its files, the entry, *Open with* opening a file (launched from the entry under the harness), `--version`, and that every linked library belongs to a declared dependency.
- Public packaging (AppImage, .deb, .rpm, AUR, Flatpak) and macOS (WKWebView) / Windows (WebView2) builds come later. Until then, portability is protected by discipline (`platform.rs`, Tauri path APIs, `Mod-` shortcuts), not by CI.
- **Checks run locally.** `pnpm verify` runs every suite: tests, clippy, fmt, check, lint, `cargo deny`. CI arrives when the repo gets a remote.
- All platform code lives in `platform.rs`. Paths go through Tauri and `dirs`. Shortcuts use `Mod-`.
- Font rendering and CSS support differ between engines, so typography is checked in the real webviews.
- **Linux specifics:**
  - Screen-reader support goes through WebKitGTK's AT-SPI bridge and is tested with **Orca**.
  - Keyboard layout switching (e.g. English ↔ Arabic via XKB/Hyprland), dead keys and compose sequences are tested in the editor.
  - Some GPU/driver combinations need `WEBKIT_DISABLE_DMABUF_RENDERER=1`; this is documented in the README.

## 13. Testing strategy

### Code-quality gate

`pnpm verify` is the local gate (there is no remote or hosted CI). It fails on
TypeScript/Svelte diagnostics, formatting differences, ESLint warnings, failing
unit tests, Rust formatting differences, Clippy warnings, cargo-deny policy violations,
build failures, and real-app e2e or visual regressions. `--fast` skips only the
real-app build and suites. Unknown arguments fail rather than silently skipping
checks. Cargo checks, tests and the app build use `--locked`.

TypeScript uses `strict`, checked indexed access, exact optional properties,
explicit override checking, checked returns, switch fallthrough and side-effect
imports, and rejects unreachable code and unused labels. `svelte-check` checks the
app, Svelte components, tests, scripts and Vite config with warnings fatal. ESLint
adds the strict syntax rules and recommended type-aware rules using TypeScript's
project service, including unhandled promises, misused promises and unsafe `any`
flows. The Svelte parser and its `prefer-const` rule preserve reactive bindings;
Prettier owns formatting. Generated output and historical spikes are excluded.
No type-aware rules are disabled for application or test code.

Both Rust crates inherit the workspace lint policy: ignored must-use results and
unsafe operations inside unsafe functions are errors; Clippy flags `unwrap`,
`expect`, undocumented unsafe blocks, debug macros and unfinished implementations.
Assertions may panic in tests, including their setup helpers. The two diagnostic
examples return errors. The pure checking crate forbids unsafe code; native FFI
stays in `platform.rs` with safety comments. The machine's packaged Rust supplies
Clippy and rustfmt (currently Rust 1.99); the manifest's Rust 1.90 minimum is not a
claim that the gate tests older compilers.

For a connected supply-chain check, run `pnpm verify --online` (also accepts
`--fast`): cargo-deny must refresh successfully and `pnpm audit` must pass for all
dependencies, including development tools. Registry failures fail this mode.
Normal verification retains the cached Rust-advisory fallback for offline work;
it does not claim a fresh npm audit. New environments should first install with
`pnpm install --frozen-lockfile`.

Biome was considered on 2026-10-19. Its complete Svelte support remains experimental
([configuration](https://biomejs.dev/reference/configuration/)); retaining the
official Svelte ESLint plugin and Prettier avoids losing framework-specific checks
or adding a second formatter. Typed linting follows the
[typescript-eslint project-service guidance](https://typescript-eslint.io/troubleshooting/typed-linting/)
and the [Svelte plugin setup](https://sveltejs.github.io/eslint-plugin-svelte/user-guide/).

### Test layers

| Layer | Tool | Covers |
|---|---|---|
| Rust unit | `cargo test --workspace` | Save contract (fault injection: disk full, read-only, rename failure), path validation (traversal, symlinks), line endings/BOM round-trip, UTF-16 offset conversion, the personal dictionary file (failed writes included) |
| Checking fixtures | `cargo test -p bismillah-lint` | One block per line with the expected marks (`crates/bismillah-lint/tests/fixtures/`): English, Arabic with and without diacritics, mixed text, masked regions, routing; the Arabic benchmark and the hunspell oracle |
| Frontend unit | Vitest | Decoration ranges and classes, keymap, command registry, what is sent to the checker, stale-lint discarding, Basmallah deduplication |
| Real app e2e | `tauri-driver` (WebDriver) on Linux and Windows | Open/edit/save/reload, conflicts, recovery after a killed process, file opening (CLI, drag-drop, second instance), settings, keyboard-only flows, links on Ctrl+click and *Show in file manager* (`links.e2e.ts`), the guide (`guide.e2e.ts`), offline run |
| Visual | Screenshots via `tauri-driver` in the real app: WebKitGTK on Linux now, WebView2 on Windows later; macOS (no WebDriver support) checked by hand before releases | The specimen rendered (live preview) and with all Markdown shown, whose baselines are Phase 1's own; `pnpm app:shot` covers the four widths, both themes and zoom for review |
| Themes and settings | `tests/e2e/settings.e2e.ts`, `tests/visual/settings.visual.ts`, `themes.rs` and `keybindings.rs` unit tests, `src/core/shortcuts.test.ts` | Built-in and file themes applied per variant, problems listed, live reload of a theme file and of `keybindings.toml`, high contrast over any theme, shortcuts that work and stop working in the real editor, the starting file, Settings by keyboard, *Another font*, About |
| Live preview | `tests/e2e/spikes/live-preview.e2e.ts`, `tests/e2e/live-preview.e2e.ts`, `spikes/webview/composition.ts` | Clicks, selection, keyboard motion and typewriter scrolling on RTL and mixed lines while blocks reveal; the fold, images (with links out of the library), hover addresses, `Mod-R`; the XSS fixture inert in the editor and on the clipboard |
| Contrast | Unit test over the token table (`tokens.test.ts`), and `themes.rs` for built-in themes | Every semantic pair (DESIGN.md §9.4), high contrast at 7:1, Zuhd mode's faint text |
| Arabic rendering | `pnpm test:visual` (`tests/visual/arabic-rendering.visual.ts`) | Ink of every vocalised fixture word against a HarfBuzz reference, per bundled Arabic font; fails when a word gets worse, notes when WebKitGTK improves (ADR-0011) |
| Accessibility | `pnpm a11y` (`scripts/a11y.ts`, `a11y_tree.py`) | The tree Orca reads over AT-SPI, from a private accessibility bus inside the harness, in every screen and state: named controls and dialogs, Settings' headings, the library tree and its selected file, the palette's options, a failure as an alert, the first screen |
| Performance | `pnpm perf` (`scripts/perf.ts`) | §14's budgets in the release build: launch to an editable caret, typing in a 1 MB document, synchronous edits, scrolling, idle CPU, memory; a separate Node comparison of word counting |
| Package | `packaging/check.sh <package>` | §12.3 |
| Supply chain | `cargo deny check`, `pnpm audit` | Banned crates, licences, advisories |

All real-app runs go through `scripts/headless.sh` (private Xvfb, D-Bus, runtime, config and data directories), so they never touch the author's desktop, settings, recovery journal or trash (the freedesktop trash lives under the private data directory); the test harness refuses to start outside it. Rust unit tests use a stand-in trash in their scratch folder, never the system's. The library suite (`tests/e2e/library.e2e.ts`) works on a scratch copy of `tests/fixtures/library` and drives every library action from the keyboard, including attempts to leave the library through the IPC commands directly. File-safety e2e tests open real files with `test_open` and inject failures with `test_fault` (disk full, rename failure), both compiled into debug builds only and refused outside the harness. Native input that WebDriver can't produce (menus, accelerators, dead keys, layout switching, the clipboard) is driven with real X events (`xdotool`, raw XTEST via `spikes/webview/xtest.py`).

The test-mode-only `setFolderLabels` frontend hook supplies deterministic display metadata for visual fixtures. Random temporary folder names can wrap differently and alter fractional scroll positions; this hook does not change Rust’s actual storage locations or folder-opening authority.

Round-trip acceptance checks that must always pass:
- Vocalised Arabic, mixed-script text and CRLF files save unchanged.
- A failed write leaves recoverable text.
- A stale lint result never changes a newer document.

## 14. Performance budgets

The [resource-use follow-up](docs/audits/2026-10-20-resource-use.md) removes
speculative English loading from sessions that do not need it and skips identical
remembered-state writes (retrying failures, including a return to an old value).
Quick open caches Unicode-folded keys weakly by candidate, checking the original
name/path for changes, and retains only its best 50 matches instead of sorting every
match. Empty searches gather recent files and the first page in library order.
Matching, recency and tie-break rules remain the same. `pnpm perf -- --parts
resources,navigation` measures demand-loading and a 10,000-file quick-open workload;
launch output also records frontend milestones to distinguish UI work from native
GTK/WebKit startup. Deferring closed dialog roots was evaluated and rejected: its
small startup saving did not justify a Settings screenshot regression. Full
measurements and limits are in the audit.

The follow-up [hot-path audit](docs/audits/2026-10-19-hot-paths.md) records the
author-requested editing and scrolling investigation. Table previews compare the
revealed block's mapped boundaries when typing, so changing its length moves existing
grids instead of rebuilding them. Word counting still removes frontmatter and URLs
from a temporary copy of the whole text, then caches `Intl.Segmenter` totals by line
(newlines are word boundaries). Only lines in the current count are retained. The
300 ms debounce and document bytes are unchanged. The counter uses the dialect's
`frontmatterEnd` rule, including unclosed frontmatter, so metadata never becomes
prose just because its closing delimiter is temporarily missing.

The scrolling follow-up also stops direction detection at the first strong prose
letter, walking the text lazily and skipping parsed code/URLs/Markdown syntax.
Long paragraphs no longer require a full syntax scan for each visible line. Block
line styling clips traversal to visible lines even inside a book-length code block
or quote. Neither change alters direction rules, decoration classes or source text.

The [framework-guided follow-up](docs/audits/2026-10-20-frameworks.md) also maps
previews during ordinary prose edits beside unchanged inline code. The edit must
leave delimiters, escapes and the enclosing block's mapped boundaries intact;
syntax-sensitive edits still rebuild. Paragraph-end lookups check both sides of
the syntax boundary. Checker batching uses a cursor to stop the whole tree walk
at its UTF-16 budget, including the same whole blocks and inclusive range edges.
Library snapshots use Svelte's `$state.raw` because Rust replaces them as a whole;
expansion/focus/selection stay reactive. `library_get` uses Tauri async command
dispatch so startup joins and filesystem refreshes do not run on GTK's main thread.
Its payload and locking/path-validation behavior are unchanged.

Frontmatter edits bypass the preview fast path: changing a delimiter, even after
trailing spaces, can reclassify every following block.

`pnpm perf -- --parts editing,scrolling` measures synchronous transactions and frame
intervals during a scripted scroll of the 1 MB book in the real webview.
`--parts wordcount` compares the original and cached counters in Node's Intl engine;
those CPU timings are separate from WebKit measurements. `--out <path>` saves samples.
Use the default release binary for budget claims; `--binary target/debug/bismillah`
is useful for controlled before/after experiments.

- Launch to an editable caret: under 400ms on a mid-range Linux laptop. **Measured for 1.0** (`pnpm perf`, release build, headless: Xvfb without a GPU, on the author's i7-7820HQ): 524 ms at the median of warm launches (730 ms cold) with a short document on a quiet machine, 521 ms with 50,000 words; in a later run with another busy process on the machine, 588 ms without a library and 586 ms with a remembered library of 1,000 files. Not met. Of the 524 ms, 274 ms pass before the page starts loading (GTK, the window and WebKit's processes), 32 ms until its script runs, and 214 ms in the start: settings, the document from Rust, the first fonts and the editor. Phase 6 took 190 ms off (it was 716 ms): only the fonts the first screen uses are loaded before it, while Rust opens the document, and the others once the window is ready; the native menu is built after the text is editable; the Markdown language no longer loads the HTML, CSS and JavaScript grammars (the script went from 917 KB to 732 KB); and the remembered library is listed and watched on a thread of its own while the window starts, so a library of 1,000 files costs nothing measurable (it cost 50 ms on the main thread).
- No dropped frames while typing in a 1MB document. **Measured for 1.0** (key to painted frame, keys typed in bursts with pauses): a short document 10 ms at the median, 19 ms at p95; a 1 MB book (175,000 words) 19 ms at the median and 37 ms at p95 in prose, 24 ms and 42 ms on a line with code; frames longer than two refresh intervals while typing: 0.8 %, 4.4 % and 9 %. Not quite met at 1 MB. Phase 6 took it from about a second a key: drawn tables, images and link definitions were rebuilt for the whole document on every key, and are now kept across edits that can't change them (`inlineEdit` in `livePreview.ts`). What remains is CodeMirror's Markdown parser re-reading the document's block structure on each edit (Lezer's incremental parse walks every top-level block: about 6 ms in V8, 15 ms in WebKit's JavaScript engine, for 7,200 blocks).
- Lint results within 500ms of a typing pause. Measured 2026-10-18 (`cargo run -p bismillah-lint --release --example bench -- <corpus>`, 8 cores at load ≈ 4): one edited paragraph takes 8–25 ms at the median and 46–163 ms at p95 on 50,000-word Gutenberg texts, after the 300 ms pause; a first pass over 50,000 words takes 16–38 s of background CPU, visible blocks first; the session cache answers a reopened document in 2 ms. The checker holds about 200 MiB after warm-up and 260 MiB after a 50,000-word pass, plus 45 MiB once Arabic is checked.
- No CPU use when idle (no polling). **Quiet-harness measurement for 1.0:** 30 ms of CPU in a quiet minute across the app's three processes, with a library of 1,000 files open (0.05 %). Before Phase 6 fixed the watcher (§5.4) the same library kept 5 % of a core busy for as long as it was open. **The native idle budget is open:** the [live CPU investigation](docs/audits/2026-10-19-idle-cpu.md) reproduced about 50.5 % main-process CPU plus 11.4 % renderer CPU in a long-running Wayland instance. CPU-time samples attributed most hot UI-thread work to GTK/Cairo/Pixman painting and buffer filling. A native A/B/A comparison confirmed the unfocused caret-layer CSS animation as the trigger: about 55% main + 11% renderer CPU fell to 0.3% combined when it was disabled, and rose again when restored. The fix replaces CodeMirror's infinite CSS caret animation with discrete 600 ms visibility updates (`src/editor/caretBlink.ts`), resting visibly after about ten idle seconds and paused when unfocused/hidden/read-only and under reduced motion. The still-running old process has a temporary steady-caret workaround verified at 0.1% main and 0% renderer CPU; the rebuilt app retains bounded blinking. The default harness disables caret blinking, starts unfocused and disables the DMA-BUF renderer, so its quiet result does not establish native idle behaviour. `pnpm perf -- --parts caret --idle 15` separately tests focused blinking and unfocused idle in private X11; it still does not cover native Wayland/GPU behaviour.
- Memory, recorded for 1.0: 755 MiB resident across the three processes with a short document open and checked and a library of 1,000 files (bismillah 479 MiB, of which the checker holds about 245 MiB with Arabic; WebKit's web process 214 MiB; its network process 62 MiB), 915 MiB with a 1 MB book.

All budgets are measured, not assumed (`pnpm perf`; the run behind these numbers is in docs/audits/2026-10-19-personal-1.0.md). Package size is a tracked number; "small" is the goal, not a promise. 1.0 (`packaging/check.sh`): a 10.8 MiB package, 28.9 MiB installed, almost all of it the stripped binary (28.8 MiB), which carries the fonts (5.6 MiB), the Arabic dictionary (7 MiB), Harper's data and the frontend.
