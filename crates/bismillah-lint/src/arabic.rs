//! Arabic spelling (ADR-0004, ARCHITECTURE.md §7.3): `spellbook` with the bundled
//! Ayaspell dictionary, behind the [`ArabicSpeller`] trait so the engine can be swapped.
//!
//! Lookups work on a temporary copy of each word without the dictionary's `IGNORE`
//! marks (harakat, tatweel, dagger alif), read from the `.aff` file. Nothing else is
//! folded: alef and hamza forms stay as written, because folding them would hide real
//! mistakes. The text itself is never touched; a diagnostic keeps the word's own range.

use std::sync::{Arc, mpsc};
use std::time::Duration;

/// An Arabic spelling engine. Words arrive already stripped of the ignored marks.
pub trait ArabicSpeller: Send + Sync {
    fn check(&self, word: &str) -> bool;
    /// Corrections; `thorough` also searches by similarity across the whole word list,
    /// which can take a second for a long word (docs/spikes/arabic-speller.md).
    fn suggest(&self, word: &str, thorough: bool) -> Vec<String>;
}

pub struct Spellbook(spellbook::Dictionary);

impl ArabicSpeller for Spellbook {
    fn check(&self, word: &str) -> bool {
        self.0.check(word)
    }

    fn suggest(&self, word: &str, thorough: bool) -> Vec<String> {
        let mut out = Vec::new();
        self.0
            .suggester()
            .with_ngram_suggestions(thorough)
            .suggest(word, &mut out);
        out
    }
}

/// The marks on the `.aff` file's `IGNORE` line.
pub fn ignore_chars(aff: &str) -> Vec<char> {
    aff.lines()
        .find_map(|l| l.strip_prefix("IGNORE"))
        .map(|rest| rest.trim().chars().collect())
        .unwrap_or_default()
}

/// A copy of `word` without the ignored marks.
pub fn strip_ignored(word: &str, ignore: &[char]) -> String {
    word.chars().filter(|c| !ignore.contains(c)).collect()
}

/// Misspellings Ayaspell's affix rules accept by accident, with their corrections
/// (docs/spikes/arabic-speller.md, finding 1). Only forms that are no word in any
/// reading; real words such as لدية ("for blood money") or مدرسه ("his teacher") are
/// left alone, because no speller can tell them from a slip.
const COMMON: &[(&str, &str)] = &[
    ("حتي", "حتى"),
    ("متي", "متى"),
    ("مستشفي", "مستشفى"),
    ("مصطفي", "مصطفى"),
    ("موسي", "موسى"),
    ("شيئ", "شيء"),
    ("ضوئ", "ضوء"),
    ("أسألة", "أسئلة"),
    ("الحياه", "الحياة"),
    ("عندة", "عنده"),
    ("قالو", "قالوا"),
    ("ذالك", "ذلك"),
    ("هاذا", "هذا"),
    ("هاذه", "هذه"),
    ("لاكن", "لكن"),
    ("الرحمان", "الرحمن"),
    ("إلاه", "إله"),
];

/// The correction for a known misspelling, also after the conjunction و or ف.
pub fn common_fix(stripped: &str) -> Option<String> {
    let find = |w: &str| COMMON.iter().find(|(m, _)| *m == w).map(|(_, fix)| *fix);
    if let Some(fix) = find(stripped) {
        return Some(fix.to_string());
    }
    let rest = stripped
        .strip_prefix('و')
        .or_else(|| stripped.strip_prefix('ف'))?;
    let conjunction = &stripped[..stripped.len() - rest.len()];
    find(rest).map(|fix| format!("{conjunction}{fix}"))
}

const BUNDLED_AFF: &str = include_str!("../../../dictionaries/ar/ar.aff");
const BUNDLED_DIC: &str = include_str!("../../../dictionaries/ar/ar.dic");

/// At most this many corrections are offered.
const MAX_SUGGESTIONS: usize = 5;

pub struct Arabic {
    speller: Arc<dyn ArabicSpeller>,
    ignore: Vec<char>,
}

impl Arabic {
    /// Parses a Hunspell dictionary: about half a second for Ayaspell, so never on the
    /// launch path (it loads on the first Arabic word that needs checking).
    pub fn load(aff: &str, dic: &str) -> Result<Self, String> {
        let dictionary = spellbook::Dictionary::new(aff, dic).map_err(|e| format!("{e:?}"))?;
        Ok(Arabic {
            speller: Arc::new(Spellbook(dictionary)),
            ignore: ignore_chars(aff),
        })
    }

    /// The Ayaspell dictionary bundled in the binary (dictionaries/ar/).
    pub fn bundled() -> Result<Self, String> {
        Self::load(BUNDLED_AFF, BUNDLED_DIC)
    }

    /// The bundled dictionary's ignored marks, without loading it.
    pub fn bundled_ignore() -> Vec<char> {
        ignore_chars(BUNDLED_AFF)
    }

    pub fn ignore(&self) -> &[char] {
        &self.ignore
    }

    /// Whether a word, as written (vocalised or not), is spelled correctly. The
    /// personal dictionary is the caller's to check first.
    pub fn check(&self, word: &str) -> bool {
        let stripped = strip_ignored(word, &self.ignore);
        common_fix(&stripped).is_none() && self.speller.check(&stripped)
    }

    /// Corrections for a word, found within `budget`. The quick search runs first and the
    /// thorough one only if it finds nothing; whatever hasn't finished in time is left
    /// out, so the popover never waits long.
    pub fn suggest(&self, word: &str, budget: Duration) -> Vec<String> {
        let stripped = strip_ignored(word, &self.ignore);
        let mut out: Vec<String> = common_fix(&stripped).into_iter().collect();
        let speller = Arc::clone(&self.speller);
        let (tx, rx) = mpsc::channel();
        let query = stripped.clone();
        let spawned = std::thread::Builder::new()
            .name("bismillah-arabic-suggest".into())
            .spawn(move || {
                let quick = speller.suggest(&query, false);
                let found = if quick.is_empty() {
                    speller.suggest(&query, true)
                } else {
                    quick
                };
                let _ = tx.send(found);
            });
        if spawned.is_ok()
            && let Ok(found) = rx.recv_timeout(budget)
        {
            for s in found {
                if s != stripped && !out.contains(&s) {
                    out.push(s);
                }
            }
        }
        out.truncate(MAX_SUGGESTIONS);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_ignored_marks_from_the_aff_file() {
        let ignore = Arabic::bundled_ignore();
        assert_eq!(ignore.len(), 10);
        assert!(ignore.contains(&'\u{064E}'), "fatha");
        assert!(ignore.contains(&'\u{0640}'), "tatweel");
        assert!(ignore.contains(&'\u{0670}'), "dagger alif");
        assert!(!ignore.contains(&'أ'), "hamza forms are never folded");
    }

    #[test]
    fn strips_only_the_ignored_marks() {
        let ignore = Arabic::bundled_ignore();
        assert_eq!(strip_ignored("الْكِتَـــابُ", &ignore), "الكتاب");
        assert_eq!(strip_ignored("أَإِآ", &ignore), "أإآ");
    }

    #[test]
    fn knows_common_misspellings_with_a_conjunction() {
        assert_eq!(common_fix("حتي").as_deref(), Some("حتى"));
        assert_eq!(common_fix("وحتي").as_deref(), Some("وحتى"));
        assert_eq!(common_fix("فذالك").as_deref(), Some("فذلك"));
        assert_eq!(common_fix("حتى"), None);
        assert_eq!(common_fix("لدية"), None, "a real word");
    }
}
