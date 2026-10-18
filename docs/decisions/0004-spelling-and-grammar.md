# 0004 — Spelling and grammar engines

- **Status:** Accepted (Arabic engine choice pending Phase 0)
- **Date:** 2026-10-18
- **Amended:** 2026-10-18 (interview). Arabic runs containing Qur'anic annotation characters are skipped automatically.

## Context
Spelling (English and Arabic) and grammar (English) are the only features beyond typing. They must be offline, deterministic and rule-based (no AI), and must never alter the writer's text.

## Decision
- **English:** `harper-core` (Apache-2.0) for spelling and grammar.
- **Arabic:** an `ArabicSpeller` adapter with two implementations: `spellbook` (pure Rust, self-described work in progress) and `hunspell-rs` (C++ Hunspell). Both use the Ayaspell dictionary (GPL/LGPL/MPL tri-licence). Phase 0 chooses the default by a correctness and suggestion benchmark.
- **Routing:** by script runs, overridable with frontmatter `lang:` or a setting. Grammar runs only on English runs. Unsupported scripts are never flagged.
- **Qur'anic text:** Arabic runs containing U+0610–U+061A, U+06D6–U+06ED or U+08D3–U+08FF are not spellchecked, because Uthmani orthography is not modern spelling. The decision is made on characters, never on meaning.
- **Offsets:** UTF-16 code units, relative to a block, at the IPC boundary. One tested conversion module in Rust.
- **Revisions:** requests carry the document revision; stale responses are dropped.
- **Normalisation:** only in a temporary analysis copy with an offset map. Strip only what the dictionary allows (diacritics, tatweel). No unconditional alef or hamza folding.

## Consequences
- The Arabic fallback adds a C++ build dependency if it is chosen.
- Fixture suites are needed for emoji, combining marks, diacritics, CRLF and mixed lines.
- Wording presents grammar results as fallible suggestions.
