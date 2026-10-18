# Contributing to bismillah

Thank you for wanting to help. bismillah is small on purpose, so the most valuable contributions make what exists more dependable and more beautiful, rather than adding more.

## Before you start

1. Read [DESIGN.md](DESIGN.md). Section 3 lists what bismillah will never have.
2. Read [ARCHITECTURE.md](ARCHITECTURE.md) for anything touching files, IPC, linting or security.
3. Check [PLAN.md](PLAN.md) for the current phase. Work outside it will likely wait.
4. For anything bigger than a fix, open an issue first so we can agree on the approach.

## What we welcome

- Bug fixes, especially in saving, recovery, bidi and RTL, and accessibility.
- Typography refinements backed by specimen screenshots from the real app.
- Improvements to Arabic support from people who write Arabic.
- Tests, particularly failure-path and mixed-script fixtures.
- Clearer documentation and interface copy.

## What we will decline

Features from DESIGN.md §3 (accounts, sync, telemetry, AI, networking, engagement mechanics), and features that do not improve the core writing task. A polite no is part of keeping bismillah calm.

## Development

Setup instructions arrive with the Phase 1 scaffold. The planned commands are listed in [AGENTS.md](AGENTS.md#commands).

Linux prerequisites (Arch):

```bash
sudo pacman -S --needed rust nodejs pnpm webkit2gtk-4.1 webkitgtk-6.0 xdotool base-devel hunspell
cargo install --locked --root ~/.local cargo-deny tauri-driver   # ~/.local/bin is on PATH
uv tool install fonttools --with brotli                           # font subsetting and inspection
```

- `webkitgtk-6.0` provides `WebKitWebDriver`, which `tauri-driver` needs.
- `xdotool` provides `libxdo`, which Tauri's native menus link against on Linux.
- `hunspell` is used for the Arabic speller benchmark.

See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for other distributions.

## Pull requests

- Keep each PR focused on one change.
- Follow the **definition of done** in [AGENTS.md](AGENTS.md#definition-of-done). It applies to humans too.
- UI changes include before/after screenshots (light and dark, including an Arabic or mixed sample) and answers to the five design-review questions (DESIGN.md §18).
- A new dependency needs a row in ARCHITECTURE.md §2 explaining the hard problem it solves.
- If you change a recorded decision, add a superseding ADR in `docs/decisions/`.

## Commit messages

Imperative summary of at most 72 characters, optional scope (`editor: …`, `lint: …`, `docs: …`), and a body that explains *why*.

## Licence

By contributing, you agree that your contributions are licensed under [GPL-3.0-or-later](LICENSE).
