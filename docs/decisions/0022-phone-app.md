# 0022 — A phone app on Tauri

- **Status:** Accepted 2026-10-31, when M0 in [mobile/PLAN.md](../../mobile/PLAN.md) passed. It supersedes one sentence of [0009](0009-desktop-only.md).
- **Date:** 2026-10-31 (the author's decision on the stack: "lets plan for using tauri")

## Context
Print to Phone (ADR-0021) sends a document from the stick as animated QR frames, and something on the phone has to read them. The author wants that app to feel like the stick's editor and to run on iOS and Android.

ADR-0009 says the product "will never be a web or mobile app". That sentence protected the desktop app from web habits: browser fallbacks, responsive layouts and touch handling inside desktop code. The reason still holds for the desktop app and the stick, but the sentence itself no longer does.

The author compared Tauri with Expo, and with Expo hosting the editor in a WebView, and chose Tauri. It reuses the editor, the typography and the Rust crates, and Expo's main strength, publishing, can be matched with a small workflow.

## Decision
- bismillah gets a phone app, built with Tauri 2 for Android and iOS. Android comes first, on this machine's emulator. iOS needs a Mac or a hosted macOS runner, and comes later. The author's iPhone is the only real phone, so the steps that need one wait for that build.
- The app is a separate shell in `mobile/`, which shares `src/editor`, the styles, the fonts and the Rust crates. The desktop app and the stick don't link it, and they gain no touch or phone code. ADR-0009 still governs them.
- The QR channel stays one-way, and it is the only way text leaves the stick. The stick shows codes and never scans them (os/PLAN.md, *Out of scope*).
- The app has no network code, no accounts and no telemetry. A release Android build declares no `INTERNET` permission, and a test checks this.
- Received text is stored as untouched bytes. Editing creates a new revision and never changes the received original.
- The stick's copy is the master. No text returns to the stick except by retyping, so phone edits stay separate versions there.
- The phone also holds the writer's only backup: the stick can print its whole library, and QR is its only way out.

## Consequences
- The app can't promise what the stick promises: a phone is networked, and its keyboard and backups aren't ours. The app says so in plain words (mobile/PLAN.md, *Promises on a phone*).
- `tauri-driver` doesn't drive the phone, so the app needs its own test path. The desktop gate, `pnpm verify`, doesn't change.
- An emulator can't prove camera speed or real keyboard behaviour, so those steps wait for a build on the iPhone. Every iOS fix waits for a remote build.
- We now maintain native camera code in Kotlin, and later in Swift.
