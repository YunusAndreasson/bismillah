//! The writer's personal dictionary (ARCHITECTURE.md §7.4): one word per line, shared by
//! every language. Reading and writing the file is the app's job; this is the list and
//! how a word in the text matches it.

use std::collections::HashSet;

use crate::arabic::strip_ignored;

/// The words of `dictionary.txt`: blank lines and lines starting with `#` are skipped,
/// so the writer may keep notes in it.
pub fn parse(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(str::to_string)
        .collect()
}

/// Why a word can't be added.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WordProblem {
    Empty,
    /// Spaces, line breaks or control characters: the file holds one word per line.
    NotOneWord,
    TooLong,
}

/// A word the writer may add: one line of the file, as written.
pub fn validate(word: &str) -> Result<&str, WordProblem> {
    let word = word.trim();
    if word.is_empty() {
        Err(WordProblem::Empty)
    } else if word.chars().any(|c| c.is_whitespace() || c.is_control()) {
        Err(WordProblem::NotOneWord)
    } else if word.chars().count() > 100 {
        Err(WordProblem::TooLong)
    } else {
        Ok(word)
    }
}

#[derive(Default)]
pub struct Personal {
    words: Vec<String>,
    exact: HashSet<String>,
    /// Entries written in lower case, which also accept a capitalised word ("bismillah"
    /// accepts "Bismillah" at the start of a sentence).
    lowercase: HashSet<String>,
    /// Every entry lower-cased, for words written in capitals.
    folded: HashSet<String>,
    /// Arabic entries without the dictionary's ignored marks, so a vocalised word matches
    /// its bare entry and the other way round.
    arabic: HashSet<String>,
}

impl Personal {
    pub fn new(words: Vec<String>, ignore: &[char]) -> Self {
        let mut p = Personal::default();
        for w in &words {
            p.exact.insert(w.clone());
            let lower = w.to_lowercase();
            if &lower == w {
                p.lowercase.insert(lower.clone());
            }
            p.folded.insert(lower);
            if w.chars().any(crate::segment::is_arabic) {
                p.arabic.insert(strip_ignored(w, ignore));
            }
        }
        p.words = words;
        p
    }

    pub fn words(&self) -> &[String] {
        &self.words
    }

    /// A Latin-script word: exactly as entered, capitalised from a lower-case entry, or
    /// in capitals.
    pub fn contains(&self, word: &str) -> bool {
        if self.exact.contains(word) {
            return true;
        }
        let lower = word.to_lowercase();
        if self.lowercase.contains(&lower) {
            return true;
        }
        let capitals =
            word.chars().any(char::is_uppercase) && !word.chars().any(char::is_lowercase);
        capitals && self.folded.contains(&lower)
    }

    /// An Arabic word, already stripped of the dictionary's ignored marks.
    pub fn contains_arabic(&self, stripped: &str) -> bool {
        self.arabic.contains(stripped)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn personal(words: &[&str]) -> Personal {
        Personal::new(
            words.iter().map(|w| w.to_string()).collect(),
            &['\u{064E}', '\u{064F}', '\u{0640}'],
        )
    }

    #[test]
    fn parses_one_word_per_line_skipping_notes() {
        assert_eq!(
            parse("# my words\nTaymiyya\r\n\n  bismillah  \nأمانة\n"),
            ["Taymiyya", "bismillah", "أمانة"]
        );
    }

    #[test]
    fn validates_words_to_add() {
        assert_eq!(validate("  Taymiyya "), Ok("Taymiyya"));
        assert_eq!(validate(" "), Err(WordProblem::Empty));
        assert_eq!(validate("two words"), Err(WordProblem::NotOneWord));
        assert_eq!(validate("a\u{7}"), Err(WordProblem::NotOneWord));
        assert_eq!(validate(&"x".repeat(101)), Err(WordProblem::TooLong));
    }

    #[test]
    fn matches_case_like_a_dictionary() {
        let p = personal(&["Taymiyya", "bismillah"]);
        assert!(p.contains("Taymiyya"));
        assert!(p.contains("TAYMIYYA"));
        assert!(
            !p.contains("taymiyya"),
            "a capitalised entry stays capitalised"
        );
        assert!(p.contains("bismillah"));
        assert!(p.contains("Bismillah"));
        assert!(p.contains("BISMILLAH"));
        assert!(!p.contains("bismilla"));
    }

    #[test]
    fn matches_arabic_with_or_without_vocalisation() {
        let p = personal(&["كَتَب"]);
        assert!(p.contains_arabic("كتب"));
        assert!(!p.contains_arabic("كتبت"));
    }
}
