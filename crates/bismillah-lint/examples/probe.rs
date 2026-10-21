//! Prints what the checker flags in each line of a text file (one block per line), for
//! exploring rules and fixtures: `cargo run -p bismillah-lint --release --example probe -- FILE [lang]`.

use bismillah_lint::{Block, Dialect, Kind, Linter, Options};
use std::time::Instant;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let path = args.next().ok_or("expected a file to check")?;
    let lang = args.next();
    let text = std::fs::read_to_string(&path)?;
    let mut linter = Linter::new(Vec::new());
    let options = Options {
        spelling: true,
        grammar: true,
        dialect: Dialect::British,
        lang,
    };
    let t = Instant::now();
    linter.warm_up(Dialect::British);
    eprintln!("warm-up {:?}", t.elapsed());
    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        let t = Instant::now();
        let found = linter.check(
            &Block {
                text: line.to_string(),
                ..Default::default()
            },
            &options,
        );
        let units: Vec<u16> = line.encode_utf16().collect();
        if found.is_empty() {
            continue;
        }
        println!("{line}  ({:?})", t.elapsed());
        for d in found {
            let flagged =
                String::from_utf16_lossy(&units[d.from_utf16 as usize..d.to_utf16 as usize]);
            let kind = if d.kind == Kind::Spelling {
                "SPELL"
            } else {
                "GRAMMAR"
            };
            println!(
                "   {kind} {flagged:?} [{}] {} → {:?}",
                d.rule_id, d.message, d.suggestions
            );
        }
    }
    Ok(())
}
