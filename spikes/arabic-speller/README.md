# Spike: Arabic speller (Phase 0)

Benchmarks `spellbook` against Hunspell (via `hunspell-rs`) on the bundled Ayaspell dictionary (`dictionaries/ar/`). Result and recommendation: [docs/spikes/arabic-speller.md](../../docs/spikes/arabic-speller.md).

This is a standalone Cargo project (its own `[workspace]`), not part of the app.

```bash
cd spikes/arabic-speller
cargo build --release                     # links the system libhunspell via pkg-config
./target/release/arabic-speller-spike bench spellbook [--strip]
./target/release/arabic-speller-spike bench hunspell  [--strip]
./target/release/arabic-speller-spike oracle         # system `hunspell -a`, the reference
./target/release/arabic-speller-spike agree results/spellbook.tsv results/oracle.tsv
cargo build --release --features bundled  # compile Hunspell's vendored C++ instead
```

- `--strip` wraps the engine in an adapter that removes only the dictionary's `IGNORE` characters (harakat, tatweel, dagger alif) from a temporary copy of the word.
- Timings are thread CPU time, so they hold up on a busy machine.
- `fixtures/correct.tsv` and `fixtures/misspelled.tsv` are the benchmark. Rows marked `policy` depend on an orthographic convention and are scored separately; `realword` misspellings are valid words and are excluded from detection.
- Per-word results land in `results/` (gitignored).
