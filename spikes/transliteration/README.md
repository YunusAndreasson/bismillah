# Transliteration spike

Phase 0 "Keyboard input" spike, corpus half: does the transliteration table in DESIGN.md §11.3 collide with ordinary English, IJMES prose or Markdown? Result: [docs/spikes/transliteration.md](../../docs/spikes/transliteration.md).

| File | Job |
|---|---|
| `converter.ts` | Typing simulator: smart punctuation and transliteration acting only on just-typed keys at the caret, with Backspace restoring the typed keys. Phase 1 ports it to `src/editor/`. |
| `tables.ts` | Candidate tables per component (macrons, dots below, ʿayn, hamza), the DESIGN.md proposal and the recommended `FINAL` table. |
| `harness.ts` | Types each corpus as a writer would under each table and counts unwanted conversions, misses and mismatches. |
| `converter.test.ts` | Unit tests for the final table and the undo contract. |
| `fixtures/` | Hand-written prose and Markdown in the author's register (always included). |
| `fetch-corpora.sh` | Downloads the public-domain and Wikipedia corpora into a directory outside the repo. |

```bash
node --test spikes/transliteration/
./spikes/transliteration/fetch-corpora.sh "$SCRATCH/corpus"
node spikes/transliteration/harness.ts --corpus gutenberg="$SCRATCH/corpus/gutenberg" --corpus wikipedia="$SCRATCH/corpus/wikipedia"
```

Plain Node 26 (TypeScript type stripping), no dependencies.
