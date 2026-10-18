# Fonts

All bundled fonts are under the **SIL Open Font License 1.1**. Each family's licence file sits next to its fonts. `source/` holds the unmodified upstream masters; the shipped web fonts are built from them in Phase 1 (ADR-0007).

## Sources

Downloaded 2026-10-18.

| Family | Version | Upstream | Archive SHA-256 | Files kept |
|---|---|---|---|---|
| iA Writer Duo | git `c658867` | [iaolo/iA-Fonts](https://github.com/iaolo/iA-Fonts) | (git clone) | `iAWriterDuoV.ttf`, `iAWriterDuoV-Italic.ttf` (variable) |
| iA Writer Mono | git `c658867` | [iaolo/iA-Fonts](https://github.com/iaolo/iA-Fonts) | (git clone) | `iAWriterMonoV.ttf`, `iAWriterMonoV-Italic.ttf` (variable) |
| Source Serif 4 | 4.005R | [adobe-fonts/source-serif](https://github.com/adobe-fonts/source-serif/releases/tag/4.005R) `source-serif-4.005_Desktop.zip` | `549fdb8f9a682bd06944298621404969f6de77c2e422ff3b8244a1dcd6a0c425` | `SourceSerif4Variable-Roman.ttf`, `-Italic.ttf` |
| IBM Plex Sans Arabic | 1.1.0 | [IBM/plex](https://github.com/IBM/plex/releases/tag/%40ibm%2Fplex-sans-arabic%401.1.0) `ibm-plex-sans-arabic.zip` | `f03915581aea37d82792c188b08064023a73494d679b8e19f85f5971db714013` | Regular, SemiBold, Bold |
| Amiri + Amiri Quran | 1.003 | [aliftype/amiri](https://github.com/aliftype/amiri/releases/tag/1.003) `Amiri-1.003.zip` | `81af0aff7d2086d8af24cea7202f7546130997982534691373485cd96744d05e` | Regular, Bold, Italic, BoldItalic, `AmiriQuran.ttf` |

## Reserved Font Names: read before modifying

| Family | Reserved Font Names |
|---|---|
| iA Writer Duo / Mono | "iA Writer", "Plex" |
| IBM Plex Sans Arabic | "Plex" |
| Source Serif 4 | "Source" |
| Amiri | none |

Under the OFL, a **modified version** (which includes a subset, or a merge with glyphs from another font) must not use a Reserved Font Name. So the Phase 1 font pipeline either ships the official upstream files unchanged, or renames any font it subsets or merges (e.g. "Bismillah Duo"), keeping the licence and copyright notices. Amiri can be subset freely.

## Coverage findings (checked 2026-10-18 with fontTools)

| Need | Result |
|---|---|
| IJMES transliteration in **iA Writer Duo / Mono** | ā ī ū present; **ḥ ṣ ḍ ṭ ẓ (and capitals) and ʿ ʾ missing**. Duo has the combining dot below (U+0323). |
| IJMES in **IBM Plex Mono 2.5.0** (Duo's ancestor; candidate fallback) | ḥ ṣ ḍ ṭ ẓ present; **ʿ ʾ missing** |
| IJMES in **Source Serif 4** | complete |
| Smart punctuation “ ” ‘ ’ – — … « » | present in all Latin fonts |
| Qur'anic marks U+06D6–U+06ED, U+0610–U+061A | Amiri, Plex Sans Arabic: complete. **Amiri Quran lacks U+0610–U+0614 and U+0616** (honorific signs, which are not Qur'anic annotation). |

Consequences for Phase 0 (spike "Uthmani + transliteration glyphs"):
- **Duo's IJMES gap must be closed with a matched fallback**, never left to the system's fallback font. Candidates:
  1. A renamed Duo build that adds ḥ ṣ ḍ ṭ ẓ from Plex Mono, or composes them from Duo's own letters and U+0323, plus ʿ ʾ drawn to match Duo's quotes.
  2. A `unicode-range` fallback chain (Plex Mono for dot-below letters; a matched source for ʿ ʾ).
  3. Check whether WebKitGTK renders precomposed ḥ by decomposing it to h + U+0323 within Duo.
- **Switch to Amiri Quran only for runs containing U+06D6–U+06ED or U+08D3–U+08FF.** Honorific signs (U+0610–U+061A) stay in the regular Arabic font, which covers them. Spellcheck still skips all three ranges.
