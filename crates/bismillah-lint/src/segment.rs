//! Splitting a block into what each checker may see (ARCHITECTURE.md §7.2).
//!
//! Every decision here is made on characters, never on meaning: Arabic-script runs, the
//! Qur'anic trigger, IJMES transliteration and other scripts are all recognised by the
//! code points they contain. Ranges are char indices into the block.

use std::ops::Range;

/// The Arabic script blocks, as `src/editor/scriptRuns.ts` defines them for font runs.
pub fn is_arabic(c: char) -> bool {
    matches!(c as u32,
        0x0600..=0x06FF | 0x0750..=0x077F | 0x0870..=0x08FF | 0xFB50..=0xFDFF | 0xFE70..=0xFEFF)
}

/// Combining marks outside the Arabic blocks that may follow an Arabic letter.
fn is_combining(c: char) -> bool {
    matches!(c as u32,
        0x0300..=0x036F | 0x1AB0..=0x1AFF | 0x1DC0..=0x1DFF | 0x20D0..=0x20FF | 0xFE20..=0xFE2F)
}

const ZWNJ: char = '\u{200C}';
const ZWJ: char = '\u{200D}';

/// ADR-0004: an Arabic run with alef wasla or a Qur'anic annotation mark is Uthmani
/// text, whose orthography isn't modern spelling, so it is never spellchecked.
pub fn is_quranic(c: char) -> bool {
    matches!(c as u32, 0x0671 | 0x0610..=0x061A | 0x06D6..=0x06ED | 0x08D3..=0x08FF)
}

/// A run of Arabic-script words, with the spaces between them.
#[derive(Clone, Debug, PartialEq)]
pub struct ArabicRun {
    pub range: Range<usize>,
    pub quranic: bool,
}

/// Arabic runs: an Arabic character, then Arabic characters, combining marks and
/// joiners, continuing over spaces only when another Arabic character follows (the same
/// shape as `scriptRuns.ts`, so the font run and the spelling run agree).
pub fn arabic_runs(chars: &[char]) -> Vec<ArabicRun> {
    let mut runs = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if !is_arabic(chars[i]) {
            i += 1;
            continue;
        }
        let start = i;
        let mut end = i + 1;
        loop {
            while end < chars.len() {
                let c = chars[end];
                if is_arabic(c) || is_combining(c) || c == ZWNJ || c == ZWJ {
                    end += 1;
                } else {
                    break;
                }
            }
            let mut gap = end;
            while gap < chars.len() && (chars[gap] == ' ' || chars[gap] == '\u{A0}') {
                gap += 1;
            }
            if gap > end && gap < chars.len() && is_arabic(chars[gap]) {
                end = gap + 1;
            } else {
                break;
            }
        }
        let quranic = chars[start..end].iter().any(|&c| is_quranic(c));
        runs.push(ArabicRun {
            range: start..end,
            quranic,
        });
        i = end;
    }
    runs
}

/// Letters, marks, tatweel and joiners: what an Arabic word is made of. Punctuation
/// (، ؛ ؟), digits and signs in the Arabic blocks end a word.
fn is_arabic_word_char(c: char) -> bool {
    matches!(c as u32,
        0x0610..=0x061A
        | 0x0620..=0x065F
        | 0x066E..=0x06D3
        | 0x06D5..=0x06DC
        | 0x06DF..=0x06E8
        | 0x06EA..=0x06EF
        | 0x06FA..=0x06FC
        | 0x06FF
        | 0x0750..=0x077F
        | 0x0870..=0x0887
        | 0x0889..=0x088E
        | 0x0898..=0x08E1
        | 0x08E3..=0x08FF
        | 0xFB50..=0xFD3D
        | 0xFD50..=0xFDC7
        | 0xFDF0..=0xFDFB
        | 0xFE70..=0xFEFC)
        || is_combining(c)
        || c == ZWNJ
        || c == ZWJ
}

/// The words of one Arabic run.
pub fn arabic_words(chars: &[char], run: &Range<usize>) -> Vec<Range<usize>> {
    let mut words = Vec::new();
    let mut start = None;
    for i in run.clone() {
        match (is_arabic_word_char(chars[i]), start) {
            (true, None) => start = Some(i),
            (false, Some(s)) => {
                words.push(s..i);
                start = None;
            }
            _ => {}
        }
    }
    if let Some(s) = start {
        words.push(s..run.end);
    }
    words
}

/// Latin script, with its modifier letters (ʿ ʾ) and the IPA and phonetic blocks.
fn is_latin_letter(c: char) -> bool {
    c.is_ascii_alphabetic()
        || matches!(c as u32,
            0x00AA | 0x00BA | 0x00C0..=0x00D6 | 0x00D8..=0x00F6 | 0x00F8..=0x02FF
            | 0x1D00..=0x1DBF | 0x1E00..=0x1EFF | 0x2071 | 0x207F | 0x2090..=0x209C
            | 0x2C60..=0x2C7F | 0xA720..=0xA7FF | 0xAB30..=0xAB6F | 0xFB00..=0xFB06
            | 0xFF21..=0xFF3A | 0xFF41..=0xFF5A)
}

/// What a word outside Arabic runs is made of: letters and digits of any script,
/// combining marks, and an apostrophe between letters ("don't", "Qur'an").
fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || is_combining(c) || is_latin_letter(c)
}

fn is_apostrophe(c: char) -> bool {
    c == '\'' || c == '\u{2019}'
}

/// Words outside Arabic runs, as char ranges. A hyphen joins words into one compound
/// (IJMES writes "al-Raḥmān", "wa-l-ʿilm"), returned whole.
pub fn compounds(chars: &[char]) -> Vec<Range<usize>> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if !is_word_char(chars[i]) || is_arabic(chars[i]) {
            i += 1;
            continue;
        }
        let start = i;
        let mut end = i;
        loop {
            while end < chars.len() && is_word_char(chars[end]) && !is_arabic(chars[end]) {
                end += 1;
            }
            let joined = end + 1 < chars.len()
                && (is_apostrophe(chars[end]) || chars[end] == '-')
                && is_word_char(chars[end + 1])
                && !is_arabic(chars[end + 1]);
            if joined {
                end += 1;
            } else {
                break;
            }
        }
        out.push(start..end);
        i = end;
    }
    out
}

/// IJMES (and ALA-LC/DMG) letters that English never uses: ʿayn and hamza, macrons and
/// letters with a dot, line or breve below, precomposed or combining.
fn is_transliteration_char(c: char) -> bool {
    matches!(
        c,
        '\u{02BB}'
            | '\u{02BC}'
            | '\u{02BE}'
            | '\u{02BF}'
            | 'Ā'
            | 'ā'
            | 'Ē'
            | 'ē'
            | 'Ī'
            | 'ī'
            | 'Ō'
            | 'ō'
            | 'Ū'
            | 'ū'
            | 'Ḍ'
            | 'ḍ'
            | 'Ḥ'
            | 'ḥ'
            | 'Ṣ'
            | 'ṣ'
            | 'Ṭ'
            | 'ṭ'
            | 'Ẓ'
            | 'ẓ'
            | 'Ḳ'
            | 'ḳ'
            | 'Ḏ'
            | 'ḏ'
            | 'Ṯ'
            | 'ṯ'
            | 'Ḵ'
            | 'ḵ'
            | 'Ḫ'
            | 'ḫ'
            | 'ẖ'
            | 'Ġ'
            | 'ġ'
            | 'Ǧ'
            | 'ǧ'
            | '\u{0304}'
            | '\u{0323}'
            | '\u{0331}'
            | '\u{032E}'
    )
}

/// A transliterated word: it contains a letter only transliteration uses. English
/// checking would flag every one with absurd suggestions (Fātiḥa → Fatima), and ʿ ʾ split
/// Harper's tokens, so such words are left to the writer (docs/spikes/harper-latency.md).
pub fn is_transliterated(word: &[char]) -> bool {
    word.iter().any(|&c| is_transliteration_char(c))
}

/// A word with a letter from a script that has no checker (Greek, Cyrillic, Hebrew,
/// Devanagari, CJK…). It is never flagged.
pub fn is_other_script(word: &[char]) -> bool {
    word.iter()
        .any(|&c| c.is_alphabetic() && !is_latin_letter(c) && !is_arabic(c))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chars(s: &str) -> Vec<char> {
        s.chars().collect()
    }

    fn text(chars: &[char], r: &Range<usize>) -> String {
        chars[r.clone()].iter().collect()
    }

    #[test]
    fn finds_arabic_runs_across_spaces_only() {
        let c = chars("The word أمانة means trust, and زهد كلمة is here.");
        let runs = arabic_runs(&c);
        assert_eq!(runs.len(), 2);
        assert_eq!(text(&c, &runs[0].range), "أمانة");
        assert_eq!(text(&c, &runs[1].range), "زهد كلمة");
        assert!(!runs[0].quranic);
    }

    #[test]
    fn a_run_with_alef_wasla_or_an_annotation_mark_is_quranic() {
        let c = chars("ذَٰلِكَ ٱلْكِتَٰبُ لَا رَيْبَ ۛ فِيهِ");
        let runs = arabic_runs(&c);
        assert_eq!(runs.len(), 1);
        assert!(runs[0].quranic);
        let fatiha = chars("الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ");
        assert!(
            !arabic_runs(&fatiha)[0].quranic,
            "standard vocalisation only"
        );
        assert!(arabic_runs(&chars("ﷺ ﷲ"))[0].range.len() == 3);
        assert!(arabic_runs(&chars("مُحَمَّدٌ\u{0610}"))[0].quranic);
    }

    #[test]
    fn splits_arabic_words_at_punctuation_and_digits() {
        let c = chars("الكتابةُ أمانةٌ، والكلمةُ ١٢٣ مسؤوليةٌ؟");
        let run = &arabic_runs(&c)[0];
        let words: Vec<String> = arabic_words(&c, &run.range)
            .iter()
            .map(|r| text(&c, r))
            .collect();
        assert_eq!(words, ["الكتابةُ", "أمانةٌ", "والكلمةُ", "مسؤوليةٌ"]);
    }

    #[test]
    fn keeps_tatweel_and_joiners_inside_words() {
        let c = chars("كتـــاب می\u{200C}خواهم");
        let run = &arabic_runs(&c)[0];
        let words: Vec<String> = arabic_words(&c, &run.range)
            .iter()
            .map(|r| text(&c, r))
            .collect();
        assert_eq!(words, ["كتـــاب", "می\u{200C}خواهم"]);
    }

    #[test]
    fn joins_hyphenated_and_apostrophe_compounds() {
        let c = chars("wa-l-ʿilm, don't stop: al-Raḥmān and 10-12.");
        let words: Vec<String> = compounds(&c).iter().map(|r| text(&c, r)).collect();
        assert_eq!(
            words,
            ["wa-l-ʿilm", "don't", "stop", "al-Raḥmān", "and", "10-12"]
        );
    }

    #[test]
    fn recognises_transliteration_by_its_letters() {
        for word in ["Qurʾān", "ʿilm", "ḥadīth", "Fātiḥa", "ẓulm", "Ibn\u{0304}"] {
            assert!(is_transliterated(&chars(word)), "{word}");
        }
        for word in ["Taymiyya", "café", "naïve", "Ibn", "colour"] {
            assert!(!is_transliterated(&chars(word)), "{word}");
        }
    }

    #[test]
    fn recognises_other_scripts() {
        for word in ["слово", "λόγος", "שלום", "शब्द", "言葉"] {
            assert!(is_other_script(&chars(word)), "{word}");
        }
        for word in ["word", "ḥadīth", "Æsir", "straße", "ﬁne", "2026"] {
            assert!(!is_other_script(&chars(word)), "{word}");
        }
    }
}
