# 0001 — Tauri 2 + Svelte 5 + CodeMirror 6 + Bits UI

- **Status:** Accepted
- **Date:** 2026-10-18

## Context
bismillah lives or dies by typography and text editing. It must run on Linux first and on macOS and Windows later, stay light, and contain no networking. Native toolkits (Qt, GTK, Rust GUI crates) would mean hand-building Markdown styling, IME, bidi and accessibility. Electron gives a uniform engine but adds about 150MB and a heavy runtime.

## Decision
- **Tauri 2** shell with a Rust core and the system webview (WebKitGTK, WKWebView, WebView2).
- **Svelte 5 + TypeScript + Vite** for the small interface.
- **CodeMirror 6** (Lezer Markdown) as the editor.
- **Bits UI** (unstyled, accessible Svelte 5 primitives) for dialogs, popovers, menus and listboxes, styled with our own **plain CSS tokens**. No CSS framework or styled component kit.

## Consequences
- Fine typographic control (OpenType, variable fonts, logical properties) and a proven editor for IME, bidi and accessibility.
- Three rendering engines: typography must be verified in each real webview, and visual tests run in WebKit and Chromium.
- WebKitGTK has GPU/driver quirks on some Linux setups (documented workaround).
- Package size is a measured target, not a promise; fonts and dictionaries add to it.
