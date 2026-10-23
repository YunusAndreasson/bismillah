# AGENTS.md

**bismillah** is a free, offline, minimal Markdown editor in the spirit of the original iA Writer, built with Tauri 2, Svelte 5, CodeMirror 6 and a Rust core. It has two features beyond typing (spelling in English and Arabic, grammar suggestions in English), so the quality of its typography, interaction and reliability *is* the product.

**Status:** Phase 6 (personal 1.0) was built on 2026-10-19 and waits for the author's acceptance check ([PLAN.md](PLAN.md)): version 1.0.0, the polished local package (`packaging/check.sh`), the guide inside the app (Help › Guide, `F1`), the bāʾ icon, the accessibility audit (`pnpm a11y`), the measured performance budgets (`pnpm perf`), and the 1.0 audit (docs/audits/2026-10-19-personal-1.0.md). Phases 4 and 5 were built the same day and the author moved on; Phases 2 and 3 were accepted on 2026-10-18; Phase 1 was built that day and the author moved on; the earlier phases' manual checks are still listed in PLAN.md. Phase 0's spikes were accepted on 2026-10-18 ([docs/spikes/](docs/spikes/README.md)). Keep this file accurate as commands and layout change. bismillah is private and runs only on the author's Linux machine for now: local git, no remote, no CI. `pnpm verify` is the gate.

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
- **Live preview never renders raw HTML** (it shows as text), so a document can never run script (ADR-0012).
- **No links, file manager or rich copy** (ADR-0015): links never open, and there is no *Show in file manager* or *Copy as rich text*, because the stick has no browser, file manager or other app. Plain copy and paste stay.
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
pnpm app:shot                    # specimen screenshots at 640/1280/1920/2560; --open settings|about (see run-app skill)
pnpm test:offline                # e2e suite with no network, under strace
pnpm a11y                        # the accessibility tree (AT-SPI, as Orca reads it) in every screen
pnpm perf                        # §14 budgets, editing/scrolling, Node word-count comparison; release build
packaging/check.sh <package>     # a built package: files, desktop entry, Open with, --version, depends
cargo test --workspace           # includes the checking fixtures (crates/bismillah-lint/tests/)
cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --all --check
cargo deny check                 # banned crates, licences, advisories
pnpm verify                      # all checks incl. build, e2e and visual; the gate before every commit (--fast skips the real-app suites)
pnpm verify --online             # also require fresh Rust advisories + pnpm audit; accepts --fast
pnpm os:fetch && pnpm os:verify  # the bismillah stick (os/PLAN.md): fetch inputs once, then build offline and test in VMs
pnpm os:perf                     # the stick's boot stages, sizes and RAM against os/perf-baseline.json (--sizes, --update)
os/scripts/trace.sh              # re-record the stick's allowlist (os/mkosi/allowlist.txt) from a traced VM run
cd packaging/arch && makepkg -si # build the committed HEAD and install it on this machine
```

TypeScript's strict compiler options and ESLint's type-aware checks cover the app,
Svelte components, tests and scripts. ESLint warnings fail the gate. Both Rust crates
inherit workspace lints (panic-prone calls, unfinished code, unsafe documentation);
tests may panic, and `bismillah-lint` forbids unsafe code. See ARCHITECTURE.md §13
for the policy and the reason ESLint/Prettier are retained over Biome. Normal
verification can use cached Rust advisories offline; `--online` requires live
registries and fails if they are unavailable. Use `pnpm install --frozen-lockfile`
when setting up a clean environment; Cargo checks and builds enforce its lockfile.

For persistent project-scoped Codex approvals, the author can run
`python3 scripts/setup-codex-rules.py`, then restart Codex. `--check` validates
without installing. Invoke approved pnpm/Cargo commands directly: shell wrappers,
redirections and substitutions can prevent prefix rules from matching.

## Running and seeing the app

Under the harness the app opens the bundled specimen as a *sample* (never saved) and uses private config, data and trash directories. E2e tests open real files with the `open(path)` test hook, make a scratch copy of `tests/fixtures/library` the library with `setLibrary(path)`, answer the next native dialog with `nextDialog(path)` and inject save failures with `fault(kind)` (debug builds only; see `src/core/testHooks.ts`). Visual tests use `setFolderLabels` for stable display-only paths; it never changes Rust’s storage locations. WebDriver reads any script result with an `error` key as its own failure, so probes name such fields differently.

**Never launch the app outside `scripts/headless.sh` for automated work** (`pnpm app:shot`, `pnpm test:e2e` and the spike scripts already use it); a bare launch opens a window on the author's desktop. Use the `run-app` skill: headless runs by default (`xvfb-run`), webview screenshots via `tauri-driver` that you inspect yourself, window-only captures on the live Hyprland session when native behaviour matters, and offline proof runs (`unshare -rn`, `strace`). Never capture the author's full screen.

## Definition of done

The follow-up [exploratory QA audit](docs/audits/2026-10-19-exploratory-qa.md)
records the frontmatter, narrow-window and closed-document command regressions found
while driving the real app. Their reproductions live in `tests/e2e/regressions.e2e.ts`.
The subsequent [UI review](docs/audits/2026-10-19-ui-review.md) adds minimum-window,
long-filename, native-menu and actual keyboard/focus checks in
`tests/e2e/ui-review.e2e.ts`. Pending spelling responses are covered in
`src/core/checking.test.ts`. The [scrolling follow-up](docs/audits/2026-10-20-scrolling.md)
adds a pinned CodeMirror default-metrics correction and four-profile scroll
regressions. The [framework follow-up](docs/audits/2026-10-20-frameworks.md) bounds
checker traversal, maps safe inline-code prose edits, avoids deep library snapshot
proxies and dispatches library queries off the UI thread. The
[resource-use follow-up](docs/audits/2026-10-20-resource-use.md) demand-loads English,
bounds quick-open ranking and skips identical metadata writes while retrying failures.
The document-navigation follow-up adds CodeMirror Find/Replace and line/percentage
navigation, bulk native-menu construction and an isolated reactive settings bridge.
Search regressions are in `src/editor/search.test.ts` and
`tests/e2e/search.e2e.ts`; the accessibility audit also covers both editor panels.
The heuristic UI follow-up adds visible panel exits, explicit toggle states, useful
empty-library actions, search feedback and discoverable help. Its evidence and
complete change list are in [the usability audit](docs/audits/2026-10-20-usability.md).
The Norman-inspired UX follow-up explains immediate Settings changes, limits and
font defaults, keeps invalid navigation correctable, exposes settings-save retry
inside the modal, and acknowledges explicit document saves honestly. Evidence:
[the experience audit](docs/audits/2026-10-20-experience.md).
The [stick QA pass](docs/audits/2026-10-22-stick-qa.md) drove the editor in the
stick's VM by keyboard: pickers that died after the library had focus, focus left in
the tree after quick open, dialogs that scrolled long texts to the top, and frames
shown late on software rendering.
The current gate covers 410 frontend and 188 Rust tests, all 26
real-app suites and 16 visual checks.

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
