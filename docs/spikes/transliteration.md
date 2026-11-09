# Spike: transliteration table (keyboard input, corpus half)

*Phase 0, 2026-10-18.* Question (PLAN.md): does the transliteration table in DESIGN.md §11.3 avoid collisions on English and transliterated prose? **Verdict: adjust.** Macrons change from `a-` to `a=`; dots below keep `.h` with one guard; ʿayn (`` ` ``) and hamza (`''`) stay, with two backtick rules. The converter now lives in `src/editor/typingAids.ts`; the spike's code and harness were removed on 2026-11-09 (`git log --all -- spikes/transliteration` finds them).

## Method

`converter.ts` simulates typing key by key, as the editor sees it: a rule may replace only the keys just typed at the caret, and an immediate Backspace restores them. Smart punctuation (on by default) is modelled too, with its exclusions (code, fences, frontmatter, URLs, link targets). The harness turns each text into the keys a writer would press under a candidate table (ā → `a=`, ḥ → `.h`), types them, and counts every unwanted conversion as a **collision**: one Backspace the writer must press. Intended sequences that fail to convert are **misses**. Each component was tested alone, then the whole tables.

| Corpus | Words | Notes |
|---|---:|---|
| Fixtures (in repo) | 1,028 | Hand-written in the author's register: IJMES names, particles, A.H./C.E. dates, abbreviations, Markdown |
| Project Gutenberg | 1,553,180 | Austen, Melville, Darwin, the Federalist Papers, Montaigne, Gibbon, Joyce (first 300k words of each) |
| Wikipedia | 247,524 | 38 Islamic-studies articles, 5,210 IJMES letters |

The downloaded corpora are not committed; the spike's `fetch-corpora.sh` (in history) reproduces them.

## Results

Collisions per 100k words (raw count in brackets). The fixture is deliberately dense, so its rate is high for every table that collides at all.

| Component | Candidate | Fixtures | Gutenberg | Wikipedia | Misses |
|---|---|---:|---:|---:|---:|
| Macrons | **`a-` (proposal)** | 1556 (16) | 14.0 (218) | 73.1 (181) | 0 |
| | `a-` + particle guard | 97 (1) | 13.6 (211) | 45.7 (113) | **691** |
| | **`a=`** | **0** | **0** | **0** | 0 |
| | `a_` | 389 (4) | 13.4 (208) | 0 | 0 |
| | `aa` | 0 | 121 (1886) | 80.0 (198) | 1 |
| Dots below | **`.h` (proposal)** | 973 (10) | 2.2 (34) | 23.4 (58) | 0 |
| | **`.h` + G1** | 195 (2) | **0.3 (5)** | **2.0 (5)** | 0 |
| | `h.` | 3502 (36) | 1683 (26138) | 1772 (4386) | 0 |
| | `,h` | 0 | 0 | 0 | 0 |
| ʿayn | **`` ` `` (proposal)** | 778 (8) | 0 | 9.3 (23)\* | 0 |
| | `` ` `` + B1 B2 | 486 (5) | 0 | 9.3 (23)\* | 16 |
| | **`` ` `` + B2 B3** | 389 (4) | 0 | 9.3 (23)\* | 0 |
| | `3` (not after a digit) | 292 (3) | 83.9 (1303) | 120 (296) | 0 |
| Hamza | **`''` (proposal)** | 0 | 0 | 0.4 (1) | 0 |
| | `'` (ArabTeX) | 486 (5) | 2.4 (38)† | 1529 (3785) | 0 |
| **Whole** | proposal | 3307 (34) | 16.2 (252) | 106 (263) | 0 |
| | **recommended** | 584 (6) | **0.3 (5)** | 11.7 (29)\* | 0 |

\* All 23 are Wikipedia's own use of `` ` `` as a stand-in for ʿayn ("ibn `Uyaynah"), so they are conversions a writer would want. Without them, the recommended table has 6 real collisions in 247k words.
† Gutenberg's UTF-8 texts mostly use ’, which understates apostrophe collisions; Wikipedia's straight apostrophes show the real rate.
The misses column leaves out 6 misses common to every candidate: 2 in the fixture's frontmatter title (by design, see open questions) and 4 in two Wikipedia paragraphs whose stray backtick the model reads as opening inline code.

## What collides

- **`a-` collides with IJMES itself.** Prefixed particles are hyphenated: wa-l-ʿilm → *wāl-ʿilm*, bi-llāh → *bīllāh*, li-l-nās, fa-qāla, wa-sallam. English compounds too: sea-shore, semi-domestic, Sunni-Shiʿi, multi-ethnic. In the fixture's particle-heavy prose, `a-` alone costs a Backspace every 64 words, and the whole proposal one every 30. A guard for one-letter syllables (wa-, bi-) cannot tell them from real long vowels (Ṭā, Fā, Sū) and caused 691 misses.
- `aa` hits Canaan, Isaac and Roman numerals (Gibbon's "l. ii."); `a_` hits underscore emphasis (`_sunna_`) and Darwin's `_a_1`.
- **`.h` collides with dotted abbreviations:** A.H., A.D., Ph.D., U.S., P.S., W.C.H. All of them put an upper-case letter straight after a letter and a dot, which never happens inside an IJMES word, so guard G1 removes them. The remainder is rare and lower-case: n.d., a.s., bare domains (shiism.wcfia.harvard.edu), DOIs, and missing-space typos ("2.The"). A lower-case guard was rejected because it would block Aḥmad (`A.hmad`) and iṣlāḥ (`i.sla=.h`).
- `h.` converts every sentence ending in s, d, t, h or z. `,h` has no collisions but loses the dot-below mnemonic; `.h` + G1 is down to 0.3–2 collisions per 100k words, so it keeps the proposal's shape.
- **Backtick:** the only real collisions are the opening backticks of inline code typed while the mode is on (one Backspace per code span). A line-start guard (B1) breaks line-initial ʿayn ("1. ʿUmar", a paragraph starting "ʿAlī"), so it was rejected in favour of B3 below.
- `''` collided once, where a writer typed two apostrophes as a closing quote.

## Recommended table

| You type | You get | You type | You get |
|---|---|---|---|
| `a=` `i=` `u=` | ā ī ū | `A=` `I=` `U=` | Ā Ī Ū |
| `.h` `.s` `.d` `.t` `.z` | ḥ ṣ ḍ ṭ ẓ | `.H` `.S` `.D` `.T` `.Z` | Ḥ Ṣ Ḍ Ṭ Ẓ |
| `` ` `` | ʿ (U+02BF) | `''` | ʾ (U+02BE) |

`=` reads as the bar of the macron, and it is still a postfix sequence, as chosen in the interview.

## Rules beyond the table

1. **Sequences match whole just-typed keys.** "…" made from `...` never supplies a dot, so `wait...then` stays *wait…then*. With smart punctuation off, a dot sequence after `..` still converts (3 extra collisions in 1.8M words).
2. **G1:** `.H .S .D .T .Z` do not convert directly after a letter (A.H., U.S., Ph.D.). Lower case has no guard.
3. **B2:** a backtick right after a backtick stays a backtick. **B3:** a backtick typed straight after a backtick-made ʿ turns the pair into ` `` `. Together, ```` ``` ```` fences and ` ``code`` ` spans type normally, with a one-keystroke flicker of ʿ. The cost is that a doubled ʿayn (ʿʿ) cannot be typed directly; it does not occur in the corpora.
4. **Backspace** straight after a conversion restores the typed keys literally (`.h`, `''`, `"`), and restored keys never take part in a later conversion. After that, Backspace is an ordinary delete.
5. **Smart dashes** convert only after a non-space, non-dash character on the line, and never on a table row. Without this, `---` at the start of a line (frontmatter, rules, setext underlines) became "-–", which the fixture caught. A quote after `*` or `_` counts as opening.
6. Indented code blocks join the exclusions (code, fences, frontmatter, URLs, link targets).

## Open questions for the author

- **Frontmatter:** the aids never run there (DESIGN.md §11.3), so a transliterated `title:` cannot be typed with the mode. Allowing transliteration (not smart punctuation) in frontmatter values would fix that, but `''` is YAML's escaped quote inside single-quoted strings, so it would need its own exclusion.
- **Inline code with the mode on** costs one Backspace per code span. Acceptable for prose; worth confirming.
