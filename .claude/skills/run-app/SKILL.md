---
name: run-app
description: Launch, see and drive the real bismillah app locally on the author's Linux (Hyprland) machine. Covers dev runs, headless test runs, screenshots Claude can inspect, WebDriver end-to-end tests and offline proof runs.
when_to_use: Whenever a change must be verified in the real app rather than only in unit tests (editor or typography work, UI changes, file handling, menus), when asked to "run", "start", "screenshot" or "try" the app, and before marking a phase's acceptance check done.
---

# Run, see and test bismillah locally

The machine is Arch/Omarchy with Hyprland on Wayland (`eDP-1`, 3840×2160 at scale 2). The app is Tauri 2 on WebKitGTK 4.1. Browser-only checks don't count as real-app verification (AGENTS.md, Definition of done).

> Phase 0 builds the helper scripts named below (`pnpm app:shot`, `pnpm test:e2e`). Until they exist, use the manual commands, and once they do, keep this file in sync.

## 1. Choose how to run it

| Goal | How | Disturbs the author's desktop? |
|---|---|---|
| Verify in the real webview, take screenshots, e2e tests | **Headless (default):** `xvfb-run -a -s "-screen 0 2560x1600x24" env GDK_BACKEND=x11 …` | No |
| Native window behaviour (menu with `Alt`/`F10`, window manager, Wayland input, layout switching) | On the live Hyprland session, sent to its own workspace without stealing focus: `hyprctl dispatch exec "[workspace 9 silent] <command>"` | Minimally; tell the author first if they may be working |
| Quick manual look by the author | `pnpm tauri dev` | Yes |

Prefer headless. Use the live session only for things headless can't show, and close the app when done.

## 2. Start the dev app

```bash
pnpm tauri dev            # run in the background; wait for the window/"Running" line, not a fixed sleep
```

Stop it when finished (kill the background task). Never leave stray app or dev-server processes running.

## 3. See it

- **Webview screenshots (preferred, deterministic):** `pnpm app:shot -- --doc docs/specimen.md --width 1280 --theme light --out <scratchpad>/shot.png`. This uses `tauri-driver` + WebDriver's screenshot of the webview. Then **Read the PNG** to inspect it.
- **Whole-window screenshot on the live session** (native menu, window chrome): capture **only the app window**, never the full screen, because the author's other windows may be private:
  ```bash
  geo=$(hyprctl clients -j | jq -r '.[] | select(.class|test("bismillah";"i")) | "\(.at[0]),\(.at[1]) \(.size[0])x\(.size[1])"' | head -1)
  grim -g "$geo" <scratchpad>/window.png
  ```
- Save screenshots in the session scratchpad, not the repo. Baselines live under `tests/visual/` only when deliberately updated.
- Check the specimen at window widths **640, 1280, 1920, 2560**, in both themes, and at 200% zoom (DESIGN.md §18).

## 4. Drive it

- **End-to-end:** `pnpm test:e2e` runs WebdriverIO against `tauri-driver` (which uses `/usr/bin/WebKitWebDriver`) on the built app. Use it for typing, shortcuts, file flows, conflicts and recovery after a killed process.
- **Typing and keyboard-layout tests** that need real Wayland input run on the live session; ask the author before taking over input.

## 5. Prove it's offline

```bash
unshare -rn <app or test command>                                 # no network at all: everything must still work
strace -f -e trace=connect,sendto -o <scratchpad>/net.log <cmd>   # then confirm no non-local connections
```

## 6. Troubleshooting

- A blank or garbled webview on some GPUs: retry with `WEBKIT_DISABLE_DMABUF_RENDERER=1`.
- `tauri-driver` can't find the driver: check `command -v WebKitWebDriver` (package `webkitgtk-6.0`).
- Menu build errors about `xdo`: check `ls /usr/lib/libxdo.so` (package `xdotool`).
- `xvfb-run` or `strace` missing: ask the author to install `xorg-server-xvfb` / `strace`. Claude cannot run `sudo`.
