# 0009 — Desktop only

- **Status:** Accepted
- **Date:** 2026-10-18
- **Amended:** 2026-10-18 (Phase 0). Real-app testing and native menu spikes: go.

## Context
bismillah uses web technology (a webview) for typography and editing, which invites "web-app" habits: browser fallbacks, `localStorage`, responsive mobile layouts, touch handling, browser-based test stacks. The product will never be a web or mobile app. It is a desktop writing tool for Linux, then macOS and Windows.

## Decision
- The frontend targets only the Tauri webviews (WebKitGTK, WKWebView, WebView2) and uses Tauri APIs directly. No browser mode, web build, service worker, web manifest, mobile meta tags or touch gestures.
- Persistence goes through Rust (settings, recovery), never browser storage.
- Desktop conventions are first-class:
  - a native application menu (hidden until `Alt`/`F10` on Linux and Windows; required on macOS)
  - opening files from the command line, the file manager and drag-and-drop
  - a single running instance
  - remembered window state, a minimum window size, native dialogs
  - flushing saves on quit.
- Testing happens in the real app via `tauri-driver`, including visual regression. There is no Playwright or browser test stack. IPC is mocked with `@tauri-apps/api/mocks` in unit tests.

## Consequences
- Fewer dependencies and no dead fallback code.
- Visual tests run in the engines users actually have. macOS has no WebDriver support, so it is checked by hand before releases.
- Layout still adapts to window width (tiled halves to ultrawide), but never to phone sizes. The minimum window is 480×360.

## Phase 0 result (2026-10-18)

**Real-app testing: go.** Evidence: [docs/spikes/real-app-testing.md](../spikes/real-app-testing.md). `tauri-driver` + WebdriverIO run the real app headless (`scripts/headless.sh`: private Xvfb, D-Bus and runtime directory, so nothing touches the author's desktop). `pnpm verify` includes the e2e suite and a screenshot comparison; `pnpm app:shot` produces the specimen at 640/1280/1920/2560 in both themes; `pnpm test:offline` runs the e2e suite with no network under strace.

**Native menu: go** on GTK/X11 (Hyprland has no conflicting bindings; GNOME untested). Evidence: [docs/spikes/native-menu.md](../spikes/native-menu.md). The menu is generated from the command registry with Tauri's JS menu API, hidden by default, revealed and focused by `Alt` alone or `F10`, and hidden again when it closes. While it is hidden, GTK doesn't fire menu accelerators, so CodeMirror's keymap handles every shortcut exactly once.
