# 0010 — Typing aids: smart punctuation and transliteration mode

- **Status:** Accepted (transliteration table pending the Phase 0 keyboard-input spike)
- **Date:** 2026-10-18

## Context
The author writes long-form English with Arabic phrases and IJMES transliteration (ā ī ū ḥ ṣ ḍ ṭ ẓ ʿ ʾ), and wants typographic punctuation. Both require transforming characters as they are typed, which sits close to the rule "save exactly what the writer typed". Sequences that are always active collide with ordinary English: `h.` → ḥ would turn "each." into "eacḥ".

## Decision
- **Smart punctuation is on by default.** It turns `"` into “ ” (and « » in an Arabic run), `'` into ‘ ’, mid-line `--`/`---` into –/—, and `...` into …
- **Transliteration mode** (`Mod-Shift-T`, off by default, with a persistent indicator) follows IJMES with dot-before sequences (`.h` → ḥ, `a-` → ā, `` ` `` → ʿ, `''` → ʾ). Proposed table: DESIGN.md §11.3.
- **Both aids:**
  - act only on just-typed characters at the caret, and are undone by an immediate Backspace (and as a separate `Mod-Z` step)
  - never run in code, frontmatter, URLs or link targets
  - never run on open, paste or save.

## Consequences
- AGENTS.md rule 3 names these aids as the only transformations allowed.
- They need a collision test corpus (English prose, transliterated prose, Markdown syntax) and undo tests.
- Arabic punctuation typed from the Arabic layout (، ؟ ؛) is never touched.
