//! The fixture suites (PLAN.md, Phase 3 acceptance): English, Arabic with and without
//! diacritics, mixed text, masked regions and routing. Each `.txt` file in
//! `tests/fixtures/` holds one block per line:
//!
//! - `⟦…⟧` must be flagged as a spelling mistake and `⟪…⟫` as a grammar suggestion;
//!   nothing else in the line may be flagged.
//! - `⦃…⦄` is a range the editor skips (code, URLs) and `⦅…⦆` a Markdown mark, as the
//!   editor would send them (`src/editor/lintBlocks.ts`).
//! - `@lang TAG` (or `@lang` alone), `@dialect NAME`, `@personal WORD…` and
//!   `@off spelling|grammar` (or `@on`) apply to the lines after them.
//! - `#` starts a comment line.

#![allow(
    clippy::expect_used,
    reason = "invalid bundled fixtures should fail the test"
)]

use bismillah_lint::{Block, Dialect, Kind, Linter, Options};

/// One fixture line without its markers, with the ranges they marked (UTF-16 units).
struct Line {
    text: String,
    skip: Vec<[u32; 2]>,
    marks: Vec<[u32; 2]>,
    expected: Vec<(u32, u32, Kind)>,
}

fn parse(line: &str) -> Line {
    let mut text = String::new();
    let mut at = 0u32;
    let (mut skip, mut marks, mut expected) = (Vec::new(), Vec::new(), Vec::new());
    let mut open: Vec<(char, u32)> = Vec::new();
    for c in line.chars() {
        match c {
            '⟦' | '⟪' | '⦃' | '⦅' => open.push((c, at)),
            '⟧' | '⟫' | '⦄' | '⦆' => {
                let opener = match c {
                    '⟧' => '⟦',
                    '⟫' => '⟪',
                    '⦄' => '⦃',
                    _ => '⦅',
                };
                let index = open
                    .iter()
                    .rposition(|(o, _)| *o == opener)
                    .unwrap_or_else(|| panic!("unmatched {c} in {line}"));
                let (_, from) = open.remove(index);
                match c {
                    '⟧' => expected.push((from, at, Kind::Spelling)),
                    '⟫' => expected.push((from, at, Kind::Grammar)),
                    '⦄' => skip.push([from, at]),
                    _ => marks.push([from, at]),
                }
            }
            _ => {
                text.push(c);
                at += c.len_utf16() as u32;
            }
        }
    }
    assert!(open.is_empty(), "unclosed marker in {line}");
    Line {
        text,
        skip,
        marks,
        expected,
    }
}

fn run(name: &str) {
    let path = format!("{}/tests/fixtures/{name}.txt", env!("CARGO_MANIFEST_DIR"));
    let source = std::fs::read_to_string(&path).expect("fixture file");
    let mut linter = Linter::new(Vec::new());
    let mut options = Options {
        spelling: true,
        grammar: true,
        dialect: Dialect::British,
        lang: None,
    };
    let mut failures = Vec::new();
    for (number, line) in source.lines().enumerate() {
        let line = line.trim_end();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(rest) = line.strip_prefix('@') {
            let mut words = rest.split_whitespace();
            match (words.next(), words.next()) {
                (Some("lang"), tag) => options.lang = tag.map(str::to_string),
                (Some("dialect"), Some(d)) => {
                    options.dialect = serde_json::from_str(&format!("\"{d}\"")).expect("dialect")
                }
                (Some("personal"), first) => linter
                    .set_personal(first.into_iter().chain(words).map(str::to_string).collect()),
                (Some("off"), Some("spelling")) => options.spelling = false,
                (Some("off"), Some("grammar")) => options.grammar = false,
                (Some("on"), None) => (options.spelling, options.grammar) = (true, true),
                _ => panic!("{name}.txt:{}: unknown directive {line}", number + 1),
            }
            continue;
        }
        let Line {
            text,
            skip,
            marks,
            expected,
        } = parse(line);
        let found = linter.check(
            &Block {
                text: text.clone(),
                skip,
                marks,
            },
            &options,
        );
        let units: Vec<u16> = text.encode_utf16().collect();
        let show = |from: u32, to: u32, kind: Kind| {
            let flagged = String::from_utf16_lossy(&units[from as usize..to as usize]);
            format!("{kind:?} {flagged:?} @{from}..{to}")
        };
        let mut want: Vec<String> = expected.iter().map(|(f, t, k)| show(*f, *t, *k)).collect();
        let mut got: Vec<String> = found
            .iter()
            .map(|d| {
                let s = show(d.from_utf16, d.to_utf16, d.kind);
                if d.kind == Kind::Grammar {
                    format!("{s} [{}] → {:?}", d.rule_id, d.suggestions)
                } else {
                    s
                }
            })
            .collect();
        let plain: Vec<String> = found
            .iter()
            .map(|d| show(d.from_utf16, d.to_utf16, d.kind))
            .collect();
        want.sort();
        let mut plain_sorted = plain.clone();
        plain_sorted.sort();
        got.sort();
        if want != plain_sorted {
            failures.push(format!(
                "{name}.txt:{}: {text}\n    expected {want:?}\n    found    {got:?}",
                number + 1
            ));
        }
    }
    assert!(failures.is_empty(), "\n{}\n", failures.join("\n"));
}

#[test]
fn english() {
    run("english");
}

#[test]
fn arabic() {
    run("arabic");
}

#[test]
fn mixed() {
    run("mixed");
}

#[test]
fn masked() {
    run("masked");
}

#[test]
fn routing() {
    run("routing");
}
