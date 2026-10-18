//! Which checker each script run goes to (ADR-0004, ARCHITECTURE.md §7.2).
//!
//! Script alone doesn't establish language, so a document may declare its language in
//! frontmatter (`lang: en-GB`). The declared language decides the runs of its own
//! script; runs of the other script keep the default routing. So `lang: fa` stops
//! Arabic-script runs from being checked as Arabic, `lang: de` stops Latin runs from
//! being checked as English, and an English document still has its Arabic phrases
//! checked.

use serde::{Deserialize, Serialize};

/// The English dialect for spelling (a setting, overridden by `lang: en-XX`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Dialect {
    American,
    #[default]
    British,
    Canadian,
    Australian,
    Indian,
}

impl Dialect {
    pub(crate) fn harper(self) -> harper_core::Dialect {
        match self {
            Dialect::American => harper_core::Dialect::American,
            Dialect::British => harper_core::Dialect::British,
            Dialect::Canadian => harper_core::Dialect::Canadian,
            Dialect::Australian => harper_core::Dialect::Australian,
            Dialect::Indian => harper_core::Dialect::Indian,
        }
    }

    fn from_region(region: &str) -> Option<Dialect> {
        Some(match region.to_ascii_uppercase().as_str() {
            "US" => Dialect::American,
            "GB" | "UK" => Dialect::British,
            "CA" => Dialect::Canadian,
            "AU" => Dialect::Australian,
            "IN" => Dialect::Indian,
            _ => return None,
        })
    }
}

/// Where a block's runs go.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Routes {
    /// Latin runs are English in this dialect; `None`: they aren't checked.
    pub latin: Option<Dialect>,
    /// Arabic-script runs are checked as Arabic.
    pub arabic: bool,
}

/// Languages written in Arabic script other than Arabic itself: bismillah has no
/// dictionary for them, so their runs are left alone.
const ARABIC_SCRIPT: &[&str] = &[
    "fa", "ur", "ps", "ckb", "sd", "ug", "ks", "prs", "bal", "pnb", "skr", "azb", "glk", "mzn",
    "lrc",
];

/// Routes for a document whose frontmatter declares `lang` (a BCP 47 tag), with the
/// writer's dialect setting. A missing or malformed tag keeps the default routing.
pub fn routes(lang: Option<&str>, dialect: Dialect) -> Routes {
    let default = Routes {
        latin: Some(dialect),
        arabic: true,
    };
    let Some(tag) = lang.map(str::trim).filter(|t| is_language_tag(t)) else {
        return default;
    };
    let mut parts = tag.split(['-', '_']);
    let primary = parts.next().unwrap_or_default().to_ascii_lowercase();
    let rest: Vec<&str> = parts.collect();
    let script = rest
        .iter()
        .find(|p| p.len() == 4)
        .map(|p| p.to_ascii_lowercase());
    let arabic_script = match script.as_deref() {
        Some("arab") => true,
        Some(_) => false,
        None => primary == "ar" || ARABIC_SCRIPT.contains(&primary.as_str()),
    };
    match (primary.as_str(), arabic_script) {
        ("ar", true) => default,
        ("en", false) => Routes {
            latin: Some(
                rest.iter()
                    .find_map(|r| Dialect::from_region(r))
                    .unwrap_or(dialect),
            ),
            arabic: true,
        },
        (_, true) => Routes {
            latin: Some(dialect),
            arabic: false,
        },
        (_, false) => Routes {
            latin: None,
            arabic: true,
        },
    }
}

/// A plausible BCP 47 tag: a 2–3 letter language, then letter/digit subtags.
fn is_language_tag(tag: &str) -> bool {
    let mut parts = tag.split(['-', '_']);
    let primary = parts.next().unwrap_or_default();
    (2..=3).contains(&primary.len())
        && primary.chars().all(|c| c.is_ascii_alphabetic())
        && parts.all(|p| (1..=8).contains(&p.len()) && p.chars().all(|c| c.is_ascii_alphanumeric()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const GB: Dialect = Dialect::British;

    #[test]
    fn without_a_language_latin_is_english_and_arabic_is_arabic() {
        let r = routes(None, GB);
        assert_eq!(r.latin, Some(GB));
        assert!(r.arabic);
        assert_eq!(routes(Some("not a tag!"), GB), r);
        assert_eq!(routes(Some(""), GB), r);
    }

    #[test]
    fn an_english_region_chooses_the_dialect() {
        assert_eq!(routes(Some("en-US"), GB).latin, Some(Dialect::American));
        assert_eq!(routes(Some("en_AU"), GB).latin, Some(Dialect::Australian));
        assert_eq!(
            routes(Some("en"), Dialect::Canadian).latin,
            Some(Dialect::Canadian)
        );
        assert!(
            routes(Some("en-GB"), GB).arabic,
            "Arabic phrases are still checked"
        );
    }

    #[test]
    fn arabic_keeps_both_checkers() {
        assert_eq!(routes(Some("ar"), GB), routes(None, GB));
        assert_eq!(routes(Some("ar-EG"), GB), routes(None, GB));
    }

    #[test]
    fn another_arabic_script_language_leaves_arabic_runs_alone() {
        for tag in ["fa", "ur", "ps-AF", "ckb", "pa-Arab"] {
            let r = routes(Some(tag), GB);
            assert!(!r.arabic, "{tag}");
            assert_eq!(r.latin, Some(GB), "{tag}");
        }
    }

    #[test]
    fn another_latin_script_language_leaves_latin_runs_alone() {
        for tag in ["de", "fr-CA", "sv", "tr", "ms", "ar-Latn"] {
            let r = routes(Some(tag), GB);
            assert_eq!(r.latin, None, "{tag}");
            assert!(r.arabic, "{tag}");
        }
    }
}
