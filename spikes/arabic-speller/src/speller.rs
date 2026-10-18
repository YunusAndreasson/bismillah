//! The adapter shape Phase 3 would put behind `bismillah-lint` (ARCHITECTURE.md §7.3).

use std::time::Instant;

pub trait ArabicSpeller {
    fn check(&self, word: &str) -> bool;
    fn suggest(&self, word: &str) -> Vec<String>;
}

pub struct Paths<'a> {
    pub aff: &'a str,
    pub dic: &'a str,
}

// ---------------------------------------------------------------- spellbook

pub struct Spellbook(spellbook::Dictionary);

impl Spellbook {
    pub fn load(p: &Paths) -> Result<(Self, f64), String> {
        let t = Instant::now();
        let aff = std::fs::read_to_string(p.aff).map_err(|e| e.to_string())?;
        let dic = std::fs::read_to_string(p.dic).map_err(|e| e.to_string())?;
        let d = spellbook::Dictionary::new(&aff, &dic).map_err(|e| format!("{e:?}"))?;
        Ok((Self(d), t.elapsed().as_secs_f64() * 1e3))
    }
}

impl ArabicSpeller for Spellbook {
    fn check(&self, word: &str) -> bool {
        self.0.check(word)
    }
    fn suggest(&self, word: &str) -> Vec<String> {
        let mut out = Vec::new();
        self.0.suggest(word, &mut out);
        out
    }
}

// ---------------------------------------------------------------- Hunspell

pub struct Hunspell(hunspell_rs::Hunspell);

impl Hunspell {
    pub fn load(p: &Paths) -> Result<(Self, f64), String> {
        let t = Instant::now();
        // hunspell-rs reports no load errors: a missing file yields an empty dictionary.
        let h = hunspell_rs::Hunspell::new(p.aff, p.dic);
        Ok((Self(h), t.elapsed().as_secs_f64() * 1e3))
    }
}

impl ArabicSpeller for Hunspell {
    fn check(&self, word: &str) -> bool {
        self.0.check(word) == hunspell_rs::CheckResult::FoundInDictionary
    }
    fn suggest(&self, word: &str) -> Vec<String> {
        self.0.suggest(word)
    }
}

// ---------------------------------------------------- IGNORE-stripping adapter

/// Strips only the dictionary's IGNORE characters, on a temporary copy, before
/// delegating. Never folds alef or hamza forms.
pub struct StripIgnore<S> {
    pub inner: S,
    pub ignore: Vec<char>,
}

impl<S> StripIgnore<S> {
    fn strip(&self, w: &str) -> String {
        w.chars().filter(|c| !self.ignore.contains(c)).collect()
    }
}

impl<S: ArabicSpeller> ArabicSpeller for StripIgnore<S> {
    fn check(&self, word: &str) -> bool {
        self.inner.check(&self.strip(word))
    }
    fn suggest(&self, word: &str) -> Vec<String> {
        self.inner.suggest(&self.strip(word))
    }
}

/// The characters on the `.aff` file's `IGNORE` line.
pub fn ignore_chars(aff: &str) -> Vec<char> {
    aff.lines()
        .find_map(|l| l.strip_prefix("IGNORE"))
        .map(|rest| rest.trim().chars().collect())
        .unwrap_or_default()
}
