# bismillah — Architecture

This document describes how bismillah is built and the contracts each part must keep. Product and visual decisions live in [DESIGN.md](DESIGN.md). Lasting decisions are recorded as ADRs in [docs/decisions/](docs/decisions/). If code and this document disagree, fix one of them in the same change.

> **Status:** Phase 0 done. The Tauri + Svelte + CodeMirror scaffold, the test harness and the spike extensions exist (§3 marks what is real); file handling, the library and linting arrive in Phases 1–3.

---

## 1. Overview

```
┌──────────────────────── Tauri window (system webview) ────────────────────────┐
│  Svelte 5 UI (library, palette, settings, status)   CodeMirror 6 editor       │
│  Bits UI primitives + plain CSS tokens              markdown-it preview       │
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
| CodeMirror 6 + `@codemirror/lang-markdown` (Lezer) | Editing, IME, bidi, undo, search, accessibility |
| markdown-it | Preview rendering (raw HTML disabled) |
| DOMPurify | Sanitises preview HTML after all rendering extensions have run |
| `harper-core` | English spelling and grammar, offline. Embeds a small chunking model via `burn` (allowed by ADR-0004's AI policy); build without the thesaurus feature |
| `spellbook` | Arabic spelling behind the `ArabicSpeller` adapter (ADR-0004; chosen in Phase 0) |
| `notify` | File watching |
| `trash` | Move to the system trash instead of deleting |
| `dirs` / Tauri path API | Platform config, data and cache directories |
| `tauri-plugin-dialog` | Native open-folder and save-as dialogs |
| `tauri-plugin-opener` | Reveal in file manager; hand links to the system browser (it makes no requests itself) |
| `tauri-plugin-single-instance` | Files opened from the file manager or command line go to the running app |
| `tauri-plugin-window-state` | Remember window size, position and maximised state |
| `tauri-plugin-clipboard-manager` | "Copy as rich text": put both HTML (rendered with the preview pipeline) and plain text on the clipboard |
| `serde`, `toml`, `thiserror` | Settings and errors |
| `gtk` (Linux only, already in Tauri's tree) | Focus the native menu bar on `Alt`/`F10` (`platform.rs`) |

**Development only** (never shipped): WebdriverIO + `tauri-driver` (real-app e2e), `pixelmatch` + `pngjs` (screenshot comparison), Vitest + jsdom, ESLint + Prettier, svelte-check. Spike and font tooling run through `uv`: fontTools (font build), `uharfbuzz` (rendering reference), `python-xlib` (raw X input and clipboard).

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
│  │  ├─ main.rs, lib.rs      app setup, CSP, navigation guard, commands (document, menu)
│  │  ├─ platform.rs          all cfg(target_os) code (menu-bar focus on Linux)
│  │  └─ library.rs, documents.rs, recovery.rs, watch.rs, settings.rs, themes.rs, lint.rs  (planned)
│  └─ capabilities/           minimal Tauri capability set
├─ crates/bismillah-lint/     (planned, Phase 3) pure Rust, no Tauri dependency
├─ src/
│  ├─ core/                   command registry, native menu, typed IPC bridge, appearance,
│  │                          test hooks (only with BISMILLAH_TEST=1)
│  ├─ editor/                 CodeMirror setup + one extension per concern: dialect (frontmatter),
│  │                          markdownStyling, hangingMarks, bidi, scriptRuns, basmallah, typewriter,
│  │                          typingAids (smart punctuation, transliteration mode)
│  ├─ preview/                (planned, Phase 4)
│  ├─ ui/                     (planned) Svelte components
│  └─ styles/                 tokens.css, fonts.css, profiles.css, editor.css
├─ fonts/  source/ (upstream) · build/ (Bismillah Duo/Mono) · tools/ (build + verify scripts)
├─ dictionaries/              Arabic dictionary + licence
├─ scripts/                   headless.sh, verify.sh, offline.sh, app-shot.ts
├─ tests/                     e2e/ (incl. spikes/), visual/ (baselines), fixtures/ (bidi, profiles, quran)
├─ spikes/                    Phase 0 experiments: arabic-speller, harper-latency, transliteration, webview
└─ docs/  decisions/ · spikes/ · specimen.md · reviews/ · interviews/
```

## 4. IPC surface

All commands are typed on both sides (Rust structs ↔ TS types in `src/core/ipc.ts`). Every command that takes a path validates it in Rust (§6). The capability files grant the main window only these commands plus the core event system.

| Command | Purpose |
|---|---|
| `library_open(path)` / `library_tree()` | Select the library root (via the native dialog) and list it |
| `doc_open(path)` → `{text, revision, line_ending, bom, mtime, size, hash}` | Open a document |
| `doc_save(path, text, base_revision)` → `{revision}` or a typed error | Save (§5) |
| `file_create`, `file_rename`, `file_trash`, `dir_create`, `reveal_in_file_manager` | File operations |
| `recovery_list()` / `recovery_restore(id)` / `recovery_discard(id)` | Recovery |
| `lint(request)` → `LintResponse` | Spelling and grammar (§7) |
| `settings_get/set`, `keybindings_get`, `themes_list` | Configuration |

Events (Rust → UI): `file-changed-externally`, `library-changed`, `settings-changed`.

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

### 5.3 Preserving the file
- Text is written back **byte-for-byte as edited**: no Unicode normalisation, no diacritic stripping, no punctuation or whitespace rewriting, no frontmatter rewriting.
- **Line endings** (LF/CRLF) are detected on open and preserved on save. A UTF-8 BOM is preserved if present.
- **Encoding:** UTF-8 only. A non-UTF-8 file opens read-only with a clear notice; it is never re-encoded silently.

### 5.4 External changes and conflicts
- Before replacing a file, the save checks that its mtime, size and content hash still match what was last read or written.
- If they don't:
  - No local edits: reload quietly, keeping the caret and scroll as close as possible.
  - Local edits: **do not overwrite**. Show the persistent conflict bar: *Keep mine* (save over) · *Load theirs* (local text goes to recovery first) · *Save mine as…*
- The watcher (`notify`) triggers the same check proactively. The save-time check is the authority.

### 5.5 Autosave and Save now
- Autosave runs about 500ms after typing pauses, when switching documents, on window blur and when quitting.
- `Mod-S` (`file.save`) flushes immediately and confirms visibly. Quitting waits for pending writes (with a timeout that leaves the text in recovery).

### 5.6 Failures
- Disk full, read-only volume, permission denied, file removed or volume unmounted: each has a typed error and a plain message (DESIGN.md §14).
- The failure state persists until a save succeeds or the writer acts. Text is placed in recovery.

### 5.7 Recovery journal
- Unsaved content is mirrored, debounced, to `<app-data>/recovery/<id>.md` plus a small JSON sidecar (original path, revision, timestamp). Files get `0600` permissions where supported.
- On launch, entries newer than their target file are offered for restore. Entries are removed after a clean save or an explicit discard.
- Bounded: per-file and total size caps, and a maximum age.
- This is the one deliberate exception to "no hidden files". It lives outside the writing folder and is documented in PRIVACY.md.

### 5.8 Destructive actions
Delete means move to the system trash (`trash` crate), with an in-app undo for the session. Rename refuses to overwrite an existing file.

## 6. Library boundary

- The library root is chosen by the writer through the native dialog, then stored canonicalised.
- Every incoming path is resolved against the root and canonicalised. It is rejected if it escapes the root (`..`, absolute paths, or **symlinks resolving outside the root**). Symlinks inside the root are followed; symlinks pointing outside are listed but marked unavailable.
- Only `.md` files (and `.markdown`) are listed as documents. Other files are not shown in v1.
- Local preview images are served through the Tauri asset protocol, scoped at runtime to the library root.

## 7. Spelling and grammar pipeline

Detailed in ADR-0004.

### 7.1 Request and response
```text
LintRequest  { doc_id, revision, blocks: [{ block_id, text, lang_hint? }] }
LintResponse { doc_id, revision, blocks: [{ block_id, diagnostics: [Diagnostic] }] }
Diagnostic   { from_utf16, to_utf16, kind: Spelling|Grammar, message, suggestions[], rule_id }
```
- The frontend sends only **changed blocks** (paragraphs, headings, list items), debounced at about 400ms. Code, inline code, URLs, link targets, frontmatter and the Basmallah presentation element are never sent or are masked.
- **Offsets crossing the boundary are UTF-16 code units, relative to the block.** Rust converts internally (bytes/chars ↔ UTF-16) in one tested module. Tests cover emoji, combining marks, Arabic diacritics and CRLF.
- **Stale results are discarded:** a response whose `revision` is older than the document's current revision for that block is dropped, and never mapped onto newer text.

### 7.2 Language routing
- Text is segmented into **script runs**: Arabic-script runs go to the Arabic speller; Latin runs go to Harper.
- Script alone does not establish language, so a frontmatter `lang:` or an explicit setting overrides the routing. Grammar runs only on runs routed to English.
- Text in other scripts is left unchecked; it is never flagged.
- **Qur'anic text is skipped automatically.** Any Arabic run containing alef wasla (U+0671) or Qur'anic annotation characters (U+0610–U+061A, U+06D6–U+06ED, U+08D3–U+08FF) is not spellchecked, because Uthmani orthography differs from modern spelling. The test is purely on characters, so no text is ever classified by meaning. (`src/editor/scriptRuns.ts` already uses the same trigger to set such runs in Amiri Quran.)
- **Harper (Phase 0 findings):** one long-lived lint thread (its group is `Send + Sync` but `lint` takes `&mut self`); offsets come back as Unicode scalar values; ʿ and ʾ split its tokens, so IJMES words are masked or handled by our own dictionary check; spelling suggestions are computed on request, not inline.

### 7.3 Arabic analysis
- Lookup normalisation happens on a **temporary analysis copy** with an offset map back to the original. The document is never changed.
- Strip only what the dictionary's rules allow (diacritics and tatweel, per its `IGNORE`).
- **No unconditional alef or hamza normalisation**, which would hide real spelling mistakes.
- The `ArabicSpeller` trait is implemented with `spellbook` (Phase 0 benchmark: same verdicts as Hunspell, faster, pure Rust). The adapter strips the dictionary's `IGNORE` characters on the analysis copy before check *and* suggest, suggests only on request with a ~300 ms budget off the UI thread, and loads the dictionary lazily. The `hunspell` CLI serves as a test oracle.

### 7.4 Personal dictionary
`<config>/bismillah/dictionary.txt`, one word per line, shared across languages. *Ignore* is per session and per document.

## 8. Extensibility

See ADR-0005.

- **v1 ships declarative themes only.** A theme is a JSON or TOML file in `<config>/bismillah/themes/` that sets **semantic token values** (DESIGN.md §9.2) for light and/or dark.
  - Rust validates it: known keys only, colours parsed, contrast checked against the rules. Failures produce a warning and are listed in Settings.
  - No CSS, no selectors, no code.
- **Executable plugins are deferred.** No code path loads user-supplied JavaScript until an ADR settles the isolation model. JS imported into the app context runs with the app's full authority, and a wrapper API cannot enforce per-plugin permissions.
- Candidates to evaluate: a sandboxed iframe or Web Worker with a message-based API, and WASM. Arbitrary CodeMirror extensions and markdown-it callbacks are incompatible with a restricted API, so a future plugin API is expected to be message-based and narrow (commands, text transforms, export formats).
- Internally, features are still built against a clean command registry and extension points, so a future plugin API has something solid to expose.

## 9. Settings

- `settings.toml` and `keybindings.toml` live in the platform config dir (`$XDG_CONFIG_HOME/bismillah/` on Linux).
- The schema is versioned (`schema = 1`) and keys are `snake_case` (e.g. `focus_mode`, `writing_profile`, `measure = "standard"`).
- Unknown keys are preserved when rewriting. An invalid file falls back to defaults with a visible notice and a backup of the bad file; it never crashes.
- Changes made in the file while the app runs are picked up live.

## 10. Privacy and the network boundary

See ADR-0003 and PRIVACY.md. Two claims are kept distinct:

- **"bismillah works without a network."** Tested: the full e2e suite runs inside a network namespace with no network (`unshare -rn`).
- **"bismillah contains no networking features."** Supported by:
  - **CSP** (in `tauri.conf.json`): `default-src 'self'`; `connect-src` only Tauri IPC; `img-src 'self' asset: data:`; `font-src 'self'`; `script-src 'self'`; `style-src 'self'`; `object-src 'none'`; `frame-src 'none'`; `base-uri 'none'`; `form-action 'none'`. CodeMirror injects its base styles with a `<style>` element; Tauri gives inline style elements in `index.html` a fresh nonce on each load, and `src/editor/setup.ts` passes that nonce to `EditorView.cspNonce`. Style changes go through CSSOM, never `setAttribute("style")`. An e2e test asserts no CSP violations.
  - **Navigation guard:** the main webview refuses all navigation away from the app origin, and new windows are denied. Links in preview open in the system browser only on an explicit `Mod-click` (the app makes no request itself).
  - **No network-capable Tauri plugins** (http, updater, websocket, upload), enforced by `deny.toml` (`cargo deny check bans`) in `pnpm verify` and a project hook. cargo-deny checks the feature set and desktop targets the app is actually built for: Tauri's optional networking features and its Android/iOS-only `reqwest` dependency are not in that tree.
  - **Native feature audit:** each release reviews the Rust dependency tree for socket use.
  - **Runtime test:** `strace -f -e trace=connect,sendto` over an e2e run shows no non-local connections.

We do **not** claim that the app *cannot* reach the network: a CSP is not an OS sandbox. Distribution channels may add OS-level confinement (e.g. a Flatpak without network permission).

**Logs:** local only, errors and warnings, never document contents, file contents or diagnostics text. Paths may be logged only at debug level, which is off by default.

## 11. Markdown dialect

The same dialect is used in the editor and in preview:
- CommonMark plus the GFM extensions: tables, strikethrough, task lists, autolinks.
- Footnotes (markdown-it-footnote in preview; a small Lezer extension in the editor).
- YAML frontmatter delimited by `---` on the first line.
- **Raw HTML is disabled** in preview (shown as text).
- Remote images are not loaded; they render as a placeholder showing their URL.

## 12. Desktop platform

bismillah is a desktop application only. It will never be a web or mobile app (ADR-0009).

### 12.1 Desktop-only frontend
- The frontend targets the three Tauri webviews and nothing else. It uses `@tauri-apps/api` directly.
- None of the following: `isTauri()` guards, browser fallbacks, `localStorage` persistence (settings live in Rust), service workers, web manifests, responsive or mobile meta tags, touch gestures, or a web build target.
- The Vite build target matches the oldest supported webview engine.
- Unit tests stub IPC with `@tauri-apps/api/mocks` (`mockIPC`) instead of keeping a browser mode alive.

### 12.2 Desktop integration
- **Native application menu**, generated from the command registry (`src/core/commands.ts` → `src/core/menu.ts`, Tauri's JS menu API) with the same labels, IDs and accelerators as the palette and the editor keymap.
  - On macOS it lives in the global menu bar and must include the standard App and Edit menus, because without them `Cmd-C`/`Cmd-V`/`Cmd-Q` do not work in the webview.
  - On Linux and Windows the menu bar is hidden by default to keep the window calm, and is revealed with `Alt` (pressed and released alone) or `F10`, which also focus its first menu (`menu_reveal` → `platform.rs`); it hides again when it closes. While hidden, GTK fires no menu accelerators, so the editor keymap handles shortcuts exactly once.
- **Opening files:**
  - `bismillah [file.md | folder]` from the command line.
  - "Open with" from the file manager: a `.desktop` entry with `MimeType=text/markdown;text/x-markdown;` on Linux, and file associations in the bundle config elsewhere.
  - Dropping a `.md` file or a folder onto the window.
  - A second launch hands its arguments to the running instance (`single-instance`), which opens them and focuses its window.
  - Opening a file outside the current library opens its parent folder as the library, so path validation (§6) always has a root.
- **Windows:** v1 has one main window. Size, position and maximised state are remembered. The minimum window size is 480×360. The title shows `filename — bismillah`.
- **Native dialogs** for choosing a library folder and for "Save mine as…" (conflicts).
- **Quitting** flushes pending saves first (§5.5), including from the window manager's close and from `Mod-Q`.

### 12.3 Platforms
- **For now bismillah runs only on the author's Linux machine.** It is installed with a local Arch `PKGBUILD` (`makepkg -si`), so it appears in the launcher and opens `.md` files from the file manager.
- Public packaging (AppImage, .deb, .rpm, AUR, Flatpak) and macOS (WKWebView) / Windows (WebView2) builds come later. Until then, portability is protected by discipline (`platform.rs`, Tauri path APIs, `Mod-` shortcuts), not by CI.
- **Checks run locally.** `pnpm verify` runs every suite: tests, clippy, fmt, check, lint, `cargo deny`. CI arrives when the repo gets a remote.
- All platform code lives in `platform.rs`. Paths go through Tauri and `dirs`. Shortcuts use `Mod-`.
- Font rendering and CSS support differ between engines, so typography is checked in the real webviews.
- **Linux specifics:**
  - Screen-reader support goes through WebKitGTK's AT-SPI bridge and is tested with **Orca**.
  - Keyboard layout switching (e.g. English ↔ Arabic via XKB/Hyprland), dead keys and compose sequences are tested in the editor.
  - Some GPU/driver combinations need `WEBKIT_DISABLE_DMABUF_RENDERER=1`; this is documented in the README.

## 13. Testing strategy

| Layer | Tool | Covers |
|---|---|---|
| Rust unit | `cargo test --workspace` | Save contract (fault injection: disk full, read-only, rename failure), path validation (traversal, symlinks), line endings/BOM round-trip, lint fixtures, UTF-16 offset conversion |
| Frontend unit | Vitest | Decoration ranges and classes, keymap, command registry, stale-lint discarding, Basmallah deduplication |
| Real app e2e | `tauri-driver` (WebDriver) on Linux and Windows | Open/edit/save/reload, conflicts, recovery after a killed process, file opening (CLI, drag-drop, second instance), settings, keyboard-only flows, offline run |
| Visual | Screenshots via `tauri-driver` in the real app: WebKitGTK on Linux now, WebView2 on Windows later; macOS (no WebDriver support) checked by hand before releases | Specimen at window widths 640/1280/1920/2560, both themes, editor and preview, zoom 200% |
| Contrast | Unit test over the token table | Every semantic pair (DESIGN.md §9.4) |
| Arabic rendering | `pnpm test:visual` (`tests/visual/arabic-rendering.visual.ts`) | Ink of every vocalised fixture word against a HarfBuzz reference, per bundled Arabic font; fails when a word gets worse, notes when WebKitGTK improves (ADR-0011) |
| Supply chain | `cargo deny check`, `pnpm audit` | Banned crates, licences, advisories |

All real-app runs go through `scripts/headless.sh` (private Xvfb, D-Bus and runtime directory), so they never touch the author's desktop; the test harness refuses to start outside it. Native input that WebDriver can't produce (menus, accelerators, dead keys, layout switching, the clipboard) is driven with real X events (`xdotool`, raw XTEST via `spikes/webview/xtest.py`).

Round-trip acceptance checks that must always pass:
- Vocalised Arabic, mixed-script text and CRLF files save unchanged.
- A failed write leaves recoverable text.
- A stale lint result never changes a newer document.

## 14. Performance budgets

- Launch to an editable caret: under 400ms on a mid-range Linux laptop.
- No dropped frames while typing in a 1MB document.
- Lint results within 500ms of a typing pause.
- No CPU use when idle (no polling).

All budgets are measured, not assumed. Package size is a tracked number; "small" is the goal, not a promise.
