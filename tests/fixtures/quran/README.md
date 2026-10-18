# Qur'anic text fixtures

Verbatim Uthmani text for rendering and round-trip tests: what a writer gets when pasting from tanzil.net or quran.com. **Never edit, reformat or normalise these files.** A test that changes one byte has found a bug.

## Files

All are UTF-8 with LF line endings, one verse per line as `sura|aya|text`. The text after the second `|` is byte-for-byte what the source served. The Tanzil files end with Tanzil's copyright block (blank line, then `#` lines), as their licence requires; parse only lines matching `^\d+\|\d+\|`.

| File | Source | Options |
|---|---|---|
| `tanzil-uthmani.txt` | tanzil.net, Uthmani 1.1 | The site's default options (pause marks, sajdah signs, superscript alef, tatweel below superscript alef) plus rub-el-hizb signs |
| `tanzil-uthmani-no-tatweel.txt` | tanzil.net, Uthmani 1.1 | As above without "tatweel below superscript alef" |
| `qurancom-uthmani.txt` | api.quran.com v4, `text_uthmani` | — |
| `qurancom-qpc-hafs.txt` | api.quran.com v4, `text_qpc_hafs` (KFGQPC Hafs encoding) | — |

Verses: 1:1–7, 2:1–5, 2:26 (starts with ۞ U+06DE), 7:206, 32:15 and 96:19 (end with ۩ U+06E9). 2:2 has ۛ (U+06DB), 2:5 and 2:26 have pause marks (U+06D6, U+06DA, U+06D8), small high rounded zero (U+06DF) and small yeh (U+06E6).

Retrieved 2026-10-18 from:
- `https://tanzil.net/pub/download/index.php?quranType=uthmani&outType=txt-2&agree=true&marks=true&sajdah=true&alef=true&tatweel=true&rub=true` (full file SHA-256 `7f30c647331a61100ebf24a80507dc0fcdd9f2df97f1312b5b2dfcb982a7f326`)
- the same without `&tatweel=true` (SHA-256 `4b91f9e6e8ac645d039e4ed85b3be492e795232a31cd22d668ac58238722e26f`)
- `https://api.quran.com/api/v4/quran/verses/uthmani?chapter_number=1` and `?verse_key=S:A` for the others
- `https://api.quran.com/api/v4/verses/by_key/S:A?fields=text_qpc_hafs`

## Things these fixtures show

- **None of them is in Unicode normal form.** Every Tanzil line and 15 of 16 lines in each quran.com file change under NFC (Tanzil and quran.com write shadda before the vowel; NFC reorders it after). Any normalisation on paste, open or save changes the bytes. The verse in `docs/specimen.md` was NFC(Tanzil no-tatweel 2:2) until 2026-10-18; it is now the verbatim Tanzil line.
- Tanzil prefixes verse 1 of each sura (except 1 and 9) with the basmala: `2|1|بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ الٓمٓ`. quran.com doesn't, and its 2:1 starts with a space (U+0020), kept verbatim.
- quran.com `text_uthmani` equals Tanzil's default text for every verse here except 2:1.
- `text_qpc_hafs` uses a different encoding: U+06E1 for sukun, U+06E4, U+0657, and each verse ends with a no-break space (U+00A0) and an Arabic-Indic verse number. Round trips must keep U+00A0 (webviews tend to turn it into a space on copy and paste).

## Licence and attribution

**Tanzil:** Tanzil Quran Text (Uthmani, Version 1.1), Copyright (C) 2007-2026 Tanzil Project, licensed under Creative Commons Attribution 3.0, <https://tanzil.net>. Its terms: verbatim copies only ("CHANGING IT IS NOT ALLOWED"), the source must be clearly indicated with a link to tanzil.net, and the copyright notice must be included in verbatim copies; it is reproduced at the end of each Tanzil file. Check for updates at <http://tanzil.net/updates/>.

**quran.com:** text from the Quran.com API (<https://api.quran.com>). `text_uthmani` derives from the Tanzil text above; `text_qpc_hafs` is the King Fahd Glorious Qur'an Printing Complex (KFGQPC) Hafs text. Used here as private test data; check the Quran.com API terms before redistributing.
