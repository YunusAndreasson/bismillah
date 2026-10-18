# Built fonts

**Generated files. Don't edit them; rerun the script.**

```bash
uv run --with fonttools python -I fonts/tools/build_ijmes.py                     # build
uv run --with fonttools --with pillow python -I fonts/tools/verify_ijmes.py      # check (add --proofs <dir> for proof sheets)
```

| File | Family | Built from |
|---|---|---|
| `BismillahDuo-Regular.ttf` | Bismillah Duo, Regular | `source/ia-writer-duo/iAWriterDuoV.ttf` |
| `BismillahDuo-Italic.ttf` | Bismillah Duo, Italic | `source/ia-writer-duo/iAWriterDuoV-Italic.ttf` |
| `BismillahMono-Regular.ttf` | Bismillah Mono, Regular | `source/ia-writer-mono/iAWriterMonoV.ttf` |
| `BismillahMono-Italic.ttf` | Bismillah Mono, Italic | `source/ia-writer-mono/iAWriterMonoV-Italic.ttf` |

All four are variable fonts with the upstream axes unchanged: `wght` 400–700 and iA's spacing axis `SPCG` 0–150 (leave it at 0).

## What changed

Upstream iA Writer Duo and Mono lack part of the IJMES transliteration set. The build adds it, using only each font's own outlines:

- **ḥ ṣ ḍ ṭ ẓ Ḥ Ṣ Ḍ Ṭ Ẓ** (U+1E25, U+1E63, U+1E0D, U+1E6D, U+1E93 and capitals): composites of the base letter and the font's own `dotbelowcomb`, placed at the font's own mark-to-base anchors, the same way the fonts build ạ ẹ ị ọ ụ. The anchors' weight variation becomes gvar deltas, so the dot follows the letter at every weight.
- **ʿ ʾ** (U+02BF, U+02BE): the left and right halves of the font's own ring accent (˚), cut at its top and bottom, scaled 1.25× to the size and weight of the quotation marks, and set with their tops at 746 units (the quotes reach 740). Every kept point keeps the ring's own deltas, so the half rings vary with weight like the rest of the font.

One upstream defect is repaired: Duo's `STAT` table names two `SPCG` values with name IDs that don't exist, which makes OpenType Sanitizer (used by Chromium-based webviews such as WebView2) discard the table; those two values are dropped. Nothing else is modified: outlines, metrics, kerning and features of existing glyphs are untouched. All four files pass `ots-sanitize`.

## Licence and names

These are Modified Versions under the SIL Open Font License 1.1 ([LICENSE.md](LICENSE.md), copied from upstream). The upstream Reserved Font Names "iA Writer" and "Plex" may not be used for a modified font, so every name record is renamed to Bismillah Duo / Bismillah Mono (family, full, PostScript, unique ID and named-instance PostScript names). The copyright and licence records are kept, and name ID 10 records the modification.
