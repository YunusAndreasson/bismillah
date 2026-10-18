//! The checker's contract beyond the fixtures: suggestions, the personal dictionary,
//! the session cache, and corrections that would cross Markdown marks.

use std::time::Duration;

use bismillah_lint::{Block, CHECK_LIMIT, Dialect, GRAMMAR_LIMIT, Kind, Lang, Linter, Options};

fn options() -> Options {
    Options {
        spelling: true,
        grammar: true,
        dialect: Dialect::British,
        lang: None,
    }
}

fn block(text: &str) -> Block {
    Block {
        text: text.into(),
        ..Default::default()
    }
}

#[test]
fn suggests_english_corrections_on_request_in_the_word_case() {
    let mut linter = Linter::new(Vec::new());
    let found = linter.check(&block("I will recieve it."), &options());
    assert_eq!(found.len(), 1);
    assert!(found[0].suggestions.is_empty(), "computed only on request");
    let suggester = linter.suggester();
    let budget = Duration::from_secs(1);
    let lower = suggester.suggest("recieve", Lang::En, Dialect::British, budget);
    assert_eq!(lower.first().map(String::as_str), Some("receive"));
    let capital = suggester.suggest("Recieve", Lang::En, Dialect::British, budget);
    assert_eq!(capital.first().map(String::as_str), Some("Receive"));
    // Only words of the writer's dialect are offered.
    let british = suggester.suggest("favourit", Lang::En, Dialect::British, budget);
    assert!(british.contains(&"favourite".to_string()), "{british:?}");
    assert!(!british.contains(&"favorite".to_string()), "{british:?}");
    let american = suggester.suggest("favourit", Lang::En, Dialect::American, budget);
    assert!(!american.contains(&"favourite".to_string()), "{american:?}");
}

#[test]
fn suggests_arabic_corrections_within_the_budget() {
    let linter = Linter::new(Vec::new());
    let suggester = linter.suggester();
    let found = suggester.suggest("كتابب", Lang::Ar, Dialect::British, Duration::from_secs(5));
    assert!(found.contains(&"كتاب".to_string()), "{found:?}");
    // A vocalised misspelling gets the same corrections (the IGNORE adapter).
    let vocalised = suggester.suggest("كِتَابَب", Lang::Ar, Dialect::British, Duration::from_secs(5));
    assert!(vocalised.contains(&"كتاب".to_string()), "{vocalised:?}");
    // The built-in correction comes first and needs no search at all.
    let listed = suggester.suggest("حتي", Lang::Ar, Dialect::British, Duration::ZERO);
    assert_eq!(listed, ["حتى"]);
}

#[test]
fn a_new_personal_word_is_never_served_from_the_cache() {
    let mut linter = Linter::new(Vec::new());
    let text = block("Ibn Taymiyya wrote it.");
    assert_eq!(linter.check(&text, &options()).len(), 2);
    linter.set_personal(vec!["Taymiyya".into()]);
    let found = linter.check(&text, &options());
    assert_eq!(found.len(), 1);
    assert_eq!((found[0].from_utf16, found[0].to_utf16), (0, 3));
    // Suggestions see the writer's words too.
    let near = linter.suggester().suggest(
        "Taymiya",
        Lang::En,
        Dialect::British,
        Duration::from_secs(1),
    );
    assert!(near.contains(&"Taymiyya".to_string()), "{near:?}");
}

#[test]
fn the_same_block_with_other_settings_is_checked_again() {
    let mut linter = Linter::new(Vec::new());
    let text = block("The color was gray.");
    assert_eq!(linter.check(&text, &options()).len(), 2);
    let american = Options {
        dialect: Dialect::American,
        ..options()
    };
    assert!(linter.check(&text, &american).is_empty());
    let off = Options {
        spelling: false,
        ..options()
    };
    assert!(linter.check(&text, &off).is_empty());
}

#[test]
fn a_correction_that_would_delete_marks_is_not_offered() {
    let mut linter = Linter::new(Vec::new());
    // "the **the** sentence": replacing "the the" would drop the asterisks.
    let text = "It is the **the** sentence.";
    let marks = vec![[10, 12], [15, 17]];
    let found = linter.check(
        &Block {
            text: text.into(),
            skip: Vec::new(),
            marks,
        },
        &options(),
    );
    let repeated = found
        .iter()
        .find(|d| d.kind == Kind::Grammar)
        .expect("the repetition is still pointed out");
    assert!(repeated.suggestions.is_empty(), "{repeated:?}");
    // Without marks inside, the correction is offered.
    let plain = linter.check(&block("It is the the sentence."), &options());
    assert_eq!(plain[0].suggestions, ["the"]);
}

#[test]
fn a_grammar_hint_on_a_misspelled_word_joins_its_corrections() {
    let mut linter = Linter::new(Vec::new());
    let found = linter.check(&block("A blockquote is set apart."), &options());
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(found[0].kind, Kind::Spelling);
    assert_eq!(found[0].suggestions, ["block quote"]);
}

#[test]
fn grammar_messages_and_rules_come_from_harper() {
    let mut linter = Linter::new(Vec::new());
    let found = linter.check(&block("This is a apple."), &options());
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].rule_id, "AnA");
    assert_eq!(found[0].lang, Lang::En);
    assert!(!found[0].message.is_empty());
    assert_eq!(found[0].suggestions, ["an"]);
}

#[test]
fn diagnostics_serialise_as_the_frontend_reads_them() {
    let mut linter = Linter::new(Vec::new());
    let found = linter.check(&block("A recieve."), &options());
    let json = serde_json::to_value(&found[0]).expect("serialisable");
    assert_eq!(json["kind"], "spelling");
    assert_eq!(json["lang"], "en");
    assert_eq!(json["from_utf16"], 2);
    assert_eq!(json["to_utf16"], 9);
}

#[test]
fn a_huge_block_gets_spelling_only_and_a_giant_one_nothing() {
    let mut linter = Linter::new(Vec::new());
    let sentence = "This is a apple and I recieve it. ";
    let repeat = |units: u32| sentence.repeat(units as usize / sentence.len() + 1);
    let huge = linter.check(&block(&repeat(GRAMMAR_LIMIT)), &options());
    assert!(!huge.is_empty());
    assert!(huge.iter().all(|d| d.kind == Kind::Spelling));
    assert!(
        linter
            .check(&block(&repeat(CHECK_LIMIT)), &options())
            .is_empty()
    );
}
