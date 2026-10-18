# AGENTS.md

**bismillah** is a free, offline, minimal Markdown editor in the spirit of the original iA Writer, built with Tauri 2, Svelte 5, CodeMirror 6 and a Rust core. It has two features beyond typing (spelling in English and Arabic, grammar suggestions in English), so the quality of its typography, interaction and reliability *is* the product.

**Status:** Phase 1 (writing core) built and awaiting the author's review ([PLAN.md](PLAN.md)): single-file editing under the file-safety contract, recovery, settings, typing aids, Zuhd mode and the desktop basics. Phase 2 (library) starts after the review. Phase 0's spikes were accepted on 2026-10-18 ([docs/spikes/](docs/spikes/README.md)). Keep this file accurate as commands and layout change. bismillah is private and runs only on the author's Linux machine for now: local git, no remote, no CI. `pnpm verify` is the gate.

**Working mode:** build each phase end to end (code, tests, specimen screenshots, docs) and stop at the phase's acceptance check for the author's review. Within a phase, proceed without asking about decisions already recorded in DESIGN.md, ARCHITECTURE.md or an ADR.

## Where things are decided

| Read | Before |
|---|---|
| [DESIGN.md](DESIGN.md) | UI, copy, typography, colour or interaction work |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Files, saving, IPC, linting, settings or security work |
| [PLAN.md](PLAN.md) | Choosing what to build; work outside the current phase waits |
| [docs/decisions/](docs/decisions/) | Changing anything an ADR covers. Supersede it with a new ADR rather than diverging quietly |
| `.claude/rules/*.md` | Editing code in that area: per-language and per-area conventions. Claude Code loads these automatically; other agents should read the matching file |

## The writer's trust

These five rules protect the people who write in bismillah. Each one is a promise made in the README and PRIVACY.md, so breaking one breaks the product.

1. **Keep the app fully offline.** We promise that nothing leaves the writer's machine (ADR-0003). Solve problems with local code and bundled assets; network crates and plugins are banned in `deny.toml` and blocked by a project hook.
2. **Keep document contents out of logs.** Logs may be shared in bug reports. Log only error kinds and, at debug level, paths.
3. **Save exactly what the writer typed.** Writers quote scripture and vocalised Arabic, where one mark changes meaning. Open, paste and save without normalising Unicode, diacritics, punctuation or frontmatter. Spell-lookup normalisation works on a temporary copy with an offset map (ARCHITECTURE.md §7.3). The typing aids (smart punctuation, transliteration mode) are the only transformations: they act at the caret on just-typed characters, and an immediate Backspace undoes them (DESIGN.md §11.3).
4. **Report save state honestly.** Show "Saved" only after the durable write in ARCHITECTURE.md §5 completes, and keep failures visible until resolved, because a writer who trusts a false "Saved" can lose work.
5. **Validate every path in Rust** against the library root, including `..` and symlinks (ARCHITECTURE.md §6). The frontend asks; Rust decides. This keeps a bug in the UI from touching files the writer never chose.

## Standing decisions

- **Desktop only, never web or mobile** (ADR-0009). Write for the Tauri webviews and use Tauri APIs directly: persistence through Rust, no browser fallbacks or `isTauri()` guards, no responsive mobile layouts or touch handling. Follow desktop conventions (native menu, native dialogs, file opening, window state). Mobile, simulator and browser-automation tooling doesn't apply here; run the real app with `pnpm tauri dev` and test it with `tauri-driver`.
- **No generative AI** (ADR-0004, author's decision 2026-10-18): nothing may write, rewrite or summarise the writer's text or do their thinking. Grammar checking smarter than a spell checker, including small local models, is fine when it only flags and suggests and the writer accepts each change.
- **Extensibility is declarative themes only.** Loading user JavaScript would give it the app's full authority, so executable plugins wait for an ADR on isolation (ADR-0005).
- **Preview renders with raw HTML disabled** and sanitises with DOMPurify after all rendering, so a document can never run script.
- **The Basmallah opening is a presentation element**, outside the file, the CodeMirror document, counts and linting (ADR-0008).
- **Arabic and mixed-script text are first-class.** Check every editor or typography change against RTL, vocalised Arabic and mixed lines in `docs/specimen.md`.
- **Add a dependency only for a hard problem**: correctness, accessibility or security work we would otherwise hand-write. Record its job in ARCHITECTURE.md §2.
- **Style components with semantic tokens** (DESIGN.md §9). Quiet text uses `text-secondary`, never opacity, so contrast stays measurable.

## Commands

All of these exist. Real-app commands need `pnpm app:build` first and run headless through `scripts/headless.sh`.

```bash
pnpm install && pnpm tauri dev   # run the app
pnpm check && pnpm lint          # svelte-check + tsc strict; eslint + prettier
pnpm test                        # vitest
pnpm test:e2e                    # tauri-driver against the real app
pnpm test:visual                 # screenshot regression in the real app (UPDATE_BASELINES=1 to rewrite)
pnpm app:build                   # debug build with the frontend embedded (needed by the real-app commands)
pnpm app:shot                    # specimen screenshots at 640/1280/1920/2560 (see run-app skill)
pnpm test:offline                # e2e suite with no network, under strace
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --all --check
cargo deny check                 # banned crates, licences, advisories
pnpm verify                      # all checks incl. build, e2e and visual; the gate before every commit (--fast skips the real-app suites)
cd packaging/arch && makepkg -si # build the committed HEAD and install it on this machine
```

## Running and seeing the app

Under the harness the app opens the bundled specimen as a *sample* (never saved) and uses private config and data directories. E2e tests open real files with the `open(path)` test hook and inject save failures with `fault(kind)` (debug builds only; see `src/core/testHooks.ts`).

**Never launch the app outside `scripts/headless.sh` for automated work** (`pnpm app:shot`, `pnpm test:e2e` and the spike scripts already use it); a bare launch opens a window on the author's desktop. Use the `run-app` skill: headless runs by default (`xvfb-run`), webview screenshots via `tauri-driver` that you inspect yourself, window-only captures on the live Hyprland session when native behaviour matters, and offline proof runs (`unshare -rn`, `strace`). Never capture the author's full screen.

## Definition of done

- Tests added or updated, and all suites, clippy, fmt, check and lint pass.
- File-handling changes include a failure-path test (disk full, read-only, conflict, killed process).
- Editor or typography changes are checked against `docs/specimen.md`, including Arabic and mixed lines, **in the real Tauri app**, because each platform's webview renders differently.
- UI changes pass the design review (run the `design-review` skill, or follow DESIGN.md §18): keyboard-only use, and contrast in both themes.
- Docs updated where behaviour or decisions changed (DESIGN, ARCHITECTURE, PLAN, AGENTS, ADRs).

## Working style

- Make the smallest change that fully solves the problem, within the current phase.
- When a request conflicts with DESIGN.md or an ADR, say so and propose an ADR update.
- For typography or interaction questions, build the specimen case first and look at it in the real webview.
- Commit messages: imperative summary of at most 72 characters, optional scope (`editor: hang list markers in RTL`), and a body explaining *why*.
