# Contributing

Bug reports and pull requests are welcome. bismillah is small on purpose, so the
most useful work makes what exists more dependable rather than adding more: fixes
in saving, recovery, bidi and accessibility, Arabic support from people who write
Arabic, failure-path and mixed-script tests, and clearer copy. For anything bigger
than a fix, open an issue first, so we can agree on the approach before you write
the code.

Read [DESIGN.md](DESIGN.md) before UI, copy or typography work,
[ARCHITECTURE.md](ARCHITECTURE.md) before touching files, saving, IPC, checking or
security, and [PLAN.md](PLAN.md) for the current phase; work outside it will likely
wait. A change to a recorded decision gets a new ADR in
[docs/decisions/](docs/decisions/) that supersedes the old one.

## Build and check

On Arch Linux (for other distributions, see the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/); on Ubuntu, the
packages [CI installs](.github/workflows/verify.yml) are enough for `--fast`):

```sh
sudo pacman -S --needed rust nodejs pnpm webkit2gtk-4.1 webkitgtk-6.0 xdotool base-devel hunspell xorg-server-xvfb strace python-gobject at-spi2-core desktop-file-utils
cargo install --locked --root ~/.local cargo-deny tauri-driver
pnpm install --frozen-lockfile
pnpm tauri dev
```

`webkitgtk-6.0` provides the `WebKitWebDriver` that `tauri-driver` needs, `xdotool`
sends the real key presses the native-input tests use, `xorg-server-xvfb` keeps
test runs off your desktop, `strace` serves the offline proof, `python-gobject` and
`at-spi2-core` let `pnpm a11y` read the accessibility tree, `desktop-file-utils`
validates the desktop entry, and `hunspell` is the Arabic speller's benchmark
oracle. Every other command is listed in [AGENTS.md](AGENTS.md#commands).

Before a pull request:

- `pnpm verify` passes. It runs svelte-check, ESLint and Prettier, Vitest, rustfmt,
  Clippy, the Rust tests and cargo-deny, then builds the app and runs the real-app
  e2e and visual suites headless. `pnpm verify --fast` stops before the build while
  you iterate; CI runs that much on every push.
- The [definition of done](AGENTS.md#definition-of-done) applies to people too: a
  failure-path test for file handling (disk full, read-only, conflict, killed
  process), and editor or typography changes checked in the real app against
  [docs/specimen.md](docs/specimen.md), Arabic and mixed lines included.
- UI changes come with before and after screenshots in both themes, one with Arabic
  or mixed text, and answers to the design review's five questions (DESIGN.md §18).
- A new dependency gets a row in ARCHITECTURE.md §2 naming the hard problem it
  solves.
- One change per pull request, with commit messages in the repository's style: an
  imperative summary of at most 72 characters scoped to the area (`editor: hang
  list markers in RTL`, `os: …`, `docs: …`), and a body that says why.

## What bismillah won't do

These come from DESIGN.md §3 and the standing decisions in AGENTS.md. Changing one
needs a strong case and an ADR:

- No accounts, sync, telemetry, ads, update checks or remote fonts and images.
  Network crates are banned in `deny.toml`.
- No generative AI. Nothing writes, rewrites or summarises the writer's text;
  grammar checking only flags and suggests.
- Text is saved exactly as typed: no Unicode normalisation, no stripped diacritics,
  no rewritten frontmatter.
- Links never open, and nothing is handed to another app (ADR-0015).
- No executable plugins. Themes are declarative (ADR-0005).
- No streaks, nagging goals or badges.
- The app and the stick are desktop only. The phone app is a separate shell in
  `mobile/` (ADR-0009, ADR-0022).

## Security issues

Not in issues or pull requests: see [SECURITY.md](SECURITY.md).

## Conduct and license

Everyone here follows the [Code of Conduct](CODE_OF_CONDUCT.md). By contributing,
you agree your work is released under the
[GNU General Public License, version 3 or later](LICENSE).
