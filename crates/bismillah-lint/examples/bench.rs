//! Measures the checker as the app uses it (ARCHITECTURE.md §14: lint results within
//! 500 ms of a typing pause): a first pass over a long document, then one edited
//! paragraph at a time, the way the editor sends a changed block.
//!
//! `cargo run -p bismillah-lint --release --example bench -- CORPUS.txt [words]`
//! with any long plain-text file (the Phase 0 spike used Project Gutenberg texts).

use std::time::{Duration, Instant};

use bismillah_lint::{Block, Dialect, Linter, Options};

fn rss_mib() -> f64 {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| {
            s.lines().find(|l| l.starts_with("VmRSS:")).and_then(|l| {
                l.split_whitespace()
                    .nth(1)
                    .and_then(|kb| kb.parse::<f64>().ok())
            })
        })
        .map_or(0.0, |kb| kb / 1024.0)
}

fn percentile(sorted: &[Duration], p: f64) -> f64 {
    let i = ((sorted.len() as f64 - 1.0) * p).round() as usize;
    sorted[i].as_secs_f64() * 1e3
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let path = args.next().ok_or("expected a corpus file")?;
    let limit: usize = args.next().and_then(|n| n.parse().ok()).unwrap_or(50_000);
    let text = std::fs::read_to_string(&path)?.replace("\r\n", "\n");
    // Paragraphs: blank-line separated, joined lines, up to `limit` words.
    let mut paragraphs = Vec::new();
    let mut words = 0;
    for p in text.split("\n\n") {
        let p = p.split_whitespace().collect::<Vec<_>>().join(" ");
        if p.is_empty() {
            continue;
        }
        words += p.split(' ').count();
        paragraphs.push(p);
        if words >= limit {
            break;
        }
    }
    let options = Options {
        spelling: true,
        grammar: true,
        dialect: Dialect::British,
        lang: None,
    };
    let block = |text: &str| Block {
        text: text.to_string(),
        ..Default::default()
    };
    let before = rss_mib();
    let mut linter = Linter::new(Vec::new());
    let t = Instant::now();
    linter.warm_up(Dialect::British);
    println!(
        "warm-up: {:.0} ms, RSS {:.0} → {:.0} MiB",
        t.elapsed().as_secs_f64() * 1e3,
        before,
        rss_mib()
    );

    let t = Instant::now();
    let mut found = 0;
    for p in &paragraphs {
        found += linter.check(&block(p), &options).len();
    }
    println!(
        "first pass: {} paragraphs, {} words, {:.1} s, {} diagnostics, RSS {:.0} MiB",
        paragraphs.len(),
        words,
        t.elapsed().as_secs_f64(),
        found,
        rss_mib()
    );

    // A typing pause: one paragraph, one word changed (never in the cache).
    let mut times = Vec::new();
    let mut seed = 0x5eed_u64;
    for round in 0..300 {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        let p = &paragraphs[(seed as usize) % paragraphs.len()];
        let edited = format!("{p} edit{round}");
        let t = Instant::now();
        let _ = linter.check(&block(&edited), &options);
        times.push(t.elapsed());
    }
    times.sort();
    println!(
        "one edited paragraph: p50 {:.1} ms, p95 {:.1} ms, max {:.1} ms",
        percentile(&times, 0.5),
        percentile(&times, 0.95),
        percentile(&times, 1.0)
    );

    // Reopening: every paragraph again, served from the session cache.
    let t = Instant::now();
    for p in &paragraphs {
        let _ = linter.check(&block(p), &options);
    }
    println!(
        "second pass (cached): {:.0} ms",
        t.elapsed().as_secs_f64() * 1e3
    );
    Ok(())
}
