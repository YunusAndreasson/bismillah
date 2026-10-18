# 0004 — Spelling and grammar engines

- **Status:** Accepted
- **Date:** 2026-10-18
- **Amended:** 2026-10-18 (interview). Arabic runs containing Qur'anic annotation characters are skipped automatically.
- **Amended:** 2026-10-18 (Phase 0). `spellbook` chosen; Qur'anic trigger includes alef wasla; Harper adjustments; AI policy clarified by the author.
- **Amended:** 2026-10-18 (Phase 3). Built; the refinements below.

## Context
Spelling (English and Arabic) and grammar (English) are the only features beyond typing. They must be offline and deterministic, and must never alter the writer's text on their own.

## Decision
- **English:** `harper-core` (Apache-2.0) for spelling and grammar.
- **Arabic:** `spellbook` (pure Rust, MPL-2.0) with the Ayaspell dictionary (GPL/LGPL/MPL tri-licence), behind an `ArabicSpeller` trait. The Hunspell binding was benchmarked and rejected (Phase 0 result below).
- **Routing:** by script runs, overridable with frontmatter `lang:` or a setting. Grammar runs only on English runs. Unsupported scripts are never flagged.
- **Qur'anic text:** Arabic runs containing alef wasla (U+0671), U+0610–U+061A, U+06D6–U+06ED or U+08D3–U+08FF are not spellchecked, because Uthmani orthography is not modern spelling. The decision is made on characters, never on meaning.
- **AI (author's decision, 2026-10-18):** no generative AI: nothing that writes, rewrites or summarises the writer's text, and nothing that does the writer's thinking. Grammar checking smarter than a plain spell checker is welcome, including small local models bundled in the checker (such as Harper's embedded chunker), as long as it runs offline, only flags and suggests, and every change is an explicit action by the writer.
- **Offsets:** UTF-16 code units, relative to a block, at the IPC boundary. One tested conversion module in Rust.
- **Revisions:** requests carry the document revision; stale responses are dropped.
- **Normalisation:** only in a temporary analysis copy with an offset map. Strip only what the dictionary allows (diacritics, tatweel). No unconditional alef or hamza folding.

## Consequences
- Fixture suites are needed for emoji, combining marks, diacritics, CRLF and mixed lines.
- Wording presents grammar results as fallible suggestions.

## Phase 0 result (2026-10-18)

**Arabic: `spellbook` go, Hunspell binding no-go.** Evidence: [docs/spikes/arabic-speller.md](../spikes/arabic-speller.md). Both engines accept and reject exactly the same words on a 528-word benchmark (all 404 correct words accepted, 99 of 124 misspellings flagged; the misses are Ayaspell's affix rules). `spellbook` is pure Rust, deterministic and twice as fast; the binding is unmaintained, not `Send`, needs a C++ toolchain, and Hunspell's suggestions vary with machine load. Phase 3 adapter requirements: strip the dictionary's `IGNORE` marks on a temporary copy before check *and* suggest; suggest only on request, off the UI thread, with a ~300 ms budget; load the dictionary lazily. The `hunspell` CLI stays as a test oracle.

**Harper: adjust.** Evidence: [docs/spikes/harper-latency.md](../spikes/harper-latency.md). harper-core 2.13 flags every deliberate mistake. A typical edit batch takes 27 ms median / 59 ms p95 on plain prose and more on name-heavy prose, so the < 50 ms target holds only at the median. Phase 3 must: run one warm lint thread; send one changed block per request and drop superseded ones; replace Harper's inline suggestions with a membership check plus on-demand suggestions (−17–31% median); mask Arabic runs, transliterated words, code and URLs (ʿ and ʾ split Harper's tokens, so IJMES words need their own handling); curate opinionated defaults (title case, Oxford comma, long sentences) and offer British spelling. Offsets come back as Unicode scalar values, converted to UTF-16 in the one conversion module. Drop the thesaurus feature (4.4 MB, no lint effect). harper-core embeds a small neural network for chunking via `burn` (about 80 crates); under the AI policy above this is acceptable.

**Qur'anic trigger:** the original ranges matched only 66% of Tanzil verses (none of al-Fātiḥa); adding alef wasla raises it to 87%. The verses still missed use only standard vocalisation, so modern spelling rules don't misfire on them.

## Phase 3 result (2026-10-18)

Built as decided (`crates/bismillah-lint`, ARCHITECTURE.md §7), with these refinements, none of which changes the decision:

- **The editor decides what is prose**, from its own syntax tree, and sends each block's exact text with the ranges to skip (code, URLs, HTML) and the Markdown marks. Harper reads the rest through its `Mask` parser, so its spans stay in block offsets.
- **`lang:` routes the runs of its own script.** `lang: fa` leaves Arabic-script runs alone, `lang: de` leaves Latin runs alone, `lang: en-US` chooses the dialect; an English document still has its Arabic checked. The dialect setting is British by default, the docs' own spelling.
- **IJMES transliteration is never checked as English**: a word, or hyphenated compound, with ʿ ʾ, a macron or a dot, line or breve below. Harper can't tokenise it and its suggestions are absurd; the writer knows these words better than any list. Grammar near such a word, an Arabic run or skipped code is dropped.
- **Grammar means grammar.** Besides the Phase 0 list, `AvoidCurses` and `CompoundNouns` are off, and lints of kind Enhancement, Readability and Style are dropped.
- **Common Arabic misspellings** that Ayaspell's affix rules accept (حتي، متي، ذالك، الرحمان، قالو… — only forms that are no word in any reading) are refused with their correction first: the optional step from the Phase 0 spike, decided with its fixture (11 misses remain, each a possible real word).
- **Superseded requests are never queued** rather than dropped in Rust: the editor keeps one request in flight and sends the latest text of what changed meanwhile. Staleness is checked per block against the edits made while a request was out.
- Accepted with the fixture suites in `crates/bismillah-lint/tests/` (English, Arabic with and without diacritics, mixed, masked, routing), the Phase 0 Arabic benchmark with the `hunspell` oracle, the editor's stale-result tests and the real-app suite `tests/e2e/checking.e2e.ts`.
