# 0011 — Arabic mark rendering in WebKitGTK

- **Status:** Accepted
- **Date:** 2026-10-18 (proposed after the Phase 0 font spike; accepted by the author the same day)

## Context
The Phase 0 font spike found that WebKitGTK 2.54 (Skia) draws horizontal text with x positions only: the vertical offsets HarfBuzz gives Arabic marks are dropped, and with preserved whitespace (which an editor needs) a word whose first visual glyph is a mark shifts by that mark's offset. This is WebKit bug [255972](https://bugs.webkit.org/show_bug.cgi?id=255972), open since 2023; the spike traced it to `allocRunPosH` in `FontBase::buildTextBlob` ([docs/spikes/arabic-rendering.md](../spikes/arabic-rendering.md)).

On the 237 vocalised words of the specimen and Qur'an fixtures, IBM Plex Sans Arabic is wrong on 216 (median error 0.22 em), Amiri on 44 and Amiri Quran on 39 (median 0.01–0.02 em, but up to 0.4–0.8 em on ٱللَّهُ, لِلَّهِ, عَلَىٰ). The Basmallah opening is affected too. DESIGN.md principle 6 ("Arabic and Latin are equals") and §8.6 can't be met in the editor as things stand.

## Options
1. Report the root cause and a patch upstream (use full x/y glyph positions when any glyph has a vertical offset).
2. Build and use a locally patched WebKitGTK (Arch `webkit2gtk-4.1` PKGBUILD plus the patch) until upstream ships the fix.
3. Rebuild Amiri/Amiri Quran so marks need no vertical offsets (pre-shifted mark glyphs selected by GSUB).
4. Draw the Basmallah opening from pre-shaped outlines, keeping the real text for selection and screen readers.
5. Revisit ADR-0001's engine (Chromium renders this correctly; Tauri has no stable Chromium backend on Linux).
6. Accept the residual Amiri errors until upstream fixes the bug.

## Decision
- **1:** we draft the root cause and patch for bug 255972; the author posts it from their own WebKit account (an outward action).
- **4 in Phase 1:** the Basmallah opening is drawn from outlines pre-shaped with HarfBuzz, over the real text, which stays selectable and is what screen readers read.
- Every profile pairs with Amiri until the bug is fixed; IBM Plex Sans Arabic stays out.
- The rendering check (`spikes/webview/arabic-rendering.ts`) moves into `pnpm test:visual` in Phase 1, so a WebKitGTK update that changes the errors, for better or worse, is noticed.
- Choose between 2 and 6 after the author has written with the editor for a while; keep 3 in reserve.

## Consequences
- Until resolved, some vocalised and Qur'anic words render with misplaced marks in the editor, while files, copying in and saving stay byte-exact.
- Option 2 would mean a multi-hour rebuild after each WebKitGTK update; option 3 would mean maintaining modified shaping tables.
