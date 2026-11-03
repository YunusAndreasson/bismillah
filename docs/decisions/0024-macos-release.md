# 0024 — A macOS release: a signed, notarized disk image

- **Status:** Accepted; not built yet
- **Date:** 2026-11-03 (the author's decision: build it later, and shape the repository so it is expected)

## Context
The desktop app builds and runs on macOS (ARCHITECTURE.md §12.3), and `pnpm app:mac` makes a debug `bismillah.app` for the author. Mac writers can't use that: an unsigned app from the web is stopped by Gatekeeper, a debug build carries the test hooks, and nothing says where the download lives. ADR-0009 already counts macOS as a desktop platform, and PLAN.md lists macOS releases as later work. This record decides what such a release is, so the work that comes before it keeps it possible.

## Decision
- **A disk image holding `bismillah.app`**, a release build for Apple silicon and Intel (`universal-apple-darwin`), made by one command, `pnpm release:mac`.
- **Signed with the author's Developer ID Application certificate, with the hardened runtime, notarized by Apple and stapled**, so it opens on any Mac without a warning. Tauri does this from `APPLE_SIGNING_IDENTITY` and the App Store Connect API key (`APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`). Credentials stay in the author's keychain and environment, never in the repository. No entitlement beyond the hardened runtime's defaults; no App Sandbox and no Mac App Store, which would change how the library folder is reached.
- **The release keeps every promise the Linux app makes.** Before the first one:
  - the shipped binary is shown to hold no network code (the check `mobile/PLAN.md` M6 asks of the iOS binary), and the release build has no test hooks;
  - WKWebView gets the same lockdown WebKitGTK has (no media, audio or WebGL; `platform::configure_main_window`), or PRIVACY.md says exactly what differs;
  - PRIVACY.md and the guide name the macOS folders (`~/Library/Application Support/bismillah`).
- **No updater** (ADR-0003): a writer downloads a new version by hand.
- **The download is on the website**, beside the stick's (ADR-0017), and goes live only when the author publishes it.
- **Each release passes the full gate** (`pnpm verify`, which on a Mac includes the Linux container) **and a check by hand on a Mac**: the specimen in both themes, RTL and vocalised Arabic in WKWebView (ADR-0011), and the design review, since macOS has no WebDriver (ADR-0009).

## Consequences
- Releases are built on a Mac only; the Linux machine can't sign or notarize.
- The author needs a Developer ID Application certificate and an App Store Connect API key before the first release.
- Until then, `pnpm app:mac` stays a debug build for the author, and nothing links to a Mac download.
- The minimum macOS version is set from the oldest WKWebView that draws the specimen right and supports what the app uses (the CSS Custom Highlight API in Search, ADR-0020), and is recorded in `tauri.macos.conf.json` with the first release.
