//! Phase 0 spike: harper-core latency, block by block.
//!
//! Usage:
//!   harper-latency bench <corpus.txt> [--words N] [--dialect american|british] [--iterations K]
//!   harper-latency specimen <docs/specimen.md>
//!   harper-latency smoke
//!
//! The corpus is a plain-text file (a Project Gutenberg book works). The Gutenberg licence
//! header and footer are stripped, hard-wrapped lines are joined into Markdown blocks, and the
//! first N words (default 50 000) are kept.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use harper_core::linting::{Lint, LintGroup, Linter, Suggestion};
use harper_core::spell::{Dictionary, FstDictionary, MergedDictionary, MutableDictionary};
use harper_core::{Dialect, Document};

// ---------------------------------------------------------------------------
// Clock. Wall time by default; with `--cpu`, this thread's on-CPU time from
// /proc/thread-self/schedstat, so numbers stay meaningful on a loaded machine.

static USE_CPU: AtomicBool = AtomicBool::new(false);
static START: LazyLock<Instant> = LazyLock::new(Instant::now);

fn now() -> Duration {
    if USE_CPU.load(Ordering::Relaxed) {
        let s = std::fs::read_to_string("/proc/thread-self/schedstat").unwrap_or_default();
        let ns: u64 = s
            .split_whitespace()
            .next()
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        Duration::from_nanos(ns)
    } else {
        START.elapsed()
    }
}

fn main() {
    let mut args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--cpu") {
        args.remove(i);
        USE_CPU.store(true, Ordering::Relaxed);
        println!("clock: thread CPU time (/proc/thread-self/schedstat)");
    } else {
        println!("clock: wall time");
    }
    match args.get(1).map(String::as_str) {
        Some("bench") => bench(&args[2..]),
        Some("rules") => rules(&args[2..]),
        Some("probe") => probe(&args[2..]),
        Some("words") => words(),
        Some("ab") => ab(&args[2..]),
        Some("specimen") => specimen(&args[2..]),
        Some("smoke") => smoke(),
        _ => {
            eprintln!(
                "usage: harper-latency bench <corpus> [--words N] [--dialect american|british] [--iterations K]"
            );
            eprintln!("       harper-latency specimen <specimen.md>");
            eprintln!("       harper-latency smoke");
            std::process::exit(2);
        }
    }
}

// ---------------------------------------------------------------------------
// Setup, as Phase 3 would configure it.

/// The curated dictionary merged with a (here empty) personal dictionary,
/// which is how the `bismillah-lint` crate would add `dictionary.txt`.
fn build_dictionary() -> Arc<MergedDictionary> {
    let mut merged = MergedDictionary::new();
    merged.add_dictionary(FstDictionary::curated());
    merged.add_dictionary(Arc::new(MutableDictionary::new()));
    Arc::new(merged)
}

fn build_group(dict: &Arc<MergedDictionary>, dialect: Dialect) -> LintGroup {
    LintGroup::new_curated(dict.clone(), dialect)
}

fn parse_block(text: &str, dict: &impl Dictionary) -> Document {
    Document::new_markdown_default(text, dict)
}

// Compile-time thread-safety facts that affect the IPC design.
#[allow(dead_code)]
fn assert_send_sync<T: Send + Sync>() {}
#[allow(dead_code)]
fn thread_safety_facts() {
    assert_send_sync::<LintGroup>();
    assert_send_sync::<Document>();
    assert_send_sync::<MergedDictionary>();
    assert_send_sync::<Lint>();
}

// ---------------------------------------------------------------------------
// Corpus handling.

fn load_blocks(path: &str, word_limit: usize) -> Vec<String> {
    let raw = std::fs::read_to_string(path).expect("read corpus");
    let raw = raw.replace("\r\n", "\n");
    let body = match (raw.find("*** START OF"), raw.find("*** END OF")) {
        (Some(s), Some(e)) => {
            let after = raw[s..].find('\n').map(|i| s + i + 1).unwrap_or(s);
            &raw[after..e]
        }
        _ => raw.as_str(),
    };

    let mut blocks = Vec::new();
    let mut words = 0usize;
    for para in body.split("\n\n") {
        let joined = para
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        if joined.is_empty() {
            continue;
        }
        let n = joined.split_whitespace().count();
        // Short all-caps lines ("CHAPTER I.") become Markdown headings.
        let is_heading = n <= 8
            && joined
                .chars()
                .filter(|c| c.is_alphabetic())
                .all(|c| c.is_uppercase());
        let block = if is_heading {
            format!("## {joined}")
        } else {
            joined
        };
        blocks.push(block);
        words += n;
        if words >= word_limit {
            break;
        }
    }
    blocks
}

fn word_count(s: &str) -> usize {
    s.split_whitespace().count()
}

// ---------------------------------------------------------------------------
// Statistics.

struct Stats {
    samples: Vec<Duration>,
}

impl Stats {
    fn new(mut samples: Vec<Duration>) -> Self {
        samples.sort();
        Self { samples }
    }
    fn pct(&self, p: f64) -> f64 {
        if self.samples.is_empty() {
            return 0.0;
        }
        let idx = ((self.samples.len() as f64 - 1.0) * p).round() as usize;
        ms(self.samples[idx])
    }
    fn max(&self) -> f64 {
        self.samples.last().copied().map(ms).unwrap_or(0.0)
    }
    fn total(&self) -> f64 {
        ms(self.samples.iter().sum())
    }
    fn line(&self, label: &str) {
        println!(
            "  {label:<44} n={:<5} p50={:>7.3}ms p95={:>7.3}ms p99={:>7.3}ms max={:>8.3}ms total={:>9.1}ms",
            self.samples.len(),
            self.pct(0.5),
            self.pct(0.95),
            self.pct(0.99),
            self.max(),
            self.total()
        );
    }
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

fn rss_kb(field: &str) -> u64 {
    let status = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
    status
        .lines()
        .find(|l| l.starts_with(field))
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

fn mem(label: &str) {
    println!(
        "  memory {label:<36} VmRSS={:>7.1} MB  VmHWM={:>7.1} MB",
        rss_kb("VmRSS:") as f64 / 1024.0,
        rss_kb("VmHWM:") as f64 / 1024.0
    );
}

/// Tiny deterministic PRNG so batch selection is reproducible without a dependency.
struct XorShift(u64);
impl XorShift {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

/// Simulates a keystroke inside one sentence of a paragraph: the edited sentence
/// misses Harper's sentence/chunk caches, the rest of the paragraph can hit.
fn edit_one_word(block: &str, rng: &mut XorShift) -> String {
    let words: Vec<&str> = block.split(' ').collect();
    if words.len() < 2 {
        return format!("{block}x");
    }
    let i = rng.below(words.len());
    let mut out = String::with_capacity(block.len() + 1);
    for (j, w) in words.iter().enumerate() {
        if j > 0 {
            out.push(' ');
        }
        out.push_str(w);
        if j == i {
            out.push('s');
        }
    }
    out
}

// ---------------------------------------------------------------------------
// The benchmark.

fn bench(args: &[String]) {
    let corpus = args.first().expect("corpus path");
    let mut word_limit = 50_000usize;
    let mut dialect = Dialect::American;
    let mut iterations = 3usize;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--words" => {
                word_limit = args[i + 1].parse().expect("--words N");
                i += 1;
            }
            "--dialect" => {
                dialect = match args[i + 1].as_str() {
                    "british" => Dialect::British,
                    _ => Dialect::American,
                };
                i += 1;
            }
            "--iterations" => {
                iterations = args[i + 1].parse().expect("--iterations K");
                i += 1;
            }
            other => panic!("unknown argument {other}"),
        }
        i += 1;
    }

    println!("harper-core 2.13.0 latency spike");
    println!("corpus: {corpus}");
    mem("at start");

    // --- 1. One-time init ------------------------------------------------
    let t = now();
    let curated = FstDictionary::curated();
    let t_curated = now() - t;
    drop(curated);
    let t = now();
    let dict = build_dictionary();
    let t_merged = now() - t;
    let t = now();
    let mut group = build_group(&dict, dialect);
    let t_group = now() - t;
    let t = now();
    let _second_group = build_group(&dict, dialect);
    let t_group2 = now() - t;
    drop(_second_group);
    println!("\n[init] dialect={dialect:?}");
    println!(
        "  FstDictionary::curated() first call     {:>8.1} ms",
        ms(t_curated)
    );
    println!(
        "  MergedDictionary (curated + personal)    {:>8.1} ms",
        ms(t_merged)
    );
    println!(
        "  LintGroup::new_curated (first)           {:>8.1} ms",
        ms(t_group)
    );
    println!(
        "  LintGroup::new_curated (second)          {:>8.1} ms",
        ms(t_group2)
    );
    let enabled = group
        .iter_keys()
        .filter(|k| group.config.is_rule_enabled(k))
        .count();
    println!(
        "  rules: {} total, {} enabled by default",
        group.iter_keys().count(),
        enabled
    );
    mem("after init");

    // --- 2. Corpus --------------------------------------------------------
    let blocks = load_blocks(corpus, word_limit);
    let total_words: usize = blocks.iter().map(|b| word_count(b)).sum();
    let headings = blocks.iter().filter(|b| b.starts_with("## ")).count();
    let longest = blocks.iter().map(|b| word_count(b)).max().unwrap_or(0);
    println!(
        "\n[corpus] {} blocks ({} headings), {} words, {} chars, longest block {} words",
        blocks.len(),
        headings,
        total_words,
        blocks.iter().map(|b| b.chars().count()).sum::<usize>(),
        longest
    );

    // --- 3. First pass (document open), cold caches ------------------------
    println!("\n[full pass] parse + lint every block with one LintGroup");
    let mut parse_t = Vec::new();
    let mut lint_t = Vec::new();
    let mut block_t = Vec::new();
    let mut lint_count = 0usize;
    let mut worst = (Duration::ZERO, 0usize);
    let pass_start = now();
    for (idx, b) in blocks.iter().enumerate() {
        let t0 = now();
        let doc = parse_block(b, dict.as_ref());
        let t1 = now();
        let lints = group.lint(&doc);
        let t2 = now();
        lint_count += lints.len();
        parse_t.push(t1 - t0);
        lint_t.push(t2 - t1);
        block_t.push(t2 - t0);
        if t2 - t0 > worst.0 {
            worst = (t2 - t0, idx);
        }
    }
    let first_pass = now() - pass_start;
    Stats::new(parse_t).line("cold: parse (Document::new_markdown)");
    Stats::new(lint_t).line("cold: lint (LintGroup::lint)");
    Stats::new(block_t.clone()).line("cold: parse + lint per block");
    println!(
        "  first pass wall time {:.1} ms, {} lints",
        ms(first_pass),
        lint_count
    );
    println!(
        "  worst block: #{} ({} words, {} chars) {:.2} ms",
        worst.1,
        word_count(&blocks[worst.1]),
        blocks[worst.1].chars().count(),
        ms(worst.0)
    );
    mem("after first pass");

    // Latency against block size.
    let mut by_size: Vec<(usize, Duration)> = blocks
        .iter()
        .zip(block_t.iter())
        .map(|(b, d)| (word_count(b), *d))
        .collect();
    by_size.sort_by_key(|(w, _)| *w);
    for (lo, hi) in [
        (0, 50),
        (50, 150),
        (150, 300),
        (300, 600),
        (600, usize::MAX),
    ] {
        let s: Vec<Duration> = by_size
            .iter()
            .filter(|(w, _)| *w >= lo && *w < hi)
            .map(|(_, d)| *d)
            .collect();
        if !s.is_empty() {
            Stats::new(s).line(&format!(
                "cold by size: {lo}..{} words",
                if hi == usize::MAX {
                    "∞".to_string()
                } else {
                    hi.to_string()
                }
            ));
        }
    }

    // --- 4. Repeated full passes: warm caches ------------------------------
    for it in 0..iterations {
        let mut s = Vec::new();
        let start = now();
        for b in &blocks {
            let t0 = now();
            let doc = parse_block(b, dict.as_ref());
            let _ = group.lint(&doc);
            s.push(now() - t0);
        }
        let wall = now() - start;
        Stats::new(s).line(&format!(
            "reused group, full pass #{} (wall {:.0} ms)",
            it + 2,
            ms(wall)
        ));
    }

    // A fresh LintGroup per call (no cache carried over), on a sample of blocks.
    {
        let mut s = Vec::new();
        for b in blocks.iter().step_by(10) {
            let mut fresh = build_group(&dict, dialect);
            let doc = parse_block(b, dict.as_ref());
            let t0 = now();
            let _ = fresh.lint(&doc);
            s.push(now() - t0);
        }
        Stats::new(s).line("fresh group per block (lint only, every 10th)");
    }

    // --- 5. Typical batches: 1–3 consecutive paragraphs, 100–400 words -----
    println!("\n[typical batch] 1–3 consecutive paragraphs totalling 100–400 words");
    let paragraphs: Vec<usize> = (0..blocks.len())
        .filter(|&i| !blocks[i].starts_with("## "))
        .collect();
    let mut rng = XorShift(0x5eed_b15b_1a11);
    let mut batches: Vec<Vec<usize>> = Vec::new();
    let mut guard = 0;
    while batches.len() < 300 && guard < 100_000 {
        guard += 1;
        let start = paragraphs[rng.below(paragraphs.len())];
        let len = 1 + rng.below(3);
        if start + len > blocks.len() {
            continue;
        }
        let ids: Vec<usize> = (start..start + len).collect();
        let w: usize = ids.iter().map(|&i| word_count(&blocks[i])).sum();
        if (100..=400).contains(&w) && ids.iter().all(|&i| !blocks[i].starts_with("## ")) {
            batches.push(ids);
        }
    }

    // (a) An edit inside one paragraph of the batch, the group already warm from
    //     the passes above: the realistic steady state while typing.
    let mut warm_edit = Vec::new();
    // (b) The same batch on a brand-new group: no cache at all.
    let mut cold = Vec::new();
    // (c) Unchanged batch re-sent on the warm group (cache hits).
    let mut warm_same = Vec::new();
    for ids in &batches {
        let edited: Vec<String> = ids
            .iter()
            .enumerate()
            .map(|(k, &i)| {
                if k == 0 {
                    edit_one_word(&blocks[i], &mut rng)
                } else {
                    blocks[i].clone()
                }
            })
            .collect();

        let t0 = now();
        for b in &edited {
            let doc = parse_block(b, dict.as_ref());
            let _ = group.lint(&doc);
        }
        warm_edit.push(now() - t0);

        let t0 = now();
        for &i in ids {
            let doc = parse_block(&blocks[i], dict.as_ref());
            let _ = group.lint(&doc);
        }
        warm_same.push(now() - t0);

        let mut fresh = build_group(&dict, dialect);
        let t0 = now();
        for &i in ids {
            let doc = parse_block(&blocks[i], dict.as_ref());
            let _ = fresh.lint(&doc);
        }
        cold.push(now() - t0);
    }
    Stats::new(warm_edit).line("warm group, one word edited (steady state)");
    Stats::new(warm_same).line("warm group, unchanged batch re-sent");
    Stats::new(cold).line("fresh group (no cache), excl. construction");

    // --- 6. Concurrency: is a group per thread practical? -------------------
    {
        let t0 = Instant::now();
        let handle = {
            let dict = dict.clone();
            let blocks: Vec<String> = blocks.iter().take(200).cloned().collect();
            std::thread::spawn(move || {
                let mut g = build_group(&dict, dialect);
                for b in &blocks {
                    let doc = parse_block(b, dict.as_ref());
                    let _ = g.lint(&doc);
                }
            })
        };
        handle.join().expect("worker thread");
        println!(
            "\n[thread] build group + lint 200 blocks on a worker thread: {:.1} ms",
            ms(t0.elapsed())
        );
    }
    mem("at end");
}

// ---------------------------------------------------------------------------
// Where does the time go? Per-rule cost and first-call (lazy init) cost.

fn group_with_only(dict: &Arc<MergedDictionary>, key: &str) -> LintGroup {
    let mut g = build_group(dict, Dialect::American);
    g.set_all_rules_to(Some(false));
    g.config.set_rule_enabled(key, true);
    g
}

fn rules(args: &[String]) {
    let corpus = args.first().expect("corpus path");
    let sample_n: usize = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(40);
    let blocks = load_blocks(corpus, 50_000);
    let dict = build_dictionary();
    let full = build_group(&dict, Dialect::American);
    let keys: Vec<String> = full
        .iter_keys()
        .filter(|k| full.config.is_rule_enabled(k))
        .map(String::from)
        .collect();

    // First-call cost: lazy statics are cold in a fresh process. Run every rule
    // alone on the first heading, in registry order, and keep the slow ones.
    let heading = blocks
        .iter()
        .find(|b| b.starts_with("## "))
        .cloned()
        .unwrap_or_else(|| "## CHAPTER I.".to_string());
    let t0 = now();
    let hdoc = parse_block(&heading, dict.as_ref());
    println!("first parse of {heading:?}: {:.1} ms", ms(now() - t0));
    let mut first_calls = Vec::new();
    for k in &keys {
        let mut g = group_with_only(&dict, k);
        let t0 = now();
        let _ = g.lint(&hdoc);
        first_calls.push((now() - t0, k.clone()));
    }
    first_calls.sort_by(|a, b| b.0.cmp(&a.0));
    println!("\n[first call per rule on {heading:?}] slowest:");
    for (d, k) in first_calls.iter().take(8) {
        println!("  {:>9.1} ms  {k}", ms(*d));
    }

    // Steady-state per-rule cost over a sample of typical paragraphs, pre-parsed so
    // that only lint time is counted. A fresh single-rule group per paragraph means
    // Harper's chunk/sentence caches never hit.
    let paras: Vec<&String> = blocks
        .iter()
        .filter(|b| !b.starts_with("## ") && (50..=300).contains(&word_count(b)))
        .collect();
    let step = (paras.len() / sample_n).max(1);
    let chosen: Vec<&String> = paras.iter().step_by(step).take(sample_n).copied().collect();
    let words: usize = chosen.iter().map(|b| word_count(b)).sum();
    let t0 = now();
    let docs: Vec<Document> = chosen
        .iter()
        .map(|b| parse_block(b, dict.as_ref()))
        .collect();
    let parse_total = now() - t0;
    println!(
        "\n[sample] {} paragraphs, {} words; parse total {:.1} ms ({:.2} ms/100 words)",
        docs.len(),
        words,
        ms(parse_total),
        ms(parse_total) * 100.0 / words as f64
    );

    let mut all = build_group(&dict, Dialect::American);
    let t0 = now();
    for d in &docs {
        all.lint(d);
    }
    let all_total = now() - t0;
    println!(
        "  all {} rules, one group: {:.1} ms ({:.2} ms/100 words)",
        keys.len(),
        ms(all_total),
        ms(all_total) * 100.0 / words as f64
    );

    let mut per_rule: Vec<(Duration, String)> = Vec::new();
    for k in &keys {
        let mut g = group_with_only(&dict, k);
        let t0 = now();
        for d in &docs {
            let _ = g.lint(d);
        }
        per_rule.push((now() - t0, k.clone()));
    }
    let sum: Duration = per_rule.iter().map(|(d, _)| *d).sum();
    per_rule.sort_by(|a, b| b.0.cmp(&a.0));
    println!(
        "  sum of single-rule runs: {:.1} ms (includes per-call group overhead)",
        ms(sum)
    );
    println!("  slowest rules over the sample:");
    for (d, k) in per_rule.iter().take(15) {
        println!(
            "  {:>9.1} ms  {:>5.1}%  {k}",
            ms(*d),
            100.0 * d.as_secs_f64() / sum.as_secs_f64()
        );
    }

    // What disabling the slowest few would buy.
    for n in [1usize, 5, 10, 20] {
        let mut g = build_group(&dict, Dialect::American);
        for (_, k) in per_rule.iter().take(n) {
            g.config.set_rule_enabled(k, false);
        }
        let t0 = now();
        for d in &docs {
            g.lint(d);
        }
        println!(
            "  without the slowest {n:>2}: {:.1} ms ({:.2} ms/100 words)",
            ms(now() - t0),
            ms(now() - t0) * 100.0 / words as f64
        );
    }
}

/// A/B on typical batches with warm global caches: the full curated group versus the
/// group without Harper's SpellCheck plus a cheap spelling pass that only checks
/// membership (suggestions would be computed on demand, when the popover opens).
fn ab(args: &[String]) {
    use harper_core::TokenStringExt;
    let corpus = args.first().expect("corpus path");
    let blocks = load_blocks(corpus, 50_000);
    let dict = build_dictionary();
    let paragraphs: Vec<usize> = (0..blocks.len())
        .filter(|&i| !blocks[i].starts_with("## "))
        .collect();
    let mut rng = XorShift(0xab_ab_5eed);
    let mut batches: Vec<Vec<usize>> = Vec::new();
    while batches.len() < 150 {
        let start = paragraphs[rng.below(paragraphs.len())];
        let len = 1 + rng.below(3);
        if start + len > blocks.len() {
            continue;
        }
        let ids: Vec<usize> = (start..start + len).collect();
        let w: usize = ids.iter().map(|&i| word_count(&blocks[i])).sum();
        if (100..=400).contains(&w) {
            batches.push(ids);
        }
    }
    // Warm the global caches (dictionary, chunker, levenshtein automata) on everything.
    let mut warm = build_group(&dict, Dialect::American);
    for b in &blocks {
        let _ = warm.lint(&parse_block(b, dict.as_ref()));
    }
    let _ = harper_core::spell::suggest_correct_spelling(&['q', 'x', 'z', 'v', 'k', 'j'], 200, 4, dict.as_ref());

    let mut full = Vec::new();
    let mut lazy = Vec::new();
    let mut words_checked = 0usize;
    for (n, ids) in batches.iter().enumerate() {
        let run_full = |acc: &mut Vec<Duration>| {
            let mut g = build_group(&dict, Dialect::American);
            let t0 = now();
            for &i in ids {
                let _ = g.lint(&parse_block(&blocks[i], dict.as_ref()));
            }
            acc.push(now() - t0);
        };
        let mut run_lazy = |acc: &mut Vec<Duration>| {
            let mut g = build_group(&dict, Dialect::American);
            g.config.set_rule_enabled("SpellCheck", false);
            let t0 = now();
            for &i in ids {
                let doc = parse_block(&blocks[i], dict.as_ref());
                let _ = g.lint(&doc);
                let unknown = doc
                    .iter_words()
                    .filter(|w| {
                        let c = doc.get_span_content(&w.span);
                        !dict.contains_word(c)
                    })
                    .count();
                words_checked += unknown;
            }
            acc.push(now() - t0);
        };
        if n % 2 == 0 {
            run_full(&mut full);
            run_lazy(&mut lazy);
        } else {
            run_lazy(&mut lazy);
            run_full(&mut full);
        }
    }
    println!("[a/b] {} batches of 1–3 paragraphs (100–400 words), fresh group each, warm globals", batches.len());
    Stats::new(full).line("full curated group (Harper SpellCheck)");
    Stats::new(lazy).line("no SpellCheck + membership-only spelling");
    println!("  unknown words found by the membership pass: {words_checked}");
}

/// Cost of an unknown word: SpellCheck computes suggestions inline, backing off to
/// edit distance 4 when nothing is found at 2 or 3.
fn words() {
    use harper_core::spell::suggest_correct_spelling;
    let dict = build_dictionary();
    let _warm = lint_text(&mut build_group(&dict, Dialect::American), &dict, "Warm up the lazy statics.");
    let list = [
        "recieve", "tomorow", "colour", "Bennet", "Argemone", "SAINTSBURY", "Saintsbury",
        "IJMES", "Taymiyya", "Uthmani", "Fātiḥa", "ḥadīth", "isnād", "Raḥmān", "Ḥanbalī",
        "ṭahāra", "Qwertyuiopasdf", "antidisestablishmentarianismus", "bismillah", "autolink",
    ];
    println!("  {:<32} {:>10} {:>12} {:>12} {:>12}", "word", "contains", "lint(Spell)", "suggest d2", "suggest d4");
    for w in list {
        let chars: Vec<char> = w.chars().collect();
        let t0 = now();
        let known = dict.contains_word(&chars);
        let contains = now() - t0;

        let mut g = group_with_only(&dict, "SpellCheck");
        let sentence = format!("The word {w} here.");
        let doc = parse_block(&sentence, dict.as_ref());
        let t0 = now();
        let lints = g.lint(&doc);
        let lint = now() - t0;

        let t0 = now();
        let _ = suggest_correct_spelling(&chars, 200, 2, dict.as_ref());
        let d2 = now() - t0;
        let t0 = now();
        let _ = suggest_correct_spelling(&chars, 200, 4, dict.as_ref());
        let d4 = now() - t0;
        println!(
            "  {:<32} {:>8.3}ms {:>10.1}ms {:>10.1}ms {:>10.1}ms  known={known} lints={}",
            w,
            ms(contains),
            ms(lint),
            ms(d2),
            ms(d4),
            lints.len()
        );
    }
}

/// Lints one block of the corpus repeatedly in a fresh process, to explain outliers.
fn probe(args: &[String]) {
    let corpus = args.first().expect("corpus path");
    let idx: usize = args.get(1).and_then(|s| s.parse().ok()).expect("block index");
    let blocks = load_blocks(corpus, 50_000);
    let dict = build_dictionary();
    let mut group = build_group(&dict, Dialect::American);
    println!("block #{idx}: {:?}", blocks[idx]);
    for round in 0..3 {
        let t0 = now();
        let doc = parse_block(&blocks[idx], dict.as_ref());
        let t1 = now();
        let lints = group.lint(&doc);
        let t2 = now();
        println!(
            "  round {round}: parse {:.1} ms, lint {:.1} ms, {} lints",
            ms(t1 - t0),
            ms(t2 - t1),
            lints.len()
        );
        describe(&blocks[idx], &lints);
    }
    // The same text with a different first word, to see whether it is content-specific.
    let variant = format!("Chapter {}", blocks[idx]);
    let t0 = now();
    let doc = parse_block(&variant, dict.as_ref());
    let _ = group.lint(&doc);
    println!("  variant {variant:?}: {:.1} ms", ms(now() - t0));
}

// ---------------------------------------------------------------------------
// Correctness.

fn describe(text: &str, lints: &[Lint]) {
    let chars: Vec<char> = text.chars().collect();
    for l in lints {
        let span_text: String = chars[l.span.start.min(chars.len())..l.span.end.min(chars.len())]
            .iter()
            .collect();
        let sugg: Vec<String> = l
            .suggestions
            .iter()
            .take(4)
            .map(|s| match s {
                Suggestion::ReplaceWith(c) => format!("→{}", c.iter().collect::<String>()),
                Suggestion::InsertAfter(c) => format!("+{}", c.iter().collect::<String>()),
                Suggestion::Remove => "remove".to_string(),
            })
            .collect();
        println!(
            "    [{:?}] chars {}..{} {:?}: {} | {}",
            l.lint_kind,
            l.span.start,
            l.span.end,
            span_text,
            l.message,
            sugg.join(", ")
        );
    }
}

fn lint_text(group: &mut LintGroup, dict: &Arc<MergedDictionary>, text: &str) -> Vec<Lint> {
    let doc = parse_block(text, dict.as_ref());
    group.lint(&doc)
}

fn specimen(args: &[String]) {
    let path = args.first().expect("specimen path");
    let text = std::fs::read_to_string(path).expect("read specimen");
    let dict = build_dictionary();
    let mut group = build_group(&dict, Dialect::American);
    // Strip the frontmatter: Phase 3 never sends it (ARCHITECTURE.md §7.1).
    let body = text
        .strip_prefix("---\n")
        .and_then(|rest| rest.find("\n---\n").map(|i| &rest[i + 5..]))
        .unwrap_or(&text);
    // Block by block, as the frontend would send them (skipping fenced code).
    let mut in_fence = false;
    for line in body.lines() {
        if line.starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence || line.trim().is_empty() {
            continue;
        }
        let lints = lint_text(&mut group, &dict, line);
        if !lints.is_empty() {
            println!("  {line}");
            describe(line, &lints);
        }
    }
}

fn smoke() {
    let dict = build_dictionary();
    let mut group = build_group(&dict, Dialect::American);
    let cases = [
        // Deliberate mistakes from docs/specimen.md.
        "Spelling: I will recieve the letter tomorow.",
        "Grammar: This is a apple. Their is a problem with the the sentence.",
        // Smart punctuation output (DESIGN.md §11.3).
        "Typed with smart punctuation on, these should read: “quoted”, it’s, 10–12, a pause — then … and so on.",
        "She said “it’s fine” and left — quietly… The pages 10–12 are missing.",
        "He wrote ‘single quotes’ and don’t, can’t, won’t, o’clock.",
        "Straight quotes: \"quoted\", it's, 10-12, a pause -- then ... done.",
        // IJMES transliteration.
        "al-Fātiḥa, Qurʾān, ḥadīth, ʿilm, ṣalāh, ḍalāl, ṭahāra, ẓulm, Ibn Taymiyya, Āl ʿImrān, Ḥanbalī, ʿAbd al-Raḥmān.",
        "The scholars of ḥadīth disagreed about the isnād of this report.",
        // Mixed script (Phase 3 sends only Latin runs, but what happens if Arabic leaks through?).
        "The word أمانة means trust, and زهد is the name of focus mode.",
        "An Arabic phrase with a link: [الصفحة الرئيسية](https://example.com) inside English text.",
        // Emoji and non-BMP characters for the offset-unit question.
        "A smile 😀 then a mistake: recieve.",
        // Markdown inline code and URLs inside one block.
        "Inside code, nothing is flagged: `recieve`, and inside a URL: https://example.com/recieve",
    ];
    for c in cases {
        println!("  {c}");
        let lints = lint_text(&mut group, &dict, c);
        if lints.is_empty() {
            println!("    (no lints)");
        }
        describe(c, &lints);
    }

    // British vs American on the same sentence.
    let mut british = build_group(&dict, Dialect::British);
    let s = "The colour of the organization's favorite theatre.";
    println!("\n  dialect check: {s}");
    println!("   American:");
    describe(s, &lint_text(&mut group, &dict, s));
    println!("   British:");
    describe(s, &lint_text(&mut british, &dict, s));

    mixed_script_strategies(&dict);
    transliteration_dictionary();
}

fn is_arabic(c: char) -> bool {
    matches!(c as u32,
        0x0600..=0x06FF | 0x0750..=0x077F | 0x0870..=0x08FF | 0xFB50..=0xFDFF | 0xFE70..=0xFEFF)
}

/// Allows everything except Arabic-script runs: Harper then sees only Latin text,
/// and lint spans stay in the block's own char offsets.
struct NonArabicMasker;
impl harper_core::Masker for NonArabicMasker {
    fn create_mask(&self, source: &[char]) -> harper_core::Mask {
        let mut mask = harper_core::Mask::new_blank();
        let mut start = None;
        for (i, &c) in source.iter().enumerate() {
            match (is_arabic(c), start) {
                (false, None) => start = Some(i),
                (true, Some(s)) => {
                    mask.push_allowed(harper_core::Span::new(s, i));
                    start = None;
                }
                _ => {}
            }
        }
        if let Some(s) = start {
            mask.push_allowed(harper_core::Span::new(s, source.len()));
        }
        mask
    }
}

/// How should Phase 3 hide Arabic runs from Harper inside an English block?
fn mixed_script_strategies(dict: &Arc<MergedDictionary>) {
    use harper_core::parsers::{Markdown, Mask};
    let mut group = build_group(dict, Dialect::American);
    let lines = [
        "The word أمانة means trust, and زهد is the name of focus mode.",
        "He quoted بسم الله and then continued.",
        "The concept of توحيد is central.",
    ];
    println!("\n  mixed-script strategies");
    for line in lines {
        println!("  {line}");
        println!("   (a) raw:");
        describe(line, &lint_text(&mut group, dict, line));

        println!("   (b) parsers::Mask excluding Arabic runs:");
        let parser = Mask::new(NonArabicMasker, Markdown::default());
        let doc = Document::new(line, &parser, dict.as_ref());
        describe(line, &group.lint(&doc));

        let spaces: String = line
            .chars()
            .map(|c| if is_arabic(c) { ' ' } else { c })
            .collect();
        println!("   (c) Arabic replaced by spaces:");
        describe(&spaces, &lint_text(&mut group, dict, &spaces));

        // One placeholder word per Arabic run, padded to the same char length.
        let mut placeholder = String::new();
        let mut in_run = false;
        for c in line.chars() {
            if is_arabic(c) {
                placeholder.push(if in_run { 'x' } else { 'X' });
                in_run = true;
            } else {
                in_run = false;
                placeholder.push(c);
            }
        }
        println!("   (d) placeholder word (Xxxx) per run:");
        describe(&placeholder, &lint_text(&mut group, dict, &placeholder));
    }
}

/// Can IJMES transliteration be taught to Harper through the personal dictionary?
fn transliteration_dictionary() {
    use harper_core::DictWordMetadata;
    let words = [
        "al",
        "Fātiḥa",
        "Qurʾān",
        "ḥadīth",
        "ʿilm",
        "ṣalāh",
        "ḍalāl",
        "ṭahāra",
        "ẓulm",
        "Ibn",
        "Taymiyya",
        "Āl",
        "ʿImrān",
        "Ḥanbalī",
        "ʿAbd",
        "Raḥmān",
    ];
    let mut personal = MutableDictionary::new();
    for w in words {
        personal.append_word_str(w, DictWordMetadata::default());
    }
    let mut merged = MergedDictionary::new();
    merged.add_dictionary(FstDictionary::curated());
    merged.add_dictionary(Arc::new(personal));
    let dict = Arc::new(merged);
    let mut group = build_group(&dict, Dialect::American);
    let line = "al-Fātiḥa, Qurʾān, ḥadīth, ʿilm, ṣalāh, ḍalāl, ṭahāra, ẓulm, Ibn Taymiyya, Āl ʿImrān, Ḥanbalī, ʿAbd al-Raḥmān.";
    println!("\n  IJMES words added to the personal dictionary:");
    println!("  {line}");
    let lints = lint_text(&mut group, &dict, line);
    if lints.is_empty() {
        println!("    (no lints)");
    }
    describe(line, &lints);

    // How are ʿ (U+02BF) and ʾ (U+02BE) tokenised?
    let doc = parse_block("Qurʾān ʿilm", dict.as_ref());
    let toks: Vec<String> = doc
        .get_tokens()
        .iter()
        .map(|t| format!("{:?}", t.span.get_content_string(doc.get_source())))
        .collect();
    println!("  tokens of \"Qurʾān ʿilm\": {}", toks.join(" "));
}
