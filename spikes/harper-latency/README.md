# Spike: Harper latency (Phase 0)

Measures `harper-core` (spelling + grammar, English) block by block on a ~50k-word document.
Result and recommendation: [docs/spikes/harper-latency.md](../../docs/spikes/harper-latency.md).

Standalone Cargo project (own `[workspace]`), never part of the app build.

```bash
cargo build --release                       # cold build ~20 min (burn + thesaurus build script)
B=target/release/harper-latency
$B bench <corpus.txt> [--words 50000] [--iterations 2] [--dialect british] [--cpu]
$B ab <corpus.txt> [--cpu]                  # Harper SpellCheck vs membership-only spelling
$B rules <corpus.txt> [sample=40] [--cpu]   # per-rule cost, first-call cost
$B words                                    # unknown-word suggestion cost
$B probe <corpus.txt> <block-index>         # explain an outlier block
$B smoke                                    # correctness, masking, IJMES dictionary
$B specimen ../../docs/specimen.md          # lint the specimen block by block
```

`--cpu` measures this thread's on-CPU time (`/proc/thread-self/schedstat`, ~1 ms resolution)
instead of wall time, so numbers survive a loaded machine. `--no-default-features` drops
Harper's thesaurus.

Corpora used (Project Gutenberg, public domain, downloaded 2026-10-18, not committed):

| Text | File | SHA-256 |
|---|---|---|
| Austen, *Pride and Prejudice* (#1342) | `pg1342.txt` | `3f6bb9d6f78e0293b56acd4714dd68cb7d6d1d293402031ce9d5a216bcaf9d75` |
| Gibbon, *Decline and Fall*, vol. 1 (#731) | `pg731.txt` | `7568212cddf0780c66d46444eefb8f46e9dfe3be9328d90452c7b006ff975ca3` |

`results/` holds the raw outputs quoted in the result document.
