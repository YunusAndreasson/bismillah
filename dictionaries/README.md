# Dictionaries

English spelling and grammar come with `harper-core` (ADR-0004); no file is needed here.

## Arabic: Ayaspell (`ar/`)

| | |
|---|---|
| Source | [LibreOffice/dictionaries `ar/`](https://github.com/LibreOffice/dictionaries/tree/951bb429a4d846699b02e7adb4fc6fca128c6bae/ar), commit `951bb42` (2020-06-15), packaging the [Ayaspell](http://ayaspell.sourceforge.net/) Hunspell dictionary |
| Licence | GPL 2.0 or later / LGPL 2.1 or later / MPL 1.1 or later (tri-licence; see `ar/COPYING.txt`). Compatible with bismillah's GPL-3.0-or-later. |
| `ar.aff` SHA-256 | `cec30b8621001e49618feb05aec1984c5fcfbf7d2ec309901d5cbf66585217a3` |
| `ar.dic` SHA-256 | `2a3e5367f61c1583734db9d66734f5603e6be5c2d227cf5c5cd7e4ca586e34fe` |
| Format notes | `FLAG long` with 333 `AF` flag aliases and about 466k stems; `spellbook` parses them without errors (Phase 0 benchmark). |
| How it ships | Compiled into the binary by `crates/bismillah-lint` (`include_str!`) and parsed on the first Arabic word that needs checking. The package installs `COPYING.txt` and `AUTHORS.txt` with the licences. Changing either file changes what bismillah accepts: rerun `cargo test -p bismillah-lint` (the benchmark and the `hunspell` oracle). |

Sanity check (2026-10-18, system Hunspell 1.7.5): it accepted كتاب, الكتاب, والمدرسة, يكتبون and the vocalised الْكِتَابُ, and flagged كتابب and مدرسةة.

The thesaurus (`th_ar.dat`) is not included; bismillah has no thesaurus.
