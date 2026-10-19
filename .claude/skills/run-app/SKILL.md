---
name: run-app
description: Launch, see and drive the real bismillah app locally on the author's Linux (Hyprland) machine. Covers dev runs, headless test runs, screenshots Claude can inspect, WebDriver end-to-end tests and offline proof runs.
when_to_use: Whenever a change must be verified in the real app rather than only in unit tests (editor or typography work, UI changes, file handling, menus), when asked to "run", "start", "screenshot" or "try" the app, and before marking a phase's acceptance check done.
---

# Run, see and test bismillah locally

The machine is Arch/Omarchy with Hyprland on Wayland (`eDP-1`, 3840×2160 at scale 2). The app is Tauri 2 on WebKitGTK 4.1. Browser-only checks don't count as real-app verification (AGENTS.md, Definition of done).

> The helpers below exist since Phase 0. Build first with `pnpm app:build` (debug build with the frontend embedded). Keep this file in sync with `scripts/` and `package.json`.

## 1. Choose how to run it

| Goal | How | Disturbs the author's desktop? |
|---|---|---|
| Verify in the real webview, take screenshots, e2e tests | **Headless (default):** `scripts/headless.sh <command>` (private Xvfb at 2× scale, private D-Bus, runtime, config and data dirs, `BISMILLAH_TEST=1`) | No |
| Native window behaviour (menu with `Alt`/`F10`, window manager, Wayland input, layout switching) | On the live Hyprland session, sent to its own workspace without stealing focus: `hyprctl dispatch exec "[workspace 9 silent] <command>"` | Minimally; tell the author first if they may be working |
| Quick manual look by the author | `pnpm tauri dev` | Yes |

Prefer headless. Use the live session only for things headless can't show, and close the app when done.

## 2. Start the dev app

```bash
pnpm tauri dev            # run in the background; wait for the window/"Running" line, not a fixed sleep
```

Stop it when finished (kill the background task). Never leave stray app or dev-server processes running.

## 3. See it

- **Webview screenshots (preferred, deterministic):** `pnpm app:shot -- --widths 1280 --themes light,dark --profiles duo --out <scratchpad dir>` (also `--doc <file>`, `--height`, `--scale`, `--full` to stitch the whole document, `--scroll-to <text>`, `--typewriter`, `--markdown rendered|shown` (live preview, the default, or Always show Markdown), `--caret <text>` to reveal the block holding `<text>`, `--library <dir>` to show a scratch copy of a folder as the library, docked or as the overlay by width, `--library-file <rel>` to open a file from it, `--settings '<json>'` to apply settings first (`{"high_contrast": true}`, `{"colour_theme": "sepia"}`), `--config <dir>` to copy theme files or a `keybindings.toml` into the run's private config folder, and `--open settings|settings:files|settings:appearance|about` to shoot with a dialog open). It prints the PNG paths; **Read them** to inspect. Shots are 2× (the author's display scale).
- **Whole-window screenshot on the live session** (native menu, window chrome): capture **only the app window**, never the full screen, because the author's other windows may be private:
  ```bash
  geo=$(hyprctl clients -j | jq -r '.[] | select(.class|test("bismillah";"i")) | "\(.at[0]),\(.at[1]) \(.size[0])x\(.size[1])"' | head -1)
  grim -g "$geo" <scratchpad>/window.png
  ```
- Save screenshots in the session scratchpad, not the repo. Baselines live under `tests/visual/` only when deliberately updated.
- Check the specimen at window widths **640, 1280, 1920, 2560**, in both themes, and at 200% zoom (DESIGN.md §18).

## 4. Drive it

- **End-to-end:** `pnpm test:e2e` runs WebdriverIO against `tauri-driver` (which uses `/usr/bin/WebKitWebDriver`) on the built app. Use it for typing, shortcuts, file flows, conflicts and recovery after a killed process. Tests drive the app through `window.__bismillah` (see `src/core/testHooks.ts`: view, theme/profile/scale, geometry probes, command log, menu state, `open(path)` for real files, `fault(kind)` to make saves fail, `notices()`/`act(label)`, `saveState()`, `run(commandId)`, `welcome()`, `setLibrary(path)` in place of the folder dialog, `nextDialog(path)` to answer the next native file dialog, `library()`/`picker()`/`prompt()` probes, `measure()` after a resize, `clipboard(target)` to read the clipboard back through GTK, `note()` for the status line's passing message, `openSettings(section)`, `shortcuts()` (each command's shortcut now and why lines of `keybindings.toml` weren't used), `colourThemes()` and `token(name)` for a token's colour now). The run's private config folder is `$XDG_CONFIG_HOME/bismillah/`: tests write theme files and `keybindings.toml` there, and the watcher applies them within a moment.
- Bits UI radio groups choose on focus, and focus events don't fire under Xvfb: in tests, arrows move along the radios and `Space` chooses. A real keyboard sends `D`, not `d`, while Shift is held, and CodeMirror matches `Mod-Shift-d` only from that: send `["Control", "Shift", "D"]`.
- For library tests, copy `tests/fixtures/library` into a scratch folder first (`tests/e2e/library.e2e.ts`); trash goes to the private trash under the run's `XDG_DATA_HOME`.
- WebDriver treats a script result that has an `error` key as its own failure: name such fields differently (`refused`, `problem`).
- Live preview is on by default, and settings persist across spec files within one run: a spec that needs the Phase 1 view sets `always_show_markdown: true` and resets it in `after()`. Real-app runs need `pnpm app:build`; a plain `cargo build` binary points at the dev server and never becomes ready.
- Focus events don't fire while the window is in the background (always, under Xvfb): read the focused element from `document.activeElement`, not from state set by `onfocus`.
- Under the harness the app starts on the bundled specimen as a sample that is never saved; open a scratch file with `open(path)` to test saving. Never point a test at a file in the repo.
- WebKitWebDriver drops the second of two identical keys sent in one `browser.keys` call; send one key per call (`tests/e2e/files.ts` `typeAtEnd`).
- The driver allows one session at a time: end a session (even a killed one) before starting another with `remote()` (`tests/e2e/recovery.e2e.ts`).
- **Native input** (menus, accelerators, dead keys, layout switching, clipboard): WebDriver keys bypass GTK, so use real X events inside the headless display: `xdotool key …` for single keys, `spikes/webview/xtest.py` (raw XTEST) when the XKB layout group matters (xdotool resets it). Examples: `spikes/webview/keyboard.ts`, `clipboard.ts`.
- The editor has no DOM focus under Xvfb (no window manager), so CodeMirror doesn't draw the caret; read caret positions from CodeMirror (`coordsAtPos`) instead.
- **Typing and keyboard-layout tests** that need real Wayland input run on the live session; ask the author before taking over input.

## 5. Prove it's offline

```bash
pnpm test:offline [log]   # e2e suite inside unshare --net (loopback only) under strace; fails on any non-loopback connect
```

## 6. Troubleshooting

- A blank or garbled webview on some GPUs: retry with `WEBKIT_DISABLE_DMABUF_RENDERER=1`.
- `tauri-driver` can't find the driver: check `command -v WebKitWebDriver` (package `webkitgtk-6.0`).
- Menu build errors about `xdo`: check `ls /usr/lib/libxdo.so` (package `xdotool`).
- `xvfb-run` or `strace` missing: ask the author to install `xorg-server-xvfb` / `strace`. Claude cannot run `sudo`.
