# 0010 — Typing aids: smart punctuation and transliteration mode

- **Status:** Accepted
- **Amended:** 2026-10-18 (Phase 0). Transliteration table finalised from a collision corpus.
- **Date:** 2026-10-18

## Context
The author writes long-form English with Arabic phrases and IJMES transliteration (ā ī ū ḥ ṣ ḍ ṭ ẓ ʿ ʾ), and wants typographic punctuation. Both require transforming characters as they are typed, which sits close to the rule "save exactly what the writer typed". Sequences that are always active collide with ordinary English: `h.` → ḥ would turn "each." into "eacḥ".

## Decision
- **Smart punctuation is on by default.** It turns `"` into “ ” (and « » in an Arabic run), `'` into ‘ ’, mid-line `--`/`---` into –/—, and `...` into …
- **Transliteration mode** (`Mod-Shift-T`, off by default, with a persistent indicator) follows IJMES: `a=` → ā, `.h` → ḥ, `` ` `` → ʿ, `''` → ʾ. Final table and guard rules: DESIGN.md §11.3.
- **Both aids:**
  - act only on just-typed characters at the caret, and are undone by an immediate Backspace (and as a separate `Mod-Z` step)
  - never run in code, frontmatter, URLs or link targets
  - never run on open, paste or save.

## Consequences
- AGENTS.md rule 3 names these aids as the only transformations allowed.
- They need a collision test corpus (English prose, transliterated prose, Markdown syntax) and undo tests.
- Arabic punctuation typed from the Arabic layout (، ؟ ؛) is never touched.

## Phase 0 result (2026-10-18)

**Keyboard input: go. Transliteration table: adjust.** Evidence: [keyboard-input.md](../spikes/keyboard-input.md), [transliteration.md](../spikes/transliteration.md).
- Layout switching (Swedish ↔ Arabic), dead keys and Compose type correctly into the editor through XKB and GTK, with no lost or doubled characters. The Wayland + fcitx5 path of the author's session needs a short manual check.
- On 1.8M words of English and Islamic-studies prose, the proposed `a-` collided with IJMES's own particles (*wa-l-*, *bi-llāh*) and English compounds; **`a=` had zero collisions** and stays postfix. `.h` keeps its shape with one guard (upper-case dot sequences don't convert straight after a letter: A.H., U.S., Ph.D.). The backtick keeps ʿ with two rules so code spans and fences still type. Collisions fell from 16 to 0.3 per 100k words of English prose and from 106 to about 2 on Islamic-studies prose.
- Smart dashes convert only after a non-space, non-dash character on the line and never on a table row, so `---` at the start of a line stays Markdown.
