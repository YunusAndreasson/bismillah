# Spike: Arabic speller

*Phase 0, 2026-10-18. Question (PLAN.md): `spellbook` or Hunspell with Ayaspell, judged on correctness and suggestions. Code and fixtures: [spikes/arabic-speller/](../../spikes/arabic-speller/).*

**Result: `spellbook` is the default (go, with three adapter requirements).** Both engines accept and reject exactly the same words, so the choice comes down to integration, determinism and speed, where `spellbook` wins. The Hunspell binding is not worth shipping as a fallback.

## Method

- **Engines:** `spellbook` 0.4.2 (pure Rust, MPL-2.0). Hunspell 1.7.5 (system library) through `hunspell-rs` 0.4.0 / `hunspell-sys` 0.3.1 (Apache-2.0, MIT OR Apache-2.0). Each sits behind the same `ArabicSpeller` trait (`check`, `suggest`). The system `hunspell -a` CLI served as the reference oracle.
- **Dictionary:** `dictionaries/ar/` unchanged. `FLAG long`, 333 `AF` aliases, about 466k stems, `IGNORE` = the eight harakat + tatweel + dagger alif, `ICONV` for ٱ and lam-alef ligatures, `MAP`/`REP`/`KEY` for suggestions. Both engines parse it without errors.
- **Fixture** (written for this spike; `fixtures/*.tsv`):
  - 404 correct words: 255 base forms (clitics و ف ب ك ل ال س, attached pronouns, verb forms I–X, hamza seats, ة, ى, duals and plurals), 45 fully and 15 partly vocalised, 6 with tatweel, 2 with alef wasla, and the 81 Arabic tokens of `docs/specimen.md`.
  - 124 scored misspellings in 15 error types, each with its intended word.
  - Kept apart: 5 + 15 **policy** rows (hamza-seat variants, bare alef for أ/إ, Egyptian final ى) and 10 **real-word** errors (e.g. مدرسه = "his teacher"), which no speller can flag.
- **Timing:** each engine runs in its own process. The machine was under heavy parallel build load (load average around 20 on 8 cores), so times are **thread CPU time**, median of three runs, with the range in brackets. Treat them as relative, not absolute.

## Results

| | spellbook (+ strip adapter) | Hunspell (system lib) |
|---|---|---|
| Correct words accepted | **100%** (404/404) | **100%** (404/404) |
| Misspellings flagged | 79.8% (99/124) | 79.8% (99/124) |
| Accept/reject agreement with the oracle | 558/558 | 558/558 |
| Suggestion top-1 / top-5, of flagged | 40.4% / 82.8% | 44.4% / 76.8–79.8% (varies per run) |
| Vocalised misspellings (كِتَابَبٌ) | no suggestions without the adapter; 2/3 top-1 with it | 2/3 top-1 natively |
| Dictionary load (CPU) | 0.55 s (0.32–1.3) | 0.83 s (0.57–1.3) |
| Memory after load | +44 MiB RSS (56 MiB peak) | +25 MiB RSS |
| `check` throughput | **~160k words/CPU-s** (87k–205k) | ~73k words/CPU-s (25k–77k) |
| `suggest` p50 / p95 / max (CPU) | 8 ms / 1.0 s / 1.4 s | 7 ms / 0.43 s / 0.76 s, but truncated (see below) |
| Binary size, stripped | +378 KB | +14 KB plus the 547 KB shared `libhunspell`; or +631 KB static with the vendored C++ |

## What we learned

1. **The dictionary, not the engine, sets the detection rate.** Ayaspell's affix rules overgenerate, so 25 of the 124 realistic misspellings pass in both engines. Examples: dotted ي for ى (حتي، متي، مستشفي, 5 of 6 accepted), a missing alif after و (قالو), a written-out hidden alif (ذالك، الرحمان، إلاه), ة/ه slips (الحياه، لدية، عندة), and wrong hamza seats (شيئ، أسألة).
2. **Ayaspell spells hamza strictly.** Bare alef for أ/إ is flagged (8 of 10, e.g. امانة → أمانة), and both مسؤول and مسئول are accepted, as are مئة and مائة. That suits careful MSA writing. Egyptian final ى for ي is flagged (4 of 5).
3. **Suggestions are mediocre in both engines and fail the same way.** Neither offers شيء for شئ: the list is شؤ، ئ، ش. Neither restores a missing alif after و (كتبو → كتبوا), the hidden alif (لاكن → لكن) or a ث/ذ slip. ض/ظ confusion is fixed well (7 of 7 at top-1).
4. **Hunspell's suggestions depend on machine load.** Its suggester stops each search phase after a `clock()` budget (`TIMELIMIT_SUGGESTION` in `suggestmgr.cxx`). That is why its latency tail looks short, and why top-5 hits moved between 76 and 79 across identical runs on the busy machine. `spellbook` is deterministic, but its search is unbounded: about 1 s for long or doubled-letter words (مدرسسة، إنشاءالله).
5. **`spellbook` honours `IGNORE` in `check` but not in `suggest`.** Vocalised input is accepted, but a vocalised misspelling gets no suggestions after about 1.2 s of search. Stripping the `IGNORE` characters from a temporary copy first gives the right suggestions and removes the wasted search. It never folds alef or hamza.
6. **Integration costs favour `spellbook`.** It is pure Rust and `no_std`, and active (0.4.2, June 2026), though it calls itself alpha. `hunspell-rs`/`hunspell-sys` have been unchanged since 2022, and the vendored C++ is Hunspell 1.7.1. The binding reports no load errors (a bad path silently gives an empty dictionary). Its handle is a raw pointer, so it is not `Send`. Building it needs a C++ compiler and libclang (bindgen). The crate metadata says MIT/Apache, which hides the vendored Hunspell's MPL/GPL/LGPL tri-licence from `cargo deny`.
7. **`cargo deny check bans licenses`** with the repo's `deny.toml` passes for both (`bans ok, licenses ok`). Runtime dependencies are `spellbook`, `hashbrown`, `foldhash`, plus `hunspell-rs`, `hunspell-sys` and `log`. None of them does networking.

## Recommendation

- **`spellbook`: go**, as the ADR-0004 default.
- **Hunspell via `hunspell-rs`: no-go as a shipped fallback.** It gives identical verdicts, slightly better top-1 but load-dependent suggestions, a C++ build dependency, an unmaintained binding and no error reporting. Keep the `ArabicSpeller` trait so an engine can be swapped later. Use the **system `hunspell` CLI as a test oracle** in Phase 3: a differential test over this fixture catches `spellbook` regressions when it is upgraded.

**Adapter requirements for Phase 3** (`bismillah-lint`):
1. Strip the `.aff` file's `IGNORE` characters (read from the file, not hard-coded) on a temporary copy before both `check` and `suggest`. The diagnostic's range stays the original word's UTF-16 span, so no offset map is needed for whole-word lookups (ARCHITECTURE.md §7.3). Never fold alef or hamza.
2. Run `check` eagerly and `suggest` only on request (popover, `Mod-.`), off the UI thread, cancellable, with a time budget of about 300 ms per word that returns whatever was found. Results stay deterministic for a given budget hit.
3. Load the dictionary lazily on a background thread, on the first Arabic run that needs checking: about 0.5 s of CPU and 45 MiB, never on the launch path (launch budget: ARCHITECTURE.md §14).
4. Optional: a small built-in list of common misspellings that Ayaspell overgenerates (حتي، متي، قالو، ذالك، الرحمان…), checked before the dictionary. That would recover part of finding 1. Decide in Phase 3, with fixtures.
