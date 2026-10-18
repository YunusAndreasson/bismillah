# 0007 — Initial font set and writing profiles

- **Status:** Accepted (numeric values pending Phase 0)
- **Date:** 2026-10-18
- **Amended:** 2026-10-18 (interview). iA Writer Duo is confirmed as the default; Amiri Quran is added for Uthmani runs; IJMES transliteration glyph coverage is required.

## Context
Revision 1 proposed thirteen families and viewport-scaled body text. More families multiply download size, settings and visual testing. Viewport scaling assumes a viewing distance from the window size and fights explicit preferences.

## Decision
- **Fonts (OFL):** iA Writer Duo (default, with Mono for code), Source Serif 4, IBM Plex Sans Arabic (pairs with Duo), Amiri (pairs with Source Serif; also used for the Basmallah).
- **Amiri Quran** sets any Arabic run containing Qur'anic annotation marks (the whole run, so shaping is never split). The Latin fonts must cover IJMES transliteration (ā ī ū ḥ ṣ ḍ ṭ ẓ ʿ ʾ), verified on the shipped files.
- **The interface uses `system-ui`** at 14px and is independent of the writing font.
- **Writing profiles** set size, line height, standard measure and Arabic pairing (DESIGN.md §8.3). Measure choices: Narrow (0.85×), Standard, Wide (1.15×).
- **Writing size is stable** across window widths and changes only through explicit preference.
- Real styles only (no synthetic bold or italic); optical sizing on; no hyphenation in the editor.

## Consequences
- The starting values must be validated in Phase 0 on real text in each real webview.
- Subsetting must preserve shaping tables and combining marks, and is tested on the shipped files.
- Adding a font later requires a full profile and a pass through the visual suite.
- iA Writer, Plex and Source have OFL Reserved Font Names, so any subset or merged build of them must be renamed (fonts/README.md).
- iA Writer Duo lacks part of the IJMES set (ḥ ṣ ḍ ṭ ẓ ʿ ʾ). Phase 0 picks a matched fallback.
