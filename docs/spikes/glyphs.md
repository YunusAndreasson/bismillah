# Spike: Uthmani and transliteration glyphs — font side

*Phase 0, 2026-10-18.* Question (PLAN.md): do Amiri Quran and the Latin fonts cover what the writer types, and how do we close iA Writer Duo's IJMES gap? This note covers the fonts, the fixtures and font-level measurements. Rendering in WebKitGTK is checked in the real app (see the last section).

**Result: go for the fonts (font side); adjust overall, because of WebKitGTK mark rendering (see the last section).** Bismillah Duo and Bismillah Mono close the IJMES gap using each font's own outlines. Every code point in the Tanzil and quran.com Uthmani texts is covered by Amiri Quran, Amiri and IBM Plex Sans Arabic. Two findings need decisions elsewhere: the Qur'anic-run trigger misses a third of verses, and stacked Uthmani marks need more line height than the profiles give (both below).

## What the writer needs

| Set | Code points |
|---|---|
| IJMES | ā ī ū Ā Ī Ū (U+0100/0101, 012A/012B, 016A/016B); ḥ ṣ ḍ ṭ ẓ Ḥ Ṣ Ḍ Ṭ Ẓ (U+1E24/25, 1E62/63, 1E0C/0D, 1E6C/6D, 1E92/93); ʿ U+02BF, ʾ U+02BE (the specimen uses these) |
| Smart punctuation | “ ” ‘ ’ – — … « » |
| Arabic | letters, harakat U+064B–0652, superscript alef U+0670, alef wasla U+0671, tatweel, ، ؛ ؟ |
| Qur'anic | U+06D6–06ED in Tanzil/quran.com; QPC Hafs adds U+06E1, U+06E4, U+0657, U+00A0 and Arabic-Indic digits. Neither source uses U+08D3–08FF. |

## The IJMES fallback: Bismillah Duo and Bismillah Mono

Duo and Mono (variable: `wght` 400–700, plus iA's spacing axis `SPCG`) lack ḥ ṣ ḍ ṭ ẓ, their capitals, and ʿ ʾ. Duo has U+0323 with **GPOS mark-to-base anchors on h s d t z H S D T Z** (weight-variable in the roman) and builds its own ạ ẹ ị ọ ụ as composites at those anchors.

Options from fonts/README.md:
1. **Renamed build from Duo's own outlines: chosen.** It matches by construction and adds about 1 KB.
2. A `unicode-range` fallback from Plex Mono: rejected. It means another font file, Plex Mono lacks ʿ ʾ too, and the dot letters would come from a different design.
3. Rely on HarfBuzz decomposing ḥ → h + U+0323 inside Duo: rejected. WebKit picks a font per character *before* shaping, so a missing precomposed ḥ goes to a system fallback. It can't help ʿ ʾ either, which have no decomposition. (Decomposed *input* does render correctly in Duo via its anchors; worth confirming in the webview.)

`fonts/tools/build_ijmes.py` produces `fonts/build/BismillahDuo-{Regular,Italic}.ttf` and `BismillahMono-{Regular,Italic}.ttf`. The build is reproducible: the same bytes on every run.
- **ḥ ṣ ḍ ṭ ẓ Ḥ Ṣ Ḍ Ṭ Ẓ:** composites of base + `dotbelowcomb` at the font's anchors. The anchor variation from the GDEF VarStore becomes gvar deltas, so the dot tracks the letter at every weight.
- **ʿ ʾ:** the left and right halves of Duo's own ring accent (˚), cut at its top and bottom on-curve points, scaled 1.25× and set with their top at 746 (the quotes reach 740). On the italic axis they are centred like the quotes. Every point keeps the ring's own deltas, so they vary with weight. Unscaled (1.0×) they looked light and small next to ‘ ’; at 1.25× they match the quotes' height and weight and stay clearly rings (trial sheets below).
- Renamed in every name record, including named-instance PostScript names, because of the Reserved Font Names "iA Writer" and "Plex". Copyright and licence records are kept, name ID 10 notes the change, and the OFL file is copied.
- Repaired one upstream defect: Duo's STAT references missing name IDs, which made OpenType Sanitizer drop the table (relevant for WebView2 later). All four files now pass `ots-sanitize`.
- U+02BB/U+02BC already exist in Duo; U+02BD is absent and was not added, because nothing in IJMES needs it.

**Verification** (`fonts/tools/verify_ijmes.py`, passing): full IJMES and smart-punctuation coverage at wght 400/450/650/700 and SPCG 150. At every instance, each composite's dot sits within 1 unit of where the instanced GPOS anchor would put it. The half rings are single clockwise contours with no self-intersections. A pixel comparison against shaped h + U+0323 was dropped: FreeType's autohinter hints a composite as one glyph, which shifts edges by subpixels, so the numbers aren't meaningful even though the two look identical.

Proofs (inspected):
- `/tmp/claude-1000/-home-yunus-Work-bismillah/95cea444-72a3-4f2f-83f1-3961465f56d8/scratchpad/glyphs/proofs-final/proof-BismillahDuo-Regular.png` (and `-Italic`, `BismillahMono-*`): the sample line in the built fonts against upstream with h + U+0323 and ‘ ’, at 400 and 700.
- `/tmp/claude-1000/-home-yunus-Work-bismillah/95cea444-72a3-4f2f-83f1-3961465f56d8/scratchpad/glyphs/proofs-final/glyphs-BismillahDuo-Regular.png` (and the others): large glyph sheets next to ạ ọ ˚ ‘ ’.
- `/tmp/claude-1000/-home-yunus-Work-bismillah/95cea444-72a3-4f2f-83f1-3961465f56d8/scratchpad/glyphs/trial.png`, `.../glyphs/trial2.png`: half-ring scale trials at 1.0, 1.2, 1.25 and 1.35.

## Coverage of the fonts the app loads

| Need | Bismillah Duo / Mono | Source Serif 4 | Plex Sans Arabic | Amiri | Amiri Quran |
|---|---|---|---|---|---|
| IJMES | ✓ | ✓ | — | ✓ | — |
| Smart punctuation, « » | ✓ | ✓ | ✓ | ✓ | ✓ |
| Harakat, U+0670, U+0671, tatweel, ، ؛ ؟, Arabic-Indic digits, ﴾ ﴿, ﷺ | — | — | ✓ | ✓ | ✓ |
| Qur'anic marks U+06D6–06ED | — | — | ✓ | ✓ | ✓ |
| Honorifics U+0610–061A | — | — | ✓ | ✓ | lacks 0610–0614, 0616 |
| ZWNJ, ZWJ, LRM, RLM in cmap | — | — | **absent** | ✓ | ✓ |
| U+202F narrow no-break space | **absent** | ✓ | **absent** | ✓ | ✓ |

## Qur'anic fixtures (`tests/fixtures/quran/`)

16 verses (1:1–7, 2:1–5, 2:26 ۞, 7:206, 32:15, 96:19 ۩), verbatim, from Tanzil (default options plus rub; and a no-tatweel variant), quran.com `text_uthmani` and quran.com `text_qpc_hafs`. Licence terms and checksums are in the README there.
- **The specimen's verse is not verbatim.** It equals NFC(Tanzil 2:2 without tatweel): its shadda follows the vowel, while Tanzil and quran.com put shadda first. Of the 6236 Tanzil verses, 5782 change under NFC. Any normalisation on paste or save rewrites the bytes, so round-trip tests should use the fixtures, not the specimen line (the specimen is left unchanged).
- quran.com `text_uthmani` = Tanzil's default text, except that Tanzil prefixes verse 1 of each sura with the basmala and quran.com's 2:1 begins with a space. QPC Hafs lines end in U+00A0 plus an Arabic-Indic verse number.
- **Qur'anic-run detection:** the trigger in DESIGN.md §8.2 and ARCHITECTURE.md §7.2 (U+06D6–06ED, U+08D3–08FF; plus U+0610–061A for spellcheck) matches only **66%** of verses. All of al-Fātiḥa misses, for example. Adding **alef wasla U+0671**, which modern Arabic doesn't write, raises it to **87%**. The verses still missed use only standard vocalisation, so the regular fonts render them correctly and they rarely contain non-modern spellings. Recommendation: add U+0671 to the trigger (an ADR-0004 / DESIGN.md decision; not changed here).

## Line height for vocalised Arabic (ink extents, em; HarfBuzz via Pillow/raqm)

| Text | Font | Max above baseline | Max below baseline |
|---|---|---|---|
| Specimen MSA lines | Plex Sans Arabic | 1.23 | 0.60 |
| Specimen MSA lines | Amiri | 1.36 | 0.66 |
| All Tanzil verses (p99 / max) | Plex Sans Arabic | 1.28 / 1.47 | 0.67 / 0.98 |
| All Tanzil verses (p99 / max) | Amiri Quran | 1.82 / 1.82 | 0.89 / 0.96 |

Metrics in use: WebKitGTK reads hhea, since `USE_TYPO_METRICS` is off except in Amiri. Duo is 1.025/0.275; Plex Arabic 1.085/0.415, which makes a mixed Duo + Plex line about 0.04em taller than a Latin one; Amiri 1.124/0.634; Amiri Quran **1.815**/0.634. At line height 1.6, two adjacent worst-case MSA lines need about 1.83em, so occasional mark-to-mark contact is possible. Wrapped Uthmani lines in Amiri Quran need about 2.7em at p99. This feeds the font-profile spike: Qur'anic runs probably need their own line height, and mixed lines may need `ascent-override`/`descent-override` on the Arabic pairing.

## Size (Phase 1 subsetting estimate)

The fonts the app would load (Duo, Mono, Serif roman and italic, Plex Arabic ×3, Amiri ×4, Amiri Quran) total **5.0 MB** as TTF, **1.7 MB** as WOFF2, and about **1.2 MB** as WOFF2 subset by script with every layout feature kept. Source Serif 4 is the largest (2.0 MB as TTF, 0.44 MB subset). Subsetting Plex or Source means renaming them too (Reserved Font Names).

## In the webview (main agent, real app)

Checked in WebKitGTK 2.54.1 by `tests/e2e/spikes/glyphs.e2e.ts` and `spikes/webview/clipboard.ts`.

- **IJMES from Bismillah Duo:** every letter of ā ī ū Ā Ī Ū ḥ ṣ ḍ ṭ ẓ Ḥ Ṣ Ḍ Ṭ Ẓ ʿ ʾ is drawn at Duo's width (±1px of h), so none comes from a system fallback. A decomposed h + U+0323 renders like the precomposed ḥ.
- **Caret through stacked marks:** arrow keys stop only at grapheme boundaries in بِسْمِ ٱللَّهِ, never between a letter and its marks.
- **Uthmani runs** are set in Amiri Quran as whole runs (trigger includes alef wasla, so al-Fātiḥa is recognised); modern Arabic in the profile's pairing.
- **Paste round trip, editor:** all 64 fixture verses (Tanzil, Tanzil without tatweel, quran.com Uthmani, QPC Hafs) pasted through CodeMirror's paste handling keep every byte.
- **Paste round trip, native clipboard:** with another X client owning the clipboard (as a browser would after copying from tanzil.net) and a real Ctrl+V, **64/64 verses arrive byte-identical**, U+00A0 included.
- **Copy out loses U+00A0:** a real Ctrl+C from the editor delivers a plain space instead of the no-break space to other apps (48/64; all 16 QPC verses). CodeMirror puts the exact text on the copy event; WebKit's plain-text clipboard write replaces it. The document is never affected. Phase 1 can route Copy through `tauri-plugin-clipboard-manager` (already planned for "Copy as rich text") to keep it exact.
- **Rendering:** WebKitGTK misplaces Arabic marks for every font that positions them with vertical offsets; see [arabic-rendering.md](arabic-rendering.md). This is the main open issue of the glyph spike, so its overall verdict is **adjust**.
