# 0007 — Initial font set and writing profiles

- **Status:** Accepted
- **Date:** 2026-10-18
- **Amended:** 2026-10-18 (interview). iA Writer Duo is confirmed as the default; Amiri Quran is added for Uthmani runs; IJMES transliteration glyph coverage is required.
- **Amended:** 2026-10-18 (Phase 0). Profile values measured; Bismillah Duo/Mono close the IJMES gap; Plex Sans Arabic blocked by a WebKit bug (ADR-0011).

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

## Phase 0 result (2026-10-18)

**Fonts: go. Profiles: adjust. Arabic pairing: interim.** Evidence: [font-profiles.md](../spikes/font-profiles.md), [glyphs.md](../spikes/glyphs.md), [arabic-rendering.md](../spikes/arabic-rendering.md).
- **Bismillah Duo and Bismillah Mono** (`fonts/build/`, built by `fonts/tools/build_ijmes.py`) are iA Writer Duo/Mono renamed under the OFL, with ḥ ṣ ḍ ṭ ẓ (and capitals) composed from Duo's own letters and dot below at Duo's anchors, and ʿ ʾ cut from Duo's own ring accent. Every IJMES letter renders at Duo's width in the webview, so none comes from a system fallback.
- **Measured values** (tokens in `src/styles/profiles.css`): Duo 20px / 1.6 / 66ch (61–65 characters per row); Serif 21px / 1.6 / **30em** (34em gave 71–79 characters); Plex Arabic 22px / 1.7 / 32em; Amiri 24px / 1.8 / 30em.
- **Vocalised and Qur'anic runs get a taller inline box** (`--doc-arabic-voc-line`, `--doc-quran-line`, 2–2.1× their size) where stacked marks would otherwise reach the next row; bare Arabic and Latin keep the profile's rhythm. Rows containing another script may differ by a pixel or two, because shrinking ascent/descent is not allowed (DESIGN.md §8.6).
- **IBM Plex Sans Arabic is unusable for vocalised text in WebKitGTK 2.54** (marks misplaced, words displaced; ADR-0011). Until that is resolved every profile pairs with Amiri.
