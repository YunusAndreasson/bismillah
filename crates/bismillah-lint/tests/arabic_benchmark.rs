//! The Phase 0 Arabic benchmark (docs/spikes/arabic-speller.md) as a regression test:
//! 414 correctly spelled words and 157 realistic misspellings, in `tests/fixtures/`.
//! It catches a `spellbook` or dictionary upgrade that changes verdicts, and the system
//! `hunspell` CLI, where installed, serves as an independent oracle.

#![allow(
    clippy::expect_used,
    reason = "invalid bundled fixtures should fail the test"
)]

use std::collections::HashSet;
use std::io::Write;
use std::process::{Command, Stdio};
use std::time::Duration;

use bismillah_lint::arabic::{Arabic, common_fix, strip_ignored};

struct Row {
    word: String,
    expected: String,
    kind: String,
    policy: bool,
}

/// Rows of a benchmark TSV (comments and the header skipped).
fn rows(name: &str) -> Vec<Row> {
    let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(path)
        .expect("fixture")
        .lines()
        .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
        .skip(1)
        .map(|l| {
            let cols: Vec<&str> = l.split('\t').collect();
            let col = |i: usize| cols.get(i).copied().unwrap_or_default().to_string();
            if name.contains("correct") {
                Row {
                    word: col(0),
                    expected: col(0),
                    kind: col(1),
                    policy: col(2) == "policy",
                }
            } else {
                Row {
                    word: col(0),
                    expected: col(1),
                    kind: col(2),
                    policy: col(3) == "policy",
                }
            }
        })
        .collect()
}

/// Misspellings Ayaspell's affix rules accept and the built-in list doesn't name,
/// because each could be a real word or the list would need a guess (finding 1 in the
/// spike). A change here is a change in what bismillah catches: review it.
const KNOWN_MISSES: &[&str] = &[
    "مكتلة",
    "رسلة",
    "معلمن",
    "لدية",
    "كزلك",
    "دهب",
    "تعلب",
    "كدب",
    "حطأ",
    "أحلاق",
    "اشمس",
];

#[test]
fn accepts_every_correct_word() {
    let arabic = Arabic::bundled().expect("bundled dictionary");
    let refused: Vec<String> = rows("arabic-correct.tsv")
        .iter()
        .filter(|r| !arabic.check(&r.word))
        .map(|r| format!("{} ({})", r.word, r.kind))
        .collect();
    assert!(refused.is_empty(), "correct words flagged: {refused:?}");
}

#[test]
fn flags_misspellings_apart_from_the_known_misses() {
    let arabic = Arabic::bundled().expect("bundled dictionary");
    let scored: Vec<Row> = rows("arabic-misspelled.tsv")
        .into_iter()
        .filter(|r| r.kind != "realword" && !r.policy)
        .collect();
    let missed: Vec<&str> = scored
        .iter()
        .filter(|r| arabic.check(&r.word))
        .map(|r| r.word.as_str())
        .collect();
    assert_eq!(missed, KNOWN_MISSES, "misspellings accepted");
    // Bare alef for أ/إ is flagged: Ayaspell spells hamza strictly (finding 2).
    let bare_alef = rows("arabic-misspelled.tsv")
        .into_iter()
        .filter(|r| r.policy && r.kind == "hamza")
        .filter(|r| !arabic.check(&r.word))
        .count();
    assert!(bare_alef >= 8, "bare alef flagged {bare_alef} of 10");
}

#[test]
fn suggests_the_intended_word_for_most_misspellings() {
    let arabic = Arabic::bundled().expect("bundled dictionary");
    let flagged: Vec<Row> = rows("arabic-misspelled.tsv")
        .into_iter()
        .filter(|r| r.kind != "realword" && !r.policy && !arabic.check(&r.word))
        .collect();
    let ignore = arabic.ignore().to_vec();
    // A generous budget: this measures the suggestions, not the machine's load.
    let hits = flagged
        .iter()
        .filter(|r| {
            let want = strip_ignored(&r.expected, &ignore);
            arabic
                .suggest(&r.word, Duration::from_secs(5))
                .iter()
                .any(|s| strip_ignored(s, &ignore) == want)
        })
        .count();
    let rate = hits as f64 / flagged.len() as f64;
    // Phase 0: 82.8% in the top five with the IGNORE adapter; the built-in list adds more.
    assert!(
        rate >= 0.8,
        "intended word among the suggestions for {hits} of {}",
        flagged.len()
    );
}

/// Each word as `hunspell -l` judges it: true for correct. `None` without hunspell.
fn hunspell_verdicts(words: &[String]) -> Option<Vec<bool>> {
    let dictionary = format!("{}/../../dictionaries/ar/ar", env!("CARGO_MANIFEST_DIR"));
    let mut child = Command::new("hunspell")
        .args(["-d", &dictionary, "-l", "-i", "utf-8"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let input: String = words.iter().map(|w| format!("{w}\n")).collect();
    child.stdin.take()?.write_all(input.as_bytes()).ok()?;
    let output = child.wait_with_output().ok()?;
    output.status.success().then_some(())?;
    // `-l` lists the misspelled words.
    let text = String::from_utf8(output.stdout).ok()?;
    let misspelled: HashSet<&str> = text.lines().collect();
    Some(
        words
            .iter()
            .map(|w| !misspelled.contains(w.as_str()))
            .collect(),
    )
}

#[test]
fn agrees_with_the_hunspell_oracle() {
    let arabic = Arabic::bundled().expect("bundled dictionary");
    let ignore = arabic.ignore().to_vec();
    let words: Vec<String> = rows("arabic-correct.tsv")
        .into_iter()
        .chain(rows("arabic-misspelled.tsv"))
        .map(|r| strip_ignored(&r.word, &ignore))
        .collect();
    let Some(oracle) = hunspell_verdicts(&words) else {
        eprintln!("hunspell isn't installed: skipping the oracle comparison");
        return;
    };
    let refused = oracle.iter().filter(|v| !**v).count();
    assert!(
        refused > 100,
        "the oracle refused only {refused} words: is it running?"
    );
    // The built-in list deliberately refuses a few words both engines accept.
    let disagree: Vec<&String> = words
        .iter()
        .zip(oracle)
        .filter(|(w, verdict)| arabic.check(w) != *verdict && common_fix(w).is_none())
        .map(|(w, _)| w)
        .collect();
    assert!(
        disagree.is_empty(),
        "spellbook and hunspell disagree on {disagree:?}"
    );
}
