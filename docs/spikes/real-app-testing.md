# Spike: real-app testing

*Phase 0, 2026-10-18.* Question (PLAN.md): can `tauri-driver` run on Linux headless, offline, with screenshot comparison, and can one command produce specimen screenshots at the four widths without touching the author's desktop?

**Verdict: go.** One green e2e suite (51 tests, including every spike's tests) and a screenshot comparison run in `pnpm verify`; `pnpm app:shot` produces the specimen at 640/1280/1920/2560 in both themes.

## The harness

| Piece | What it does |
|---|---|
| `scripts/headless.sh` | Runs a command against a private Xvfb server (5200×2400, 2× scale like the author's display), a private D-Bus session and a private `XDG_RUNTIME_DIR`, with `GDK_BACKEND=x11`, `BISMILLAH_TEST=1` and the session's Wayland/Hyprland variables removed. Nothing reaches the compositor, keyring or audio. |
| `tests/driver.ts` | Starts `tauri-driver` (→ `/usr/bin/WebKitWebDriver`) on free ports and refuses to run outside `headless.sh`. |
| `tests/wdio.conf.ts` | WebdriverIO 10, suites `e2e` and `visual`. |
| `pnpm app:build` | `tauri build --debug --no-bundle`: embeds the frontend, so no dev server or network is involved. |
| Test hooks | With `BISMILLAH_TEST=1` the frontend exposes `window.__bismillah` (view, theme/profile/scale switches, geometry probes, command log, menu state) and a steady caret. |
| `pnpm test:visual` | Screenshots compared with `tests/visual/baselines/` (pixelmatch, threshold 0.1, ≤0.1% of pixels). `UPDATE_BASELINES=1` rewrites them; a missing baseline fails. |
| `pnpm app:shot` | Specimen screenshots; `--widths --themes --profiles --scale --full --scroll-to --doc --out`. |
| `pnpm test:offline` | The e2e suite inside `unshare --map-root-user --net` (loopback only) under `strace`, failing on any non-loopback `connect`/`sendto`. |
| `pnpm verify` | check, lint, unit tests, `cargo fmt/clippy/test`, `cargo deny`, app build, e2e, visual. `--fast` skips the real-app suites. |

## Findings

- Screenshots are deterministic under Xvfb: two runs matched with zero differing pixels.
- **Running the app outside the wrapper opens it on the live desktop** (it happened once in this spike). `tests/driver.ts` now refuses unless `BISMILLAH_TEST` is set and `WAYLAND_DISPLAY` is not.
- A private D-Bus session alone wasn't enough: activated portal services found Hyprland through the inherited environment. The wrapper now scrubs it and uses a private runtime directory.
- The editor has no DOM focus under Xvfb (no window manager), so CodeMirror doesn't draw the caret; tests read caret coordinates from CodeMirror rather than the drawn cursor where focus matters.
- Native key events (menus, accelerators, dead keys, layouts) need real X input: xdotool for single keys, raw XTEST (`spikes/webview/xtest.py`) when the XKB layout group matters, because xdotool resets it.
- cargo-deny needed two corrections: `all-features = false` (Tauri's optional networking features showed up hypothetically) and desktop-only `targets` (Tauri pulls `reqwest` in only for Android/iOS). With the real feature set and targets, no networking crate is in the tree.

## Offline proof

`pnpm test:offline` (2026-10-18): the full e2e suite, 5 spec files, **passed inside a network namespace with only a loopback interface**, under `strace -f -e trace=connect,sendto,sendmsg` covering the app, WebKit's helper processes, tauri-driver and the test runner. **61 internet-socket calls, all to 127.0.0.1** (the test tooling talking to tauri-driver); nothing tried to reach any other address. This supports "works without a network" (tested) and is consistent with "contains no networking features" (ADR-0003).
