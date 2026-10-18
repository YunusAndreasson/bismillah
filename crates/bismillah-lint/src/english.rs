//! English spelling and grammar with Harper (ADR-0004, docs/spikes/harper-latency.md).
//!
//! Harper sees only what the block's mask allows: the editor masks code, URLs and
//! Markdown marks, and routing masks Arabic runs, transliterated words and other
//! scripts. Spelling is our own membership check (with the personal dictionary), and
//! suggestions are computed only when the writer asks; Harper's `SpellCheck` rule, which
//! computes them for every unknown word, is off. Grammar is Harper's curated rule set
//! without the opinionated rules that clash with DESIGN.md §2 ("calm, not clever").

use std::collections::HashMap;
use std::sync::Arc;

use harper_core::linting::{Lint, LintGroup, LintKind, Suggestion};
use harper_core::parsers::{Mask, PlainEnglish};
use harper_core::spell::{
    Dictionary, FstDictionary, MergedDictionary, MutableDictionary, suggest_correct_spelling,
};
use harper_core::{DictWordMetadata, Document, Masker, Span, TokenStringExt};

use crate::personal::Personal;
use crate::routing::Dialect;

/// Harper rules that stay off:
/// - `SpellCheck`: replaced by the membership check and on-demand suggestions.
/// - `UseTitleCase`, `OxfordComma`, `NoOxfordComma`, `LongSentences`, `BoringWords`:
///   matters of style, not mistakes; they would flag every sentence-case heading.
/// - `AvoidCurses`: the interface never judges the writer (DESIGN.md §14).
/// - `CompoundNouns`: open or closed compounds are house style; British usage keeps
///   many open ("lower case").
/// - `Dashes`, `EllipsisLength`, `UseEllipsisCharacter`, `NumericRangeEnDash`: smart
///   punctuation already types – — …, and straight forms left in the text are deliberate.
const OFF: &[&str] = &[
    "SpellCheck",
    "UseTitleCase",
    "OxfordComma",
    "NoOxfordComma",
    "LongSentences",
    "BoringWords",
    "AvoidCurses",
    "CompoundNouns",
    "Dashes",
    "EllipsisLength",
    "UseEllipsisCharacter",
    "NumericRangeEnDash",
];

/// At most this many corrections are offered for a misspelled word.
const MAX_SUGGESTIONS: usize = 5;

/// The chars Harper may read, prepared by the caller.
struct Allowed(Vec<Span<char>>);

impl Masker for Allowed {
    fn create_mask(&self, _source: &[char]) -> harper_core::Mask {
        self.0.iter().copied().collect()
    }
}

/// The curated English dictionary with the writer's own words.
pub fn dictionary(personal: &Personal) -> Arc<MergedDictionary> {
    let mut own = MutableDictionary::new();
    for word in personal.words() {
        own.append_word_str(word, DictWordMetadata::default());
    }
    let mut merged = MergedDictionary::new();
    merged.add_dictionary(FstDictionary::curated());
    merged.add_dictionary(Arc::new(own));
    Arc::new(merged)
}

pub struct English {
    dictionary: Arc<MergedDictionary>,
    /// One group per dialect in use; each keeps its own caches of unchanged sentences.
    groups: HashMap<Dialect, LintGroup>,
}

/// A grammar suggestion as Harper found it, before routing filters it.
pub struct Found {
    pub span: Span<char>,
    pub rule: String,
    pub message: String,
    pub priority: u8,
    /// Each one the text that would replace the span.
    pub replacements: Vec<String>,
}

impl English {
    pub fn new(dictionary: Arc<MergedDictionary>) -> Self {
        English {
            dictionary,
            groups: HashMap::new(),
        }
    }

    /// Parses the allowed parts of a block as plain English prose.
    pub fn parse(&self, text: &str, allowed: Vec<Span<char>>) -> Document {
        let parser = Mask::new(Allowed(allowed), PlainEnglish);
        Document::new(text, &parser, &self.dictionary)
    }

    /// The words of `doc` that are neither in the dictionary (in this dialect) nor in the
    /// personal dictionary. Words in capitals (acronyms), single letters and words with
    /// digits are never flagged, nor is the Arabic article of "al-Jawziyya". Of a
    /// possessive only the word is flagged ("Taymiyya" of "Taymiyya’s"), so *Add to
    /// dictionary* adds the word.
    pub fn misspelled(
        &self,
        doc: &Document,
        personal: &Personal,
        dialect: Dialect,
    ) -> Vec<Span<char>> {
        let dialect = dialect.harper();
        let source = doc.get_source();
        // Harper's own test (its `SpellCheck` rule): in the dialect, in this case or lower case.
        let known = |w: &[char]| {
            let lower: Vec<char> = w.iter().flat_map(|c| c.to_lowercase()).collect();
            self.dictionary
                .get_word_metadata(w)
                .is_some_and(|m| m.dialects.is_dialect_enabled(dialect))
                && (self.dictionary.contains_exact_word(w)
                    || self.dictionary.contains_exact_word(&lower))
        };
        doc.iter_words()
            .filter_map(|word| {
                let mut span = word.span;
                let chars = span.get_content(source);
                if chars.len() < 2
                    || chars.iter().any(|c| c.is_numeric())
                    || !chars.iter().any(|c| c.is_lowercase())
                {
                    return None;
                }
                let article = matches!(chars, ['a' | 'A' | 'e' | 'E', 'l'])
                    && source.get(span.end) == Some(&'-')
                    && source.get(span.end + 1).is_some_and(|c| c.is_alphabetic());
                if article {
                    return None;
                }
                let base = possessive_base(chars);
                let text: String = base.iter().collect();
                if personal.contains(&text) || known(base) {
                    return None;
                }
                span.end = span.start + base.len();
                Some(span)
            })
            .collect()
    }

    /// Harper's grammar suggestions for `doc`, by rule.
    pub fn grammar(&mut self, doc: &Document, dialect: Dialect) -> Vec<Found> {
        let group = self.group(dialect);
        let source = doc.get_source();
        let mut found = Vec::new();
        for (rule, lints) in group.organized_lints(doc) {
            // Advice on style ("very good" → "excellent") isn't a grammar suggestion.
            for lint in lints.into_iter().filter(|l| {
                !matches!(
                    l.lint_kind,
                    LintKind::Enhancement | LintKind::Readability | LintKind::Style
                )
            }) {
                found.push(found_from(&rule, lint, source));
            }
        }
        found
    }

    fn group(&mut self, dialect: Dialect) -> &mut LintGroup {
        let dictionary = &self.dictionary;
        self.groups.entry(dialect).or_insert_with(|| {
            let mut group = LintGroup::new_curated(Arc::clone(dictionary), dialect.harper());
            for rule in OFF {
                group.config.set_rule_enabled(*rule, false);
            }
            group
        })
    }

    /// Loads what the first real request would otherwise wait for: the rule group and
    /// the parser's model and caches. (The suggestion search is warmed on the thread that
    /// will use it: Harper keeps its automata per thread.)
    pub fn warm_up(&mut self, dialect: Dialect) {
        let text = "Warm up the checker: this sentence is a example, and their is more.";
        let all = vec![Span::new(0, text.chars().count())];
        let doc = self.parse(text, all);
        let _ = self.grammar(&doc, dialect);
    }
}

/// "Taymiyya’s" → "Taymiyya": a possessive is spelled as its word is.
fn possessive_base(word: &[char]) -> &[char] {
    match word {
        [base @ .., '’' | '\'', 's'] if base.len() >= 2 => base,
        _ => word,
    }
}

fn found_from(rule: &str, lint: Lint, source: &[char]) -> Found {
    let original: String = lint.span.get_content(source).iter().collect();
    let mut replacements: Vec<String> = Vec::new();
    for s in &lint.suggestions {
        let text = match s {
            Suggestion::ReplaceWith(chars) => chars.iter().collect(),
            Suggestion::InsertAfter(chars) => {
                let mut t = original.clone();
                t.extend(chars.iter());
                t
            }
            Suggestion::Remove => String::new(),
        };
        if text != original && !replacements.contains(&text) {
            replacements.push(text);
        }
    }
    Found {
        span: lint.span,
        rule: rule.to_string(),
        message: lint.message,
        priority: lint.priority,
        replacements,
    }
}

/// Corrections for a misspelled word in `dialect`, nearest first, capitalised like it.
/// Mirrors Harper's own search: widen the edit distance until something is found.
pub fn suggest(dictionary: &MergedDictionary, word: &str, dialect: Dialect) -> Vec<String> {
    let chars: Vec<char> = word.chars().collect();
    let dialect = dialect.harper();
    for distance in 2..5 {
        let found: Vec<Vec<char>> = suggest_correct_spelling(&chars, 200, distance, dictionary)
            .into_iter()
            .filter(|w| {
                dictionary
                    .get_word_metadata(w)
                    .is_some_and(|m| m.dialects.is_dialect_enabled(dialect))
            })
            .map(<[char]>::to_vec)
            .filter(|w| *w != chars)
            .take(MAX_SUGGESTIONS)
            .collect();
        if found.is_empty() {
            continue;
        }
        let capital = chars.first().is_some_and(|c| c.is_uppercase());
        return found
            .into_iter()
            .map(|mut w| {
                // Only plain words take the capital; "macOS" keeps its own case.
                if capital
                    && w.iter().skip(1).all(|c| !c.is_uppercase())
                    && let Some(first) = w.first_mut()
                {
                    *first = first.to_uppercase().next().unwrap_or(*first);
                }
                w.into_iter().collect()
            })
            .collect();
    }
    Vec::new()
}
