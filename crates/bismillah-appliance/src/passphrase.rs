//! Passphrases: kept in memory that is cleared on drop, rated with zxcvbn, and
//! generated from the EFF large word list (CC BY 3.0 US, Electronic Frontier
//! Foundation) with the system's randomness.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use zeroize::Zeroizing;

/// The weakest zxcvbn score setup accepts (os/PLAN.md: "refused below score 3").
pub const MIN_SCORE: u8 = 3;

/// Words in a generated passphrase: 6 × log2(7776) ≈ 77.5 bits.
pub const GENERATED_WORDS: usize = 6;

/// The longest passphrase the stick accepts, in bytes.
pub const MAX_BYTES: usize = 1024;

/// A passphrase. It never prints, and its memory is cleared when it is dropped.
pub struct Secret(Zeroizing<String>);

impl Secret {
    pub fn new(text: String) -> Self {
        Self(Zeroizing::new(text))
    }

    /// The passphrase's exact bytes, for cryptsetup's stdin and nothing else.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret(…)")
    }
}

impl Serialize for Secret {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for Secret {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let text = Zeroizing::new(String::deserialize(d)?);
        if text.len() > MAX_BYTES {
            return Err(serde::de::Error::custom("passphrase too long"));
        }
        Ok(Self(text))
    }
}

/// How guessable a passphrase is, for the setup screen's meter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Strength {
    /// zxcvbn's score, 0 (guessable) to 4.
    pub score: u8,
    /// Whether setup accepts it.
    pub enough: bool,
    /// zxcvbn's warning, if any (English).
    pub warning: Option<String>,
}

/// Rates `passphrase`. Words that describe the stick itself count as guessable.
pub fn strength(passphrase: &str) -> Strength {
    if passphrase.is_empty() {
        return Strength {
            score: 0,
            enough: false,
            warning: None,
        };
    }
    let entropy = zxcvbn::zxcvbn(passphrase, &["bismillah", "writer", "texts"]);
    let score = u8::from(entropy.score());
    Strength {
        score,
        enough: score >= MIN_SCORE && passphrase.len() <= MAX_BYTES,
        warning: entropy
            .feedback()
            .and_then(|f| f.warning())
            .map(|w| w.to_string()),
    }
}

/// The 7776 words of the EFF large list, one per line.
const WORDS: &str = include_str!("words.txt");

/// A passphrase of [`GENERATED_WORDS`] words, separated by spaces. `random` supplies
/// uniformly random bytes (the caller passes the system's randomness).
pub fn generate(mut random: impl FnMut(&mut [u8])) -> Secret {
    let words: Vec<&str> = WORDS.lines().collect();
    let count = u32::try_from(words.len()).unwrap_or(u32::MAX);
    // Rejection sampling: only values below the largest multiple of `count` are used,
    // so every word is equally likely.
    let limit = u32::MAX - u32::MAX % count;
    let mut chosen = Zeroizing::new(String::with_capacity(GENERATED_WORDS * 10));
    for i in 0..GENERATED_WORDS {
        let index = loop {
            let mut bytes = Zeroizing::new([0u8; 4]);
            random(&mut *bytes);
            let value = u32::from_le_bytes(*bytes);
            if value < limit {
                break (value % count) as usize;
            }
        };
        if i > 0 {
            chosen.push(' ');
        }
        chosen.push_str(words.get(index).copied().unwrap_or_default());
    }
    Secret(chosen)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rates_guessable_and_strong_passphrases() {
        assert!(!strength("").enough);
        assert!(!strength("password").enough);
        assert!(!strength("bismillah").enough);
        assert!(!strength("qwerty123").enough);
        let strong = strength("lantern orbit velvet caramel");
        assert!(strong.enough, "{strong:?}");
        // Arabic and Swedish text is rated as well.
        assert!(strength("بسم الله الرحمن الرحيم سطر ثاني").score >= 2);
        assert!(strength("åäö").score < MIN_SCORE);
    }

    #[test]
    fn the_word_list_is_the_eff_large_list() {
        let words: Vec<&str> = WORDS.lines().collect();
        assert_eq!(words.len(), 7776);
        assert_eq!(words.first(), Some(&"abacus"));
        assert_eq!(words.last(), Some(&"zoom"));
        assert!(
            words
                .iter()
                .all(|w| w.chars().all(|c| c.is_ascii_lowercase() || c == '-'))
        );
    }

    #[test]
    fn generates_six_words_that_setup_accepts() {
        let mut state = 0x2545_f491_u32;
        let generated = generate(|bytes| {
            for b in bytes {
                // xorshift: a fixed sequence, so the test is repeatable.
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                *b = state.to_le_bytes()[0];
            }
        });
        let words: Vec<&str> = generated.expose().split(' ').collect();
        assert_eq!(words.len(), GENERATED_WORDS);
        assert!(words.iter().all(|w| WORDS.lines().any(|l| l == *w)));
        assert!(strength(generated.expose()).enough);
    }

    #[test]
    fn rejection_sampling_skips_values_above_the_limit() {
        // The first draw is u32::MAX, above the limit, so it is skipped.
        let mut draws = [u32::MAX, 0, 1, 2, 3, 4, 5].into_iter();
        let generated = generate(|bytes| {
            bytes.copy_from_slice(&draws.next().unwrap_or(0).to_le_bytes());
        });
        assert_eq!(
            generated.expose(),
            "abacus abdomen abdominal abide abiding ability"
        );
    }

    #[test]
    fn overlong_passphrases_are_refused_when_read() {
        let long = format!("\"{}\"", "a".repeat(MAX_BYTES + 1));
        assert!(serde_json::from_str::<Secret>(&long).is_err());
    }
}
