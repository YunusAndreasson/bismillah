# Spike: font profiles

*Phase 0, 2026-10-18, WebKitGTK 2.54.1.* Question (PLAN.md): do the four starting profiles (DESIGN.md §8.3) hold up with real text, including vocalised Arabic and mixed lines? Measured in the real webview with `spikes/webview/measure-profiles.ts` on `tests/fixtures/profiles.md`: characters per full row, row pitch (baseline to baseline), and **ink clearance** between rows (the lowest ink of one row to the highest ink of the next, from the font's own glyph metrics; negative means marks on adjacent rows can touch).

**Verdict: adjust.** Values below are recorded as tokens in `src/styles/profiles.css`. The Arabic pairings are interim because of the WebKit rendering bug ([arabic-rendering.md](arabic-rendering.md)).

## Results with the starting values

| Profile | English chars/row | Pitch | Vocalised Arabic clearance | Uthmani clearance |
|---|---|---|---|---|
| Duo 20px / 1.6 / 66ch | 61–65 ✓ | 32 | +3px (Plex) | −3px |
| Serif 21px / 1.6 / 34em | **71–79** | 33.6 | **−9.9px** (Amiri ×1.15) | −1.4px |
| Plex Arabic 22px / 1.7 / 32em | 67–76 | 37.4 | +8.4px | +2.4px |
| Amiri 24px / 1.8 / 30em | 71–79 | 43.2 | −1.8px | +9.7px |

- Serif's 34em is too wide: 30em gives 60–68 characters.
- Vocalised Amiri needs about twice its own size in line room; no Latin line height gives that without loosening all prose.
- Rows that contain Arabic in another font grow slightly (about 1.4px in Serif), because each font's half-leading differs. Shrinking the Arabic font's ascent/descent would hide this but violates DESIGN.md §8.6 ("never shorten ascent or descent metrics just to align baselines"), so rows may differ by a pixel or two.

## Decisions (tokens)

| Token | Duo | Serif | Plex Arabic | Amiri |
|---|---|---|---|---|
| size / line | 20px / 1.6 | 21px / 1.6 | 22px / 1.7 | 24px / 1.8 |
| measure | 66ch | **30em** | 32em | 30em |
| Arabic pairing | **Amiri** (interim; planned Plex Sans Arabic) | Amiri | Plex Sans Arabic (blocked) | Amiri |
| `--doc-arabic-scale` | 1.2 | 1.15 | 1 | 1 |
| `--doc-arabic-voc-line` | 2 | 2 | inherit | 2.1 |
| `--doc-quran-scale` / `--doc-quran-line` | 1.2 / 2 | 1.15 / 2 | 1.1 / 2 | 1 / 2 |

- **Vocalised and Qur'anic runs get a taller inline box** (`scriptRuns.ts` marks runs containing harakat, shadda, sukun or superscript alef with `cm-ar-voc`). Only rows that contain them grow, so bare Arabic and Latin keep the profile's rhythm. With these values every measured row has positive clearance (Serif's worst is −0.1px, i.e. touching at most).
- Duo with Amiri: English 61–65 chars, vocalised Arabic pitch 48px with +3px clearance, Uthmani +6px.
- The Plex Arabic profile stays defined but unused while WebKit misrenders Plex.

## Still to judge by eye

Arabic line lengths (74–85 characters per row in the Arabic-primary profiles) and the Arabic/Latin size balance were set from screenshots, not from a standard; the author should look at them in the real app (`pnpm app:shot -- --profiles duo,serif,amiri --scroll-to "## Arabic"`).
