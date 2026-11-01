//! What a phone can change: theme, font, text size and margins (mobile/PLAN.md, M3). Each
//! field falls back alone, so a damaged or older file never costs the rest.

use std::fs;
use std::io;
use std::path::Path;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer, Serialize};

use crate::store;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Profile {
    #[default]
    Duo,
    Serif,
    PlexArabic,
    Amiri,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Step {
    Small,
    #[default]
    Medium,
    Large,
}

/// A value this version doesn't know becomes the default, leaving the other fields alone.
fn lenient<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned + Default,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(serde_json::from_value(value).unwrap_or_default())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    #[serde(deserialize_with = "lenient")]
    pub theme: Theme,
    #[serde(deserialize_with = "lenient")]
    pub profile: Profile,
    #[serde(deserialize_with = "lenient")]
    pub size: Step,
    #[serde(deserialize_with = "lenient")]
    pub margins: Step,
}

pub fn load(root: &Path) -> Settings {
    fs::read(root.join("settings.json"))
        .ok()
        .and_then(|json| serde_json::from_slice(&json).ok())
        .unwrap_or_default()
}

pub fn save(root: &Path, settings: &Settings) -> io::Result<()> {
    fs::create_dir_all(root)?;
    let json = serde_json::to_vec(settings).map_err(io::Error::other)?;
    store::replace(root, &root.join("settings.json"), &json)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(test: &str) -> std::path::PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/settings-tests")
            .join(test);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn round_trips_and_starts_from_defaults() {
        let dir = scratch("round");
        assert_eq!(load(&dir), Settings::default());
        let chosen = Settings {
            theme: Theme::Dark,
            profile: Profile::PlexArabic,
            size: Step::Large,
            margins: Step::Small,
        };
        save(&dir, &chosen).unwrap();
        assert_eq!(load(&dir), chosen);
    }

    #[test]
    fn damage_costs_only_what_is_damaged() {
        let dir = scratch("damage");
        fs::write(dir.join("settings.json"), b"{").unwrap();
        assert_eq!(load(&dir), Settings::default());
        fs::write(
            dir.join("settings.json"),
            br#"{"theme":"sepia","size":"large","later":1}"#,
        )
        .unwrap();
        let settings = load(&dir);
        assert_eq!(settings.theme, Theme::System);
        assert_eq!(settings.size, Step::Large);
    }
}
