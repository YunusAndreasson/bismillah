//! Phase 0 spike: Arabic spelling with the Ayaspell dictionary, spellbook vs Hunspell.
//!
//! Usage (from this directory):
//!   cargo run --release -- bench <spellbook|hunspell> [--strip]
//!   cargo run --release -- oracle          # system `hunspell -a` as reference
//!   cargo run --release -- agree <a.tsv> <b.tsv>
//!
//! Each engine runs in its own process so load time and memory are measured cleanly.

mod speller;

use speller::{ArabicSpeller, Hunspell, Paths, Spellbook, StripIgnore, ignore_chars};
use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::io::Write as _;
use std::process::{Command, Stdio};
use std::time::Duration;

const AFF: &str = "../../dictionaries/ar/ar.aff";
const DIC: &str = "../../dictionaries/ar/ar.dic";

struct Correct {
    word: String,
    category: String,
    policy: bool,
}

struct Miss {
    word: String,
    expected: String,
    kind: String,
    policy: bool,
}

fn rows(path: &str) -> Vec<Vec<String>> {
    let text = std::fs::read_to_string(path).expect("fixture readable");
    text.lines()
        .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
        .skip(1) // header
        .map(|l| l.split('\t').map(str::to_owned).collect())
        .collect()
}

fn fixtures() -> (Vec<Correct>, Vec<Miss>) {
    let get = |r: &Vec<String>, i: usize| r.get(i).cloned().unwrap_or_default();
    let correct = rows("fixtures/correct.tsv")
        .iter()
        .map(|r| Correct {
            word: get(r, 0),
            category: get(r, 1),
            policy: get(r, 2) == "policy",
        })
        .collect();
    let miss = rows("fixtures/misspelled.tsv")
        .iter()
        .map(|r| Miss {
            word: get(r, 0),
            expected: get(r, 1),
            kind: get(r, 2),
            policy: get(r, 3) == "policy",
        })
        .collect();
    (correct, miss)
}

/// CPU time consumed by this thread, so timings survive a busy machine.
fn cpu_now() -> Duration {
    let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    // SAFETY: `ts` is a valid, writable timespec.
    unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut ts) };
    Duration::new(ts.tv_sec as u64, ts.tv_nsec as u32)
}

fn rss_kb(field: &str) -> u64 {
    let status = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
    status
        .lines()
        .find_map(|l| l.strip_prefix(field))
        .and_then(|v| v.split_whitespace().next())
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

fn pct(n: usize, d: usize) -> String {
    if d == 0 {
        "n/a".into()
    } else {
        format!("{:.1}% ({n}/{d})", 100.0 * n as f64 / d as f64)
    }
}

fn percentile(sorted: &[Duration], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let i = ((sorted.len() as f64 - 1.0) * p).round() as usize;
    sorted[i].as_secs_f64() * 1e3
}

fn bench(engine: &str, strip: bool) {
    let paths = Paths { aff: AFF, dic: DIC };
    let aff_text = std::fs::read_to_string(AFF).expect("aff readable");
    let ignore = ignore_chars(&aff_text);
    let (correct, miss) = fixtures();

    let rss0 = rss_kb("VmRSS:");
    let load_cpu0 = cpu_now();
    let (sp, load_ms): (Box<dyn ArabicSpeller>, f64) = match engine {
        "spellbook" => {
            let (s, ms) = Spellbook::load(&paths).unwrap_or_else(|e| panic!("spellbook: {e}"));
            if strip {
                (
                    Box::new(StripIgnore {
                        inner: s,
                        ignore: ignore.clone(),
                    }),
                    ms,
                )
            } else {
                (Box::new(s), ms)
            }
        }
        "hunspell" => {
            let (s, ms) = Hunspell::load(&paths).unwrap_or_else(|e| panic!("hunspell: {e}"));
            if strip {
                (
                    Box::new(StripIgnore {
                        inner: s,
                        ignore: ignore.clone(),
                    }),
                    ms,
                )
            } else {
                (Box::new(s), ms)
            }
        }
        other => panic!("unknown engine {other}"),
    };
    let rss1 = rss_kb("VmRSS:");
    let load_cpu_ms = (cpu_now() - load_cpu0).as_secs_f64() * 1e3;
    let name = format!("{engine}{}", if strip { "+strip" } else { "" });

    let norm = |w: &str| -> String { w.chars().filter(|c| !ignore.contains(c)).collect() };
    let mut detail = String::from("set\tword\taccepted\tsuggestions\tsuggest_ms\n");

    // Correct words.
    let mut by_cat: BTreeMap<&str, (usize, usize)> = BTreeMap::new();
    let (mut ok, mut total, mut pol_ok, mut pol_total) = (0, 0, 0, 0);
    let mut rejected = Vec::new();
    for c in &correct {
        let a = sp.check(&c.word);
        let _ = writeln!(detail, "correct\t{}\t{a}\t", c.word);
        if c.policy {
            pol_total += 1;
            pol_ok += a as usize;
            continue;
        }
        total += 1;
        ok += a as usize;
        let e = by_cat.entry(&c.category).or_default();
        e.0 += a as usize;
        e.1 += 1;
        if !a {
            rejected.push(c.word.clone());
        }
    }

    // Misspellings.
    let (mut det, mut scored, mut top1, mut top5) = (0, 0, 0, 0);
    let (mut pol_flag, mut pol_n, mut real_flag, mut real_n) = (0, 0, 0, 0);
    let mut missed = Vec::new();
    let mut no_hit = Vec::new();
    let mut sug_times = Vec::new();
    let mut by_kind: BTreeMap<&str, (usize, usize, usize)> = BTreeMap::new();
    for m in &miss {
        let flagged = !sp.check(&m.word);
        let (sugs, sug_ms) = if flagged {
            let t = cpu_now();
            let s = sp.suggest(&m.word);
            let d = cpu_now() - t;
            sug_times.push(d);
            (s, d.as_secs_f64() * 1e3)
        } else {
            (Vec::new(), 0.0)
        };
        let _ = writeln!(detail, "miss\t{}\t{}\t{}\t{sug_ms:.1}", m.word, !flagged, sugs.join("|"));
        if m.policy {
            pol_n += 1;
            pol_flag += flagged as usize;
            continue;
        }
        if m.kind == "realword" {
            real_n += 1;
            real_flag += flagged as usize;
            continue;
        }
        scored += 1;
        let want = norm(&m.expected);
        let rank = sugs.iter().position(|s| norm(s) == want);
        let e = by_kind.entry(&m.kind).or_default();
        e.1 += flagged as usize;
        e.2 += 1;
        if flagged {
            det += 1;
            match rank {
                Some(0) => {
                    top1 += 1;
                    top5 += 1;
                    e.0 += 1;
                }
                Some(r) if r < 5 => top5 += 1,
                _ => no_hit.push(format!(
                    "{}→{} [{}]",
                    m.word,
                    m.expected,
                    sugs.iter().take(5).cloned().collect::<Vec<_>>().join("، ")
                )),
            }
        } else {
            missed.push(m.word.clone());
        }
    }

    // Throughput over the whole fixture stream.
    let stream: Vec<&str> = correct
        .iter()
        .map(|c| c.word.as_str())
        .chain(miss.iter().map(|m| m.word.as_str()))
        .collect();
    let t = cpu_now();
    let mut checks = 0usize;
    let mut sink = 0usize;
    while cpu_now() - t < Duration::from_secs(2) {
        for w in &stream {
            sink += sp.check(w) as usize;
        }
        checks += stream.len();
    }
    let wps = checks as f64 / (cpu_now() - t).as_secs_f64();
    std::hint::black_box(sink);

    sug_times.sort();
    let hwm = rss_kb("VmHWM:");

    println!("## {name}");
    println!(
        "load: {load_ms:.0} ms wall, {load_cpu_ms:.0} ms CPU; RSS {} → {} MiB (+{}), peak {} MiB",
        rss0 / 1024,
        rss1 / 1024,
        (rss1 - rss0) / 1024,
        hwm / 1024
    );
    println!(
        "correct accepted: {}  (policy rows accepted {pol_ok}/{pol_total})",
        pct(ok, total)
    );
    for (cat, (a, n)) in &by_cat {
        if a != n {
            println!("  {cat}: {a}/{n}");
        }
    }
    println!("rejected correct: {}", rejected.join(" "));
    println!(
        "misspellings flagged: {}  (policy rows flagged {pol_flag}/{pol_n}; real-word rows flagged {real_flag}/{real_n})",
        pct(det, scored)
    );
    println!(
        "suggestion top-1: {}  top-5: {}  (of all scored misspellings)",
        pct(top1, scored),
        pct(top5, scored)
    );
    println!(
        "suggestion top-1 of flagged: {}  top-5 of flagged: {}",
        pct(top1, det),
        pct(top5, det)
    );
    for (k, (t1, f, n)) in &by_kind {
        println!("  {k}: flagged {f}/{n}, top-1 {t1}");
    }
    println!("missed misspellings: {}", missed.join(" "));
    println!("check throughput: {:.0} words per CPU-second", wps);
    println!(
        "suggest CPU time (n={}): p50 {:.1} ms, p95 {:.1} ms, max {:.1} ms, total {:.2} s",
        sug_times.len(),
        percentile(&sug_times, 0.5),
        percentile(&sug_times, 0.95),
        percentile(&sug_times, 1.0),
        sug_times.iter().map(Duration::as_secs_f64).sum::<f64>()
    );
    println!("no expected suggestion in top 5:");
    for n in &no_hit {
        println!("  {n}");
    }
    std::fs::create_dir_all("results").ok();
    std::fs::write(format!("results/{name}.tsv"), detail).expect("write results");
}

/// Runs the system `hunspell -a` CLI over every fixture word.
fn oracle() {
    let (correct, miss) = fixtures();
    let words: Vec<(&str, &str)> = correct
        .iter()
        .map(|c| ("correct", c.word.as_str()))
        .chain(miss.iter().map(|m| ("miss", m.word.as_str())))
        .collect();
    let mut child = Command::new("hunspell")
        .args(["-d", "../../dictionaries/ar/ar", "-a", "-i", "utf-8"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("hunspell CLI");
    let mut input = String::new();
    for (_, w) in &words {
        // `^` stops the CLI from reading a leading character as a command.
        let _ = writeln!(input, "^{w}");
    }
    let mut stdin = child.stdin.take().expect("stdin");
    let feeder = std::thread::spawn(move || stdin.write_all(input.as_bytes()));
    let out = child.wait_with_output().expect("hunspell output");
    feeder.join().ok();
    let text = String::from_utf8_lossy(&out.stdout);
    let blocks: Vec<&str> = text
        .split("\n\n")
        .map(|b| b.trim_start_matches(|c| c == '\n'))
        .collect();
    // The first line is the version banner.
    let blocks: Vec<&str> = blocks
        .iter()
        .map(|b| {
            b.lines()
                .filter(|l| !l.starts_with("@(#)"))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .map(|s| Box::leak(s.into_boxed_str()) as &str)
        .collect();
    let mut detail = String::from("set\tword\taccepted\tsuggestions\n");
    let mut split = 0;
    for (i, (set, w)) in words.iter().enumerate() {
        let b = blocks.get(i).copied().unwrap_or("");
        let lines: Vec<&str> = b.lines().collect();
        if lines.len() != 1 {
            split += 1;
        }
        let accepted = lines
            .iter()
            .all(|l| l.starts_with('*') || l.starts_with('+') || l.starts_with('-'));
        let sugs = lines
            .iter()
            .find_map(|l| {
                l.strip_prefix('&')
                    .and_then(|r| r.split_once(": "))
                    .map(|(_, s)| s.replace(", ", "|"))
            })
            .unwrap_or_default();
        let _ = writeln!(detail, "{set}\t{w}\t{accepted}\t{sugs}");
    }
    std::fs::create_dir_all("results").ok();
    std::fs::write("results/oracle.tsv", detail).expect("write");
    println!(
        "oracle: {} words, {split} split into several tokens by the CLI",
        words.len()
    );
}

/// Compares accept/reject and suggestion lists between two result files.
fn agree(a: &str, b: &str) {
    let load = |p: &str| -> Vec<Vec<String>> {
        std::fs::read_to_string(p)
            .expect("results")
            .lines()
            .skip(1)
            .map(|l| l.split('\t').map(str::to_owned).collect())
            .collect()
    };
    let (ra, rb) = (load(a), load(b));
    let (mut same, mut sug_same, mut flagged_both) = (0, 0, 0);
    let mut diffs = Vec::new();
    for (x, y) in ra.iter().zip(&rb) {
        if x[2] == y[2] {
            same += 1;
        } else {
            diffs.push(format!("{}:{} {}={} {}={}", x[0], x[1], a, x[2], b, y[2]));
        }
        if x[2] == "false" && y[2] == "false" && x[0] == "miss" {
            flagged_both += 1;
            let top = |s: &str| s.split('|').next().unwrap_or("").to_owned();
            sug_same += (top(&x[3]) == top(&y[3])) as usize;
        }
    }
    println!("accept/reject agreement: {}/{}", same, ra.len());
    println!("same top suggestion where both flagged a misspelling: {sug_same}/{flagged_both}");
    for d in diffs {
        println!("  {d}");
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("bench") => bench(
            args.get(1).map(String::as_str).unwrap_or("spellbook"),
            args.iter().any(|a| a == "--strip"),
        ),
        Some("oracle") => oracle(),
        Some("agree") => agree(&args[1], &args[2]),
        _ => eprintln!("usage: bench <spellbook|hunspell> [--strip] | oracle | agree <a> <b>"),
    }
}
