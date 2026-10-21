//! Spelling (English and Arabic) and grammar suggestions (English) for bismillah
//! (ADR-0004, ARCHITECTURE.md §7). Pure Rust with no Tauri dependency, so it can be
//! tested and benchmarked on its own.
//!
//! The app checks one block at a time (a paragraph, a heading, a table cell). The editor
//! sends each block's exact text with the ranges it must not read as prose: `skip` for
//! code, URLs and HTML, which stand for words, and `marks` for Markdown punctuation.
//! Offsets crossing that boundary are UTF-16 code units relative to the block
//! ([`offsets`]). Nothing here ever changes the text.

#![forbid(unsafe_code)]

pub mod arabic;
mod english;
pub mod offsets;
pub mod personal;
pub mod routing;
pub mod segment;

use std::collections::hash_map::DefaultHasher;
use std::collections::{BTreeMap, HashMap};
use std::hash::{Hash, Hasher};
use std::ops::Range;
use std::sync::{Arc, OnceLock, RwLock};
use std::time::Duration;

use harper_core::Span;
use harper_core::spell::MergedDictionary;
use serde::{Deserialize, Serialize};

pub use arabic::Arabic;
use offsets::Offsets;
use personal::Personal;
pub use routing::Dialect;

/// One block of the document, as the editor sends it.
#[derive(Clone, Debug, Default, Deserialize, Hash)]
pub struct Block {
    pub text: String,
    /// Ranges standing for words that aren't prose (code, URLs, HTML), in UTF-16 units.
    #[serde(default)]
    pub skip: Vec<[u32; 2]>,
    /// Markdown punctuation (`#`, `**`, `[`, `](`…), in UTF-16 units.
    #[serde(default)]
    pub marks: Vec<[u32; 2]>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Spelling,
    Grammar,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Lang {
    En,
    Ar,
}

/// A possible mistake in a block. A spelling diagnostic carries at most a grammar
/// rule's correction; the dictionary's are found on request ([`Suggester`]).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Diagnostic {
    pub from_utf16: u32,
    pub to_utf16: u32,
    pub kind: Kind,
    pub lang: Lang,
    /// Harper's explanation of a grammar suggestion (English, with `backticks`); empty
    /// for spelling, which the interface explains itself.
    pub message: String,
    /// Each the text that would replace the range; empty to remove it.
    pub suggestions: Vec<String>,
    pub rule_id: String,
}

/// The writer's checking settings for one request.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Options {
    pub spelling: bool,
    pub grammar: bool,
    pub dialect: Dialect,
    /// The document's frontmatter `lang:`, if any.
    pub lang: Option<String>,
}

/// Results are kept per block for the session, so reopening a document or undoing an
/// edit costs nothing (docs/spikes/harper-latency.md, adjustment 7).
const CACHE_LIMIT: usize = 50_000;

/// Grammar is checked in blocks up to this many UTF-16 units (about 3,000 words, under
/// half a second); Harper's cost grows faster than the text beyond it. Only pasted text
/// without blank lines makes a paragraph this long.
pub const GRAMMAR_LIMIT: u32 = 20_000;
/// Nothing is checked in a block longer than this, so the checker can never stall.
pub const CHECK_LIMIT: u32 = 100_000;

/// The ~300 ms an Arabic suggestion search may take (docs/spikes/arabic-speller.md).
pub const ARABIC_BUDGET: Duration = Duration::from_millis(300);

type SharedArabic = Arc<OnceLock<Option<Arc<Arabic>>>>;
type SharedDictionary = Arc<RwLock<Option<Arc<MergedDictionary>>>>;

/// Loads the bundled Arabic dictionary once, on first need.
fn arabic(shared: &SharedArabic) -> Option<Arc<Arabic>> {
    shared
        .get_or_init(|| Arabic::bundled().ok().map(Arc::new))
        .clone()
}

/// The checker. It lives on one long-lived thread (Harper's rule group mutates its
/// caches); [`Suggester`] handles can be used from any thread.
pub struct Linter {
    personal: Personal,
    english: Option<english::English>,
    dictionary: SharedDictionary,
    arabic: SharedArabic,
    cache: HashMap<u64, Vec<Diagnostic>>,
    /// Changes with the personal dictionary, so cached results never outlive it.
    generation: u64,
}

impl Linter {
    pub fn new(personal_words: Vec<String>) -> Self {
        Linter {
            personal: Personal::new(personal_words, &Arabic::bundled_ignore()),
            english: None,
            dictionary: Arc::new(RwLock::new(None)),
            arabic: Arc::new(OnceLock::new()),
            cache: HashMap::new(),
            generation: 0,
        }
    }

    /// A handle that finds corrections on another thread.
    pub fn suggester(&self) -> Suggester {
        Suggester {
            dictionary: Arc::clone(&self.dictionary),
            arabic: Arc::clone(&self.arabic),
        }
    }

    /// The writer's dictionary changed: every result is checked again.
    pub fn set_personal(&mut self, words: Vec<String>) {
        self.personal = Personal::new(words, &Arabic::bundled_ignore());
        if self.english.is_some() {
            self.english = Some(build_english(&self.personal, &self.dictionary));
        }
        self.cache.clear();
        self.generation += 1;
    }

    /// Builds the English checker and loads its lazy parts off the request path.
    pub fn warm_up(&mut self, dialect: Dialect) {
        self.english
            .get_or_insert_with(|| build_english(&self.personal, &self.dictionary))
            .warm_up(dialect);
    }

    /// Whether a check has needed English data. Callers may warm corrections then,
    /// without loading English into an empty or Arabic-only session.
    pub fn english_ready(&self) -> bool {
        self.english.is_some()
    }

    /// The possible mistakes in one block, in order.
    pub fn check(&mut self, block: &Block, options: &Options) -> Vec<Diagnostic> {
        let mut hasher = DefaultHasher::new();
        (block, options, self.generation).hash(&mut hasher);
        let key = hasher.finish();
        if let Some(hit) = self.cache.get(&key) {
            return hit.clone();
        }
        let found = self.check_uncached(block, options);
        if self.cache.len() >= CACHE_LIMIT {
            self.cache.clear();
        }
        self.cache.insert(key, found.clone());
        found
    }

    fn check_uncached(&mut self, block: &Block, options: &Options) -> Vec<Diagnostic> {
        let routes = routing::routes(options.lang.as_deref(), options.dialect);
        let offsets = Offsets::new(&block.text);
        if offsets.utf16_len() > CHECK_LIMIT {
            return Vec::new();
        }
        let grammar = options.grammar && offsets.utf16_len() <= GRAMMAR_LIMIT;
        let chars: Vec<char> = block.text.chars().collect();
        let skip = char_ranges(&block.skip, &offsets);
        let marks = char_ranges(&block.marks, &offsets);
        // What the segmenters see: skipped text can't join a word or a run, and marks
        // separate words like spaces do.
        let mut view = chars.clone();
        for r in &marks {
            view[r.clone()].fill(' ');
        }
        for r in &skip {
            view[r.clone()].fill('\u{FFFC}');
        }
        let runs = segment::arabic_runs(&view);
        let mut found: Vec<Finding> = Vec::new();

        if routes.arabic && options.spelling {
            let words: Vec<Range<usize>> = runs
                .iter()
                .filter(|run| !run.quranic)
                .flat_map(|run| segment::arabic_words(&view, &run.range))
                .collect();
            if !words.is_empty()
                && let Some(arabic) = arabic(&self.arabic)
            {
                for word in words {
                    let text: String = chars[word.clone()].iter().collect();
                    let stripped = arabic::strip_ignored(&text, arabic.ignore());
                    if stripped.chars().count() < 2 || self.personal.contains_arabic(&stripped) {
                        continue;
                    }
                    if !arabic.check(&text) {
                        found.push(Finding::spelling(word, Lang::Ar));
                    }
                }
            }
        }

        if let Some(dialect) = routes.latin
            && (options.spelling || grammar)
        {
            // Text that stands for words English can't judge: grammar near it is unreliable
            // ("The word أمانة means trust" reads as a missing "to").
            let mut gaps: Vec<Range<usize>> = skip.clone();
            gaps.extend(runs.iter().map(|r| r.range.clone()));
            for word in segment::compounds(&view) {
                let w = &chars[word.clone()];
                if segment::is_transliterated(w) || segment::is_other_script(w) {
                    gaps.push(word);
                }
            }
            let gaps = merge(gaps);
            let hidden = merge(gaps.iter().chain(marks.iter()).cloned().collect());
            let allowed = complement(&hidden, chars.len());
            // Whitespace, numbers and punctuation left around masked Arabic/code/
            // other scripts are not English prose. They must not load Harper.
            if allowed.iter().any(|span| {
                chars[span.start..span.end]
                    .iter()
                    .any(|c| c.is_alphabetic())
            }) {
                let personal = &self.personal;
                let english = self
                    .english
                    .get_or_insert_with(|| build_english(personal, &self.dictionary));
                let doc = english.parse(&block.text, allowed);
                if options.spelling {
                    for span in english.misspelled(&doc, personal, dialect) {
                        found.push(Finding::spelling(span.start..span.end, Lang::En));
                    }
                }
                if grammar {
                    let near = widen(&gaps, &chars);
                    // Harper may report one span twice ("Their is": there / they're): one
                    // diagnostic with both corrections, under the more important message.
                    let mut merged: BTreeMap<(usize, usize), (u8, Finding)> = BTreeMap::new();
                    for f in english.grammar(&doc, dialect) {
                        let span = f.span.start..f.span.end;
                        let touches = |g: &Range<usize>| span.start <= g.end && span.end >= g.start;
                        if span.is_empty() || near.iter().any(touches) {
                            continue;
                        }
                        // A replacement across masked marks would delete them.
                        let crosses = hidden
                            .iter()
                            .any(|h| h.start >= span.start && h.end <= span.end);
                        let replacements = if crosses { Vec::new() } else { f.replacements };
                        let (priority, entry) =
                            merged.entry((span.start, span.end)).or_insert_with(|| {
                                let finding = Finding {
                                    range: span.clone(),
                                    kind: Kind::Grammar,
                                    lang: Lang::En,
                                    message: f.message.clone(),
                                    suggestions: Vec::new(),
                                    rule_id: f.rule.clone(),
                                };
                                (f.priority, finding)
                            });
                        if f.priority < *priority {
                            *priority = f.priority;
                            entry.message = f.message;
                            entry.rule_id = f.rule;
                        }
                        entry.add_suggestions(replacements);
                    }
                    found.extend(merged.into_values().map(|(_, f)| f));
                }
            }
        }

        // A grammar hint on exactly a misspelled word ("blockquote" → "block quote") is one
        // more correction for it, not a second diagnostic.
        let spelled: Vec<Range<usize>> = found
            .iter()
            .filter(|f| f.kind == Kind::Spelling)
            .map(|f| f.range.clone())
            .collect();
        let (hints, mut found): (Vec<Finding>, Vec<Finding>) = found
            .into_iter()
            .partition(|f| f.kind == Kind::Grammar && spelled.contains(&f.range));
        for hint in hints {
            if let Some(word) = found
                .iter_mut()
                .find(|f| f.kind == Kind::Spelling && f.range == hint.range)
            {
                word.add_suggestions(hint.suggestions);
            }
        }

        let mut out: Vec<Diagnostic> = found
            .into_iter()
            .map(|f| f.into_diagnostic(&offsets))
            .collect();
        out.sort_by_key(|d| (d.from_utf16, d.to_utf16));
        out
    }
}

/// A diagnostic while it is still in char offsets.
struct Finding {
    range: Range<usize>,
    kind: Kind,
    lang: Lang,
    message: String,
    suggestions: Vec<String>,
    rule_id: String,
}

impl Finding {
    fn spelling(range: Range<usize>, lang: Lang) -> Self {
        Finding {
            range,
            kind: Kind::Spelling,
            lang,
            message: String::new(),
            suggestions: Vec::new(),
            rule_id: "spelling".into(),
        }
    }

    fn add_suggestions(&mut self, more: Vec<String>) {
        for s in more {
            if !self.suggestions.contains(&s) {
                self.suggestions.push(s);
            }
        }
    }

    fn into_diagnostic(self, offsets: &Offsets) -> Diagnostic {
        Diagnostic {
            from_utf16: offsets.char_to_utf16(self.range.start),
            to_utf16: offsets.char_to_utf16(self.range.end),
            kind: self.kind,
            lang: self.lang,
            message: self.message,
            suggestions: self.suggestions,
            rule_id: self.rule_id,
        }
    }
}

/// The English checker with the writer's words, published for the [`Suggester`].
fn build_english(personal: &Personal, shared: &SharedDictionary) -> english::English {
    let dictionary = english::dictionary(personal);
    if let Ok(mut slot) = shared.write() {
        *slot = Some(Arc::clone(&dictionary));
    }
    english::English::new(dictionary)
}

/// Finds corrections for misspelled words, on any thread.
#[derive(Clone)]
pub struct Suggester {
    dictionary: SharedDictionary,
    arabic: SharedArabic,
}

impl Suggester {
    /// Corrections for `word`, nearest first. Arabic searches stop after `budget`.
    pub fn suggest(
        &self,
        word: &str,
        lang: Lang,
        dialect: Dialect,
        budget: Duration,
    ) -> Vec<String> {
        match lang {
            Lang::En => {
                let dictionary = self.dictionary.read().ok().and_then(|d| d.clone());
                dictionary
                    .map(|d| english::suggest(&d, word, dialect))
                    .unwrap_or_default()
            }
            Lang::Ar => arabic(&self.arabic)
                .map(|a| a.suggest(word, budget))
                .unwrap_or_default(),
        }
    }
}

/// UTF-16 ranges from the editor as sorted, merged char ranges.
fn char_ranges(ranges: &[[u32; 2]], offsets: &Offsets) -> Vec<Range<usize>> {
    merge(
        ranges
            .iter()
            .map(|[from, to]| {
                let (start, end) = offsets.utf16_range_to_chars(*from, *to);
                start..end
            })
            .filter(|r| !r.is_empty())
            .collect(),
    )
}

/// Sorts ranges and joins those that overlap or touch.
fn merge(mut ranges: Vec<Range<usize>>) -> Vec<Range<usize>> {
    ranges.sort_by_key(|r| r.start);
    let mut out: Vec<Range<usize>> = Vec::with_capacity(ranges.len());
    for r in ranges {
        match out.last_mut() {
            Some(last) if r.start <= last.end => last.end = last.end.max(r.end),
            _ => out.push(r),
        }
    }
    out
}

/// The parts of `0..len` outside the sorted, merged `hidden` ranges.
fn complement(hidden: &[Range<usize>], len: usize) -> Vec<Span<char>> {
    let mut out = Vec::new();
    let mut at = 0;
    for h in hidden {
        if h.start > at {
            out.push(Span::new(at, h.start));
        }
        at = at.max(h.end);
    }
    if at < len {
        out.push(Span::new(at, len));
    }
    out
}

/// Each gap with the spaces around it, so a suggestion just beside it counts as near.
fn widen(gaps: &[Range<usize>], chars: &[char]) -> Vec<Range<usize>> {
    let space = |c: char| c == ' ' || c == '\t' || c == '\u{A0}';
    gaps.iter()
        .map(|g| {
            let mut start = g.start;
            while start > 0 && space(chars[start - 1]) {
                start -= 1;
            }
            let mut end = g.end;
            while end < chars.len() && space(chars[end]) {
                end += 1;
            }
            start..end
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_english_only_for_unmasked_english_prose() {
        let mut checker = Linter::new(Vec::new());
        let options = Options {
            spelling: true,
            grammar: true,
            dialect: Dialect::British,
            lang: None,
        };
        for text in [
            "",
            "  \n ",
            "123 — !!",
            "سَلَامٌ عَلَيْكُمْ.",
            "λόγος, слово!",
            "ʿilm and-ḥadīth",
        ] {
            checker.check(
                &Block {
                    text: text.into(),
                    ..Default::default()
                },
                &options,
            );
            assert!(
                !checker.english_ready(),
                "unnecessary English data for {text}"
            );
        }
        checker.check(
            &Block {
                text: "recieve".into(),
                skip: vec![[0, 7]],
                ..Default::default()
            },
            &options,
        );
        assert!(!checker.english_ready());
        let found = checker.check(
            &Block {
                text: "مرحبا. I will recieve it.".into(),
                ..Default::default()
            },
            &options,
        );
        assert!(checker.english_ready());
        assert!(
            found
                .iter()
                .any(|d| d.kind == Kind::Spelling && d.from_utf16 == 14 && d.to_utf16 == 21)
        );
    }

    #[test]
    fn merges_and_complements_ranges() {
        assert_eq!(merge(vec![5..7, 0..2, 1..3, 7..9]), vec![0..3, 5..9]);
        let spans = complement(&[2..4, 6..10], 12);
        let pairs: Vec<(usize, usize)> = spans.iter().map(|s| (s.start, s.end)).collect();
        assert_eq!(pairs, [(0, 2), (4, 6), (10, 12)]);
        assert!(complement(&[Range { start: 0, end: 5 }], 5).is_empty());
    }

    #[test]
    fn widens_gaps_over_neighbouring_spaces_only() {
        let chars: Vec<char> = "a  word. b".chars().collect();
        let widened = widen(&[Range { start: 3, end: 7 }], &chars);
        assert_eq!((widened[0].start, widened[0].end), (1, 7));
    }
}
