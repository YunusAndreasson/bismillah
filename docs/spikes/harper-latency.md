# Spike: Harper latency

*Phase 0, 2026-10-18. Question (PLAN.md): latency on a 50k-word document, block by block. Accept when a typical batch takes < 50 ms. Code and raw outputs: `spikes/harper-latency/`.*

**Result: adjust.** Harper is accurate on real mistakes and fast enough for the ARCHITECTURE.md §14 budget on ordinary prose. But the < 50 ms target holds only at the median and only on plain prose. Phase 3 needs the adjustments below. There is also one decision for the author: Harper now runs a small neural network on every parse.

## Method

- `harper-core` 2.13.0, configured as Phase 3 would use it: `MergedDictionary` (curated plus an empty personal dictionary), `LintGroup::new_curated` with `Dialect::American` (905 of 917 rules on), and `Document::new_markdown_default` on each block.
- Corpora: the first 50k words of two public-domain Gutenberg texts, joined into Markdown paragraphs with short all-caps lines as headings:
  - *Pride and Prejudice*: 1,101 blocks, plain prose.
  - Gibbon's *Decline and Fall*, vol. 1: 529 blocks, longest 928 words. Long sentences and many proper names, which makes it closer to Islamic-studies prose.
- "Typical batch": 300 random runs of 1–3 consecutive paragraphs totalling 100–400 words.
  - **Warm, edited:** one word changed, sent to the long-lived group. This is the steady state while typing.
  - **Fresh:** a new group, so Harper's caches are empty.
- Release build on 8 cores. Other agents were compiling at load 10–20, so most runs use per-thread CPU time (`--cpu`, about 1 ms resolution). On a quiet machine (load 1.4), wall and CPU time agreed within 10–20% for *Pride and Prejudice*. The Gibbon figures were measured under load, and under the same load the P&P figures read about 1.6× their quiet values, so treat Gibbon as an upper bound.

## Results

| Measure | Pride and Prejudice (quiet, wall) | Gibbon (CPU, loaded) |
|---|---|---|
| Init: curated dictionary · `LintGroup` (2nd group) | 459 ms · 132 ms (5 ms) | 462 ms · 171 ms (5 ms) |
| One-time: first distance-4 suggestion search (automaton build) | 1.3–1.4 s | 1.7 s |
| Per block, parse + lint: p50 / p95 / p99 / max* | 6.7 / 38 / 78 / 147 ms | 18 / 121 / 178 / 300 ms |
| Block of 150–300 words: p50 / p95 | 46 / 63 ms | 59 / 120 ms |
| **Typical batch, warm, edited: p50 / p95 / p99 / max** | **27 / 59 / 70 / 82 ms** | **69 / 172 / 240 / 377 ms** |
| Typical batch, unchanged, re-sent: p50 / p95 | 8.5 / 15 ms | 18 / 39 ms |
| Typical batch, fresh group: p50 / p95 | 36 / 68 ms | 117 / 284 ms |
| First pass over all blocks (opening a document) | 13.9 s | 19.6 s |
| Resident memory after init / after first pass / peak | 135 / 269 / 437 MB | 135 / 279 / 464 MB |

\* Excludes the one-time automaton build, which first showed up on `## _GEORGE SAINTSBURY._`.

**Where the time goes:**
- Parsing takes about 4.5 ms per 100 words. Linting takes about 19 ms per 100 words once global caches are warm, spread evenly over roughly 900 rules: no rule other than SpellCheck exceeds 0.3%, and disabling the 20 slowest rules changes nothing.
- SpellCheck computes suggestions inline and backs off from edit distance 2 to 4 for unknown words (1–16 ms each). So names and transliterations cost the most. That explains Gibbon.
- A/B test, interleaved: Harper's SpellCheck versus a membership-only check (`contains_word` takes about 1 µs; suggestions computed only when asked). On typical batches the membership check is faster by 17% (P&P) and 31% (Gibbon) at the median, and by 25% and 40% at p95.
- Reusing the group helps only within its LRU caches (1,000 chunks and sentences). Unchanged sentences in a re-sent block are nearly free.

## Correctness (smoke test and specimen)

**Real mistakes:**
- Flags every deliberate mistake: *recieve*, *tomorow*, *a apple*, *Their is*, *the the*.
- *Their is* produces **two lints on one span** (there / they're), so the UI must merge same-span lints.
- Inline code and URLs are skipped by Harper's Markdown parser.

**Smart punctuation:**
- Curly quotes, ’, –, — and … produce no lints.
- Straight `"`, `--`, `...` and `10-12` get Formatting suggestions, which duplicate smart punctuation.

**Opinionated defaults that clash with DESIGN.md §2 ("calm, not clever") and §14:**
- `UseTitleCase` flags every sentence-case heading, including the specimen's own.
- `OxfordComma` and `LongSentences` ("This sentence is 48 words long") are on.
- American spelling is the default and flags *emphasised* and *colour*. Our docs are written in British English.
- Table rows sent alone produce noise: `|---|` is flagged as "use an em dash".

**IJMES transliteration:**
- Every term is flagged, with absurd suggestions: Fātiḥa → *Fatima*, Taymiyya → *Tamika*, Ḥanbalī → *Anal*.
- ʿ (U+02BF) and ʾ (U+02BE) **split words into separate tokens**: `Qur` `ʾ` `ān`. The personal dictionary can teach *ḥadīth* or *Fātiḥa*, but never *Qurʾān* or *ʿilm*.

**Arabic inside English:**
- No spelling lints, but grammar misreads the gap: "The word أمانة means trust" gets "insert *to*".
- `harper_core::parsers::Mask` with a custom `Masker` that excludes Arabic runs keeps spans in block offsets. It avoids the noise that replacing Arabic with spaces or placeholders creates (extra Formatting and Spelling lints). It does not fix that grammar false positive.

## Facts for the IPC design (ARCHITECTURE.md §7)

- **Offsets** are `Span<char>`: Unicode scalar values, not bytes or UTF-16. `😀` counts as 1, so the conversion module must map chars to UTF-16.
- **A lint** is `Lint { span, lint_kind, suggestions, message, priority }`.
  - `Suggestion` is one of `ReplaceWith(Vec<char>)`, `InsertAfter(Vec<char>)` or `Remove`.
  - `LintKind` has about 20 variants. Map `Spelling` and `Typo` to Spelling; map everything else (`*a apple*` is `Miscellaneous`) to "Grammar suggestion".
  - A lint carries no rule ID. Take `rule_id` from the keys of `organized_lints()`.
  - Messages are Harper's English with backticks ("Did you mean to spell \`recieve\` this way?"). Our own copy (DESIGN.md §14) should frame them.
- **Threads:** with the default `concurrent` feature, `LintGroup`, `Document`, `MergedDictionary` and `Lint` are all `Send + Sync` (checked at compile time). But `lint(&mut self)` mutates caches, and the neural chunker is `thread_local!`: each new thread loads its own copy (about 8 ms) and its own 10,000-entry cache. So use **one long-lived lint thread**, not a pool.

## Dependencies

- `harper-core` is Apache-2.0. The build pulls in 211 crates on Linux (262 across all targets).
- `cargo deny check bans licenses sources` against our `deny.toml`: **ok** (only duplicate-version warnings). There are no networking crates: `tokio` appears only on wasm32, and `url` comes from `ammonia` as a parser.
- **About 83 of those crates are `burn` 0.19, a deep-learning framework.** It comes through `harper-brill` → `harper-pos-utils`, and runs an embedded BiLSTM noun-phrase chunker (an 806 KB model) inside every `Document` parse.
  - It is local, CPU-only and deterministic, but it is a machine-learned model. ADR-0004 says "deterministic and rule-based (no AI)", and this needs the author's decision. Options:
    1. Accept it as an internal statistical parser, not an AI feature, and reword ADR-0004.
    2. Pin a Harper release from before `burn`.
    3. Patch `harper-core` to use the `BrillChunker` that is already in `harper-pos-utils`.
- **Thesaurus:** the default `thesaurus` feature zstd-compresses a 24 MB file at maximum level in its build script, which is a large part of the 20-minute cold build. It adds 4.4 MB to the stripped binary (16.3 → 11.9 MB without it) and only feeds `BoringWords` suggestions. Lint output on the smoke suite is identical without it.

## Adjustments for Phase 3

1. **Dependency:** use `harper-core = { default-features = false, features = ["concurrent"] }`, after the author decides on `burn`.
2. **Threading:** run a dedicated lint thread that owns the dictionary and group. Warm it up at launch, off the UI path: dictionary, group, the distance-4 automaton, and a sample paragraph, about 2 s of CPU in total.
3. **Batch size:** send **one changed block** per request. Before linting, drop queued requests already superseded by a newer revision, as well as stale results after.
4. **Spelling:** disable Harper's `SpellCheck`. Check spelling with our own membership pass, which shares the personal dictionary and the masking rules, and compute suggestions on demand (`suggest_correct_spelling`) when the popover opens.
5. **Masking:** use `parsers::Mask` to exclude Arabic runs, code, URLs and **transliterated words** (any Latin word containing ʿ ʾ, dot-below letters or macrons; a character-based rule like the Qur'anic skip). Drop grammar lints that touch a masked gap. Never send table delimiter rows.
6. **Curated defaults:** turn off `UseTitleCase`, `OxfordComma`/`NoOxfordComma`, `LongSentences` and `BoringWords`. Add a dialect setting (British for the author). Consider turning off the dash and ellipsis Formatting rules while smart punctuation is on.
7. **Opening a document:** lint the visible blocks first and the rest progressively. Cache results by block hash for the session, because a 50k-word first pass costs 14–20 s of CPU.
8. **Measure in the app:** typical-batch latency against the < 50 ms target (expected after 3–4: P&P p95 ≈ 45 ms, dense prose still above), and memory: 135 MB at init, about 300 MB after a 50k-word pass.
